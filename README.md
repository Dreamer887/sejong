# sejong
## 정적 프리렌더 (애드센스·검색 대응)
`complex.html`(단지 정보)과 `index.html`(최신 분석 카드)은 자바스크립트로 그려지는 내용을 HTML에도 미리 넣어 둡니다.
`blog/posts.json`·`complexes.json`·`transit.json`·`interest.json`이 main에 올라오면 GitHub Actions(`.github/workflows/prerender.yml`)가 자동으로 다시 돌립니다. 손으로 돌릴 때는:

```
npm i --no-save jsdom@24   # jsdom이 없을 때만
node tools/prerender.mjs
```

방문자 수는 계속 집계되지만 화면에는 숨겨져 있습니다. 주소 끝에 `?visits`를 붙이면 보입니다.
