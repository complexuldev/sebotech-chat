// FolkChat media + push worker (Cloudflare Workers + R2).
//
//   POST   /upload?kind=chat|post|dm   upload one picture/GIF (Firebase ID token required, max 10 MB)
//   GET    /m/<uid>/<file>             serve a picture (public, unguessable URL, cached for a year)
//   DELETE /m/<uid>/<file>             delete your own picture
//   POST   /notify                     send a push notification (new DM, @mention, incoming call)
//
// Security:
//   * every write needs "Authorization: Bearer <Firebase ID token>"; the token's signature, audience,
//     issuer and expiry are verified against Google's public keys (no Firebase Admin SDK needed);
//   * the user must also be a FolkChat member (has claimed an invite key) – checked by reading
//     members/<uid> from Firestore WITH THE USER'S OWN TOKEN, so the Firestore rules decide;
//   * only JPEG / PNG / WebP / GIF, checked by content type AND by the file's magic bytes;
//   * CORS is locked to ALLOWED_ORIGINS; per-user rate limits on uploads and pushes.

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (req.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    try {
      if (req.method === "GET" && url.pathname.startsWith("/m/")) return await serve(req, env, ctx, url);
      if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "folkchat-media" }, 200, cors);
      // everything below changes something: browser calls must come from an allowed origin
      if (origin && !cors) return json({ error: "origin not allowed" }, 403);
      if (req.method === "POST" && url.pathname === "/upload") return await upload(req, env, url, cors);
      if (req.method === "DELETE" && url.pathname.startsWith("/m/")) return await remove(req, env, url, cors);
      if (req.method === "POST" && url.pathname === "/notify") return await notify(req, env, cors, ctx);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      const status = e.status || 500;
      return json({ error: status === 500 ? "server error" : e.message }, status, cors);
    }
  }
};

// ---------------- helpers ----------------
function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "https://complexuldev.github.io,http://localhost").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.some(a => origin === a || (a === "http://localhost" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));
  if (!ok) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" }, extra || {}) });
}
const fail = (status, message) => Object.assign(new Error(message), { status });
const b64urlToBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
const bytesToB64url = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const strToB64url = s => bytesToB64url(new TextEncoder().encode(s));

// ---------------- Firebase ID token verification ----------------
let jwksCache = { keys: null, exp: 0 };
async function jwks() {
  if (jwksCache.keys && Date.now() < jwksCache.exp) return jwksCache.keys;
  const r = await fetch(JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw fail(503, "cannot fetch Google keys");
  const maxAge = Number((/max-age=(\d+)/.exec(r.headers.get("Cache-Control") || "") || [])[1] || 3600);
  jwksCache = { keys: (await r.json()).keys, exp: Date.now() + Math.min(maxAge, 21600) * 1000 };
  return jwksCache.keys;
}
async function verifyIdToken(req, env) {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.get("Authorization") || "");
  if (!m) throw fail(401, "missing token");
  const [h64, p64, s64] = m[1].split(".");
  let header, payload;
  try { header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h64))); payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p64))); }
  catch (e) { throw fail(401, "bad token"); }
  if (header.alg !== "RS256" || !header.kid) throw fail(401, "bad token");
  const jwk = (await jwks()).find(k => k.kid === header.kid);
  if (!jwk) throw fail(401, "unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s64), new TextEncoder().encode(h64 + "." + p64));
  if (!ok) throw fail(401, "bad signature");
  const now = Math.floor(Date.now() / 1000), pid = env.FIREBASE_PROJECT_ID;
  if (payload.aud !== pid || payload.iss !== "https://securetoken.google.com/" + pid) throw fail(401, "wrong project");
  if (!(payload.exp > now) || payload.iat > now + 60 || (payload.auth_time && payload.auth_time > now + 60)) throw fail(401, "expired token");
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) throw fail(401, "bad subject");
  return { uid: payload.sub, token: m[1] };
}

// ---------------- Firestore REST (as the user, or as the service account) ----------------
const fsBase = env => "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/";
function plain(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(plain);
  if ("mapValue" in v) { const o = {}; for (const k in (v.mapValue.fields || {})) o[k] = plain(v.mapValue.fields[k]); return o; }
  return null;
}
const docData = d => { const o = {}; for (const k in (d.fields || {})) o[k] = plain(d.fields[k]); return o; };
async function fsGet(env, path, bearer) {
  const r = await fetch(fsBase(env) + path, { headers: { Authorization: "Bearer " + bearer } });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw fail(502, "firestore " + r.status);
  return docData(await r.json());
}
const memberCache = new Map();
async function requireMember(env, user) {
  const c = memberCache.get(user.uid);
  if (c && c.exp > Date.now()) return c.data;
  const data = await fsGet(env, "members/" + user.uid, user.token);   // the Firestore rules decide
  if (!data) throw fail(403, "not a member");
  memberCache.set(user.uid, { data, exp: Date.now() + 10 * 60000 });
  return data;
}
const localHits = new Map();
async function rateLimit(binding, key, max) {
  if (binding && binding.limit) { const { success } = await binding.limit({ key }); if (!success) throw fail(429, "slow down"); return; }
  const now = Date.now(), list = (localHits.get(key) || []).filter(t => now - t < 60000);   // fallback (per instance)
  if (list.length >= max) throw fail(429, "slow down");
  list.push(now); localHits.set(key, list);
}

// ---------------- media ----------------
function sniff(b) {
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
async function upload(req, env, url, cors) {
  const user = await verifyIdToken(req, env);
  await requireMember(env, user);
  await rateLimit(env.UPLOAD_LIMIT, "up:" + user.uid, 20);
  const type = (req.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES[type]) throw fail(415, "only JPEG, PNG, WebP or GIF");
  const declared = Number(req.headers.get("Content-Length") || 0);
  if (declared > MAX_BYTES) throw fail(413, "max 10 MB");
  const body = new Uint8Array(await req.arrayBuffer());
  if (!body.length) throw fail(400, "empty file");
  if (body.length > MAX_BYTES) throw fail(413, "max 10 MB");
  const real = sniff(body);
  if (real !== type) throw fail(415, "file content does not match its type");
  const kind = ["chat", "post", "dm", "avatar"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "chat";
  const rand = bytesToB64url(crypto.getRandomValues(new Uint8Array(12)));
  const key = user.uid + "/" + Date.now().toString(36) + "-" + rand + "." + TYPES[type];
  await env.MEDIA.put(key, body, {
    httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { uid: user.uid, kind }
  });
  return json({ url: url.origin + "/m/" + key }, 200, cors);
}
const KEY_RE = /^\/m\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_.-]{1,80})$/;
async function serve(req, env, ctx, url) {
  const m = KEY_RE.exec(url.pathname);
  if (!m) return new Response("not found", { status: 404 });
  const cache = caches.default, hit = await cache.match(req);
  if (hit) return hit;
  const obj = await env.MEDIA.get(m[1] + "/" + m[2]);
  if (!obj) return new Response("not found", { status: 404 });
  const ct = obj.httpMetadata && obj.httpMetadata.contentType;
  const res = new Response(obj.body, { headers: {
    "Content-Type": TYPES[ct] ? ct : "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "ETag": obj.httpEtag
  }});
  ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}
async function remove(req, env, url, cors) {
  const user = await verifyIdToken(req, env);
  const m = KEY_RE.exec(url.pathname);
  if (!m) throw fail(404, "not found");
  if (m[1] !== user.uid) throw fail(403, "not your file");
  await env.MEDIA.delete(m[1] + "/" + m[2]);
  await caches.default.delete(new Request(url.origin + url.pathname)).catch(() => {});
  return json({ ok: true }, 200, cors);
}

// ---------------- push notifications (Firebase Cloud Messaging HTTP v1) ----------------
let saCache = { token: null, exp: 0 };
async function serviceToken(env) {
  if (saCache.token && Date.now() < saCache.exp) return saCache.token;
  if (!env.SA_CLIENT_EMAIL || !env.SA_PRIVATE_KEY) throw fail(501, "push not configured");
  const now = Math.floor(Date.now() / 1000);
  const head = strToB64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = strToB64url(JSON.stringify({
    iss: env.SA_CLIENT_EMAIL, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore"
  }));
  const pem = String(env.SA_PRIVATE_KEY).replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + head + "." + claim + "." + bytesToB64url(sig)
  });
  if (!r.ok) throw fail(502, "service account login failed");
  const j = await r.json();
  saCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return saCache.token;
}
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
async function notify(req, env, cors, ctx) {
  const user = await verifyIdToken(req, env);
  const me = await requireMember(env, user);
  await rateLimit(env.NOTIFY_LIMIT, "push:" + user.uid, 30);
  let p; try { p = await req.json(); } catch (e) { throw fail(400, "bad json"); }
  const from = clip(me.tag, 24) || "Cineva";
  let targets = [], msg;
  if (p.type === "dm" || p.type === "call") {
    const pair = String(p.cid || "");
    const ids = pair.split("_");
    if (ids.length !== 2 || !ids.includes(user.uid) || !/^[A-Za-z0-9_]{3,260}$/.test(pair)) throw fail(400, "bad conversation");
    const other = ids.find(x => x !== user.uid);
    if (p.type === "dm") {
      // the sender must really be in this DM (read with the sender's own token, so the rules decide)
      if (!(await fsGet(env, "dms/" + pair, user.token))) throw fail(403, "no such conversation");
      msg = { title: "💬 " + from, body: clip(p.text, 100) || "Mesaj nou", channel: "messages", data: { type: "dm", cid: pair } };
    } else {
      const c = await fsGet(env, "calls/" + pair, user.token);
      if (!c || c.caller !== user.uid || c.state !== "ringing") throw fail(403, "no ringing call");
      msg = { title: "📞 " + from + " te sună", body: "Deschide FolkChat ca să răspunzi", channel: "calls", data: { type: "call", cid: pair } };
    }
    targets = [other];
  } else if (p.type === "mention") {
    const ch = String(p.ch || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(ch) || !(await fsGet(env, "channels/" + ch, user.token))) throw fail(400, "bad channel");
    const to = Array.isArray(p.to) ? p.to.slice(0, 25).map(String) : [];
    if (to.includes("*")) {
      const sa = await serviceToken(env);
      const r = await fetch(fsBase(env) + "members?pageSize=200&mask.fieldPaths=tag", { headers: { Authorization: "Bearer " + sa } });
      const j = r.ok ? await r.json() : { documents: [] };
      targets = (j.documents || []).map(d => d.name.split("/").pop());
    } else targets = to.filter(x => /^[A-Za-z0-9]{1,128}$/.test(x));
    msg = { title: "@ " + from + " te-a menționat", body: clip(p.text, 100), channel: "messages", data: { type: "mention", cid: ch } };
  } else throw fail(400, "bad type");
  targets = [...new Set(targets)].filter(t => t !== user.uid).slice(0, 200);
  if (!targets.length) return json({ sent: 0 }, 200, cors);
  const sa = await serviceToken(env);
  let sent = 0;
  await Promise.all(targets.map(async uid => {
    const t = await fsGet(env, "tokens/" + uid, sa);
    for (const token of ((t && t.list) || []).slice(-10)) {
      const r = await fetch("https://fcm.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/messages:send", {
        method: "POST", headers: { Authorization: "Bearer " + sa, "Content-Type": "application/json" },
        body: JSON.stringify({ message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: msg.data,
          android: { priority: "HIGH", ttl: msg.channel === "calls" ? "30s" : "86400s",
                     notification: { channel_id: msg.channel, sound: "default", tag: msg.data.type + ":" + msg.data.cid } },
          webpush: { headers: { Urgency: "high", TTL: msg.channel === "calls" ? "30" : "86400" },
                     fcm_options: { link: "https://complexuldev.github.io/sebotech-chat/#chat" } }
        }})
      });
      if (r.ok) sent++;
    }
  }));
  return json({ sent }, 200, cors);
}
