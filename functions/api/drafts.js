// Cloudflare Pages Function — 초안 목록·삭제 (어드민 전용)
// URL: POST /api/drafts · 환경변수: BLOG_PASSCODE · R2 바인딩: IMG
// 본문: { passcode, action: "list" }  또는  { passcode, action: "delete", id }
// 삭제 시 초안 JSON과 함께, 그 초안 본문에만 쓰인 이미지(발행된 글 어디에도 안 쓰인 것)도 지운다.
function json(obj, status){ return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}}); }
const ID_RE=/^\d{4}-\d{2}-\d{2}-[a-z0-9]{10}$/;

export async function onRequestPost(context){
  const env=context.env;
  try{
    if(!env.BLOG_PASSCODE) return json({error:"서버 환경변수(BLOG_PASSCODE)가 없습니다."}, 500);
    if(!env.IMG) return json({error:"R2 버킷 바인딩(IMG)이 없습니다."}, 500);
    const req=await context.request.json();
    if(req.passcode!==env.BLOG_PASSCODE) return json({error:"패스코드가 올바르지 않습니다."}, 401);

    if(req.action==="list"){
      const out=[]; let cursor;
      do{
        const r=await env.IMG.list({prefix:"drafts/", cursor:cursor, limit:200});
        for(const o of r.objects){
          const id=o.key.replace(/^drafts\//,"").replace(/\.json$/,"");
          if(!ID_RE.test(id)) continue;
          let d={}; try{ d=await (await env.IMG.get(o.key)).json(); }catch(e){}
          out.push({id:id, title:d.title||"(제목 없음)", tag:d.tag||"", createdAt:d.createdAt||o.uploaded});
        }
        cursor=r.truncated?r.cursor:undefined;
      }while(cursor && out.length<300);
      out.sort(function(a,b){return String(b.createdAt).localeCompare(String(a.createdAt));});
      return json({ok:true, drafts:out});
    }

    if(req.action==="delete"){
      const id=String(req.id||"");
      if(!ID_RE.test(id)) return json({error:"초안 ID 형식이 올바르지 않습니다."}, 400);
      const obj=await env.IMG.get("drafts/"+id+".json");
      if(!obj) return json({error:"초안을 찾을 수 없습니다."}, 404);
      const d=await obj.json();
      // 발행된 글에서 쓰는 이미지는 남긴다
      let used="";
      try{ const r=await fetch(new URL("/blog/posts.json", context.request.url).toString(), {cf:{cacheTtl:0}}); if(r.ok) used=await r.text(); }catch(e){}
      if(!used) return json({error:"발행 글 목록을 확인하지 못해 삭제를 멈췄습니다. 잠시 후 다시 시도하세요."}, 503);
      const imgs=[...new Set((String(d.body||"").match(/\/img\/images\/[A-Za-z0-9._-]+/g)||[]))];
      const removed=[];
      for(const u of imgs){ if(used.indexOf(u)<0){ await env.IMG.delete(u.replace(/^\/img\//,"")); removed.push(u); } }
      await env.IMG.delete("drafts/"+id+".json");
      // import-draft 중복 방지 기록 중 이 초안을 가리키는 것도 정리
      const m=await env.IMG.list({prefix:"drafts-imported/", limit:1000});
      for(const o of m.objects){ try{ const x=await (await env.IMG.get(o.key)).json(); if(x&&x.id===id) await env.IMG.delete(o.key); }catch(e){} }
      return json({ok:true, deleted:id, images:removed.length});
    }
    return json({error:"action은 list 또는 delete입니다."}, 400);
  }catch(err){
    return json({error:String(err&&err.message||err)}, 500);
  }
}
