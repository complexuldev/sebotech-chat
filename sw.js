// FolkChat service worker (browser + Windows app):
//  1. keeps a copy of the app itself, so FolkChat opens instantly and still opens without internet
//     (chats then come from Firestore's own offline copy);
//  2. background push notifications for browsers (Firebase Cloud Messaging).
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyC6o-6pxoILupuqSHloOk5X3ZnHGv78lCA",
  authDomain: "sebotech-chat.firebaseapp.com",
  projectId: "sebotech-chat",
  storageBucket: "sebotech-chat.firebasestorage.app",
  messagingSenderId: "1070062183386",
  appId: "1:1070062183386:web:09bc82ebb9809a0f2156e3"
});
firebase.messaging();
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return clients.openWindow("./");
  }));
});

const CACHE = "fc-shell-v1";
const PAGE = new URL("./", self.location).href;   // the app page, stored under one key

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.add(PAGE)).catch(() => {}));
});
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("fc-shell-") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Same-site files and the Firebase libraries only; the database, sign-in, media and calls are never touched.
const cacheable = u => u.origin === self.location.origin || (u.origin === "https://www.gstatic.com" && u.pathname.startsWith("/firebasejs/"));

async function store(c, req, res){
  if (!res || !res.ok || res.type === "opaque") return;
  // keep only the newest copy of each file (app.js?v=35 replaces app.js?v=34)
  const u = new URL(req.url);
  for (const k of await c.keys()){ const ku = new URL(k.url); if (ku.origin === u.origin && ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k); }
  await c.put(req, res);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (!cacheable(u) || u.pathname.endsWith("/sw.js") || u.pathname.endsWith("firebase-messaging-sw.js")) return;
  if (req.mode === "navigate"){
    // the page: always try the network first (so updates show up), fall back to the saved copy offline
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok){ const c = await caches.open(CACHE); c.put(PAGE, res.clone()); }
        return res;
      } catch(err){
        return (await caches.match(PAGE)) || Response.error();
      }
    })());
    return;
  }
  // scripts, styles, icons, emoji list, voice models: answer from the saved copy, refresh it in the background
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    const net = fetch(req).then(async res => { await store(c, req, res.clone()); return res; }).catch(() => hit || Response.error());
    if (hit){ e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});
