// Cloudflare Pages Function — 세종 뉴스 (네이버 뉴스 검색 API)
// URL: /api/news · 환경변수: NAVER_ID, NAVER_SECRET (네이버 개발자센터 검색 API)
const QUERIES = { realestate: "세종시 부동산", general: "세종시" };

function clean(s){
  return String(s || "")
    .replace(/<\/?b>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, n){ return String.fromCharCode(+n); })
    .replace(/&amp;/g, "&").trim();
}
async function search(env, query){
  try{
    const url = "https://openapi.naver.com/v1/search/news.json?display=5&sort=date&query=" + encodeURIComponent(query);
    const r = await fetch(url, { headers: { "X-Naver-Client-Id": env.NAVER_ID, "X-Naver-Client-Secret": env.NAVER_SECRET } });
    if(!r.ok) return [];
    const j = await r.json();
    return (j.items || []).slice(0, 5).map(function(it){
      const link = it.originallink || it.link;
      let host = "";
      try{ host = new URL(link).hostname.replace(/^www\./, "").replace(/^m\./, ""); }catch(e){}
      return { title: clean(it.title), link: link, source: host, pubDate: it.pubDate };
    });
  }catch(e){ return []; }
}
export async function onRequestGet(context){
  const env = context.env;
  if(!env.NAVER_ID || !env.NAVER_SECRET){
    return new Response(JSON.stringify({ realestate: [], general: [], error: "NAVER_ID/NAVER_SECRET 환경변수가 설정되지 않았습니다." }),
      { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const [realestate, general] = await Promise.all([search(env, QUERIES.realestate), search(env, QUERIES.general)]);
  const body = JSON.stringify({ realestate: realestate, general: general, _at: new Date().toISOString() });
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
