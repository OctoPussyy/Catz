// The machine itself: clickable joysticks / buttons / coin slots (positions measured from assets/cabinet.png),
// plus view zoom, mute, fullscreen and the help panel.
(() => {
  const CAB_W = 1086, CAB_H = 1448;
  const cab = document.getElementById('cab');

  // ---- hotspots ------------------------------------------------------------------------------------------------
  const BTN_NAMES = ['lp', 'hp', 'blk', 'lk', 'hk', 'sp'];
  const TIPS = { lp: 'Punch', hp: 'Heavy punch', blk: 'Block', lk: 'Kick', hk: 'Heavy kick', sp: 'Special' };
  const LAYOUT = [
    { // player 1 (red)
      stick: [222, 852, 64],
      btns: [[320, 864], [376, 860], [432, 860], [307, 897], [366, 893], [423, 892]],
    },
    { // player 2 (blue)
      stick: [697, 852, 64],
      btns: [[793, 864], [848, 860], [903, 860], [794, 897], [851, 893], [908, 892]],
    },
  ];
  const els = [{}, {}];

  function hot(cls, cx, cy, r, title) {
    const d = document.createElement('div');
    d.className = 'hot ' + cls;
    d.style.cssText = `left:${cx - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px`;
    if (title) d.title = title;
    cab.appendChild(d);
    return d;
  }

  LAYOUT.forEach((L, p) => {
    // buttons
    L.btns.forEach(([cx, cy], i) => {
      const n = BTN_NAMES[i], d = hot('btn', cx, cy, 27, TIPS[n]);
      els[p][n] = d;
      d.addEventListener('pointerdown', e => { e.preventDefault(); d.setPointerCapture(e.pointerId); Sound.init(); Input.set(p, 'ptr', n, true); });
      const up = e => { Input.set(p, 'ptr', n, false); };
      d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up); d.addEventListener('lostpointercapture', up);
    });
    // joystick
    const [sx, sy, sr] = L.stick, st = hot('stick', sx, sy, sr, 'Joystick');
    const dot = document.createElement('div'); dot.className = 'dot'; st.appendChild(dot);
    els[p].stick = st; els[p].dot = dot;
    let active = false;
    const upd = e => {
      const rc = st.getBoundingClientRect(), cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      const dx = (e.clientX - cx) / (rc.width / 2), dy = (e.clientY - cy) / (rc.height / 2);
      const T = 0.3;
      Input.set(p, 'ptr', 'l', dx < -T); Input.set(p, 'ptr', 'r', dx > T);
      Input.set(p, 'ptr', 'u', dy < -T); Input.set(p, 'ptr', 'd', dy > T);
    };
    st.addEventListener('pointerdown', e => { e.preventDefault(); active = true; st.setPointerCapture(e.pointerId); Sound.init(); upd(e); });
    st.addEventListener('pointermove', e => { if (active) upd(e); });
    const rel = () => { active = false; ['l', 'r', 'u', 'd'].forEach(k => Input.set(p, 'ptr', k, false)); };
    st.addEventListener('pointerup', rel); st.addEventListener('pointercancel', rel); st.addEventListener('lostpointercapture', rel);
  });

  // keyboard / gamepad / touch all light up the hardware
  Input.onVisual((p, name, down) => {
    const e = els[p];
    if (!e) return;
    if (e[name]) e[name].classList.toggle('on', Input.players[p][name]);
    if (name === 'l' || name === 'r' || name === 'u' || name === 'd') {
      const s = Input.players[p], dx = (s.r ? 1 : 0) - (s.l ? 1 : 0), dy = (s.d ? 1 : 0) - (s.u ? 1 : 0);
      e.dot.style.transform = `translate(${dx * 20}px, ${dy * 20}px)`;
      e.stick.classList.toggle('on', !!(dx || dy));
    }
  });

  // coin slots: start 1P / 2P
  [[476, 1122, 'one'], [580, 1122, 'two']].forEach(([cx, cy, w]) => {
    const d = hot('coin', cx - 6, cy, 36, w === 'one' ? 'Insert coin - 1 player' : 'Insert coin - 2 players');
    d.style.borderRadius = '10px';
    d.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (window.CATZ && CATZ.G.soon) return;                 // gated: coin slots do nothing
      Sound.init(); Sound.play('coin');
      d.classList.add('on'); setTimeout(() => d.classList.remove('on'), 220);
      if (window.CATZ && CATZ.G.screen === 'attract') (w === 'one' ? CATZ.startOne : CATZ.startTwo)();
      else if (window.CATZ) CATZ.screenTap();
    });
  });

  // tapping the screen starts the game / continues
  document.getElementById('scr').addEventListener('pointerdown', e => { Sound.init(); if (window.CATZ) CATZ.screenTap(); });

  // ---- screen: warp the 960x988 canvas onto the keystoned glass (corners measured from the cabinet image) -------
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {                      // gaussian elimination with partial pivoting
      let m = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
      [A[c], A[m]] = [A[m], A[c]]; [b[c], b[m]] = [b[m], b[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let sum = b[r];
      for (let k = r + 1; k < n; k++) sum -= A[r][k] * h[k];
      h[r] = sum / A[r][r];
    }
    return h;
  }
  const SCREEN_QUAD = [[312, 301], [768, 301], [817, 793], [268, 793]];   // TL TR BR BL on the cabinet image
  (function () {
    const h = homography([[0, 0], [960, 0], [960, 988], [0, 988]], SCREEN_QUAD);
    document.getElementById('scr').style.transform =
      `matrix3d(${h[0]},${h[3]},0,${h[6]}, ${h[1]},${h[4]},0,${h[7]}, 0,0,1,0, ${h[2]},${h[5]},0,1)`;
  })();

  // ---- view modes ------------------------------------------------------------------------------------------------
  const RECTS = [[0, 0, CAB_W, CAB_H], [120, 280, 850, 690], [256, 290, 576, 516]];
  const coarse = matchMedia('(pointer: coarse)').matches;
  let mode = coarse ? 1 : 0;
  function applyView(animate) {
    const [rx, ry, rw, rh] = RECTS[mode], vw = innerWidth, vh = innerHeight;
    const s = Math.min(vw / rw, vh / rh) * (mode === 0 ? 0.985 : 0.97);
    const tx = (vw - rw * s) / 2 - rx * s, ty = (vh - rh * s) / 2 - ry * s;
    if (animate) { cab.classList.add('anim'); clearTimeout(applyView.t); applyView.t = setTimeout(() => cab.classList.remove('anim'), 700); }
    cab.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }
  addEventListener('resize', () => applyView(false));
  applyView(false);
  let userView = false;
  const cycle = () => { userView = true; mode = (mode + 1) % RECTS.length; applyView(true); };
  // camera: whole machine on the title screen, glide in to screen + controls once a game starts
  document.addEventListener('catz-screen', e => {
    const sc = e.detail, inGame = !(sc === 'attract' || sc === 'boot' || sc === 'soon');
    if (!userView) { mode = inGame ? 1 : (coarse ? 1 : 0); applyView(true); }
    document.getElementById('help').classList.toggle('away', sc === 'fight' || sc === 'vs' || sc === 'soon');
  });

  // ---- toolbar -----------------------------------------------------------------------------------------------------
  const help = document.getElementById('help');
  try { if (localStorage.getItem('catz-help') === 'hide') help.classList.add('hide'); } catch (e) { /* ignore */ }
  const toggleHelp = () => {
    help.classList.toggle('hide');
    try { localStorage.setItem('catz-help', help.classList.contains('hide') ? 'hide' : 'show'); } catch (e) { /* ignore */ }
  };
  const mute = () => { Sound.init(); const m = Sound.toggleMute(); document.getElementById('bMute').style.opacity = m ? 0.5 : 1; };
  const full = () => {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement) d.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };
  document.getElementById('bZoom').onclick = cycle;
  document.getElementById('bMute').onclick = mute;
  document.getElementById('bFull').onclick = full;
  document.getElementById('bHelp').onclick = toggleHelp;
  document.getElementById('hx').onclick = toggleHelp;
  addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyZ') cycle(); else if (e.code === 'KeyM') mute(); else if (e.code === 'KeyF') full(); else if (e.code === 'KeyH') toggleHelp();
  });
  document.addEventListener('contextmenu', e => e.preventDefault());
})();
