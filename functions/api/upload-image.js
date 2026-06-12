// Cloudflare Pages Function — 블로그 이미지 업로드 (R2 저장)
// URL: /api/upload-image · 환경변수: BLOG_PASSCODE · R2 바인딩: IMG
// 이미지는 R2 버킷에 저장되고 /img/<key> 경로로 서빙됨(functions/img/[[path]].js)
const OK_EXT = ["png","jpg","jpeg","gif","webp"];

function json(obj, status){ return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json"}}); }

export async function onRequestPost(context){
  const env=context.env;
  try{
    if(!env.BLOG_PASSCODE) return json({error:"서버 환경변수(BLOG_PASSCODE)가 설정되지 않았습니다."}, 500);
    if(!env.IMG) return json({error:"R2 버킷 바인딩(IMG)이 설정되지 않았습니다. Cloudflare Pages → Settings → Bindings에서 R2 버킷을 변수명 IMG로 연결하세요."}, 500);

    const {passcode, dataUrl}=await context.request.json();
    if(passcode!==env.BLOG_PASSCODE) return json({error:"패스코드가 올바르지 않습니다."}, 401);

    const m=String(dataUrl||"").match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if(!m) return json({error:"이미지 형식이 아닙니다."}, 400);
    let ext=m[1].toLowerCase(); if(ext==="jpeg") ext="jpg";
    if(OK_EXT.indexOf(ext)<0) return json({error:"지원하지 않는 형식입니다(png/jpg/gif/webp)."}, 400);

    const base64=m[2];
    const bin=atob(base64);
    const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    if(bytes.length > 5*1024*1024) return json({error:"이미지는 5MB 이하만 가능합니다."}, 413);

    const now=new Date(Date.now()+9*3600*1000);
    const key="images/"+now.toISOString().slice(0,10)+"-"+Math.random().toString(36).slice(2,8)+"."+ext;
    const ctype = ext==="jpg" ? "image/jpeg" : ("image/"+ext);

    await env.IMG.put(key, bytes, {httpMetadata:{contentType:ctype, cacheControl:"public, max-age=31536000, immutable"}});

    return json({ok:true, url:"/img/"+key});
  }catch(err){
    return json({error:String(err&&err.message||err)}, 500);
  }
}
