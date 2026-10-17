// Cloudflare Pages Function — 저장소 drafts-inbox 브랜치의 초안을 가져와 R2 초안으로 등록
// URL: POST /api/import-draft  본문: { "job": "inbox/<slug>/draft.json" }
// 환경변수: GITHUB_TOKEN(이미 publish-post가 쓰는 것) · R2 바인딩: IMG
//
// 왜 이 방식인가: Claude 대화 세션은 보안 검사 때문에 DRAFT_TOKEN 같은 비밀값을 다룰 수 없다.
// 대신 세션은 GitHub 저장소에 쓸 권한(사용자가 승인한 연결)으로 초안을 drafts-inbox 브랜치에 올리고,
// 이 함수가 그 브랜치에서만 초안을 읽어 등록한다. 브랜치에 쓸 수 있는 사람만 초안을 만들 수 있으므로
// 별도 토큰 없이도 안전하다. 발행은 지금처럼 /admin에서 BLOG_PASSCODE로만 가능하다.
//
// draft.json 형식(save-draft와 동일 + 선택 필드 place):
//   { tag, title, lede, body, summary, dateISO,
//     images: [ { name: "pasta", file: "pasta.webp" }, ... ],   // file은 draft.json과 같은 폴더 기준
//     place: { name, address, lat, lng } }                      // 맛집 글의 가게 위치(선택)
const BRANCH = "drafts-inbox";
const OK_EXT = ["png","jpg","jpeg","gif","webp"];
const MAX_IMG = 5*1024*1024;
const MAX_IMAGES = 20;

function json(obj, status){ return new Response(JSON.stringify(obj), {status:status||200, headers:{"Content-Type":"application/json; charset=utf-8"}}); }
function rid(n){
  const c="abcdefghijklmnopqrstuvwxyz0123456789", buf=new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s=""; for(let i=0;i<n;i++) s+=c[buf[i]%c.length];
  return s;
}
function kstDate(){ return new Date(Date.now()+9*3600*1000).toISOString().slice(0,10); }
function str(v, max){ return String(v==null?"":v).slice(0, max); }

async function ghRaw(env, path){
  const owner=env.GH_OWNER||"Dreamer887", repo=env.GH_REPO||"sejong";
  const r=await fetch("https://api.github.com/repos/"+owner+"/"+repo+"/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref="+BRANCH, {
    headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github.raw","User-Agent":"sejong-draft-import"}
  });
  if(r.status===404) return null;
  if(!r.ok) throw new Error("GitHub "+path+" "+r.status);
  return new Uint8Array(await r.arrayBuffer());
}

export async function onRequestPost(context){
  const env=context.env;
  try{
    if(!env.GITHUB_TOKEN) return json({error:"서버 환경변수(GITHUB_TOKEN)가 없습니다."}, 500);
    if(!env.IMG) return json({error:"R2 버킷 바인딩(IMG)이 없습니다."}, 500);

    const req=await context.request.json();
    const job=String(req&&req.job||"");
    const m=job.match(/^inbox\/([a-z0-9-]{1,60})\/draft\.json$/);
    if(!m) return json({error:"job은 inbox/<영문소문자·숫자·->/draft.json 형식이어야 합니다."}, 400);
    const dir="inbox/"+m[1]+"/";

    // 같은 job을 두 번 가져오면 새로 만들지 않고 기존 초안을 돌려준다
    const doneKey="drafts-imported/"+m[1]+".json";
    const done=await env.IMG.get(doneKey);
    if(done && !req.force){ const d=await done.json(); return json(Object.assign({ok:true, reused:true}, d)); }

    const raw=await ghRaw(env, job);
    if(!raw) return json({error:BRANCH+" 브랜치에 "+job+" 파일이 없습니다."}, 404);
    const d=JSON.parse(new TextDecoder().decode(raw));

    const draft={
      tag: str(d.tag||"분석", 40),
      title: str(d.title, 300).trim(),
      lede: str(d.lede, 3000).trim(),
      body: str(d.body, 200000),
      summary: str(d.summary, 3000).trim(),
      dateISO: /^\d{4}-\d{2}-\d{2}$/.test(String(d.dateISO||"")) ? d.dateISO : kstDate()
    };
    if(!draft.title || !draft.body) return json({error:"제목과 본문은 필수입니다."}, 400);
    if(d.place && typeof d.place==="object"){
      const lat=Number(d.place.lat), lng=Number(d.place.lng);
      draft.place={ name:str(d.place.name,100), address:str(d.place.address,200), dong:str(d.place.dong,12),
        lat: isFinite(lat)?lat:null, lng: isFinite(lng)?lng:null };
    }

    const images=Array.isArray(d.images)?d.images:[];
    if(images.length>MAX_IMAGES) return json({error:"이미지는 최대 "+MAX_IMAGES+"장입니다."}, 400);
    const map={};
    for(const im of images){
      const name=String(im&&im.name||"").trim();
      const file=String(im&&im.file||"").trim();
      if(!/^[A-Za-z0-9_-]{1,40}$/.test(name)) return json({error:"이미지 이름은 영문·숫자·_- 1~40자: "+name}, 400);
      if(!/^[A-Za-z0-9_.-]{1,60}$/.test(file) || file.indexOf("..")>=0) return json({error:"이미지 파일명이 올바르지 않습니다: "+file}, 400);
      let ext=(file.split(".").pop()||"").toLowerCase(); if(ext==="jpeg") ext="jpg";
      if(OK_EXT.indexOf(ext)<0) return json({error:"지원하지 않는 형식입니다(png/jpg/gif/webp): "+file}, 400);
      const bytes=await ghRaw(env, dir+file);
      if(!bytes) return json({error:"이미지 파일이 없습니다: "+dir+file}, 404);
      if(bytes.length>MAX_IMG) return json({error:"이미지는 5MB 이하만 가능합니다: "+file}, 413);
      const key="images/"+kstDate()+"-"+rid(6)+"."+ext;
      await env.IMG.put(key, bytes, {httpMetadata:{contentType: ext==="jpg"?"image/jpeg":("image/"+ext), cacheControl:"public, max-age=31536000, immutable"}});
      map[name]="/img/"+key;
    }
    const missing=[];
    draft.body=draft.body.replace(/\{\{img:([A-Za-z0-9_-]+)\}\}/g, function(all, n){
      if(map[n]) return map[n];
      missing.push(n); return all;
    });
    if(missing.length) return json({error:"본문 이미지 자리표시자에 해당 이미지가 없습니다: "+missing.join(", ")}, 400);

    if(Array.isArray(d.cover)){ const ts=d.cover.map(function(n){ return map[String(n)]; }).filter(Boolean).slice(0,4); if(ts.length) draft.thumbSrc=ts; }
    const id=kstDate()+"-"+rid(10);
    draft.id=id;
    draft.createdAt=new Date().toISOString();
    draft.source=job;
    await env.IMG.put("drafts/"+id+".json", JSON.stringify(draft), {httpMetadata:{contentType:"application/json; charset=utf-8", cacheControl:"no-store"}});

    const result={id:id, url:"/admin/?draft="+id, images:map};
    await env.IMG.put(doneKey, JSON.stringify(result), {httpMetadata:{contentType:"application/json; charset=utf-8"}});
    return json(Object.assign({ok:true}, result));
  }catch(err){
    return json({error:String(err&&err.message||err)}, 500);
  }
}
