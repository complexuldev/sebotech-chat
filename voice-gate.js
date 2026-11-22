// FolkChat noise gate (AudioWorklet). Smooth open/close so it never clicks,
// plus a level report for the mic meter in Settings → Voce.
class FolkGate extends AudioWorkletProcessor {
  constructor(){
    super();
    this.on = false; this.th = Math.pow(10, -50 / 20);
    this.g = 1; this.hold = 0; this.t = 0; this.peak = 0;
    this.port.onmessage = e => {
      const d = e.data || {};
      if (typeof d.db === "number") this.th = Math.pow(10, d.db / 20);
      if (typeof d.on === "boolean") this.on = d.on;
    };
  }
  process(inputs, outputs){
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length || !inp[0]) return true;
    const n = inp[0].length;
    let s = 0; for (let k = 0; k < n; k++){ const v = inp[0][k]; s += v * v; }
    const rms = Math.sqrt(s / n), ms = n / sampleRate * 1000;
    if (!this.on || rms > this.th) this.hold = 220; else this.hold -= ms;
    const target = this.hold > 0 ? 1 : 0;
    const att = 1 - Math.exp(-1 / (sampleRate * 0.004)), rel = 1 - Math.exp(-1 / (sampleRate * 0.06));
    let g = this.g;
    for (let k = 0; k < n; k++){
      g += (target - g) * (target > g ? att : rel);
      for (let c = 0; c < out.length; c++){ const src = inp[c] || inp[0]; out[c][k] = src[k] * g; }
    }
    this.g = g;
    this.peak = Math.max(this.peak, rms); this.t += ms;
    if (this.t >= 50){ this.port.postMessage({ lvl: this.peak, open: target > 0 }); this.t = 0; this.peak = 0; }
    return true;
  }
}
registerProcessor("folk-gate", FolkGate);
