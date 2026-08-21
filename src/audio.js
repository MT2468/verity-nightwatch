export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.ambientGain = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) {
      if (this.ctx?.state === "suspended") await this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.34;
    this.master.connect(this.ctx.destination);

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.022;
    this.ambientGain.connect(this.master);

    this.ambient = this.ctx.createOscillator();
    this.ambient.type = "sine";
    this.ambient.frequency.value = 43;
    this.ambient.connect(this.ambientGain);
    this.ambient.start();

    this.ready = true;
  }

  setTension(level) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const target = 43 + level * 8;
    this.ambient.frequency.cancelScheduledValues(now);
    this.ambient.frequency.linearRampToValueAtTime(target, now + 0.4);
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.linearRampToValueAtTime(0.022 + level * 0.007, now + 0.4);
  }

  tone(freq = 440, duration = 0.08, type = "square", volume = 0.06, detune = 0) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  relay() {
    this.tone(220, 0.12, "square", 0.08);
    setTimeout(() => this.tone(440, 0.12, "square", 0.07), 90);
    setTimeout(() => this.tone(880, 0.16, "sine", 0.05), 180);
  }

  click() {
    this.tone(160, 0.04, "square", 0.04);
  }

  whisper() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.45, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const decay = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * decay * 0.32;
    }
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = "bandpass";
    filter.frequency.value = 900 + Math.random() * 600;
    filter.Q.value = 0.7;
    gain.gain.value = 0.08;
    src.buffer = buffer;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
  }

  scare() {
    if (!this.ready) return;
    this.tone(90, 0.32, "sawtooth", 0.12, -200);
    this.tone(124, 0.2, "square", 0.08, 130);
    this.whisper();
  }

  ending(good = false) {
    if (!this.ready) return;
    const notes = good ? [220, 330, 440, 660] : [220, 185, 147, 110];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.28, "sine", 0.05), i * 160));
  }
}
