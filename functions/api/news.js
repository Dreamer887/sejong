// Cloudflare Pages Function — 세종 뉴스 (구글 뉴스 RSS)
// URL: /api/news  ·  부동산 / 세종 전반 각 5개 · 15분 캐시
const FEEDS = {
  realestate: "https://news.google.com/rss/search?q=" + encodeURIComponent("세종시 아파트 OR 세종시 부동산") + "&hl=ko&gl=KR&ceid=KR:ko",
  general:    "https://news.google.com/rss/search?q=" + encodeURIComponent("세종시") + "&hl=ko&gl=KR&ceid=KR:ko"
};
function decodeEnt(s){
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, n){ return String.fromCharCode(+n); })
    .replace(/&amp;/g, "&").trim();
}
function tagText(block, tag){
  const m = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">").exec(block);
  return m ? m[1].trim() : "";
}
function parseItems(xml, limit){
  const out = []; const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while((m = re.exec(xml)) && out.length < limit){
    const b = m[1];
    let title = decodeEnt(tagText(b, "title"));
    const link = decodeEnt(tagText(b, "link"));
    const source = decodeEnt(tagText(b, "source"));
    const pubDate = tagText(b, "pubDate");
    if(source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    if(!title || !link) continue;
    out.push({ title, link, source, pubDate });
  }
  return out;
}
async function fetchFeed(url, limit){
  try{
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (sebuin-news)" }, cf: { cacheTtl: 900 } });
    if(!r.ok) return [];
    return parseItems(await r.text(), limit);
  }catch(e){ return []; }
}
export async function onRequestGet(context){
  // 응답 자체는 캐시하지 않고(빈 응답 캐시 방지), 구글 RSS 호출만 엣지에서 15분 캐시(fetchFeed의 cf.cacheTtl)
  const [realestate, general] = await Promise.all([fetchFeed(FEEDS.realestate, 5), fetchFeed(FEEDS.general, 5)]);
  const body = JSON.stringify({ realestate, general, _at: new Date().toISOString() });
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
