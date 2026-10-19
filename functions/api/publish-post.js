// Cloudflare Pages Function — 블로그 글 관리 (create/update/delete/list)
// URL: /api/publish-post · 환경변수: GITHUB_TOKEN, BLOG_PASSCODE (선택: GH_OWNER, GH_REPO, GH_BRANCH, SITE_BASE)
const API = "https://api.github.com";

function cfg(env){
  return {
    OWNER: env.GH_OWNER || "Dreamer887",
    REPO:  env.GH_REPO  || "sejong",
    BRANCH: env.GH_BRANCH || "main",
    BASE: (env.SITE_BASE || "https://sebuin.com").replace(/\/$/, ""),
    TOKEN: env.GITHUB_TOKEN,
    PASS: env.BLOG_PASSCODE
  };
}
function b64enc(str){
  const bytes = new TextEncoder().encode(str);
  let bin=""; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64dec(b64){
  const bin = atob(String(b64).replace(/\s/g,""));
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function validId(id){ return typeof id==="string" && /^\d{4}-\d{2}-\d{2}-[a-z0-9]{6}\.html$/.test(id); }
function isFood(f){ return String(f&&f.tag||"")==="맛집"; }
function cleanPlace(pl){
  if(!pl||typeof pl!=="object") return undefined;
  const lat=Number(pl.lat), lng=Number(pl.lng);
  const dong=String(pl.dong||"").trim().match(/^[가-힣0-9]{1,10}(동|읍|면)$/);
  const o={ name:String(pl.name||"").slice(0,100).trim(), address:String(pl.address||"").slice(0,200).trim(), dong: dong?dong[0]:"",
    lat: isFinite(lat)&&lat>30&&lat<45 ? lat : null, lng: isFinite(lng)&&lng>120&&lng<135 ? lng : null };
  return (o.name||o.address||o.lat!=null) ? o : undefined;
}
function cleanImgs(a){ return Array.isArray(a) ? a.map(String).filter(function(u){ return /^\/img\/images\/[A-Za-z0-9._-]+$/.test(u); }).slice(0,4) : []; }
function tagCls(t){ t=String(t||""); if(t==="맛집") return "tg-food"; if(t.indexOf("실거래")>=0) return "tg-brief"; if(t.indexOf("거래")>=0) return "tg-trade"; if(t.indexOf("시세")>=0) return "tg-price"; if(t.indexOf("정책")>=0||t.indexOf("공급")>=0) return "tg-policy"; return "tg-analysis"; }
function inline(t){
  return t
    .replace(/\+\+(.+?)\+\+/g,'<span class="big">$1</span>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/__(.+?)__/g,'<u>$1</u>');
}
function richLines(text){
  return String(text||"").replace(/\r/g,"").split("\n").map(function(l){var t=l.trim();return t===""?'<div class="a-gap"></div>':"<p>"+inline(esc(t))+"</p>";}).join("");
}
function bodyToHtml(text){
  const lines = String(text||"").replace(/\r/g,"").split("\n");
  const out=[]; let buf=[]; let center=false; let lastH="";
  function add(el){ out.push(center ? '<div class="a-center">'+el+'</div>' : el); }
  function flush(){ if(buf.length){ add("<ul>"+buf.map(function(x){return "<li>"+inline(esc(x))+"</li>";}).join("")+"</ul>"); buf=[]; } }
  for(const raw of lines){
    const line=raw.trim();
    if(line==="[[가운데]]"){ flush(); center=true; continue; }
    if(line==="[[/가운데]]"){ flush(); center=false; continue; }
    if(line.startsWith("- ")){ buf.push(line.slice(2).trim()); continue; }
    flush();
    if(line===""){ out.push('<div class="a-gap"></div>'); continue; }
    if(line==="---"||line==="***"){ add('<hr class="a-hr">'); continue; }
    const im=line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if(im){ const cap=im[1].trim(); const alt=cap||(lastH?lastH+" 관련 자료":"세부인 분석 자료"); add('<figure class="a-fig"><img src="'+esc(im[2].trim())+'" alt="'+esc(alt)+'">'+(cap?'<figcaption>'+inline(esc(cap))+'</figcaption>':'')+'</figure>'); continue; }
    if(line.startsWith("## ")){ lastH=line.slice(3).trim().replace(/\*\*|__|~~/g,""); add("<h2>"+inline(esc(line.slice(3).trim()))+"</h2>"); continue; }
    if(line.startsWith("### ")){ add("<h3>"+inline(esc(line.slice(4).trim()))+"</h3>"); continue; }
    if(line.startsWith("# ")){ add('<p class="big">'+inline(esc(line.slice(2).trim()))+'</p>'); continue; }
    add("<p>"+inline(esc(line))+"</p>");
  }
  flush();
  return out.join("\n");
}
function buildPostHtml(f, BASE){
  const url = BASE+"/blog/"+f.id;
  const lede = f.lede ? '<div class="a-lede"><div class="a-cap">들어가며</div>'+richLines(f.lede)+'</div>' : "";
  const summary = f.summary ? '<div class="a-summary"><b>한 줄 요약</b>'+richLines(f.summary)+'</div>' : "";
  const food = isFood(f);
  const pl = food ? f.place : null;
  const placeBox = (pl && (pl.name || pl.address)) ? '<div class="a-place"><b>📍 '+esc(pl.name||"가게 위치")+'</b>'+(pl.address?'<span>'+esc(pl.address)+'</span>':'')+'<a href="https://map.naver.com/p/search/'+encodeURIComponent((pl.name||pl.address))+'" target="_blank" rel="noopener">네이버 지도에서 보기 →</a></div>' : "";
  const listHref = food ? "../matjip/" : "./index.html";
  const listText = food ? "← 맛집 목록으로" : "← 분석 목록으로";
  const source = food
    ? '<p class="a-source">직접 방문해서 쓴 후기예요. 영업시간·메뉴·가격은 바뀔 수 있으니 방문 전에 한 번 더 확인하세요.</p>'
    : '<p class="a-source">데이터 출처: 국토교통부 실거래가 공개시스템(rt.molit.go.kr). 본 글은 공개 데이터를 바탕으로 한 작성자의 해석이며 투자 권유가 아닙니다.</p>';
  const footSrc = food ? "작성: 투자되지 · 세종 동네 맛집 후기" : "작성: 투자되지 · 데이터 출처: 국토교통부 실거래가 공개시스템(rt.molit.go.kr)";
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2234856624819574" crossorigin="anonymous"></script>
<title>${esc(f.title)} | 세종 부동산 인사이트</title>
<meta name="description" content="${esc(f.lede || f.title)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(f.title)}">
<meta property="og:description" content="${esc(f.lede || f.title)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://sebuin.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
${JSON.stringify({"@context":"https://schema.org","@type":"Article",headline:f.title,datePublished:f.dateISO,author:{"@type":"Person",name:"투자되지"},publisher:{"@type":"Organization",name:"세종 부동산 인사이트"}}).replace(/</g,"\\u003c")}
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
  /* 애드센스 승인 전: 빈 광고 자리 숨김 — 승인 후 이 줄 삭제 */
  .ad-slot{display:none!important}
  article{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:38px 40px}
  @media(max-width:600px){article{padding:28px 22px}}
  .a-tag{display:inline-block;font-size:12px;font-weight:700;padding:3px 11px;border-radius:99px;background:#eef0ff;color:var(--indigo)}
  .a-tag.tg-analysis{color:#5b6cff;background:#eef0ff}.a-tag.tg-trade{color:#0f6e56;background:#e1f5ee}.a-tag.tg-price{color:#92510b;background:#faeeda}.a-tag.tg-policy{color:#993556;background:#fbeaf0}.a-tag.tg-brief{color:#0b6b8f;background:#e0f2f9}.a-tag.tg-food{color:#b4441f;background:#fdeee6}
  article h1{font-size:28px;font-weight:800;letter-spacing:-.5px;line-height:1.35;margin:14px 0 10px}
  .a-meta{color:#aab2c5;font-size:13px;font-weight:600;margin-bottom:8px}
  .a-lede{background:#f6f7ff;border:1px solid #e3e6ff;border-left:5px solid var(--indigo);border-radius:14px;padding:18px 22px;margin:18px 0 26px}
  .a-lede .a-cap{font-size:12.5px;font-weight:800;color:var(--indigo);margin-bottom:6px}
  .a-lede p{font-size:15.5px;color:#2b3550;line-height:1.75;margin:0 0 8px}
  .a-lede p:last-child{margin-bottom:0}
  article h2{font-size:20px;font-weight:800;letter-spacing:-.3px;margin:34px 0 12px;padding-left:12px;border-left:5px solid var(--indigo)}
  article h3{font-size:16px;font-weight:700;margin:22px 0 8px}
  article p{font-size:15.5px;color:#2b3550;margin:12px 0}
  article ul{margin:12px 0 12px 22px;color:#2b3550;font-size:15.5px}
  article li{margin:6px 0}
  article strong{font-weight:800}
  .big{font-size:1.2em}
  .a-gap{height:0.7em}
  .a-center{text-align:center}
  hr.a-hr{border:none;border-top:1px solid var(--line);margin:26px 0}
  article img{max-width:100%;height:auto;display:block;border-radius:12px}
  .a-fig{margin:22px 0;text-align:center}
  .a-fig img{border:1px solid var(--line);margin:0 auto}
  .a-fig figcaption{font-size:12.5px;color:var(--sub);margin-top:8px;text-align:center}
  .a-summary{background:#f6f7ff;border:1px solid #e3e6ff;border-left:5px solid var(--indigo);border-radius:14px;padding:20px 22px;margin:28px 0}
  .a-summary b{color:var(--indigo)}
  .a-summary p{font-size:15.5px;color:#2b3550;margin:8px 0 0}
  .a-place{display:flex;flex-direction:column;gap:4px;background:#fff8f3;border:1px solid #f6dccb;border-radius:14px;padding:16px 20px;margin:24px 0 0}
  .a-place b{font-size:15px;color:#16203a}.a-place span{font-size:14px;color:#2b3550}.a-place a{font-size:13px;font-weight:700;color:#b4441f;text-decoration:none;margin-top:4px}
  .topnav .navlinks a{white-space:nowrap}
  @media(max-width:600px){.topnav{flex-wrap:wrap}.topnav .navlinks{margin-left:auto}.topnav .navlinks a{padding:7px 12px}}
  .a-source{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--sub)}
  .backlink{display:inline-block;margin:0 0 10px;font-size:13px;font-weight:700;color:var(--indigo);text-decoration:none}
  .backlink:hover{text-decoration:underline}
  footer{margin-top:40px;color:#aab2c5;font-size:13px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <nav class="topnav">
    <a class="brand" href="../index.html"><svg width="48" height="48" viewBox="0 0 48 48" style="flex:none" aria-hidden="true"><defs><linearGradient id="blg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b6cff"/><stop offset="1" stop-color="#a06bff"/></linearGradient></defs><rect width="48" height="48" rx="13" fill="url(#blg)"/><rect x="9" y="13" width="13" height="25" rx="1.6" fill="#fff"/><rect x="11.4" y="16.5" width="2.3" height="2.3" rx=".4" fill="url(#blg)"/><rect x="16.3" y="16.5" width="2.3" height="2.3" rx=".4" fill="url(#blg)"/><rect x="11.4" y="21" width="2.3" height="2.3" rx=".4" fill="url(#blg)"/><rect x="16.3" y="21" width="2.3" height="2.3" rx=".4" fill="url(#blg)"/><rect x="11.4" y="25.5" width="2.3" height="2.3" rx=".4" fill="url(#blg)"/><rect x="16.3" y="25.5" width="2.3" height="2.3" rx=".4" fill="url(#blg)"/><circle cx="31" cy="27" r="7" fill="url(#blg)" stroke="#fff" stroke-width="2.6"/><line x1="36" y1="32" x2="40.5" y2="36.5" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg><span style="display:inline-block;line-height:1"><span style="display:block;font-family:'Jua','Apple SD Gothic Neo',sans-serif;font-size:36px;letter-spacing:-1px;background:linear-gradient(120deg,#4b46c4,#9a6bf2);-webkit-background-clip:text;background-clip:text;color:transparent">세부인</span><span style="display:block;font-size:10px;font-weight:600;color:#727e98;margin-top:4px;text-align:justify;text-align-last:justify">세종 부동산 인사이트</span></span></a>
    <div class="navlinks"><a href="../index.html">대시보드</a><a href="./index.html"${food?"":' class="on"'}>분석</a><a href="../matjip/"${food?' class="on"':""}>맛집</a></div>
  </nav>
  <a class="backlink" href="${listHref}">${listText}</a>
  <article>
    <span class="a-tag ${tagCls(f.tag)}">${esc(f.tag)}</span>
    <h1>${esc(f.title)}</h1>
    <div class="a-meta">${esc(f.dateText)} · 작성: 투자되지</div>
    ${lede}
    <div class="ad-slot"><span class="adlabel">광고 영역 · Google AdSense</span></div>
    ${bodyToHtml(f.body)}
    ${summary}
    ${placeBox}
    ${source}
  </article>
  <div class="ad-slot"><span class="adlabel">광고 영역 · Google AdSense</span></div>
  <a class="backlink" href="${listHref}">${listText}</a>
  <footer>${footSrc}<br><a href="../privacy.html" style="color:#aab2c5;text-decoration:none;font-weight:600">개인정보처리방침</a> · <a href="../terms.html" style="color:#aab2c5;text-decoration:none;font-weight:600">이용약관</a> · <a href="../about.html" style="color:#aab2c5;text-decoration:none;font-weight:600">소개</a> · <a href="../contact.html" style="color:#aab2c5;text-decoration:none;font-weight:600">문의</a><br><span style="display:inline-block;margin-top:12px;line-height:1.6">세부인이 제공하는 정보는 무단 복제·배포·전송 등 이용할 수 없으며, 이를 무단 이용하는 경우 저작권법 등에 따라 법적 책임을 질 수 있습니다.</span><br><strong style="display:inline-block;margin-top:6px;color:#aab2c5">Copyright © 2026. 세부인(세종 부동산 인사이트) All Rights Reserved.</strong></footer>
</div>
</body>
</html>
`;
}
function renderCards(posts, food){
  posts = posts.filter(function(p){ return food ? isFood(p) : !isFood(p); });
  const sorted = posts.slice().sort(function(a,b){return (b.dateISO||"").localeCompare(a.dateISO||"") || (b.id||"").localeCompare(a.id||"");});
  if(!sorted.length) return "\n    <p style=\"color:#aab2c5;font-size:14px;grid-column:1/-1\">"+(food?"아직 올라온 맛집 후기가 없습니다.":"아직 발행된 글이 없습니다.")+"</p>\n  ";
  const pre = food ? "../blog/" : "./";
  return "\n" + sorted.map(function(f){
    const th = food ? cleanImgs(f.thumbs) : [];
    const img = th.length ? '\n      <div class="pc-img n'+(th.length>=4?4:1)+'">'+(th.length>=4?th:th.slice(0,1)).map(function(u){return '<img src="'+esc(u)+'" alt="" loading="lazy">';}).join("")+'</div><div class="pc-body">' : "";
    return '    <a class="postcard'+(th.length?' hasimg':'')+'" data-id="'+esc(f.id)+'" href="'+pre+esc(f.id)+'">'+img+'\n      <span class="tag '+tagCls(f.tag)+'">'+esc(f.tag)+'</span>\n      <h2>'+esc(f.title)+'</h2>\n      '+(food&&f.place&&f.place.address?'<p class="pcplace">📍 '+esc(f.place.name||"")+' · '+esc(f.place.dong||shortAddr(f.place.address))+'</p>\n      ':'')+'<p class="excerpt">'+esc((f.lede||"").slice(0,95))+'</p>\n      <span class="meta">'+esc(f.dateText)+' · '+esc(f.tag)+'</span>'+(th.length?'</div>':'')+'\n    </a>';}).join("\n") + "\n  ";
}
function shortAddr(a){ const m=String(a||"").match(/세종[^\s]*\s+(.+?)(\s+\d|$)/); return m?m[1]:String(a||""); }
async function gh(C, path, opts){
  opts=opts||{};
  const r=await fetch(API+path, Object.assign({}, opts, {headers: Object.assign({
    "Authorization":"Bearer "+C.TOKEN,"Accept":"application/vnd.github+json","User-Agent":"sejong-blog-cms"
  }, opts.headers||{})}));
  const text=await r.text();
  let json; try{ json=text?JSON.parse(text):{}; }catch(e){ json={raw:text}; }
  return {ok:r.ok,status:r.status,json,text};
}
async function getContent(C, path){
  const r=await gh(C, "/repos/"+C.OWNER+"/"+C.REPO+"/contents/"+path+"?ref="+C.BRANCH);
  if(r.status===404) return null;
  if(!r.ok) throw new Error("GET "+path+" "+r.status+": "+(r.json.message||r.text));
  return {sha:r.json.sha, content:b64dec(r.json.content)};
}
async function putFile(C, path, str, message, sha){
  async function attempt(useSha){
    const body={message, content:b64enc(str), branch:C.BRANCH};
    if(useSha) body.sha=useSha;
    return await gh(C, "/repos/"+C.OWNER+"/"+C.REPO+"/contents/"+path, {method:"PUT", body:JSON.stringify(body)});
  }
  let r=await attempt(sha);
  if(!r.ok && (r.status===409 || r.status===422)){   // sha 충돌 → 최신 sha 다시 읽어 1회 재시도
    const cur=await getContent(C, path);
    r=await attempt(cur?cur.sha:undefined);
  }
  if(!r.ok) throw new Error("PUT "+path+" "+r.status+": "+(r.json.message||r.text));
  return r.json;
}
async function deleteFile(C, path, message, sha){
  const r=await gh(C, "/repos/"+C.OWNER+"/"+C.REPO+"/contents/"+path, {method:"DELETE", body:JSON.stringify({message, sha, branch:C.BRANCH})});
  if(!r.ok) throw new Error("DELETE "+path+" "+r.status+": "+(r.json.message||r.text));
  return r.json;
}
async function readPosts(C){
  const c=await getContent(C, "blog/posts.json");
  if(!c) return {posts:[], sha:null};
  let posts; try{ posts=JSON.parse(c.content); }catch(e){ posts=[]; }
  if(!Array.isArray(posts)) posts=[];
  return {posts, sha:c.sha};
}
function buildSitemap(posts, BASE){
  const sorted = posts.slice().sort(function(a,b){return (b.dateISO||"").localeCompare(a.dateISO||"");});
  const today = new Date(Date.now()+9*3600*1000).toISOString().slice(0,10);
  const newest = (sorted[0] && sorted[0].dateISO) || today;
  const urls = [];
  urls.push({loc:BASE+"/", lastmod: today});
  urls.push({loc:BASE+"/blog/", lastmod: newest});
  const fnew = (sorted.filter(isFood)[0]||{}).dateISO || newest;
  urls.push({loc:BASE+"/matjip/", lastmod: fnew});
  urls.push({loc:BASE+"/complex", lastmod: today});
  urls.push({loc:BASE+"/bus-reach", lastmod: "2026-10-19"});
  urls.push({loc:BASE+"/about.html", lastmod: "2026-10-19"});
  sorted.forEach(function(f){ urls.push({loc:BASE+"/blog/"+f.id, lastmod: f.dateISO||today}); });
  const body = urls.map(function(u){
    return "  <url>\n    <loc>"+esc(u.loc)+"</loc>\n    <lastmod>"+esc(u.lastmod)+"</lastmod>\n  </url>";
  }).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+body+'\n</urlset>\n';
}
async function writeSitemap(C, posts){
  const xml = buildSitemap(posts, C.BASE);
  const existing = await getContent(C, "sitemap.xml");
  await putFile(C, "sitemap.xml", xml, "seo: sitemap.xml 갱신", existing?existing.sha:undefined);
}
async function writePostsAndIndex(C, posts, postsSha){
  await putFile(C, "blog/posts.json", JSON.stringify(posts,null,2), "data: posts.json 갱신", postsSha);
  const idx=await getContent(C, "blog/index.html");
  if(idx){
    const re=/<!--POSTS_START-->[\s\S]*?<!--POSTS_END-->/;
    if(re.test(idx.content)){
      const newIdx=idx.content.replace(re, "<!--POSTS_START-->"+renderCards(posts,false)+"<!--POSTS_END-->");
      if(newIdx!==idx.content) await putFile(C, "blog/index.html", newIdx, "list: 목록 갱신", idx.sha);
    }
  }
  const fidx=await getContent(C, "matjip/index.html");
  if(fidx){
    const re2=/<!--POSTS_START-->[\s\S]*?<!--POSTS_END-->/;
    if(re2.test(fidx.content)){
      const nf=fidx.content.replace(re2, "<!--POSTS_START-->"+renderCards(posts,true)+"<!--POSTS_END-->");
      if(nf!==fidx.content) await putFile(C, "matjip/index.html", nf, "list: 맛집 목록 갱신", fidx.sha);
    }
  }
  await writeSitemap(C, posts);
}
function json(obj, status){ return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json"}}); }

export async function onRequestPost(context){
  const C=cfg(context.env);
  try{
    if(!C.TOKEN || !C.PASS) return json({error:"서버 환경변수(GITHUB_TOKEN/BLOG_PASSCODE)가 설정되지 않았습니다."}, 500);
    const f=await context.request.json();
    if(f.passcode!==C.PASS) return json({error:"패스코드가 올바르지 않습니다."}, 401);
    const action=f.action||"create";

    if(action==="list"){
      const {posts}=await readPosts(C);
      return json({ok:true, posts});
    }
    if(action==="delete"){
      if(!validId(f.id)) return json({error:"잘못된 글 id입니다."}, 400);
      const {posts, sha}=await readPosts(C);
      const fileC=await getContent(C, "blog/"+f.id);
      if(fileC) await deleteFile(C, "blog/"+f.id, "delete: "+f.id, fileC.sha);
      await writePostsAndIndex(C, posts.filter(function(p){return p.id!==f.id;}), sha);
      return json({ok:true, deleted:f.id});
    }
    if(!f.title || !f.body) return json({error:"제목과 본문은 필수입니다."}, 400);
    const now=new Date(Date.now()+9*3600*1000);
    f.dateISO=(f.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(f.dateISO)) ? f.dateISO : now.toISOString().slice(0,10);
    f.dateText=f.dateText || (now.getUTCFullYear()+". "+(now.getUTCMonth()+1)+". "+now.getUTCDate()+".");
    f.tag=f.tag || "분석";
    const entry={id:f.id, title:f.title, tag:f.tag, lede:f.lede||"", body:f.body, summary:f.summary||"", dateISO:f.dateISO, dateText:f.dateText};
    const place=isFood(f)?cleanPlace(f.place):undefined; if(place) entry.place=place;
    if(isFood(f)){ const th=cleanImgs(f.thumbs), ts=cleanImgs(f.thumbSrc); if(th.length){ entry.thumbs=th; entry.thumbSrc=ts; } }
    const {posts, sha}=await readPosts(C);

    if(action==="update"){
      if(!validId(f.id)) return json({error:"잘못된 글 id입니다."}, 400);
      const existing=await getContent(C, "blog/"+f.id);
      await putFile(C, "blog/"+f.id, buildPostHtml(entry, C.BASE), "update: "+f.title, existing?existing.sha:undefined);
      let next=posts.map(function(p){return p.id===f.id?entry:p;});
      if(!next.some(function(p){return p.id===f.id;})) next.push(entry);
      await writePostsAndIndex(C, next, sha);
      return json({ok:true, url:C.BASE+"/blog/"+f.id, id:f.id});
    }
    const rand=Math.random().toString(36).slice(2,8);
    entry.id=f.dateISO+"-"+rand+".html";
    await putFile(C, "blog/"+entry.id, buildPostHtml(entry, C.BASE), "post: "+f.title);
    posts.unshift(entry);
    await writePostsAndIndex(C, posts, sha);
    return json({ok:true, url:C.BASE+"/blog/"+entry.id, id:entry.id});
  }catch(err){
    return json({error:String(err&&err.message||err)}, 500);
  }
}
