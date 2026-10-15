// CATZ FIGHT - game logic + rendering. Fixed 60Hz simulation, canvas 960x988 shown inside the cabinet's CRT.
(() => {
  'use strict';
  const W = 960, H = 988, GROUND = 915, SC = 0.35;
  const K = SC / 0.30;                           // gameplay numbers below were tuned at 0.30, scale them with the art
  const WALL_L = 90, WALL_R = W - 90;
  const BODY_HALF = 54 * K, PUSH = 66 * K, GRAV = 0.9;
  const SPEED_F = 3.9 * K, SPEED_B = 3.0 * K;
  const HURT_H = 440 * K, HURT_C = 250 * K;
  const FONT_PIX = '"Press Start 2P", "Courier New", monospace';
  const FONT_TITLE = '"Bungee", Impact, "Arial Black", sans-serif';
  const ATK = ['lp', 'hp', 'lk', 'hk', 'sp'];
  const MV = Poses.Moves;
  for (const k in MV) { const m = MV[k]; if (m.box) for (const q in m.box) m.box[q] *= K; if (m.adv) m.adv *= K; }

  // Placeholder roster: every fighter shares the one sprite set, tinted. Swap names/sprites later.
  const ROSTER = [
    { name: 'CRIMSON', char: 'prison', hue: 0 }, { name: 'EMBER', char: 'prison', hue: 50 }, { name: 'VIPER', char: 'prison', hue: 120 },
    { name: 'FROST', char: 'prison', hue: 190 }, { name: 'ORCHID', char: 'prison', hue: 250 }, { name: 'HEX', char: 'prison', hue: 300 },
    { name: 'NEON', char: 'prison', hue: 330 },
  ];

  const cv = document.getElementById('screen');
  const ctx = cv.getContext('2d');
  const blankCtl = () => ({ l: false, r: false, u: false, d: false, lp: false, hp: false, blk: false, lk: false, hk: false, sp: false });
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // CPU difficulty. skill: base AI sharpness; react/punish/cool: how often it blocks, punishes, how fast it decides;
  // dealt/taken: damage multipliers for the human player; mercy: how strongly the comeback balancing applies; mult: score multiplier
  const DIFFS = [
    { name: 'EASY',   skill: 0.12, react: 0.55, punish: 0.35, cool: 1.6,  dealt: 1.25, taken: 0.7,  mercy: 1.3,  mult: 0.5,  col: '#7dff9a' },
    { name: 'NORMAL', skill: 0.35, react: 1,    punish: 1,    cool: 1,    dealt: 1,    taken: 1,    mercy: 1,    mult: 1,    col: '#ffe14a' },
    { name: 'HARD',   skill: 0.6,  react: 1.15, punish: 1.35, cool: 0.75, dealt: 0.9,  taken: 1.15, mercy: 0.35, mult: 1.75, col: '#ff5a5a' },
  ];
  const diffNow = () => DIFFS[G.diff] || DIFFS[1];
  const CFG = window.CATZ_CONFIG || {};
  const DEV = new URLSearchParams(location.search).get('dev') === '1';
  const SOON = !!CFG.comingSoon && !DEV;        // gated: show the COMING SOON screen, game cannot start

  const G = {
    _screen: 'boot', diff: 1, soon: SOON, frame: 0, mode: 1, ladder: 1, fight: null, projs: [], fx: [], shake: 0, hitstop: 0,
    banner: null, sel: [{ i: 0, locked: false }, { i: 3, locked: false }], selT: 0, stageIdx: 0, vsT: 0, resT: 0,
    paused: false, debug: false, slow: false, acc: 0, combo: [null, null], menuPrev: [blankCtl(), blankCtl()],
  };

  Object.defineProperty(G, 'screen', {
    get() { return this._screen; },
    set(v) { if (v !== this._screen) { this._screen = v; document.dispatchEvent(new CustomEvent('catz-screen', { detail: v })); } },
  });

  // ============================================================================================================
  //  fighters
  // ============================================================================================================
  function newFighter(idx, chIdx, hue, ai) {
    const f = { idx, ch: chIdx, hue, spr: Rig.sprites(ROSTER[chIdx].char, hue), ai: ai || null, name: ROSTER[chIdx].name, wins: 0 };
    resetFighter(f, idx ? 620 : 340, idx ? -1 : 1);
    return f;
  }
  function resetFighter(f, x, face) {
    Object.assign(f, {
      x, y: 0, vx: 0, vy: 0, face, hp: 100, hpGhost: 100, meter: 40, state: 'intro', t: 0, move: null, hit: false,
      connected: false, stun: 0, buf: {}, crouch: false, block: false, combo: 0, invuln: 0, airUsed: false, ko: false,
      walkPh: 0, walkDir: 0, hitPose: 'hitHigh', flash: 0, landed: true, pose: Poses.make(), prev: blankCtl(), lastHit: 0,
    });
    if (f.ai) f.ai = newAI(f.ai.skill, f.ai.d);
  }

  function isCrouched(f) {
    return (f.state === 'idle' && f.crouch && f.y === 0) || (f.state === 'attack' && f.move && f.move.crouch) ||
      (f.state === 'blockstun' && f.crouch) || (f.state === 'hit' && f.hitPose === 'hitLow' && f.crouch);
  }
  function hurtbox(f) { return { x0: f.x - BODY_HALF, x1: f.x + BODY_HALF, y0: f.y, y1: f.y + (isCrouched(f) ? HURT_C : HURT_H) }; }
  const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

  function chooseAttack(f, c, cancel) {
    const b = f.buf;
    if (f.y > 0) return (!f.airUsed && (b.lp || b.hp || b.lk || b.hk)) ? 'jK' : null;
    if (b.sp && f.meter >= 100) return 'SP';
    if (c.d) { if (b.lk || b.hk) return 'cLK'; if (b.lp || b.hp) return 'cLP'; return null; }
    if (b.hk) return 'HK'; if (b.hp) return 'HP'; if (b.lk) return 'LK'; if (b.lp) return 'LP';
    return null;
  }
  const TIER = { LP: 1, LK: 1, cLP: 1, HP: 2, cLK: 2, HK: 3, SP: 4, jK: 0 };
  function canCancel(a, b) {
    if (a.key === 'SP' || a.key === 'jK' || b.air) return false;
    return TIER[b.key] > TIER[a.key] || (TIER[a.key] === 1 && TIER[b.key] === 1 && a.key !== b.key);
  }

  function startAttack(f, key) {
    const m = MV[key];
    f.state = 'attack'; f.move = m; f.t = 0; f.hit = false; f.connected = false; f.buf = {};
    if (m.air) f.airUsed = true; else f.vx = 0;
    f.crouch = !!m.crouch;
  }

  function doFree(f, o, c) {
    if (f.y === 0) {
      if (Math.abs(o.x - f.x) > 6) f.face = o.x > f.x ? 1 : -1;
      const k = chooseAttack(f, c);
      if (k) { startAttack(f, k); return; }
      f.block = c.blk; f.crouch = c.d;
      if (f.block || f.crouch) { f.vx = 0; f.walkDir = 0; return; }
      const dir = (c.r ? 1 : 0) - (c.l ? 1 : 0);
      f.vx = dir * (dir * f.face > 0 ? SPEED_F : SPEED_B);
      f.walkDir = dir * f.face;
      if (dir) f.walkPh += 0.19;
      if (f.buf.u > 0) {
        f.vy = 17.5 * 1.08; f.vx = dir * 5 * K; f.airUsed = false; f.buf.u = 0; f.landed = false; Sound.play('jump');
      }
    } else {
      const k = chooseAttack(f, c);
      if (k === 'jK') startAttack(f, k);
    }
  }

  function doAttack(f, o, c) {
    const m = f.move;
    if (!m.air) f.vx = (m.adv && f.t < m.S + m.A) ? f.face * m.adv : 0;
    if (m.sfx && !m.special && f.t === Math.max(1, m.S - 3)) Sound.play(m.sfx);
    if (m.special && f.t === m.S) { spawnProj(f); f.meter = 0; }
    if (f.connected && f.t >= m.S + m.A && f.t < m.total - 2) {
      const k = chooseAttack(f, c);
      if (k && canCancel(m, MV[k])) { startAttack(f, k); return; }
    }
    if (f.t >= m.total) { f.state = 'idle'; f.t = 0; f.move = null; f.crouch = c.d && f.y === 0; }
  }

  function doStun(f) {
    f.stun--; f.vx *= 0.84;
    if (f.stun <= 0) { f.state = 'idle'; f.t = 0; f.vx = 0; }
  }

  const FALL = 24, LIE = 46, GETUP = 20;
  function doDown(f) {
    if (f.y === 0 && !f.landed) { f.landed = true; f.vx *= 0.3; Sound.play('knockdown'); G.shake = Math.max(G.shake, 7); fx(f.x, GROUND - 20, 'dust', 60); }
    if (f.y === 0) f.vx *= 0.8;
    if (!f.ko && f.t >= FALL + LIE + GETUP) { f.state = 'idle'; f.t = 0; f.invuln = 34; f.vx = 0; f.crouch = false; }
  }

  function updateFighter(f, o, c, pr) {
    f.t++;
    if (f.invuln > 0) f.invuln--;
    if (f.flash > 0) f.flash--;
    for (const k of ATK) { if (pr[k]) f.buf[k] = 8; else if (f.buf[k] > 0) f.buf[k]--; }
    if (pr.u) f.buf.u = 8; else if (f.buf.u > 0) f.buf.u--;
    if (f.state !== 'intro') f.meter = Math.min(100, f.meter + 0.2);
    switch (f.state) {
      case 'idle': doFree(f, o, c); break;
      case 'attack': doAttack(f, o, c); break;
      case 'hit': case 'blockstun': doStun(f); break;
      case 'down': case 'ko': doDown(f); break;
      default: f.vx = 0;
    }
    f.x += f.vx;
    if (f.y > 0 || f.vy !== 0) {
      f.vy -= GRAV; f.y += f.vy;
      if (f.y <= 0 && f.vy < 0) {
        f.y = 0; f.vy = 0;
        if (f.state === 'idle') { f.vx = 0; Sound.play('land'); fx(f.x, GROUND, 'dust', 30); }
        else if (f.state === 'attack') { f.state = 'idle'; f.t = 0; f.move = null; f.vx = 0; Sound.play('land'); }
      }
    }
    f.x = clamp(f.x, WALL_L, WALL_R);
    // hp ghost bar
    if (f.hpGhost > f.hp) f.hpGhost = Math.max(f.hp, f.hpGhost - 0.35);
  }

  // ---- combat ------------------------------------------------------------------------------------------------
  function resolveHit(a, d, m, sx, sy) {
    // blocking?
    const blocking = (d.state === 'idle' && d.y === 0 && d.block) || d.state === 'blockstun';
    let blocked = blocking;
    if (blocking && d.state === 'idle' && m.height === 'low' && !d.crouch) blocked = false;
    if (blocked) {
      const chip = Math.max(1, Math.round((m.dmg || 0) * 0.1));
      d.hp = Math.max(1, d.hp - chip);
      d.state = 'blockstun'; d.t = 0; d.stun = m.bs || 10; d.move = null;
      d.vx = -d.face * (m.kb || 3) * 0.7;
      if ((d.x <= WALL_L + 2 && d.vx < 0) || (d.x >= WALL_R - 2 && d.vx > 0)) a.vx = -a.face * (m.kb || 3) * 0.9;
      a.connected = true; a.meter = Math.min(100, a.meter + 3);
      Sound.play('block'); fx(sx, sy, 'spark', 40, '#7fe9ff'); G.hitstop = 3; G.shake = Math.max(G.shake, 2);
      return 'block';
    }
    const inCombo = d.state === 'hit' || (d.state === 'down' && d.t < 6);
    a.combo = inCombo ? a.combo + 1 : 1;
    const counter = d.state === 'attack';
    let dmg = (m.dmg || 0) * Math.max(0.35, 1 - 0.13 * (a.combo - 1)) * (counter ? 1.25 : 1);
    const F = G.fight;
    if (G.mode === 1 && F && !F.demo) {           // vs the CPU: whoever is far ahead deals a bit less, the one behind a bit more
      const DF = diffNow();
      const lead = ((F.f[0].hp - F.f[1].hp) / 100 + 0.15 * (F.f[0].wins - F.f[1].wins)) * DF.mercy;   // >0 = player ahead
      dmg *= d === F.f[1] ? clamp(1 - 0.55 * lead, 0.55, 1.2) * DF.dealt : clamp(1 + 0.45 * lead, 0.85, 1.35) * DF.taken;
    }
    d.hp = Math.max(0, d.hp - dmg);
    d.flash = 6;
    const kd = m.kd || d.y > 0 || d.hp <= 0 || a.combo >= 4;      // combo limit: the 4th hit knocks down
    d.move = null; d.hit = false; d.t = 0;
    d.hitPose = (m.height === 'low' || m.crouch) ? 'hitLow' : 'hitHigh';
    if (kd) {
      d.state = d.hp <= 0 ? 'ko' : 'down'; d.ko = d.hp <= 0; d.landed = false;
      d.vy = d.y > 0 ? 6 : 9; d.vx = -d.face * ((m.kb || 5) + 2.5);
      d.crouch = false; d.invuln = 0;
    } else {
      d.state = 'hit'; d.stun = Math.max(8, (m.hs || 15) - 2 * (a.combo - 1)) + (counter ? 4 : 0);   // stun decays within a combo
      d.vx = -d.face * (m.kb || 3);
      if ((d.x <= WALL_L + 2 && d.vx < 0) || (d.x >= WALL_R - 2 && d.vx > 0)) a.vx = -a.face * (m.kb || 3) * 0.9;
    }
    a.connected = true; a.meter = Math.min(100, a.meter + 6); d.meter = Math.min(100, d.meter + 10);
    const big = (m.dmg || 0) >= 11 || kd;
    Sound.play(big ? 'heavy' : 'hit', big ? 1 : 0.9);
    fx(sx, sy, 'spark', big ? 78 : 54, big ? '#ffd45a' : '#fff3b0');
    G.hitstop = big ? 8 : 5; G.shake = Math.max(G.shake, big ? 9 : 4);
    if (a.combo >= 2) G.combo[a.idx] = { n: a.combo, t: 90 };
    return 'hit';
  }

  function tryHit(a, d) {
    if (a.state !== 'attack' || a.hit) return;
    const m = a.move;
    if (!m.box || a.t < m.S || a.t >= m.S + m.A) return;
    if (d.invuln > 0 || d.state === 'down' || d.state === 'ko') return;
    const x0 = a.x + a.face * m.box.x0, x1 = a.x + a.face * m.box.x1;
    const box = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: a.y + m.box.y0, y1: a.y + m.box.y1 };
    if (!overlap(box, hurtbox(d))) return;
    a.hit = true;
    resolveHit(a, d, m, d.x - a.face * 38, GROUND - (a.y + (m.box.y0 + m.box.y1) / 2));
  }

  const PROJ_MOVE = { dmg: 10, hs: 24, bs: 14, kb: 7, height: 'mid' };
  function spawnProj(f) {
    G.projs.push({ x: f.x + f.face * 130 * K, y: 190 * K, vx: f.face * 8.5 * K, face: f.face, owner: f.idx, t: 0, alive: true });
    Sound.play('special');
  }
  function updateProjs(F) {
    for (const p of G.projs) {
      if (!p.alive) continue;
      p.x += p.vx; p.t++;
      if (p.x < -80 || p.x > W + 80) { p.alive = false; continue; }
      const a = F.f[p.owner], d = F.f[1 - p.owner];
      for (const q of G.projs) if (q !== p && q.alive && q.owner !== p.owner && Math.abs(q.x - p.x) < 70) {
        p.alive = q.alive = false; fx((p.x + q.x) / 2, GROUND - 190, 'spark', 90, '#ff5df2'); Sound.play('block');
      }
      if (!p.alive || d.invuln > 0 || d.state === 'down' || d.state === 'ko') continue;
      const box = { x0: p.x - 46 * K, x1: p.x + 46 * K, y0: 110 * K, y1: 270 * K };
      if (overlap(box, hurtbox(d))) { p.alive = false; resolveHit(a, d, PROJ_MOVE, p.x, GROUND - p.y); fx(p.x, GROUND - p.y, 'spark', 110, '#ff5df2'); }
    }
    G.projs = G.projs.filter(p => p.alive);
  }

  function separate(a, b) {
    if (a.y > 130 * K || b.y > 130 * K) return;
    const dx = b.x - a.x, d = Math.abs(dx), min = PUSH * 2;
    if (d >= min) return;
    const s = dx === 0 ? (a.face || 1) : Math.sign(dx), push = (min - d) / 2;
    a.x -= s * push; b.x += s * push;
    const ca = clamp(a.x, WALL_L, WALL_R), cb = clamp(b.x, WALL_L, WALL_R);
    if (ca !== a.x) { b.x += (ca - a.x); a.x = ca; }
    if (cb !== b.x) { a.x += (cb - b.x); b.x = cb; }
    a.x = clamp(a.x, WALL_L, WALL_R); b.x = clamp(b.x, WALL_L, WALL_R);
  }

  // ---- pose selection ----------------------------------------------------------------------------------------
  function targetPose(f, F) {
    const P = Poses.poses;
    switch (f.state) {
      case 'attack': return { p: Poses.sample(f.move.kf, f.t, f.move.base), rate: 1 };
      case 'hit': {
        const u = Math.min(1, f.t / 3), out = Math.min(1, f.stun / 5);
        return { p: Poses.lerp(Poses.idle(G.frame), P[f.hitPose], u * out), rate: 0.7 };
      }
      case 'blockstun': return { p: f.crouch ? P.blockC : P.blockS, rate: 0.6 };
      case 'down': case 'ko': {
        let u;
        if (f.t < FALL) u = f.t / FALL;
        else if (f.t < FALL + LIE || f.ko) u = 1;
        else u = 1 - (f.t - FALL - LIE) / GETUP;
        return { p: Poses.fall(u), rate: 1 };
      }
      case 'win': return { p: Poses.lerp(P.win, Poses.make({ py: 30, hry: -300 }), 0.5 + 0.5 * Math.sin(G.frame * 0.1)), rate: 0.25 };
      case 'lose': return { p: P.lose, rate: 0.2 };
      case 'intro': return { p: Poses.idle(G.frame + f.idx * 20), rate: 0.4 };
      default: break;
    }
    if (f.y > 0) return { p: f.vy > 0 ? P.jumpUp : P.jumpDown, rate: 0.45 };
    if (f.block) return { p: f.crouch ? P.blockC : P.blockS, rate: 0.5 };
    if (f.crouch) return { p: Poses.lerp(P.crouch, Poses.make(Poses.CROUCH), 1), rate: 0.5 };
    if (f.walkDir) return { p: Poses.walk(f.walkPh, f.walkDir), rate: 0.5 };
    return { p: Poses.idle(G.frame + f.idx * 20), rate: 0.4 };
  }
  function updatePose(f, F) {
    const t = targetPose(f, F);
    f.pose = t.rate >= 1 ? t.p : Poses.lerp(f.pose, t.p, t.rate);
  }

  // ============================================================================================================
  //  AI
  // ============================================================================================================
  function newAI(skill, d) { return { skill, d: d || DIFFS[1], script: [], blockT: 0, blockLow: false, sawAtk: false, projT: 0, cool: 20, hp: 100, pressure: 0, pressT: 0, prevState: 'intro' }; }

  function aiControl(f, o) {
    const A = f.ai, c = blankCtl();
    // Keep it fair: ease off when the player is well behind (health or rounds), push harder when they are well ahead.
    const adv = (o.hp - f.hp) / 100 + 0.2 * (o.wins - f.wins);
    const sk = clamp(A.skill + 0.5 * adv * A.d.mercy, 0.05, 0.95);
    const dx = o.x - f.x, dist = Math.abs(dx) / K, toward = dx > 0 ? 'r' : 'l', away = dx > 0 ? 'l' : 'r';
    // pressure: how many times we've been hit lately. Mashing makes the CPU defend harder.
    if (f.hp < A.hp - 0.5) { A.pressure = Math.min(5, A.pressure + 1); A.pressT = 200; }
    A.hp = f.hp;
    if (A.pressT > 0 && --A.pressT === 0) A.pressure = 0;
    const justRecovered = (A.prevState === 'hit' || A.prevState === 'blockstun' || A.prevState === 'down') && f.state === 'idle';
    A.prevState = f.state;
    if (f.state !== 'idle' && f.state !== 'attack') { A.script = []; A.blockT = 0; return c; }
    if (justRecovered && adv > -0.3 && Math.random() < 0.25 + 0.75 * A.d.punish) {            // wake-up: don't just stand there, block or hit back immediately
      A.cool = 1;
      const r0 = Math.random();
      if (r0 < 0.2 + 0.05 * A.pressure) A.script = [{ k: ['blk'], n: 12 + (Math.random() * 12 | 0) }];
      else if (r0 < 0.6 && dist < 285) A.script = [{ k: ['lp'], n: 2 }];
      else if (r0 < 0.75) A.script = [{ k: ['A'], n: 8 }];
    }
    // react to a fresh attack
    if (o.state === 'attack' && o.move && dist < 360 && !o.move.special) {
      if (!A.sawAtk && o.t <= o.move.S) {
        A.sawAtk = true;
        if (Math.random() < Math.min(0.92, (0.4 + sk * 0.5 + 0.06 * A.pressure) * A.d.react)) {
          A.blockT = Math.max(2, (o.move.S + o.move.A - o.t) + 4);      // block through the active frames only, so recovery can be punished
          A.blockLow = o.move.height === 'low' || (!!o.move.crouch && o.move.height !== 'high');
          A.script = [];
        }
      }
    } else if (o.state !== 'attack') A.sawAtk = false;
    // react to projectiles
    for (const p of G.projs) {
      if (p.owner !== f.idx && Math.abs(p.x - f.x) < 260 * K && Math.sign(p.vx) === Math.sign(f.x - p.x) && A.projT <= 0) {
        A.projT = 40;
        if (Math.random() < 0.2 + sk * 0.7) { A.blockT = 30; A.blockLow = false; A.script = []; }
      }
    }
    if (A.projT > 0) A.projT--;
    if (A.blockT > 0) { A.blockT--; if (f.y === 0) { c.blk = true; c.d = A.blockLow; } return c; }
    // punish: the opponent is recovering from an attack and in reach, so hit them while they can't act
    if (f.state === 'idle' && f.y === 0 && !A.script.length && o.state === 'attack' && o.move && !o.move.special && !o.move.air &&
        o.t >= o.move.S + o.move.A && o.t < o.move.total - 3 && dist < 330 && Math.random() < (0.08 + 0.2 * sk) * A.d.punish) {
      A.script = dist < 262 ? [{ k: ['lp'], n: 2 }, { k: [], n: 4 }, { k: ['hp'], n: 2 }] : [{ k: ['lk'], n: 2 }];
      A.cool = 4;
    }
    // run the current script (also while attacking, so strings can chain)
    if (A.script.length) {
      const s = A.script[0];
      for (const k of s.k) { if (k === 'T') c[toward] = true; else if (k === 'A') c[away] = true; else c[k] = true; }
      if (--s.n <= 0) A.script.shift();
      return c;
    }
    if (f.state === 'attack') return c;
    if (--A.cool > 0) return c;
    A.cool = Math.round(rnd(8, 30) * (1.2 - sk * 0.7) * (adv < -0.3 ? 1.6 : 1) * A.d.cool);
    if (adv < -0.15 && Math.random() < Math.min(0.75, -adv * 1.6)) {      // well ahead: back off and give them room
      A.script = [{ k: Math.random() < 0.5 ? ['A'] : [], n: 18 + (Math.random() * 22 | 0) }];
      return c;
    }
    const r = Math.random(), S = (k, n) => ({ k, n });
    if (dist > 400) {
      if (f.meter >= 100 && r < 0.45) A.script = [S(['sp'], 2)];
      else if (r < 0.14 + sk * 0.08) A.script = [S(['u', 'T'], 3), S(['T'], 13), S(['lk', 'T'], 3)];
      else A.script = [S(['T'], rnd(14, 36) | 0)];
    } else if (dist > 300) {
      if (r < 0.34) A.script = [S(['lk'], 2)];
      else if (r < 0.46) A.script = [S(['hk'], 2)];
      else if (r < 0.56) A.script = [S(['d', 'lk'], 3)];
      else if (r < 0.62 && f.meter >= 100) A.script = [S(['sp'], 2)];
      else A.script = [S(['T'], rnd(8, 18) | 0)];
    } else if (dist > 150) {
      if (r < 0.2) A.script = [S(['lp'], 2), S([], 6), S(['hp'], 2)];
      else if (r < 0.35) A.script = [S(['hp'], 2)];
      else if (r < 0.5) A.script = [S(['lk'], 2), S([], 6), S(['hk'], 2)];
      else if (r < 0.6) A.script = [S(['d', 'lp'], 3)];
      else if (r < 0.68) A.script = [S(['d', 'lk'], 3)];
      else if (r < 0.76) A.script = [S(['A'], rnd(10, 22) | 0)];
      else if (r < 0.84) A.script = [S(['blk'], rnd(14, 30) | 0)];
      else A.script = [S(['T'], rnd(5, 12) | 0)];
    } else {
      if (r < 0.28) A.script = [S(['lp'], 2), S([], 5), S(['lp'], 2), S([], 6), S(['hp'], 2)];
      else if (r < 0.46) A.script = [S(['hp'], 2)];
      else if (r < 0.58) A.script = [S(['lk'], 2), S([], 6), S(['hk'], 2)];
      else if (r < 0.68) A.script = [S(['d', 'lk'], 3)];
      else if (r < 0.78) A.script = [S(['A'], rnd(12, 26) | 0)];
      else if (r < 0.88) A.script = [S(['blk', 'd'], rnd(14, 26) | 0)];
      else A.script = [S(['d', 'lp'], 3)];
    }
    return c;
  }

  // ============================================================================================================
  //  effects
  // ============================================================================================================
  function fx(x, y, kind, size, color) {
    if (kind === 'dust') {
      for (let i = 0; i < 7; i++) G.fx.push({ kind: 'dot', x: x + rnd(-size, size), y, vx: rnd(-1.5, 1.5), vy: rnd(-2.5, -0.5), t: 0, life: 24, size: rnd(5, 10), color: 'rgba(255,230,255,0.55)' });
      return;
    }
    G.fx.push({ kind: 'spark', x, y, t: 0, life: 15, size, color: color || '#fff', rot: Math.random() * 6.28 });
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * 6.28, v = rnd(3, 9);
      G.fx.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 20, size: rnd(3, 6), color });
    }
  }
  function updateFx() {
    for (const e of G.fx) { e.t++; if (e.kind === 'dot') { e.x += e.vx; e.y += e.vy; e.vy += 0.25; } }
    G.fx = G.fx.filter(e => e.t < e.life);
    if (G.shake > 0) G.shake *= 0.82;
    if (G.shake < 0.2) G.shake = 0;
  }

  // ============================================================================================================
  //  match / round flow
  // ============================================================================================================
  function newMatch(c1, c2, opts) {
    opts = opts || {};
    let h1 = ROSTER[c1].hue, h2 = ROSTER[c2].hue;
    if (c1 === c2) h2 = (h2 + 180) % 360;
    const a = newFighter(0, c1, h1, opts.ai1 ? { skill: opts.skill1 || 0.5, d: DIFFS[1] } : null);
    const b = newFighter(1, c2, h2, opts.ai2 ? { skill: opts.skill2 || 0.5, d: opts.demo ? DIFFS[1] : diffNow() } : null);
    G.fight = { f: [a, b], round: 0, phase: 'intro', t: 0, timer: 3600, demo: !!opts.demo, over: false, winner: -1, stage: G.stageIdx };
    G.projs = []; G.fx = []; G.combo = [null, null];
    startRound(G.fight);
  }
  function startRound(F) {
    F.round++; F.phase = 'intro'; F.t = 0; F.timer = 3600;
    resetFighter(F.f[0], 340, 1); resetFighter(F.f[1], 620, -1);
    G.projs = []; G.fx = []; G.combo = [null, null]; G.slow = false;
    G.banner = null;
  }
  function endRound(F, winner, why) {
    F.phase = 'ko'; F.t = 0; F.winner = winner; F.why = why;
    if (!F.demo && F.log) {
      F.log.push({ round: F.round, winner, why, hp: [Math.round(F.f[0].hp), Math.round(F.f[1].hp)], secLeft: Math.max(0, Math.ceil(F.timer / 60)) });
      emit('catz:round_end', { matchId: F.id, round: F.round, winner, why, hp: F.log[F.log.length - 1].hp, secLeft: F.log[F.log.length - 1].secLeft });
    }
    if (winner >= 0) F.f[winner].wins++;
    if (why === 'ko') { G.slow = true; Sound.play('ko'); G.shake = 14; }
  }

  function ctlFor(f, o) {
    if (f.ai) return aiControl(f, o);
    if (G.mode === 1 && f.idx === 0) {            // single player: either key layout works
      const a = Input.eff[0], b = Input.eff[1], c = {};
      for (const k in a) c[k] = a[k] || b[k];
      return c;
    }
    return Input.eff[f.idx];
  }

  function updateFight() {
    const F = G.fight, [a, b] = F.f;
    if (F.over) { for (const f of F.f) updatePose(f, F); return; }
    F.t++;
    const act = F.phase === 'fight';
    const freeze = G.hitstop > 0;
    if (freeze) G.hitstop--;

    if (F.phase === 'intro') {
      if (F.t === 2) { Sound.play('round'); }
      if (F.t === 78) { Sound.play('fight'); }
      if (F.t >= 130) { F.phase = 'fight'; F.t = 0; Sound.setMode('fight'); for (const f of F.f) { f.state = 'idle'; f.t = 0; } }
    }

    if (!freeze) {
      for (const f of F.f) {
        const o = F.f[1 - f.idx];
        const c = act ? ctlFor(f, o) : blankCtl();
        const pr = {};
        for (const k in c) pr[k] = c[k] && !f.prev[k];
        f.prev = Object.assign({}, c);
        updateFighter(f, o, c, pr);
      }
      if (act) { tryHit(a, b); tryHit(b, a); }
      updateProjs(F);
      separate(a, b);
      if (act) {
        F.timer--;
        if (a.hp <= 0 || b.hp <= 0) {
          const w = a.hp <= 0 && b.hp <= 0 ? -1 : (a.hp <= 0 ? 1 : 0);
          endRound(F, w, 'ko');
        } else if (F.timer <= 0) {
          endRound(F, a.hp === b.hp ? -1 : (a.hp > b.hp ? 0 : 1), 'time'); G.slow = false;
        }
      }
    }
    for (const f of F.f) updatePose(f, F);

    for (let i = 0; i < 2; i++) if (G.combo[i] && --G.combo[i].t <= 0) G.combo[i] = null;
    if (F.phase === 'ko') {
      if (F.t === 40) G.slow = false;
      if (F.t >= (F.why === 'ko' ? 105 : 80)) {
        F.phase = 'end'; F.t = 0;
        if (F.winner >= 0) { F.f[F.winner].state = 'win'; F.f[F.winner].t = 0; Sound.play(F.demo ? 'blip' : (F.winner === 0 || G.mode === 2 ? 'win' : 'lose')); }
        for (const f of F.f) if (f.state === 'idle') { f.state = 'lose'; }
      }
    } else if (F.phase === 'end') {
      if (F.t >= 150) {
        const matchOver = F.f[0].wins >= 2 || F.f[1].wins >= 2;
        if (matchOver) finishMatch(F);
        else startRound(F);
      }
    }
  }

  function finishMatch(F) {
    if (F.demo) { newMatch(randCh(), randCh(), { ai1: 1, ai2: 1, demo: 1, skill1: 0.6, skill2: 0.6 }); return; }
    F.over = true;
    reportMatchEnd(F);
    G.screen = 'result'; G.resT = 0;
    Sound.setMode('menu');
  }
  const randCh = () => (Math.random() * ROSTER.length) | 0;

  // ============================================================================================================
  //  host integration: the game announces what happens so the page that embeds it can award rep / track players.
  //  Messages are plain objects { source:'catz-fight', type, ts, token?, ... } sent to the parent window (postMessage)
  //  and also fired as a DOM 'catz-event' for same-page use. Treat them as UNTRUSTED on the server (see docs/rep-integration.md).
  // ============================================================================================================
  const Host = { token: '', origin: '*' };
  function emit(type, data) {
    const msg = Object.assign({ source: 'catz-fight', v: 1, type, ts: Date.now() }, data || {});
    if (Host.token) msg.token = Host.token;
    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, Host.origin); } catch (e) { /* ignore */ }
    try { document.dispatchEvent(new CustomEvent('catz-event', { detail: msg })); } catch (e) { /* ignore */ }
  }
  addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window.parent || !d || d.type !== 'catz:init') return;
    Host.token = String(d.token || '').slice(0, 256);
    Host.origin = e.origin && e.origin !== 'null' ? e.origin : '*';        // from now on only talk to the embedding site
    emit('catz:ready', { difficulties: DIFFS.map(x => x.name), difficulty: diffNow().name });
  });
  function matchScore(F) {
    if (G.mode !== 1 || F.f[0].wins < 2) return 0;
    const hp = F.log.reduce((n, r) => n + (r.winner === 0 ? r.hp[0] : 0), 0), time = F.log.reduce((n, r) => n + (r.winner === 0 ? r.secLeft : 0), 0);
    const perfect = F.f[1].wins === 0 ? 300 : 0;
    return Math.round((600 + hp * 5 + time * 3 + perfect) * DIFFS[F.diffIdx].mult + 150 * (G.ladder - 1));
  }
  function reportMatchEnd(F) {
    if (F.demo || F.reported) return;
    F.reported = true;
    const dur = Date.now() - F.t0, w = F.f[0].wins >= 2 ? 0 : 1;
    emit('catz:match_end', {
      matchId: F.id, mode: G.mode, difficulty: DIFFS[F.diffIdx].name, ladder: G.ladder, p1: F.f[0].name, p2: F.f[1].name,
      result: G.mode === 1 ? (w === 0 ? 'win' : 'loss') : 'p' + (w + 1) + '_win', rounds: F.log, roundsWon: [F.f[0].wins, F.f[1].wins],
      durationMs: dur, score: matchScore(F), eligible: G.mode === 1 && dur >= 20000,
    });
  }
  function abandonIfPlaying() {
    const F = G.fight;
    if (F && !F.demo && !F.over && F.id && !F.reported) { F.reported = true; emit('catz:match_abandon', { matchId: F.id, mode: G.mode, difficulty: DIFFS[F.diffIdx].name, durationMs: Date.now() - F.t0 }); }
  }
  addEventListener('pagehide', abandonIfPlaying);

  // ============================================================================================================
  //  screens
  // ============================================================================================================
  function startAttract() {
    abandonIfPlaying();
    G.screen = 'attract'; G.stageIdx = (Math.random() * 3) | 0; Sound.setMode('menu');
    newMatch(randCh(), randCh(), { ai1: 1, ai2: 1, demo: 1, skill1: 0.55, skill2: 0.55 });
  }
  function startSelect(mode) {
    G.mode = mode; G.screen = 'select'; G.selT = 0; G.ladder = 1;
    G.sel = [{ i: 0, locked: false, shuffle: 0 }, { i: 3, locked: false, shuffle: 0 }]; G.selDone = 0;
    G.menuPrev = [blankCtl(), blankCtl()];
    Sound.play('coin'); Sound.setMode('menu');
  }
  function startVS(c1, c2) {
    G.screen = 'vs'; G.vsT = 0; G.vs = [c1, c2];
    G.stageIdx = (Math.random() * 3) | 0;
    Sound.play('select');
  }
  function startFightFromVS() {
    const [c1, c2] = G.vs;
    const DF = diffNow(), skill = clamp(DF.skill + 0.08 * (G.ladder - 1), 0.05, 0.95);
    newMatch(c1, c2, { ai2: G.mode === 1, skill2: skill });
    const F = G.fight;
    F.id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); F.t0 = Date.now(); F.log = []; F.diffIdx = G.diff;
    emit('catz:match_start', { matchId: F.id, mode: G.mode, difficulty: DF.name, ladder: G.ladder, p1: ROSTER[c1].name, p2: ROSTER[c2].name });
    G.screen = 'fight'; Sound.setMode('fight');
  }

  function menuEdges(i) {
    const c = Input.eff[i], p = G.menuPrev[i], e = {};
    for (const k in c) e[k] = c[k] && !p[k];
    G.menuPrev[i] = Object.assign({}, c);
    return e;
  }

  function updateSelect() {
    G.selT++;
    for (let i = 0; i < 2; i++) {
      const s = G.sel[i];
      let e = menuEdges(i);
      if (G.mode === 1 && i === 0) { const e2 = menuEdges(1); for (const k in e2) e[k] = e[k] || e2[k]; }
      if (G.mode === 1 && i === 1) {
        // CPU picks after P1 locks in: a quick cursor shuffle, then lands on a random fighter
        if (G.sel[0].locked && !s.locked) {
          s.shuffle++;
          if (s.shuffle % 4 === 0) { s.i = (s.i + 1) % ROSTER.length; Sound.play('blip'); }
          if (s.shuffle > 36) { s.locked = true; s.i = randCh(); Sound.play('select'); }
        }
        continue;
      }
      if (s.locked) { if (e.blk) { s.locked = false; Sound.play('blip'); } continue; }
      if (G.mode === 1 && i === 0 && (e.u || e.d)) {          // up / down changes the CPU level
        G.diff = clamp(G.diff + (e.u ? 1 : -1), 0, DIFFS.length - 1); Sound.play('blip');
        try { localStorage.setItem('catz-diff', String(G.diff)); } catch (err) { /* ignore */ }
      }
      if (e.l) { s.i = (s.i + ROSTER.length - 1) % ROSTER.length; Sound.play('blip'); }
      if (e.r) { s.i = (s.i + 1) % ROSTER.length; Sound.play('blip'); }
      if (e.lp || e.hp || e.lk || e.hk || e.sp) { s.locked = true; Sound.play('select'); }
    }
    if (G.sel[0].locked && G.sel[1].locked && !G.selDone) { G.selDone = G.selT; }
    if (G.selDone && G.selT - G.selDone > 40) { G.selDone = 0; startVS(G.sel[0].i, G.sel[1].i); }
  }

  function updateAll() {
    switch (G.screen) {
      case 'attract': case 'fight': updateFight(); updateFx(); break;
      case 'select': updateSelect(); break;
      case 'vs': G.vsT++; if (G.vsT >= 130) startFightFromVS(); break;
      case 'result': G.resT++; updateFight(); updateFx(); break;
    }
  }

  // ============================================================================================================
  //  drawing helpers
  // ============================================================================================================
  function T(s, x, y, size, o) {
    o = o || {};
    ctx.save();
    ctx.translate(x, y);
    if (o.skew) ctx.transform(1, 0, -o.skew, 1, 0, 0);
    if (o.sx) ctx.scale(o.sx, o.sy || o.sx);
    ctx.font = `${o.weight || ''} ${size}px ${o.font || FONT_PIX}`.trim();
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.lineJoin = 'round';
    if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur || 16; }
    let fill = o.fill || '#fff';
    if (Array.isArray(fill)) { const g = ctx.createLinearGradient(0, -size, 0, 0); fill.forEach((c, i) => g.addColorStop(i / (fill.length - 1), c)); fill = g; }
    if (o.stroke) { ctx.lineWidth = o.sw || 6; ctx.strokeStyle = o.stroke; ctx.strokeText(s, 0, 0); }
    ctx.shadowBlur = o.glow ? (o.blur || 16) : 0;
    ctx.fillStyle = fill; ctx.fillText(s, 0, 0);
    ctx.restore();
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

  function portrait(spr, x, y, w, h) {
    const R = spr.def.scale, im = Rig.restCanvas(spr);               // head + upper chest of the assembled rest pose
    ctx.drawImage(im, 392 * R, 14 * R, 298 * R, 356 * R, x, y, w, h);
  }

  // ---- world ---------------------------------------------------------------------------------------------------
  function drawFighter(f) {
    const sh = Math.max(0.35, 1 - f.y / 280), down = f.state === 'down' || f.state === 'ko';
    ctx.save();
    ctx.globalAlpha = 0.5 * sh; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(f.x, GROUND + 5, (down ? 190 : 105) * K * sh, 17 * K * sh, 0, 0, 7); ctx.fill();
    ctx.restore();
    const y = GROUND - f.y;
    if (f.invuln > 0 && (G.frame & 2)) ctx.globalAlpha = 0.6;
    Rig.draw(ctx, f.spr, f.pose, f.x, y, f.face, SC);
    ctx.globalAlpha = 1;
    if (f.flash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = f.flash / 6 * 0.55;
      Rig.draw(ctx, f.spr, f.pose, f.x, y, f.face, SC);
      ctx.restore();
    }
  }

  function drawProj(p) {
    ctx.save();
    ctx.translate(p.x, GROUND - p.y); ctx.scale(p.face * K, K);
    for (let i = 3; i >= 0; i--) {
      ctx.save(); ctx.translate(-i * 22, 0); ctx.globalAlpha = i === 0 ? 1 : 0.28 / i;
      const g = ctx.createLinearGradient(-40, 0, 60, 0); g.addColorStop(0, '#2de2e6'); g.addColorStop(1, '#ff4df2');
      ctx.shadowColor = '#ff4df2'; ctx.shadowBlur = i === 0 ? 30 : 0; ctx.fillStyle = g;
      const s = 1 + Math.sin(p.t * 0.5) * 0.06;
      ctx.beginPath(); ctx.moveTo(10, -84 * s); ctx.quadraticCurveTo(78, -30, 58, 0); ctx.quadraticCurveTo(78, 30, 10, 84 * s);
      ctx.quadraticCurveTo(46, 30, 40, 0); ctx.quadraticCurveTo(46, -30, 10, -84 * s); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawFx() {
    for (const e of G.fx) {
      const u = e.t / e.life;
      if (e.kind === 'spark') {
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rot);
        const n = 10, len = e.size * (0.45 + 0.7 * Math.sin(Math.min(1, u * 1.4) * Math.PI * 0.5)), th = (1 - u) * 9;
        ctx.globalAlpha = 1 - u * u; ctx.fillStyle = e.color; ctx.shadowColor = e.color; ctx.shadowBlur = 18;
        for (let i = 0; i < n; i++) {
          const a = i * Math.PI * 2 / n, l = len * (i % 2 ? 0.55 : 1);
          ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(8, -th * 0.5); ctx.lineTo(8 + l, 0); ctx.lineTo(8, th * 0.5); ctx.fill(); ctx.restore();
        }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, e.size * 0.22 * (1 - u), 0, 7); ctx.fill();
        ctx.restore();
      } else {
        ctx.globalAlpha = 1 - u; ctx.fillStyle = e.color || '#fff';
        ctx.beginPath(); ctx.arc(e.x, e.y, e.size * (1 - u * 0.5), 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  function drawWorld(F, dim) {
    ctx.save();
    if (G.shake > 0) ctx.translate(rnd(-G.shake, G.shake), rnd(-G.shake, G.shake) * 0.6);
    ctx.drawImage(Stage.get(F.stage), 0, 0);
    Stage.drawGrid(ctx, F.stage, G.frame);
    const order = (F.f[0].state === 'attack' && F.f[1].state !== 'attack') ? [1, 0] : [0, 1];
    for (const i of order) drawFighter(F.f[i]);
    for (const p of G.projs) drawProj(p);
    drawFx();
    if (G.debug) debugBoxes(F);
    ctx.restore();
    if (dim) { ctx.fillStyle = `rgba(6,0,16,${dim})`; ctx.fillRect(0, 0, W, H); }
  }
  function debugBoxes(F) {
    ctx.save(); ctx.lineWidth = 2;
    for (const f of F.f) {
      const h = hurtbox(f); ctx.strokeStyle = '#0f0';
      ctx.strokeRect(h.x0, GROUND - h.y1, h.x1 - h.x0, h.y1 - h.y0);
      if (f.state === 'attack' && f.move.box) {
        const m = f.move, x0 = f.x + f.face * m.box.x0, x1 = f.x + f.face * m.box.x1;
        ctx.strokeStyle = (f.t >= m.S && f.t < m.S + m.A) ? '#f00' : '#880';
        ctx.strokeRect(Math.min(x0, x1), GROUND - (f.y + m.box.y1), Math.abs(x1 - x0), m.box.y1 - m.box.y0);
      }
    }
    ctx.restore();
  }

  // ---- HUD ------------------------------------------------------------------------------------------------------
  function bar(x, w, v, ghost, side, grad) {
    const y = 54, h = 40;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; rr(x - 6, y - 6, w + 12, h + 12, 8); ctx.fill();
    ctx.fillStyle = '#1a0a22'; ctx.fillRect(x, y, w, h);
    const gw = w * clamp(ghost / 100, 0, 1), fw = w * clamp(v / 100, 0, 1);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.forEach((c, i) => g.addColorStop(i / (grad.length - 1), c));
    const ax = side < 0 ? x : x + w;      // anchored to the outer edge, drains toward the centre
    ctx.fillStyle = '#fff4'; ctx.fillRect(side < 0 ? ax : ax - gw, y, gw, h);
    ctx.fillStyle = g; ctx.fillRect(side < 0 ? ax : ax - fw, y, fw, h);
    ctx.fillStyle = 'rgba(255,255,255,0.24)'; ctx.fillRect(side < 0 ? ax : ax - fw, y, fw, h * 0.38);
    ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 4; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    ctx.restore();
  }
  function drawHUD(F) {
    const bw = 366, x1 = 48, x2 = W - 48 - bw, [a, b] = F.f;
    bar(x1, bw, a.hp, a.hpGhost, -1, ['#ff2d2d', '#ff8a1a', '#ffe14a']);
    bar(x2, bw, b.hp, b.hpGhost, +1, ['#2de2e6', '#18b7ff', '#2d6bff']);
    T('1P', x1, 46, 26, { fill: '#ffd45a', stroke: '#000', sw: 7 });
    T('2P', W - 48, 46, 26, { fill: '#7fe9ff', stroke: '#000', sw: 7, align: 'right' });
    T('VS', 480, 104, 70, { font: FONT_TITLE, align: 'center', skew: 0.25, fill: ['#ffe14a', '#ff7a1a', '#ff2d6a'], stroke: '#2a0030', sw: 10, glow: '#ff5a1f', blur: 14 });
    const sec = Math.max(0, Math.ceil(F.timer / 60));
    if (!F.demo) T(String(sec).padStart(2, '0'), 480, 168, 46, { align: 'center', fill: sec <= 10 ? '#ff5a5a' : '#fff', stroke: '#000', sw: 9 });
    T(a.name, x1, 150, 28, { fill: '#fff', stroke: '#000', sw: 7 });
    T(b.name, W - 48, 150, 28, { fill: '#fff', stroke: '#000', sw: 7, align: 'right' });
    // round pips
    for (let i = 0; i < 2; i++) {
      for (const [f, px, dir] of [[a, x1 + bw - 12, -1], [b, x2 + 12, 1]]) {
        ctx.beginPath(); ctx.arc(px + dir * i * 32, 140, 11, 0, 7);
        ctx.fillStyle = i < f.wins ? '#ffe14a' : 'rgba(0,0,0,0.65)'; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = '#ff4fd8'; ctx.stroke();
      }
    }
    // special meters
    for (const [f, x, side] of [[a, x1, -1], [b, x2, 1]]) {
      const w = 190, y = 106, ax = side < 0 ? x : x + bw - w, full = f.meter >= 100;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(ax - 3, y - 3, w + 6, 16);
      ctx.fillStyle = full ? (G.frame & 8 ? '#fff' : '#ff4df2') : '#2de2e6';
      ctx.fillRect(side < 0 ? ax : ax + w - w * f.meter / 100, y, w * f.meter / 100, 10);
      if (full) T('SP!', side < 0 ? ax + w + 12 : ax - 12, y + 12, 20, { fill: '#ff4df2', stroke: '#000', sw: 6, align: side < 0 ? 'left' : 'right' });
    }
    // combos
    for (let i = 0; i < 2; i++) {
      const c = G.combo[i]; if (!c) continue;
      const x = i === 0 ? 52 : W - 52, al = i === 0 ? 'left' : 'right';
      T(c.n + ' HITS', x, 270, 44, { align: al, fill: ['#fff', '#ffe14a'], stroke: '#9b1d00', sw: 12, skew: 0.15 });
    }
  }

  function banner(txt, sub, u, color) {
    const s = u < 0.12 ? 2.4 - 1.4 * (u / 0.12) : 1;
    ctx.save(); ctx.globalAlpha = Math.min(1, u * 10, (1 - u) * 6 + 0.4);
    T(txt, 480, 360, 92, { font: FONT_TITLE, align: 'center', skew: 0.22, sx: s, fill: color || ['#fff', '#ffd45a', '#ff3d7a'], stroke: '#26002e', sw: 16, glow: '#ff2bd6', blur: 24 });
    if (sub) T(sub, 480, 430, 28, { align: 'center', fill: '#fff', stroke: '#000', sw: 6 });
    ctx.restore();
  }

  function drawFightOverlay(F) {
    drawHUD(F);
    if (F.phase === 'intro') {
      if (F.t < 78) banner('ROUND ' + F.round, null, F.t / 78);
      else banner('FIGHT!', null, (F.t - 78) / 52, ['#fff', '#ff9a3d', '#ff2d2d']);
    } else if (F.phase === 'ko') {
      if (F.why === 'ko') banner(F.winner < 0 ? 'DOUBLE K.O.' : 'K.O.', null, Math.min(1, F.t / 90), ['#fff', '#ff6a3d', '#ff1d1d']);
      else banner('TIME UP', null, Math.min(1, F.t / 70));
    } else if (F.phase === 'end') {
      const w = F.winner;
      const txt = w < 0 ? 'DRAW' : (G.mode === 1 && !F.demo ? (w === 0 ? 'YOU WIN' : 'YOU LOSE') : (w === 0 ? 'P1 WINS' : 'P2 WINS'));
      if (!F.demo) { T(txt, 480, 360, 66, { font: FONT_TITLE, align: 'center', skew: 0.2, fill: ['#fff', '#7fe9ff', '#2d6bff'], stroke: '#06143a', sw: 14, glow: '#2de2e6' }); }
    }
  }

  // ---- screens ----------------------------------------------------------------------------------------------------
  function drawAttract() {
    const F = G.fight;
    drawWorld(F, 0.35);
    const t = G.frame;
    Stage.panther(ctx, 480, 255, 150, '#d6ff2a', '#c8ff00', 3.2);
    T('CATZ', 480, 475, 130, { font: FONT_TITLE, align: 'center', skew: 0.2, fill: ['#ffd23d', '#ff7a1a', '#ff2d8a'], stroke: '#1d0030', sw: 18, glow: '#ff2bd6', blur: 28 });
    T('FIGHT', 480, 590, 130, { font: FONT_TITLE, align: 'center', skew: 0.2, fill: ['#ff3d9a', '#c21cff', '#4d4dff'], stroke: '#1d0030', sw: 18, glow: '#7a2bff', blur: 28 });
    ctx.fillStyle = 'rgba(6,0,16,0.72)'; rr(110, 700, 740, 170, 18); ctx.fill();
    if ((t >> 5) & 1) T('PRESS START', 480, 774, 44, { align: 'center', fill: '#fff', stroke: '#000', sw: 10, glow: '#ff2bd6' });
    T('ENTER / TAP: 1 PLAYER', 480, 826, 22, { align: 'center', fill: '#ffd45a', stroke: '#000', sw: 6 });
    T('KEY 2: 2 PLAYERS', 480, 858, 22, { align: 'center', fill: '#ffd45a', stroke: '#000', sw: 6 });
    T('FREE PLAY', 480, 952, 24, { align: 'center', fill: '#7fe9ff', stroke: '#000', sw: 7 });
  }

  function drawSelect() {
    ctx.drawImage(Stage.get(G.stageIdx), 0, 0);
    Stage.drawGrid(ctx, G.stageIdx, G.frame);
    ctx.fillStyle = 'rgba(8,0,20,0.55)'; ctx.fillRect(0, 0, W, H);
    // header bars like the cabinet's screen
    const bw = 372;
    const hb = (x, side, grad) => {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; rr(x - 4, 40, bw + 8, 38, 6); ctx.fill();
      const g = ctx.createLinearGradient(x, 0, x + bw, 0); grad.forEach((c, i) => g.addColorStop(i / (grad.length - 1), c));
      ctx.fillStyle = g; ctx.fillRect(x, 44, bw, 30);
      ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 3; ctx.strokeRect(x - 1.5, 42.5, bw + 3, 33);
    };
    hb(44, -1, ['#ff2d2d', '#ff8a1a', '#ffe14a']); hb(W - 44 - bw, 1, ['#2de2e6', '#18b7ff', '#2d6bff']);
    T('1P', 44, 36, 26, { fill: '#ffd45a', stroke: '#000', sw: 7 });
    T('2P', W - 44, 36, 26, { fill: '#7fe9ff', stroke: '#000', sw: 7, align: 'right' });
    T('VS', 480, 82, 56, { font: FONT_TITLE, align: 'center', skew: 0.25, fill: ['#ffe14a', '#ff7a1a', '#ff2d6a'], stroke: '#2a0030', sw: 9, glow: '#ff5a1f' });

    const cur = [G.sel[0].i, G.sel[1].i];
    for (let i = 0; i < 2; i++) {
      const ch = ROSTER[cur[i]], hue = (cur[0] === cur[1] && i === 1) ? (ch.hue + 180) % 360 : ch.hue;
      const spr = Rig.sprites(ch.char, hue), x = i ? 715 : 245, face = i ? -1 : 1;
      const pose = G.sel[i].locked ? Poses.lerp(Poses.idle(G.frame), Poses.make({ tr: 10, py: 80, hrx: 300, hry: 100 }), 0.4 + 0.3 * Math.sin(G.frame * 0.3)) : Poses.idle(G.frame + i * 30);
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, 726, 140, 20, 0, 0, 7); ctx.fill(); ctx.restore();
      Rig.draw(ctx, spr, pose, x, 722, face, 0.38);
      T(ch.name, x, 770 - 8, 36, { align: 'center', fill: '#fff', stroke: '#000', sw: 7, glow: i ? '#2de2e6' : '#ff8a1a' });
    }
    // roster strip
    const cw = 112, gap = 8, x0 = (W - (ROSTER.length * (cw + gap) - gap)) / 2, y0 = 770, ch = 128;
    ROSTER.forEach((r, i) => {
      const x = x0 + i * (cw + gap);
      ctx.fillStyle = '#10051c'; ctx.fillRect(x, y0, cw, ch);
      const spr = Rig.sprites(r.char, r.hue); portrait(spr, x + 3, y0 + 3, cw - 6, ch - 6);
      ctx.strokeStyle = '#8a5cff'; ctx.lineWidth = 3; ctx.strokeRect(x, y0, cw, ch);
    });
    // cursors
    for (let i = 0; i < 2; i++) {
      const s = G.sel[i], x = x0 + s.i * (cw + gap), col = i ? '#2de2e6' : '#ff8a1a';
      const pulse = s.locked ? 1 : 0.6 + 0.4 * Math.sin(G.frame * 0.25);
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = s.locked ? 7 : 5; ctx.shadowColor = col; ctx.shadowBlur = 18 * pulse;
      const o = i ? 5 : 0;
      ctx.strokeRect(x - 3 + o, y0 - 3 + o, cw + 6 - o * 2, ch + 6 - o * 2); ctx.restore();
      T(i ? '2P' : '1P', x + (i ? cw - 8 : 8), y0 + ch - 10, 22, { align: i ? 'right' : 'left', fill: col, stroke: '#000', sw: 4 });
    }
    if (G.mode === 1) {                                             // CPU level, shown between the two fighters
      const DF = diffNow(), lock = G.sel[0].locked;
      T('LEVEL', 480, 146, 24, { align: 'center', fill: '#c9b6ff', stroke: '#000', sw: 6 });
      T(DF.name, 480, 198, 38, { align: 'center', fill: DF.col, stroke: '#000', sw: 9, glow: DF.col });
      if (!lock) {
        T('\u25B2', 480, 124, 28, { align: 'center', fill: G.diff < 2 ? '#fff' : '#555', stroke: '#000', sw: 5 });
        T('\u25BC', 480, 238, 28, { align: 'center', fill: G.diff > 0 ? '#fff' : '#555', stroke: '#000', sw: 5 });
      }
    }
    const allLocked = G.sel[0].locked && G.sel[1].locked;
    if (!allLocked) T('◀ SELECT YOUR FIGHTER ▶', 480, 950, 28, { align: 'center', fill: '#ffd45a', stroke: '#000', sw: 7 });
    else if ((G.frame >> 3) & 1) T('GET READY!', 480, 950, 30, { align: 'center', fill: '#fff', stroke: '#000', sw: 7 });
    T(G.mode === 1 ? 'A D FIGHTER   W S LEVEL   PICK J K U I' : 'P1 A D + J K U I   P2 ← → + NUMPAD', 480, 978, 16, { align: 'center', fill: '#c9b6ff', stroke: '#000', sw: 4 });
  }

  function drawVS() {
    const u = Math.min(1, G.vsT / 24), e = 1 - Math.pow(1 - u, 3);
    ctx.fillStyle = '#07000f'; ctx.fillRect(0, 0, W, H);
    // diagonal slash backgrounds
    const sl = (col1, col2, left) => {
      ctx.save(); ctx.beginPath();
      if (left) { ctx.moveTo(0, 0); ctx.lineTo(560, 0); ctx.lineTo(400, H); ctx.lineTo(0, H); }
      else { ctx.moveTo(W, 0); ctx.lineTo(560 + 40, 0); ctx.lineTo(400 + 40, H); ctx.lineTo(W, H); }
      ctx.closePath(); const g = ctx.createLinearGradient(left ? 0 : W, 0, left ? 560 : 400, H); g.addColorStop(0, col1); g.addColorStop(1, col2);
      ctx.fillStyle = g; ctx.globalAlpha = 0.9; ctx.fill(); ctx.restore();
    };
    sl('#3a0a00', '#ff5a1f', true); sl('#00243a', '#18b7ff', false);
    const [c1, c2] = G.vs;
    for (let i = 0; i < 2; i++) {
      const ch = ROSTER[i ? c2 : c1], hue = (c1 === c2 && i) ? (ch.hue + 180) % 360 : ch.hue, spr = Rig.sprites(ch.char, hue);
      const w = 400, h = 480, x = i ? W - w - 40 + (1 - e) * 500 : 40 - (1 - e) * 500, y = 250;
      ctx.save();
      if (i) { ctx.translate(x + w, 0); ctx.scale(-1, 1); portrait(spr, 0, y, w, h); }
      else portrait(spr, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = i ? '#2de2e6' : '#ff8a1a'; ctx.lineWidth = 6; ctx.strokeRect(x, y, w, h);
      T(ch.name, x + (i ? w : 0), y + h + 64, 44, { align: i ? 'right' : 'left', fill: '#fff', stroke: '#000', sw: 9, glow: i ? '#2de2e6' : '#ff8a1a' });
      T(i ? (G.mode === 1 ? 'CPU' : 'PLAYER 2') : 'PLAYER 1', x + (i ? w : 0), y - 18, 26, { align: i ? 'right' : 'left', fill: i ? '#7fe9ff' : '#ffd45a', stroke: '#000', sw: 5 });
    }
    T('VS', 480, 560, 190, { font: FONT_TITLE, align: 'center', skew: 0.25, sx: 1 + (1 - e) * 2, fill: ['#fff', '#ffd23d', '#ff3d2d'], stroke: '#26002e', sw: 22, glow: '#ff5a1f', blur: 36 });
    if (G.mode === 1) T(diffNow().name + '  -  OPPONENT ' + G.ladder, 480, 130, 30, { align: 'center', fill: '#fff', stroke: '#000', sw: 7 });
    T(Stage.DEFS[G.stageIdx].name, 480, 950, 26, { align: 'center', fill: '#c9b6ff', stroke: '#000', sw: 6 });
  }

  function drawResult() {
    const F = G.fight;
    drawWorld(F, 0.55);
    const w = F.winner;
    const humanWon = G.mode === 1 ? (F.f[0].wins >= 2) : null;
    const title = G.mode === 1 ? (humanWon ? 'VICTORY!' : 'GAME OVER') : (F.f[0].wins >= 2 ? 'PLAYER 1 WINS' : 'PLAYER 2 WINS');
    T(title, 480, 400, 84, { font: FONT_TITLE, align: 'center', skew: 0.2, fill: humanWon === false ? ['#fff', '#ff6a6a', '#9b0000'] : ['#fff', '#ffd23d', '#ff7a1a'], stroke: '#26002e', sw: 16, glow: '#ff2bd6' });
    const winner = F.f[F.f[0].wins >= 2 ? 0 : 1];
    T(winner.name, 480, 490, 40, { align: 'center', fill: '#fff', stroke: '#000', sw: 8 });
    if (G.resT > 40 && ((G.frame >> 5) & 1)) T(G.mode === 1 && humanWon ? 'START: NEXT FIGHT' : 'PRESS START', 480, 640, 32, { align: 'center', fill: '#fff', stroke: '#000', sw: 7, glow: '#ff2bd6' });
  }

  function drawSoon() {
    const t = G.frame, fl = (t % 300 > 250 && ((t >> 2) & 1)) ? 0.4 : 1;           // occasional neon flicker
    ctx.drawImage(Stage.get(0), 0, 0);
    Stage.drawGrid(ctx, 0, t);
    ctx.fillStyle = 'rgba(8,0,20,0.5)'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = fl;
    Stage.panther(ctx, 480, 280, 210, '#d6ff2a', '#c8ff00', 3.4);
    T('CATZ FIGHT', 480, 480, 64, { font: FONT_TITLE, align: 'center', skew: 0.2, fill: ['#ffd23d', '#ff7a1a', '#ff2d8a'], stroke: '#1d0030', sw: 14, glow: '#ff2bd6', blur: 24 });
    T('COMING', 480, 640, 128, { font: FONT_TITLE, align: 'center', skew: 0.2, fill: ['#ff3d9a', '#c21cff', '#4d4dff'], stroke: '#1d0030', sw: 18, glow: '#7a2bff', blur: 30 });
    T('SOON', 480, 770, 128, { font: FONT_TITLE, align: 'center', skew: 0.2, fill: ['#fff', '#ffd23d', '#ff7a1a'], stroke: '#1d0030', sw: 18, glow: '#ff2bd6', blur: 30 });
    ctx.restore();
    T('NEW FIGHTERS ARE ON THE WAY', 480, 880, 24, { align: 'center', fill: '#7fe9ff', stroke: '#000', sw: 7 });
  }

  function drawBoot(msg) {
    ctx.fillStyle = '#07000f'; ctx.fillRect(0, 0, W, H);
    Stage.panther(ctx, 480, 440, 180, '#d6ff2a', '#c8ff00', 3.2);
    T(msg || 'LOADING', 480, 640, 34, { align: 'center', fill: '#fff' });
  }

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    switch (G.screen) {
      case 'boot': drawBoot(G.bootMsg); break;
      case 'soon': drawSoon(); break;
      case 'attract': drawAttract(); break;
      case 'select': drawSelect(); break;
      case 'vs': drawVS(); break;
      case 'fight': drawWorld(G.fight); drawFightOverlay(G.fight); break;
      case 'result': drawResult(); break;
    }
    if (G.paused) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H); T('PAUSED', 480, 500, 64, { font: FONT_TITLE, align: 'center', fill: '#fff', stroke: '#000', sw: 10 }); }
    ctx.restore();
  }

  // ============================================================================================================
  //  main loop + input glue
  // ============================================================================================================
  let last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    let dt = Math.min(100, now - last); last = now;
    if (G.screen === 'soon') G.frame++;
    if (G.screen === 'boot' || G.screen === 'soon' || G.paused) { render(); return; }
    G.acc += dt;
    let n = 0;
    while (G.acc >= 1000 / 60 && n < 5) {
      G.acc -= 1000 / 60; n++;
      G.frame++;
      if (G.slow) { G.slowAcc = (G.slowAcc || 0) + 0.4; if (G.slowAcc < 1) continue; G.slowAcc -= 1; }
      Input.frame();
      updateAll();
    }
    render();
  }

  function startOne() { if (G.soon) return; Sound.init(); startSelect(1); }
  function startTwo() { if (G.soon) return; Sound.init(); startSelect(2); }

  Input.onAnyPress((p, name, e) => {
    if (G.soon) return;
    Sound.init();
    if (e && e.code === 'KeyP' || e && e.code === 'Escape') { if (G.screen === 'fight') G.paused = !G.paused; return; }
    if (e && e.code === 'F2') { G.debug = !G.debug; return; }
    if (G.screen === 'attract') {
      if (name === 'Digit2' || name === 'Numpad2' && p < 0) startTwo();
      else if (name === 'Enter' || name === 'Space' || name === 'Digit1' || name === 'NumpadEnter' || p >= 0) startOne();
    } else if (G.screen === 'result' && G.resT > 40) {
      if (name === 'Enter' || name === 'Space' || p >= 0 && !/^[lrud]$/.test(name)) afterResult();
    } else if (G.screen === 'select') {
      if (name === 'Escape') startAttract();
    }
  });

  function afterResult() {
    const F = G.fight;
    if (G.mode === 1 && F.f[0].wins >= 2) {
      G.ladder++;
      const c2 = (() => { let c; do { c = randCh(); } while (c === F.f[0].ch && ROSTER.length > 1 && Math.random() < 0.7); return c; })();
      startVS(F.f[0].ch, c2);
    } else startAttract();
  }

  // tapping the screen (touch / mouse) acts as START on the menus
  function screenTap() {
    if (G.soon) return;
    Sound.init();
    if (G.screen === 'attract') startOne();
    else if (G.screen === 'result' && G.resT > 40) afterResult();
  }

  // ============================================================================================================
  //  boot
  // ============================================================================================================
  window.CATZ = { G, ROSTER, DIFFS, startOne, startTwo, startAttract, startVS, startFightFromVS, screenTap, newMatch, fighters: () => G.fight && G.fight.f, Poses, Rig };

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const p = Promise.all([document.fonts.load(`16px "Press Start 2P"`), document.fonts.load(`40px "Bungee"`)]).catch(() => {});
    return Promise.race([p, new Promise(r => setTimeout(r, 2500))]);
  }

  requestAnimationFrame(loop);
  G.bootMsg = 'LOADING...';
  Promise.all([Rig.load(), fontsReady()]).then(() => {
    for (const r of ROSTER) Rig.sprites(r.char, r.hue);
    const q = new URLSearchParams(location.search), go = q.get('go');
    try { const v = parseInt(localStorage.getItem('catz-diff'), 10); if (v >= 0 && v < DIFFS.length) G.diff = v; } catch (e) { /* ignore */ }
    if (q.get('diff') !== null && +q.get('diff') >= 0 && +q.get('diff') < DIFFS.length) G.diff = +q.get('diff');
    emit('catz:ready', { difficulties: DIFFS.map(x => x.name), difficulty: diffNow().name, comingSoon: G.soon });
    if (G.soon) { G.screen = 'soon'; document.body.classList.add('ready'); return; }
    startAttract();
    if (go === 'select') startSelect(+q.get('mode') || 1);
    if (go === 'fight' || go === 'vs') {
      G.mode = +q.get('mode') || 1; G.ladder = +q.get('ladder') || 1;
      startVS(+q.get('p1') || 0, q.get('p2') !== null ? +q.get('p2') : 3);
      if (go === 'fight') startFightFromVS();
    }
    document.body.classList.add('ready');
  }).catch(err => { G.bootMsg = 'LOAD ERROR'; console.error(err); });
})();
