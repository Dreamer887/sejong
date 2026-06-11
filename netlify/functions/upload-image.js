// 블로그 이미지 업로드 함수 — /admin 에서 호출.
// 패스코드 확인 후 이미지를 GitHub(blog/images/)에 저장하고 절대경로를 반환.
const GH_OWNER = process.env.GH_OWNER || "Dreamer887";
const GH_REPO  = process.env.GH_REPO  || "sejong";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const API = "https://api.github.com";
const OK_EXT = ["png","jpg","jpeg","gif","webp"];

exports.handler = async (event) => {
  const headers = {"Content-Type":"application/json"};
  try{
    if(event.httpMethod !== "POST") return {statusCode:405, headers, body:JSON.stringify({error:"POST only"})};
    if(!process.env.GITHUB_TOKEN || !process.env.BLOG_PASSCODE)
      return {statusCode:500, headers, body:JSON.stringify({error:"서버 환경변수가 설정되지 않았습니다."})};

    const { passcode, dataUrl } = JSON.parse(event.body||"{}");
    if(passcode !== process.env.BLOG_PASSCODE)
      return {statusCode:401, headers, body:JSON.stringify({error:"패스코드가 올바르지 않습니다."})};

    const m = String(dataUrl||"").match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if(!m) return {statusCode:400, headers, body:JSON.stringify({error:"이미지 형식이 아닙니다."})};
    let ext = m[1].toLowerCase(); if(ext==="jpeg") ext="jpg";
    if(!OK_EXT.includes(ext)) return {statusCode:400, headers, body:JSON.stringify({error:"지원하지 않는 형식입니다(png/jpg/gif/webp)."})};
    const base64 = m[2];
    // 용량 제한 ~5MB
    if(base64.length * 3/4 > 5*1024*1024)
      return {statusCode:413, headers, body:JSON.stringify({error:"이미지는 5MB 이하만 가능합니다."})};

    const now = new Date(Date.now()+9*3600*1000);
    const fn = `${now.toISOString().slice(0,10)}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const path = `blog/images/${fn}`;

    const r = await fetch(`${API}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
      method:"PUT",
      headers:{
        "Authorization":`Bearer ${process.env.GITHUB_TOKEN}`,
        "Accept":"application/vnd.github+json",
        "User-Agent":"sejong-blog-cms"
      },
      body: JSON.stringify({ message:`image: ${fn}`, content: base64, branch: GH_BRANCH })
    });
    const t = await r.text();
    if(!r.ok){ let j={}; try{j=JSON.parse(t);}catch(e){} throw new Error(`GitHub ${r.status}: ${j.message||t}`); }

    return {statusCode:200, headers, body:JSON.stringify({ok:true, url:`/${path}`})};
  }catch(err){
    return {statusCode:500, headers, body:JSON.stringify({error:String(err.message||err)})};
  }
};
