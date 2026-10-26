// Cloudflare Pages Function — 휴대폰 알림(웹 푸시) 구독·발송 (URL: /api/push)
//
// D1 바인딩: VISITS_DB (방문자 수와 같은 DB, 표 이름은 push_* 로 분리)
// VAPID 키는 처음 호출될 때 만들어 D1(push_kv)에 보관한다 → 대시보드에 따로 넣을 환경변수가 없다.
//
// GET  /api/push                          → { publicKey }  (브라우저 구독에 필요한 공개키)
// POST /api/push { action: "subscribe",   subscription, topics:["trade","analysis","matjip"] }
// POST /api/push { action: "status",      endpoint }
// POST /api/push { action: "unsubscribe", endpoint }
// POST /api/push { action: "test",        endpoint }       → 그 기기에만 확인 알림 1건 (1분에 1번)
// POST /api/push { action: "send" }                        → 새로 생긴 알림을 만들고 아직 못 받은 구독자에게 보낸다
//
// "send"는 비밀번호가 없다. 대신 같은 내용은 한 번만 만들어지고(메시지 ID 고정), 구독자마다 한 번만 보내진다.
// 그래서 여러 번 불러도 중복 알림이 가지 않는다. GitHub Actions(.github/workflows/push-alerts.yml)가 부른다.
//   - 실거래: data.json의 「오늘 신고내역」 날짜가 오늘(또는 어제)이고 0건이 아니면 "trade:<날짜>" 1건
//   - 글: blog/posts.json에 새 글이 생기면 "post:<글ID>" (맛집 태그는 matjip, 나머지는 analysis)
//   - 한국 시간 7시~21시 사이에만 새 알림을 만든다 (밤에 올린 글은 다음 날 아침에 나간다)

const SITE = "https://sebuin.com";
const TOPICS = ["trade", "analysis", "matjip"];
const PUSH_HOST = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const MAX_SUBS = 20000;
const BATCH = 20;              // 한 번 호출에 보내는 최대 건수 (Workers 하위 요청 한도 대비)
const RURAL_RE = /[읍면]/;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS push_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, topics TEXT NOT NULL, created INTEGER NOT NULL, last_test INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS push_msgs (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS push_deliv (msg TEXT NOT NULL, sub TEXT NOT NULL, status INTEGER NOT NULL, PRIMARY KEY (msg, sub))",
  "CREATE TABLE IF NOT EXISTS push_seen (post TEXT PRIMARY KEY)"
];
let ready = false;

// ───────── 공통 ─────────
function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function setup(db) {
  if (ready) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  ready = true;
}
const te = new TextEncoder();
function concat(...parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function b64u(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function subId(endpoint) {
  const h = await crypto.subtle.digest("SHA-256", te.encode(endpoint));
  return b64u(h).slice(0, 32);
}
function kst(ms) { return new Date((ms || Date.now()) + 9 * 3600 * 1000); }
function kstDay(ms) { return kst(ms).toISOString().slice(0, 10); }

// ───────── VAPID 키 ─────────
async function vapid(db) {
  let row = await db.prepare("SELECT v FROM push_kv WHERE k = 'vapid'").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
    await db.prepare("INSERT OR IGNORE INTO push_kv (k, v) VALUES ('vapid', ?)").bind(JSON.stringify({ jwk, pub })).run();
    row = await db.prepare("SELECT v FROM push_kv WHERE k = 'vapid'").first();
  }
  const v = JSON.parse(row.v);
  v.key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return v;
}
async function vapidJwt(v, endpoint) {
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, te.encode(head + "." + body));
  return head + "." + body + "." + b64u(sig);
}

// ───────── 암호화 (RFC 8291, aes128gcm) ─────────
async function hkdf(salt, ikm, info, bits) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bits));
}
export async function encrypt(p256dh, authSecret, text) {
  const ua = unb64u(p256dh), auth = unb64u(authSecret);
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode("WebPush: info\0"), ua, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 96);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(te.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 레코드 크기 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function pushOne(v, sub, payload, opt) {
  const body = await encrypt(sub.p256dh, sub.auth, JSON.stringify(payload));
  const headers = {
    "TTL": String((opt && opt.ttl) || 43200),
    "Urgency": "normal",
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    "Authorization": "vapid t=" + (await vapidJwt(v, sub.endpoint)) + ", k=" + v.pub
  };
  if (opt && opt.topic) headers["Topic"] = opt.topic;
  try {
    const r = await fetch(sub.endpoint, { method: "POST", headers, body });
    return r.status;
  } catch (e) { return 0; }
}

// ───────── 알림 내용 만들기 ─────────
function cleanApt(s) {
  s = String(s || "").trim();
  const m = s.match(/([가-힣]+마을)\s*(\d+)\s*단지/);
  const name = m ? m[1] + " " + m[2] + "단지" : s.replace(/\s*\(.*?\)\s*/g, "").trim();
  return name.replace(/마을/g, "");
}
function won(man) {
  man = Math.round(Number(man) || 0);
  const eok = Math.floor(man / 10000), rest = man % 10000;
  if (!eok) return rest.toLocaleString("ko-KR") + "만";
  return eok + "억" + (rest ? " " + rest.toLocaleString("ko-KR") + "만" : "");
}
function normYM(s) { const m = String(s).match(/(\d{4})\D+(\d{1,2})/); return m ? m[1] + "-" + ("0" + m[2]).slice(-2) : String(s); }

// 세부인 대시보드(index.html)의 '오늘의 상승거래' 계산과 같은 규칙
export function tradeDigest(data) {
  const t = data && data["오늘 신고내역"];
  if (!t) return null;
  const title = String((t.labels || [])[0] || "");
  const date = (title.match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
  const hi = (t.rows || []).findIndex(r => String(r[0]).trim() === "법정동");
  const rows = (hi >= 0 ? t.rows.slice(hi + 1) : (t.rows || [])).filter(r => r && r[0]);
  const nRural = rows.filter(r => RURAL_RE.test(String(r[0]))).length;
  const nDong = rows.length - nRural;

  let highs = [];
  const hist = data["(매일 자동) 실거래(매매)"];
  if (hist && hist.rows) {
    const H = {}, Hapt = {};
    hist.rows.forEach(r => {
      if (String(r[7]) === "직거래") return;
      const apt = r[2], area = Number(r[3]) || 0, amt = Number(r[6]) || 0;
      if (!apt || !area || !amt) return;
      (H[r[1] + "|" + apt + "|" + Math.round(area)] = H[r[1] + "|" + apt + "|" + Math.round(area)] || []).push({ ym: normYM(r[0]), amt });
      (Hapt[r[1] + "|" + apt] = Hapt[r[1] + "|" + apt] || []).push({ area, amt });
    });
    rows.forEach(r => {
      if (RURAL_RE.test(String(r[0])) || String(r[6]) === "직거래") return;
      const area = Number(r[4]) || 0, amt = Number(r[5]) || 0;
      if (!area || !amt) return;
      if ((Hapt[r[0] + "|" + r[1]] || []).filter(d => Math.abs(d.area - area) <= area * 0.10).length < 3) return;
      const arr = H[r[0] + "|" + r[1] + "|" + Math.round(area)];
      if (!arr || !arr.length) return;
      if (amt >= Math.max.apply(null, arr.map(d => d.amt))) highs.push({ apt: r[1], area, amt });
    });
    highs.sort((a, b) => b.amt - a.amt);
  }
  const top = rows.filter(r => !RURAL_RE.test(String(r[0])))
    .map(r => ({ apt: r[1], area: Number(r[4]) || 0, amt: Number(r[5]) || 0 }))
    .sort((a, b) => b.amt - a.amt)[0];
  return { date, count: rows.length, nDong, nRural, highs, top };
}
export function tradePayload(d) {
  const md = d.date.slice(5).replace("-", ".");
  const lines = [];
  if (d.highs.length) {
    const h = d.highs[0];
    lines.push("상승거래 " + d.highs.length + "건 · " + cleanApt(h.apt) + " " + Math.floor(h.area) + "㎡ " + won(h.amt));
  } else if (d.top) {
    lines.push("최고가 " + cleanApt(d.top.apt) + " " + Math.floor(d.top.area) + "㎡ " + won(d.top.amt));
  }
  lines.push("동 지역 " + d.nDong + "건" + (d.nRural ? " · 읍·면 " + d.nRural + "건" : ""));
  return {
    title: "세종 실거래 " + d.count + "건 새로 공개 (" + md + ")",
    body: lines.join("\n"),
    url: "/?from=push",
    tag: "trade"
  };
}
function postPayload(p) {
  const lede = String(p.lede || "").split("\n").map(s => s.trim()).filter(Boolean)[0] || "";
  const kind = p.tag === "맛집" ? "새 맛집 글" : "새 분석글";
  return {
    title: kind + " · " + String(p.title || "").slice(0, 60),
    body: lede.slice(0, 90),
    url: "/blog/" + String(p.id).replace(/\.html$/, "") + "?from=push",
    tag: "post-" + p.id
  };
}

async function asset(env, request, path) {
  const u = new URL(path, request.url);
  u.searchParams.set("t", String(Date.now()));
  const r = env.ASSETS ? await env.ASSETS.fetch(new Request(u.toString())) : await fetch(u.toString(), { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

// 새로 보낼 알림을 push_msgs에 만든다 (이미 있으면 그대로)
async function collect(env, request, db) {
  const made = [];
  const now = Date.now(), hour = kst(now).getUTCHours();
  if (hour < 7 || hour >= 21) return made;

  try {
    const d = tradeDigest(await asset(env, request, "/data.json"));
    const today = kstDay(now), yday = kstDay(now - 86400000);
    if (d && d.count > 0 && (d.date === today || d.date === yday)) {
      const id = "trade:" + d.date;
      const r = await db.prepare("INSERT OR IGNORE INTO push_msgs (id, topic, payload, created) VALUES (?, 'trade', ?, ?)")
        .bind(id, JSON.stringify(tradePayload(d)), now).run();
      if (r.meta && r.meta.changes) made.push(id);
    }
  } catch (e) {}

  try {
    const posts = await asset(env, request, "/blog/posts.json");
    if (Array.isArray(posts)) {
      const seen = new Set(((await db.prepare("SELECT post FROM push_seen").all()).results || []).map(r => r.post));
      const fresh = posts.filter(p => p && p.id && !seen.has(p.id));
      const first = seen.size === 0;            // 처음엔 기존 글 전부를 '본 것'으로만 기록 (옛 글 알림 폭탄 방지)
      const stmts = [];
      fresh.forEach((p, i) => {
        stmts.push(db.prepare("INSERT OR IGNORE INTO push_seen (post) VALUES (?)").bind(p.id));
        if (first || i >= 3) return;
        const id = "post:" + p.id;
        stmts.push(db.prepare("INSERT OR IGNORE INTO push_msgs (id, topic, payload, created) VALUES (?, ?, ?, ?)")
          .bind(id, p.tag === "맛집" ? "matjip" : "analysis", JSON.stringify(postPayload(p)), now));
        made.push(id);
      });
      if (stmts.length) await db.batch(stmts);
    }
  } catch (e) {}
  return made;
}

async function deliver(db, v) {
  let budget = BATCH, sent = 0, gone = 0, failed = 0, remaining = 0;
  await db.prepare("UPDATE push_msgs SET done = 1 WHERE done = 0 AND created < ?").bind(Date.now() - 2 * 86400000).run();
  const msgs = (await db.prepare("SELECT * FROM push_msgs WHERE done = 0 ORDER BY created").all()).results || [];
  for (const m of msgs) {
    const like = "%," + m.topic + ",%";
    if (budget > 0) {
      const subs = (await db.prepare(
        "SELECT * FROM push_subs s WHERE s.topics LIKE ? AND NOT EXISTS (SELECT 1 FROM push_deliv d WHERE d.msg = ? AND d.sub = s.id) LIMIT ?"
      ).bind(like, m.id, budget).all()).results || [];
      const payload = JSON.parse(m.payload);
      const res = await Promise.all(subs.map(s => pushOne(v, s, payload, { topic: m.topic })));
      const stmts = [];
      subs.forEach((s, i) => {
        const st = res[i];
        if (!st || st === 429 || st >= 500) { failed++; return; }   // 일시 오류는 기록하지 않고 다음 호출에서 다시 보낸다
        stmts.push(db.prepare("INSERT OR IGNORE INTO push_deliv (msg, sub, status) VALUES (?, ?, ?)").bind(m.id, s.id, st));
        if (st === 404 || st === 410) { stmts.push(db.prepare("DELETE FROM push_subs WHERE id = ?").bind(s.id)); gone++; }
        else if (st >= 200 && st < 300) sent++;
      });
      if (stmts.length) await db.batch(stmts);
      budget -= subs.length;
    }
    const left = await db.prepare(
      "SELECT COUNT(*) AS n FROM push_subs s WHERE s.topics LIKE ? AND NOT EXISTS (SELECT 1 FROM push_deliv d WHERE d.msg = ? AND d.sub = s.id)"
    ).bind(like, m.id).first();
    if (!left.n) await db.prepare("UPDATE push_msgs SET done = 1 WHERE id = ?").bind(m.id).run();
    remaining += left.n;
  }
  return { sent, gone, failed, remaining };
}

// ───────── 라우트 ─────────
export async function onRequestGet({ env }) {
  const db = env.VISITS_DB;
  if (!db) return json({ ok: false, error: "no db" }, 503);
  try { await setup(db); const v = await vapid(db); return json({ ok: true, publicKey: v.pub }); }
  catch (e) { return json({ ok: false }, 500); }
}

export async function onRequestPost({ request, env }) {
  const db = env.VISITS_DB;
  if (!db) return json({ ok: false, error: "no db" }, 503);
  let req;
  try { req = await request.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
  try {
    await setup(db);
    const action = String(req.action || "");

    if (action === "subscribe") {
      const s = req.subscription || {}, k = s.keys || {};
      let host = "";
      try { const u = new URL(s.endpoint); if (u.protocol === "https:") host = u.hostname; } catch (e) {}
      if (!host || !PUSH_HOST.test(host)) return json({ ok: false, error: "지원하지 않는 푸시 주소입니다." }, 400);
      if (!/^[A-Za-z0-9_-]{80,100}$/.test(k.p256dh || "") || !/^[A-Za-z0-9_-]{16,32}$/.test(k.auth || ""))
        return json({ ok: false, error: "구독 키가 올바르지 않습니다." }, 400);
      const topics = (Array.isArray(req.topics) ? req.topics : TOPICS.slice(0, 2)).filter(t => TOPICS.includes(t));
      if (!topics.length) return json({ ok: false, error: "받을 알림을 하나 이상 고르세요." }, 400);
      const id = await subId(s.endpoint);
      const exists = await db.prepare("SELECT id FROM push_subs WHERE id = ?").bind(id).first();
      if (!exists) {
        const c = await db.prepare("SELECT COUNT(*) AS n FROM push_subs").first();
        if (c.n >= MAX_SUBS) return json({ ok: false, error: "구독자가 너무 많아 잠시 받을 수 없습니다." }, 503);
      }
      await db.prepare(
        "INSERT INTO push_subs (id, endpoint, p256dh, auth, topics, created) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, topics = excluded.topics"
      ).bind(id, s.endpoint, k.p256dh, k.auth, "," + topics.join(",") + ",", Date.now()).run();
      // 지금 구독한 사람이 오늘 이미 나간 알림을 뒤늦게 받지 않도록, 남아 있는 알림은 '받은 것'으로 표시
      const open = (await db.prepare("SELECT id FROM push_msgs WHERE done = 0").all()).results || [];
      if (!exists && open.length) await db.batch(open.map(m => db.prepare("INSERT OR IGNORE INTO push_deliv (msg, sub, status) VALUES (?, ?, -1)").bind(m.id, id)));
      return json({ ok: true, topics });
    }

    if (action === "status" || action === "unsubscribe" || action === "test") {
      if (!req.endpoint) return json({ ok: false, error: "endpoint 없음" }, 400);
      const id = await subId(String(req.endpoint));
      const sub = await db.prepare("SELECT * FROM push_subs WHERE id = ?").bind(id).first();
      if (action === "status") return json({ ok: true, subscribed: !!sub, topics: sub ? sub.topics.split(",").filter(Boolean) : [] });
      if (action === "unsubscribe") {
        await db.prepare("DELETE FROM push_subs WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
      if (!sub) return json({ ok: false, error: "구독 정보가 없습니다." }, 404);
      if (Date.now() - (sub.last_test || 0) < 60000) return json({ ok: false, error: "잠시 후 다시 눌러주세요." }, 429);
      await db.prepare("UPDATE push_subs SET last_test = ? WHERE id = ?").bind(Date.now(), id).run();
      const st = await pushOne(await vapid(db), sub, {
        title: "세부인 알림이 켜졌어요 ✅",
        body: "새로 공개된 세종 실거래와 새 글을 이렇게 알려드릴게요.",
        url: "/alerts.html?from=push", tag: "test"
      }, { ttl: 600 });
      if (st === 404 || st === 410) await db.prepare("DELETE FROM push_subs WHERE id = ?").bind(id).run();
      return json({ ok: st >= 200 && st < 300, status: st });
    }

    if (action === "send") {
      const made = await collect(env, request, db);
      const r = await deliver(db, await vapid(db));
      return json({ ok: true, made, ...r });
    }

    return json({ ok: false, error: "알 수 없는 action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}
