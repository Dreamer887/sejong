# sejong

정기적으로 갱신해야 하는 데이터와 주기·방법은 [`docs/정기업데이트.md`](docs/정기업데이트.md)에 정리돼 있습니다.
## 정적 프리렌더 (애드센스·검색 대응)
`complex.html`(단지 정보)과 `index.html`(최신 분석 카드)은 자바스크립트로 그려지는 내용을 HTML에도 미리 넣어 둡니다.
분석글마다 하단 '함께 읽으면 좋은 글' 3개와 본문 용어 링크(PIR·전세가율·단지 정보 등, `tools/prerender.mjs`의 `GLOSSARY`)도 같은 단계에서 붙습니다.
`blog/posts.json`·`complexes.json`·`transit.json`·`interest.json`·`education.json`이 main에 올라오면 GitHub Actions(`.github/workflows/prerender.yml`)가 자동으로 다시 돌립니다. 손으로 돌릴 때는:

```
npm i --no-save jsdom@24   # jsdom이 없을 때만
node tools/prerender.mjs
```

방문자 수는 계속 집계되지만 화면에는 숨겨져 있습니다. 주소 끝에 `?visits`를 붙이면 보입니다.
