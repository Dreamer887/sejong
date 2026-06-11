// 세종 부동산 인사이트 — 블로그 글 발행 함수 (Netlify Function)
// /admin 글쓰기 페이지에서 호출. 패스코드 확인 후 GitHub에 글 파일 생성 + 목록 갱신.
// 필요한 환경변수: GITHUB_TOKEN, BLOG_PASSCODE
// 선택 환경변수: GH_OWNER(기본 Dreamer887), GH_REPO(기본 sejong), GH_BRANCH(기본 main), SITE_BASE

const GH_OWNER = process.env.GH_OWNER || "Dreamer887";
const GH_REPO  = process.env.GH_REPO  || "sejong";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const SITE_BASE = (process.env.SITE_BASE || "https://subtle-truffle-16dbff.netlify.app").replace(/\/$/, "");
const API = "https://api.github.com";

function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// 본문 텍스트 → HTML (빈 줄로 문단 구분, "## " 소제목, "### " 소소제목, "- " 목록)
function bodyToHtml(text){
  const blocks = String(text||"").replace(/\r/g,"").split(/\n{2,}/);
  const out = [];
  for(const raw of blocks){
    const block = raw.trim();
    if(!block) continue;
    const lines = block.split("\n");
    if(block.startsWith("## ")){
      out.push(`<h2>${esc(block.slice(3).trim())}</h2>`);
    } else if(block.startsWith("### ")){
      out.push(`<h3>${esc(block.slice(4).trim())}</h3>`);
    } else if(lines.every(l=>l.trim().startsWith("- "))){
      out.push("<ul>"+lines.map(l=>`<li>${esc(l.trim().slice(2).trim())}</li>`).join("")+"</ul>");
    } else {
      out.push(`<p>${lines.map(l=>esc(l.trim())).join("<br>")}</p>`);
    }
  }
  return out.join("\n    ");
}

function tagClass(tag){
  const t = String(tag||"");
  if(t.includes("시세")) return "t-price";
  if(t.includes("정책")||t.includes("공급")) return "t-policy";
  return "t-trade";
}

function buildPostHtml(f){
  const url = `${SITE_BASE}/blog/${f.filename}`;
  const lede = f.lede ? `<p class="a-lede">${esc(f.lede)}</p>` : "";
  const summary = f.summary ? `<div class="a-summary"><b>한 줄 요약</b><br>${esc(f.summary)}</div>` : "";
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(f.title)} | 세종 부동산 인사이트</title>
<meta name="description" content="${esc(f.lede || f.title)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(f.title)}">
<meta property="og:description" content="${esc(f.lede || f.title)}">
<meta property="og:url" content="${url}">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":${JSON.stringify(f.title)},"datePublished":"${f.dateISO}","author":{"@type":"Person","name":"투자되지"},"publisher":{"@type":"Organization","name":"세종 부동산 인사이트"}}
</script>
<style>
  :root{--bg:#f4f6fa;--card:#fff;--ink:#16203a;--sub:#727e98;--indigo:#5b6cff;--violet:#a06bff;--line:#e4e8f0}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:var(--bg);color:var(--ink);line-height:1.7}
  .wrap{max-width:760px;margin:0 auto;padding:0 20px 60px;position:relative}
  a{color:inherit}
  .topnav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(243,245,251,.82);backdrop-filter:blur(12px);padding:14px 2px 12px;margin-bottom:6px}
  .topnav .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;text-decoration:none;color:var(--ink)}
  .topnav .brand i{color:#fff;background:linear-gradient(140deg,#5b6cff,#a06bff);width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:19px;font-style:normal}
  .topnav .navlinks{display:flex;background:#e7eaf5;border-radius:99px;padding:4px;gap:3px}
  .topnav .navlinks a{border-radius:99px;padding:8px 15px;font-size:13px;color:#727e98;font-weight:700;text-decoration:none}
  .topnav .navlinks a.on{background:#fff;color:#5b6cff;box-shadow:0 8px 22px -12px rgba(40,55,110,.55)}
  .ad-slot{margin:24px auto;min-height:90px;display:flex;align-items:center;justify-content:center;background:#fff;border:1.5px dashed #dde2ef;border-radius:20px}
  .ad-slot .adlabel{font-size:11px;color:#aab2c5;font-weight:600;letter-spacing:.08em}
  article{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:38px 40px}
  @media(max-width:600px){article{padding:28px 22px}}
  .a-tag{display:inline-block;font-size:12px;font-weight:700;padding:3px 11px;border-radius:99px;background:#eef0ff;color:var(--indigo)}
  article h1{font-size:28px;font-weight:800;letter-spacing:-.5px;line-height:1.35;margin:14px 0 10px}
  .a-meta{color:#aab2c5;font-size:13px;font-weight:600;margin-bottom:8px}
  .a-lede{font-size:16px;color:#46506a;margin:18px 0 26px;line-height:1.75}
  article h2{font-size:20px;font-weight:800;letter-spacing:-.3px;margin:34px 0 12px;padding-left:12px;border-left:5px solid var(--indigo)}
  article h3{font-size:16px;font-weight:700;margin:22px 0 8px}
  article p{font-size:15.5px;color:#2b3550;margin:12px 0}
  article ul{margin:12px 0 12px 22px;color:#2b3550;font-size:15.5px}
  article li{margin:6px 0}
  .a-summary{background:#f6f7ff;border:1px solid #e3e6ff;border-left:5px solid var(--indigo);border-radius:14px;padding:20px 22px;margin:28px 0}
  .a-summary b{color:var(--indigo)}
  .a-source{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--sub)}
  footer{margin-top:40px;color:#aab2c5;font-size:13px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <nav class="topnav">
    <a class="brand" href="../index.html"><i>🏙</i> 세종 부동산 인사이트</a>
    <div class="navlinks"><a href="../index.html">대시보드</a><a href="./index.html" class="on">분석</a></div>
  </nav>
  <article>
    <span class="a-tag">${esc(f.tag)}</span>
    <h1>${esc(f.title)}</h1>
    <div class="a-meta">${esc(f.dateText)} · 작성: 투자되지</div>
    ${lede}
    <div class="ad-slot"><span class="adlabel">광고 영역 · Google AdSense</span></div>
    ${bodyToHtml(f.body)}
    ${summary}
    <p class="a-source">데이터 출처: 국토교통부 실거래가 공개시스템(rt.molit.go.kr), KB부동산 시세. 본 글은 공개 데이터를 바탕으로 한 작성자의 해석이며 투자 권유가 아닙니다.</p>
  </article>
  <div class="ad-slot"><span class="adlabel">광고 영역 · Google AdSense</span></div>
  <footer>작성: 투자되지 · 데이터 출처: 국토교통부 실거래가</footer>
</div>
</body>
</html>
`;
}

function buildCard(f){
  const excerpt = (f.lede || "").slice(0, 95);
  return `<a class="postcard" href="./${f.filename}">
      <span class="tag">${esc(f.tag)}</span>
      <h2>${esc(f.title)}</h2>
      <p class="excerpt">${esc(excerpt)}</p>
      <span class="meta">${esc(f.dateText)} · ${esc(f.tag)}</span>
    </a>`;
}

async function gh(path, opts={}){
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "sejong-blog-cms",
      ...(opts.headers||{})
    }
  });
  const text = await r.text();
  let json; try{ json = text ? JSON.parse(text) : {}; }catch(e){ json = {raw:text}; }
  if(!r.ok) throw new Error(`GitHub ${path} ${r.status}: ${json.message || text}`);
  return json;
}

function putFile(path, contentStr, message, sha){
  const body = {
    message,
    content: Buffer.from(contentStr, "utf-8").toString("base64"),
    branch: GH_BRANCH
  };
  if(sha) body.sha = sha;
  return gh(`/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,"/")}`, {
    method: "PUT", body: JSON.stringify(body)
  });
}

exports.handler = async (event) => {
  const headers = {"Content-Type":"application/json"};
  try{
    if(event.httpMethod !== "POST") return {statusCode:405, headers, body:JSON.stringify({error:"POST only"})};
    if(!process.env.GITHUB_TOKEN || !process.env.BLOG_PASSCODE)
      return {statusCode:500, headers, body:JSON.stringify({error:"서버 환경변수(GITHUB_TOKEN/BLOG_PASSCODE)가 설정되지 않았습니다."})};

    const f = JSON.parse(event.body||"{}");
    if(f.passcode !== process.env.BLOG_PASSCODE)
      return {statusCode:401, headers, body:JSON.stringify({error:"패스코드가 올바르지 않습니다."})};
    if(!f.title || !f.body)
      return {statusCode:400, headers, body:JSON.stringify({error:"제목과 본문은 필수입니다."})};

    // 날짜 기본값(KST)
    const now = new Date(Date.now() + 9*3600*1000);
    f.dateISO = f.dateISO || now.toISOString().slice(0,10);
    f.dateText = f.dateText || `${now.getUTCFullYear()}. ${now.getUTCMonth()+1}. ${now.getUTCDate()}.`;
    f.tag = f.tag || "분석";

    // 파일명: 날짜 + 랜덤
    const rand = Math.random().toString(36).slice(2,8);
    f.filename = `${f.dateISO}-${rand}.html`;

    // 1) 글 파일 생성
    await putFile(`blog/${f.filename}`, buildPostHtml(f), `post: ${f.title}`);

    // 2) 목록 페이지에 카드 삽입
    const idx = await gh(`/repos/${GH_OWNER}/${GH_REPO}/contents/blog/index.html?ref=${GH_BRANCH}`);
    const idxHtml = Buffer.from(idx.content, "base64").toString("utf-8");
    const anchor = "<!--NEW_POST_ANCHOR-->";
    if(!idxHtml.includes(anchor)) throw new Error("blog/index.html 에 삽입 지점(NEW_POST_ANCHOR)이 없습니다.");
    const newIdx = idxHtml.replace(anchor, anchor + "\n    " + buildCard(f));
    await putFile("blog/index.html", newIdx, `list: ${f.title}`, idx.sha);

    return {statusCode:200, headers, body:JSON.stringify({ok:true, url:`${SITE_BASE}/blog/${f.filename}`, filename:f.filename})};
  }catch(err){
    return {statusCode:500, headers, body:JSON.stringify({error:String(err.message||err)})};
  }
};
