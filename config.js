// FolkChat settings. Everything in this file is public by design (it ships to every browser).
// Firebase web config:
// This is NOT secret: Firebase security comes from firestore.rules, not from hiding this.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC6o-6pxoILupuqSHloOk5X3ZnHGv78lCA",
  authDomain: "sebotech-chat.firebaseapp.com",
  projectId: "sebotech-chat",
  storageBucket: "sebotech-chat.firebasestorage.app",
  messagingSenderId: "1070062183386",
  appId: "1:1070062183386:web:09bc82ebb9809a0f2156e3"
};

// The owner's Google email. Must match the email in firestore.rules.
export const OWNER_EMAIL = "ghiurcutadragosgamer@gmail.com";

export const KLIPY_KEY = "7Cej8PO1ROTI5DDxeO4BC4CM0nbtCoyTN0TVL9Wocj4TKyPN7XPzdRP9loTQFz0E";

// Cloudflare R2 media worker URL (see cloudflare/README.md), e.g. "https://folkchat-media.YOURNAME.workers.dev".
// Empty = pictures are stored in Firestore instead (works, but uses more of the free quota).
// If you use a custom domain instead of *.workers.dev, also add it to img-src/connect-src in index.html.
export const MEDIA_URL = "https://folkchat-media.ghiurcutadragosgamer.workers.dev";

// Web Push key for browsers (Firebase console → Project settings → Cloud Messaging → Web Push certificates → Key pair).
// Empty = no browser push (the Android app uses native push and doesn't need this).
export const VAPID_KEY = "";
