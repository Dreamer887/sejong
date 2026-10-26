// 세부인 서비스 워커 — 휴대폰 알림(웹 푸시) 전용. 페이지 캐시는 하지 않는다.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "세부인";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "/images/icons/icon-192.png",
    badge: "/images/icons/badge-96.png",
    tag: d.tag || "sebuin",
    renotify: true,
    data: { url: d.url || "/" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && "focus" in c) {
        try { await c.navigate(url); } catch (err) {}
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});

// 브라우저가 구독을 새로 바꿨을 때(만료 등) 서버 구독도 새 것으로 옮긴다
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    try {
      const k = await (await fetch("/api/push")).json();
      const raw = atob(k.publicKey.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((k.publicKey.length + 3) % 4));
      const key = Uint8Array.from(raw, c => c.charCodeAt(0));
      const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      if (e.oldSubscription) {
        await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: e.oldSubscription.endpoint }) });
      }
      await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), topics: ["trade", "analysis"] }) });
    } catch (err) {}
  })());
});
