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

방문자 수는 계속 집계되지만 화면에는 숨겨져 있습니다. 주소 끝에 `?visits`(또는 `?visit`)를 붙이면 보이고, 휴대폰 알림 구독자 수도 같이 나옵니다.

## 휴대폰 알림 (웹 푸시)
- 구독 페이지: `alerts.html` (안드로이드·아이폰 설정 안내 포함), 서비스 워커 `sw.js`, 홈 화면용 `alerts.webmanifest`
- 서버: `functions/api/push.js` — 구독 저장은 D1(`VISITS_DB`)의 `push_*` 표, VAPID 키는 처음 호출 때 자동 생성되어 D1에 보관(따로 넣을 환경변수 없음)
- 발송: `.github/workflows/push-alerts.yml`이 매일 한국 시간 07:40(예비 10:17)과 새 글 발행 때 `POST /api/push {"action":"send"}`를 부른다
  - 실거래: `data.json` 「오늘 신고내역」 날짜가 오늘(또는 어제)이고 1건 이상이면 하루 한 번
  - 글: `blog/posts.json`의 새 글(맛집 태그는 '새 맛집 글', 나머지는 '새 분석글')
  - 한국 시간 7~21시에만 새 알림을 만들고, 같은 알림은 한 사람에게 한 번만 간다
- 손으로 보내기: GitHub Actions에서 push-alerts → Run workflow
