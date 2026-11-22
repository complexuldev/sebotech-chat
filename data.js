// SeboTECH CHAT – data layer (Firebase Auth + Cloud Firestore).
// Every rule that matters is ALSO enforced server-side in firestore.rules;
// nothing in this file is trusted by the database.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, onSnapshot, query, where, orderBy, limit,
  writeBatch, setDoc, deleteDoc, updateDoc, serverTimestamp, increment, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./config.js";

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
  return "SEBO-" + c.slice(0,4) + "-" + c.slice(4,8) + "-" + c.slice(8,12);
}

// ---------- auth ----------
export function onAuth(cb){ return onAuthStateChanged(auth, u => { uid = u ? u.uid : null; cb(u ? { uid: u.uid, email: u.email } : null); }); }
export function signIn(){ return signInWithPopup(auth, new GoogleAuthProvider()); }
export function signOutUser(){ return signOut(auth); }

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
    tag: p.tag, emoji: p.emoji, platform: p.platform, bio: p.bio, color: p.color, banner: p.banner,
    mode: p.mode, drop: p.drop, main: p.main, status: p.status, lfg: !!p.lfg
  });
}

// ---------- chat (rate-limited: each write also stamps limits/{uid}) ----------
export function watchChat(cb, err){ return onSnapshot(query(collection(db, "chat"), orderBy("ts", "desc"), limit(200)), s => cb(rows(s), s.metadata.fromCache), err); }
// Attachments: att = { img:{data,w,h} } (stored in images/{id}) or { gif:{url,w,h} }.
function addAtt(b, body, att, kind){
  if (att && att.img){
    const ref = doc(collection(db, "images"));
    b.set(ref, { uid, kind, data: att.img.data, w: att.img.w|0, h: att.img.h|0, ts: serverTimestamp() });
    body.img = ref.id;
  }
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
export function watchMsgs(cid, n, cb, err){
  return onSnapshot(query(collection(db, "channels", cid, "msgs"), orderBy("ts", "desc"), limit(n)), s => cb(rows(s), s.metadata.fromCache), err);
}
export async function sendMsg(cid, text, att, extra){
  const b = writeBatch(db);
  const body = addAtt(b, Object.assign({ uid, text, ts: serverTimestamp() }, extra || {}), att, "chat");
  b.set(doc(collection(db, "channels", cid, "msgs")), body);
  b.set(limitsRef(), { t: serverTimestamp() });
  await b.commit();
}
export function editMsg(cid, id, text){ return updateDoc(doc(db, "channels", cid, "msgs", id), { text, edited: serverTimestamp() }); }
export async function deleteMsg(cid, id, img){
  const b = writeBatch(db);
  b.delete(doc(db, "channels", cid, "msgs", id));
  if (img) b.delete(doc(db, "images", img));
  await b.commit();
}
export function reactMsg(cid, id, key, on){ return updateDoc(doc(db, "channels", cid, "msgs", id), { ["rx." + key + "_" + uid]: on ? true : deleteField() }); }
export async function pruneChannels(ids, days){
  const cut = new Date(Date.now() - days * 86400000);
  for (const cid of ids){
    const old = await getDocs(query(collection(db, "channels", cid, "msgs"), where("ts", "<", cut), limit(100)));
    for (const d of old.docs){ const img = d.data().img; await deleteDoc(d.ref); if (img) await deleteDoc(doc(db, "images", img)).catch(() => {}); }
  }
}

// ---------- feed ----------
export function watchPosts(cb, err){ return onSnapshot(query(collection(db, "posts"), orderBy("ts", "desc"), limit(150)), s => cb(rows(s), s.metadata.fromCache), err); }
export async function createPost(text, att){
  const b = writeBatch(db);
  b.set(doc(collection(db, "posts")), addAtt(b, { uid, text, ts: serverTimestamp(), reactions: {}, replyCount: 0 }, att, "post"));
  b.set(limitsRef(), { t: serverTimestamp() });
  await b.commit();
}
export async function deletePost(id, img){
  const b = writeBatch(db);
  b.delete(doc(db, "posts", id));
  if (img) b.delete(doc(db, "images", img));
  await b.commit();
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

// ---------- stats ----------
export function watchDayStats(day, cb){ return onSnapshot(collection(db, "days", day, "stats"), s => { const o = {}; s.docs.forEach(d => o[d.id] = d.data()); cb(o); }, () => {}); }
export function watchTotals(cb){ return onSnapshot(collection(db, "totals"), s => { const o = {}; s.docs.forEach(d => o[d.id] = d.data()); cb(o); }, () => {}); }
export async function saveStats(day, cur, tot){
  const b = writeBatch(db);
  b.set(doc(db, "days", day, "stats", uid), cur);
  b.set(doc(db, "totals", uid), tot);
  await b.commit();
}

// ---------- presence ----------
export function watchPresence(cb){ return onSnapshot(collection(db, "presence"), s => cb(rows(s)), () => {}); }
export function setPresence(typing, ch){ return setDoc(doc(db, "presence", uid), { seen: serverTimestamp(), typing: !!typing, ch: String(ch || "").slice(0, 64) }); }

export const errCode = e => (e && e.code ? String(e.code).replace(/^firestore\//, "") : "unknown");
