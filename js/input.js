// Input: keyboard, gamepad and the on-cabinet joystick/buttons all feed the same per-player state.
//   state = { l, r, u, d, lp, hp, blk, lk, hk, sp }   (true while held)
const Input = (() => {
  const BTN = ['lp', 'hp', 'blk', 'lk', 'hk', 'sp'];
  const blank = () => ({ l: false, r: false, u: false, d: false, lp: false, hp: false, blk: false, lk: false, hk: false, sp: false });
  const players = [blank(), blank()];
  const prev = [blank(), blank()];
  const latch = [blank(), blank()];   // taps shorter than one 60Hz tick still register for a tick
  const eff = [blank(), blank()];     // what the game reads: held state OR latched tap
  const src = [{}, {}];          // per source -> state, so keyboard + pointer don't cancel each other
  const listeners = [];          // (player, name, down) visual feedback hooks
  let anyPress = null;           // callback for "any key" on attract screens

  const KEYS = [
    { KeyA: 'l', KeyD: 'r', KeyW: 'u', KeyS: 'd', KeyJ: 'lp', KeyK: 'hp', KeyL: 'blk', KeyU: 'lk', KeyI: 'hk', KeyO: 'sp' },
    { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd',
      Numpad4: 'lp', Numpad5: 'hp', Numpad6: 'blk', Numpad1: 'lk', Numpad2: 'hk', Numpad3: 'sp',
      Comma: 'lk', Period: 'hk', Slash: 'sp', Semicolon: 'lp', Quote: 'hp', Backslash: 'blk' },
  ];

  function set(p, source, name, down) {
    const s = src[p][source] || (src[p][source] = {});
    if (!!s[name] === down) return;
    s[name] = down;
    // combine sources
    let v = false;
    for (const k in src[p]) if (src[p][k][name]) v = true;
    players[p][name] = v;
    if (down) latch[p][name] = true;
    listeners.forEach(fn => fn(p, name, down));
    // pressing a button on the cabinet / a gamepad counts as "any key" on the title + result screens
    if (down && (source === 'ptr' || source === 'pad') && BTN.indexOf(name) >= 0 && anyPress) anyPress(p, name, {});
  }

  function onKey(e, down) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    for (let p = 0; p < 2; p++) {
      const n = KEYS[p][e.code];
      if (n) { set(p, 'kb', n, down); e.preventDefault(); if (down && anyPress && !e.repeat) anyPress(p, n, e); return; }
    }
    if (down && !e.repeat) { if (anyPress) anyPress(-1, e.code, e); }
  }
  addEventListener('keydown', e => onKey(e, true));
  addEventListener('keyup', e => onKey(e, false));
  addEventListener('blur', () => { for (let p = 0; p < 2; p++) { src[p].kb = {}; src[p].ptr = {}; for (const k in players[p]) players[p][k] = false; } });

  // gamepads: pad 0 -> P1, pad 1 -> P2
  const PADMAP = { 2: 'lp', 3: 'hp', 5: 'blk', 0: 'lk', 1: 'hk', 7: 'sp', 4: 'blk', 6: 'sp' };
  function poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let p = 0; p < 2; p++) {
      const g = pads[p];
      if (!g) continue;
      const ax = g.axes[0] || 0, ay = g.axes[1] || 0, b = g.buttons;
      set(p, 'pad', 'l', ax < -0.5 || !!(b[14] && b[14].pressed));
      set(p, 'pad', 'r', ax > 0.5 || !!(b[15] && b[15].pressed));
      set(p, 'pad', 'u', ay < -0.5 || !!(b[12] && b[12].pressed));
      set(p, 'pad', 'd', ay > 0.5 || !!(b[13] && b[13].pressed));
      const want = {};
      for (const i in PADMAP) want[PADMAP[i]] = want[PADMAP[i]] || (b[i] && b[i].pressed);
      BTN.forEach(n => set(p, 'pad', n, !!want[n]));
      if (b[9] && b[9].pressed && anyPress) anyPress(p, 'start', {});
    }
  }

  // call once per simulation tick: polls gamepads and snapshots held-or-tapped state into `eff`
  function frame() {
    poll();
    for (let p = 0; p < 2; p++) {
      for (const k in players[p]) { eff[p][k] = players[p][k] || latch[p][k]; latch[p][k] = false; }
    }
  }

  return {
    players, eff, BTN, set, frame,
    onVisual(fn) { listeners.push(fn); },
    onAnyPress(fn) { anyPress = fn; },
    releaseAll() { for (let p = 0; p < 2; p++) { src[p] = {}; for (const k in players[p]) players[p][k] = latch[p][k] = false; } },
  };
})();
