// FolkChat – data layer (Firebase Auth + Cloud Firestore).
// Every rule that matters is ALSO enforced server-side in firestore.rules;
// nothing in this file is trusted by the database.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, onSnapshot, query, where, orderBy, limit,
  writeBatch, setDoc, deleteDoc, updateDoc, serverTimestamp, increment, deleteField, startAfter, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, MEDIA_URL } from "./config.js?v=12";

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
let uid = null;

const SNAP = { serverTimestamps: "estimate" };
const ms = v => (v && typeof v.toMillis === "function") ? v.toMillis() : (typeof v === "number" ? v : Date.now());
const rows = snap => snap.docs.map(d => { const x = d.data(SNAP); for (const k of ["ts","joined","seen","edited"]) if (k in x) x[k] = ms(x[k]); return { id: d.id, ...x }; });
const limitsRef = () => doc(db, "limits", uid);

export async function sha256(s){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export function newKey(){
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint32Array(12));
  const c = [...r].map(n => A[n % A.length]).join("");
  return "FOLK-" + c.slice(0,4) + "-" + c.slice(4,8) + "-" + c.slice(8,12);
}

// ---------- auth ----------
export function onAuth(cb){ return onAuthStateChanged(auth, u => { uid = u ? u.uid : null; cb(u ? { uid: u.uid, email: u.email } : null); }); }
// Where are we running? Android app (Capacitor), Windows app (Pake/Tauri) or a normal browser.
const CAP = window.Capacitor;
export const isNative = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
export const isDesktopApp = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
export const plugin = name => (isNative && CAP.Plugins && CAP.Plugins[name]) || null;
export async function signIn(){
  // Android: Google blocks sign-in inside app WebViews, so use the native Google account picker,
  // then hand the Google ID token to the Firebase JS SDK.
  const FA = plugin("FirebaseAuthentication");
  if (FA){
    const r = await FA.signInWithGoogle({ skipNativeAuth: true });
    const idToken = r && r.credential && r.credential.idToken;
    if (!idToken) throw Object.assign(new Error("no id token"), { code: "auth/no-token" });
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  }
  const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" });
  try { return await signInWithPopup(auth, prov); }
  catch(e){
    // Windows app: if the popup can't open inside the app, fall back to a full-page redirect.
    if (isDesktopApp && /popup-blocked|popup-closed|cancelled-popup|operation-not-supported/.test(e.code || "")) return signInWithRedirect(auth, prov);
    throw e;
  }
}
export function redirectResult(){ return getRedirectResult(auth); }
export const idToken = () => auth.currentUser ? auth.currentUser.getIdToken() : Promise.reject(new Error("signed out"));
export async function signOutUser(){ const FA = plugin("FirebaseAuthentication"); if (FA) await FA.signOut().catch(() => {}); return signOut(auth); }

// ---------- setup / keys ----------
export async function isSetupDone(){ return (await getDoc(doc(db, "config", "setup"))).exists(); }
export async function isMember(){ return (await getDoc(doc(db, "members", uid))).exists(); }

// One-time: creates the setup lock + N keys (key 1 is the admin key). Returns the plain keys.
export async function bootstrap(n){
  const b = writeBatch(db), keys = [];
  b.set(doc(db, "config", "setup"), { done: true, by: uid, at: serverTimestamp() });
  for (let i = 0; i < n; i++){
    const k = newKey(); keys.push(k);
    b.set(doc(db, "keys", await sha256(k)), { claimedBy: null, admin: i === 0, label: i === 0 ? "Owner key" : "Key " + (i + 1), created: serverTimestamp() });
  }
  await b.commit();
  return keys;
}

// Join with a key: claims the key and creates the member profile in ONE atomic batch.
export async function join(key, profile){
  const hash = await sha256(key.trim().toUpperCase());
  const keyRef = doc(db, "keys", hash);
  // The key doc is unreadable to non-admins, so we just try the claim; the rules decide.
  // The rules only accept role "admin" for the owner key, so try "member" first, then "admin".
  let last;
  for (const role of ["member", "admin"]){
    const b = writeBatch(db);
    b.update(keyRef, { claimedBy: uid });
    b.set(doc(db, "members", uid), Object.assign({}, profile, { keyHash: hash, role, joined: serverTimestamp() }));
    try { await b.commit(); return role; } catch(e){ last = e; }
  }
  throw last;
}

export function watchKeys(cb){ return onSnapshot(collection(db, "keys"), s => cb(s.docs.map(d => ({ hash: d.id, ...d.data(SNAP) }))), () => {}); }
export async function createKey(label){
  const k = newKey();
  await setDoc(doc(db, "keys", await sha256(k)), { claimedBy: null, admin: false, label: label || "Extra key", created: serverTimestamp() });
  return k;
}
// Make many keys in one go (no limit on the total). Returns [{key,label}].
export async function createKeys(n, label){
  const out = [];
  for (let start = 0; start < n; start += 400){
    const b = writeBatch(db);
    for (let i = start; i < Math.min(n, start + 400); i++){
      const k = newKey(), l = (label || "Cheie") + (n > 1 ? " " + (i + 1) : "");
      b.set(doc(db, "keys", await sha256(k)), { claimedBy: null, admin: false, label: l.slice(0, 40), created: serverTimestamp() });
      out.push({ key: k, label: l.slice(0, 40) });
    }
    await b.commit();
  }
  return out;
}
export async function freeKey(hash, memberId){
  const b = writeBatch(db);
  b.delete(doc(db, "members", memberId));
  b.update(doc(db, "keys", hash), { claimedBy: null });
  await b.commit();
}
export function deleteKey(hash){ return deleteDoc(doc(db, "keys", hash)); }

// ---------- members ----------
export function watchMembers(cb, err){ return onSnapshot(collection(db, "members"), s => cb(rows(s), s.metadata.fromCache), err); }
export function saveProfile(p){
  return updateDoc(doc(db, "members", uid), {
    avatar: p.avatar || "", pronouns: p.pronouns || "",
    tag: p.tag, emoji: p.emoji, bio: p.bio, color: p.color, banner: p.banner, status: p.status,
    platform: deleteField(), mode: deleteField(), drop: deleteField(), main: deleteField(), lfg: deleteField()
  });
}

// ---------- chat (rate-limited: each write also stamps limits/{uid}) ----------
export function watchChat(cb, err){ return onSnapshot(query(collection(db, "chat"), orderBy("ts", "desc"), limit(200)), s => cb(rows(s), s.metadata.fromCache), err); }
// Attachments: att = { img:{data,w,h} } (stored in images/{id}) or { gif:{url,w,h} }.
function addAtt(b, body, att, kind, pair){
  if (att && att.img){
    const ref = doc(collection(db, "images"));
    const img = { uid, kind, data: att.img.data, w: att.img.w|0, h: att.img.h|0, ts: serverTimestamp() };
    if (pair) img.pair = pair;
    b.set(ref, img);
    body.img = ref.id;
  }
  if (att && att.pic) body.pic = { url: att.pic.url, w: att.pic.w|0, h: att.pic.h|0 };
  if (att && att.vm){   // voice message
    const vm = { dur: Math.max(0.1, Math.round(att.vm.dur * 10) / 10), wave: String(att.vm.wave || "").slice(0, 80) };
    if (att.vm.url) vm.url = att.vm.url;
    else {
      const ref = doc(collection(db, "images"));
      const a = { uid, kind, data: att.vm.data, w: 0, h: Math.round(att.vm.dur), ts: serverTimestamp() };
      if (pair) a.pair = pair;
      b.set(ref, a); vm.id = ref.id;
    }
    body.vm = vm;
  }
  if (att && att.vid) body.vid = { url: att.vid.url, w: att.vid.w|0, h: att.vid.h|0, dur: Math.round((att.vid.dur || 0) * 10) / 10 };
  if (att && att.gif) body.gif = { url: att.gif.url, w: att.gif.w|0, h: att.gif.h|0 };
  return body;
}
export async function sendChat(text, att){
  const b = writeBatch(db);
  b.set(doc(collection(db, "chat")), addAtt(b, { uid, text, ts: serverTimestamp() }, att, "chat"));
  b.set(limitsRef(), { t: serverTimestamp() });
  await b.commit();
}
export async function deleteChat(id, img){
  const b = writeBatch(db);
  b.delete(doc(db, "chat", id));
  if (img) b.delete(doc(db, "images", img));
  await b.commit();
}
// ---------- media (Cloudflare R2 worker; optional – without MEDIA_URL pictures go into Firestore) ----------
export const mediaOn = () => !!MEDIA_URL;
export async function uploadMedia(blob, kind){
  const r = await fetch(MEDIA_URL.replace(/\/$/, "") + "/upload?kind=" + encodeURIComponent(kind), {
    method: "POST", body: blob,
    headers: { "Authorization": "Bearer " + await idToken(), "Content-Type": blob.type || "application/octet-stream" }
  });
  if (!r.ok){ const t = await r.text().catch(() => ""); throw Object.assign(new Error(t || ("upload " + r.status)), { code: "media/" + r.status }); }
  return r.json();   // { url }
}
// Admin usage dashboard (Cloudflare storage + Firebase reads/writes), answered by the worker.
export async function getUsage(fresh){
  const r = await fetch(MEDIA_URL.replace(/\/$/, "") + "/stats" + (fresh ? "?fresh=1" : ""), { headers: { "Authorization": "Bearer " + await idToken() } });
  if (!r.ok){ const t = await r.text().catch(() => ""); throw new Error(t || ("stats " + r.status)); }
  return r.json();
}
export async function deleteMedia(url){
  if (!MEDIA_URL || !url || !url.startsWith(MEDIA_URL.replace(/\/$/, "") + "/m/")) return;
  try { await fetch(url, { method: "DELETE", headers: { "Authorization": "Bearer " + await idToken() } }); } catch(e){}
}
// Ask the worker to send a push notification (new DM, @mention, incoming call). Never blocks the UI.
export async function pushNotify(payload){
  if (!MEDIA_URL) return;
  try { await fetch(MEDIA_URL.replace(/\/$/, "") + "/notify", { method: "POST", headers: { "Authorization": "Bearer " + await idToken(), "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } catch(e){}
}

const imgCache = new Map();
export function getImage(id){
  if (!imgCache.has(id)) imgCache.set(id, getDoc(doc(db, "images", id)).then(s => s.exists() ? s.data().data : null).catch(() => { imgCache.delete(id); return null; }));
  return imgCache.get(id);
}
export async function pruneChat(days){
  const old = await getDocs(query(collection(db, "chat"), where("ts", "<", new Date(Date.now() - days * 86400000)), limit(100)));
  for (const d of old.docs) await deleteDoc(d.ref);
  const oldImgs = await getDocs(query(collection(db, "images"), where("ts", "<", new Date(Date.now() - days * 86400000)), limit(50)));
  for (const d of oldImgs.docs) if (d.data().kind === "chat") await deleteDoc(d.ref);
}

// ---------- channels (Discord-style) ----------
export function watchChannels(cb){ return onSnapshot(collection(db, "channels"), s => cb(rows(s)), () => {}); }
export async function createChannel(c){
  const ref = doc(collection(db, "channels"));
  await setDoc(ref, { name: c.name, emoji: c.emoji || "", topic: c.topic || "", pos: c.pos | 0, ts: serverTimestamp() });
  return ref.id;
}
export function updateChannel(id, f){ return updateDoc(doc(db, "channels", id), f); }
export function deleteChannel(id){ return deleteDoc(doc(db, "channels", id)); }
// A conversation id is either a channel id or "dm:<uidA>_<uidB>" (sorted) for a private DM.
export const dmId = other => "dm:" + [uid, other].sort().join("_");
const isDm = cid => String(cid).startsWith("dm:");
const msgsCol = cid => isDm(cid) ? collection(db, "dms", cid.slice(3), "msgs") : collection(db, "channels", cid, "msgs");
const msgDoc = (cid, id) => doc(msgsCol(cid), id);
export function watchMsgs(cid, n, cb, err){
  return onSnapshot(query(msgsCol(cid), orderBy("ts", "desc"), limit(n)), s => cb(rows(s), s.metadata.fromCache), err);
}
export async function sendMsg(cid, text, att, extra){
  const b = writeBatch(db), pair = isDm(cid) ? cid.slice(3) : null;
  const body = addAtt(b, Object.assign({ uid, text, ts: serverTimestamp() }, extra || {}), att, pair ? "dm" : "chat", pair);
  b.set(doc(msgsCol(cid)), body);
  if (pair) b.set(doc(db, "dms", pair), { users: pair.split("_"), last: serverTimestamp(), lastUid: uid });
  b.set(limitsRef(), { t: serverTimestamp() });
  await b.commit();
}
export function editMsg(cid, id, text){ return updateDoc(msgDoc(cid, id), { text, edited: serverTimestamp() }); }
export async function deleteMsg(cid, id, img, picUrl){
  const b = writeBatch(db);
  b.delete(msgDoc(cid, id));
  if (img) b.delete(doc(db, "images", img));
  await b.commit();
  if (picUrl) deleteMedia(picUrl);
}
// Older history, 50 at a time ("Încarcă mesaje mai vechi").
export async function loadOlder(cid, beforeTs, n){
  const s = await getDocs(query(msgsCol(cid), orderBy("ts", "desc"), where("ts", "<", new Date(beforeTs)), limit(n || 50)));
  return rows(s);
}
export function reactMsg(cid, id, key, on){ return updateDoc(msgDoc(cid, id), { ["rx." + key + "_" + uid]: on ? true : deleteField() }); }
// My DM conversations (only ones I'm in; the rules block everything else).
export function watchDms(cb){
  return onSnapshot(query(collection(db, "dms"), where("users", "array-contains", uid)),
    s => cb(s.docs.map(d => { const x = d.data(SNAP); return { id: "dm:" + d.id, other: (x.users || []).find(u => u !== uid) || uid, last: ms(x.last) }; })), () => {});
}
export async function pruneChannels(ids, days){
  const cut = new Date(Date.now() - days * 86400000);
  for (const cid of ids){
    const old = await getDocs(query(collection(db, "channels", cid, "msgs"), where("ts", "<", cut), limit(100)));
    for (const d of old.docs){ const img = d.data().img; await deleteDoc(d.ref); if (img) await deleteDoc(doc(db, "images", img)).catch(() => {}); }
  }
}

// ---------- feed ----------
export function watchPosts(cb, err){ return onSnapshot(query(collection(db, "posts"), orderBy("ts", "desc"), limit(50)), s => cb(rows(s), s.metadata.fromCache), err); }
export async function loadOlderPosts(beforeTs){ return rows(await getDocs(query(collection(db, "posts"), orderBy("ts", "desc"), where("ts", "<", new Date(beforeTs)), limit(50)))); }
export async function createPost(text, att){
  const b = writeBatch(db);
  b.set(doc(collection(db, "posts")), addAtt(b, { uid, text, ts: serverTimestamp(), reactions: {}, replyCount: 0 }, att, "post"));
  b.set(limitsRef(), { t: serverTimestamp() });
  await b.commit();
}
export async function deletePost(id, img, picUrl){
  const b = writeBatch(db);
  b.delete(doc(db, "posts", id));
  if (img) b.delete(doc(db, "images", img));
  await b.commit();
  if (picUrl) deleteMedia(picUrl);
}
export function react(postId, key, on){ return updateDoc(doc(db, "posts", postId), { ["reactions." + key + "_" + uid]: on ? true : deleteField() }); }
export function watchReplies(postId, cb){ return onSnapshot(query(collection(db, "posts", postId, "replies"), orderBy("ts", "asc"), limit(200)), s => cb(rows(s)), () => {}); }
export async function addReply(postId, text){
  const b = writeBatch(db);
  b.set(doc(collection(db, "posts", postId, "replies")), { uid, text, ts: serverTimestamp() });
  b.update(doc(db, "posts", postId), { replyCount: increment(1) });
  b.set(limitsRef(), { t: serverTimestamp() });
  await b.commit();
}
export async function deleteReply(postId, id){
  const b = writeBatch(db);
  b.delete(doc(db, "posts", postId, "replies", id));
  b.update(doc(db, "posts", postId), { replyCount: increment(-1) });
  await b.commit();
}

// ---------- presence ----------
export function watchPresence(cb){ return onSnapshot(collection(db, "presence"), s => cb(rows(s)), () => {}); }
// Written only when the status really changes (open / closed / joined a voice channel).
export function setPresence(online, voice, act){
  const d = { seen: serverTimestamp(), online: !!online, voice: String(voice || "").slice(0, 64) };
  if (act && act.n) d.act = { n: String(act.n).slice(0, 48), k: act.k, e: String(act.e || "").slice(0, 8), s: Math.floor(act.s) };
  return setDoc(doc(db, "presence", uid), d);
}
// ---------- hours played (one small doc per member: playtime/{uid}.g.<game> = { n, sec, last }) ----------
// Weeks start on Monday (local time). Key looks like "2026-W47".
export function weekId(t){
  const d = new Date(t || Date.now()); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));            // Thursday of this week decides the ISO year
  const y = d.getFullYear(), jan4 = new Date(y, 0, 4);
  const w = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return y + "-W" + String(w).padStart(2, "0");
}
export function addPlaytime(key, name, sec){
  sec = Math.round(Math.min(sec, 900)); if (!key || sec <= 0) return Promise.resolve();
  const wk = weekId();
  return setDoc(doc(db, "playtime", uid), {
    g: { [key]: { n: String(name).slice(0, 48), sec: increment(sec), last: Date.now() } },
    wk: { [wk]: increment(sec) },
    wkg: { [wk]: { [key]: increment(sec) } }
  }, { merge: true });
}
export async function getAllPlaytime(){ const s = await getDocs(collection(db, "playtime")); return rows(s); }
// keep only the last 6 weeks of weekly totals so the doc stays small
export async function prunePlaytime(){
  const s = await getDoc(doc(db, "playtime", uid)); if (!s.exists()) return;
  const keep = new Set(); for (let i = 0; i < 6; i++) keep.add(weekId(Date.now() - i * 7 * 86400000));
  const upd = {}, d = s.data();
  for (const w of Object.keys(d.wk || {})) if (!keep.has(w)) upd["wk." + w] = deleteField();
  for (const w of Object.keys(d.wkg || {})) if (!keep.has(w)) upd["wkg." + w] = deleteField();
  if (Object.keys(upd).length) await updateDoc(doc(db, "playtime", uid), upd);
}
export async function getPlaytime(id){ const s = await getDoc(doc(db, "playtime", id)); return s.exists() ? (s.data().g || {}) : {}; }

// ---------- push tokens (private doc, max 10 devices) ----------
// Web fallback (browsers): Firebase Cloud Messaging with the service worker in firebase-messaging-sw.js.
export async function enableWebPush(vapidKey){
  const { getMessaging, getToken, isSupported } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
  if (!(await isSupported())) return null;
  const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
  return getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
}
export async function saveDeviceToken(token){
  if (!uid || !token) return;
  const ref = doc(db, "tokens", uid);
  let list = [];
  try { const s = await getDoc(ref); if (s.exists()) list = (s.data().list || []).filter(t => t !== token); } catch(e){}
  list.push(token);
  await setDoc(ref, { list: list.slice(-10), ts: serverTimestamp() });
}

// ---------- 1-on-1 calls (signaling only; audio goes peer-to-peer) ----------
const callRef = pair => doc(db, "calls", pair);
export function watchIncomingCalls(cb){ return onSnapshot(query(collection(db, "calls"), where("callee", "==", uid)), s => cb(rows(s)), () => {}); }
export function watchCall(pair, cb){ return onSnapshot(callRef(pair), s => cb(s.exists() ? { id: s.id, ...s.data(SNAP) } : null), () => cb(null)); }
export async function startCall(pair, callee, offer){
  await deleteDoc(callRef(pair)).catch(() => {});        // clear a stale call left by a crashed app
  await setDoc(callRef(pair), { caller: uid, callee, state: "ringing", offer: { type: offer.type, sdp: offer.sdp }, ts: serverTimestamp() });
}
export function answerCall(pair, answer){ return updateDoc(callRef(pair), { state: "active", answer: { type: answer.type, sdp: answer.sdp } }); }
export async function endCall(pair){
  try { const ice = await getDocs(collection(db, "calls", pair, "ice")); await Promise.all(ice.docs.map(d => deleteDoc(d.ref).catch(() => {}))); } catch(e){}
  await deleteDoc(callRef(pair)).catch(() => {});
}
export function addCallIce(pair, cand){ return setDoc(doc(collection(db, "calls", pair, "ice")), { from: uid, c: JSON.stringify(cand), ts: serverTimestamp() }); }
export function watchCallIce(pair, cb){ return onSnapshot(collection(db, "calls", pair, "ice"), s => cb(s.docChanges().filter(c => c.type === "added").map(c => c.doc.data())), () => {}); }

// ---------- live call set-up relay (Cloudflare worker WebSocket) ----------
// Offer/answer/ICE messages go friend-to-friend through the worker instead of being written to Firestore:
// faster, no database writes, and nothing about the call passes through Google. If a friend isn't connected
// to the relay (old app version, network trouble), the old Firestore path is used for them automatically.
let hubWs = null, hubOnline = new Set(), hubWant = false, hubTimer = null, hubBackoff = 1000, hubPing = null, hubSeq = 0;
const hubHandlers = new Set(), hubPending = new Map();
export function hubStart(){ hubWant = true; hubOpen(); }
export function hubStop(){ hubWant = false; clearTimeout(hubTimer); clearInterval(hubPing); if (hubWs) try { hubWs.close(1000); } catch(e){} hubWs = null; hubOnline = new Set(); }
async function hubOpen(){
  if (!hubWant || hubWs || !MEDIA_URL || !auth.currentUser || !("WebSocket" in window)) return;
  let t; try { t = await auth.currentUser.getIdToken(); } catch(e){ hubRetry(); return; }
  if (hubWs) return;
  const ws = new WebSocket(MEDIA_URL.replace(/\/$/, "").replace(/^http/, "ws") + "/rtc?t=" + encodeURIComponent(t));
  hubWs = ws;
  ws.onopen = () => { hubBackoff = 1000; clearInterval(hubPing); hubPing = setInterval(() => { try { ws.send("ping"); } catch(e){} }, 45000); };
  ws.onmessage = e => {
    if (e.data === "pong") return;
    let m; try { m = JSON.parse(e.data); } catch(err){ return; }
    if (m.t === "online"){ hubOnline = new Set(m.ids || []); return; }
    if (m.t === "nack"){ const f = hubPending.get(m.id); hubPending.delete(m.id); hubOnline.delete(m.to); if (f) f(); return; }
    if (m.t === "sig") for (const fn of hubHandlers) try { fn(m.from, m.d); } catch(err){}
  };
  ws.onclose = () => { if (hubWs === ws){ hubWs = null; hubOnline = new Set(); clearInterval(hubPing); } hubRetry(); };
  ws.onerror = () => {};
}
function hubRetry(){ if (!hubWant) return; clearTimeout(hubTimer); hubTimer = setTimeout(hubOpen, hubBackoff); hubBackoff = Math.min(hubBackoff * 2, 60000); }
addEventListener("online", () => { if (hubWant && !hubWs){ hubBackoff = 1000; hubOpen(); } });
/** Send d to friend `to` through the relay. Returns false if they can't be reached that way (use Firestore).
 *  `fallback` runs if the relay finds them gone after all. */
export function hubSend(to, d, fallback){
  if (!hubWs || hubWs.readyState !== 1 || !hubOnline.has(to)) return false;
  const id = ++hubSeq;
  if (fallback){ hubPending.set(id, fallback); setTimeout(() => hubPending.delete(id), 15000); }
  try { hubWs.send(JSON.stringify({ t: "sig", to, id, d })); return true; } catch(e){ hubPending.delete(id); return false; }
}
export function onHub(fn){ hubHandlers.add(fn); return () => hubHandlers.delete(fn); }

// ---------- group voice channels ----------
export function watchVoiceRooms(cb){ return onSnapshot(collection(db, "voice"), s => cb(rows(s)), () => {}); }
export function createVoiceRoom(id, f){ return setDoc(doc(db, "voice", id), Object.assign({}, f, { ts: serverTimestamp() })); }
export function deleteVoiceRoom(id){ return deleteDoc(doc(db, "voice", id)); }
export function watchVoicePeers(room, cb){ return onSnapshot(collection(db, "voice", room, "peers"), s => cb(rows(s)), () => {}); }
export function setVoicePeer(room, muted, deaf){ return setDoc(doc(db, "voice", room, "peers", uid), { ts: serverTimestamp(), muted: !!muted, deaf: !!deaf }); }
export function leaveVoicePeer(room){ return deleteDoc(doc(db, "voice", room, "peers", uid)); }
export function kickVoicePeer(room, who){ return deleteDoc(doc(db, "voice", room, "peers", who)); }
export function sendVoiceSig(room, to, kind, data){ return setDoc(doc(collection(db, "voice", room, "sig")), { from: uid, to, kind, data: JSON.stringify(data), ts: serverTimestamp() }); }
export function watchVoiceSig(room, cb){
  return onSnapshot(query(collection(db, "voice", room, "sig"), where("to", "==", uid)), s => {
    const added = s.docChanges().filter(c => c.type === "added").map(c => ({ ref: c.doc.ref, ...c.doc.data() }));
    if (added.length) cb(added);
  }, () => {});
}
export const delRef = ref => deleteDoc(ref).catch(() => {});
export async function clearMySigs(room){
  try { const s = await getDocs(query(collection(db, "voice", room, "sig"), where("from", "==", uid))); await Promise.all(s.docs.map(d => deleteDoc(d.ref).catch(() => {}))); } catch(e){}
}

export const errCode = e => (e && e.code ? String(e.code).replace(/^firestore\//, "") : "unknown");
