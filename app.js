// SeboTECH CHAT – app UI. All user text is rendered with textContent (no HTML injection).
import * as D from "./data.js";
import { OWNER_EMAIL } from "./config.js";

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
const FIELDS = [["wins","Wins"],["kills","Kills"],["chests","Chests"],["matches","Matches"]];
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
function niceDay(k){ const t = todayKey(); if (k===t) return "Today"; if (k===shiftDay(t,-1)) return "Yesterday"; return parseDay(k).toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"short"}); }
const timeStr = ts => new Date(ts).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
function ago(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s/60)+"m ago"; if (s < 86400) return Math.floor(s/3600)+"h ago";
  if (s < 7*86400) return Math.floor(s/86400)+"d ago";
  return new Date(ts).toLocaleDateString(undefined,{day:"numeric",month:"short"});
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
  if (c === "permission-denied") flash("Blocked: you're sending too fast, or that isn't allowed. Wait a second and try again.", true);
  else if (c === "resource-exhausted") flash("The free database limit for today is used up. Try again tomorrow.", true);
  else if (c === "unavailable") flash("You're offline. It'll send when you reconnect.", true);
  else flash("That didn't go through. Try again.", true);
}

// ---------- auth flow ----------
$("signInBtn").addEventListener("click", async () => {
  $("signInErr").textContent = "";
  try { await D.signIn(); } catch(e){ if (D.errCode(e) !== "auth/popup-closed-by-user") $("signInErr").textContent = "Sign-in didn't work. Allow pop-ups for this site and try again."; }
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
    if (!done){ showGate("This site hasn't been set up yet. The owner needs to sign in first."); return; }
    showGate();
  } catch(e){ $("loadingMsg").textContent = "Couldn't connect (" + D.errCode(e) + "). Refresh to try again."; }
});

// ---------- setup (owner, once) ----------
$("setupBtn").addEventListener("click", async () => {
  const btn = $("setupBtn"); btn.disabled = true; btn.textContent = "Creating keys…"; $("setupErr").textContent = "";
  try {
    const ks = await D.bootstrap(5);
    prefillKey = ks[0];
    $("setupBody").replaceChildren(
      h("p",{class:"note",style:"margin-top:0",text:"Your keys are below. Copy them somewhere safe NOW. They're stored scrambled, so they can't be shown again. Key 1 is yours."}),
      ...ks.map((k,i) => keyLine(k, i === 0 ? "Owner key (yours)" : "Key " + (i+1))),
      h("button",{class:"primary",type:"button",style:"width:100%;margin-top:14px",text:"I've saved them, continue",onclick:()=>showGate()}));
  } catch(e){
    btn.disabled = false; btn.textContent = "Create my 5 keys";
    $("setupErr").textContent = D.errCode(e) === "permission-denied" ? "Not allowed. Check that your email is set as the owner in firestore.rules, and that setup hasn't already been done." : "Something went wrong: " + D.errCode(e);
  }
});
function keyLine(k, label){
  return h("div",{class:"row",style:"margin-top:8px"},
    h("span",{class:"pill",text:label}),
    h("code",{class:"grow",style:"font-size:15px;letter-spacing:1px;color:var(--accent)",text:k}),
    h("button",{class:"tiny",type:"button",text:"Copy",onclick:ev => { const b = ev.currentTarget; navigator.clipboard.writeText(k).then(() => b.textContent = "Copied ✓", () => b.textContent = "Select & copy"); }}));
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
  if (!/^SEBO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return err.textContent = "That doesn't look like a key. It should look like SEBO-XXXX-XXXX-XXXX.";
  if (!tag) return err.textContent = "Pick a gamertag.";
  const btn = $("gateBtn"); btn.disabled = true; btn.textContent = "Checking key…";
  try {
    await D.join(key, { tag: tag.slice(0,24), emoji: gateEmoji, platform: $("platIn").value, bio:"", color: COLORS[Math.floor(Math.random()*COLORS.length)], banner:"neon", mode:"Battle Royale", drop:"", main:"", status:"", lfg:false });
    startApp();
  } catch(e){
    err.textContent = D.errCode(e) === "permission-denied" ? "That key doesn't work or was already used. Each key works once." : "Something went wrong (" + D.errCode(e) + "). Try again.";
    btn.disabled = false; btn.textContent = "Enter SeboTECH CHAT";
  }
});

// ---------- app ----------
function startApp(){
  if (started) return; started = true;
  showScreen("loading");
  const bootTimer = setTimeout(() => { $("loadingMsg").textContent = "Still connecting… check your internet."; }, 10000);
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
  }, e => { clearTimeout(bootTimer); $("loadingMsg").textContent = "Couldn't load (" + D.errCode(e) + ")."; }));

  unsubs.push(D.watchChat(list => {
    const prevLast = chat.length ? chat[chat.length-1].ts : 0;
    chat = list.slice().sort((a,b)=>a.ts-b.ts);
    if (view !== "chat"){ unread = chat.filter(m => m.ts > lastSeenChat && m.uid !== uid).length; renderBadge(); }
    renderChat(prevLast);
  }, () => $("msgs").replaceChildren(h("div",{class:"empty",text:"Couldn't load the chat."}))));

  unsubs.push(D.watchPosts(list => { posts = list.sort((a,b)=>b.ts-a.ts); renderFeed(); }, () => $("feedList").replaceChildren(h("div",{class:"empty",text:"Couldn't load the feed."}))));
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
  $("chatForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const text = ci.value.trim(); if (!text) return;
    ci.value = ""; ci.style.height = "auto";
    if (typingNow){ typingNow = false; clearTimeout(typingOff); D.setPresence(false).catch(()=>{}); }
    try { await D.sendChat(text.slice(0,1000)); scrollChat(true); }
    catch(e){ ci.value = text; writeErr(e); }
  });

  $("postIn").addEventListener("input", () => { const n = $("postIn").value.length; $("postCount").textContent = n ? n + "/1200" : ""; });
  $("postForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const text = $("postIn").value.trim(); if (!text) return;
    const btn = $("postBtn"); btn.disabled = true;
    try { await D.createPost(text.slice(0,1200)); $("postIn").value = ""; $("postCount").textContent = ""; }
    catch(e){ writeErr(e); }
    finally { btn.disabled = false; }
  });

  $("meForm").addEventListener("submit", saveMe);
  $("newKeyForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    try {
      const k = await D.createKey($("newKeyLabel").value.trim().slice(0,40) || "Extra key");
      $("newKeyLabel").value = "";
      $("newKeyOut").replaceChildren(h("p",{class:"note",style:"margin:12px 0 0",text:"New key. Copy it now, it won't be shown again:"}), keyLine(k, "New"));
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

// ---------- chat ----------
function nearBottom(el){ return el.scrollHeight - el.scrollTop - el.clientHeight < 120; }
function scrollChat(force){ const el = $("msgs"); if (force || nearBottom(el)) requestAnimationFrame(() => el.scrollTop = el.scrollHeight); }
function renderChat(prevLast){
  if (!me) return;
  const box = $("msgs");
  const stick = nearBottom(box) || (prevLast !== undefined && chat.length && chat[chat.length-1].uid === uid && chat[chat.length-1].ts > prevLast);
  const vis = chat.filter(m => profiles[m.uid]);
  if (!vis.length){ box.replaceChildren(h("div",{class:"empty",text:"No messages yet. Say something 👋"})); return; }
  const out = []; let lastDay = null, last = null;
  for (const m of vis){
    const dk = dayKey(new Date(m.ts));
    if (dk !== lastDay){ out.push(h("div",{class:"daysep"}, h("span",{text:niceDay(dk)}))); lastDay = dk; last = null; }
    const grouped = last && last.uid === m.uid && m.ts - last.ts < 5*60000;
    const del = (m.uid === uid || isAdmin) ? h("button",{class:"link mdel",type:"button",text:"delete",onclick:()=>D.deleteChat(m.id).catch(writeErr)}) : null;
    const cls = "msg" + (grouped ? "" : " first") + (m.uid !== uid && mentionsMe(m.text) ? " mine-mention" : "");
    out.push(h("div",{class:cls},
      grouped ? h("div",{class:"gutter"}) : avatar(m.uid),
      h("div",{class:"grow"},
        grouped ? null : h("div",{class:"who"}, nameEl(m.uid), h("span",{text:timeStr(m.ts)}), del),
        h("div",{class:"txt"}, withMentions(m.text), grouped ? del : null))));
    last = m;
  }
  box.replaceChildren(...out);
  if (stick) scrollChat(true);
}
function renderTyping(){
  const names = [...typingUids].map(id => P(id) && P(id).tag).filter(Boolean);
  $("typing").textContent = !names.length ? "" : names.length === 1 ? names[0] + " is typing…" : names.slice(0,-1).join(", ") + " and " + names.slice(-1) + " are typing…";
}
function personRow(id){
  const p = P(id);
  return h("div",{class:"person",onclick:()=>openProfile(id)}, avatar(id,"sm"),
    h("div",{class:"meta grow"}, h("div",{style:"font-weight:600;color:"+accent(p),text:p.tag + (id===uid?" (you)":"")}), h("div",{class:"st",text: p.status || p.platform})),
    p.lfg ? h("span",{class:"pill lfg",text:"LFG"}) : null);
}
function renderOnline(){
  if (!me) return;
  const ids = Object.keys(profiles).sort((a,b)=>P(a).tag.localeCompare(P(b).tag));
  const on = ids.filter(id => online.has(id)), off = ids.filter(id => !online.has(id));
  $("onlineCount").textContent = on.length;
  $("onlineList").replaceChildren(...on.map(personRow));
  $("offlineList").replaceChildren(...(off.length ? off.map(personRow) : [h("div",{class:"note",text:"Everyone's here 🔥"})]));
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
function confirmTwice(id){ const t = pendingDel.get(id); if (t && Date.now()-t < 4000){ pendingDel.delete(id); return true; } pendingDel.set(id, Date.now()); flash("Click delete again to remove it."); return false; }
function postCard(post){
  const reacts = h("div",{class:"reacts"});
  for (const [k,e] of REACTS){
    const n = reactCount(post,k), on = !!(post.reactions && post.reactions[k+"_"+uid]);
    reacts.append(h("button",{type:"button",class:on?"on":"",text:e+(n?" "+n:""),onclick:()=>toggleReact(post,k)}));
  }
  const rc = Math.max(0, post.replyCount || 0);
  reacts.append(h("button",{type:"button",class:"link",style:"margin-left:auto",text: openReplies.has(post.id) ? "Hide comments" : (rc ? "💬 " + rc + (rc===1?" comment":" comments") : "💬 Comment"),onclick:()=>toggleReplies(post)}));
  if (post.uid === uid || isAdmin) reacts.append(h("button",{type:"button",class:"link",text:"delete",onclick:()=>{ if (confirmTwice(post.id)) D.deletePost(post.id).catch(writeErr); }}));
  let replies = null;
  const entry = openReplies.get(post.id);
  if (entry){
    const input = h("input",{placeholder:"Write a comment…",maxlength:"500"});
    input.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); addReply(post,input); } });
    replies = h("div",{class:"replies"},
      entry.list.filter(r => profiles[r.uid]).map(r => h("div",{class:"reply"}, avatar(r.uid,"sm"),
        h("div",{class:"grow"}, h("div",null, nameEl(r.uid), h("span",{class:"note",text:"  " + ago(r.ts)}),
          (r.uid===uid||isAdmin) ? h("button",{class:"link",style:"margin-left:8px",type:"button",text:"delete",onclick:()=>D.deleteReply(post.id, r.id).catch(writeErr)}) : null),
          h("div",{class:"rt"}, withMentions(r.text))))),
      h("div",{class:"row",style:"margin-top:8px"}, input, h("button",{type:"button",class:"tiny",text:"Reply",onclick:()=>addReply(post,input)})));
  }
  return h("div",{class:"card post"},
    h("div",{class:"row",style:"align-items:flex-start"}, avatar(post.uid),
      h("div",{class:"grow"},
        h("div",{class:"meta"}, nameEl(post.uid), h("span",{text:(P(post.uid)||{}).platform||""}), h("span",{text:"· " + ago(post.ts)})),
        h("div",{class:"text"}, withMentions(post.text)),
        reacts, replies)));
}
function renderFeed(){
  if (!me) return;
  const vis = posts.filter(p => profiles[p.uid]);
  $("feedList").replaceChildren(...(vis.length ? vis.map(postCard) : [h("div",{class:"empty",text:"No posts yet. Drop the first one 🎮"})]));
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
        h("div",{class:"bio",text:p.bio || p.status || "No bio yet."}),
        h("div",{class:"mini"}, h("span",null,h("b",{text:String(t.wins)})," wins"), h("span",null,h("b",{text:String(t.kills)})," kills"), h("span",null,h("b",{text:String(t.chests)})," 📦"))));
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
      h("div",{class:"nm"}, h("span",{style:"color:"+accent(p),text:p.tag}), h("span",{class:"pill",text:p.platform}), p.lfg ? h("span",{class:"pill lfg",text:"Looking for squad"}) : null),
      p.status ? h("div",{class:"note",style:"margin-top:2px",text:"“" + p.status + "”"}) : null,
      p.bio ? h("p",{style:"margin:12px 0 0;white-space:pre-wrap",text:p.bio}) : null,
      h("div",{class:"facts"}, fact("Favorite mode",p.mode), fact("Drops at",p.drop), fact("Main loadout",p.main), fact("Joined", p.joined ? new Date(p.joined).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}) : "")),
      h("div",{class:"h2",style:"margin-top:18px"},"All-time"),
      h("div",{class:"stats-grid"}, FIELDS.map(([f,l]) => h("div",{class:"stat"}, h("div",{class:"n c-"+f,text:String(t[f])}), h("div",{class:"k",text:l})))),
      h("div",{class:"note",style:"margin-top:8px"}, "Today: " + FIELDS.map(([f,l]) => today[f] + " " + l.toLowerCase()).join(" · ")),
      theirPosts.length ? h("div",{class:"h2",style:"margin-top:18px"},"Recent posts") : null,
      theirPosts.map(x => h("div",{class:"fact",style:"margin-bottom:8px"}, h("div",{class:"k",text:ago(x.ts)}), h("div",{class:"v",style:"font-weight:500;white-space:pre-wrap",text: x.text.length > 220 ? x.text.slice(0,220)+"…" : x.text}))),
      preview ? null : h("div",{class:"row",style:"margin-top:16px;gap:8px"},
        id === uid ? h("button",{class:"primary",type:"button",text:"Edit profile",onclick:()=>{ closeProfile(); location.hash = "#me"; }})
                   : h("button",{class:"primary",type:"button",text:"@ them in chat",onclick:()=>{ closeProfile(); location.hash = "#chat"; const ci = $("chatIn"); ci.value = "@" + p.tag + " " + ci.value; setTimeout(()=>ci.focus(),60); }})))
  ];
}
let openId = null;
function openProfile(id){
  const p = P(id); if (!p) return;
  openId = id;
  $("overlay").replaceChildren(h("div",{class:"modal",role:"dialog","aria-label":p.tag+" profile"}, h("button",{class:"close",type:"button","aria-label":"Close",text:"✕",onclick:closeProfile}), ...profileView(id,p)));
  $("overlay").classList.remove("hidden");
}
function closeProfile(){ openId = null; $("overlay").classList.add("hidden"); }

// ---------- stats ----------
function openStatDay(k){
  statDay = k;
  $("dayLabel").replaceChildren(document.createTextNode(niceDay(k)), h("small",{text:parseDay(k).toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"})}));
  $("nextDay").disabled = k === todayKey();
  $("dayLbTitle").textContent = niceDay(k) + " leaderboard";
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
  if (!rows.length) return h("div",{class:"note",text:"Nobody here yet."});
  const medal = i => ["🥇","🥈","🥉"][i] || String(i+1);
  return h("table",{class:"lb"},
    h("thead",null,h("tr",null, h("th",{text:"Player"}), h("th",{text:"W"}), h("th",{text:"K"}), h("th",{text:"📦"}), h("th",{text:"M"}))),
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
      h("button",{class:"tiny",type:"button","aria-label":"Minus one "+l,text:"−",onclick:()=>bump(f,-1)}),
      h("button",{class:"tiny",type:"button","aria-label":"Plus one "+l,text:"+",onclick:()=>bump(f,1)})))));
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
  if (!tag){ $("meMsg").textContent = "Gamertag can't be empty."; return; }
  if (Object.entries(profiles).some(([id,p]) => id !== uid && p.tag.toLowerCase() === tag.toLowerCase())){ $("meMsg").textContent = "Someone already has that gamertag."; return; }
  const btn = $("meSave"); btn.disabled = true; $("meMsg").textContent = "Saving…";
  try {
    await D.saveProfile({ tag: tag.slice(0,24), emoji: EMOJIS.includes(draft.emoji) ? draft.emoji : me.emoji, platform: draft.platform, bio: draft.bio.slice(0,200), color: draft.color, banner: draft.banner, mode: draft.mode, drop: draft.drop.slice(0,40), main: draft.main.slice(0,40), status: draft.status.slice(0,60), lfg: !!draft.lfg });
    $("meMsg").textContent = "Saved ✓";
  } catch(e){ $("meMsg").textContent = ""; writeErr(e); }
  finally { btn.disabled = false; }
}

// ---------- admin: keys ----------
function renderKeys(){
  if (!isAdmin) return;
  const sorted = keys.slice().sort((a,b) => (b.admin - a.admin) || String(a.label).localeCompare(String(b.label), undefined, {numeric:true}));
  $("keysList").replaceChildren(...sorted.map(k => {
    const who = k.claimedBy && profiles[k.claimedBy] ? k.claimedBy : null;
    return h("div",{class:"line"},
      h("span",{class:"pill",text:k.label || "Key"}),
      who ? h("span",null, nameEl(who,"span"), who===uid ? h("span",{class:"note",text:" (you)"}) : null) : h("span",{class:"note",text:"unused"}),
      who && who !== uid ? h("button",{class:"tiny",type:"button",style:"margin-left:auto",text:"Free up",onclick:async ev => {
        const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sure? Click again"; return; }
        b.disabled = true; try { await D.freeKey(k.hash, who); } catch(e){ b.disabled = false; b.textContent = "Failed, retry"; writeErr(e); }
      }}) : null,
      !who && !k.admin ? h("button",{class:"tiny",type:"button",style:"margin-left:auto",text:"Delete key",onclick:async ev => {
        const b = ev.currentTarget; if (b.dataset.sure !== "1"){ b.dataset.sure = "1"; b.textContent = "Sure? Click again"; return; }
        b.disabled = true; try { await D.deleteKey(k.hash); } catch(e){ b.disabled = false; writeErr(e); }
      }}) : null);
  }));
}
