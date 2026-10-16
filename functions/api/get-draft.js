// Cloudflare Pages Function — 블로그 초안 불러오기
// URL: GET /api/get-draft?id=<id> · R2 바인딩: IMG
// /admin/?draft=<id> 로 열면 관리자 페이지가 이 API로 초안을 불러와 폼을 채운다.
function json(obj, status){ return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json","Cache-Control":"no-store"}}); }

export async function onRequestGet(context){
  try{
    if(!context.env.IMG) return json({error:"R2 버킷 바인딩(IMG)이 설정되지 않았습니다."}, 500);
    const id=new URL(context.request.url).searchParams.get("id")||"";
    if(!/^\d{4}-\d{2}-\d{2}-[a-z0-9]{10}$/.test(id)) return json({error:"초안 ID 형식이 올바르지 않습니다."}, 400);
    const obj=await context.env.IMG.get("drafts/"+id+".json");
    if(!obj) return json({error:"초안을 찾을 수 없습니다."}, 404);
    return json(JSON.parse(await obj.text()));
  }catch(err){
    return json({error:String(err&&err.message||err)}, 500);
  }
}
