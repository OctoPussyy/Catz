// Procedural neon stages (cached to offscreen canvases) + the neon panther emblem.
const Stage = (() => {
  const W = 960, H = 988, HORIZON = 700;

  // deterministic rng so a stage always looks the same
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  const DEFS = [
    { name: 'NEON ALLEY', sky: ['#12002b', '#43095e', '#c91f6a', '#ff8a3d'], sun: ['#ffe14a', '#ff3d9a'], grid: '#ff39e6', far: '#2a0a4d', near: '#12031f', win: ['#00e5ff', '#ff2bd6', '#ffe14a'], floor: ['#220640', '#0a0212'] },
    { name: 'CYAN DOCKS', sky: ['#02101c', '#073553', '#0f8a95', '#7ff3d6'], sun: ['#eaffff', '#2de2e6'], grid: '#2de2e6', far: '#06304a', near: '#02121f', win: ['#7ff3d6', '#2d9bff', '#ffffff'], floor: ['#06304a', '#010a12'] },
    { name: 'EMBER ROOF', sky: ['#1a0600', '#5b1708', '#d4421a', '#ffb347'], sun: ['#fff3b0', '#ff5a1f'], grid: '#ff7a1a', far: '#3a1006', near: '#170502', win: ['#ffd24a', '#ff4d2d', '#fff3b0'], floor: ['#3a0f05', '#0d0301'] },
  ];

  // The panther head emblem (matches the cabinet's neon logo) as vector paths in a 100x100 box.
  function panther(ctx, cx, cy, size, color, glow, lw) {
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / 100, size / 100);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = lw || 3.2;
    ctx.shadowColor = glow || color; ctx.shadowBlur = size * 0.22;
    const p = new Path2D();
    p.moveTo(14, 6); p.lineTo(34, 28); p.quadraticCurveTo(50, 22, 66, 28); p.lineTo(86, 6); p.lineTo(90, 40);
    p.quadraticCurveTo(94, 66, 74, 84); p.quadraticCurveTo(62, 96, 50, 96); p.quadraticCurveTo(38, 96, 26, 84);
    p.quadraticCurveTo(6, 66, 10, 40); p.closePath();
    // eyes, nose, mouth, brow stripes, whiskers
    p.moveTo(21, 49); p.lineTo(43, 54); p.lineTo(40, 61); p.lineTo(24, 57); p.closePath();
    p.moveTo(79, 49); p.lineTo(57, 54); p.lineTo(60, 61); p.lineTo(76, 57); p.closePath();
    p.moveTo(43, 71); p.lineTo(57, 71); p.lineTo(50, 80); p.closePath();
    p.moveTo(50, 80); p.lineTo(50, 86); p.moveTo(50, 86); p.quadraticCurveTo(42, 93, 34, 88); p.moveTo(50, 86); p.quadraticCurveTo(58, 93, 66, 88);
    p.moveTo(50, 30); p.lineTo(50, 44); p.moveTo(39, 32); p.lineTo(42, 43); p.moveTo(61, 32); p.lineTo(58, 43);
    p.moveTo(34, 79); p.lineTo(6, 74); p.moveTo(34, 83); p.lineTo(8, 88); p.moveTo(66, 79); p.lineTo(94, 74); p.moveTo(66, 83); p.lineTo(92, 88);
    ctx.stroke(p);
    ctx.stroke(p);   // second pass for a hotter neon core
    ctx.restore();
  }

  function build(def, seed) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), r = rng(seed);
    // sky
    let g = x.createLinearGradient(0, 0, 0, HORIZON);
    g.addColorStop(0, def.sky[0]); g.addColorStop(0.5, def.sky[1]); g.addColorStop(0.85, def.sky[2]); g.addColorStop(1, def.sky[3]);
    x.fillStyle = g; x.fillRect(0, 0, W, HORIZON + 2);
    // stars
    for (let i = 0; i < 90; i++) {
      x.globalAlpha = 0.3 + r() * 0.7; x.fillStyle = '#fff';
      const s = r() < 0.12 ? 3 : 2; x.fillRect(r() * W, r() * 380, s, s);
    }
    x.globalAlpha = 1;
    // retro sun with scan slits
    const sx = 480, sy = 430, sr = 210;
    g = x.createLinearGradient(0, sy - sr, 0, sy + sr);
    g.addColorStop(0, def.sun[0]); g.addColorStop(1, def.sun[1]);
    x.save(); x.shadowColor = def.sun[1]; x.shadowBlur = 80;
    x.fillStyle = g; x.beginPath(); x.arc(sx, sy, sr, 0, Math.PI * 2); x.fill(); x.restore();
    x.save(); x.beginPath(); x.arc(sx, sy, sr + 2, 0, Math.PI * 2); x.clip();
    x.fillStyle = def.sky[2];
    for (let i = 0; i < 9; i++) { const yy = sy + 20 + i * 22, hh = 3 + i * 1.7; x.globalAlpha = 0.95; x.fillRect(sx - sr, yy, sr * 2, hh); }
    x.restore(); x.globalAlpha = 1;
    // giant neon panther behind the sun
    panther(x, sx, sy - 5, 250, def.grid + '40', def.grid, 1.6);
    // far skyline
    function skyline(base, color, hMin, hMax, wMin, wMax, lit) {
      let px = -20;
      while (px < W + 20) {
        const w = wMin + r() * (wMax - wMin), h = hMin + r() * (hMax - hMin);
        x.fillStyle = color; x.fillRect(px, base - h, w, h + 4);
        if (r() < 0.25) x.fillRect(px + w * 0.4, base - h - 28, 5, 28);          // antenna
        if (lit) for (let wy = base - h + 12; wy < base - 8; wy += 17) for (let wx = px + 7; wx < px + w - 8; wx += 14) {
          if (r() < 0.2) { x.fillStyle = def.win[(r() * 3) | 0]; x.globalAlpha = 0.35 + r() * 0.5; x.fillRect(wx, wy, 6, 8); x.globalAlpha = 1; }
        }
        px += w + (r() < 0.3 ? 8 + r() * 14 : 0);
      }
    }
    skyline(HORIZON, def.far, 90, 300, 40, 90, true);
    // glow band at horizon
    g = x.createLinearGradient(0, HORIZON - 70, 0, HORIZON + 4);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, def.grid + '88');
    x.fillStyle = g; x.fillRect(0, HORIZON - 70, W, 74);
    skyline(HORIZON + 10, def.near, 60, 210, 46, 110, true);
    // neon signs on the near skyline
    panther(x, 150, 520, 130, '#d6ff2a', '#c8ff00', 3.4);
    panther(x, 820, 560, 96, '#d6ff2a', '#c8ff00', 3.4);
    x.save(); x.font = '900 44px Impact, "Arial Black", sans-serif'; x.textAlign = 'center';
    x.shadowColor = def.grid; x.shadowBlur = 22; x.fillStyle = '#fff'; x.fillText('CATZ', 480, 598);
    x.lineWidth = 2; x.strokeStyle = def.grid; x.strokeText('CATZ', 480, 598); x.restore();
    // floor
    g = x.createLinearGradient(0, HORIZON, 0, H);
    g.addColorStop(0, def.floor[0]); g.addColorStop(1, def.floor[1]);
    x.fillStyle = g; x.fillRect(0, HORIZON, W, H - HORIZON);
    // horizon line
    bakeGrid(x, def);
    x.fillStyle = def.grid; x.globalAlpha = 0.9; x.fillRect(0, HORIZON - 1, W, 3); x.globalAlpha = 1;
    return c;
  }

  const cache = {};
  function get(i) {
    i = i % DEFS.length;
    if (!cache[i]) cache[i] = build(DEFS[i], 1234 + i * 77);
    return cache[i];
  }

  // floor grid: the fan of vertical lines is baked into the cached backdrop; only the receding horizontals animate
  function bakeGrid(x, def) {
    x.save(); x.beginPath(); x.rect(0, HORIZON, W, H - HORIZON); x.clip();
    x.strokeStyle = def.grid; x.lineWidth = 2; x.shadowColor = def.grid; x.shadowBlur = 8; x.globalAlpha = 0.55;
    for (let k = -16; k <= 16; k++) { x.beginPath(); x.moveTo(W / 2 + k * 18, HORIZON); x.lineTo(W / 2 + k * 190, H + 40); x.stroke(); }
    x.restore();
  }
  function drawGrid(ctx, i, t) {
    const def = DEFS[i % DEFS.length], off = (t * 0.012) % 1;
    ctx.save();
    ctx.strokeStyle = def.grid;
    for (let k = 0; k < 12; k++) {
      const u = (k + off) / 12, y = HORIZON + (H - HORIZON) * u * u, a = 0.15 + 0.5 * u;
      ctx.globalAlpha = a * 0.35; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();   // cheap glow
      ctx.globalAlpha = a; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  return { W, H, HORIZON, DEFS, get, drawGrid, panther };
})();
