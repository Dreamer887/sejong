// Cloudflare Pages Function — R2 이미지 서빙
// URL: /img/<key>  ·  R2 바인딩: IMG
export async function onRequestGet(context){
  const parts = context.params.path;
  const key = Array.isArray(parts) ? parts.join("/") : String(parts||"");
  if(!key) return new Response("Not found", {status:404});
  if(!context.env.IMG) return new Response("R2 binding(IMG) missing", {status:500});

  const obj = await context.env.IMG.get(key);
  if(!obj || !obj.body) return new Response("Not found", {status:404});

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if(!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, {headers});
}
