// 정적 프리렌더 — 자바스크립트로만 채워지던 영역을 HTML에 미리 넣어
// 검색엔진·애드센스 심사 봇이 페이지를 열자마자 실제 내용을 보게 한다.
// 페이지 스크립트는 그대로 동작하며, 열리면 같은 내용으로 다시 그린다.
//
// 언제 다시 돌리나: complexes.json · transit.json · interest.json 갱신 후, 새 분석글 발행 후
// 실행: (jsdom이 없는 폴더라면) npm i --no-save jsdom@24  →  node tools/prerender.mjs
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

await complexPage();
homePage();
process.exit(0);
