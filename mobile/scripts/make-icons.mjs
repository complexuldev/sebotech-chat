// Builds the Android adaptive-icon layers from assets/icon-only.png (the rounded-square app icon):
//   icon-background.png  = the purple→cyan gradient, full bleed (no dark frame around the icon)
//   icon-foreground.png  = just the white speech bubble, sized to fill Android's safe zone
// Android crops adaptive icons to a circle/squircle, so a full rounded-square image used as the
// foreground ends up small with a dark border; splitting it like this makes it fill the icon.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
const A = f => fileURLToPath(new URL("../assets/" + f, import.meta.url));
const SIZE = 1024;

const { data, info } = await sharp(A("icon-only.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, px = (x, y) => (y * W + x) * 4;
const white = i => data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235 && data[i + 3] > 200;

// gradient colours: sample the icon's top and bottom middle
const top = px(W >> 1, Math.round(H * 0.06)), bot = px(W >> 1, Math.round(H * 0.94));
const hex = i => "#" + [0, 1, 2].map(k => data[i + k].toString(16).padStart(2, "0")).join("");
const c1 = hex(top), c2 = hex(bot);
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`))
  .png().toFile(A("icon-background.png"));

// foreground: flood-fill the gradient from the edges; whatever it can't reach (bubble + dots) stays
const bg = new Uint8Array(W * H), stack = [];
for (let x = 0; x < W; x++){ stack.push(x, 0, x, H - 1); }
for (let y = 0; y < H; y++){ stack.push(0, y, W - 1, y); }
while (stack.length){
  const y = stack.pop(), x = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const k = y * W + x; if (bg[k] || white(k * 4)) continue;
  bg[k] = 1; stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}
const out = Buffer.alloc(W * H * 4);
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let k = 0; k < W * H; k++){
  if (bg[k]) continue;
  out[k * 4] = data[k * 4]; out[k * 4 + 1] = data[k * 4 + 1]; out[k * 4 + 2] = data[k * 4 + 2]; out[k * 4 + 3] = data[k * 4 + 3];
  const x = k % W, y = (k / W) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
}
// scale so the bubble's farthest point sits inside the safe circle (66/108 of the canvas diameter)
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
let r = 0;
for (let k = 0; k < W * H; k++) if (!bg[k]){ const x = k % W, y = (k / W) | 0; const d = Math.hypot(x - cx, y - cy); if (d > r) r = d; }
const target = SIZE * 0.27;                              // comfortably inside Android's safe zone (radius 0.3056)
const scale = target / r;
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const tw = Math.round(cw * scale), th = Math.round(ch * scale);
const bubble = await sharp(out, { raw: { width: W, height: H, channels: 4 } })
  .extract({ left: minX, top: minY, width: cw, height: ch }).resize(tw, th).png().toBuffer();
await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: bubble, left: Math.round(SIZE / 2 - (cx - minX) * scale), top: Math.round(SIZE / 2 - (cy - minY) * scale) }])
  .png().toFile(A("icon-foreground.png"));
console.log("icons:", c1, "→", c2, "bubble scale", scale.toFixed(2));
