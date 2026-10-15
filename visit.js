(function () {
  var els = document.querySelectorAll("[data-visits]");
  fetch("/api/visit", { method: "POST", keepalive: true, credentials: "omit" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.ok) return;
      // 방문자 수는 계속 집계하되 화면에는 운영자만 보이게 — 주소 끝에 ?visits 를 붙이면 표시
      if (!/[?&]visits\b/.test(location.search)) return;
      var t = "방문자 오늘 " + Number(d.today).toLocaleString("ko-KR") + "명 · 전체 " + Number(d.total).toLocaleString("ko-KR") + "명";
      for (var i = 0; i < els.length; i++) { els[i].textContent = t; els[i].hidden = false; }
    })
    .catch(function () {});
})();
