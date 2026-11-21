// SeboTECH CHAT – app UI. All user text is rendered with textContent (no HTML injection).
import * as D from "./data.js";
import { OWNER_EMAIL, KLIPY_KEY } from "./config.js";

const EMOJIS = ["🦙","🪂","🎯","🔥","💀","👑","🐺","🦖","🤖","👻","🍌","⚡","🦈","🐉","🎮","🧊","🥷","👽"];
const COLORS = ["#00e5ff","#a855f7","#ff4d6d","#ffd23f","#3ef08a","#ff9f43","#5b6cff","#ff6ad5","#ffffff"];
const BANNERS = {
  neon:"linear-gradient(120deg,#a855f7,#00e5ff)", storm:"linear-gradient(120deg,#3b1d6e,#7b2ff7 50%,#c084fc)",
  sunset:"linear-gradient(120deg,#ff4d6d,#ff9f43 60%,#ffd23f)", toxic:"linear-gradient(120deg,#0f5132,#3ef08a)",
  ice:"linear-gradient(120deg,#0b3d91,#5bc0ff 60%,#e0f7ff)", lava:"linear-gradient(120deg,#2a0a0a,#c1121f 55%,#ff9f43)",
  midnight:"linear-gradient(120deg,#0f1220,#252b4d 60%,#5b6cff)", gold:"linear-gradient(120deg,#5c4400,#ffd23f 60%,#fff3b0)"
};
const PLATFORMS = ["PC","PlayStation","Xbox","Switch","Mobile"];
const MODES = ["Battle Royale","Zero Build","Ranked","Reload","Creative","Duos","Squads","Arena"];
const REACTS = [["fire","🔥"],["skull","💀"],["trophy","🏆"],["lol","😂"],["goat","🐐"]];
const FIELDS = [["wins","Victorii"],["kills","Kill-uri"],["chests","Cufere"],["matches","Meciuri"]];
const ZERO = () => ({wins:0,kills:0,chests:0,matches:0});
const ONLINE_MS = 150000, TYPING_MS = 8000;

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
const timeStr = ts => new Date(ts).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"});
function ago(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60) return "acum"; if (s < 3600) return "acum " + Math.floor(s/60) + " min"; if (s < 86400) return "acum " + Math.floor(s/3600) + " h";
  if (s < 7*86400) return "acum " + Math.floor(s/86400) + " zile";
  return new Date(ts).toLocaleDateString("ro-RO",{day:"numeric",month:"short"});
}

// state
let uid = null, email = null, isAdmin = false, started = false;
let profiles = {}, me = null;
let chat = [], posts = [], totals = {}, dayStats = {}, presence = [], keys = [];
let online = new Set(), typingUids = new Set();
let view = "chat", statDay = todayKey();
let unsubDay = null, unsubs = [];
let lastSeenChat = Date.now(), unread = 0;
const openReplies = new Map();
let prefillKey = "";

const P = id => profiles[id];
const accent = p => (p && COLORS.includes(p.color)) ? p.color : COLORS[0];
const bannerOf = p => BANNERS[(p && p.banner) || "neon"] || BANNERS.neon;

function avatar(id, size){
  const p = P(id) || {};
  const el = h("span",{class:"av" + (size ? " "+size : ""), style:"border-color:"+accent(p)}, p.emoji || "❔");
  if (online.has(id)) el.append(h("span",{class:"dot",title:"Online"}));
  return el;
}
function nameEl(id, tag){ const p = P(id); return h(tag || "b",{style:"color:"+accent(p), onclick:()=>openProfile(id), text:(p && p.tag) || "Unknown"}); }
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
  try { await D.signIn(); } catch(e){ if (D.errCode(e) !== "auth/popup-closed-by-user") $("signInErr").textContent = "Conectarea n-a mers. Permite pop-up-urile pentru site și încearcă din nou."; }
});
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
  fillSelect($("platIn"), PLATFORMS);
  emojiPicker($("gateEmoji"), () => gateEmoji, e => gateEmoji = e);
  if (prefillKey) $("keyIn").value = prefillKey;
  $("gateErr").textContent = msg || "";
}
$("gateForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("gateErr"); err.textContent = "";
  const key = $("keyIn").value.trim().toUpperCase(), tag = $("tagIn").value.trim();
  if (!/^SEBO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return err.textContent = "Asta nu arată a cheie. Ar trebui să arate așa: SEBO-XXXX-XXXX-XXXX.";
  if (!tag) return err.textContent = "Alege un gamertag.";
  const btn = $("gateBtn"); btn.disabled = true; btn.textContent = "Verific cheia…";
  try {
    await D.join(key, { tag: tag.slice(0,24), emoji: gateEmoji, platform: $("platIn").value, bio:"", color: COLORS[Math.floor(Math.random()*COLORS.length)], banner:"neon", mode:"Battle Royale", drop:"", main:"", status:"", lfg:false });
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
  unsubs.push(D.watchMembers((list, cached) => {
    clearTimeout(bootTimer);
    profiles = {}; for (const m of list) profiles[m.id] = m;
    me = profiles[uid] || null;
    if (!me){ if (!cached) location.reload(); return; }
    const wasAdmin = isAdmin; isAdmin = me.role === "admin";
    if ($("app").classList.contains("hidden")){ showScreen("app"); route(); }
    if (isAdmin && !wasAdmin) startAdmin();
    $("keysCard").classList.toggle("hidden", !isAdmin);
    renderAll();
  }, e => { clearTimeout(bootTimer); $("loadingMsg").textContent = "Nu s-a putut încărca (" + D.errCode(e) + ")."; }));

  unsubs.push(D.watchChat(list => {
    const prevLast = chat.length ? chat[chat.length-1].ts : 0;
    chat = list.slice().sort((a,b)=>a.ts-b.ts);
    if (view !== "chat"){ unread = chat.filter(m => m.ts > lastSeenChat && m.uid !== uid).length; renderBadge(); }
    renderChat(prevLast);
  }, () => $("msgs").replaceChildren(h("div",{class:"empty",text:"Chatul nu s-a putut încărca."}))));

  unsubs.push(D.watchPosts(list => { posts = list.sort((a,b)=>b.ts-a.ts); renderFeed(); }, () => $("feedList").replaceChildren(h("div",{class:"empty",text:"Postările nu s-au putut încărca."}))));
  unsubs.push(D.watchTotals(t => { totals = t; renderStats(); renderSquad(); }));
  unsubs.push(D.watchPresence(list => { presence = list; computeOnline(); }));
  setInterval(computeOnline, 15000);

  // heartbeat
  D.setPresence(false).catch(()=>{});
  setInterval(() => { if (!document.hidden) D.setPresence(typingNow).catch(()=>{}); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) D.setPresence(false).catch(()=>{}); });

  openStatDay(statDay);
  bindUi();
}
function startAdmin(){
  D.pruneChat(30).catch(()=>{});
  unsubs.push(D.watchKeys(list => { keys = list; renderKeys(); }));
}

function computeOnline(){
  const now = Date.now(), on = new Set([uid]), ty = new Set();
  for (const p of presence){
    if (!profiles[p.id]) continue;
    if (now - p.seen < ONLINE_MS) on.add(p.id);
    if (p.typing && p.id !== uid && now - p.seen < TYPING_MS) ty.add(p.id);
  }
  const changed = [...on].sort().join() !== [...online].sort().join();
  online = on; typingUids = ty;
  renderTyping();
  if (changed && started && me){ renderOnline(); renderSquad(); renderChat(); }
}

// routing
const VIEWS = ["chat","feed","squad","stats","me"];
function route(){
  const v = (location.hash || "#chat").slice(1);
  view = VIEWS.includes(v) ? v : "chat";
  for (const x of VIEWS) $("v-"+x).classList.toggle("hidden", x !== view);
  for (const a of $("tabs").children) a.classList.toggle("on", a.dataset.v === view);
  if (view === "chat"){ lastSeenChat = Date.now(); unread = 0; renderBadge(); scrollChat(true); setTimeout(()=>$("chatIn").focus(), 50); }
  if (view === "me") fillMeForm();
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", () => { if (started && me) route(); });
function renderBadge(){ const b = $("chatBadge"); b.textContent = unread > 99 ? "99+" : String(unread); b.classList.toggle("hidden", !unread); }

let typingNow = false;
let uiBound = false;
function bindUi(){
  if (uiBound) return; uiBound = true;
  $("meChip").onclick = () => openProfile(uid);
  $("prevDay").onclick = () => openStatDay(shiftDay(statDay,-1));
  $("nextDay").onclick = () => { if (statDay < todayKey()) openStatDay(shiftDay(statDay,1)); };

  const ci = $("chatIn");
  let typingOff = null;
  ci.addEventListener("input", () => {
    ci.style.height = "auto"; ci.style.height = Math.min(140, ci.scrollHeight) + "px";
    if (!typingNow && ci.value.trim()){ typingNow = true; D.setPresence(true).catch(()=>{}); }
    clearTimeout(typingOff);
    typingOff = setTimeout(() => { if (typingNow){ typingNow = false; D.setPresence(false).catch(()=>{}); } }, 4000);
  });
  ci.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); $("chatForm").requestSubmit(); } });
  const chatAtt = attachBox("chat");
  ci.addEventListener("paste", e => { const f = [...(e.clipboardData && e.clipboardData.files || [])].find(f => f.type.startsWith("image/")); if (f){ e.preventDefault(); chatAtt.useFile(f); } });
  const box = document.querySelector(".chatbox");
  box.addEventListener("dragover", e => { e.preventDefault(); box.classList.add("drop"); });
  box.addEventListener("dragleave", () => box.classList.remove("drop"));
  box.addEventListener("drop", e => { e.preventDefault(); box.classList.remove("drop"); const f = e.dataTransfer.files[0]; if (f) chatAtt.useFile(f); });
  let sending = false;
  $("chatForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (sending) return;
    const text = ci.value.trim(), att = chatAtt.get(); if (!text && !att) return;
    sending = true; $("chatBtn").disabled = true;
    ci.value = ""; ci.style.height = "auto";
    if (typingNow){ typingNow = false; clearTimeout(typingOff); D.setPresence(false).catch(()=>{}); }
    try { await D.sendChat(text.slice(0,1000), att); chatAtt.clear(); scrollChat(true); }
    catch(e){ ci.value = text; writeErr(e); }
    finally { sending = false; $("chatBtn").disabled = false; }
  });

  $("postIn").addEventListener("input", () => { const n = $("postIn").value.length; $("postCount").textContent = n ? n + "/1200" : ""; });
  const postAtt = attachBox("post");
  $("postIn").addEventListener("paste", e => { const f = [...(e.clipboardData && e.clipboardData.files || [])].find(f => f.type.startsWith("image/")); if (f){ e.preventDefault(); postAtt.useFile(f); } });
  $("postForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const text = $("postIn").value.trim(), att = postAtt.get(); if (!text && !att) return;
    const btn = $("postBtn"); btn.disabled = true;
    try { await D.createPost(text.slice(0,1200), att); $("postIn").value = ""; $("postCount").textContent = ""; postAtt.clear(); }
    catch(e){ writeErr(e); }
    finally { btn.disabled = false; }
  });

  $("meForm").addEventListener("submit", saveMe);
  $("newKeyForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    try {
      const k = await D.createKey($("newKeyLabel").value.trim().slice(0,40) || "Cheie extra");
      $("newKeyLabel").value = "";
      $("newKeyOut").replaceChildren(h("p",{class:"note",style:"margin:12px 0 0",text:"Cheie nouă. Copiaz-o acum, nu va mai fi afișată:"}), keyLine(k, "Nouă"));
    } catch(e){ writeErr(e); }
  });
  $("overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeProfile(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeProfile(); });
}

function renderAll(){
  renderMeChip(); renderChat(); renderOnline(); renderFeed(); renderSquad(); renderStats(); renderKeys();
  if (view === "me") renderPreview();
  if (openId){ if (P(openId)) openProfile(openId); else closeProfile(); }
}
function renderMeChip(){
  if (!me) return;
  $("meChip").replaceChildren(avatar(uid,"sm"), h("span",{class:"nm",text:me.tag}));
  $("postAv").replaceChildren(document.createTextNode(me.emoji)); $("postAv").style.borderColor = accent(me);
}

// ---------- attachments ----------
const MAX_IMG = 850000; // data-URL length limit (rules allow 900 KB)
function readDataURL(file){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
function imgDims(src){ return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 0, h: 0 }); i.src = src; }); }
async function prepImage(file){
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Doar imagini (PNG, JPG, WEBP, GIF).");
  if (file.type === "image/gif"){
    if (file.size > 620000) throw new Error("GIF-ul e prea mare (max 600 KB). Încearcă butonul GIF.");
    const data = await readDataURL(file); const d = await imgDims(data);
    return { data, w: d.w, h: d.h };
  }
  const src = await readDataURL(file); const d = await imgDims(src);
  const img = new Image(); img.src = src; await img.decode().catch(() => {});
  let scale = Math.min(1, 1600 / Math.max(d.w || 1, d.h || 1));
  for (let round = 0; round < 6; round++){
    const w = Math.max(1, Math.round(d.w * scale)), h = Math.max(1, Math.round(d.h * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    for (const q of [0.85, 0.72, 0.6]){
      const data = c.toDataURL("image/jpeg", q);
      if (data.length <= MAX_IMG) return { data, w, h };
    }
    scale *= 0.7;
  }
  throw new Error("Imaginea e prea mare.");
}
function attachBox(kind){
  // kind: "chat" | "post"; returns controller with get/clear
  const st = { att: null };
  const prev = $(kind + "Prev");
  function show(){
    if (!st.att){ prev.classList.add("hidden"); prev.replaceChildren(); return; }
    const src = st.att.img ? st.att.img.data : st.att.gif.thumb || st.att.gif.url;
    prev.replaceChildren(h("img",{src,alt:""}), h("span",{class:"note",text: st.att.img ? "Imagine atașată" : "GIF"}),
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
  if (m.img){
    const el = h("img",{class:"att",alt:"imagine",loading:"lazy"});
    if (m.w && m.h) el.style.aspectRatio = m.w + "/" + m.h;
    D.getImage(m.img).then(src => { if (src){ el.src = src; el.onclick = () => lightbox(src); } else el.replaceWith(h("div",{class:"note",text:"(imagine ștearsă)"})); });
    return el;
  }
  if (m.gif && typeof m.gif.url === "string" && /^https:\/\/[a-z0-9.-]*klipy\.com\//.test(m.gif.url)){
    const el = h("img",{class:"att",alt:"GIF",loading:"lazy",src:m.gif.url});
    if (m.gif.w && m.gif.h){ el.style.aspectRatio = m.gif.w + "/" + m.gif.h; el.style.width = Math.min(m.gif.w, 300) + "px"; }
    el.onclick = () => lightbox(m.gif.url);
    return el;
  }
  return null;
}
function lightbox(src){
  openId = null;
  $("overlay").replaceChildren(h("img",{class:"lightbox",src,alt:""}), h("button",{class:"close lb-close",type:"button","aria-label":"Închide",text:"✕",onclick:closeProfile}));
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
  gifPop.style.bottom = (window.innerHeight - r.top + 8) + "px";
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

// ---------- chat ----------
function nearBottom(el){ return el.scrollHeight - el.scrollTop - el.clientHeight < 120; }
function scrollChat(force){ const el = $("msgs"); if (force || nearBottom(el)) requestAnimationFrame(() => el.scrollTop = el.scrollHeight); }
function renderChat(prevLast){
  if (!me) return;
  const box = $("msgs");
  const stick = nearBottom(box) || (prevLast !== undefined && chat.length && chat[chat.length-1].uid === uid && chat[chat.length-1].ts > prevLast);
  const vis = chat.filter(m => profiles[m.uid]);
  if (!vis.length){ box.replaceChildren(h("div",{class:"empty",text:"Niciun mesaj încă. Zi ceva 👋"})); return; }
  const out = []; let lastDay = null, last = null;
  for (const m of vis){
    const dk = dayKey(new Date(m.ts));
    if (dk !== lastDay){ out.push(h("div",{class:"daysep"}, h("span",{text:niceDay(dk)}))); lastDay = dk; last = null; }
    const grouped = last && last.uid === m.uid && m.ts - last.ts < 5*60000;
    const del = (m.uid === uid || isAdmin) ? h("button",{class:"link mdel",type:"button",text:"șterge",onclick:()=>D.deleteChat(m.id, m.img).catch(writeErr)}) : null;
    const cls = "msg" + (grouped ? "" : " first") + (m.uid !== uid && mentionsMe(m.text) ? " mine-mention" : "");
    out.push(h("div",{class:cls},
      grouped ? h("div",{class:"gutter"}) : avatar(m.uid),
      h("div",{class:"grow"},
        grouped ? null : h("div",{class:"who"}, nameEl(m.uid), h("span",{text:timeStr(m.ts)}), del),
        m.text ? h("div",{class:"txt"}, withMentions(m.text), grouped && !(m.img || m.gif) ? del : null) : null,
        (m.img || m.gif) ? h("div",{class:"attwrap"}, attEl(m), grouped ? del : null) : null)));
    last = m;
  }
  box.replaceChildren(...out);
  if (stick) scrollChat(true);
}
function renderTyping(){
  const names = [...typingUids].map(id => P(id) && P(id).tag).filter(Boolean);
  $("typing").textContent = !names.length ? "" : names.length === 1 ? names[0] + " scrie…" : names.slice(0,-1).join(", ") + " și " + names.slice(-1) + " scriu…";
}
function personRow(id){
  const p = P(id);
  return h("div",{class:"person",onclick:()=>openProfile(id)}, avatar(id,"sm"),
    h("div",{class:"meta grow"}, h("div",{style:"font-weight:600;color:"+accent(p),text:p.tag + (id===uid?" (tu)":"")}), h("div",{class:"st",text: p.status || p.platform})),
    p.lfg ? h("span",{class:"pill lfg",text:"LFG"}) : null);
}
function renderOnline(){
  if (!me) return;
  const ids = Object.keys(profiles).sort((a,b)=>P(a).tag.localeCompare(P(b).tag));
  const on = ids.filter(id => online.has(id)), off = ids.filter(id => !online.has(id));
  $("onlineCount").textContent = on.length;
  $("onlineList").replaceChildren(...on.map(personRow));
  $("offlineList").replaceChildren(...(off.length ? off.map(personRow) : [h("div",{class:"note",text:"Toată lumea e aici 🔥"})]));
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
  if (post.uid === uid || isAdmin) reacts.append(h("button",{type:"button",class:"link",text:"șterge",onclick:()=>{ if (confirmTwice(post.id)) D.deletePost(post.id, post.img).catch(writeErr); }}));
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
        h("div",{class:"meta"}, nameEl(post.uid), h("span",{text:(P(post.uid)||{}).platform||""}), h("span",{text:"· " + ago(post.ts)})),
        post.text ? h("div",{class:"text"}, withMentions(post.text)) : null,
        (post.img || post.gif) ? h("div",{class:"attwrap"}, attEl(post)) : null,
        reacts, replies)));
}
function renderFeed(){
  if (!me) return;
  const vis = posts.filter(p => profiles[p.uid]);
  $("feedList").replaceChildren(...(vis.length ? vis.map(postCard) : [h("div",{class:"empty",text:"Nicio postare încă. Fă tu prima 🎮"})]));
}

// ---------- squad ----------
function renderSquad(){
  if (!me) return;
  const ids = Object.keys(profiles).sort((a,b)=> (online.has(b)-online.has(a)) || P(a).tag.localeCompare(P(b).tag));
  $("squadGrid").replaceChildren(...ids.map(id => {
    const p = P(id), t = Object.assign(ZERO(), totals[id]||{});
    return h("div",{class:"pcard",onclick:()=>openProfile(id)},
      h("div",{class:"bn",style:"background:"+bannerOf(p)}),
      h("div",{class:"bd"}, avatar(id),
        h("div",{class:"nm",style:"color:"+accent(p)}, p.tag),
        h("div",{class:"row",style:"gap:6px;margin-top:4px;flex-wrap:wrap"}, h("span",{class:"pill",text:p.platform}), p.lfg ? h("span",{class:"pill lfg",text:"LFG"}) : null, p.role === "admin" ? h("span",{class:"pill",text:"admin"}) : null, online.has(id) ? h("span",{class:"pill",style:"color:var(--green)",text:"● online"}) : null),
        h("div",{class:"bio",text:p.bio || p.status || "Fără bio încă."}),
        h("div",{class:"mini"}, h("span",null,h("b",{text:String(t.wins)})," victorii"), h("span",null,h("b",{text:String(t.kills)})," kill-uri"), h("span",null,h("b",{text:String(t.chests)})," 📦"))));
  }));
}

// ---------- profile modal ----------
function profileView(id, p, preview){
  const t = Object.assign(ZERO(), totals[id]||{}), today = Object.assign(ZERO(), (statDay===todayKey() ? dayStats[id] : null) || {});
  const theirPosts = posts.filter(x => x.uid === id).slice(0,3);
  const fact = (k,v) => v ? h("div",{class:"fact"}, h("div",{class:"k",text:k}), h("div",{class:"v",text:v})) : null;
  return [
    h("div",{class:"bn",style:"background:"+bannerOf(p)}),
    h("div",{class:"bd"},
      h("span",{class:"av lg",style:"border-color:var(--panel);box-shadow:0 0 0 3px "+accent(p)}, p.emoji, online.has(id) ? h("span",{class:"dot",style:"width:18px;height:18px"}) : null),
      h("div",{class:"nm"}, h("span",{style:"color:"+accent(p),text:p.tag}), h("span",{class:"pill",text:p.platform}), p.lfg ? h("span",{class:"pill lfg",text:"Caută echipă"}) : null),
      p.status ? h("div",{class:"note",style:"margin-top:2px",text:"“" + p.status + "”"}) : null,
      p.bio ? h("p",{style:"margin:12px 0 0;white-space:pre-wrap",text:p.bio}) : null,
      h("div",{class:"facts"}, fact("Modul preferat",p.mode), fact("Aterizează la",p.drop), fact("Loadout principal",p.main), fact("Membru din", p.joined ? new Date(p.joined).toLocaleDateString("ro-RO",{day:"numeric",month:"short",year:"numeric"}) : "")),
      h("div",{class:"h2",style:"margin-top:18px"},"Total"),
      h("div",{class:"stats-grid"}, FIELDS.map(([f,l]) => h("div",{class:"stat"}, h("div",{class:"n c-"+f,text:String(t[f])}), h("div",{class:"k",text:l})))),
      h("div",{class:"note",style:"margin-top:8px"}, "Azi: " + FIELDS.map(([f,l]) => today[f] + " " + l.toLowerCase()).join(" · ")),
      theirPosts.length ? h("div",{class:"h2",style:"margin-top:18px"},"Postări recente") : null,
      theirPosts.map(x => h("div",{class:"fact",style:"margin-bottom:8px"}, h("div",{class:"k",text:ago(x.ts)}), h("div",{class:"v",style:"font-weight:500;white-space:pre-wrap",text: !x.text ? (x.img ? "🖼️ imagine" : "🎞️ GIF") : x.text.length > 220 ? x.text.slice(0,220)+"…" : x.text}))),
      preview ? null : h("div",{class:"row",style:"margin-top:16px;gap:8px"},
        id === uid ? h("button",{class:"primary",type:"button",text:"Editează profilul",onclick:()=>{ closeProfile(); location.hash = "#me"; }})
                   : h("button",{class:"primary",type:"button",text:"Dă-i tag în chat",onclick:()=>{ closeProfile(); location.hash = "#chat"; const ci = $("chatIn"); ci.value = "@" + p.tag + " " + ci.value; setTimeout(()=>ci.focus(),60); }})))
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

// ---------- stats ----------
function openStatDay(k){
  statDay = k;
  $("dayLabel").replaceChildren(document.createTextNode(niceDay(k)), h("small",{text:parseDay(k).toLocaleDateString("ro-RO",{day:"numeric",month:"long",year:"numeric"})}));
  $("nextDay").disabled = k === todayKey();
  $("dayLbTitle").textContent = "Clasament · " + niceDay(k);
  if (unsubDay) unsubDay();
  dayStats = {}; renderStats();
  unsubDay = D.watchDayStats(k, o => { dayStats = o; renderStats(); });
}
let statWriting = false;
async function bump(field, delta){
  if (statWriting) return;
  const cur = Object.assign(ZERO(), dayStats[uid] || {});
  const next = Math.max(0, cur[field] + delta);
  if (next === cur[field]) return;
  const diff = next - cur[field]; cur[field] = next;
  const tot = Object.assign(ZERO(), totals[uid] || {}); tot[field] = Math.max(0, tot[field] + diff);
  dayStats[uid] = cur; totals[uid] = tot; renderStats();
  statWriting = true;
  try { await D.saveStats(statDay, {wins:cur.wins,kills:cur.kills,chests:cur.chests,matches:cur.matches}, {wins:tot.wins,kills:tot.kills,chests:tot.chests,matches:tot.matches}); }
  catch(e){ writeErr(e); } finally { statWriting = false; }
}
function leaderboard(src){
  const rows = Object.keys(profiles).map(id => ({id, s:Object.assign(ZERO(), src[id]||{})}))
    .sort((a,b)=> b.s.wins-a.s.wins || b.s.kills-a.s.kills || b.s.chests-a.s.chests || P(a.id).tag.localeCompare(P(b.id).tag));
  if (!rows.length) return h("div",{class:"note",text:"Nimeni aici încă."});
  const medal = i => ["🥇","🥈","🥉"][i] || String(i+1);
  return h("table",{class:"lb"},
    h("thead",null,h("tr",null, h("th",{text:"Jucător"}), h("th",{text:"V"}), h("th",{text:"K"}), h("th",{text:"📦"}), h("th",{text:"M"}))),
    h("tbody",null, rows.map((r,i) => h("tr",{class:r.id===uid?"me":""},
      h("td",{class:"who",onclick:()=>openProfile(r.id)}, h("span",{style:"width:22px;text-align:center",text: r.s.wins||r.s.kills||r.s.chests ? medal(i) : "·"}), avatar(r.id,"sm"), h("span",{style:"color:"+accent(P(r.id)),text:P(r.id).tag})),
      h("td",{class:"c-wins",text:String(r.s.wins)}), h("td",{text:String(r.s.kills)}), h("td",{text:String(r.s.chests)}), h("td",{class:"note",text:String(r.s.matches)})))));
}
function renderStats(){
  if (!me) return;
  const mine = Object.assign(ZERO(), dayStats[uid]||{});
  $("myStats").replaceChildren(...FIELDS.map(([f,l]) => h("div",{class:"stat"},
    h("div",{class:"n c-"+f,text:String(mine[f])}), h("div",{class:"k",text:l}),
    h("div",{class:"ctl"},
      h("button",{class:"tiny",type:"button","aria-label":"Minus unu la "+l,text:"−",onclick:()=>bump(f,-1)}),
      h("button",{class:"tiny",type:"button","aria-label":"Plus unu la "+l,text:"+",onclick:()=>bump(f,1)})))));
  $("dayLb").replaceChildren(leaderboard(dayStats));
  $("allLb").replaceChildren(leaderboard(totals));
}

// ---------- my profile ----------
let draft = null;
function fillMeForm(){
  if (!me) return;
  draft = Object.assign({bio:"",color:COLORS[0],banner:"neon",mode:MODES[0],drop:"",main:"",status:"",lfg:false}, me);
  $("mTag").value = draft.tag; $("mBio").value = draft.bio; $("mDrop").value = draft.drop; $("mMain").value = draft.main; $("mStatus").value = draft.status; $("mLfg").checked = !!draft.lfg;
  fillSelect($("mPlat"), PLATFORMS, draft.platform); fillSelect($("mMode"), MODES, draft.mode);
  emojiPicker($("mEmoji"), () => draft.emoji, e => { draft.emoji = e; renderPreview(); });
  const sw = $("mColor");
  sw.replaceChildren(...COLORS.map(c => h("button",{type:"button","aria-label":"Color "+c,class:c===draft.color?"on":"",style:"background:"+c,onclick:()=>{ draft.color = c; for (const b of sw.children) b.classList.toggle("on", b.getAttribute("aria-label")==="Color "+c); renderPreview(); }})));
  const bn = $("mBanner");
  bn.replaceChildren(...Object.keys(BANNERS).map(k => h("button",{type:"button",title:k,"aria-label":"Banner "+k,class:k===draft.banner?"on":"",style:"background:"+BANNERS[k],onclick:()=>{ draft.banner = k; for (const b of bn.children) b.classList.toggle("on", b.title===k); renderPreview(); }})));
  for (const [id,f] of [["mTag","tag"],["mBio","bio"],["mDrop","drop"],["mMain","main"],["mStatus","status"]]) $(id).oninput = () => { draft[f] = $(id).value; renderPreview(); };
  $("mPlat").onchange = () => { draft.platform = $("mPlat").value; renderPreview(); };
  $("mMode").onchange = () => { draft.mode = $("mMode").value; renderPreview(); };
  $("mLfg").onchange = () => { draft.lfg = $("mLfg").checked; renderPreview(); };
  $("meMsg").textContent = "";
  renderPreview(); renderKeys();
}
function renderPreview(){
  if (!draft) return;
  const p = Object.assign({}, draft, {tag: draft.tag.trim() || me.tag});
  $("mePreview").replaceChildren(h("div",{class:"modal",style:"max-width:none"}, ...profileView(uid, p, true)));
}
async function saveMe(ev){
  ev.preventDefault(); if (!draft) return;
  const tag = draft.tag.trim();
  if (!tag){ $("meMsg").textContent = "Gamertag-ul nu poate fi gol."; return; }
  if (Object.entries(profiles).some(([id,p]) => id !== uid && p.tag.toLowerCase() === tag.toLowerCase())){ $("meMsg").textContent = "Cineva are deja gamertag-ul ăsta."; return; }
  const btn = $("meSave"); btn.disabled = true; $("meMsg").textContent = "Se salvează…";
  try {
    await D.saveProfile({ tag: tag.slice(0,24), emoji: EMOJIS.includes(draft.emoji) ? draft.emoji : me.emoji, platform: draft.platform, bio: draft.bio.slice(0,200), color: draft.color, banner: draft.banner, mode: draft.mode, drop: draft.drop.slice(0,40), main: draft.main.slice(0,40), status: draft.status.slice(0,60), lfg: !!draft.lfg });
    $("meMsg").textContent = "Salvat ✓";
  } catch(e){ $("meMsg").textContent = ""; writeErr(e); }
  finally { btn.disabled = false; }
}

// ---------- admin: keys ----------
const keyLabel = l => String(l || "Cheie").replace("Owner key","Cheia ta 👑").replace(/^Key /,"Cheia ").replace("Extra key","Cheie extra");
function renderKeys(){
  if (!isAdmin) return;
  const sorted = keys.slice().sort((a,b) => (b.admin - a.admin) || String(a.label).localeCompare(String(b.label), undefined, {numeric:true}));
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
