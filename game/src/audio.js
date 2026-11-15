// Audio: every sound is synthesized with WebAudio — no audio files.
// The AudioContext is created on the first user gesture (play button);
// shot mode and headless play run silent.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  _noise(dur, filterFreq, type = 'lowpass', gain = 0.5) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }

  _tone(freq, dur, type = 'sine', gain = 0.3, slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  shot(kind) {
    if (!this.ctx) return;
    if (kind === 'rifle') { this._noise(0.12, 1800, 'lowpass', 0.7); this._tone(160, 0.09, 'sine', 0.4, 60); }
    else if (kind === 'smg') { this._noise(0.08, 2400, 'bandpass', 0.55); this._tone(200, 0.06, 'sine', 0.3, 80); }
    else if (kind === 'dmr') { this._noise(0.22, 1200, 'lowpass', 0.9); this._tone(110, 0.18, 'sine', 0.55, 45); }
    else { this._noise(0.09, 2000, 'bandpass', 0.5); this._tone(180, 0.07, 'sine', 0.35, 70); } // pistol
  }

  dryFire() { this._tone(1400, 0.03, 'square', 0.08); }
  reload() {
    this._tone(900, 0.04, 'square', 0.1);
    setTimeout(() => this._tone(650, 0.04, 'square', 0.1), 140);
  }
  hit() { this._tone(1900, 0.05, 'sine', 0.22); }
  kill() { this._tone(660, 0.09, 'sine', 0.25); setTimeout(() => this._tone(990, 0.12, 'sine', 0.25), 90); }
  hurt() { this._tone(120, 0.16, 'sawtooth', 0.3, 60); }
  beep(urgent) { this._tone(urgent ? 1500 : 1050, 0.07, 'sine', 0.22); }
  explosion() {
    this._noise(0.9, 500, 'lowpass', 1.0);
    this._tone(70, 0.8, 'sine', 0.8, 28);
  }
  grenadeThrow() { this._noise(0.15, 900, 'bandpass', 0.25); }
  bounce() { this._tone(320, 0.06, 'sine', 0.18, 180); }
  roundWin() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 'triangle', 0.28), i * 110));
  }
  roundLose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.18, 'triangle', 0.25), i * 120));
  }
  click() { this._tone(1200, 0.04, 'sine', 0.15); }
  buy() { this._tone(880, 0.06, 'sine', 0.2); setTimeout(() => this._tone(1320, 0.08, 'sine', 0.2), 70); }
}
