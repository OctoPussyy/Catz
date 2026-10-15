// Pose library + move table. Poses are flat numeric objects (see rig.js). Hand offsets are measured from the
// shoulders, ankle targets are x offset from body centre / height above ground, all in original sprite pixels.
const Poses = (() => {
  const BASE = {
    px: 0, py: 50, tr: 5, br: 0, bx: 0, lift: 0, hd: 0,
    hrx: 230, hry: 20, hlx: 270, hly: 40,
    frx: 165, fry: 0, flx: -205, fly: 0, fra: 0, fla: 0,
  };
  const KEYS = Object.keys(BASE);
  const make = o => Object.assign({}, BASE, o || {});
  const lerp = (a, b, u) => {
    const r = {};
    for (const k of KEYS) r[k] = a[k] + (b[k] - a[k]) * u;
    return r;
  };
  const ease = u => u * u * (3 - 2 * u);

  // keyframes: [[t, overrides], ...] -> pose at time t (overrides apply on top of `base`)
  function sample(kf, t, base) {
    const frames = kf.map(([ft, o]) => [ft, Object.assign({}, BASE, base || {}, o)]);
    if (t <= frames[0][0]) return Object.assign({}, frames[0][1]);
    for (let i = 1; i < frames.length; i++) {
      if (t <= frames[i][0]) {
        const [t0, a] = frames[i - 1], [t1, b] = frames[i];
        return lerp(a, b, ease((t - t0) / Math.max(1, t1 - t0)));
      }
    }
    return Object.assign({}, frames[frames.length - 1][1]);
  }

  const CROUCH = { py: 250, tr: 12, frx: 200, flx: -245, hrx: 120, hry: 190, hlx: 250, hly: 215 };
  const BLOCK = { hd: 7, tr: 8, hrx: 80, hry: -175, hlx: 330, hly: -125 };
  const BLOCK_C = Object.assign({}, BLOCK, { py: 250, tr: 14, frx: 200, flx: -245, hry: -60, hly: -10 });

  // ---- moves ------------------------------------------------------------------------------------------------
  // box: x0..x1 forward of the attacker's centre, y0..y1 above the attacker's feet (world px).
  // hs/bs: hit-/block-stun frames. kb: pushback px/frame on hit. kd: knockdown. adv: forward drift px/frame.
  const Moves = {
    LP: { name: 'jab', S: 5, A: 3, R: 9, dmg: 5, hs: 13, bs: 9, kb: 3, height: 'high', box: { x0: 40, x1: 220, y0: 255, y1: 385 },
      sfx: 'whoosh', kf: [[0, {}], [2, { hrx: 70, hry: 135, tr: 2 }], [5, { hrx: 525, hry: 15, tr: 15, px: 22 }], [8, { hrx: 525, hry: 15, tr: 15, px: 22 }], [17, {}]] },
    HP: { name: 'cross', S: 10, A: 4, R: 16, dmg: 11, hs: 20, bs: 13, kb: 6, height: 'mid', box: { x0: 40, x1: 245, y0: 190, y1: 350 }, adv: 1.6,
      sfx: 'whoosh', kf: [[0, {}], [6, { tr: -16, px: -25, hlx: 90, hly: 190, hrx: 150, hry: 110 }],
        [10, { tr: 26, px: 48, hlx: 545, hly: 10, hrx: 150, hry: 110, flx: -170, frx: 205 }], [14, { tr: 26, px: 48, hlx: 545, hly: 10, hrx: 150, hry: 110, flx: -170, frx: 205 }], [30, {}]] },
    LK: { name: 'front kick', S: 8, A: 4, R: 14, dmg: 7, hs: 17, bs: 11, kb: 5, height: 'mid', box: { x0: 50, x1: 250, y0: 110, y1: 250 },
      sfx: 'whoosh', kf: [[0, {}], [4, { fry: 160, frx: 235, tr: -6, py: 55, fra: 25 }], [8, { frx: 610, fry: 470, fra: -50, tr: -14, py: 45, hry: 180 }],
        [12, { frx: 610, fry: 470, fra: -50, tr: -14, py: 45, hry: 180 }], [26, {}]] },
    HK: { name: 'high kick', S: 14, A: 5, R: 22, dmg: 14, hs: 26, bs: 15, kb: 7, kd: true, height: 'high', box: { x0: 50, x1: 270, y0: 250, y1: 410 },
      sfx: 'whoosh2', kf: [[0, {}], [8, { fly: 200, flx: -60, tr: -10, py: 60, fla: 15 }],
        [14, { flx: 480, fly: 900, fla: -25, tr: -32, py: 35, br: -5, hry: 200 }], [19, { flx: 480, fly: 900, fla: -25, tr: -32, py: 35, br: -5, hry: 200 }], [41, {}]] },
    SP: { name: 'claw wave', S: 18, A: 1, R: 22, dmg: 0, special: true,
      sfx: 'special', kf: [[0, {}], [10, { hrx: -20, hry: 150, hlx: 120, hly: 150, tr: -18, px: -30 }],
        [18, { hrx: 490, hry: 30, hlx: 440, hly: 60, tr: 20, px: 35 }], [28, { hrx: 490, hry: 30, hlx: 440, hly: 60, tr: 20, px: 35 }], [41, {}]] },
    // crouching
    cLP: { name: 'low jab', S: 6, A: 3, R: 10, dmg: 5, hs: 13, bs: 9, kb: 3, height: 'mid', crouch: true, box: { x0: 40, x1: 225, y0: 80, y1: 190 },
      sfx: 'whoosh', kf: [[0, CROUCH], [3, Object.assign({}, CROUCH, { hrx: 60, hry: 170 })], [6, Object.assign({}, CROUCH, { hrx: 520, hry: 125, tr: 20 })],
        [9, Object.assign({}, CROUCH, { hrx: 520, hry: 125, tr: 20 })], [19, CROUCH]], base: CROUCH },
    cLK: { name: 'sweep', S: 10, A: 4, R: 20, dmg: 8, hs: 18, bs: 13, kb: 3, kd: true, height: 'low', crouch: true, box: { x0: 40, x1: 270, y0: 0, y1: 75 },
      sfx: 'whoosh2', kf: [[0, CROUCH], [5, Object.assign({}, CROUCH, { fry: 30, frx: 330, tr: -18, br: 0 })], [10, Object.assign({}, CROUCH, { frx: 735, fry: 25, fra: -8, tr: -24, py: 270, hry: 210 })],
        [14, Object.assign({}, CROUCH, { frx: 735, fry: 25, fra: -8, tr: -24, py: 270, hry: 210 })], [34, CROUCH]], base: CROUCH },
    // jumping
    jK: { name: 'jump kick', S: 4, A: 14, R: 6, dmg: 8, hs: 18, bs: 12, kb: 4, height: 'mid', air: true, box: { x0: 20, x1: 215, y0: -40, y1: 120 },
      sfx: 'whoosh', kf: [[0, { fry: 120, fly: 60 }], [4, { frx: 520, fry: 150, fra: -55, tr: 18, py: 20, fly: 120, flx: -150 }], [24, { frx: 520, fry: 150, fra: -55, tr: 18, py: 20, fly: 120, flx: -150 }]] },
  };
  for (const k in Moves) { const m = Moves[k]; m.total = m.S + m.A + m.R; m.key = k; }

  // ---- other poses ------------------------------------------------------------------------------------------
  const poses = {
    stand: make(),
    crouch: make(CROUCH),
    blockS: make(BLOCK),
    blockC: make(BLOCK_C),
    hitHigh: make({ hd: -16, tr: -18, px: -30, py: 45, hrx: 30, hry: 250, hlx: 120, hly: 260, fra: 0 }),
    hitLow: make({ hd: 14, tr: 20, px: 10, py: 120, hrx: 60, hry: 200, hlx: 150, hly: 240 }),
    jumpUp: make({ py: 15, tr: 4, fry: 170, fly: 110, frx: 190, flx: -150, hry: 90, hly: 120 }),
    jumpDown: make({ py: 10, tr: 2, fry: 90, fly: 50, frx: 170, flx: -190, hry: 140, hly: 160 }),
    win: make({ py: 20, tr: 0, hrx: 175, hry: -330, hlx: 280, hly: 135, frx: 175, flx: -200 }),
    lose: make({ py: 60, tr: 22, hrx: 20, hry: 300, hlx: 120, hly: 300 }),
    taunt: make({ py: 30, tr: -6, hrx: 140, hry: -220, hlx: 360, hly: -150 }),
  };

  // walking cycle: dir = +1 forward, -1 backward; ph = phase radians
  function walk(ph, dir) {
    const p = make({ py: 55, tr: 5 + dir * 2 });
    const a = Math.sin(ph) * 105, b = Math.sin(ph + Math.PI) * 105;
    const la = Math.max(0, Math.cos(ph)) * 85, lb = Math.max(0, Math.cos(ph + Math.PI)) * 85;
    p.frx = 170 + a * dir; p.fry = la;
    p.flx = -200 + b * dir; p.fly = lb;
    p.fra = -la * 0.18; p.fla = -lb * 0.18;
    p.hry += Math.sin(ph * 2) * 9; p.hly += Math.sin(ph * 2 + 1) * 9;
    p.py += Math.abs(Math.cos(ph)) * -14;
    return p;
  }
  function idle(t) {
    const p = make();
    const b = Math.sin(t * 0.085);
    p.py += b * 6; p.tr += b * 1.2;
    p.hry += Math.sin(t * 0.085 + 0.6) * 8; p.hly += Math.sin(t * 0.085 + 1.2) * 8;
    p.hrx += Math.sin(t * 0.04) * 6;
    return p;
  }

  // knockdown/getup: u 0..1 over the fall. Rotates about the hip; lift drops the hip to the floor.
  function fall(u) {
    const e = ease(Math.min(1, u));
    const p = make({ hd: -14 * e, tr: -10 * (1 - e), py: 40, hrx: 40, hry: 260, hlx: 150, hly: 280 });
    p.br = -90 * e;
    p.lift = -480 * e;
    p.hrx = 40 + 80 * e; p.hry = 260 - 60 * e; p.hlx = 150 - 90 * e; p.hly = 280;
    p.frx = 165 + 60 * e; p.fry = 20 * e; p.flx = -205 + 100 * e; p.fly = 70 * e;
    return p;
  }

  return { BASE, make, lerp, ease, sample, Moves, poses, walk, idle, fall, CROUCH };
})();
