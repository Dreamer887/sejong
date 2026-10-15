# sejong
## 정적 프리렌더 (애드센스·검색 대응)
`complex.html`(단지 정보)과 `index.html`(최신 분석 카드)은 자바스크립트로 그려지는 내용을 HTML에도 미리 넣어 둡니다.
`complexes.json`·`transit.json`·`interest.json`을 갱신했거나 새 글을 발행한 뒤에는 다시 돌려 주세요.

```
npm i --no-save jsdom@24   # jsdom이 없을 때만
node tools/prerender.mjs
```

방문자 수는 계속 집계되지만 화면에는 숨겨져 있습니다. 주소 끝에 `?visits`를 붙이면 보입니다.
