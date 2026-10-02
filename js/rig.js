// Paper-doll rig: draws a fighter from the sliced parts, solving elbows/knees with 2-bone IK.
// Everything here works in ORIGINAL sprite coordinates (1024x1536, y down). The sprite faces +x.
const Rig = (() => {
  const J = PARTS.joints;
  const R0 = PARTS.scale;                       // stored parts are R0 x original size
  const DEG = Math.PI / 180;
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

  // bone lengths (from the rest skeleton)
  const L = {
    arm_r: [len(J.arm_r.S, J.arm_r.E), len(J.arm_r.E, J.arm_r.H)],
    arm_l: [len(J.arm_l.S, J.arm_l.E), len(J.arm_l.E, J.arm_l.H)],
    leg_b: [len(J.leg_b.Hp, J.leg_b.K), len(J.leg_b.K, J.leg_b.A)],
    leg_a: [len(J.leg_a.Hp, J.leg_a.K), len(J.leg_a.K, J.leg_a.A)],
  };
  // rest bone angles
  const REST = {
    arm_r: [ang(J.arm_r.S, J.arm_r.E), ang(J.arm_r.E, J.arm_r.H)],
    arm_l: [ang(J.arm_l.S, J.arm_l.E), ang(J.arm_l.E, J.arm_l.H)],
    leg_b: [ang(J.leg_b.Hp, J.leg_b.K), ang(J.leg_b.K, J.leg_b.A)],
    leg_a: [ang(J.leg_a.Hp, J.leg_a.K), ang(J.leg_a.K, J.leg_a.A)],
  };

  // ---- image loading ------------------------------------------------------------------------------------
  const images = {};
  function load() {
    return Promise.all(Object.entries(PARTS.parts).map(([name, p]) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => { images[name] = im; res(); };
      im.onerror = () => rej(new Error('failed to load ' + p.file));
      im.src = p.file;
    })));
  }

  // ---- hue-tinted variants -------------------------------------------------------------------------------
  const variants = { 0: null };
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
    if (canFilter()) {
      x.filter = `hue-rotate(${hue}deg)`;
      x.drawImage(img, 0, 0);
      return c;
    }
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
    } catch (e) { /* tainted canvas (file://) - fall back to untinted */ }
    return c;
  }
  function sprites(hue) {
    hue = ((hue % 360) + 360) % 360;
    if (hue === 0) return images;
    if (!variants[hue]) {
      const v = {};
      for (const n in images) v[n] = tint(images[n], hue);
      variants[hue] = v;
    }
    return variants[hue];
  }

  // ---- IK ------------------------------------------------------------------------------------------------
  // returns elbow/knee position and the actual end point (clamped to reach). bend = +1 / -1 picks the side.
  function ik(s, t, l1, l2, bend) {
    let dx = t[0] - s[0], dy = t[1] - s[1];
    let d = Math.hypot(dx, dy) || 0.001;
    const maxD = (l1 + l2) * 0.998, minD = Math.abs(l1 - l2) + 2;
    const dd = Math.max(minD, Math.min(maxD, d));
    const ux = dx / d, uy = dy / d;
    const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ex = s[0] + ux * a + (-uy) * h * bend;
    const ey = s[1] + uy * a + (ux) * h * bend;
    return { e: [ex, ey], end: [s[0] + ux * dd, s[1] + uy * dd] };
  }

  function rot(p, c, a) {
    const co = Math.cos(a), si = Math.sin(a), x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * co - y * si, c[1] + x * si + y * co];
  }

  // ---- skeleton solve -------------------------------------------------------------------------------------
  // pose fields (see game.js): py,px,tr (torso rot deg), hrx,hry,hlx,hly (hand offsets from shoulders),
  // frx,fry,flx,fly (ankle x offset from centre / height above ground), fra,fla (foot angle deg)
  function solve(p) {
    const hp = J.hip_pivot;
    const off = [p.px || 0, p.py || 0];
    const tr = (p.tr || 0) * DEG;
    const hip0 = [hp[0] + off[0], hp[1] + off[1]];
    const toTorso = pt => { const q = rot(pt, hp, tr); return [q[0] + off[0], q[1] + off[1]]; };

    const sk = { torso: { pivot: hip0, a: tr } };
    // arms
    for (const side of ['r', 'l']) {
      const key = 'arm_' + side, d = J[key];
      const S = toTorso(d.S);
      const T = [S[0] + p['h' + side + 'x'], S[1] + p['h' + side + 'y']];
      const r = ik(S, T, L[key][0], L[key][1], +1);
      sk[key] = { S, E: r.e, H: r.end,
        a1: ang(S, r.e) - REST[key][0], a2: ang(r.e, r.end) - REST[key][1] };
    }
    // legs
    for (const side of ['b', 'a']) {
      const key = 'leg_' + side, d = J[key];
      const Hh = [d.Hp[0] + off[0], d.Hp[1] + off[1]];
      const ax = J.center_x + p[(side === 'b' ? 'fr' : 'fl') + 'x'];
      const ay = d.A[1] - p[(side === 'b' ? 'fr' : 'fl') + 'y'];
      const r = ik(Hh, [ax, ay], L[key][0], L[key][1], -1);
      sk[key] = { Hh, K: r.e, A: r.end,
        a1: ang(Hh, r.e) - REST[key][0], a2: ang(r.e, r.end) - REST[key][1],
        a3: (p[side === 'b' ? 'fra' : 'fla'] || 0) * DEG };
    }
    return sk;
  }

  // ---- drawing --------------------------------------------------------------------------------------------
  function drawPart(ctx, spr, name, pivotRest, pivotNow, a) {
    const p = PARTS.parts[name], im = spr[name];
    ctx.save();
    ctx.translate(pivotNow[0], pivotNow[1]);
    ctx.rotate(a);
    ctx.drawImage(im, p.ox - pivotRest[0], p.oy - pivotRest[1], p.w, p.h);
    ctx.restore();
  }

  // Draw a whole fighter. (x, groundY) = screen position of the feet centre. facing = +1 / -1. s = scale.
  function draw(ctx, spr, pose, x, groundY, facing, s) {
    const sk = solve(pose);
    const hipH = J.ground_y - J.hip_pivot[1];     // body rotation (falls) pivots about the hip
    ctx.save();
    ctx.translate(x + facing * (pose.bx || 0) * s, groundY - (pose.lift || 0) * s);
    ctx.scale(facing, 1);
    ctx.translate(0, -hipH * s);
    ctx.rotate((pose.br || 0) * DEG);
    ctx.translate(0, hipH * s);
    ctx.scale(s, s);
    ctx.translate(-J.center_x, -J.ground_y);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

    // legs: rear leg first, each foot -> shin -> thigh (upper pieces cover the joint seams)
    for (const key of ['leg_a', 'leg_b']) {
      const k = sk[key], d = J[key];
      drawPart(ctx, spr, key + '_ft', d.A, k.A, k.a3);
      drawPart(ctx, spr, key + '_sh', d.K, k.K, k.a2);
      drawPart(ctx, spr, key + '_th', d.Hp, k.Hh, k.a1);
    }
    // torso + head
    drawPart(ctx, spr, 'torso', J.hip_pivot, sk.torso.pivot, sk.torso.a);
    // arms: rear arm first
    for (const key of ['arm_l', 'arm_r']) {
      const k = sk[key], d = J[key];
      drawPart(ctx, spr, key + '_lo', d.E, k.E, k.a2);
      drawPart(ctx, spr, key + '_up', d.S, k.S, k.a1);
    }
    ctx.restore();
    return sk;
  }

  // screen position of a rig point (used for hit sparks / projectiles). pt is in sprite coords.
  function toScreen(pt, x, groundY, facing, s, pose) {
    const bx = (pt[0] - J.center_x) * s, by = (pt[1] - J.ground_y) * s;
    return [x + facing * bx, groundY + by];
  }

  return { load, sprites, solve, draw, toScreen, images, J, ik, L };
})();
