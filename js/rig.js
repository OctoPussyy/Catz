// Paper-doll rig for the 14-piece characters (see tools/build_char.py). Works in ORIGINAL sprite coordinates
// (1024x1536, y down); the sprite faces +x. Arms and legs are solved with 2-bone IK, the head hangs off the neck pivot.
//   viewer-left limbs = 'l' (rear), viewer-right limbs = 'r' (front).  Pose fields: see poses.js
const Rig = (() => {
  const DEG = Math.PI / 180;
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const PARTS_LIST = ['torso', 'head', 'arm_l_up', 'arm_l_lo', 'hand_l', 'arm_r_up', 'arm_r_lo', 'hand_r',
    'leg_l_th', 'leg_l_sh', 'boot_l', 'leg_r_th', 'leg_r_sh', 'boot_r'];

  const opts = { armUpperOnTop: true, legThighOnTop: true, headOnTop: true };   // which piece covers the joint seam
  const loaded = {};                           // char id -> { def, g, images }

  // rest-pose geometry derived from the joint pivots
  function geometry(def) {
    const J = def.joints, g = { arm: {}, leg: {} };
    for (const s of ['l', 'r']) {
      const a = J['arm_' + s];
      g.arm[s] = { L1: len(a.S, a.E), L2h: len(a.E, a.Hc), r1: ang(a.S, a.E), r2: ang(a.E, a.Hc), wv: [a.W[0] - a.E[0], a.W[1] - a.E[1]] };
      const l = J['leg_' + s];
      g.leg[s] = { L1: len(l.H, l.K), L2: len(l.K, l.A), r1: ang(l.H, l.K), r2: ang(l.K, l.A), drop: J.ground_y - l.bottom };
    }
    return g;
  }

  function load() {
    const ids = Object.keys(window.CHARS || {});
    return Promise.all(ids.map(id => {
      const def = CHARS[id], images = {};
      loaded[id] = { def, g: geometry(def), images };
      return Promise.all(PARTS_LIST.map(n => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => { images[n] = im; res(); };
        im.onerror = () => rej(new Error('failed to load ' + def.parts[n].file));
        im.src = def.parts[n].file;
      })));
    }));
  }

  // ---- hue-tinted variants ---------------------------------------------------------------------------------
  let filterOK = null;
  function canFilter() {
    if (filterOK === null) {
      const c = document.createElement('canvas').getContext('2d');
      c.filter = 'hue-rotate(90deg)';
      filterOK = c.filter === 'hue-rotate(90deg)';
    }
    return filterOK;
  }
  function hueMatrix(deg) {
    const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
    return [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
  }
  function tint(img, hue) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    if (canFilter()) { x.filter = `hue-rotate(${hue}deg)`; x.drawImage(img, 0, 0); return c; }
    x.drawImage(img, 0, 0);
    try {
      const d = x.getImageData(0, 0, c.width, c.height), p = d.data, m = hueMatrix(hue);
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], g = p[i + 1], b = p[i + 2];
        p[i] = Math.max(0, Math.min(255, m[0] * r + m[1] * g + m[2] * b));
        p[i + 1] = Math.max(0, Math.min(255, m[3] * r + m[4] * g + m[5] * b));
        p[i + 2] = Math.max(0, Math.min(255, m[6] * r + m[7] * g + m[8] * b));
      }
      x.putImageData(d, 0, 0);
    } catch (e) { /* tainted canvas (file://): fall back to untinted */ }
    return c;
  }
  const variants = {};
  // sprite set for a character + hue: { id, def, g, imgs }
  function sprites(id, hue) {
    hue = ((hue % 360) + 360) % 360;
    const L = loaded[id];
    if (!L) throw new Error('unknown character ' + id);
    const key = id + ':' + hue;
    if (!variants[key]) {
      const imgs = {};
      for (const n in L.images) imgs[n] = hue === 0 ? L.images[n] : tint(L.images[n], hue);
      variants[key] = { id, def: L.def, g: L.g, imgs };
    }
    return variants[key];
  }

  // ---- IK ------------------------------------------------------------------------------------------------------
  function ik(s, t, l1, l2, bend) {
    const dx = t[0] - s[0], dy = t[1] - s[1];
    const d = Math.hypot(dx, dy) || 0.001;
    const maxD = (l1 + l2) * 0.998, minD = Math.abs(l1 - l2) + 2;
    const dd = Math.max(minD, Math.min(maxD, d));
    const ux = dx / d, uy = dy / d;
    const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    return { e: [s[0] + ux * a + (-uy) * h * bend, s[1] + uy * a + ux * h * bend], end: [s[0] + ux * dd, s[1] + uy * dd] };
  }
  function rot(p, c, a) {
    const co = Math.cos(a), si = Math.sin(a), x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * co - y * si, c[1] + x * si + y * co];
  }

  // ---- skeleton solve ------------------------------------------------------------------------------------------
  function solve(spr, p) {
    const J = spr.def.joints, g = spr.g;
    const hp = J.hip_pivot, off = [p.px || 0, p.py || 0], tr = (p.tr || 0) * DEG;
    const toTorso = pt => { const q = rot(pt, hp, tr); return [q[0] + off[0], q[1] + off[1]]; };
    const sk = { torso: { pivot: [hp[0] + off[0], hp[1] + off[1]], a: tr } };
    sk.head = { pivot: toTorso(J.neck), a: tr + (p.hd || 0) * DEG };
    for (const s of ['l', 'r']) {
      const a = J['arm_' + s], G = g.arm[s];
      const S = toTorso(a.S), T = [S[0] + p['h' + s + 'x'], S[1] + p['h' + s + 'y']];
      const r = ik(S, T, G.L1, G.L2h, +1);
      const a1 = ang(S, r.e) - G.r1, a2 = ang(r.e, r.end) - G.r2;
      const W = rot([r.e[0] + G.wv[0], r.e[1] + G.wv[1]], r.e, a2);
      sk['arm_' + s] = { S, E: r.e, W, a1, a2 };
    }
    for (const s of ['l', 'r']) {
      const l = J['leg_' + s], G = g.leg[s], f = s === 'r' ? 'fr' : 'fl';
      const Hh = [l.H[0] + off[0], l.H[1] + off[1]];
      const T = [J.center_x + p[f + 'x'], l.A[1] + G.drop - p[f + 'y']];
      const r = ik(Hh, T, G.L1, G.L2, -1);
      sk['leg_' + s] = { Hh, K: r.e, A: r.end, a1: ang(Hh, r.e) - G.r1, a2: ang(r.e, r.end) - G.r2, a3: (p[f + 'a'] || 0) * DEG + (ang(r.e, r.end) - G.r2) * 0.3 };   // boot follows the shin a little so the cuff never opens a gap
    }
    return sk;
  }

  // ---- drawing -------------------------------------------------------------------------------------------------
  function part(ctx, spr, name, restPivot, nowPivot, a) {
    const P = spr.def.parts[name];
    ctx.save();
    ctx.translate(nowPivot[0], nowPivot[1]);
    ctx.rotate(a);
    ctx.drawImage(spr.imgs[name], P.ox - restPivot[0], P.oy - restPivot[1], P.w, P.h);
    ctx.restore();
  }

  // Draw a whole fighter. (x, groundY) = screen position of the feet centre. facing = +1 / -1. s = scale.
  function draw(ctx, spr, pose, x, groundY, facing, s) {
    const J = spr.def.joints, sk = solve(spr, pose);
    const hipH = J.ground_y - J.hip_pivot[1];            // falls rotate about the hip
    ctx.save();
    ctx.translate(x + facing * (pose.bx || 0) * s, groundY - (pose.lift || 0) * s);
    ctx.scale(facing, 1);
    ctx.translate(0, -hipH * s);
    ctx.rotate((pose.br || 0) * DEG);
    ctx.translate(0, hipH * s);
    ctx.scale(s, s);
    ctx.translate(-J.center_x, -J.ground_y);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

    for (const side of ['l', 'r']) {                      // legs: rear first; boot -> shin -> thigh
      const k = sk['leg_' + side], d = J['leg_' + side];
      part(ctx, spr, 'boot_' + side, d.A, k.A, k.a3);
      if (opts.legThighOnTop) {
        part(ctx, spr, 'leg_' + side + '_sh', d.K, k.K, k.a2);
        part(ctx, spr, 'leg_' + side + '_th', d.H, k.Hh, k.a1);
      } else {
        part(ctx, spr, 'leg_' + side + '_th', d.H, k.Hh, k.a1);
        part(ctx, spr, 'leg_' + side + '_sh', d.K, k.K, k.a2);
      }
    }
    part(ctx, spr, 'torso', J.hip_pivot, sk.torso.pivot, sk.torso.a);
    part(ctx, spr, 'head', J.neck, sk.head.pivot, sk.head.a);
    for (const side of ['l', 'r']) {                      // arms: rear first; hand -> forearm -> upper arm
      const k = sk['arm_' + side], d = J['arm_' + side];
      part(ctx, spr, 'hand_' + side, d.W, k.W, k.a2);
      if (opts.armUpperOnTop) {
        part(ctx, spr, 'arm_' + side + '_lo', d.E, k.E, k.a2);
        part(ctx, spr, 'arm_' + side + '_up', d.S, k.S, k.a1);
      } else {
        part(ctx, spr, 'arm_' + side + '_up', d.S, k.S, k.a1);
        part(ctx, spr, 'arm_' + side + '_lo', d.E, k.E, k.a2);
      }
    }
    ctx.restore();
    return sk;
  }

  // assembled rest pose at half size (used for select / VS portraits); cached per sprite set
  const rests = new WeakMap();
  function restCanvas(spr) {
    if (rests.has(spr)) return rests.get(spr);
    const R = spr.def.scale, c = document.createElement('canvas');
    c.width = Math.round(1024 * R); c.height = Math.round(1536 * R);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    const order = ['boot_l', 'leg_l_sh', 'leg_l_th', 'boot_r', 'leg_r_sh', 'leg_r_th', 'torso', 'head',
      'arm_l_lo', 'hand_l', 'arm_l_up', 'arm_r_lo', 'hand_r', 'arm_r_up'];
    for (const n of order) { const P = spr.def.parts[n]; x.drawImage(spr.imgs[n], P.ox * R, P.oy * R, P.w * R, P.h * R); }
    rests.set(spr, c);
    return c;
  }

  return { load, sprites, solve, draw, restCanvas, ik, PARTS_LIST, opts };
})();
