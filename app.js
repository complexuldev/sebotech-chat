// FolkChat – app UI. All user text is rendered with textContent (no HTML injection).
import * as D from "./data.js?v=11";
import { OWNER_EMAIL, KLIPY_KEY, MEDIA_URL, VAPID_KEY } from "./config.js?v=11";

const EMOJIS = ["😎","🐱","🎯","🔥","💀","👑","🐺","🦖","🤖","👻","🍌","⚡","🦈","🐉","🎮","🧊","🥷","👽"];
const COLORS = ["#00e5ff","#a855f7","#ff4d6d","#ffd23f","#3ef08a","#ff9f43","#5b6cff","#ff6ad5","#ffffff"];
const BANNERS = {
  neon:"linear-gradient(120deg,#a855f7,#00e5ff)", storm:"linear-gradient(120deg,#3b1d6e,#7b2ff7 50%,#c084fc)",
  sunset:"linear-gradient(120deg,#ff4d6d,#ff9f43 60%,#ffd23f)", toxic:"linear-gradient(120deg,#0f5132,#3ef08a)",
  ice:"linear-gradient(120deg,#0b3d91,#5bc0ff 60%,#e0f7ff)", lava:"linear-gradient(120deg,#2a0a0a,#c1121f 55%,#ff9f43)",
  midnight:"linear-gradient(120deg,#0f1220,#252b4d 60%,#5b6cff)", gold:"linear-gradient(120deg,#5c4400,#ffd23f 60%,#fff3b0)"
};
const REACTS = [["fire","🔥"],["skull","💀"],["trophy","🏆"],["lol","😂"],["goat","🐐"]];
const ONLINE_STALE_MS = 12 * 3600000;   // an "online" flag older than this is ignored (crashed app)

const $ = id => document.getElementById(id);
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "disabled") el.disabled = true;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const SCREENS = ["loading","signin","setup","gate","app"];
function showScreen(id){ for (const x of SCREENS) $(x).classList.toggle("hidden", x !== id); }

// dates
const z = n => String(n).padStart(2,"0");
const dayKey = d => d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());
const parseDay = k => { const [y,m,d] = k.split("-").map(Number); return new Date(y,m-1,d); };
const shiftDay = (k,n) => { const d = parseDay(k); d.setDate(d.getDate()+n); return dayKey(d); };
const todayKey = () => dayKey(new Date());
function niceDay(k){ const t = todayKey(); if (k===t) return "Azi"; if (k===shiftDay(t,-1)) return "Ieri"; return parseDay(k).toLocaleDateString("ro-RO",{weekday:"long",day:"numeric",month:"short"}); }
const timeStr = ts => new Date(ts).toLocaleTimeString(settings.h24 ? "ro-RO" : "en-US",{hour:"2-digit",minute:"2-digit",hour12:!settings.h24});
function ago(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60) return "acum"; if (s < 3600) return "acum " + Math.floor(s/60) + " min"; if (s < 86400) return "acum " + Math.floor(s/3600) + " h";
  if (s < 7*86400) return "acum " + Math.floor(s/86400) + " zile";
  return new Date(ts).toLocaleDateString("ro-RO",{day:"numeric",month:"short"});
}

// state
let uid = null, email = null, isAdmin = false, started = false;
let profiles = {}, me = null;
let posts = [], presence = [], keys = [];
let online = new Set(), typingUids = new Set();
let view = "chat";
let unsubs = [];
const openReplies = new Map();
let prefillKey = "";

const P = id => profiles[id];
const accent = p => (p && COLORS.includes(p.color)) ? p.color : COLORS[0];
const bannerOf = p => BANNERS[(p && p.banner) || "neon"] || BANNERS.neon;

function avatar(id, size){
  const p = P(id) || {};
  const el = h("span",{class:"av" + (size ? " "+size : ""), style:"border-color:"+accent(p)}, p.avatar ? h("img",{src:p.avatar,alt:"",class:"av-img",loading:"lazy",decoding:"async"}) : (p.emoji || "❔"));
  if (voiceSpeaking.has(id)) el.classList.add("speaking");
  if (online.has(id)) el.append(h("span",{class:"dot",title:"Online"}));
  return el;
}
function nameEl(id, tag){ const p = P(id); return h(tag || "b",{style:"color:"+accent(p), onclick:()=>openProfile(id), text:(p && p.tag) || "Necunoscut"}); }
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function withMentions(text){
  const frag = document.createDocumentFragment();
  const tags = Object.values(profiles).map(p => p.tag.toLowerCase());
  for (const part of String(text).split(/(@[^\s@]+)/g)){
    if (part.startsWith("@") && tags.includes(part.slice(1).toLowerCase().replace(/[.,!?:;]+$/,""))) frag.append(h("span",{class:"mention",text:part}));
    else if (part) frag.append(document.createTextNode(part));
  }
  return frag;
}
const mentionsMe = text => me && new RegExp("@" + escRe(me.tag) + "(?![^\\s.,!?:;])","i").test(text);

function setBanner(msg, warn){ const b = $("banner"); if (!msg){ b.classList.add("hidden"); return; } b.textContent = msg; b.classList.toggle("warn", !!warn); b.classList.remove("hidden"); }
let bannerTimer = null;
function flash(msg, warn){ setBanner(msg, warn); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => setBanner(null), 4000); }
function writeErr(e){
  const c = D.errCode(e);
  if (c === "permission-denied") flash("Blocat: trimiți prea repede sau nu ai voie. Așteaptă o secundă și încearcă din nou.", true);
  else if (c === "resource-exhausted") flash("S-a terminat limita gratuită pe azi. Încearcă mâine.", true);
  else if (c === "unavailable") flash("Ești offline. Se trimite când revii online.", true);
  else flash("N-a mers. Încearcă din nou.", true);
}

// ---------- auth flow ----------
$("signInBtn").addEventListener("click", async () => {
  $("signInErr").textContent = "";
  try { await D.signIn(); }
  catch(e){
    const c = D.errCode(e);
    if (c === "auth/popup-closed-by-user" || /cancel|canceled|12501/i.test(String(e && e.message))) return;
    $("signInErr").textContent = D.isNative ? "Conectarea cu Google n-a mers (" + c + "). Verifică internetul și încearcă din nou."
      : "Conectarea n-a mers. Permite pop-up-urile pentru site și încearcă din nou.";
  }
});
D.redirectResult().catch(e => { $("signInErr").textContent = "Conectarea n-a mers (" + D.errCode(e) + "). Încearcă din nou."; });
for (const id of ["gateSignOut","signOutBtn"]) $(id).addEventListener("click", () => D.signOutUser().then(() => location.reload()));

D.onAuth(async u => {
  if (!u){ uid = null; showScreen("signin"); return; }
  uid = u.uid; email = u.email || "";
  showScreen("loading");
  try {
    if (await D.isMember()) return startApp();
    const done = await D.isSetupDone();
    if (!done && OWNER_EMAIL && email.toLowerCase() === OWNER_EMAIL.toLowerCase()) return showScreen("setup");
    if (!done){ showGate("Site-ul nu e configurat încă. Proprietarul trebuie să se conecteze primul."); return; }
    showGate();
  } catch(e){ $("loadingMsg").textContent = "Nu m-am putut conecta (" + D.errCode(e) + "). Dă refresh și încearcă din nou."; }
});

// ---------- setup (owner, once) ----------
$("setupBtn").addEventListener("click", async () => {
  const btn = $("setupBtn"); btn.disabled = true; btn.textContent = "Se creează cheile…"; $("setupErr").textContent = "";
  try {
    const ks = await D.bootstrap(5);
    prefillKey = ks[0];
    $("setupBody").replaceChildren(
      h("p",{class:"note",style:"margin-top:0",text:"Cheile tale sunt mai jos. Copiază-le ACUM undeva sigur. Sunt salvate criptat, deci nu mai pot fi afișate. Cheia 1 e a ta."}),
      ...ks.map((k,i) => keyLine(k, i === 0 ? "Cheia ta 👑" : "Cheia " + (i+1))),
      h("button",{class:"primary",type:"button",style:"width:100%;margin-top:14px",text:"Le-am salvat, continuă",onclick:()=>showGate()}));
  } catch(e){
    btn.disabled = false; btn.textContent = "Creează cele 5 chei";
    $("setupErr").textContent = D.errCode(e) === "permission-denied" ? "Nu ai voie. Verifică dacă emailul tău e setat ca proprietar și dacă configurarea nu a fost deja făcută." : "Ceva n-a mers: " + D.errCode(e);
  }
});
function keyLine(k, label){
  return h("div",{class:"row",style:"margin-top:8px"},
    h("span",{class:"pill",text:label}),
    h("code",{class:"grow",style:"font-size:15px;letter-spacing:1px;color:var(--accent)",text:k}),
    h("button",{class:"tiny",type:"button",text:"Copiază",onclick:ev => { const b = ev.currentTarget; navigator.clipboard.writeText(k).then(() => b.textContent = "Copiat ✓", () => b.textContent = "Selectează și copiază"); }}));
}

// ---------- gate ----------
let gateEmoji = EMOJIS[0];
function emojiPicker(box, get, set){
  box.replaceChildren(...EMOJIS.map(e => h("button",{type:"button",class:e===get()?"on":"",text:e,onclick:()=>{ set(e); for (const c of box.children) c.classList.toggle("on", c.textContent===e); }})));
}
function fillSelect(sel, opts, val){ sel.replaceChildren(...opts.map(o => h("option",{value:o,text:o}))); if (val) sel.value = val; }
function showGate(msg){
  showScreen("gate");
  $("gateEmail").textContent = email;
  emojiPicker($("gateEmoji"), () => gateEmoji, e => gateEmoji = e);
  if (prefillKey) $("keyIn").value = prefillKey;
  $("gateErr").textContent = msg || "";
}
$("gateForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("gateErr"); err.textContent = "";
  const key = $("keyIn").value.trim().toUpperCase(), tag = $("tagIn").value.trim();
  if (!/^(SEBO|FOLK)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return err.textContent = "Asta nu arată a cheie. Ar trebui să arate așa: FOLK-XXXX-XXXX-XXXX.";
  if (!tag) return err.textContent = "Alege un nume.";
  const btn = $("gateBtn"); btn.disabled = true; btn.textContent = "Verific cheia…";
  try {
    await D.join(key, { tag: tag.slice(0,24), emoji: gateEmoji, bio:"", color: COLORS[Math.floor(Math.random()*COLORS.length)], banner:"neon", status:"" });
    startApp();
  } catch(e){
    err.textContent = D.errCode(e) === "permission-denied" ? "Cheia nu merge sau a fost deja folosită. Fiecare cheie merge o singură dată." : "Ceva n-a mers (" + D.errCode(e) + "). Încearcă din nou.";
    btn.disabled = false; btn.textContent = "Intră";
  }
});

// ---------- app ----------
function startApp(){
  if (started) return; started = true;
  showScreen("loading");
  const bootTimer = setTimeout(() => { $("loadingMsg").textContent = "Încă mă conectez… verifică internetul."; }, 10000);
  // Paint instantly from the cached member list, then keep it live with ONE listener.
  try {
    const c = JSON.parse(localStorage.getItem("fc:profiles:" + uid) || "null");
    if (c && c[uid]){ profiles = c; me = profiles[uid]; isAdmin = me.role === "admin"; showScreen("app"); route(); renderAll(); }
  } catch(e){}
  unsubs.push(D.watchMembers((list, cached) => {
    clearTimeout(bootTimer);
    profiles = {}; for (const m of list) profiles[m.id] = m;
    if (!cached) saveProfileCache();
    me = profiles[uid] || null;
    if (!me){ if (!cached) location.reload(); return; }
    const wasAdmin = isAdmin; isAdmin = me.role === "admin";
    if ($("app").classList.contains("hidden")){ showScreen("app"); route(); }
    initPush();
    if (isAdmin && !adminStarted) startAdmin();
    $("keysCard").classList.toggle("hidden", !isAdmin);
    renderAll();
  }, e => { clearTimeout(bootTimer); $("loadingMsg").textContent = "Nu s-a putut încărca (" + D.errCode(e) + ")."; }));

  initChat();

  unsubs.push(D.watchPosts(list => { livePosts = list; mergePosts(); }, () => $("feedList").replaceChildren(h("div",{class:"empty",text:"Postările nu s-au putut încărca."}))));
  unsubs.push(D.watchPresence(list => { presence = list; computeOnline(); }));
  initVoice();

  // Online status: written only when it actually changes (no heartbeats, no typing pings).
  presenceSet(true);
  let awayTimer = null;
  document.addEventListener("visibilitychange", () => {
    clearTimeout(awayTimer);
    if (document.hidden){ if (!voice.room && !call.pair) awayTimer = setTimeout(() => presenceSet(false), 120000); }
    else presenceSet(true);
  });
  window.addEventListener("pagehide", () => { presenceSet(false); leaveVoice(true); if (call.pair) hangUp(true); });

  bindUi();
}
let presState = null;
function presenceSet(on){
  const want = (on ? "1" : "0") + "|" + (voice.room || "");
  if (want === presState) return;
  presState = want;
  D.setPresence(on, voice.room || "").catch(() => { presState = null; });
}
function saveProfileCache(){
  try { localStorage.setItem("fc:profiles:" + uid, JSON.stringify(profiles)); }
  catch(e){   // too big for storage: keep everything except the avatars
    try { const slim = {}; for (const k in profiles) slim[k] = Object.assign({}, profiles[k], { avatar: "" }); localStorage.setItem("fc:profiles:" + uid, JSON.stringify(slim)); } catch(e2){}
  }
}
let adminStarted = false;
function startAdmin(){
  adminStarted = true;
  setTimeout(() => D.pruneChannels(channels.map(c => c.id), 30).catch(()=>{}), 8000);
  unsubs.push(D.watchKeys(list => { keys = list; renderKeys(); }));
}

let prevOnlineReady = false;
function computeOnline(){
  const now = Date.now(), on = new Set([uid]), ty = new Set();
  for (const p of presence){
    if (!profiles[p.id]) continue;
    if (p.online === true && now - p.seen < ONLINE_STALE_MS) on.add(p.id);
  }
  const changed = [...on].sort().join() !== [...online].sort().join();
  const prevOnline = online;
  online = on; typingUids = ty;
  renderTyping();
  if (changed && started && me){
    const joined = [...on].filter(id => !prevOnline.has(id) && id !== uid);
    renderMembers(); renderSquad(); renderMsgs(false); renderUserPanel();
    if (joined.length && prevOnlineReady) playSfx("join");
    prevOnlineReady = true;
  }
}

// routing
const VIEWS = ["chat","feed","squad","me"];
function route(){
  const v = (location.hash || "#chat").slice(1);
  view = VIEWS.includes(v) ? v : "chat";
  for (const x of VIEWS) $("v-"+x).classList.toggle("hidden", x !== view);
  for (const a of $("tabs").children) a.classList.toggle("on", a.dataset.v === view);
  if (view === "chat"){ markRead(); fitChat(); scrollChat(true); if (!isMobileLayout()) setTimeout(()=>$("chatIn").focus(), 50); }
  if (view === "me") fillMeForm();
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", () => { if (started && me) route(); });
// ---------- mobile layout: fit the chat to the REAL screen (Android WebView, font scaling, keyboard) ----------
const isMobileLayout = () => window.matchMedia("(max-width: 900px)").matches;
let fitRaf = 0;
// Android app: on some phones the system already keeps the page clear of the status / gesture bars,
// so adding the safe-area padding again leaves a thick empty band. Detect that and drop the extra padding.
function fixInsets(){
  if (!D.isNative) return;
  const a = document.activeElement; if (a && a.matches && a.matches("textarea, input")) return;   // keyboard open: sizes are off
  const cs = getComputedStyle(document.documentElement), px = v => parseFloat(cs.getPropertyValue(v)) || 0;
  const t = px("--safe-area-inset-top"), b = px("--safe-area-inset-bottom");
  if (!t && !b) return;
  const already = (screen.height - window.innerHeight) >= t + b - 4;
  const r = document.documentElement.style;
  if (already){ r.setProperty("--sat", "0px"); r.setProperty("--sab", "0px"); } else { r.removeProperty("--sat"); r.removeProperty("--sab"); }
  fitChat();
}
for (const ms of [0, 400, 1500, 4000]) setTimeout(fixInsets, ms);
window.addEventListener("orientationchange", () => setTimeout(fixInsets, 400));
function fitChat(){
  cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    const dc = document.querySelector(".dc");
    if (!dc || view !== "chat"){ if (dc) dc.style.height = ""; return; }
    const vv = window.visualViewport;
    const nav = $("tabs");
    const navFixed = nav && getComputedStyle(nav).position === "fixed" && getComputedStyle(nav).display !== "none";
    // bottom edge we must stay above: the tab bar if it's showing, otherwise the visible screen (keyboard top)
    const limit = navFixed ? nav.getBoundingClientRect().top : (vv ? vv.height + vv.offsetTop : window.innerHeight);
    const top = Math.max(0, dc.getBoundingClientRect().top);
    const h = Math.max(200, Math.floor(limit - top - (isMobileLayout() ? 4 : 0)));
    dc.style.height = h + "px";
    if (document.activeElement === $("chatIn")) scrollChat(true);
  });
}
// While typing on a phone, hide the bottom tab bar so the message box sits right above the keyboard.
document.addEventListener("focusin", e => { if (isMobileLayout() && e.target.matches("textarea, input:not([type=checkbox]):not([type=range]):not([type=file])")){ document.body.classList.add("kbd"); fitChat(); setTimeout(fitChat, 300); } });
document.addEventListener("focusout", () => setTimeout(() => { const a = document.activeElement; if (!a || !a.matches("textarea, input")){ document.body.classList.remove("kbd"); fitChat(); } }, 60));
window.addEventListener("resize", fitChat);
window.addEventListener("orientationchange", () => setTimeout(fitChat, 250));
if (window.visualViewport){ visualViewport.addEventListener("resize", fitChat); visualViewport.addEventListener("scroll", fitChat); }
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitChat);


let uiBound = false;
function bindUi(){
  if (uiBound) return; uiBound = true;
  $("meChip").onclick = () => openProfile(uid);

  bindChat();
  $("dcScrim").onclick = closeDrawer;
  $("topSettings").onclick = openSettings;

  $("postIn").addEventListener("input", () => { const n = $("postIn").value.length; $("postCount").textContent = n ? n + "/1200" : ""; });
  const postAtt = attachBox("post");
  $("postIn").addEventListener("paste", e => { const f = [...(e.clipboardData && e.clipboardData.files || [])].find(f => f.type.startsWith("image/")); if (f){ e.preventDefault(); postAtt.useFile(f); } });
  $("postForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const text = $("postIn").value.trim(), att = postAtt.get(); if (!text && !att) return;
    const btn = $("postBtn"); btn.disabled = true;
    try { await D.createPost(text.slice(0,1200), await finalizeAtt(att, "post")); $("postIn").value = ""; $("postCount").textContent = ""; postAtt.clear(); }
    catch(e){ writeErr(e); }
    finally { btn.disabled = false; }
  });

  $("meForm").addEventListener("submit", saveMe);
  $("newKeyForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const n = Math.max(1, Math.min(200, parseInt($("newKeyCount").value, 10) || 1));
    const btn = $("newKeyBtn"); btn.disabled = true; btn.textContent = "Se generează…";
    try {
      const made = await D.createKeys(n, $("newKeyLabel").value.trim().slice(0,30) || "Cheie");
      $("newKeyLabel").value = "";
      const all = made.map(m => m.key).join("\n");
      $("newKeyOut").replaceChildren(
        h("div",{class:"row",style:"margin:14px 0 4px"},
          h("p",{class:"note grow",style:"margin:0",text: made.length === 1 ? "Cheie nouă. Copiaz-o acum, nu va mai fi afișată:" : made.length + " chei noi. Copiază-le acum, nu vor mai fi afișate:"}),
          made.length > 1 ? h("button",{class:"tiny",type:"button",text:"Copiază toate",onclick:ev => { const b = ev.currentTarget; navigator.clipboard.writeText(all).then(() => b.textContent = "Copiate ✓", () => b.textContent = "Selectează și copiază"); }}) : null),
        ...made.map(m => keyLine(m.key, m.label)));
    } catch(e){ writeErr(e); }
    finally { btn.disabled = false; btn.textContent = "Generează"; }
  });
  $("overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeProfile(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeProfile(); });
}

function renderAll(){
  renderMeChip(); renderChatAll(); renderFeed(); renderSquad(); renderKeys();
  if (view === "me") renderPreview();
  if (openId){ if (P(openId)) openProfile(openId); else closeProfile(); }
}
function renderMeChip(){
  if (!me) return;
  $("meChip").replaceChildren(avatar(uid,"sm"), h("span",{class:"nm",text:me.tag}));
  $("postAv").replaceChildren(document.createTextNode(me.emoji)); $("postAv").style.borderColor = accent(me);
}

// ---------- attachments ----------
// Photos are shrunk in the browser before upload: max 1280px (chat/posts) or 400px (avatars), ~150 KB, WebP or JPEG.
// GIFs are never re-encoded (that would kill the animation).
const IMG_MAX_SIDE = 1280, IMG_TARGET = 150 * 1024, GIF_MAX = MEDIA_URL ? 8 * 1024 * 1024 : 600 * 1024;
function readDataURL(file){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
function imgDims(src){ return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 0, h: 0 }); i.src = src; }); }
const canvasBlob = (c, type, q) => new Promise(res => c.toBlob(b => res(b && b.type === type ? b : null), type, q));
let webpOK = null;
async function encodeBest(c, target){
  if (webpOK === null){ const t = document.createElement("canvas"); t.width = t.height = 2; webpOK = !!(await canvasBlob(t, "image/webp", 0.8)); }
  const type = webpOK ? "image/webp" : "image/jpeg";
  let best = null;
  for (const q of [0.8, 0.66, 0.52]){
    const b = await canvasBlob(c, type, q); if (!b) break;
    if (!best || b.size < best.size) best = b;
    if (b.size <= target) return b;
    if (b.size > target * 2.2) break;        // way too big: shrinking the picture helps more than lowering quality
  }
  return best;
}
async function loadImg(file){
  if (window.createImageBitmap){ try { return await createImageBitmap(file); } catch(e){} }
  const img = new Image(); img.src = URL.createObjectURL(file); await img.decode(); return img;
}
async function shrink(file, maxSide, target){
  const img = await loadImg(file);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  let scale = Math.min(1, maxSide / Math.max(w0, h0));
  for (let round = 0; round < 6; round++){
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    const b = await encodeBest(c, target);
    if (b && b.size <= target * 1.15) return { blob: b, w, h };
    // size grows with pixel count, so jump straight to a scale that should fit
    scale *= Math.max(0.35, Math.min(0.85, Math.sqrt(target / ((b && b.size) || target * 4)) * 0.95));
  }
  throw new Error("Imaginea e prea mare.");
}
const blobToDataURL = b => readDataURL(b);
async function prepImage(file){
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Doar imagini (PNG, JPG, WEBP, GIF).");
  if (file.type === "image/gif"){
    if (file.size > GIF_MAX) throw new Error("GIF-ul e prea mare (max " + Math.round(GIF_MAX / 1048576 * 10) / 10 + " MB). Încearcă butonul GIF.");
    const preview = URL.createObjectURL(file); const d = await imgDims(preview);
    return { blob: file, w: d.w, h: d.h, preview };
  }
  const r = await shrink(file, IMG_MAX_SIDE, IMG_TARGET);
  r.preview = URL.createObjectURL(r.blob);
  return r;
}
// Turn a picked picture into what gets stored: a worker URL (R2) or, without a worker, a data URL in Firestore.
async function finalizeAtt(att, kind){
  if (!att || !att.img) return att;
  const im = att.img;
  if (D.mediaOn()){
    const { url } = await D.uploadMedia(im.blob, kind);
    return { pic: { url, w: im.w, h: im.h } };
  }
  const data = await blobToDataURL(im.blob);
  if (data.length > 900000) throw new Error("Imaginea e prea mare.");
  return { img: { data, w: im.w, h: im.h } };
}
const mediaUrlOk = u => typeof u === "string" && !!MEDIA_URL && u.startsWith(MEDIA_URL.replace(/\/$/, "") + "/m/");
function attachBox(kind){
  // kind: "chat" | "post"; returns controller with get/clear
  const st = { att: null };
  const prev = $(kind + "Prev");
  function show(){
    if (!st.att){ prev.classList.add("hidden"); prev.replaceChildren(); return; }
    const src = st.att.img ? st.att.img.preview : st.att.gif.thumb || st.att.gif.url;
    prev.replaceChildren(h("img",{src,alt:"",decoding:"async"}), h("span",{class:"note",text: st.att.img ? "Imagine atașată" : "GIF"}),
      h("button",{type:"button",class:"icon",title:"Elimină","aria-label":"Elimină atașamentul",text:"✕",onclick:()=>{ st.att = null; show(); }}));
    prev.classList.remove("hidden");
  }
  async function useFile(file){
    try { st.att = { img: await prepImage(file) }; show(); }
    catch(e){ flash(e.message || "Imaginea nu a putut fi încărcată.", true); }
  }
  const input = h("input",{type:"file",accept:"image/png,image/jpeg,image/webp,image/gif",class:"hidden"});
  input.addEventListener("change", () => { if (input.files[0]) useFile(input.files[0]); input.value = ""; });
  document.body.append(input);
  $(kind + "Attach").onclick = () => input.click();
  $(kind + "Gif").onclick = ev => openGifPicker(ev.currentTarget, g => { st.att = { gif: g }; show(); });
  return { get: () => st.att, clear: () => { st.att = null; show(); }, useFile };
}
function attEl(m){
  if (m.pic && mediaUrlOk(m.pic.url)){
    const el = h("img",{class:"att",alt:"imagine",loading:"lazy",decoding:"async",src:m.pic.url});
    if (m.pic.w && m.pic.h) el.style.aspectRatio = m.pic.w + "/" + m.pic.h;
    el.onclick = () => lightbox(m.pic.url);
    el.onerror = () => el.replaceWith(h("div",{class:"note",text:"(imagine ștearsă)"}));
    return el;
  }
  if (m.img){
    const el = h("img",{class:"att",alt:"imagine",loading:"lazy",decoding:"async"});
    if (m.w && m.h) el.style.aspectRatio = m.w + "/" + m.h;
    D.getImage(m.img).then(src => { if (src){ el.src = src; el.onclick = () => lightbox(src); } else el.replaceWith(h("div",{class:"note",text:"(imagine ștearsă)"})); });
    return el;
  }
  if (m.gif && typeof m.gif.url === "string" && /^https:\/\/[a-z0-9.-]*klipy\.com\//.test(m.gif.url)){
    const el = h("img",{class:"att",alt:"GIF",loading:"lazy",decoding:"async",src:m.gif.url});
    if (m.gif.w && m.gif.h){ el.style.aspectRatio = m.gif.w + "/" + m.gif.h; el.style.width = Math.min(m.gif.w, 300) + "px"; }
    el.onclick = () => lightbox(m.gif.url);
    return el;
  }
  return null;
}
function lightbox(src){
  openId = null;
  $("overlay").replaceChildren(h("img",{class:"lightbox",src,alt:"",decoding:"async"}), h("button",{class:"close lb-close",type:"button","aria-label":"Închide",text:"✕",onclick:closeProfile}));
  $("overlay").classList.remove("hidden");
}

// ---------- GIF picker (KLIPY) ----------
let gifPop = null;
async function gifSearch(q){
  const url = "https://api.klipy.com/v2/" + (q ? "search" : "featured") + "?key=" + encodeURIComponent(KLIPY_KEY) +
    "&limit=24&media_filter=gif,tinygif&contentfilter=medium&locale=ro_RO" + (q ? "&q=" + encodeURIComponent(q) : "");
  const r = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  const list = j.results || (j.data && (j.data.data || j.data)) || [];
  return (Array.isArray(list) ? list : []).map(x => {
    const mf = x.media_formats;
    if (mf && mf.gif) { const dims = mf.gif.dims || [0,0]; return { url: mf.gif.url, thumb: (mf.tinygif || mf.gif).url, w: Math.round(dims[0]), h: Math.round(dims[1]) }; }
    const f = x.file || {}, pick = s => f[s] && (f[s].gif || f[s].webp);
    const big = pick("md") || pick("hd") || pick("sm"), small = pick("sm") || pick("xs") || big;
    return big ? { url: big.url, thumb: small.url, w: Math.round(big.width || 0), h: Math.round(big.height || 0) } : null;
  }).filter(g => g && /^https:\/\/[a-z0-9.-]*klipy\.com\//.test(g.url));
}
function closeGifPicker(){ if (gifPop){ gifPop.remove(); gifPop = null; } }
function openGifPicker(anchor, onPick){
  if (gifPop){ closeGifPicker(); return; }
  const grid = h("div",{class:"gif-grid"});
  const input = h("input",{placeholder:"Caută GIF-uri…",type:"search"});
  gifPop = h("div",{class:"gif-pop"}, input, grid, h("div",{class:"gif-foot note",text:"Powered by KLIPY"}));
  document.body.append(gifPop);
  const r = anchor.getBoundingClientRect();
  gifPop.style.left = Math.max(8, Math.min(window.innerWidth - 348, r.left)) + "px";
  if (r.top < 420) gifPop.style.top = (r.bottom + 8) + "px"; else gifPop.style.bottom = (window.innerHeight - r.top + 8) + "px";
  if (!KLIPY_KEY){ grid.replaceChildren(h("div",{class:"note",style:"padding:12px",text:"Căutarea de GIF-uri nu e configurată încă (lipsește cheia KLIPY). Poți totuși atașa un GIF de pe dispozitiv cu 📎."})); return; }
  let t = null, seq = 0;
  async function load(q){
    const my = ++seq; grid.replaceChildren(h("div",{class:"note",style:"padding:12px",text:"Se încarcă…"}));
    try {
      const res = await gifSearch(q); if (my !== seq) return;
      grid.replaceChildren(...(res.length ? res.map(g => h("button",{type:"button",class:"gif-item",title:"Trimite GIF",onclick:()=>{ closeGifPicker(); onPick(g); }}, h("img",{src:g.thumb,alt:"GIF",loading:"lazy"}))) : [h("div",{class:"note",style:"padding:12px",text:"Niciun rezultat."})]));
    } catch(e){ if (my === seq) grid.replaceChildren(h("div",{class:"note",style:"padding:12px",text:"GIF-urile nu s-au putut încărca."})); }
  }
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => load(input.value.trim()), 350); });
  input.focus(); load("");
}
document.addEventListener("click", e => { if (gifPop && !gifPop.contains(e.target) && !e.target.closest(".gif-btn")) closeGifPicker(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeGifPicker(); });

// ================= SETTINGS (stored on this device) =================
const DEFAULT_SETTINGS = {
  theme: "dark", accent: "#8b7cff", fontSize: 15, compact: false, h24: true, reduceMotion: false, showAvatars: true,
  sound: true, volume: 0.6, sfx: { msg: true, mention: true, dm: true, send: true, join: false, react: true },
  notify: false, notifyAll: false, popups: true, muted: {},
  voice: { micId: "", spkId: "", ns: "ai", echo: true, agc: true, micGain: 1, outVol: 1, gate: false, gateDb: -50,
           ptt: false, pttKey: "KeyV", pttLabel: "V", pttDelay: 200, quality: "high", userVol: {} }
};
let settings = loadSettings();
function loadSettings(){
  try { const s = JSON.parse(localStorage.getItem("sebo:settings") || "{}"); return Object.assign({}, DEFAULT_SETTINGS, s, { sfx: Object.assign({}, DEFAULT_SETTINGS.sfx, s.sfx || {}), muted: Object.assign({}, s.muted || {}), voice: Object.assign({}, DEFAULT_SETTINGS.voice, s.voice || {}, { userVol: Object.assign({}, (s.voice || {}).userVol || {}) }) }); }
  catch(e){ return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
}
function saveSettings(){ try { localStorage.setItem("sebo:settings", JSON.stringify(settings)); } catch(e){} applySettings(); }
const THEMES = {
  dark:     { name:"Întunecat", bg:"#0a0a0b", panel:"#111113", panel2:"#18181b", panel3:"#202024", line:"#26262b", text:"#ececef", muted:"#8b8b94" },
  midnight: { name:"Midnight (AMOLED)", bg:"#000000", panel:"#07070a", panel2:"#0f0f13", panel3:"#17171c", line:"#1d1d23", text:"#e8e8ee", muted:"#7c7c88" },
  graphite: { name:"Grafit", bg:"#1b1c20", panel:"#232429", panel2:"#2b2d33", panel3:"#34363d", line:"#3a3c44", text:"#ececf1", muted:"#9a9ca6" },
  ocean:    { name:"Ocean", bg:"#0b1220", panel:"#0f1a2c", panel2:"#152238", panel3:"#1b2b45", line:"#22324f", text:"#e6edf8", muted:"#8698b5" },
  light:    { name:"Luminos", bg:"#f3f3f6", panel:"#ffffff", panel2:"#f0f0f4", panel3:"#e6e6ec", line:"#dcdce3", text:"#16161a", muted:"#6b6b76" }
};
const ACCENTS = ["#8b7cff","#5b8cff","#22c3ee","#2dd4bf","#4ade80","#facc15","#fb923c","#f43f5e","#ec4899","#ffffff"];
function applySettings(){
  const t = THEMES[settings.theme] || THEMES.dark, r = document.documentElement.style;
  for (const k of ["bg","panel","panel2","panel3","line","text","muted"]) r.setProperty("--" + k, t[k]);
  r.setProperty("--accent", settings.accent); r.setProperty("--accent2", settings.accent);
  r.setProperty("--fs", settings.fontSize + "px");
  document.body.classList.toggle("compact", !!settings.compact);
  document.body.classList.toggle("reduce-motion", !!settings.reduceMotion);
  document.body.classList.toggle("no-avatars", !settings.showAvatars);
  document.body.classList.toggle("light", settings.theme === "light");
}
applySettings();

// ================= SOUND EFFECTS (generated, no files) =================
let actx = null;
const SFX = {
  send:    { type:"sine",     notes:[[740,.05],[988,.07]] },
  msg:     { type:"triangle", notes:[[523,.06],[659,.09]] },
  mention: { type:"triangle", notes:[[880,.07],[1175,.07],[1568,.14]] },
  dm:      { type:"sine",     notes:[[784,.07],[1047,.07],[784,.06],[1319,.12]] },
  join:    { type:"sine",     notes:[[392,.08],[587,.12]] },
  react:   { type:"sine",     notes:[[1046,.05]] },
  test:    { type:"triangle", notes:[[659,.06],[784,.06],[988,.1]] }
};
function playSfx(name, force){
  if (!force && (!settings.sound || !settings.sfx[name])) return;
  const s = SFX[name]; if (!s) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    let t = actx.currentTime + 0.01;
    for (const [f, d] of s.notes){
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = s.type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18 * settings.volume + 0.0001, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.08);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.1);
      t += d;
    }
  } catch(e){}
}

// ================= CHANNELS / MESSAGES =================
const MSG_RX = [["like","👍"],["heart","❤️"],["laugh","😂"],["wow","😮"],["sad","😢"],["fire","🔥"],["skull","💀"],["goat","🐐"]];
let channels = [], curCh = null, dms = [];
const isDmId = cid => String(cid || "").startsWith("dm:");
const dmOther = cid => (String(cid).slice(3).split("_").find(x => x !== uid)) || uid;
const pubCh = () => isDmId(curCh) ? "" : (curCh || "");   // DMs are never announced in presence
const pings = (m, cid) => isDmId(cid) ? m.uid !== uid : isMentioned(m);
const convName = cid => isDmId(cid) ? "@" + ((P(dmOther(cid)) || {}).tag || "?") : "#" + ((channels.find(c => c.id === cid) || {}).name || "");
const chMsgs = {};          // cid -> messages (ascending)
const chUnsub = {};         // cid -> unsubscribe
const chLim = {};           // cid -> current listener size (50 for the open chat, 5 for the rest)
const chOlder = {};         // cid -> older messages loaded with "Încarcă mesaje mai vechi"
const chEnd = {};           // cid -> true when there is nothing older
const LIVE_N = 50, BG_N = 5;
// Only the open conversation listens to its last 50 messages; the others listen to 5 (enough for unread badges).
function subConv(cid){
  const n = cid === curCh ? LIVE_N : BG_N;
  if (chUnsub[cid] && chLim[cid] === n) return;
  if (chUnsub[cid]) chUnsub[cid]();
  chLim[cid] = n;
  chUnsub[cid] = D.watchMsgs(cid, n, msgs => onMsgs(cid, msgs), () => {});
}
function dropConv(cid){ if (chUnsub[cid]){ chUnsub[cid](); delete chUnsub[cid]; } delete chLim[cid]; delete chMsgs[cid]; delete chOlder[cid]; delete chEnd[cid]; }
async function loadOlderMsgs(btn){
  const cid = curCh, list = convList(cid); if (!list.length) return;
  btn.disabled = true; btn.textContent = "Se încarcă…";
  const box = $("msgs"), h0 = box.scrollHeight, t0 = box.scrollTop;
  try {
    const more = await D.loadOlder(cid, list[0].ts, 50);
    if (more.length < 50) chEnd[cid] = true;
    chOlder[cid] = more.concat(chOlder[cid] || []);
    if (cid === curCh){ renderMsgs(false); box.scrollTop = t0 + (box.scrollHeight - h0); }
  } catch(e){ writeErr(e); btn.disabled = false; btn.textContent = "Încarcă mesaje mai vechi"; }
}
function convList(cid){
  const seen = new Set(), out = [];
  for (const m of (chOlder[cid] || []).concat(chMsgs[cid] || [])) if (!seen.has(m.id)){ seen.add(m.id); out.push(m); }
  return out.sort((a,b) => a.ts - b.ts);
}
const chFirst = {};         // cid -> first snapshot received
let replyTo = null, editing = null;
let chatAtt = null;
const readKey = () => "sebo:read:" + uid;
let lastRead = (() => { try { return JSON.parse(localStorage.getItem("sebo:read:pending") || "{}"); } catch(e){ return {}; } })();
function loadRead(){ try { lastRead = JSON.parse(localStorage.getItem(readKey()) || "{}"); } catch(e){ lastRead = {}; } }
function saveRead(){ try { localStorage.setItem(readKey(), JSON.stringify(lastRead)); } catch(e){} }
const isMentioned = m => m.uid !== uid && ((Array.isArray(m.mentions) && m.mentions.includes(uid)) || m.everyone === true);

function initChat(){
  loadRead();
  unsubs.push(D.watchChannels(list => {
    channels = list.sort((a,b) => (a.pos||0) - (b.pos||0));
    chReady = true; ensureCur();
    for (const c of channels) subConv(c.id);
    for (const id of Object.keys(chUnsub)) if (!isDmId(id) && !channels.find(c => c.id === id)) dropConv(id);
    renderChannels(); renderChatHeader(); renderMsgs(true);
  }));
  unsubs.push(D.watchDms(list => {
    dms = list.sort((a,b) => b.last - a.last);
    dmReady = true; ensureCur();
    for (const c of dms) subConv(c.id);
    if (isDmId(curCh)) subConv(curCh);
    renderChannels(); renderChatHeader(); renderMsgs(false); renderChatBadge();
  }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) markRead(); });
  window.addEventListener("focus", markRead);
}
let chReady = false, dmReady = false;
function ensureCur(){
  const ok = cid => cid && (isDmId(cid) ? cid.slice(3).split("_").includes(uid) : channels.some(c => c.id === cid));
  if (ok(curCh)) return;
  let want = null; try { want = localStorage.getItem("sebo:ch"); } catch(e){}
  if (!chReady || !dmReady){ if (isDmId(want) && ok(want)){ curCh = want; subConv(curCh); } return; }
  curCh = ok(want) ? want : ((dms[0] || channels[0] || {}).id || null);
  if (curCh) subConv(curCh);
}
function onMsgs(cid, list){
  const prev = chMsgs[cid] || [];
  const prevIds = new Set(prev.map(m => m.id));
  chMsgs[cid] = list.slice().sort((a,b) => a.ts - b.ts);
  // first snapshot = history, except for a conversation that appears while the app is already running (a brand-new DM)
  if (chFirst[cid] || Date.now() - BOOT_TS > 8000){
    for (const m of chMsgs[cid]){
      if (prevIds.has(m.id) || m.uid === uid || Date.now() - m.ts > 60000) continue;
      const muted = settings.muted[cid];
      const here = cid === curCh && view === "chat" && !document.hidden;
      if (isDmId(cid)){ if (!muted){ playSfx("dm"); notifyDesktop(m, cid, true); if (!here) popMsg(m, cid, true); } }
      else if (isMentioned(m)){ playSfx("mention"); notifyDesktop(m, cid, true); if (!here) popMsg(m, cid, true); }
      else if (!muted){ if (!here || settings.sfx.msg) playSfx("msg"); if (settings.notifyAll){ notifyDesktop(m, cid, false); if (!here) popMsg(m, cid, false); } }
    }
  }
  chFirst[cid] = true;
  if (cid === curCh) renderMsgs(false);
  markRead(); renderChannels(); renderChatBadge();
}
function unreadInfo(cid){
  const lr = lastRead[cid] || 0, list = chMsgs[cid] || [];
  let unread = false, mentions = 0;
  for (const m of list) if (m.ts > lr && m.uid !== uid){ unread = true; if (pings(m, cid) && !(isDmId(cid) && settings.muted[cid])) mentions++; }
  return { unread, mentions };
}
function markRead(){
  if (!curCh || view !== "chat" || document.hidden) return;
  const list = chMsgs[curCh] || []; if (!list.length) return;
  const last = list[list.length - 1].ts;
  if ((lastRead[curCh] || 0) < last){ lastRead[curCh] = last; saveRead(); renderChannels(); renderChatBadge(); }
}
function renderChatBadge(){
  let mentions = 0, anyUnread = false;
  for (const c of channels.concat(dms)){ const u = unreadInfo(c.id); mentions += u.mentions; if (u.unread && !settings.muted[c.id]) anyUnread = true; }
  const b = $("chatBadge");
  b.textContent = mentions ? (mentions > 99 ? "99+" : String(mentions)) : "";
  b.classList.toggle("hidden", !mentions && !anyUnread);
  b.classList.toggle("dotonly", !mentions && anyUnread);
  document.title = (mentions ? "(" + mentions + ") " : anyUnread ? "• " : "") + "FolkChat";
}
// ---------- in-app popups (Discord-style) for messages from other conversations ----------
const BOOT_TS = Date.now();
const popTimers = {};
function msgPreview(m){
  if (m.text){
    const t = m.text.replace(/\|\|[^|]+\|\|/g, "▒▒▒").replace(/[*_~`]{1,3}/g, "").replace(/\s+/g, " ").trim();
    if (t) return t.slice(0, 160);
  }
  return m.gif ? "🎞️ GIF" : (m.img || m.pic) ? "🖼️ Imagine" : "…";
}
function popMsg(m, cid, important){
  if (!settings.popups || document.hidden) return;   // in the background the system notification takes over
  let box = $("popBox");
  if (!box){ box = h("div",{id:"popBox",class:"pop-box","aria-live":"polite"}); document.body.append(box); }
  const p = P(m.uid) || {}, dm = isDmId(cid);
  const key = "pop-" + cid;
  let el = document.getElementById(key), count = 1;
  if (el){ count = (+el.dataset.n || 1) + 1; el.remove(); }
  const open = () => { close(); location.hash = "#chat"; selectChannel(cid); };
  const close = () => { clearTimeout(popTimers[key]); el.classList.add("out"); setTimeout(() => el.remove(), 180); };
  const av = avatar(m.uid, "sm");
  el = h("div",{id:key,class:"pop" + (important ? " imp" : ""),role:"button",tabindex:"0",title:"Deschide conversația"},
    av,
    h("div",{class:"pop-body"},
      h("div",{class:"pop-head"},
        h("b",{style:"color:" + accent(p),text:p.tag || "Cineva"}),
        h("span",{class:"pop-where",text: dm ? "mesaj privat" : convName(cid)}),
        count > 1 ? h("span",{class:"pop-n",text:"+" + (count - 1)}) : null),
      h("div",{class:"pop-txt",text:msgPreview(m)})),
    h("button",{type:"button",class:"pop-x","aria-label":"Închide",text:"✕",onclick:ev => { ev.stopPropagation(); close(); }}));
  el.dataset.n = count;
  let sx = null, moved = false;
  el.onclick = () => { if (moved){ moved = false; return; } open(); };
  el.onkeydown = e => { if (e.key === "Enter") open(); };
  // swipe sideways to dismiss on phones
  el.addEventListener("pointerdown", e => { sx = e.clientX; moved = false; });
  el.addEventListener("pointermove", e => { if (sx === null) return; const dx = e.clientX - sx; if (Math.abs(dx) > 6){ moved = true; el.style.transform = "translateX(" + dx + "px)"; el.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 160)); } });
  const end = e => { if (sx === null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 80) close(); else { el.style.transform = ""; el.style.opacity = ""; } };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  const arm = () => { clearTimeout(popTimers[key]); popTimers[key] = setTimeout(close, important ? 7000 : 5000); };
  el.onmouseenter = () => clearTimeout(popTimers[key]); el.onmouseleave = arm;
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  arm();
}
function notifyDesktop(m, cid, mention){
  if (!settings.notify || !("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  const p = P(m.uid) || {};
  try {
    const n = new Notification(isDmId(cid) ? "💬 " + (p.tag || "Cineva") + " (mesaj privat)" : (mention ? "@ " : "") + (p.tag || "Cineva") + " · " + convName(cid), { body: m.text ? m.text.slice(0, 140) : (m.img ? "🖼️ imagine" : "🎞️ GIF"), tag: "sebo-" + cid, silent: true });
    n.onclick = () => { window.focus(); location.hash = "#chat"; selectChannel(cid); n.close(); };
  } catch(e){}
}
function selectChannel(cid){
  if (!cid || cid === curCh){ closeDrawer(); return; }
  const prev = curCh;
  curCh = cid; try { localStorage.setItem("sebo:ch", cid); } catch(e){}
  if (prev){ delete chOlder[prev]; delete chEnd[prev]; if (chUnsub[prev]) subConv(prev); }   // shrink the old chat's listener back to 5
  subConv(cid);
  replyTo = null; editing = null; renderReplyBar();
  renderChannels(); renderChatHeader(); renderMsgs(true); markRead(); renderTyping(); closeDrawer();
  if (!isMobileLayout()) setTimeout(() => $("chatIn").focus(), 30);
  fitChat();
}
function closeDrawer(){ document.querySelector(".dc").classList.remove("drawer"); }

function renderChannels(){
  if (!me) return;
  const box = $("chList");
  box.replaceChildren(...channels.map(c => {
    const u = unreadInfo(c.id), muted = !!settings.muted[c.id];
    return h("div",{class:"ch" + (c.id === curCh ? " on" : "") + (u.unread && !muted ? " unread" : "") + (muted ? " muted" : ""), onclick:() => selectChannel(c.id), title:c.topic || ""},
      h("span",{class:"ch-ico",text: c.emoji || "#"}),
      h("span",{class:"ch-name grow",text:c.name}),
      u.mentions ? h("span",{class:"badge",text:String(u.mentions)}) : null,
      isAdmin ? h("button",{type:"button",class:"ch-edit",title:"Editează canalul","aria-label":"Editează canalul",text:"⚙",onclick:ev => { ev.stopPropagation(); channelModal(c); }}) : null);
  }), ...(channels.length ? [] : isAdmin ? [h("div",{class:"note",style:"padding:4px 10px 8px;font-size:12.5px",text:"Niciun canal. Apasă ＋ dacă vrei unul pentru toată lumea."})] : []));
  $("chAdd").classList.toggle("hidden", !isAdmin);
  $("chSection").classList.toggle("hidden", !isAdmin && !channels.length);
  // DMs: existing conversations + the one you just opened (if it has no messages yet)
  const list = dms.filter(c => profiles[c.other]);
  if (isDmId(curCh) && !list.some(c => c.id === curCh) && profiles[dmOther(curCh)]) list.unshift({ id: curCh, other: dmOther(curCh), last: Date.now() });
  $("dmList").replaceChildren(...list.map(c => {
    const u = unreadInfo(c.id), muted = !!settings.muted[c.id], p = P(c.other);
    const lastMsg = (chMsgs[c.id] || []).slice(-1)[0];
    const prev = lastMsg ? (lastMsg.uid === uid ? "Tu: " : "") + (lastMsg.text || (lastMsg.img ? "🖼️ imagine" : "🎞️ GIF")) : "Conversație nouă";
    return h("div",{class:"ch dm" + (c.id === curCh ? " on" : "") + (u.unread && !muted ? " unread" : "") + (muted ? " muted" : ""), onclick:() => selectChannel(c.id)},
      avatar(c.other,"sm"),
      h("div",{class:"grow",style:"min-width:0"}, h("div",{class:"ch-name",text:p.tag}), h("div",{class:"dm-prev",text:prev})),
      u.mentions ? h("span",{class:"badge",text:String(u.mentions)}) : null);
  }), ...(list.length ? [] : [h("div",{class:"note",style:"padding:4px 10px 8px;font-size:12.5px",text:"Niciun mesaj privat încă. Apasă ＋ sau 💬 lângă un membru."})]));
  renderUserPanel();
}
function openDm(id){
  if (!profiles[id] || id === uid) return;
  closeProfile();
  if (location.hash !== "#chat") location.hash = "#chat";
  selectChannel(D.dmId(id));
}
function dmPicker(){
  const q = h("input",{placeholder:"Caută un membru…",type:"search"});
  const box = h("div",{class:"dm-pick"});
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const ids = Object.keys(profiles).filter(id => id !== uid && P(id).tag.toLowerCase().includes(t)).sort((a,b) => (online.has(b)-online.has(a)) || P(a).tag.localeCompare(P(b).tag));
    box.replaceChildren(...(ids.length ? ids.map(id => h("div",{class:"mem",onclick:() => openDm(id)}, avatar(id,"sm"), h("div",{class:"grow"}, h("div",{class:"mem-n",style:"color:" + accent(P(id)),text:P(id).tag}), h("div",{class:"mem-s",text: online.has(id) ? "online" : "offline"})))) : [h("div",{class:"note",style:"padding:10px",text:"Nimeni găsit."})]));
  };
  q.addEventListener("input", draw); draw();
  openModal(h("div",{class:"modal small"},
    h("button",{class:"close",type:"button","aria-label":"Închide",text:"✕",onclick:closeProfile}),
    h("div",{class:"bd",style:"margin-top:0;padding-top:20px"},
      h("h3",{style:"margin:0 0 4px",text:"Mesaj privat nou"}),
      h("p",{class:"note",style:"margin:0 0 10px",text:"Doar tu și persoana aleasă puteți vedea conversația. Nici adminul nu o poate citi."}),
      q, box)));
  setTimeout(() => q.focus(), 30);
}
function renderUserPanel(){
  if (!me) return;
  $("userPanel").replaceChildren(
    h("div",{class:"up-me",onclick:() => openProfile(uid)}, avatar(uid,"sm"),
      h("div",{class:"grow",style:"min-width:0"}, h("div",{class:"up-name",text:me.tag}), h("div",{class:"up-st",text: me.status || "Online"}))),
    h("button",{type:"button",class:"icon",title: settings.sound ? "Oprește sunetele" : "Pornește sunetele","aria-label":"Sunete",text: settings.sound ? "🔊" : "🔇",onclick:() => { settings.sound = !settings.sound; saveSettings(); renderUserPanel(); if (settings.sound) playSfx("test"); }}),
    h("button",{type:"button",class:"icon",title:"Setări","aria-label":"Setări",text:"⚙️",onclick:openSettings}));
}
function renderChatHeader(){
  const dm = isDmId(curCh), c = dm ? null : channels.find(x => x.id === curCh), other = dm ? P(dmOther(curCh)) : null;
  const has = !!(c || other);
  $("chHead").replaceChildren(...[
    h("button",{type:"button",class:"icon dc-burger",title:"Conversații","aria-label":"Arată conversațiile",text:"☰",onclick:() => document.querySelector(".dc").classList.toggle("drawer")}),
    dm && other ? avatar(dmOther(curCh),"sm") : h("span",{class:"ch-ico big",text: c ? (c.emoji || "#") : "💬"}),
    h("b",{text: dm ? (other ? other.tag : "?") : c ? c.name : "Mesaje"}),
    dm ? h("span",{class:"ch-topic grow",text:"🔒 Conversație privată" + (online.has(dmOther(curCh)) ? " · online" : "")}) : c && c.topic ? h("span",{class:"ch-topic grow",text:c.topic}) : h("span",{class:"grow"}),
    dm && other ? h("button",{type:"button",class:"icon callbtn" + (call.pair ? " off" : ""),title: call.pair ? "Ești deja într-un apel" : "Apel vocal","aria-label":"Sună",text:"📞",onclick:() => startCallTo(dmOther(curCh))}) : null,
    has ? h("button",{type:"button",class:"icon",title: settings.muted[curCh] ? "Activează notificările" : "Dezactivează notificările","aria-label":"Mute",text: settings.muted[curCh] ? "🔕" : "🔔",onclick:() => { settings.muted[curCh] = !settings.muted[curCh]; if (!settings.muted[curCh]) delete settings.muted[curCh]; saveSettings(); renderChatHeader(); renderChannels(); renderChatBadge(); }}) : null,
    h("button",{type:"button",class:"icon dc-memtoggle",title:"Membri","aria-label":"Arată membrii",text:"👥",onclick:() => document.querySelector(".dc").classList.toggle("nomembers")})].filter(Boolean));
  $("chatIn").placeholder = dm ? "Mesaj către @" + (other ? other.tag : "") : c ? "Mesaj #" + c.name : "Alege o conversație";
  $("chatIn").disabled = !has; $("chatBtn").disabled = !has;
  $("fmtHint").textContent = "**bold** *italic* __subliniat__ ~~tăiat~~ `cod` ||spoiler||" + (dm ? "" : " · @nume") + " · ↑ editează ultimul mesaj";
}

// ---------- rich text: **bold** *italic* __underline__ ~~strike~~ `code` ||spoiler|| links @mentions ----------
const TAGRE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\|\|[^|\n]+\|\||`[^`\n]+`|\*[^*\n]+\*|https?:\/\/[^\s<]+|@[^\s@]+)/g;
function richText(text){
  const frag = document.createDocumentFragment();
  const tags = {}; for (const id in profiles) tags[profiles[id].tag.toLowerCase()] = id;
  for (const part of String(text).split(TAGRE)){
    if (!part) continue;
    let el = null;
    if (/^\*\*[^*]+\*\*$/.test(part)) el = h("strong",{text:part.slice(2,-2)});
    else if (/^__[^_]+__$/.test(part)) el = h("u",{text:part.slice(2,-2)});
    else if (/^~~[^~]+~~$/.test(part)) el = h("s",{text:part.slice(2,-2)});
    else if (/^\|\|[^|]+\|\|$/.test(part)){ el = h("span",{class:"spoiler",text:part.slice(2,-2),title:"Spoiler – click ca să vezi"}); el.onclick = () => el.classList.add("shown"); }
    else if (/^`[^`]+`$/.test(part)) el = h("code",{class:"ic",text:part.slice(1,-1)});
    else if (/^\*[^*]+\*$/.test(part)) el = h("em",{text:part.slice(1,-1)});
    else if (/^https?:\/\//.test(part)){
      const clean = part.replace(/[.,!?)\]]+$/,""), rest = part.slice(clean.length);
      el = document.createDocumentFragment();
      el.append(h("a",{href:clean,target:"_blank",rel:"noopener noreferrer nofollow",text:clean}), rest);
    }
    else if (part.startsWith("@")){
      const name = part.slice(1).toLowerCase().replace(/[.,!?:;]+$/,""), id = tags[name];
      if (name === "everyone") el = h("span",{class:"mention",text:part});
      else if (id){ el = h("span",{class:"mention" + (id === uid ? " me" : ""),text:part}); el.onclick = () => openProfile(id); }
    }
    frag.append(el || document.createTextNode(part));
  }
  return frag;
}
function parseMentions(text){
  const ids = new Set(); let everyone = false;
  const tags = {}; for (const id in profiles) tags[profiles[id].tag.toLowerCase()] = id;
  for (const m of String(text).matchAll(/@([^\s@]+)/g)){
    const n = m[1].toLowerCase().replace(/[.,!?:;]+$/,"");
    if (n === "everyone") everyone = true; else if (tags[n]) ids.add(tags[n]);
  }
  return { mentions: [...ids].slice(0, 25), everyone };
}

// ---------- message list ----------
function nearBottom(el){ return el.scrollHeight - el.scrollTop - el.clientHeight < 140; }
function scrollChat(force){ const el = $("msgs"); if (force || nearBottom(el)) requestAnimationFrame(() => el.scrollTop = el.scrollHeight); }
function renderChatAll(){ renderChannels(); renderChatHeader(); renderMsgs(false); renderMembers(); renderChatBadge(); }
function renderMsgs(force){
  if (!me) return;
  const box = $("msgs");
  const stick = force || nearBottom(box);
  const full = convList(curCh), list = full.filter(m => profiles[m.uid]);
  if (!curCh){ box.replaceChildren(h("div",{class:"empty"}, h("div",{style:"font-size:42px",text:"💬"}), h("h3",{text:"Mesaje private"}), h("p",{class:"note",text:"Alege pe cineva din stânga sau apasă 💬 lângă un membru ca să-i scrii. Conversațiile sunt doar între voi doi."}), h("button",{type:"button",class:"primary",text:"Mesaj nou",onclick:dmPicker}))); return; }
  let out;
  if (isDmId(curCh)){
    const oid = dmOther(curCh), op = P(oid) || {};
    out = [h("div",{class:"ch-welcome"}, h("span",{class:"av lg",style:"border-color:" + accent(op)}, op.avatar ? h("img",{src:op.avatar,alt:"",class:"av-img"}) : (op.emoji || "❔")), h("h3",{text:op.tag || "?"}), h("div",{class:"note",text:"Ăsta e începutul conversației tale private cu " + (op.tag || "?") + ". 🔒 Doar voi doi o puteți vedea."}))];
  } else {
    const c = channels.find(x => x.id === curCh) || {};
    out = [h("div",{class:"ch-welcome"}, h("div",{class:"ch-welcome-ico",text:c.emoji || "#"}), h("h3",{text:"Bun venit în #" + (c.name || "")}), h("div",{class:"note",text: c.topic || "Ăsta e începutul canalului."}))];
  }
  if (full.length >= LIVE_N && !chEnd[curCh]) out.push(h("button",{type:"button",class:"tiny older-btn",text:"Încarcă mesaje mai vechi",onclick:ev => loadOlderMsgs(ev.currentTarget)}));
  const lr = lastRead[curCh] || 0; let newLine = false;
  let lastDay = null, last = null;
  for (const m of list){
    const dk = dayKey(new Date(m.ts));
    if (dk !== lastDay){ out.push(h("div",{class:"daysep"}, h("span",{text:niceDay(dk)}))); lastDay = dk; last = null; }
    if (!newLine && m.ts > lr && m.uid !== uid && lr){ out.push(h("div",{class:"newsep"}, h("span",{text:"NOI"}))); newLine = true; last = null; }
    const grouped = last && last.uid === m.uid && m.ts - last.ts < 5*60000 && !m.reply;
    out.push(msgEl(m, grouped));
    last = m;
  }
  box.replaceChildren(...out);
  if (stick) scrollChat(true);
}
function msgEl(m, grouped){
  const mine = m.uid === uid, canDel = mine || (isAdmin && !isDmId(curCh));
  const row = h("div",{class:"msg" + (grouped ? "" : " first") + (!isDmId(curCh) && isMentioned(m) ? " mentioned" : ""), "data-id":m.id});
  const tools = h("div",{class:"mtools"},
    h("button",{type:"button",title:"Reacționează","aria-label":"Reacționează",text:"😀",onclick:ev => rxPicker(ev.currentTarget, m)}),
    h("button",{type:"button",title:"Răspunde","aria-label":"Răspunde",text:"↩",onclick:() => startReply(m)}),
    mine ? h("button",{type:"button",title:"Editează","aria-label":"Editează",text:"✎",onclick:() => startEdit(m)}) : null,
    canDel ? h("button",{type:"button",title:"Șterge","aria-label":"Șterge",class:"danger",text:"🗑",onclick:ev => { const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sigur?"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "🗑"; }, 3000); return; } D.deleteMsg(curCh, m.id, m.img, m.pic && m.pic.url).catch(writeErr); }}) : null);
  const body = h("div",{class:"grow mbody"});
  if (m.reply && typeof m.reply === "object"){
    const rp = P(m.reply.uid);
    body.append(h("div",{class:"mreply",onclick:() => jumpTo(m.reply.id)}, h("span",{class:"mreply-l"}), avatar(m.reply.uid,"xs"),
      h("b",{style:"color:" + accent(rp),text:(rp && rp.tag) || "?"}), h("span",{class:"mreply-t",text: m.reply.text || "📎 atașament"})));
  }
  if (!grouped || m.reply) body.append(h("div",{class:"who"}, nameEl(m.uid), P(m.uid) && P(m.uid).role === "admin" ? h("span",{class:"pill tiny-pill",text:"ADMIN"}) : null, h("span",{class:"mtime",text:fullTime(m.ts)})));
  if (editing === m.id){
    const ta = h("textarea",{class:"editbox",maxlength:"2000"}); ta.value = m.text || "";
    ta.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); const t = ta.value.trim(); if (!t && !m.img && !m.gif && !m.pic) return; D.editMsg(curCh, m.id, t.slice(0,2000)).then(() => { editing = null; renderMsgs(false); }).catch(writeErr); }
      if (e.key === "Escape"){ editing = null; renderMsgs(false); }
    });
    body.append(ta, h("div",{class:"note",style:"font-size:12px",text:"Enter = salvează · Esc = anulează"}));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 20);
  } else if (m.text){
    body.append(h("div",{class:"txt"}, richText(m.text), m.edited ? h("span",{class:"edited",text:" (editat)"}) : null));
  }
  if (m.img || m.gif || m.pic) body.append(h("div",{class:"attwrap"}, attEl(m)));
  const rx = m.rx || {}, counts = {};
  for (const k in rx) if (rx[k]){ const [key, who] = [k.slice(0, k.indexOf("_")), k.slice(k.indexOf("_") + 1)]; (counts[key] = counts[key] || []).push(who); }
  const chips = MSG_RX.filter(([k]) => counts[k]).map(([k,e]) => h("button",{type:"button",class:"rx" + (counts[k].includes(uid) ? " on" : ""),title:counts[k].map(id => (P(id)||{}).tag || "?").join(", "),onclick:() => toggleRx(m, k)}, e + " " + counts[k].length));
  if (chips.length) body.append(h("div",{class:"rxs"}, chips));
  row.append(grouped && !m.reply ? h("div",{class:"gutter"}, h("span",{class:"gtime",text:timeStr(m.ts)})) : avatar(m.uid), body, tools);
  return row;
}
function fullTime(ts){
  const dk = dayKey(new Date(ts)), t = todayKey();
  return (dk === t ? "Azi la " : dk === shiftDay(t,-1) ? "Ieri la " : new Date(ts).toLocaleDateString("ro-RO",{day:"numeric",month:"short"}) + ", ") + timeStr(ts);
}
function jumpTo(id){
  const el = document.querySelector('.msg[data-id="' + CSS.escape(id) + '"]');
  if (!el){ flash("Mesajul original nu mai e în ultimele mesaje."); return; }
  el.scrollIntoView({ block:"center", behavior: settings.reduceMotion ? "auto" : "smooth" });
  el.classList.add("flashmsg"); setTimeout(() => el.classList.remove("flashmsg"), 1600);
}
const rxBusy = new Set();
async function toggleRx(m, key){
  if (rxBusy.has(m.id)) return; rxBusy.add(m.id);
  const on = !(m.rx && m.rx[key + "_" + uid]);
  try { await D.reactMsg(curCh, m.id, key, on); if (on) playSfx("react"); } catch(e){ writeErr(e); } finally { rxBusy.delete(m.id); }
}
let rxPop = null;
function rxPicker(anchor, m){
  if (rxPop){ rxPop.remove(); rxPop = null; }
  rxPop = h("div",{class:"rx-pop"}, MSG_RX.map(([k,e]) => h("button",{type:"button",title:k,text:e,onclick:() => { rxPop.remove(); rxPop = null; toggleRx(m, k); }})));
  document.body.append(rxPop);
  const r = anchor.getBoundingClientRect();
  rxPop.style.top = Math.max(8, r.top - 50) + "px"; rxPop.style.left = Math.max(8, Math.min(window.innerWidth - 340, r.right - 320)) + "px";
}
document.addEventListener("click", e => { if (rxPop && !rxPop.contains(e.target) && !e.target.closest(".mtools")){ rxPop.remove(); rxPop = null; } });
function startReply(m){ replyTo = m; editing = null; renderReplyBar(); $("chatIn").focus(); }
function startEdit(m){ editing = m.id; replyTo = null; renderReplyBar(); renderMsgs(false); }
function renderReplyBar(){
  const bar = $("replyBar");
  if (!replyTo){ bar.classList.add("hidden"); bar.replaceChildren(); return; }
  const p = P(replyTo.uid) || {};
  bar.replaceChildren(h("span",{class:"note",text:"Răspunzi lui "}), h("b",{style:"color:" + accent(p),text:p.tag || "?"}),
    h("span",{class:"note grow",style:"overflow:hidden;white-space:nowrap;text-overflow:ellipsis",text:" · " + (replyTo.text || "atașament")}),
    h("button",{type:"button",class:"icon",title:"Anulează","aria-label":"Anulează răspunsul",text:"✕",onclick:() => { replyTo = null; renderReplyBar(); }}));
  bar.classList.remove("hidden");
}

// ---------- members sidebar ----------
function renderMembers(){
  if (!me) return;
  const ids = Object.keys(profiles).sort((a,b) => P(a).tag.localeCompare(P(b).tag));
  const on = ids.filter(id => online.has(id)), off = ids.filter(id => !online.has(id));
  const row = id => { const p = P(id); return h("div",{class:"mem" + (online.has(id) ? "" : " off"),onclick:() => openProfile(id)}, avatar(id,"sm"),
    h("div",{class:"grow",style:"min-width:0"}, h("div",{class:"mem-n",style:"color:" + accent(p)}, p.tag, p.role === "admin" ? " 👑" : ""), p.status ? h("div",{class:"mem-s",text:p.status}) : null),
    id !== uid ? h("button",{type:"button",class:"icon mem-dm",title:"Mesaj privat","aria-label":"Mesaj privat către " + p.tag,text:"💬",onclick:ev => { ev.stopPropagation(); openDm(id); }}) : null); };
  $("memList").replaceChildren(h("div",{class:"h2",text:"Online — " + on.length}), ...on.map(row),
    ...(off.length ? [h("div",{class:"h2",style:"margin-top:14px",text:"Offline — " + off.length})] : []), ...off.map(row));
}
// Typing indicators were removed on purpose: they cost a database write on every keystroke burst.
function renderTyping(){ $("typing").textContent = ""; }

// ---------- composer: mentions autocomplete, send ----------
let mentionPop = null, mentionSel = 0, mentionItems = [];
function updateMentionPop(){
  const ci = $("chatIn"), before = ci.value.slice(0, ci.selectionStart), m = isDmId(curCh) ? null : before.match(/(^|\s)@([^\s@]*)$/);
  if (!m){ closeMentionPop(); return; }
  const q = m[2].toLowerCase();
  mentionItems = Object.keys(profiles).filter(id => P(id).tag.toLowerCase().startsWith(q)).sort((a,b) => (online.has(b)-online.has(a)) || P(a).tag.localeCompare(P(b).tag)).slice(0, 7).map(id => ({ id, tag: P(id).tag }));
  if ("everyone".startsWith(q)) mentionItems.push({ id:"everyone", tag:"everyone" });
  if (!mentionItems.length){ closeMentionPop(); return; }
  mentionSel = Math.min(mentionSel, mentionItems.length - 1);
  if (!mentionPop){ mentionPop = h("div",{class:"mention-pop"}); $("composerWrap").append(mentionPop); }
  mentionPop.replaceChildren(h("div",{class:"h2",style:"margin:4px 6px 6px",text:"Membri"}), ...mentionItems.map((it, i) => h("div",{class:"mp-item" + (i === mentionSel ? " on" : ""),onmousedown:e => { e.preventDefault(); pickMention(i); }},
    it.id === "everyone" ? h("span",{class:"av sm",text:"📣"}) : avatar(it.id,"sm"), h("b",{text:it.tag}), it.id === "everyone" ? h("span",{class:"note",text:" anunță pe toată lumea"}) : online.has(it.id) ? h("span",{class:"note",text:" online"}) : null)));
}
function closeMentionPop(){ if (mentionPop){ mentionPop.remove(); mentionPop = null; } mentionSel = 0; }
function pickMention(i){
  const ci = $("chatIn"), it = mentionItems[i]; if (!it) return;
  const pos = ci.selectionStart, before = ci.value.slice(0, pos).replace(/@([^\s@]*)$/, "@" + it.tag + " ");
  ci.value = before + ci.value.slice(pos); ci.setSelectionRange(before.length, before.length);
  closeMentionPop(); ci.focus();
}
let typingNow = false, typingOff = null;
function bindChat(){
  const ci = $("chatIn");
  chatAtt = attachBox("chat");
  $("chAdd").onclick = () => channelModal(null);
  $("dmAdd").onclick = dmPicker;
  $("voiceAdd").onclick = () => voiceRoomModal(null);
  ci.addEventListener("input", () => {
    ci.style.height = "auto"; ci.style.height = Math.min(180, ci.scrollHeight) + "px";
    updateMentionPop();
  });
  ci.addEventListener("click", updateMentionPop);
  ci.addEventListener("blur", () => setTimeout(closeMentionPop, 120));
  ci.addEventListener("keydown", e => {
    if (mentionPop){
      if (e.key === "ArrowDown"){ e.preventDefault(); mentionSel = (mentionSel + 1) % mentionItems.length; updateMentionPop(); return; }
      if (e.key === "ArrowUp"){ e.preventDefault(); mentionSel = (mentionSel - 1 + mentionItems.length) % mentionItems.length; updateMentionPop(); return; }
      if (e.key === "Enter" || e.key === "Tab"){ e.preventDefault(); pickMention(mentionSel); return; }
      if (e.key === "Escape"){ closeMentionPop(); return; }
    }
    if (e.key === "Escape" && replyTo){ replyTo = null; renderReplyBar(); }
    if (e.key === "ArrowUp" && !ci.value){ const mine = (chMsgs[curCh] || []).filter(m => m.uid === uid && m.text).pop(); if (mine){ e.preventDefault(); startEdit(mine); } }
    if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); $("chatForm").requestSubmit(); }
  });
  ci.addEventListener("paste", e => { const f = [...(e.clipboardData && e.clipboardData.files || [])].find(f => f.type.startsWith("image/")); if (f){ e.preventDefault(); chatAtt.useFile(f); } });
  const main = document.querySelector(".dc-main");
  main.addEventListener("dragover", e => { e.preventDefault(); main.classList.add("drop"); });
  main.addEventListener("dragleave", e => { if (!main.contains(e.relatedTarget)) main.classList.remove("drop"); });
  main.addEventListener("drop", e => { e.preventDefault(); main.classList.remove("drop"); const f = e.dataTransfer.files[0]; if (f) chatAtt.useFile(f); });
  let sending = false;
  $("chatForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (sending || !curCh) return;
    const text = ci.value.trim(), att = chatAtt.get(); if (!text && !att) return;
    const { mentions, everyone } = isDmId(curCh) ? { mentions: [], everyone: false } : parseMentions(text);
    const extra = {};
    if (mentions.length) extra.mentions = mentions;
    if (everyone) extra.everyone = true;
    if (replyTo) extra.reply = { id: replyTo.id, uid: replyTo.uid, text: (replyTo.text || "").slice(0, 140) };
    sending = true; $("chatBtn").disabled = true;
    ci.value = ""; ci.style.height = "auto"; closeMentionPop();
    const cid = curCh;
    try {
      if (att && att.img) $("chatBtn").textContent = "Se încarcă…";
      await D.sendMsg(cid, text.slice(0,2000), await finalizeAtt(att, isDmId(cid) ? "dm" : "chat"), extra);
      chatAtt.clear(); replyTo = null; renderReplyBar(); playSfx("send"); scrollChat(true);
      const preview = text ? text.slice(0, 100) : "📎 atașament";
      if (isDmId(cid)) D.pushNotify({ type: "dm", cid: cid.slice(3), text: preview });
      else if (mentions.length || everyone) D.pushNotify({ type: "mention", ch: cid, to: everyone ? ["*"] : mentions.slice(0, 25), text: preview });
    }
    catch(e){ ci.value = text; writeErr(e); }
    finally { sending = false; $("chatBtn").disabled = false; $("chatBtn").textContent = "Trimite"; }
  });
}

// ---------- admin: channel editor ----------
function channelModal(c){
  const name = h("input",{maxlength:"24",placeholder:"ex. clipuri"}); name.value = c ? c.name : "";
  const emo = h("input",{maxlength:"8",placeholder:"💬"}); emo.value = c ? (c.emoji || "") : "💬";
  const topic = h("input",{maxlength:"120",placeholder:"Despre ce e canalul"}); topic.value = c ? (c.topic || "") : "";
  const err = h("div",{class:"err"});
  name.addEventListener("input", () => { name.value = name.value.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""); });
  const idx = c ? channels.findIndex(x => x.id === c.id) : -1;
  async function move(dir){
    const other = channels[idx + dir]; if (!other) return;
    try { await D.updateChannel(c.id, { pos: other.pos || 0 }); await D.updateChannel(other.id, { pos: c.pos || 0 }); closeProfile(); } catch(e){ writeErr(e); }
  }
  const del = c ? h("button",{type:"button",class:"danger-btn",text:"Șterge canalul",onclick:async ev => { const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sigur? Mesajele vor dispărea"; return; } try { await D.deleteChannel(c.id); closeProfile(); } catch(e){ writeErr(e); } }}) : null;
  openModal(h("div",{class:"modal small"},
    h("button",{class:"close",type:"button","aria-label":"Închide",text:"✕",onclick:closeProfile}),
    h("div",{class:"bd",style:"margin-top:0;padding-top:20px"},
      h("h3",{style:"margin:0 0 4px",text: c ? "Editează #" + c.name : "Canal nou"}),
      h("label",{text:"Nume"}), name, h("label",{text:"Emoji"}), emo, h("label",{text:"Descriere"}), topic,
      c ? h("div",{class:"row",style:"margin-top:12px"}, h("button",{type:"button",text:"▲ Mută sus",disabled: idx <= 0,onclick:() => move(-1)}), h("button",{type:"button",text:"▼ Mută jos",disabled: idx >= channels.length - 1,onclick:() => move(1)})) : null,
      err,
      h("div",{class:"row",style:"margin-top:14px"}, del, h("span",{class:"grow"}), h("button",{type:"button",class:"primary",text: c ? "Salvează" : "Creează",onclick:async () => {
        const n = name.value.trim(); if (!/^[a-z0-9-]{1,24}$/.test(n)){ err.textContent = "Numele poate avea doar litere mici, cifre și cratime."; return; }
        try {
          if (c) await D.updateChannel(c.id, { name:n, emoji:emo.value.trim().slice(0,8), topic:topic.value.trim().slice(0,120) });
          else { const pos = channels.reduce((mx, x) => Math.max(mx, x.pos || 0), 0) + 1; const id = await D.createChannel({ name:n, emoji:emo.value.trim().slice(0,8), topic:topic.value.trim().slice(0,120), pos }); setTimeout(() => selectChannel(id), 400); }
          closeProfile();
        } catch(e){ err.textContent = "Nu s-a putut salva (" + D.errCode(e) + ")."; }
      }})))));
  setTimeout(() => name.focus(), 30);
}
function openModal(node){ openId = null; $("overlay").replaceChildren(node); $("overlay").classList.remove("hidden"); }

// ---------- settings modal ----------
function openSettings(start){
  const tabs = [["look","🎨 Aspect"],["sound","🔊 Sunete"],["voice","🎙️ Voce"],["notif","🔔 Notificări"]];
  let tab = typeof start === "string" ? start : "look";
  const body = h("div",{class:"set-body"});
  const nav = h("div",{class:"set-nav"});
  const toggle = (label, get, set, hint) => { const cb = h("input",{type:"checkbox"}); cb.checked = !!get(); cb.onchange = () => { set(cb.checked); saveSettings(); }; return h("label",{class:"set-row"}, h("div",{class:"grow"}, h("div",{text:label}), hint ? h("div",{class:"note",text:hint}) : null), cb); };
  function draw(){
    stopMicTest();
    nav.replaceChildren(...tabs.map(([k,l]) => h("button",{type:"button",class:k === tab ? "on" : "",text:l,onclick:() => { tab = k; draw(); }})));
    if (tab === "look"){
      body.replaceChildren(
        h("div",{class:"h2",text:"Temă"}),
        h("div",{class:"theme-grid"}, Object.entries(THEMES).map(([k,t]) => h("button",{type:"button",class:"theme-card" + (settings.theme === k ? " on" : ""),style:"background:" + t.bg + ";color:" + t.text + ";border-color:" + (settings.theme === k ? settings.accent : t.line),onclick:() => { settings.theme = k; saveSettings(); draw(); }},
          h("span",{class:"tc-bar",style:"background:" + t.panel2}), h("span",{class:"tc-bar short",style:"background:" + settings.accent}), h("span",{text:t.name})))),
        h("div",{class:"h2",style:"margin-top:18px",text:"Culoare accent"}),
        h("div",{class:"swatches"}, ACCENTS.map(c => h("button",{type:"button","aria-label":"Accent " + c,class:settings.accent === c ? "on" : "",style:"background:" + c,onclick:() => { settings.accent = c; saveSettings(); draw(); }}))),
        h("div",{class:"h2",style:"margin-top:18px",text:"Mărime text · " + settings.fontSize + "px"}),
        (() => { const r = h("input",{type:"range",min:"13",max:"19",step:"1"}); r.value = settings.fontSize; r.oninput = () => { settings.fontSize = +r.value; saveSettings(); r.parentNode.previousSibling.textContent = "Mărime text · " + settings.fontSize + "px"; }; return h("div",null,r); })(),
        h("div",{class:"h2",style:"margin-top:18px",text:"Afișare"}),
        toggle("Mod compact", () => settings.compact, v => settings.compact = v, "Mesaje mai înghesuite, ca pe Discord compact"),
        toggle("Arată avatarele în chat", () => settings.showAvatars, v => settings.showAvatars = v),
        toggle("Ora în format 24h", () => settings.h24, v => { settings.h24 = v; renderMsgs(false); }),
        toggle("Reduce animațiile", () => settings.reduceMotion, v => settings.reduceMotion = v));
    } else if (tab === "sound"){
      const vol = h("input",{type:"range",min:"0",max:"1",step:"0.05"}); vol.value = settings.volume; vol.oninput = () => { settings.volume = +vol.value; saveSettings(); }; vol.onchange = () => playSfx("test", true);
      const names = { msg:"Mesaj nou", mention:"Mențiune (@tu)", dm:"Mesaj privat", send:"Trimiți un mesaj", react:"Reacție", join:"Cineva intră online" };
      body.replaceChildren(
        toggle("Sunete activate", () => settings.sound, v => { settings.sound = v; renderUserPanel(); }),
        h("div",{class:"h2",style:"margin-top:14px",text:"Volum"}), vol,
        h("div",{class:"h2",style:"margin-top:18px",text:"Efecte"}),
        ...Object.keys(names).map(k => h("div",{class:"row"}, toggle(names[k], () => settings.sfx[k], v => settings.sfx[k] = v), h("button",{type:"button",class:"tiny",text:"▶",title:"Ascultă","aria-label":"Ascultă " + names[k],onclick:() => playSfx(k, true)}))));
    } else if (tab === "voice"){
      voiceSettings(body, toggle, draw);
    } else {
      const can = "Notification" in window;
      body.replaceChildren(
        toggle("Notificări pe desktop", () => settings.notify, async v => {
          if (v && can && Notification.permission !== "granted"){ const r = await Notification.requestPermission(); if (r !== "granted"){ settings.notify = false; saveSettings(); flash("Browserul a blocat notificările.", true); draw(); return; } }
          settings.notify = v; saveSettings(); if (v) maybeWebPush();
        }, can ? "Apar când site-ul e în fundal" : "Browserul tău nu suportă notificări"),
        toggle("Popup în aplicație", () => settings.popups, v => settings.popups = v, "Când primești un mesaj în altă conversație, apare sus cine ți-a scris și ce"),
        toggle("Notifică pentru toate mesajele din canale", () => settings.notifyAll, v => settings.notifyAll = v, "Mesajele private și @mențiunile notifică mereu"),
        h("div",{class:"h2",style:"margin-top:18px",text:"Conversații cu sunetul oprit"}),
        Object.keys(settings.muted).length ? h("div",null, Object.keys(settings.muted).map(id => { const c = isDmId(id) ? (P(dmOther(id)) ? { emoji:"💬", name: P(dmOther(id)).tag } : null) : channels.find(x => x.id === id); return c ? h("div",{class:"row",style:"margin:6px 0"}, h("span",{class:"grow",text:(c.emoji || "#") + " " + c.name}), h("button",{type:"button",class:"tiny",text:"Pornește",onclick:() => { delete settings.muted[id]; saveSettings(); renderChannels(); renderChatHeader(); draw(); }})) : null; })) : h("div",{class:"note",text:"Niciuna. Apasă 🔔 sus într-o conversație ca s-o pui pe mut."}));
    }
  }
  draw();
  openModal(h("div",{class:"modal settings"}, h("button",{class:"close",type:"button","aria-label":"Închide",text:"✕",onclick:closeProfile}),
    h("div",{class:"set-wrap"}, h("div",{class:"set-side"}, h("h3",{text:"Setări"}), nav, h("div",{class:"note",style:"margin-top:auto;font-size:12px",text:"Setările se salvează pe acest dispozitiv."})), body)));
}

// ---------- feed ----------
const reacting = new Set();
async function toggleReact(post, key){
  if (reacting.has(post.id)) return;
  const had = !!(post.reactions && post.reactions[key + "_" + uid]);
  reacting.add(post.id);
  try { await D.react(post.id, key, !had); } catch(e){ writeErr(e); } finally { reacting.delete(post.id); }
}
function reactCount(post, key){ let n = 0; for (const k in (post.reactions||{})) if (k.startsWith(key + "_") && post.reactions[k]) n++; return n; }
function toggleReplies(post){
  if (openReplies.has(post.id)){ const r = openReplies.get(post.id); r.unsub && r.unsub(); openReplies.delete(post.id); renderFeed(); return; }
  const entry = {list:[], unsub:null};
  openReplies.set(post.id, entry);
  entry.unsub = D.watchReplies(post.id, list => { entry.list = list; renderFeed(); });
  renderFeed();
}
async function addReply(post, input){
  const text = input.value.trim(); if (!text) return;
  input.disabled = true;
  try { await D.addReply(post.id, text.slice(0,500)); input.value = ""; } catch(e){ writeErr(e); }
  finally { input.disabled = false; input.focus(); }
}
const pendingDel = new Map();
function confirmTwice(id){ const t = pendingDel.get(id); if (t && Date.now()-t < 4000){ pendingDel.delete(id); return true; } pendingDel.set(id, Date.now()); flash("Apasă din nou pe șterge ca să confirmi."); return false; }
function postCard(post){
  const reacts = h("div",{class:"reacts"});
  for (const [k,e] of REACTS){
    const n = reactCount(post,k), on = !!(post.reactions && post.reactions[k+"_"+uid]);
    reacts.append(h("button",{type:"button",class:on?"on":"",text:e+(n?" "+n:""),onclick:()=>toggleReact(post,k)}));
  }
  const rc = Math.max(0, post.replyCount || 0);
  reacts.append(h("button",{type:"button",class:"link",style:"margin-left:auto",text: openReplies.has(post.id) ? "Ascunde comentariile" : (rc ? "💬 " + rc + (rc===1?" comentariu":" comentarii") : "💬 Comentează"),onclick:()=>toggleReplies(post)}));
  if (post.uid === uid || isAdmin) reacts.append(h("button",{type:"button",class:"link",text:"șterge",onclick:()=>{ if (confirmTwice(post.id)) D.deletePost(post.id, post.img, post.pic && post.pic.url).catch(writeErr); }}));
  let replies = null;
  const entry = openReplies.get(post.id);
  if (entry){
    const input = h("input",{placeholder:"Scrie un comentariu…",maxlength:"500"});
    input.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); addReply(post,input); } });
    replies = h("div",{class:"replies"},
      entry.list.filter(r => profiles[r.uid]).map(r => h("div",{class:"reply"}, avatar(r.uid,"sm"),
        h("div",{class:"grow"}, h("div",null, nameEl(r.uid), h("span",{class:"note",text:"  " + ago(r.ts)}),
          (r.uid===uid||isAdmin) ? h("button",{class:"link",style:"margin-left:8px",type:"button",text:"șterge",onclick:()=>D.deleteReply(post.id, r.id).catch(writeErr)}) : null),
          h("div",{class:"rt"}, withMentions(r.text))))),
      h("div",{class:"row",style:"margin-top:8px"}, input, h("button",{type:"button",class:"tiny",text:"Răspunde",onclick:()=>addReply(post,input)})));
  }
  return h("div",{class:"card post"},
    h("div",{class:"row",style:"align-items:flex-start"}, avatar(post.uid),
      h("div",{class:"grow"},
        h("div",{class:"meta"}, nameEl(post.uid), h("span",{text:ago(post.ts)})),
        post.text ? h("div",{class:"text"}, withMentions(post.text)) : null,
        (post.img || post.gif || post.pic) ? h("div",{class:"attwrap"}, attEl(post)) : null,
        reacts, replies)));
}
let livePosts = [], olderPosts = [], postsEnd = false;
function mergePosts(){
  const seen = new Set(), all = [];
  for (const p of livePosts.concat(olderPosts)) if (!seen.has(p.id)){ seen.add(p.id); all.push(p); }
  posts = all.sort((a,b) => b.ts - a.ts); renderFeed();
}
async function morePosts(btn){
  const oldest = posts.length ? posts[posts.length - 1].ts : Date.now();
  btn.disabled = true; btn.textContent = "Se încarcă…";
  try { const more = await D.loadOlderPosts(oldest); if (more.length < 50) postsEnd = true; olderPosts = olderPosts.concat(more); mergePosts(); }
  catch(e){ writeErr(e); btn.disabled = false; btn.textContent = "Încarcă postări mai vechi"; }
}
function renderFeed(){
  if (!me) return;
  const vis = posts.filter(p => profiles[p.uid]);
  const more = posts.length >= 50 && !postsEnd ? h("button",{type:"button",class:"tiny",style:"display:block;margin:6px auto 20px",text:"Încarcă postări mai vechi",onclick:ev => morePosts(ev.currentTarget)}) : null;
  $("feedList").replaceChildren(...(vis.length ? vis.map(postCard) : [h("div",{class:"empty",text:"Nicio postare încă. Fă tu prima ✨"})]), ...(more ? [more] : []));
}

// ---------- squad ----------
function renderSquad(){
  if (!me) return;
  const ids = Object.keys(profiles).sort((a,b)=> (online.has(b)-online.has(a)) || P(a).tag.localeCompare(P(b).tag));
  $("squadGrid").replaceChildren(...ids.map(id => {
    const p = P(id);
    return h("div",{class:"pcard",onclick:()=>openProfile(id)},
      h("div",{class:"bn",style:"background:"+bannerOf(p)}),
      h("div",{class:"bd"}, avatar(id),
        h("div",{class:"nm",style:"color:"+accent(p)}, p.tag),
        h("div",{class:"row",style:"gap:6px;margin-top:4px;flex-wrap:wrap"}, p.pronouns ? h("span",{class:"pill",text:p.pronouns}) : null, p.role === "admin" ? h("span",{class:"pill",text:"admin"}) : null, online.has(id) ? h("span",{class:"pill",style:"color:var(--green)",text:"● online"}) : null),
        h("div",{class:"bio",text:p.bio || p.status || "Fără bio încă."}),
        id !== uid ? h("button",{type:"button",class:"tiny",style:"margin-top:10px",text:"💬 Mesaj privat",onclick:ev => { ev.stopPropagation(); openDm(id); }}) : null));
  }));
}

// ---------- profile modal ----------
function profileView(id, p, preview){
  const theirPosts = posts.filter(x => x.uid === id).slice(0,3);
  const fact = (k,v) => v ? h("div",{class:"fact"}, h("div",{class:"k",text:k}), h("div",{class:"v",text:v})) : null;
  return [
    h("div",{class:"bn",style:"background:"+bannerOf(p)}),
    h("div",{class:"bd"},
      h("span",{class:"av lg",style:"border-color:var(--panel);box-shadow:0 0 0 3px "+accent(p)}, p.avatar ? h("img",{src:p.avatar,alt:"",class:"av-img"}) : p.emoji, online.has(id) ? h("span",{class:"dot",style:"width:18px;height:18px"}) : null),
      h("div",{class:"nm"}, h("span",{style:"color:"+accent(p),text:p.tag}), p.pronouns ? h("span",{class:"note",style:"font-size:13px;font-weight:500",text:p.pronouns}) : null, p.role === "admin" ? h("span",{class:"pill",text:"admin"}) : null),
      p.status ? h("div",{class:"note",style:"margin-top:2px",text:"“" + p.status + "”"}) : null,
      p.bio ? h("p",{style:"margin:12px 0 0;white-space:pre-wrap",text:p.bio}) : null,
      h("div",{class:"facts"}, fact("Membru din", p.joined ? new Date(p.joined).toLocaleDateString("ro-RO",{day:"numeric",month:"short",year:"numeric"}) : ""), fact("Status", online.has(id) ? "● Online" : "Offline")),
      theirPosts.length ? h("div",{class:"h2",style:"margin-top:18px"},"Postări recente") : null,
      theirPosts.map(x => h("div",{class:"fact",style:"margin-bottom:8px"}, h("div",{class:"k",text:ago(x.ts)}), h("div",{class:"v",style:"font-weight:500;white-space:pre-wrap",text: !x.text ? (x.img ? "🖼️ imagine" : "🎞️ GIF") : x.text.length > 220 ? x.text.slice(0,220)+"…" : x.text}))),
      preview ? null : h("div",{class:"row",style:"margin-top:16px;gap:8px"},
        id === uid ? h("button",{class:"primary",type:"button",text:"Editează profilul",onclick:()=>{ closeProfile(); location.hash = "#me"; }})
                   : h("div",{class:"row",style:"gap:8px;flex-wrap:wrap"},
                       h("button",{class:"primary",type:"button",text:"💬 Trimite mesaj privat",onclick:()=>{ closeProfile(); openDm(id); }}),
                       h("button",{class:"tiny",type:"button",style:"padding:10px 14px",text:"📞 Sună",onclick:()=>{ closeProfile(); startCallTo(id); }}))))
  ];
}
let openId = null;
function openProfile(id){
  const p = P(id); if (!p) return;
  openId = id;
  $("overlay").replaceChildren(h("div",{class:"modal",role:"dialog","aria-label":"Profilul lui "+p.tag}, h("button",{class:"close",type:"button","aria-label":"Închide",text:"✕",onclick:closeProfile}), ...profileView(id,p)));
  $("overlay").classList.remove("hidden");
}
function closeProfile(){ openId = null; $("overlay").classList.add("hidden"); }

// ---------- my profile ----------
let draft = null;
function fillMeForm(){
  if (!me) return;
  draft = Object.assign({bio:"",color:COLORS[0],banner:"neon",status:"",avatar:"",pronouns:""}, me);
  $("mPron").value = draft.pronouns || "";
  $("mPron").oninput = () => { draft.pronouns = $("mPron").value; renderPreview(); };
  const drawAv = () => $("mAvPrev").replaceChildren(draft.avatar ? h("img",{src:draft.avatar,alt:"",class:"av-img"}) : document.createTextNode(draft.emoji || "❔"));
  drawAv();
  $("mAvRemove").classList.toggle("hidden", !draft.avatar);
  $("mAvRemove").onclick = () => { draft.avatar = ""; drawAv(); $("mAvRemove").classList.add("hidden"); renderPreview(); };
  $("mAvUpload").onclick = () => $("mAvFile").click();
  $("mAvFile").onchange = async () => {
    const f = $("mAvFile").files[0]; $("mAvFile").value = ""; if (!f) return;
    try { draft.avatar = await makeAvatar(f); drawAv(); $("mAvRemove").classList.remove("hidden"); renderPreview(); }
    catch(e){ flash(e.message || "Poza nu a putut fi încărcată.", true); }
  };
  $("mTag").value = draft.tag; $("mBio").value = draft.bio; $("mStatus").value = draft.status;
  emojiPicker($("mEmoji"), () => draft.emoji, e => { draft.emoji = e; renderPreview(); });
  const sw = $("mColor");
  sw.replaceChildren(...COLORS.map(c => h("button",{type:"button","aria-label":"Color "+c,class:c===draft.color?"on":"",style:"background:"+c,onclick:()=>{ draft.color = c; for (const b of sw.children) b.classList.toggle("on", b.getAttribute("aria-label")==="Color "+c); renderPreview(); }})));
  const bn = $("mBanner");
  bn.replaceChildren(...Object.keys(BANNERS).map(k => h("button",{type:"button",title:k,"aria-label":"Banner "+k,class:k===draft.banner?"on":"",style:"background:"+BANNERS[k],onclick:()=>{ draft.banner = k; for (const b of bn.children) b.classList.toggle("on", b.title===k); renderPreview(); }})));
  for (const [id,f] of [["mTag","tag"],["mBio","bio"],["mStatus","status"]]) $(id).oninput = () => { draft[f] = $(id).value; renderPreview(); };
  $("meMsg").textContent = "";
  renderPreview(); renderKeys();
}
async function makeAvatar(file){
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Doar imagini (PNG, JPG, WEBP, GIF).");
  const src = await readDataURL(file); const img = new Image(); img.src = src; await img.decode();
  const s = Math.min(img.naturalWidth, img.naturalHeight), sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
  for (const side of [400, 320, 240]){
    const c = document.createElement("canvas"); c.width = c.height = side;
    const g = c.getContext("2d"); g.fillStyle = "#222"; g.fillRect(0,0,side,side); g.drawImage(img, sx, sy, s, s, 0, 0, side, side);
    const b = await encodeBest(c, 40000);
    if (b){ const d = await blobToDataURL(b); if (d.length < 58000) return d; }
  }
  throw new Error("Poza e prea mare.");
}
function renderPreview(){
  if (!draft) return;
  const p = Object.assign({}, draft, {tag: draft.tag.trim() || me.tag});
  $("mePreview").replaceChildren(h("div",{class:"modal",style:"max-width:none"}, ...profileView(uid, p, true)));
}
async function saveMe(ev){
  ev.preventDefault(); if (!draft) return;
  const tag = draft.tag.trim();
  if (!tag){ $("meMsg").textContent = "Numele nu poate fi gol."; return; }
  if (Object.entries(profiles).some(([id,p]) => id !== uid && p.tag.toLowerCase() === tag.toLowerCase())){ $("meMsg").textContent = "Cineva are deja numele ăsta."; return; }
  const btn = $("meSave"); btn.disabled = true; $("meMsg").textContent = "Se salvează…";
  try {
    await D.saveProfile({ avatar: draft.avatar || "", pronouns: (draft.pronouns || "").trim().slice(0,20), tag: tag.slice(0,24), emoji: EMOJIS.includes(draft.emoji) || draft.emoji === me.emoji ? draft.emoji : me.emoji, bio: draft.bio.slice(0,200), color: draft.color, banner: draft.banner, status: draft.status.slice(0,60) });
    $("meMsg").textContent = "Salvat ✓";
  } catch(e){ $("meMsg").textContent = ""; writeErr(e); }
  finally { btn.disabled = false; }
}

// ---------- admin: keys ----------
const keyLabel = l => String(l || "Cheie").replace("Owner key","Cheia ta 👑").replace(/^Key /,"Cheia ").replace("Extra key","Cheie extra");
function renderKeys(){
  if (!isAdmin) return;
  const sorted = keys.slice().sort((a,b) => (b.admin - a.admin) || String(a.label).localeCompare(String(b.label), undefined, {numeric:true}));
  const used = keys.filter(k => k.claimedBy).length;
  $("keysCount").textContent = keys.length + " chei · " + used + " folosite · " + (keys.length - used) + " libere";
  $("keysList").replaceChildren(...sorted.map(k => {
    const who = k.claimedBy && profiles[k.claimedBy] ? k.claimedBy : null;
    return h("div",{class:"line"},
      h("span",{class:"pill",text:keyLabel(k.label)}),
      who ? h("span",null, nameEl(who,"span"), who===uid ? h("span",{class:"note",text:" (tu)"}) : null) : h("span",{class:"note",text:"nefolosită"}),
      who && who !== uid ? h("button",{class:"tiny",type:"button",style:"margin-left:auto",text:"Eliberează",onclick:async ev => {
        const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sigur? Apasă iar"; return; }
        b.disabled = true; try { await D.freeKey(k.hash, who); } catch(e){ b.disabled = false; b.textContent = "Eroare, reîncearcă"; writeErr(e); }
      }}) : null,
      !who && !k.admin ? h("button",{class:"tiny",type:"button",style:"margin-left:auto",text:"Șterge cheia",onclick:async ev => {
        const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sigur? Apasă iar"; return; }
        b.disabled = true; try { await D.deleteKey(k.hash); } catch(e){ b.disabled = false; writeErr(e); }
      }}) : null);
  }));
}

// =====================================================================
// ---------- VOICE: 1-on-1 calls + group voice channels (pure WebRTC) ----------
// Firestore only carries the handshake (offer/answer/ICE). Audio flows peer-to-peer,
// encrypted end-to-end by WebRTC (DTLS-SRTP). Free Google STUN servers, no accounts, no minute limits.
// =====================================================================
const RTC_CFG = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
const voice = { room: null, peers: new Map(), stream: null, muted: false, deaf: false, unsubs: [], joinedAt: 0 };
const call = { pair: null, other: null, pc: null, stream: null, audio: null, role: null, state: null, unsubs: [], timer: null, tick: null, started: 0, muted: false, iceQ: [] };
const voiceSpeaking = new Set();
let voiceRooms = [], voiceRoster = {}, rosterUnsubs = {};

function micErr(e){
  const n = e && e.name;
  const msg = (n === "NotAllowedError" || n === "SecurityError")
      ? (D.isDesktopApp ? "Microfonul e blocat. În Windows: Setări → Confidențialitate și securitate → Microfon → pornește „Acces la microfon” și „Permite aplicațiilor desktop să acceseze microfonul”, apoi repornește FolkChat."
        : D.isNative ? "FolkChat nu are voie la microfon. Deschide Setări → Aplicații → FolkChat → Permisiuni → Microfon → Permite."
        : "Browserul a blocat microfonul. Apasă pe lacătul din bara de adrese → Microfon → Permite, apoi încearcă din nou.")
    : (n === "NotFoundError" || n === "OverconstrainedError") ? "Nu am găsit niciun microfon. Conectează unul și încearcă din nou."
    : n === "NotReadableError" ? "Microfonul e folosit de altă aplicație (Discord, Zoom…). Închide-o și încearcă din nou."
    : "Microfonul nu merge aici (" + (n || "eroare necunoscută") + ").";
  return new Error(msg);
}
// ---- microphone pipeline: device → rumble filter → noise removal (browser / AI) → volume → noise gate → peers ----
const FX = { ctx: null, mods: {}, bins: {} };
const WNS = "./vendor/wns/";
const fxSupported = () => !!(window.AudioContext && window.AudioWorkletNode && window.WebAssembly);
async function fxCtx(){
  if (!FX.ctx || FX.ctx.state === "closed"){ try { FX.ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }); } catch(e){ FX.ctx = new AudioContext(); } FX.mods = {}; }
  if (FX.ctx.state === "suspended") await FX.ctx.resume().catch(() => {});
  return FX.ctx;
}
function fxModule(ctx, url){
  if (!FX.mods[url]){ FX.mods[url] = ctx.audioWorklet.addModule(url); FX.mods[url].catch(() => { delete FX.mods[url]; }); }
  return FX.mods[url];
}
const SIMD = (() => { try { return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])); } catch(e){ return false; } })();
async function fxWasm(kind){
  const file = kind === "gtcrn" ? "gtcrn.wasm" : SIMD ? "rnnoise_simd.wasm" : "rnnoise.wasm";
  if (!FX.bins[file]){
    FX.bins[file] = fetch(WNS + file).then(r => { if (!r.ok) throw new Error("wasm " + r.status); return r.arrayBuffer(); });
    FX.bins[file].catch(() => { delete FX.bins[file]; });
  }
  return (await FX.bins[file]).slice(0);
}
function nsLabel(){
  const v = settings.voice;
  return ({ off: "Fără anulare zgomot", std: "Anulare zgomot standard", ai: "Izolare voce AI", lite: "Izolare voce AI ușoară" })[v.ns] + (v.gate ? " · noise gate" : "") + (v.ptt ? " · push-to-talk (" + v.pttLabel + ")" : "");
}
async function rawMic(){
  const v = settings.voice;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw micErr({ name: "NotSupportedError" });
  const sup = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
  const a = { echoCancellation: !!v.echo, noiseSuppression: v.ns === "std", autoGainControl: !!v.agc, channelCount: 1 };
  if (sup.voiceIsolation) a.voiceIsolation = v.ns === "std";
  if (v.micId) a.deviceId = { ideal: v.micId };
  try { return await navigator.mediaDevices.getUserMedia({ audio: a, video: false }); }
  catch(e){
    if (v.micId && (e.name === "NotFoundError" || e.name === "OverconstrainedError")){ v.micId = ""; saveSettings(); return rawMic(); }
    throw micErr(e);
  }
}
async function getMic(){
  const raw = await rawMic();
  const v = settings.voice;
  if (!fxSupported()) return raw;
  try {
    const ctx = await fxCtx();
    const src = ctx.createMediaStreamSource(raw);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 80; hp.Q.value = 0.7;
    const nodes = [src, hp];
    let ns = null;
    if (v.ns === "ai" || v.ns === "lite"){
      const kind = v.ns === "lite" ? "rnnoise" : "gtcrn";
      try {
        const [bin] = await Promise.all([fxWasm(kind), fxModule(ctx, WNS + kind + "/workletProcessor.js")]);
        ns = new AudioWorkletNode(ctx, "@sapphi-red/web-noise-suppressor/" + kind, { channelCount: 1, channelCountMode: "explicit", processorOptions: { maxChannels: 1, wasmBinary: bin } });
        nodes.push(ns);
      } catch(e){ console.warn("AI noise removal unavailable", e); flash("Izolarea vocii AI nu merge pe acest dispozitiv, folosesc varianta standard.", true); v.ns = "std"; saveSettings(); raw.getTracks().forEach(t => t.stop()); return getMic(); }
    }
    const gain = ctx.createGain(); gain.gain.value = v.micGain; nodes.push(gain);
    let gate = null;
    try { await fxModule(ctx, "./voice-gate.js"); gate = new AudioWorkletNode(ctx, "folk-gate", { channelCount: 1, channelCountMode: "explicit" }); gate.port.postMessage({ on: !!v.gate, db: v.gateDb }); nodes.push(gate); } catch(e){}
    const dest = ctx.createMediaStreamDestination(); dest.channelCount = 1;
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    nodes[nodes.length - 1].connect(dest);
    const out = dest.stream, track = out.getAudioTracks()[0], stop = track.stop.bind(track);
    track.stop = () => {
      stop(); raw.getTracks().forEach(t => t.stop());
      for (const n of nodes) try { n.disconnect(); } catch(e){}
      if (ns) try { ns.port.postMessage("destroy"); } catch(e){}
      if (gate) gate.port.onmessage = null;
    };
    out._fx = { gain, gate, raw };
    return out;
  } catch(e){ console.warn("voice fx failed", e); return raw; }
}
// live tweaks without re-opening the mic
function micStreams(){ return [voice.stream, call.stream, micTest && micTest.stream].filter(Boolean); }
function liveFx(){ for (const s of micStreams()) if (s._fx){ s._fx.gain.gain.value = settings.voice.micGain; if (s._fx.gate) s._fx.gate.port.postMessage({ on: !!settings.voice.gate, db: settings.voice.gateDb }); } }
// device / processing changes: swap the track on every connection, no reconnect needed
let reMicBusy = null;
function reapplyMic(){
  clearTimeout(reapplyMic.t);
  reapplyMic.t = setTimeout(async () => {
    if (reMicBusy) await reMicBusy.catch(() => {});
    reMicBusy = (async () => {
      const swap = async (holder, pcs) => {
        if (!holder.stream) return;
        let ns; try { ns = await getMic(); } catch(e){ micAlert(e); return; }
        if (!holder.stream){ ns.getTracks().forEach(t => t.stop()); return; }
        const tr = ns.getAudioTracks()[0];
        for (const pc of pcs) for (const s of pc.getSenders()) if (s.track && s.track.kind === "audio") await s.replaceTrack(tr).catch(() => {});
        const old = holder.stream; holder.stream = ns; old.getTracks().forEach(t => t.stop());
        if (holder === voice) addMeter(uid, ns);
      };
      await swap(voice, [...voice.peers.values()].map(e => e.pc).filter(Boolean));
      await swap(call, call.pc ? [call.pc] : []);
      if (micTest){ const keep = micTest.loop; stopMicTest(); startMicTest(keep); }
      syncMic();
    })();
  }, 250);
}
// ---- push-to-talk ----
let pttDown = false, pttRelease = null;
const pttOk = () => !settings.voice.ptt || pttDown;
function syncMic(){
  if (voice.stream) voice.stream.getAudioTracks().forEach(t => t.enabled = !voice.muted && !voice.deaf && pttOk());
  if (call.stream) call.stream.getAudioTracks().forEach(t => t.enabled = !call.muted && pttOk());
  for (const b of document.querySelectorAll(".ptt-btn")) b.classList.toggle("on", pttDown);
}
function pttSet(down){
  clearTimeout(pttRelease);
  if (down){ if (!pttDown){ pttDown = true; syncMic(); } return; }
  pttRelease = setTimeout(() => { pttDown = false; syncMic(); }, settings.voice.pttDelay);
}
const pttCode = e => e.type.startsWith("mouse") ? "Mouse" + e.button : e.code;
const editable = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
function pttKeyHandler(e){
  if (!settings.voice.ptt || pttBinding || (!voice.room && !call.pair)) return;
  if (pttCode(e) !== settings.voice.pttKey || e.repeat) return;
  if (e.type === "keydown" && editable(e.target) && e.key.length === 1) return;   // typing a message, not talking
  if (e.type.startsWith("mouse") && e.button < 3) return;
  pttSet(e.type === "keydown" || e.type === "mousedown");
}
for (const ev of ["keydown","keyup","mousedown","mouseup"]) addEventListener(ev, pttKeyHandler, true);
addEventListener("blur", () => { if (pttDown) pttSet(false); });
function pttButton(){
  const b = h("button",{type:"button",class:"ptt-btn" + (pttDown ? " on" : ""),title:"Ține apăsat ca să vorbești (" + settings.voice.pttLabel + ")",text:"🎙️ Ține apăsat ca să vorbești"});
  b.onpointerdown = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch(x){} pttSet(true); };
  b.onpointerup = b.onpointercancel = () => pttSet(false);
  b.oncontextmenu = e => e.preventDefault();
  return b;
}
let pttBinding = null;
// ---- output: speaker choice, master + per-person volume ----
function applyOut(a, id){
  const v = settings.voice, uv = v.userVol[id];
  a.volume = Math.max(0, Math.min(1, v.outVol * (uv == null ? 1 : uv)));
  if (v.spkId && a.setSinkId && a.sinkId !== v.spkId) a.setSinkId(v.spkId).catch(() => {});
  if (!v.spkId && a.setSinkId && a.sinkId) a.setSinkId("").catch(() => {});
}
function applyOutAll(){ for (const a of document.querySelectorAll("audio[id^='ra-']")) applyOut(a, a.id.slice(3)); }
function userVolPop(id, anchor){
  const old = $("uvPop"); if (old){ old.remove(); if (old.dataset.id === id) return; }
  const p = P(id) || {}, cur = settings.voice.userVol[id] == null ? 1 : settings.voice.userVol[id];
  const lab = h("span",{class:"note",text: Math.round(cur * 100) + "%"});
  const r = h("input",{type:"range",min:"0",max:"1",step:"0.05","aria-label":"Volum " + (p.tag || "")}); r.value = cur;
  const save = val => { if (val === 1) delete settings.voice.userVol[id]; else settings.voice.userVol[id] = val; saveSettings(); applyOutAll(); lab.textContent = Math.round(val * 100) + "%"; mute.textContent = val === 0 ? "🔈 Pornește" : "🔕 Mut"; renderVoice(); };
  r.oninput = () => save(+r.value);
  const mute = h("button",{type:"button",class:"tiny",text: cur === 0 ? "🔈 Pornește" : "🔕 Mut",onclick:() => { const nv = (settings.voice.userVol[id] === 0) ? 1 : 0; r.value = nv; save(nv); }});
  const pop = h("div",{id:"uvPop",class:"uv-pop"}, h("div",{class:"row"}, h("b",{class:"grow",text:"🔉 " + (p.tag || "?")}), lab), r, h("div",{class:"row",style:"margin-top:6px"}, h("span",{class:"note grow",style:"font-size:11.5px",text:"Doar pentru tine"}), mute));
  pop.dataset.id = id;
  document.body.append(pop);
  const b = anchor.getBoundingClientRect(), w = 230;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left)) + "px";
  pop.style.top = (b.bottom + 6 + 130 > innerHeight ? Math.max(8, b.top - 136) : b.bottom + 6) + "px";
  setTimeout(() => { const off = ev => { if (!pop.contains(ev.target)){ pop.remove(); removeEventListener("pointerdown", off, true); } }; addEventListener("pointerdown", off, true); }, 0);
}
// ---- audio quality (Opus bitrate) ----
const QUALITY = { normal: 32000, high: 64000, max: 128000 };
function tunePC(pc){
  for (const s of pc.getSenders()){
    if (!s.track || s.track.kind !== "audio" || !s.getParameters) continue;
    try { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = QUALITY[settings.voice.quality] || 64000; p.encodings[0].priority = "high"; s.setParameters(p).catch(() => {}); } catch(e){}
  }
}
function tuneAll(){ for (const e of voice.peers.values()) if (e.pc) tunePC(e.pc); if (call.pc) tunePC(call.pc); }
// ---- mic test (Settings → Voce) ----
let micTest = null;
async function startMicTest(loop){
  stopMicTest();
  let stream; try { stream = await getMic(); } catch(e){ micAlert(e); return null; }
  const t = { stream, loop: !!loop, audio: null, lvl: 0, open: true };
  micTest = t;
  if (stream._fx && stream._fx.gate) stream._fx.gate.port.onmessage = e => { t.lvl = e.data.lvl; t.open = e.data.open; };
  else { const ctx = meterCtx(); if (ctx){ const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an); const buf = new Float32Array(512); t.iv = setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; t.lvl = Math.sqrt(s / buf.length); }, 50); } }
  if (t.loop){ t.audio = h("audio",{autoplay:""}); t.audio.style.display = "none"; document.body.append(t.audio); t.audio.srcObject = stream; if (settings.voice.spkId && t.audio.setSinkId) t.audio.setSinkId(settings.voice.spkId).catch(() => {}); t.audio.play().catch(() => {}); }
  return t;
}
function stopMicTest(){
  if (!micTest) return;
  const t = micTest; micTest = null;
  clearInterval(t.iv);
  if (t.audio){ t.audio.srcObject = null; t.audio.remove(); }
  t.stream.getTracks().forEach(x => x.stop());
}
const dbOf = lvl => lvl > 0 ? 20 * Math.log10(lvl) : -100;
async function listDevices(){
  try { return await navigator.mediaDevices.enumerateDevices(); } catch(e){ return []; }
}
function voiceSettings(body, toggle, redraw){
  const v = settings.voice;
  const set = (k, val, how) => { v[k] = val; saveSettings(); if (how === "re") reapplyMic(); else if (how === "live") liveFx(); else if (how === "out") applyOutAll(); else if (how === "q") tuneAll(); renderVoice(); if (call.pair) callUI(); };
  const sel = (opts, cur, on) => { const s = h("select",null, opts.map(([val, lab]) => h("option",{value:val,text:lab}))); s.value = cur; if (s.value !== cur) s.value = opts.length ? opts[0][0] : ""; s.onchange = () => on(s.value); return s; };
  const slider = (min, max, step, cur, fmt, on, onEnd) => {
    const lab = h("span",{class:"note",text:fmt(cur)}), r = h("input",{type:"range",min:String(min),max:String(max),step:String(step)}); r.value = cur;
    r.oninput = () => { lab.textContent = fmt(+r.value); on(+r.value); }; if (onEnd) r.onchange = () => onEnd(+r.value);
    return [lab, r];
  };
  const micSel = h("div",null, h("div",{class:"note",text:"Se încarcă dispozitivele…"})), spkSel = h("div");
  (async () => {
    const devs = await listDevices();
    const mics = devs.filter(d => d.kind === "audioinput"), spks = devs.filter(d => d.kind === "audiooutput");
    const unnamed = mics.length && mics.every(d => !d.label);
    micSel.replaceChildren(...[
      sel([["", "Implicit (al sistemului)"], ...mics.filter(d => d.deviceId && d.deviceId !== "default").map((d, i) => [d.deviceId, d.label || "Microfon " + (i + 1)])], v.micId, val => set("micId", val, "re")),
      unnamed ? h("button",{type:"button",class:"tiny",style:"margin-top:6px",text:"Arată numele microfoanelor",onclick:async () => { try { const s = await rawMic(); s.getTracks().forEach(t => t.stop()); redraw(); } catch(e){ micAlert(e); } }}) : null].filter(Boolean));
    const canSink = "setSinkId" in HTMLMediaElement.prototype;
    spkSel.replaceChildren(...(canSink && spks.length ? [h("div",{class:"h2",style:"margin-top:14px",text:"Difuzor / căști"}),
      sel([["", "Implicit (al sistemului)"], ...spks.filter(d => d.deviceId && d.deviceId !== "default").map((d, i) => [d.deviceId, d.label || "Ieșire " + (i + 1)])], v.spkId, val => set("spkId", val, "out"))] : []));
  })();
  const nsOpts = [
    ["off", "Oprit", "Sunetul brut al microfonului."],
    ["std", "Standard", "Filtrul încorporat în browser / sistem. Ușor pe procesor."],
    ["ai", "Izolare voce AI", "Rețea neurală (GTCRN) care lasă doar vocea ta: scoate tastatura, ventilatorul, traficul, câinele. Recomandat."],
    ["lite", "AI ușor", "Model mai mic (RNNoise), pentru telefoane sau PC-uri slabe. Curăță mai puțin."]];
  const ai = fxSupported();
  const nsBox = h("div",{class:"seg"}, nsOpts.map(([k, lab, hint]) => h("button",{type:"button",class:(v.ns === k ? "on" : ""),disabled:((k === "ai" || k === "lite") && !ai) ? "" : null,title:hint,text:lab,onclick:() => { set("ns", k, "re"); redraw(); }})));
  const nsHint = h("div",{class:"note",style:"margin-top:6px",text:(nsOpts.find(o => o[0] === v.ns) || nsOpts[2])[2] + (ai ? "" : " (AI nu e suportat aici.)")});
  const [gLab, gR] = slider(0, 2, 0.05, v.micGain, x => Math.round(x * 100) + "%", x => set("micGain", x, "live"));
  const [oLab, oR] = slider(0, 1, 0.05, v.outVol, x => Math.round(x * 100) + "%", x => set("outVol", x, "out"));
  const [tLab, tR] = slider(-80, -20, 1, v.gateDb, x => x + " dB", x => { set("gateDb", x, "live"); mark.style.left = pct(x) + "%"; });
  const pct = db => Math.max(0, Math.min(100, (db + 80) / 60 * 100));
  const bar = h("div",{class:"vu-fill"}), mark = h("div",{class:"vu-mark"}); mark.style.left = pct(v.gateDb) + "%";
  const vu = h("div",{class:"vu"}, bar, mark);
  const vuNote = h("div",{class:"note",style:"font-size:12px;margin-top:4px",text:"Apasă „Testează” și vorbește. Bara se face verde când trece de prag."});
  const testBtn = h("button",{type:"button",class:"tiny",text:"🎤 Testează microfonul"});
  const loopCb = h("input",{type:"checkbox"}); const loopLab = h("label",{class:"inline-cb"}, loopCb, h("span",{text:" Ascultă-te (folosește căști)"}));
  let raf = 0;
  const paint = () => {
    if (!vu.isConnected){ stopMicTest(); return; }
    if (!micTest){ bar.style.width = "0%"; testBtn.textContent = "🎤 Testează microfonul"; return; }
    const d = dbOf(micTest.lvl); bar.style.width = pct(d) + "%";
    bar.classList.toggle("open", !v.gate || d > v.gateDb);
    raf = requestAnimationFrame(paint);
  };
  testBtn.onclick = async () => {
    if (micTest){ stopMicTest(); cancelAnimationFrame(raf); paint(); return; }
    testBtn.textContent = "Se pornește…";
    const t = await startMicTest(loopCb.checked);
    testBtn.textContent = t ? "⏹ Oprește testul" : "🎤 Testează microfonul";
    if (t) paint();
  };
  loopCb.onchange = async () => { if (micTest){ await startMicTest(loopCb.checked); paint(); } };
  const keyBtn = h("button",{type:"button",class:"tiny",text:"Tasta: " + v.pttLabel});
  keyBtn.onclick = () => {
    keyBtn.textContent = "Apasă o tastă sau un buton lateral al mouse-ului…";
    const done = e => {
      if (e.type === "mousedown" && e.button < 3) { if (e.target === keyBtn) return; }
      e.preventDefault(); e.stopPropagation();
      removeEventListener("keydown", done, true); removeEventListener("mousedown", done, true); pttBinding = null;
      if (e.type === "keydown" && e.code === "Escape"){ keyBtn.textContent = "Tasta: " + v.pttLabel; return; }
      if (e.type === "mousedown" && e.button < 3){ keyBtn.textContent = "Tasta: " + v.pttLabel; return; }
      v.pttKey = pttCode(e);
      v.pttLabel = e.type === "mousedown" ? "Mouse " + (e.button + 1) : (e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.code.replace(/^Key|^Digit/, ""));
      saveSettings(); keyBtn.textContent = "Tasta: " + v.pttLabel; renderVoice();
    };
    pttBinding = done;
    setTimeout(() => { addEventListener("keydown", done, true); addEventListener("mousedown", done, true); }, 0);
  };
  const [dLab, dR] = slider(0, 1000, 50, v.pttDelay, x => x + " ms", x => set("pttDelay", x));
  const modeBox = h("div",{class:"seg"},
    h("button",{type:"button",class:v.ptt ? "" : "on",text:"🗣️ Activare vocală",onclick:() => { set("ptt", false); syncMic(); redraw(); }}),
    h("button",{type:"button",class:v.ptt ? "on" : "",text:"⌨️ Push-to-talk",onclick:() => { set("ptt", true); syncMic(); redraw(); }}));
  body.replaceChildren(
    h("div",{class:"h2",text:"Microfon"}), micSel, spkSel,
    h("div",{class:"h2",style:"margin-top:18px",text:"Anulare zgomot"}), nsBox, nsHint,
    toggle("Anulare ecou", () => v.echo, x => set("echo", x, "re"), "Oprește ecoul când nu porți căști"),
    toggle("Volum automat al microfonului", () => v.agc, x => set("agc", x, "re"), "Ridică vocea când vorbești încet"),
    h("div",{class:"row",style:"margin-top:14px"}, h("div",{class:"h2 grow",style:"margin:0",text:"Volum microfon"}), gLab), gR,
    h("div",{class:"row",style:"margin-top:14px"}, h("div",{class:"h2 grow",style:"margin:0",text:"Volumul celorlalți"}), oLab), oR,
    h("div",{class:"note",style:"font-size:12px",text:"Poți schimba volumul fiecărei persoane apăsând pe ea în canalul vocal."}),
    h("div",{class:"h2",style:"margin-top:18px",text:"Test"}),
    h("div",{class:"row",style:"flex-wrap:wrap;gap:10px"}, testBtn, loopLab), vu, vuNote,
    toggle("Noise gate", () => v.gate, x => { set("gate", x, "live"); }, "Taie complet sunetul sub prag (respirație, zgomot de fundal)"),
    h("div",{class:"row",style:"margin-top:4px"}, h("div",{class:"note grow",text:"Prag"}), tLab), tR,
    h("div",{class:"h2",style:"margin-top:18px",text:"Mod de transmisie"}), modeBox,
    v.ptt ? h("div",null,
      h("div",{class:"row",style:"margin-top:10px;flex-wrap:wrap;gap:10px"}, keyBtn, h("span",{class:"note",style:"font-size:12px",text:"Funcționează când FolkChat e în prim-plan. Pe telefon apare un buton."})),
      h("div",{class:"row",style:"margin-top:10px"}, h("div",{class:"note grow",text:"Întârziere la eliberare"}), dLab), dR) : null,
    h("div",{class:"h2",style:"margin-top:18px",text:"Calitate audio"}),
    sel([["normal","Normală (32 kbps) — date mobile"],["high","Înaltă (64 kbps)"],["max","Maximă (128 kbps) — muzică"]], v.quality, val => set("quality", val, "q")));
}
function micAlert(e){ flash(e.message || "Microfonul nu merge.", true); }

// ---- speaking detection (green ring) ----
let vctx = null; const meters = new Map(); let meterTimer = null;
function meterCtx(){ if (!vctx){ const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; vctx = new C(); } if (vctx.state === "suspended") vctx.resume().catch(() => {}); return vctx; }
function addMeter(id, stream){
  const ctx = meterCtx(); if (!ctx) return;
  removeMeter(id);
  try {
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    meters.set(id, { src, an, buf: new Uint8Array(an.fftSize), hot: 0 });
  } catch(e){ return; }
  if (!meterTimer) meterTimer = setInterval(tickMeters, 120);
}
function removeMeter(id){ const m = meters.get(id); if (m){ try { m.src.disconnect(); } catch(e){} meters.delete(id); } if (voiceSpeaking.delete(id)) paintSpeaking(); if (!meters.size && meterTimer){ clearInterval(meterTimer); meterTimer = null; } }
function tickMeters(){
  let changed = false;
  for (const [id, m] of meters){
    m.an.getByteTimeDomainData(m.buf);
    let sum = 0; for (let i = 0; i < m.buf.length; i++){ const v = (m.buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / m.buf.length);
    const silent = (id === uid && (voice.muted || call.muted || !pttOk()));
    m.hot = (!silent && rms > 0.035) ? 4 : Math.max(0, m.hot - 1);
    const on = m.hot > 0;
    if (on !== voiceSpeaking.has(id)){ on ? voiceSpeaking.add(id) : voiceSpeaking.delete(id); changed = true; }
  }
  if (changed) paintSpeaking();
}
function paintSpeaking(){
  for (const el of document.querySelectorAll("[data-vu]")) el.classList.toggle("speaking", voiceSpeaking.has(el.dataset.vu));
}
function playRemote(id, stream, deaf){
  let a = document.getElementById("ra-" + id);
  if (!a){ a = h("audio",{id:"ra-" + id, autoplay:"", playsinline:""}); a.style.display = "none"; document.body.append(a); }
  a.srcObject = stream; a.muted = !!deaf; applyOut(a, id); a.play().catch(() => {});
  addMeter(id, stream);
  return a;
}
function stopRemote(id){ const a = document.getElementById("ra-" + id); if (a){ a.srcObject = null; a.remove(); } removeMeter(id); }

// ---- ringtone / ringback (Web Audio, no files) ----
let ringTimer = null;
function ring(kind){
  stopRing();
  const once = () => {
    const ctx = meterCtx(); if (!ctx) return;
    const t0 = ctx.currentTime, g = ctx.createGain(); g.connect(ctx.destination);
    const vol = Math.max(0.15, settings.volume) * (kind === "in" ? 0.35 : 0.18);
    const notes = kind === "in" ? [[880,0,.18],[1100,.2,.18],[880,.45,.18],[1100,.65,.18]] : [[440,0,.9]];
    for (const [f, at, d] of notes){
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "sine"; o.frequency.value = f;
      og.gain.setValueAtTime(0.0001, t0 + at); og.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
      o.connect(og); og.connect(g); o.start(t0 + at); o.stop(t0 + at + d + 0.05);
    }
  };
  once(); ringTimer = setInterval(once, kind === "in" ? 2000 : 3000);
}
function stopRing(){ if (ringTimer){ clearInterval(ringTimer); ringTimer = null; } }

// =========================== 1-on-1 calls ===========================
function callUI(){
  let bar = $("callBar");
  if (!call.pair){ if (bar) bar.remove(); renderChatHeader(); return; }
  if (!bar){ bar = h("div",{id:"callBar",class:"callbar"}); document.body.append(bar); }
  const p = P(call.other) || {};
  const secs = call.started ? Math.floor((Date.now() - call.started) / 1000) : 0;
  const status = call.state === "active" ? "Conectat · " + z(Math.floor(secs / 60)) + ":" + z(secs % 60) : call.role === "caller" ? "Sună…" : "Se conectează…";
  const av = avatar(call.other,"sm"); av.dataset.vu = call.other;
  bar.replaceChildren(av, h("div",{class:"grow",style:"min-width:0"}, h("b",{text:p.tag || "?"}), h("div",{class:"note",style:"font-size:12px",text:"📞 " + status})),
    h("button",{type:"button",class:"icon" + (call.muted ? " off" : ""),title: call.muted ? "Pornește microfonul" : "Oprește microfonul","aria-label":"Microfon",text: call.muted ? "🔇" : "🎤",onclick:() => { call.muted = !call.muted; syncMic(); callUI(); }}),
    settings.voice.ptt ? pttButton() : null,
    h("button",{type:"button",class:"icon",title:"Volumul lui " + (p.tag || "?"),"aria-label":"Volum",text:"🔉",onclick:ev => userVolPop(call.other, ev.currentTarget)}),
    h("button",{type:"button",class:"hang",title:"Închide","aria-label":"Închide apelul",text:"Închide",onclick:() => hangUp()}));
  paintSpeaking(); renderChatHeader();
}
function newCallPC(){
  const pc = new RTCPeerConnection(RTC_CFG);
  call.stream.getTracks().forEach(t => pc.addTrack(t, call.stream));
  tunePC(pc);
  pc.onicecandidate = e => { if (e.candidate && call.pair) D.addCallIce(call.pair, e.candidate.toJSON()).catch(() => {}); };
  pc.ontrack = e => { call.audio = playRemote(call.other, e.streams[0] || new MediaStream([e.track]), false); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected" && call.state !== "active"){ call.state = "active"; call.started = Date.now(); stopRing(); callUI(); }
    if (pc.connectionState === "connected" && !call.started){ call.started = Date.now(); }
    if (pc.connectionState === "failed"){ flash("Apelul nu s-a putut conecta (rețea blocată).", true); hangUp(); }
  };
  return pc;
}
function watchIce(){
  call.unsubs.push(D.watchCallIce(call.pair, list => {
    for (const x of list){ if (x.from === uid) continue; let c; try { c = JSON.parse(x.c); } catch(e){ continue; }
      if (call.pc && call.pc.remoteDescription) call.pc.addIceCandidate(c).catch(() => {}); else call.iceQ.push(c); }
  }));
}
async function flushIce(){ const q = call.iceQ.splice(0); for (const c of q) await call.pc.addIceCandidate(c).catch(() => {}); }
async function startCallTo(other){
  if (call.pair){ flash("Ești deja într-un apel."); return; }
  if (!P(other) || other === uid) return;
  let stream; try { stream = await getMic(); } catch(e){ micAlert(e); return; }
  if (voice.room) await leaveVoice();
  const pair = D.dmId(other).slice(3);
  Object.assign(call, { pair, other, role: "caller", state: "ringing", stream, muted: false, started: 0, iceQ: [], unsubs: [] });
  syncMic();
  presenceSet(true);
  try {
    call.pc = newCallPC();
    const offer = await call.pc.createOffer(); await call.pc.setLocalDescription(offer);
    await D.startCall(pair, other, offer);
  } catch(e){ cleanupCall(); writeErr(e); return; }
  ring("out"); callUI();
  D.pushNotify({ type: "call", cid: pair });
  call.unsubs.push(D.watchCall(pair, async c => {
    if (!c){ if (call.pair === pair){ const was = call.state; cleanupCall(); flash(was === "active" ? "Apel încheiat." : "Nu a răspuns sau a respins apelul."); } return; }
    if (c.state === "active" && c.answer && call.pc && !call.pc.remoteDescription){
      try { await call.pc.setRemoteDescription(c.answer); await flushIce(); } catch(e){}
      call.state = "active"; call.started = Date.now(); stopRing(); callUI();
    }
  }));
  watchIce();
  call.timer = setTimeout(() => { if (call.pair === pair && call.state === "ringing"){ D.endCall(pair); cleanupCall(); flash("Nu a răspuns."); } }, 30000);
  call.tick = setInterval(() => { if (call.state === "active") callUI(); }, 1000);
}
// incoming
let incoming = null;
function initCalls(){
  unsubs.push(D.watchIncomingCalls(list => {
    const now = Date.now();
    const ringing = list.find(c => c.state === "ringing" && c.caller !== uid && profiles[c.caller] && now - c.ts < 45000 && c.id !== call.pair);
    if (ringing && (!incoming || incoming.id !== ringing.id)) showIncoming(ringing);
    if (!ringing && incoming) hideIncoming();
  }));
}
function showIncoming(c){
  incoming = c;
  const p = P(c.caller) || {};
  let el = $("incomingCall"); if (el) el.remove();
  el = h("div",{id:"incomingCall",class:"incoming"},
    h("span",{class:"av lg ringing",style:"border-color:" + accent(p)}, p.avatar ? h("img",{src:p.avatar,alt:"",class:"av-img"}) : (p.emoji || "❔")),
    h("div",{class:"grow"}, h("div",{class:"note",style:"font-size:12px",text:"📞 Apel de la"}), h("b",{style:"font-size:18px",text:p.tag || "?"})),
    h("button",{type:"button",class:"decline",text:"Respinge",onclick:() => { const id = c.id; hideIncoming(); D.endCall(id); }}),
    h("button",{type:"button",class:"accept",text:"Răspunde",onclick:() => answer(c)}));
  document.body.append(el);
  ring("in");
  if (settings.notify && "Notification" in window && Notification.permission === "granted" && document.hidden){
    try { const n = new Notification("📞 " + (p.tag || "Cineva") + " te sună", { body: "Deschide FolkChat ca să răspunzi", tag: "call-" + c.id, requireInteraction: true }); n.onclick = () => { window.focus(); n.close(); }; } catch(e){}
  }
  clearTimeout(showIncoming.t); showIncoming.t = setTimeout(() => { if (incoming && incoming.id === c.id) hideIncoming(); }, 32000);
}
function hideIncoming(){ incoming = null; stopRing(); const el = $("incomingCall"); if (el) el.remove(); }
async function answer(c){
  hideIncoming();
  if (call.pair) hangUp(true);
  let stream; try { stream = await getMic(); } catch(e){ micAlert(e); D.endCall(c.id); return; }
  if (voice.room) await leaveVoice();
  Object.assign(call, { pair: c.id, other: c.caller, role: "callee", state: "connecting", stream, muted: false, started: 0, iceQ: [], unsubs: [] });
  syncMic();
  presenceSet(true);
  try {
    call.pc = newCallPC();
    await call.pc.setRemoteDescription(c.offer);
    const ans = await call.pc.createAnswer(); await call.pc.setLocalDescription(ans);
    await D.answerCall(c.id, ans);
    await flushIce();
  } catch(e){ cleanupCall(); flash("Apelul s-a încheiat înainte să răspunzi.", true); return; }
  call.state = "active"; call.started = Date.now(); callUI();
  watchIce();
  call.unsubs.push(D.watchCall(c.id, x => { if (!x && call.pair === c.id){ cleanupCall(); flash("Apel încheiat."); } }));
  call.tick = setInterval(() => { if (call.state === "active") callUI(); }, 1000);
}
function hangUp(silent){ const pair = call.pair; if (!pair) return; cleanupCall(); D.endCall(pair); if (!silent) flash("Apel încheiat."); }
function cleanupCall(){
  stopRing(); clearTimeout(call.timer); clearInterval(call.tick);
  for (const u of call.unsubs) try { u(); } catch(e){}
  if (call.pc) try { call.pc.close(); } catch(e){}
  if (call.stream) call.stream.getTracks().forEach(t => t.stop());
  if (call.other) stopRemote(call.other);
  Object.assign(call, { pair: null, other: null, pc: null, stream: null, audio: null, role: null, state: null, unsubs: [], timer: null, tick: null, started: 0, iceQ: [] });
  presenceSet(!document.hidden);
  callUI();
}

// ======================= group voice channels =======================
function initVoice(){
  initCalls();
  unsubs.push(D.watchVoiceRooms(list => {
    voiceRooms = list.sort((a,b) => (a.pos||0) - (b.pos||0));
    if (!voiceRooms.length && isAdmin && !initVoice.made){ initVoice.made = true; D.createVoiceRoom("general", { name: "General", emoji: "🔊", pos: 0 }).catch(() => {}); }
    for (const r of voiceRooms) if (!rosterUnsubs[r.id]) rosterUnsubs[r.id] = D.watchVoicePeers(r.id, peers => { voiceRoster[r.id] = peers; onRoster(r.id); });
    for (const id of Object.keys(rosterUnsubs)) if (!voiceRooms.find(r => r.id === id)){ rosterUnsubs[id](); delete rosterUnsubs[id]; delete voiceRoster[id]; if (voice.room === id) leaveVoice(); }
    renderVoice();
  }));
}
function onRoster(room){
  if (voice.room === room){
    const ids = new Set((voiceRoster[room] || []).map(p => p.id));
    for (const id of [...voice.peers.keys()]) if (!ids.has(id)) dropPeer(id);
    if (!ids.has(uid) && Date.now() - voice.joinedAt > 5000){ leaveVoice(true); flash("Ai fost deconectat de la canalul vocal."); }
  }
  renderVoice();
}
function vpc(other, initiator){
  const room = voice.room, pc = new RTCPeerConnection(RTC_CFG);
  const entry = { pc, iceQ: [] };
  voice.peers.set(other, entry);
  voice.stream.getTracks().forEach(t => pc.addTrack(t, voice.stream));
  tunePC(pc);
  pc.onicecandidate = e => { if (e.candidate && voice.room === room) D.sendVoiceSig(room, other, "ice", e.candidate.toJSON()).catch(() => {}); };
  pc.ontrack = e => playRemote(other, e.streams[0] || new MediaStream([e.track]), voice.deaf);
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") stopRemote(other); };
  if (initiator) (async () => {
    try { const o = await pc.createOffer(); await pc.setLocalDescription(o); await D.sendVoiceSig(room, other, "offer", { type: o.type, sdp: o.sdp }); } catch(e){}
  })();
  return entry;
}
function dropPeer(id){ const e = voice.peers.get(id); if (e){ try { e.pc.close(); } catch(x){} voice.peers.delete(id); } stopRemote(id); }
async function onSig(msgs){
  for (const s of msgs){
    D.delRef(s.ref);
    if (!voice.room) continue;
    const ts = s.ts && s.ts.toMillis ? s.ts.toMillis() : Date.now();
    if (ts < voice.joinedAt - 10000) continue;        // left over from an older session
    let data; try { data = JSON.parse(s.data); } catch(e){ continue; }
    let e = voice.peers.get(s.from);
    try {
      if (s.kind === "offer"){
        if (e) dropPeer(s.from);
        e = vpc(s.from, false);
        await e.pc.setRemoteDescription(data);
        const a = await e.pc.createAnswer(); await e.pc.setLocalDescription(a);
        await D.sendVoiceSig(voice.room, s.from, "answer", { type: a.type, sdp: a.sdp });
        for (const c of e.iceQ.splice(0)) await e.pc.addIceCandidate(c).catch(() => {});
      } else if (s.kind === "answer" && e){
        await e.pc.setRemoteDescription(data);
        for (const c of e.iceQ.splice(0)) await e.pc.addIceCandidate(c).catch(() => {});
      } else if (s.kind === "ice"){
        if (!e){ e = { pc: null, iceQ: [] }; }
        if (e.pc && e.pc.remoteDescription) await e.pc.addIceCandidate(data).catch(() => {}); else e.iceQ.push(data);
        if (!voice.peers.has(s.from) && !e.pc) voice.peers.set(s.from, e);
      }
    } catch(err){}
  }
}
async function joinVoice(room){
  if (voice.room === room) return;
  if (call.pair){ flash("Închide întâi apelul."); return; }
  let stream; try { stream = await getMic(); } catch(e){ micAlert(e); return; }
  if (voice.room) await leaveVoice(true);
  Object.assign(voice, { room, stream, joinedAt: Date.now(), peers: new Map() });
  syncMic();
  addMeter(uid, stream);
  await D.clearMySigs(room);
  try { await D.setVoicePeer(room, voice.muted, voice.deaf); }
  catch(e){ voice.room = null; stream.getTracks().forEach(t => t.stop()); removeMeter(uid); writeErr(e); return; }
  presenceSet(true);
  voice.unsubs.push(D.watchVoiceSig(room, onSig));
  // The newcomer calls everybody already in the room (so two people never call each other at the same time).
  for (const p of (voiceRoster[room] || [])) if (p.id !== uid && profiles[p.id]) vpc(p.id, true);
  playSfx("join", true); renderVoice();
}
async function leaveVoice(silent){
  const room = voice.room; if (!room) return;
  for (const id of [...voice.peers.keys()]) dropPeer(id);
  for (const u of voice.unsubs) try { u(); } catch(e){}
  voice.unsubs = [];
  if (voice.stream) voice.stream.getTracks().forEach(t => t.stop());
  removeMeter(uid);
  voice.room = null; voice.stream = null;
  D.leaveVoicePeer(room).catch(() => {}); D.clearMySigs(room);
  presenceSet(!document.hidden);
  if (!silent) playSfx("react", true);
  renderVoice();
}
function setVoiceFlags(muted, deaf){
  voice.muted = muted; voice.deaf = deaf;
  syncMic();
  for (const id of voice.peers.keys()){ const a = document.getElementById("ra-" + id); if (a) a.muted = deaf; }
  if (voice.room) D.setVoicePeer(voice.room, muted, deaf).catch(() => {});
  renderVoice();
}
function voiceRoomModal(r){
  const name = h("input",{maxlength:"24",placeholder:"ex. Gaming"}); name.value = r ? r.name : "";
  const emo = h("input",{maxlength:"8",placeholder:"🔊"}); emo.value = r ? (r.emoji || "") : "🔊";
  const err = h("div",{class:"err"});
  openModal(h("div",{class:"modal small"},
    h("button",{class:"close",type:"button","aria-label":"Închide",text:"✕",onclick:closeProfile}),
    h("div",{class:"bd",style:"margin-top:0;padding-top:20px"},
      h("h3",{style:"margin:0 0 10px",text: r ? "Editează canalul vocal" : "Canal vocal nou"}),
      h("label",{text:"Nume"}), name, h("label",{text:"Emoji"}), emo, err,
      h("div",{class:"row",style:"margin-top:14px"},
        r ? h("button",{type:"button",class:"danger-btn",text:"Șterge",onclick:ev => { const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sigur?"; return; } D.deleteVoiceRoom(r.id).then(closeProfile).catch(writeErr); }}) : null,
        h("span",{class:"grow"}),
        h("button",{type:"button",class:"primary",text:"Salvează",onclick:async () => {
          const n = name.value.trim(); if (!n){ err.textContent = "Scrie un nume."; return; }
          const id = r ? r.id : (n.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "voce") + "-" + Math.random().toString(36).slice(2,6);
          try { await D.createVoiceRoom(id, { name: n.slice(0,24), emoji: emo.value.trim().slice(0,8), pos: r ? (r.pos || 0) : voiceRooms.length }); closeProfile(); } catch(e){ writeErr(e); }
        }})))));
  setTimeout(() => name.focus(), 30);
}
function renderVoice(){
  const box = $("voiceList"); if (!box || !me) return;
  $("voiceAdd").classList.toggle("hidden", !isAdmin);
  box.replaceChildren(...voiceRooms.map(r => {
    const peers = (voiceRoster[r.id] || []).filter(p => profiles[p.id]);
    const here = voice.room === r.id;
    return h("div",{class:"vroom"},
      h("div",{class:"ch" + (here ? " on" : ""),onclick:() => joinVoice(r.id),title: here ? "Ești conectat" : "Intră în canalul vocal"},
        h("span",{class:"ch-ico",text:r.emoji || "🔊"}), h("span",{class:"ch-name grow",text:r.name}),
        peers.length ? h("span",{class:"note",style:"font-size:11.5px",text:String(peers.length)}) : null,
        isAdmin ? h("button",{type:"button",class:"ch-edit",title:"Editează","aria-label":"Editează canalul vocal",text:"⚙",onclick:ev => { ev.stopPropagation(); voiceRoomModal(r); }}) : null),
      peers.length ? h("div",{class:"vpeers"}, peers.map(p => {
        const av = avatar(p.id,"xs"); av.dataset.vu = p.id; if (voiceSpeaking.has(p.id)) av.classList.add("speaking");
        const uv = settings.voice.userVol[p.id];
        return h("div",{class:"vpeer",title: p.id === uid ? (P(p.id)||{}).tag : "Volum · " + (P(p.id)||{}).tag,onclick: p.id === uid ? null : ev => { ev.stopPropagation(); userVolPop(p.id, ev.currentTarget); }}, av, h("span",{class:"grow vpn",text:(P(p.id)||{}).tag}),
          uv === 0 ? h("span",{title:"Pus pe mut de tine",text:"🔕"}) : null,
          p.muted ? h("span",{title:"Microfon oprit",text:"🔇"}) : null, p.deaf ? h("span",{title:"Sunet oprit",text:"🙉"}) : null,
          isAdmin && p.id !== uid ? h("button",{type:"button",class:"ch-edit",title:"Scoate din canal","aria-label":"Scoate din canal",text:"✕",onclick:ev => { ev.stopPropagation(); D.kickVoicePeer(r.id, p.id).catch(writeErr); }}) : null);
      })) : null);
  }), ...(voiceRooms.length ? [] : [h("div",{class:"note",style:"padding:4px 10px 8px;font-size:12.5px",text: isAdmin ? "Se creează canalul 🔊 General…" : "Niciun canal vocal încă."})]));
  const panel = $("voicePanel");
  if (!voice.room){ panel.classList.add("hidden"); panel.replaceChildren(); paintSpeaking(); return; }
  const r = voiceRooms.find(x => x.id === voice.room) || { name: "?" };
  panel.classList.remove("hidden");
  panel.replaceChildren(
    h("div",{class:"vp-top"}, h("span",{class:"vp-dot"}), h("div",{class:"grow",style:"min-width:0"}, h("b",{class:"vp-ok",text:"Conectat la voce"}), h("div",{class:"note",style:"font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis",text:(r.emoji || "🔊") + " " + r.name + " · " + voice.peers.size + " conexiuni"}))),
    h("div",{class:"vp-btns"},
      h("button",{type:"button",class:voice.muted ? "off" : "",title:"Microfon",text:(voice.muted ? "🔇" : "🎤") + " Microfon",onclick:() => setVoiceFlags(!voice.muted, voice.deaf)}),
      h("button",{type:"button",class:voice.deaf ? "off" : "",title:"Sunet",text:(voice.deaf ? "🙉" : "🎧") + " Sunet",onclick:() => setVoiceFlags(voice.muted, !voice.deaf)}),
      h("button",{type:"button",class:"vp-gear",title:"Setări voce","aria-label":"Setări voce",text:"⚙",onclick:() => openSettings("voice")}),
      h("button",{type:"button",class:"hang",title:"Deconectare",text:"Deconectare",onclick:() => leaveVoice()})),
    settings.voice.ptt ? h("div",{class:"vp-btns",style:"margin-top:6px"}, pttButton()) : null,
    h("div",{class:"note",style:"font-size:11.5px;margin-top:6px",text:"🎛️ " + nsLabel()}));
  paintSpeaking();
}

// =========================== push notifications ===========================
let pushStarted = false;
async function initPush(){
  if (pushStarted || !me) return; pushStarted = true;
  const PN = D.plugin("PushNotifications");
  if (PN){   // Android app
    try {
      await PN.createChannel({ id: "messages", name: "Mesaje", description: "Mesaje private și mențiuni", importance: 4, visibility: 1, vibration: true }).catch(() => {});
      await PN.createChannel({ id: "calls", name: "Apeluri", description: "Apeluri primite", importance: 5, visibility: 1, vibration: true }).catch(() => {});
      let st = await PN.checkPermissions();
      if (st.receive === "prompt" || st.receive === "prompt-with-rationale") st = await PN.requestPermissions();
      if (st.receive !== "granted") return;
      await PN.addListener("registration", t => D.saveDeviceToken(t.value).catch(() => {}));
      await PN.addListener("pushNotificationActionPerformed", a => {
        const d = (a && a.notification && a.notification.data) || {};
        if (d.cid){ location.hash = "#chat"; selectChannel(d.type === "mention" ? d.cid : "dm:" + d.cid); }
      });
      await PN.register();
    } catch(e){}
    return;
  }
  maybeWebPush();
}
async function maybeWebPush(){
  if (!VAPID_KEY || D.isDesktopApp || !("serviceWorker" in navigator) || !("Notification" in window)) return;
  if (!settings.notify || Notification.permission !== "granted") return;
  try { const t = await D.enableWebPush(VAPID_KEY); if (t) await D.saveDeviceToken(t); } catch(e){}
}
