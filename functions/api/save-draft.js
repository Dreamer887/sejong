// Cloudflare Pages Function — 블로그 초안 저장 (Claude 등 외부 작성자용)
// URL: POST /api/save-draft · 인증: Authorization: Bearer <DRAFT_TOKEN> · R2 바인딩: IMG
// 이 토큰으로는 초안·이미지 저장만 가능하고 발행은 불가(발행은 /admin에서 BLOG_PASSCODE로).
//
// 요청 본문(JSON):
//   { tag, title, lede, body, summary, dateISO,
//     images: [ { name: "chart1", dataUrl: "data:image/png;base64,..." }, ... ] }
// 본문에서 {{img:chart1}} 자리표시자는 업로드된 /img/images/... 경로로 치환됨.
// 응답: { ok, id, url: "/admin/?draft=<id>", images: { chart1: "/img/images/..." } }
const OK_EXT = ["png","jpg","jpeg","gif","webp"];
const MAX_IMG = 5*1024*1024;
const MAX_IMAGES = 20;

function json(obj, status){ return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json"}}); }

function safeEqual(a, b){
  a=String(a||""); b=String(b||"");
  if(!a || !b || a.length!==b.length) return false;
  let d=0; for(let i=0;i<a.length;i++) d|=a.charCodeAt(i)^b.charCodeAt(i);
  return d===0;
}
function rid(n){
  const c="abcdefghijklmnopqrstuvwxyz0123456789", buf=new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s=""; for(let i=0;i<n;i++) s+=c[buf[i]%c.length];
  return s;
}
function kstDate(){ return new Date(Date.now()+9*3600*1000).toISOString().slice(0,10); }
function str(v, max){ return String(v==null?"":v).slice(0, max); }

export async function onRequestPost(context){
  const env=context.env;
  try{
    if(!env.DRAFT_TOKEN) return json({error:"서버 환경변수(DRAFT_TOKEN)가 설정되지 않았습니다."}, 500);
    if(!env.IMG) return json({error:"R2 버킷 바인딩(IMG)이 설정되지 않았습니다."}, 500);

    const auth=context.request.headers.get("Authorization")||"";
    const token=auth.replace(/^Bearer\s+/i,"");
    if(!safeEqual(token, env.DRAFT_TOKEN)) return json({error:"토큰이 올바르지 않습니다."}, 401);

    const d=await context.request.json();
    const draft={
      tag: str(d.tag||"분석", 40),
      title: str(d.title, 300).trim(),
      lede: str(d.lede, 3000).trim(),
      body: str(d.body, 200000),
      summary: str(d.summary, 3000).trim(),
      dateISO: /^\d{4}-\d{2}-\d{2}$/.test(String(d.dateISO||"")) ? d.dateISO : kstDate()
    };
    if(!draft.title || !draft.body) return json({error:"제목과 본문은 필수입니다."}, 400);

    // 이미지 업로드 → 본문 자리표시자 치환
    const images=Array.isArray(d.images)?d.images:[];
    if(images.length>MAX_IMAGES) return json({error:"이미지는 최대 "+MAX_IMAGES+"장입니다."}, 400);
    const map={};
    for(const im of images){
      const name=String(im&&im.name||"").trim();
      if(!/^[A-Za-z0-9_-]{1,40}$/.test(name)) return json({error:"이미지 이름은 영문·숫자·_- 1~40자: "+name}, 400);
      const m=String(im.dataUrl||"").match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
      if(!m) return json({error:"이미지 형식이 아닙니다: "+name}, 400);
      let ext=m[1].toLowerCase(); if(ext==="jpeg") ext="jpg";
      if(OK_EXT.indexOf(ext)<0) return json({error:"지원하지 않는 형식입니다(png/jpg/gif/webp): "+name}, 400);
      const bin=atob(m[2]);
      if(bin.length>MAX_IMG) return json({error:"이미지는 5MB 이하만 가능합니다: "+name}, 413);
      const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      const key="images/"+kstDate()+"-"+rid(6)+"."+ext;
      const ctype=ext==="jpg"?"image/jpeg":("image/"+ext);
      await env.IMG.put(key, bytes, {httpMetadata:{contentType:ctype, cacheControl:"public, max-age=31536000, immutable"}});
      map[name]="/img/"+key;
    }
    const missing=[];
    draft.body=draft.body.replace(/\{\{img:([A-Za-z0-9_-]+)\}\}/g, function(all, n){
      if(map[n]) return map[n];
      missing.push(n); return all;
    });
    if(missing.length) return json({error:"본문에 있는 이미지 자리표시자에 해당 이미지가 없습니다: "+missing.join(", ")}, 400);

    const id=kstDate()+"-"+rid(10);
    draft.id=id;
    draft.createdAt=new Date().toISOString();
    await env.IMG.put("drafts/"+id+".json", JSON.stringify(draft), {httpMetadata:{contentType:"application/json; charset=utf-8", cacheControl:"no-store"}});

    return json({ok:true, id:id, url:"/admin/?draft="+id, images:map});
  }catch(err){
    return json({error:String(err&&err.message||err)}, 500);
  }
}
