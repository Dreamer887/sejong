// Cloudflare Pages Function — 방문자 수 (URL: /api/visit)
// 오늘 방문자: 같은 날(한국 시간) 같은 IP는 1명으로 셈 · 전체 방문자: 날마다 센 방문자의 누적
// D1 바인딩 이름: VISITS_DB · IP는 저장하지 않고 날짜별 해시만 저장
const SCHEMA = "CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (day, v))";
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|axios|httpclient/i;
let ready = false;

function kstDay() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
async function hash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 16).map(x => x.toString(16).padStart(2, "0")).join("");
}
function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function setup(db) {
  if (!ready) { await db.prepare(SCHEMA).run(); ready = true; }
}
async function counts(db, day) {
  const r = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM visits WHERE day = ?").bind(day),
    db.prepare("SELECT COUNT(*) AS n FROM visits")
  ]);
  const out = { ok: true, day: day, today: r[0].results[0].n, total: r[1].results[0].n };
  // 휴대폰 알림 구독자 수 (push.js가 만드는 표 — 아직 없으면 0)
  try {
    const p = await db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM push_subs"),
      db.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE topics LIKE '%,trade,%'"),
      db.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE topics LIKE '%,analysis,%'"),
      db.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE topics LIKE '%,matjip,%'")
    ]);
    out.push = { total: p[0].results[0].n, trade: p[1].results[0].n, analysis: p[2].results[0].n, matjip: p[3].results[0].n };
  } catch (e) { out.push = { total: 0, trade: 0, analysis: 0, matjip: 0 }; }
  return out;
}

export async function onRequestGet({ env }) {
  const db = env.VISITS_DB;
  if (!db) return json({ ok: false }, 503);
  try { await setup(db); return json(await counts(db, kstDay())); }
  catch (e) { return json({ ok: false }, 500); }
}

export async function onRequestPost({ request, env }) {
  const db = env.VISITS_DB;
  if (!db) return json({ ok: false }, 503);
  try {
    await setup(db);
    const day = kstDay();
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";
    if (ip && !BOT.test(ua)) {
      const v = await hash(day + "|" + ip + "|" + (env.VISIT_SALT || "sebuin"));
      await db.prepare("INSERT OR IGNORE INTO visits (day, v) VALUES (?, ?)").bind(day, v).run();
    }
    return json(await counts(db, day));
  } catch (e) { return json({ ok: false }, 500); }
}
