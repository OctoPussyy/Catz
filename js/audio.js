// Tiny WebAudio synth: sound effects + a looping chiptune track. No audio files needed.
const Sound = (() => {
  let ctx = null, master = null, musicGain = null, sfxGain = null, noiseBuf = null;
  let muted = false, musicOn = true, musicTimer = null, step = 0, nextT = 0, mode = 'menu';

  function init() {
    if (window.CATZ && window.CATZ.G && window.CATZ.G.soon) return;      // no sound while the game is gated
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
  }

  function tone(freq, dur, type, vol, slideTo, when, dest) {
    if (!ctx) return;
    const t = when || ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, f0, f1, type, when, dest) {
    if (!ctx) return;
    const t = when || ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass';
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxGain);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const sfx = {
    hit(power = 1) { noise(0.12, 0.7 * power, 1800, 300, 'lowpass'); tone(150 * (1.3 - power * 0.3), 0.14, 'square', 0.35 * power, 50); },
    heavy() { noise(0.2, 0.9, 1400, 120, 'lowpass'); tone(110, 0.25, 'sawtooth', 0.5, 35); },
    block() { noise(0.06, 0.45, 3000, 1500, 'highpass'); tone(420, 0.06, 'square', 0.14, 300); },
    whoosh() { noise(0.16, 0.22, 700, 2400, 'bandpass'); },
    whoosh2() { noise(0.24, 0.3, 500, 2800, 'bandpass'); },
    special() { tone(300, 0.35, 'sawtooth', 0.22, 1200); noise(0.35, 0.25, 600, 3000, 'bandpass'); },
    jump() { tone(220, 0.14, 'square', 0.14, 520); },
    land() { noise(0.08, 0.3, 500, 120, 'lowpass'); },
    knockdown() { noise(0.25, 0.7, 900, 80, 'lowpass'); tone(90, 0.3, 'sawtooth', 0.4, 30); },
    ko() { tone(440, 0.9, 'sawtooth', 0.35, 40); noise(0.7, 0.6, 1600, 60, 'lowpass'); },
    blip() { tone(880, 0.05, 'square', 0.16); },
    select() { tone(660, 0.06, 'square', 0.18); tone(990, 0.1, 'square', 0.18, null, ctx && ctx.currentTime + 0.06); },
    coin() { tone(988, 0.07, 'square', 0.2); tone(1319, 0.3, 'square', 0.2, null, ctx && ctx.currentTime + 0.07); },
    round() { tone(330, 0.12, 'square', 0.2); tone(440, 0.12, 'square', 0.2, null, ctx && ctx.currentTime + 0.12); tone(660, 0.3, 'square', 0.22, null, ctx && ctx.currentTime + 0.24); },
    fight() { tone(220, 0.1, 'sawtooth', 0.3); tone(440, 0.4, 'sawtooth', 0.3, 880); noise(0.3, 0.3, 800, 3000, 'bandpass'); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'square', 0.2, null, ctx && ctx.currentTime + i * 0.13)); },
    lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.2, null, ctx && ctx.currentTime + i * 0.2)); },
  };
  function play(name, a) { if (!ctx || muted) return; const f = sfx[name]; if (f) f(a); }

  // ---- music: 16-step loop, A minor, ~128bpm ------------------------------------------------------------------
  const BASS = [45, 0, 45, 0, 45, 0, 48, 0, 43, 0, 43, 0, 43, 0, 47, 0];
  const ARP = [69, 72, 76, 72, 69, 72, 76, 81, 67, 71, 74, 71, 67, 71, 74, 79];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function startMusic() {
    if (musicTimer) return;
    nextT = ctx.currentTime + 0.1; step = 0;
    musicTimer = setInterval(() => {
      if (!ctx) return;
      while (nextT < ctx.currentTime + 0.25) {
        const s = step % 16, spb = 60 / (mode === 'fight' ? 140 : 112) / 4;
        if (musicOn && !muted) {
          if (BASS[s]) tone(mtof(BASS[s]), spb * 1.6, 'sawtooth', mode === 'fight' ? 0.5 : 0.35, null, nextT, musicGain);
          if (mode === 'fight' || s % 2 === 0) tone(mtof(ARP[s]), spb * 0.9, 'square', mode === 'fight' ? 0.16 : 0.1, null, nextT, musicGain);
          if (s % 4 === 0) tone(120, 0.12, 'sine', 0.9, 40, nextT, musicGain);                    // kick
          if (mode === 'fight' && s % 4 === 2) noise(0.06, 0.22, 7000, 7000, 'highpass', nextT, musicGain); // hat
          if (s % 8 === 4) noise(0.12, 0.35, 2000, 1500, 'bandpass', nextT, musicGain);          // snare
        }
        nextT += spb; step++;
      }
    }, 60);
  }

  return {
    init, play,
    setMode(m) { mode = m; },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.8; return muted; },
    isMuted: () => muted,
  };
})();
