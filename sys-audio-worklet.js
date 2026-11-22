// FolkChat Windows app: plays the PC sound captured by the app (everything except FolkChat itself)
// into the screen share. Input: 48 kHz stereo 16-bit chunks via port.postMessage(ArrayBuffer).
class FolkSys extends AudioWorkletProcessor {
  constructor(){
    super();
    this.q = []; this.off = 0; this.frames = 0; this.playing = false;
    this.port.onmessage = e => {
      const a = new Int16Array(e.data);
      if (!a.length) return;
      this.q.push(a); this.frames += a.length / 2;
      // never fall more than ~250 ms behind: drop the oldest audio
      while (this.frames > 12000 && this.q.length > 1){ const d = this.q.shift(); this.frames -= (d.length - this.off) / 2; this.off = 0; }
    };
  }
  process(inputs, outputs){
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    if (!this.playing){
      if (this.frames < 3840){ L.fill(0); if (R !== L) R.fill(0); return true; }   // wait for 80 ms of audio first
      this.playing = true;
    }
    for (let i = 0; i < L.length; i++){
      if (!this.q.length){ L[i] = 0; R[i] = 0; this.playing = false; continue; }
      const a = this.q[0];
      L[i] = a[this.off] / 32768; R[i] = a[this.off + 1] / 32768;
      this.off += 2; this.frames--;
      if (this.off >= a.length){ this.q.shift(); this.off = 0; }
    }
    return true;
  }
}
registerProcessor("folk-sys", FolkSys);
