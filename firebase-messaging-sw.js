// FolkChat – background push notifications for browsers (Firebase Cloud Messaging).
// The worker sends "notification" messages, so the Firebase SDK shows them automatically;
// this file only has to exist and initialise Firebase.
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
