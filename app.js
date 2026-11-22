// SeboTECH CHAT – app UI. All user text is rendered with textContent (no HTML injection).
import * as D from "./data.js?v=9";
import { OWNER_EMAIL, KLIPY_KEY } from "./config.js?v=9";

const EMOJIS = ["😎","🐱","🎯","🔥","💀","👑","🐺","🦖","🤖","👻","🍌","⚡","🦈","🐉","🎮","🧊","🥷","👽"];
const COLORS = ["#00e5ff","#a855f7","#ff4d6d","#ffd23f","#3ef08a","#ff9f43","#5b6cff","#ff6ad5","#ffffff"];
const BANNERS = {
  neon:"linear-gradient(120deg,#a855f7,#00e5ff)", storm:"linear-gradient(120deg,#3b1d6e,#7b2ff7 50%,#c084fc)",
  sunset:"linear-gradient(120deg,#ff4d6d,#ff9f43 60%,#ffd23f)", toxic:"linear-gradient(120deg,#0f5132,#3ef08a)",
  ice:"linear-gradient(120deg,#0b3d91,#5bc0ff 60%,#e0f7ff)", lava:"linear-gradient(120deg,#2a0a0a,#c1121f 55%,#ff9f43)",
  midnight:"linear-gradient(120deg,#0f1220,#252b4d 60%,#5b6cff)", gold:"linear-gradient(120deg,#5c4400,#ffd23f 60%,#fff3b0)"
};
const REACTS = [["fire","🔥"],["skull","💀"],["trophy","🏆"],["lol","😂"],["goat","🐐"]];
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
  const el = h("span",{class:"av" + (size ? " "+size : ""), style:"border-color:"+accent(p)}, p.avatar ? h("img",{src:p.avatar,alt:"",class:"av-img"}) : (p.emoji || "❔"));
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
  emojiPicker($("gateEmoji"), () => gateEmoji, e => gateEmoji = e);
  if (prefillKey) $("keyIn").value = prefillKey;
  $("gateErr").textContent = msg || "";
}
$("gateForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const err = $("gateErr"); err.textContent = "";
  const key = $("keyIn").value.trim().toUpperCase(), tag = $("tagIn").value.trim();
  if (!/^SEBO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return err.textContent = "Asta nu arată a cheie. Ar trebui să arate așa: SEBO-XXXX-XXXX-XXXX.";
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

  initChat();

  unsubs.push(D.watchPosts(list => { posts = list.sort((a,b)=>b.ts-a.ts); renderFeed(); }, () => $("feedList").replaceChildren(h("div",{class:"empty",text:"Postările nu s-au putut încărca."}))));
  unsubs.push(D.watchPresence(list => { presence = list; computeOnline(); }));
  setInterval(computeOnline, 15000);

  // heartbeat
  D.setPresence(false, pubCh()).catch(()=>{});
  setInterval(() => { if (!document.hidden) D.setPresence(typingNow, pubCh()).catch(()=>{}); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) D.setPresence(false, pubCh()).catch(()=>{}); });

  bindUi();
}
function startAdmin(){
  setTimeout(() => D.pruneChannels(channels.map(c => c.id), 30).catch(()=>{}), 8000);
  unsubs.push(D.watchKeys(list => { keys = list; renderKeys(); }));
}

let prevOnlineReady = false;
function computeOnline(){
  const now = Date.now(), on = new Set([uid]), ty = new Set();
  for (const p of presence){
    if (!profiles[p.id]) continue;
    if (now - p.seen < ONLINE_MS) on.add(p.id);
    if (p.typing && p.id !== uid && now - p.seen < TYPING_MS) ty.add(p.id);
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
  if (view === "chat"){ markRead(); scrollChat(true); setTimeout(()=>$("chatIn").focus(), 50); }
  if (view === "me") fillMeForm();
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", () => { if (started && me) route(); });

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
    try { await D.createPost(text.slice(0,1200), att); $("postIn").value = ""; $("postCount").textContent = ""; postAtt.clear(); }
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

// ================= SETTINGS (stored on this device) =================
const DEFAULT_SETTINGS = {
  theme: "dark", accent: "#8b7cff", fontSize: 15, compact: false, h24: true, reduceMotion: false, showAvatars: true,
  sound: true, volume: 0.6, sfx: { msg: true, mention: true, dm: true, send: true, join: false, react: true },
  notify: false, notifyAll: false, muted: {}
};
let settings = loadSettings();
function loadSettings(){
  try { const s = JSON.parse(localStorage.getItem("sebo:settings") || "{}"); return Object.assign({}, DEFAULT_SETTINGS, s, { sfx: Object.assign({}, DEFAULT_SETTINGS.sfx, s.sfx || {}), muted: Object.assign({}, s.muted || {}) }); }
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
    for (const c of channels) if (!chUnsub[c.id]) chUnsub[c.id] = D.watchMsgs(c.id, 80, msgs => onMsgs(c.id, msgs), () => {});
    for (const id of Object.keys(chUnsub)) if (!isDmId(id) && !channels.find(c => c.id === id)){ chUnsub[id](); delete chUnsub[id]; delete chMsgs[id]; }
    chReady = true; ensureCur();
    renderChannels(); renderChatHeader(); renderMsgs(true);
  }));
  unsubs.push(D.watchDms(list => {
    dms = list.sort((a,b) => b.last - a.last);
    for (const c of dms) if (!chUnsub[c.id]) chUnsub[c.id] = D.watchMsgs(c.id, 80, msgs => onMsgs(c.id, msgs), () => {});
    dmReady = true; ensureCur();
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
  if (!chReady || !dmReady){ if (isDmId(want) && ok(want)) curCh = want; return; }
  curCh = ok(want) ? want : ((dms[0] || channels[0] || {}).id || null);
}
function onMsgs(cid, list){
  const prev = chMsgs[cid] || [];
  const prevIds = new Set(prev.map(m => m.id));
  chMsgs[cid] = list.slice().sort((a,b) => a.ts - b.ts);
  if (chFirst[cid]){
    for (const m of chMsgs[cid]){
      if (prevIds.has(m.id) || m.uid === uid || Date.now() - m.ts > 60000) continue;
      const muted = settings.muted[cid];
      const here = cid === curCh && view === "chat" && !document.hidden;
      if (isDmId(cid)){ if (!muted){ playSfx("dm"); notifyDesktop(m, cid, true); } }
      else if (isMentioned(m)){ playSfx("mention"); notifyDesktop(m, cid, true); }
      else if (!muted){ if (!here || settings.sfx.msg) playSfx("msg"); if (settings.notifyAll) notifyDesktop(m, cid, false); }
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
  document.title = (mentions ? "(" + mentions + ") " : anyUnread ? "• " : "") + "SeboTECH CHAT";
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
  curCh = cid; try { localStorage.setItem("sebo:ch", cid); } catch(e){}
  replyTo = null; editing = null; renderReplyBar();
  renderChannels(); renderChatHeader(); renderMsgs(true); markRead(); renderTyping(); closeDrawer();
  setTimeout(() => $("chatIn").focus(), 30);
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
  $("chHead").replaceChildren(
    h("button",{type:"button",class:"icon dc-burger",title:"Conversații","aria-label":"Arată conversațiile",text:"☰",onclick:() => document.querySelector(".dc").classList.toggle("drawer")}),
    dm && other ? avatar(dmOther(curCh),"sm") : h("span",{class:"ch-ico big",text: c ? (c.emoji || "#") : "💬"}),
    h("b",{text: dm ? (other ? other.tag : "?") : c ? c.name : "Mesaje"}),
    dm ? h("span",{class:"ch-topic grow",text:"🔒 Conversație privată" + (online.has(dmOther(curCh)) ? " · online" : "")}) : c && c.topic ? h("span",{class:"ch-topic grow",text:c.topic}) : h("span",{class:"grow"}),
    has ? h("button",{type:"button",class:"icon",title: settings.muted[curCh] ? "Activează notificările" : "Dezactivează notificările","aria-label":"Mute",text: settings.muted[curCh] ? "🔕" : "🔔",onclick:() => { settings.muted[curCh] = !settings.muted[curCh]; if (!settings.muted[curCh]) delete settings.muted[curCh]; saveSettings(); renderChatHeader(); renderChannels(); renderChatBadge(); }}) : null,
    h("button",{type:"button",class:"icon dc-memtoggle",title:"Membri","aria-label":"Arată membrii",text:"👥",onclick:() => document.querySelector(".dc").classList.toggle("nomembers")}));
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
  const list = (chMsgs[curCh] || []).filter(m => profiles[m.uid]);
  if (!curCh){ box.replaceChildren(h("div",{class:"empty"}, h("div",{style:"font-size:42px",text:"💬"}), h("h3",{text:"Mesaje private"}), h("p",{class:"note",text:"Alege pe cineva din stânga sau apasă 💬 lângă un membru ca să-i scrii. Conversațiile sunt doar între voi doi."}), h("button",{type:"button",class:"primary",text:"Mesaj nou",onclick:dmPicker}))); return; }
  let out;
  if (isDmId(curCh)){
    const oid = dmOther(curCh), op = P(oid) || {};
    out = [h("div",{class:"ch-welcome"}, h("span",{class:"av lg",style:"border-color:" + accent(op)}, op.avatar ? h("img",{src:op.avatar,alt:"",class:"av-img"}) : (op.emoji || "❔")), h("h3",{text:op.tag || "?"}), h("div",{class:"note",text:"Ăsta e începutul conversației tale private cu " + (op.tag || "?") + ". 🔒 Doar voi doi o puteți vedea."}))];
  } else {
    const c = channels.find(x => x.id === curCh) || {};
    out = [h("div",{class:"ch-welcome"}, h("div",{class:"ch-welcome-ico",text:c.emoji || "#"}), h("h3",{text:"Bun venit în #" + (c.name || "")}), h("div",{class:"note",text: c.topic || "Ăsta e începutul canalului."}))];
  }
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
    canDel ? h("button",{type:"button",title:"Șterge","aria-label":"Șterge",class:"danger",text:"🗑",onclick:ev => { const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sigur?"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "🗑"; }, 3000); return; } D.deleteMsg(curCh, m.id, m.img).catch(writeErr); }}) : null);
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
      if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); const t = ta.value.trim(); if (!t && !m.img && !m.gif) return; D.editMsg(curCh, m.id, t.slice(0,2000)).then(() => { editing = null; renderMsgs(false); }).catch(writeErr); }
      if (e.key === "Escape"){ editing = null; renderMsgs(false); }
    });
    body.append(ta, h("div",{class:"note",style:"font-size:12px",text:"Enter = salvează · Esc = anulează"}));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 20);
  } else if (m.text){
    body.append(h("div",{class:"txt"}, richText(m.text), m.edited ? h("span",{class:"edited",text:" (editat)"}) : null));
  }
  if (m.img || m.gif) body.append(h("div",{class:"attwrap"}, attEl(m)));
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
function renderTyping(){
  const now = Date.now();
  if (!curCh || isDmId(curCh)){ $("typing").textContent = ""; return; }
  const names = presence.filter(p => p.id !== uid && p.typing && p.ch === curCh && now - p.seen < TYPING_MS && profiles[p.id]).map(p => P(p.id).tag);
  $("typing").textContent = !names.length ? "" : names.length === 1 ? names[0] + " scrie…" : names.length < 4 ? names.slice(0,-1).join(", ") + " și " + names.slice(-1) + " scriu…" : "Mai mulți oameni scriu…";
}

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
  ci.addEventListener("input", () => {
    ci.style.height = "auto"; ci.style.height = Math.min(180, ci.scrollHeight) + "px";
    updateMentionPop();
    if (isDmId(curCh)) return;   // no typing broadcast in private DMs
    if (!typingNow && ci.value.trim()){ typingNow = true; D.setPresence(true, pubCh()).catch(()=>{}); }
    clearTimeout(typingOff);
    typingOff = setTimeout(() => { if (typingNow){ typingNow = false; D.setPresence(false, pubCh()).catch(()=>{}); } }, 4000);
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
    if (typingNow){ typingNow = false; clearTimeout(typingOff); D.setPresence(false, pubCh()).catch(()=>{}); }
    try { await D.sendMsg(curCh, text.slice(0,2000), att, extra); chatAtt.clear(); replyTo = null; renderReplyBar(); playSfx("send"); scrollChat(true); }
    catch(e){ ci.value = text; writeErr(e); }
    finally { sending = false; $("chatBtn").disabled = false; }
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
function openSettings(){
  const tabs = [["look","🎨 Aspect"],["sound","🔊 Sunete"],["notif","🔔 Notificări"]];
  let tab = "look";
  const body = h("div",{class:"set-body"});
  const nav = h("div",{class:"set-nav"});
  const toggle = (label, get, set, hint) => { const cb = h("input",{type:"checkbox"}); cb.checked = !!get(); cb.onchange = () => { set(cb.checked); saveSettings(); }; return h("label",{class:"set-row"}, h("div",{class:"grow"}, h("div",{text:label}), hint ? h("div",{class:"note",text:hint}) : null), cb); };
  function draw(){
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
    } else {
      const can = "Notification" in window;
      body.replaceChildren(
        toggle("Notificări pe desktop", () => settings.notify, async v => {
          if (v && can && Notification.permission !== "granted"){ const r = await Notification.requestPermission(); if (r !== "granted"){ settings.notify = false; saveSettings(); flash("Browserul a blocat notificările.", true); draw(); return; } }
          settings.notify = v; saveSettings();
        }, can ? "Apar când site-ul e în fundal" : "Browserul tău nu suportă notificări"),
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
        h("div",{class:"meta"}, nameEl(post.uid), h("span",{text:ago(post.ts)})),
        post.text ? h("div",{class:"text"}, withMentions(post.text)) : null,
        (post.img || post.gif) ? h("div",{class:"attwrap"}, attEl(post)) : null,
        reacts, replies)));
}
function renderFeed(){
  if (!me) return;
  const vis = posts.filter(p => profiles[p.uid]);
  $("feedList").replaceChildren(...(vis.length ? vis.map(postCard) : [h("div",{class:"empty",text:"Nicio postare încă. Fă tu prima ✨"})]));
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
                   : h("button",{class:"primary",type:"button",text:"💬 Trimite mesaj privat",onclick:()=>{ closeProfile(); openDm(id); }})))
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
  const c = document.createElement("canvas"); c.width = c.height = 160;
  const g = c.getContext("2d"); g.fillStyle = "#222"; g.fillRect(0,0,160,160); g.drawImage(img, sx, sy, s, s, 0, 0, 160, 160);
  for (const q of [0.85, 0.7, 0.55]){ const d = c.toDataURL("image/jpeg", q); if (d.length < 45000) return d; }
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
