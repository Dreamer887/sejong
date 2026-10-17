// Cloudflare Pages Function — 네이버 검색 프록시 (블로그·카페·지역·뉴스)
// URL: GET /api/naver-search?type=blog&query=...&display=20&start=1&sort=sim
// 환경변수: NAVER_ID, NAVER_SECRET (이미 /api/news가 쓰는 키와 동일)
// 목적: Claude 대화 세션이 키를 직접 다루지 않고도 네이버 검색을 쓰게 하는 것.
//      키는 Cloudflare 안에만 있고, 이 엔드포인트는 공개 검색 결과만 돌려준다.
// 남용 방지: 유형 4가지만 허용, display·start 상한, 질의 길이 제한, 결과 6시간 캐시.
const TYPES = { blog: 30, cafearticle: 30, news: 30, local: 5 };
const CACHE_SEC = 6 * 3600;

function clean(s){
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, n){ return String.fromCharCode(+n); })
    .replace(/&amp;/g, "&").trim();
}
function json(obj, status, extra){
  return new Response(JSON.stringify(obj), { status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extra || {}) });
}
function shape(type, it){
  if(type === "local"){
    // 네이버 지역검색 mapx/mapy = WGS84 경도·위도 × 1e7
    const lng = Number(it.mapx) / 1e7, lat = Number(it.mapy) / 1e7;
    return { title: clean(it.title), category: clean(it.category), address: clean(it.address),
      roadAddress: clean(it.roadAddress), telephone: clean(it.telephone), link: it.link || "",
      lat: isFinite(lat) && lat ? lat : null, lng: isFinite(lng) && lng ? lng : null };
  }
  const o = { title: clean(it.title), description: clean(it.description), link: it.link || "" };
  if(type === "blog"){ o.blogger = clean(it.bloggername); o.postdate = it.postdate || ""; }
  if(type === "cafearticle"){ o.cafe = clean(it.cafename); }
  if(type === "news"){ o.originallink = it.originallink || ""; o.pubDate = it.pubDate || ""; }
  return o;
}

export async function onRequestGet(context){
  const env = context.env;
  if(!env.NAVER_ID || !env.NAVER_SECRET) return json({ error: "NAVER_ID/NAVER_SECRET 환경변수가 없습니다." }, 500);

  const u = new URL(context.request.url);
  const type = u.searchParams.get("type") || "blog";
  const query = (u.searchParams.get("query") || "").trim();
  if(!TYPES[type]) return json({ error: "type은 blog, cafearticle, local, news 중 하나입니다." }, 400);
  if(!query || query.length > 60) return json({ error: "query는 1~60자입니다." }, 400);
  const display = Math.max(1, Math.min(TYPES[type], parseInt(u.searchParams.get("display") || "10", 10) || 10));
  const start = Math.max(1, Math.min(type === "local" ? 1 : 1000, parseInt(u.searchParams.get("start") || "1", 10) || 1));
  const sort = type === "local"
    ? ((u.searchParams.get("sort") === "comment") ? "comment" : "random")
    : ((u.searchParams.get("sort") === "date") ? "date" : "sim");

  // 캐시 키는 정규화된 파라미터로 만든다(같은 검색 반복 시 네이버 호출 절약)
  const cacheKey = new Request(u.origin + "/api/naver-search?type=" + type + "&query=" + encodeURIComponent(query)
    + "&display=" + display + "&start=" + start + "&sort=" + sort);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if(hit) return hit;

  const api = "https://openapi.naver.com/v1/search/" + type + ".json?query=" + encodeURIComponent(query)
    + "&display=" + display + "&start=" + start + "&sort=" + sort;
  const r = await fetch(api, { headers: { "X-Naver-Client-Id": env.NAVER_ID, "X-Naver-Client-Secret": env.NAVER_SECRET } });
  if(!r.ok) return json({ error: "네이버 API 오류 " + r.status }, 502);
  const j = await r.json();
  const res = json({ type: type, query: query, total: j.total || 0, start: start, display: display,
    items: (j.items || []).map(function(it){ return shape(type, it); }) }, 200,
    { "Cache-Control": "public, max-age=" + CACHE_SEC });
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
