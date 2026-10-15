// 정적 프리렌더 — 자바스크립트로만 채워지던 영역을 HTML에 미리 넣어
// 검색엔진·애드센스 심사 봇이 페이지를 열자마자 실제 내용을 보게 한다.
// 페이지 스크립트는 그대로 동작하며, 열리면 같은 내용으로 다시 그린다.
//
// 언제 다시 돌리나: complexes.json · transit.json · interest.json 갱신 후, 새 분석글 발행 후
// 자동 실행: .github/workflows/prerender.yml (main에 데이터·글이 올라올 때)
// 수동 실행: (jsdom이 없는 폴더라면) npm i --no-save jsdom@24  →  node tools/prerender.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(join(ROOT, f), "utf8");

function fill(src, key, html) {
  const re = new RegExp(`(<!--pre:${key}-->)[\\s\\S]*(<!--/pre:${key}-->)`);
  if (!re.test(src)) throw new Error(`marker not found: ${key}`);
  html = html.replace(/<!--\/?pre:[^>]*-->/g, "");
  return src.replace(re, (_, a, b) => a + html + b);
}

// ---- 단지 정보(/complex): 페이지 스크립트를 그대로 실행해 결과를 굳힌다 ----
async function complexPage() {
  const file = "complex.html";
  let src = read(file);
  const dom = new JSDOM(src, {
    url: "https://sebuin.com/complex",
    runScripts: "dangerously",
    beforeParse(w) {
      w.fetch = url => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(read(String(url).replace(/^\/|\?.*$/g, ""))))
      });
      w.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  const doc = dom.window.document;
  for (let i = 0; i < 50 && !doc.querySelector("#card .head"); i++) await new Promise(r => setTimeout(r, 20));
  if (!doc.querySelector("#card .head")) throw new Error("complex: render failed");
  for (const id of ["heroMeta", "rk-h", "rk-sub", "ranks", "dongs", "count", "list", "card"]) {
    src = fill(src, id, doc.getElementById(id).innerHTML);
  }
  const n = doc.querySelectorAll("#list .item").length;
  writeFileSync(join(ROOT, file), src);
  console.log("complex.html ✓", n, "단지");
}

// ---- 메인(/): 최신 분석 카드 6개 (index.html 하단 스크립트와 같은 규칙) ----
function homePage() {
  const file = "index.html";
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const tc = t => { t = String(t || ""); if (t.includes("실거래")) return "tg-brief"; if (t.includes("거래")) return "tg-trade"; if (t.includes("시세")) return "tg-price"; if (t.includes("정책") || t.includes("공급")) return "tg-policy"; return "tg-analysis"; };
  const posts = JSON.parse(read("blog/posts.json"))
    .filter(p => String(p && p.tag || "") !== "실거래 동향")
    .sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || ""))
    .slice(0, 6);
  const html = posts.map(p => '<a class="bt-card" href="./blog/' + encodeURIComponent(p.id) + '"><span class="bt-tag ' + tc(p.tag) + '">' + esc(p.tag || "분석") + "</span><h3>" + esc(p.title) + "</h3><p>" + esc((p.lede || "").slice(0, 70)) + '</p><div class="bt-date">' + esc(p.dateText || "") + "</div></a>").join("");
  writeFileSync(join(ROOT, file), fill(read(file), "btGrid", html));
  console.log("index.html ✓", posts.length, "개 글");
}

// ---- 분석글: 하단 '함께 읽으면 좋은 글' + 본문 용어 내부 링크 ----
// 다시 돌려도 같은 결과가 나오도록, 매번 이전에 넣은 것을 걷어내고 새로 넣는다.
const GLOSSARY = [   // [본문에서 찾을 말, 연결할 주소] — 글마다 대상별 첫 번째 한 곳만 링크
  [/J-PIR/, "./2026-06-10-ppn7m0.html"],
  [/(?<![A-Za-z-])PIR(?![A-Za-z])/, "./2026-06-10-ppn7m0.html"],
  [/전세가율/, "./2026-06-10-fghwa6.html"],
  [/매수 적기/, "./2026-06-10-fghwa6.html"],
  [/단지 정보/, "/complex"],
  [/관심도 순위|검색량 순위/, "./2026-10-13-e0ms50.html"],
  [/BRT/, "./2026-06-14-tl6vg1.html"],
];
const REL_CSS = `<style>.rel{margin:22px 0 0;background:#fff;border:1px solid #e4e8f0;border-radius:20px;padding:24px 26px}
.rel h2{font-size:17px;font-weight:800;margin:0 0 14px;color:#16203a}
.rel ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.rel a{display:block;text-decoration:none;border:1px solid #eef1f8;border-radius:14px;padding:13px 16px;background:#fafbfd;transition:.12s}
.rel a:hover{border-color:#c3cbe8;background:#f6f7ff}
.rel .rt{display:inline-block;font-size:11.5px;font-weight:700;color:#5b6cff;background:#eef0ff;border-radius:99px;padding:2px 9px;margin-bottom:6px}
.rel b{display:block;font-size:15px;color:#16203a;line-height:1.45}
.rel small{display:block;font-size:12.5px;color:#727e98;margin-top:4px}
.rel .all{display:inline-block;margin-top:14px;font-size:13px;font-weight:700;color:#5b6cff;text-decoration:none;border:none;padding:0;background:none}
a.autolink{color:#4b56d8;text-decoration:underline;text-decoration-color:#c9cff8;text-underline-offset:3px}
@media(max-width:600px){.rel{padding:20px 18px}}</style>`;

function blogPosts() {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const posts = JSON.parse(read("blog/posts.json")).filter(p => String(p.tag || "") !== "실거래 동향");
  const plain = p => [p.title, p.title, p.lede, p.summary, String(p.body || "").slice(0, 1500)].join(" ").replace(/!\[[^\]]*\]\([^)]*\)|[#*_~\[\]()]/g, " ");
  const grams = s => { const g = new Set(); const t = s.replace(/[^가-힣A-Za-z0-9]+/g, " "); for (const w of t.split(" ")) for (let i = 0; i + 1 < w.length; i++) g.add(w.slice(i, i + 2)); return g; };
  const G = new Map(posts.map(p => [p.id, grams(plain(p))]));
  const sim = (a, b) => { const A = G.get(a.id), B = G.get(b.id); let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.sqrt(A.size * B.size || 1) + (a.tag === b.tag ? 0.05 : 0); };
  let touched = 0;
  for (const p of posts) {
    const path = "blog/" + p.id;
    let src; try { src = read(path); } catch { continue; }
    // 1) 이전에 넣은 것 걷어내기
    src = src.replace(/\n[ \t]*<!--auto:related-->[\s\S]*?<!--\/auto:related-->/g, "")
             .replace(/<a class="autolink" href="[^"]*">([\s\S]*?)<\/a>/g, "$1");
    // 2) 본문 용어 링크 — 일반 문단·목록의 글자 부분에만, 자기 글로 가는 링크는 넣지 않음
    const used = new Set();
    src = src.replace(/(<article>)([\s\S]*?)(<\/article>)/, (_, a, body, z) => a + body.replace(/<(p|li)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (m, tag, attr = "", inner) => {
      if (/class="a-(source|cap)"/.test(attr) || /<a[\s>]/.test(inner)) return m;
      const parts = inner.split(/(<[^>]+>)/);
      for (const [re, href] of GLOSSARY) {
        if (used.has(href) || href === "./" + p.id) continue;
        for (let i = 0; i < parts.length; i += 2) {
          const mm = parts[i].match(re); if (!mm) continue;
          parts[i] = parts[i].slice(0, mm.index) + `<a class="autolink" href="${href}">${mm[0]}</a>` + parts[i].slice(mm.index + mm[0].length);
          used.add(href); break;
        }
      }
      return `<${tag}${attr}>${parts.join("")}</${tag}>`;
    }) + z);
    // 3) 함께 읽으면 좋은 글 3개
    const rel = posts.filter(q => q.id !== p.id).map(q => [q, sim(p, q)]).sort((x, y) => y[1] - x[1] || (y[0].dateISO || "").localeCompare(x[0].dateISO || "")).slice(0, 3).map(x => x[0]);
    const block = `<!--auto:related--><section class="rel" aria-labelledby="rel-h">${REL_CSS}<h2 id="rel-h">함께 읽으면 좋은 글</h2><ul>` +
      rel.map(q => `<li><a href="./${encodeURIComponent(q.id)}"><span class="rt">${esc(q.tag || "분석")}</span><b>${esc(q.title)}</b><small>${esc(q.dateText || "")}</small></a></li>`).join("") +
      `</ul><a class="all" href="./">분석 글 전체 보기 →</a></section><!--/auto:related-->`;
    if (!src.includes("</article>")) continue;
    src = src.replace("</article>", "</article>\n  " + block);
    writeFileSync(join(ROOT, path), src); touched++;
  }
  console.log("blog ✓", touched, "개 글에 관련 글·내부 링크");
}

await complexPage();
homePage();
blogPosts();
process.exit(0);
