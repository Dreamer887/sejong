// Cloudflare Pages Function — 블로그 이미지 업로드
// URL: /api/upload-image · 환경변수: GITHUB_TOKEN, BLOG_PASSCODE (선택: GH_OWNER, GH_REPO, GH_BRANCH)
const API = "https://api.github.com";
const OK_EXT = ["png","jpg","jpeg","gif","webp"];

function json(obj, status){ return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json"}}); }

export async function onRequestPost(context){
  const env=context.env;
  const OWNER=env.GH_OWNER||"Dreamer887", REPO=env.GH_REPO||"sejong", BRANCH=env.GH_BRANCH||"main";
  try{
    if(!env.GITHUB_TOKEN || !env.BLOG_PASSCODE) return json({error:"서버 환경변수가 설정되지 않았습니다."}, 500);
    const {passcode, dataUrl}=await context.request.json();
    if(passcode!==env.BLOG_PASSCODE) return json({error:"패스코드가 올바르지 않습니다."}, 401);

    const m=String(dataUrl||"").match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if(!m) return json({error:"이미지 형식이 아닙니다."}, 400);
    let ext=m[1].toLowerCase(); if(ext==="jpeg") ext="jpg";
    if(OK_EXT.indexOf(ext)<0) return json({error:"지원하지 않는 형식입니다(png/jpg/gif/webp)."}, 400);
    const base64=m[2];
    if(base64.length*3/4 > 5*1024*1024) return json({error:"이미지는 5MB 이하만 가능합니다."}, 413);

    const now=new Date(Date.now()+9*3600*1000);
    const fn=now.toISOString().slice(0,10)+"-"+Math.random().toString(36).slice(2,8)+"."+ext;
    const path="blog/images/"+fn;

    const r=await fetch(API+"/repos/"+OWNER+"/"+REPO+"/contents/"+path, {
      method:"PUT",
      headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","User-Agent":"sejong-blog-cms"},
      body: JSON.stringify({message:"image: "+fn, content:base64, branch:BRANCH})
    });
    const t=await r.text();
    if(!r.ok){ let j={}; try{j=JSON.parse(t);}catch(e){} throw new Error("GitHub "+r.status+": "+(j.message||t)); }
    return json({ok:true, url:"/"+path});
  }catch(err){
    return json({error:String(err&&err.message||err)}, 500);
  }
}
