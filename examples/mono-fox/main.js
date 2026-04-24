(() => {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================
  const W = 640, H = 480;
  const FOV = 360;
  const NEAR = 6;
  const FAR = 900;
  const GROUND_Y = -45;
  const CORRIDOR = 90;
  const BASE_SPEED = 130;

  const FG = '#f4f4f4';
  const DIM = '#7d7d7d';
  const FAINT = '#3a3a3a';
  const FAINTER = '#222';

  // ============================================================
  // CANVAS
  // ============================================================
  const cv = document.getElementById('screen');
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ============================================================
  // INPUT
  // ============================================================
  const keys = new Set();
  const pressed = new Set();
  let anyKeySeen = false;
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    pressed.add(k);
    anyKeySeen = true;
    SFX.unlock();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  const wasPressed = (k) => pressed.has(k);

  // ============================================================
  // MATH
  // ============================================================
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  function project(wx, wy, wz) {
    const x = wx - cam.x;
    const y = wy - cam.y;
    if (wz <= NEAR) return null;
    const s = FOV / wz;
    return [W / 2 + x * s, H / 2 - y * s, s];
  }

  function clipSeg(a, b) {
    if (a[2] >= NEAR && b[2] >= NEAR) return [a, b];
    if (a[2] < NEAR && b[2] < NEAR) return null;
    const t = (NEAR - a[2]) / (b[2] - a[2]);
    const c = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), NEAR];
    return a[2] < NEAR ? [c, b] : [a, c];
  }

  function line3D(x1, y1, z1, x2, y2, z2) {
    const seg = clipSeg([x1, y1, z1], [x2, y2, z2]);
    if (!seg) return;
    const pa = project(seg[0][0], seg[0][1], seg[0][2]);
    const pb = project(seg[1][0], seg[1][1], seg[1][2]);
    if (!pa || !pb) return;
    ctx.beginPath();
    ctx.moveTo(pa[0] | 0, pa[1] | 0);
    ctx.lineTo(pb[0] | 0, pb[1] | 0);
    ctx.stroke();
  }

  // ============================================================
  // AUDIO (WebAudio, no asset bytes)
  // ============================================================
  const SFX = (() => {
    let actx = null;
    const ensure = () => {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      return actx;
    };
    function unlock() {
      ensure();
      if (actx.state === 'suspended') actx.resume();
    }
    function tone(freq, dur, type = 'square', vol = 0.08, slideTo = null) {
      if (!actx) return;
      const t0 = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    function noise(dur, vol = 0.1, lp = 2000) {
      if (!actx) return;
      const t0 = actx.currentTime;
      const len = Math.max(1, Math.floor(actx.sampleRate * dur));
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const f = actx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      const g = actx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(actx.destination);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }
    return {
      unlock,
      laser: () => tone(880, 0.07, 'square', 0.04, 240),
      enemyFire: () => tone(180, 0.12, 'sawtooth', 0.05, 90),
      explode: () => { noise(0.35, 0.12, 1400); tone(70, 0.35, 'sawtooth', 0.08, 40); },
      ring: (n) => {
        const base = 540 + Math.min(8, n) * 40;
        tone(base, 0.07, 'triangle', 0.08);
        setTimeout(() => tone(base * 1.5, 0.1, 'triangle', 0.08), 55);
      },
      hit: () => { noise(0.18, 0.14, 700); tone(120, 0.22, 'sawtooth', 0.1, 60); },
      boost: () => { tone(440, 0.25, 'sine', 0.06, 1100); },
      bossWarn: () => { tone(60, 0.5, 'sawtooth', 0.12); setTimeout(() => tone(70, 0.5, 'sawtooth', 0.12), 250); },
      bossDie: () => { noise(0.8, 0.18, 1800); tone(50, 0.8, 'sawtooth', 0.12, 30); },
      tunnel: () => { tone(200, 0.4, 'sine', 0.06, 800); setTimeout(() => tone(300, 0.4, 'sine', 0.06, 1200), 80); },
    };
  })();

  // ============================================================
  // PERSISTENCE
  // ============================================================
  const HS_KEY = 'monofox.v1';
  function loadHS() {
    try {
      const raw = localStorage.getItem(HS_KEY);
      if (!raw) return { hi: 0, runs: [] };
      const v = JSON.parse(raw);
      return { hi: v.hi || 0, runs: Array.isArray(v.runs) ? v.runs.slice(0, 5) : [] };
    } catch { return { hi: 0, runs: [] }; }
  }
  function saveHS(scoreEntry) {
    const cur = loadHS();
    if (scoreEntry.score > cur.hi) cur.hi = scoreEntry.score;
    cur.runs.unshift(scoreEntry);
    cur.runs = cur.runs.slice(0, 5);
    try { localStorage.setItem(HS_KEY, JSON.stringify(cur)); } catch {}
    return cur;
  }
  let hs = loadHS();

  // ============================================================
  // WORLD STATE
  // ============================================================
  const cam = { x: 0, y: 0 };
  const player = {
    x: 0, y: 0, vx: 0, vy: 0,
    shield: 100, score: 0, kills: 0,
    cool: 0, hitFlash: 0, bank: 0, pitch: 0,
    alive: true,
  };

  let worldZ = 0;
  let speedMult = 1;
  let boostTimer = 0;
  let streak = 0;
  let bestStreak = 0;
  let shake = 0;
  let bossKills = 0;
  let boss = null;
  let bossWarnTimer = 0;
  let enemySpawnTimer = 0;

  // Difficulty ramps with distance flown. 1.0 → ~2.5.
  function difficulty() {
    return 1 + Math.min(1.5, worldZ / 6000);
  }
  function targetEnemyCount() {
    return Math.floor(2 + difficulty()); // 3 → 4
  }
  const TARGET_BUILDINGS = 28;

  const tunnel = { active: false, t: 0, until: 0, next: 28 };

  const rings = [];
  const buildings = [];
  const enemies = [];
  const pBullets = [];
  const eBullets = [];
  const debris = [];
  const ringFx = [];
  const floaters = [];
  const shootingStars = [];

  // 3 layers of stars: far/mid/near with parallax + twinkle
  const stars = (() => {
    const out = [];
    for (let i = 0; i < 130; i++) {
      out.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.55,
        layer: i % 3,
        twinkle: Math.random() * Math.PI * 2,
        ts: rand(2, 6),
      });
    }
    return out;
  })();

  function maybeShootingStar(dt) {
    if (Math.random() < dt * 0.18) {
      shootingStars.push({
        x: rand(0, W),
        y: rand(0, H * 0.4),
        vx: rand(-260, -160),
        vy: rand(40, 90),
        life: 0.6,
      });
    }
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const s = shootingStars[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0) shootingStars.splice(i, 1);
    }
  }

  // Distant mountain silhouette (polyline, sampled)
  const mountainPts = (() => {
    const pts = [];
    let h = 0;
    for (let i = 0; i <= 80; i++) {
      h += rand(-12, 12);
      h = clamp(h, -10, 90);
      pts.push({ a: i / 80, h });
    }
    return pts;
  })();

  // ============================================================
  // SPAWNING
  // ============================================================
  let nextRingZ = 100;
  function spawnRingAhead() {
    rings.push({
      x: rand(-CORRIDOR * 0.7, CORRIDOR * 0.7),
      y: rand(-15, 35),
      z: nextRingZ,
      r: rand(22, 30),
      hit: false,
      missed: false,
    });
    nextRingZ += rand(85, 140);
  }

  let leftBuild = 0, rightBuild = 0;
  function spawnBuildingAhead(z, forceSide) {
    const side = forceSide || (leftBuild <= rightBuild ? -1 : 1);
    if (side < 0) leftBuild++; else rightBuild++;
    buildings.push({
      side,
      x: side * rand(CORRIDOR + 10, CORRIDOR + 80),
      z,
      w: rand(14, 26),
      d: rand(14, 26),
      h: rand(28, 90),
    });
  }

  function spawnEnemy(opts = {}) {
    const fromRear = opts.fromRear ?? (Math.random() < 0.6);
    const diff = difficulty();
    const e = {
      hp: 2,
      r: 14,
      vx: rand(-18, 18),
      vy: rand(-7, 7),
      cool: rand(1.4, 2.6) / diff,
      phase: fromRear ? 'overtake' : 'engage',
      turnT: 0,
      tail: 0,
    };
    if (fromRear) {
      e.x = rand(-35, 35);
      e.y = rand(-12, 12);
      e.z = -20 - Math.random() * 30;
    } else {
      e.x = rand(-CORRIDOR * 0.7, CORRIDOR * 0.7);
      e.y = rand(-20, 30);
      e.z = opts.z ?? (FAR - rand(0, 200));
    }
    enemies.push(e);
  }

  function spawnBoss() {
    boss = {
      x: 0, y: 10, z: FAR - 100,
      vx: 30, vy: 6,
      hp: 35, maxHp: 35,
      cool: 1.5,
      pattern: 0,
      patternT: 0,
      r: 38,
      enterPhase: true,
    };
    bossWarnTimer = 2.5;
    SFX.bossWarn();
  }

  function reset() {
    rings.length = 0;
    buildings.length = 0;
    enemies.length = 0;
    pBullets.length = 0;
    eBullets.length = 0;
    debris.length = 0;
    ringFx.length = 0;
    floaters.length = 0;
    leftBuild = rightBuild = 0;
    nextRingZ = 100;
    Object.assign(player, {
      x: 0, y: 0, vx: 0, vy: 0,
      shield: 100, score: 0, kills: 0,
      cool: 0, hitFlash: 0, bank: 0, pitch: 0, alive: true,
    });
    streak = 0;
    bestStreak = 0;
    speedMult = 1;
    boostTimer = 0;
    shake = 0;
    bossKills = 0;
    boss = null;
    bossWarnTimer = 0;
    tunnel.active = false;
    tunnel.t = 0;
    tunnel.until = 0;
    tunnel.next = 28;
    worldZ = 0;

    for (let i = 0; i < 9; i++) spawnRingAhead();
    for (let z = 30; z < FAR; z += 35) {
      if (Math.random() < 0.7) spawnBuildingAhead(z, -1);
      if (Math.random() < 0.7) spawnBuildingAhead(z, 1);
    }
    for (let z = 200; z < FAR; z += rand(160, 240)) spawnEnemy(z);
  }

  // ============================================================
  // EFFECTS
  // ============================================================
  function spawnDebris(x, y, z, n = 14, spread = 80) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(20, spread);
      debris.push({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: rand(-40, 40),
        life: rand(0.4, 0.9),
      });
    }
  }

  function ringHit(r) {
    streak += 1;
    if (streak > bestStreak) bestStreak = streak;
    const points = 10 * Math.min(8, Math.max(1, streak));
    player.score += points;
    floaters.push({ x: r.x, y: r.y - 2, z: r.z, text: `+${points}`, age: 0, life: 0.9 });
    ringFx.push({ x: r.x, y: r.y, z: r.z, r: r.r, age: 0, max: 0.55 });
    ringFx.push({ x: r.x, y: r.y, z: r.z, r: r.r * 0.6, age: -0.08, max: 0.5 });
    SFX.ring(streak);
    if (streak > 0 && streak % 5 === 0) {
      boostTimer = 1.6;
      floaters.push({ x: r.x, y: r.y + 8, z: r.z, text: 'BOOST!', age: 0, life: 1.2 });
      SFX.boost();
    }
  }

  // ============================================================
  // UPDATE
  // ============================================================
  function update(dt) {
    const ax = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    const ay = (keys.has('arrowup') || keys.has('w') ? 1 : 0) - (keys.has('arrowdown') || keys.has('s') ? 1 : 0);

    if (player.alive) {
      player.vx = lerp(player.vx, ax * 90, 1 - Math.exp(-dt * 6));
      player.vy = lerp(player.vy, ay * 65, 1 - Math.exp(-dt * 6));
      player.x = clamp(player.x + player.vx * dt, -CORRIDOR, CORRIDOR);
      player.y = clamp(player.y + player.vy * dt, -25, 50);
    } else {
      player.vx *= 0.92;
      player.vy *= 0.92;
    }

    // Bank: rolling RIGHT when pressing right (clockwise from behind)
    player.bank = lerp(player.bank, ax * 0.55, 1 - Math.exp(-dt * 9));
    player.pitch = lerp(player.pitch, ay * 0.35, 1 - Math.exp(-dt * 9));

    cam.x = player.x;
    cam.y = player.y;

    // Speed boost decay
    if (boostTimer > 0) {
      boostTimer -= dt;
      speedMult = lerp(speedMult, 1.7, 1 - Math.exp(-dt * 8));
    } else {
      speedMult = lerp(speedMult, 1.0, 1 - Math.exp(-dt * 4));
    }
    const speed = BASE_SPEED * speedMult;

    // Shoot
    player.cool -= dt;
    if (keys.has(' ') && player.cool <= 0 && player.alive) {
      pBullets.push({ x: player.x - 9, y: player.y - 6, z: NEAR + 4, vz: 620 });
      pBullets.push({ x: player.x + 9, y: player.y - 6, z: NEAR + 4, vz: 620 });
      player.cool = 0.16;
      SFX.laser();
    }

    // Advance world toward camera
    const dz = speed * dt;
    worldZ += dz;
    for (const r of rings) r.z -= dz;
    for (const b of buildings) b.z -= dz;
    const diff = difficulty();
    for (const e of enemies) {
      e.tail += dt;
      if (e.phase === 'overtake') {
        // Catches up from behind camera, flies past, recedes ahead
        e.z += 240 * dt;
        e.x += Math.sin(e.tail * 4) * 30 * dt;
        e.y += Math.cos(e.tail * 3) * 12 * dt;
        if (e.z > rand(280, 360)) {
          e.phase = 'turn';
          e.turnT = 0.55;
        }
      } else if (e.phase === 'turn') {
        // Loop / flip in place, no shooting, brief invuln feel
        e.turnT -= dt;
        e.z += 12 * dt;
        if (e.turnT <= 0) {
          e.phase = 'engage';
          e.cool = rand(0.6, 1.2);
        }
      } else {
        // engage: drift toward camera, weave, shoot at player
        e.z -= dz + (20 + 18 * diff) * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (Math.abs(e.x) > CORRIDOR) e.vx *= -1;
        if (e.y > 45 || e.y < -25) e.vy *= -1;
        e.cool -= dt;
        if (e.cool <= 0 && e.z > 30 && e.z < 380 && player.alive) {
          const dxp = player.x - e.x, dyp = player.y - e.y;
          const dist = Math.hypot(dxp, dyp) + 0.001;
          const sp = 24 + 4 * diff;
          eBullets.push({
            x: e.x, y: e.y, z: e.z,
            vx: (dxp / dist) * sp,
            vy: (dyp / dist) * sp,
            vz: -200 * (0.85 + diff * 0.25),
          });
          e.cool = rand(1.2, 2.4) / diff;
          SFX.enemyFire();
        }
      }
    }

    // Boss update
    if (boss) {
      boss.z -= dz * 0.4 + 8 * dt;
      if (boss.z < 220) boss.z = 220;
      boss.patternT += dt;
      const tt = boss.patternT;
      boss.x = Math.sin(tt * 0.7) * (CORRIDOR * 0.6);
      boss.y = 5 + Math.sin(tt * 1.3) * 18;
      boss.cool -= dt;
      if (boss.cool <= 0 && player.alive) {
        for (let k = -1; k <= 1; k++) {
          const dxp = (player.x + k * 18) - boss.x;
          const dyp = player.y - boss.y;
          const dist = Math.hypot(dxp, dyp) + 0.001;
          eBullets.push({
            x: boss.x, y: boss.y, z: boss.z,
            vx: (dxp / dist) * 28,
            vy: (dyp / dist) * 28,
            vz: -240,
          });
        }
        boss.cool = rand(1.0, 1.6);
        SFX.enemyFire();
      }
    }

    if (bossWarnTimer > 0) bossWarnTimer -= dt;

    // Tunnel timing
    if (!tunnel.active) {
      tunnel.next -= dt;
      if (tunnel.next <= 0 && !boss) {
        tunnel.active = true;
        tunnel.until = 9;
        tunnel.t = 0;
        SFX.tunnel();
        // Pack rings during tunnel
        for (let i = 0; i < 6; i++) spawnRingAhead();
      }
    } else {
      tunnel.t += dt;
      tunnel.until -= dt;
      if (tunnel.until <= 0) {
        tunnel.active = false;
        tunnel.next = rand(22, 35);
      }
    }

    // Bullets
    for (const p of pBullets) p.z += p.vz * dt;
    for (const b of eBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
    }
    for (const d of debris) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.life -= dt;
    }
    for (const fx of ringFx) {
      fx.age += dt;
    }
    for (const f of floaters) {
      f.age += dt;
      f.y += dt * 18;
    }

    // Ring crossing detection (z-plane)
    for (const r of rings) {
      if (!r.hit && !r.missed && r.z <= NEAR + 1 && r.z > NEAR - 6) {
        const dx = player.x - r.x, dy = player.y - r.y;
        if (Math.hypot(dx, dy) < r.r * 0.95) {
          r.hit = true;
          ringHit(r);
        } else {
          r.missed = true;
          if (streak > 0) streak = 0;
        }
      }
    }

    // Player bullet vs enemy
    for (const p of pBullets) {
      if (p.z <= 0) continue;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (Math.abs(p.z - e.z) < 16) {
          if (Math.hypot(p.x - e.x, p.y - e.y) < e.r) {
            e.hp -= 1;
            p.z = -999;
            if (e.hp <= 0) {
              player.score += 25;
              player.kills += 1;
              bossKills += 1;
              spawnDebris(e.x, e.y, e.z);
              SFX.explode();
              shake = Math.max(shake, 4);
              if (bossKills >= 10 && !boss) {
                bossKills = 0;
                spawnBoss();
              }
            } else {
              shake = Math.max(shake, 1.5);
            }
            break;
          }
        }
      }
      // Player bullet vs boss
      if (boss && p.z > 0 && Math.abs(p.z - boss.z) < 24) {
        if (Math.hypot(p.x - boss.x, p.y - boss.y) < boss.r) {
          boss.hp -= 1;
          p.z = -999;
          spawnDebris(p.x, p.y, boss.z, 4, 30);
          shake = Math.max(shake, 2);
          if (boss.hp <= 0) {
            spawnDebris(boss.x, boss.y, boss.z, 60, 180);
            player.score += 500;
            player.kills += 1;
            shake = 14;
            SFX.bossDie();
            boss = null;
          }
        }
      }
    }

    // Enemy bullet vs player (generous tolerances; damage scales with difficulty)
    if (player.alive) {
      for (const b of eBullets) {
        if (b.z < NEAR + 8 && b.z > NEAR - 10) {
          if (Math.hypot(b.x - player.x, b.y - player.y) < 16) {
            b.z = -999;
            const dmg = 10 + 4 * diff;
            player.shield -= dmg;
            player.hitFlash = 0.45;
            shake = Math.max(shake, 14);
            SFX.hit();
            if (streak > 0) streak = Math.max(0, streak - 2);
            if (player.shield <= 0) {
              player.shield = 0;
              player.alive = false;
              spawnDebris(player.x, player.y, NEAR + 8, 50, 180);
              shake = 22;
              SFX.explode();
              hs = saveHS({ score: player.score, kills: player.kills, streak: bestStreak, t: Date.now() });
              setTimeout(() => updateDeadOverlay(), 600);
            }
          }
        }
      }
    }

    if (player.hitFlash > 0) player.hitFlash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 10);

    // Despawn dead/exited entities (no respawn here — handled by target-count below)
    for (let i = rings.length - 1; i >= 0; i--) {
      if (rings[i].z < NEAR - 8) {
        rings.splice(i, 1);
        spawnRingAhead();
      }
    }
    for (let i = buildings.length - 1; i >= 0; i--) {
      const b = buildings[i];
      if (b.z < NEAR - 30) {
        if (b.side < 0) leftBuild--; else rightBuild--;
        buildings.splice(i, 1);
      }
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      // Cull if killed, too far ahead (overtake-recede), or way behind camera
      if (e.hp <= 0 || e.z > FAR + 50 || e.z < NEAR - 10) {
        enemies.splice(i, 1);
      }
    }
    for (let i = pBullets.length - 1; i >= 0; i--) {
      if (pBullets[i].z > FAR || pBullets[i].z < 0) pBullets.splice(i, 1);
    }
    for (let i = eBullets.length - 1; i >= 0; i--) {
      if (eBullets[i].z < NEAR - 5 || eBullets[i].z > FAR) eBullets.splice(i, 1);
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      if (debris[i].life <= 0 || debris[i].z < NEAR - 5) debris.splice(i, 1);
    }
    for (let i = ringFx.length - 1; i >= 0; i--) {
      if (ringFx[i].age >= ringFx[i].max) ringFx.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      if (floaters[i].age >= floaters[i].life) floaters.splice(i, 1);
    }

    // Target-count maintenance: keeps the world populated regardless of phase
    if (!tunnel.active) {
      while (buildings.length < TARGET_BUILDINGS) {
        spawnBuildingAhead(FAR - rand(0, 200));
      }
    }
    if (!tunnel.active && !boss && player.alive) {
      enemySpawnTimer -= dt;
      const target = targetEnemyCount();
      if (enemies.length < target && enemySpawnTimer <= 0) {
        spawnEnemy();
        enemySpawnTimer = rand(1.0, 2.4) / diff;
      }
    } else {
      enemySpawnTimer = 0.5;
    }

    maybeShootingStar(dt);
  }

  // ============================================================
  // RENDER
  // ============================================================
  function drawSky(dt) {
    for (const s of stars) {
      const par = [0.15, 0.4, 0.8][s.layer];
      const sx = (s.x - cam.x * par + W * 2) % W;
      const sy = s.y - cam.y * par * 0.3;
      s.twinkle += dt * (1 + s.layer);
      const tw = (Math.sin(s.twinkle) + 1) * 0.5;
      const c = s.layer === 2 ? FG : (s.layer === 1 ? (tw > 0.3 ? FG : DIM) : (tw > 0.5 ? DIM : FAINT));
      ctx.fillStyle = c;
      ctx.fillRect(sx | 0, sy | 0, 1, 1);
    }
    ctx.strokeStyle = FG;
    for (const ss of shootingStars) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(ss.x - ss.vx * 0.04, ss.y - ss.vy * 0.04);
      ctx.stroke();
    }
  }

  function drawHorizon() {
    const horizonY = project(0, 0, 600);
    if (horizonY) {
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizonY[1]);
      ctx.lineTo(W, horizonY[1]);
      ctx.stroke();
    }
  }

  function drawMountains() {
    if (tunnel.active) return;
    ctx.strokeStyle = DIM;
    ctx.fillStyle = '#0a0a0a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const baseZ = 700;
    const span = 1400;
    let first = true;
    const parX = -cam.x * 0.4;
    for (const p of mountainPts) {
      const wx = (p.a - 0.5) * span + parX;
      const wy = GROUND_Y + p.h;
      const pr = project(wx, wy, baseZ);
      if (!pr) continue;
      if (first) { ctx.moveTo(pr[0], pr[1]); first = false; }
      else ctx.lineTo(pr[0], pr[1]);
    }
    const r = project(700, GROUND_Y, baseZ);
    const l = project(-700, GROUND_Y, baseZ);
    if (r && l) {
      ctx.lineTo(r[0], H);
      ctx.lineTo(l[0], H);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawGrid() {
    if (tunnel.active) return drawTunnel();
    ctx.lineWidth = 1;
    const GAP = 30;
    const offset = (worldZ % GAP);
    for (let i = 1; i < 28; i++) {
      const z = NEAR + i * GAP - offset;
      ctx.strokeStyle = z > 500 ? FAINTER : (z > 250 ? FAINT : (z > 100 ? DIM : FG));
      line3D(-260, GROUND_Y, z, 260, GROUND_Y, z);
    }
    for (let x = -240; x <= 240; x += 30) {
      const dist = Math.abs(x);
      ctx.strokeStyle = dist < 100 ? FG : (dist < 180 ? DIM : FAINT);
      line3D(x, GROUND_Y, NEAR, x, GROUND_Y, FAR);
    }
  }

  function drawTunnel() {
    ctx.lineWidth = 1;
    const GAP = 22;
    const offset = (worldZ % GAP);
    const TW = 130;
    const TH = 80;
    const TY0 = GROUND_Y;
    const TY1 = GROUND_Y + TH * 1.6;
    for (let i = 1; i < 32; i++) {
      const z = NEAR + i * GAP - offset;
      ctx.strokeStyle = z > 500 ? FAINTER : (z > 250 ? FAINT : (z > 100 ? DIM : FG));
      line3D(-TW, TY0, z, TW, TY0, z);
      line3D(-TW, TY1, z, TW, TY1, z);
      line3D(-TW, TY0, z, -TW, TY1, z);
      line3D(TW, TY0, z, TW, TY1, z);
    }
    for (let x = -TW; x <= TW; x += 26) {
      const dist = Math.abs(x);
      ctx.strokeStyle = dist < 60 ? FG : (dist < 110 ? DIM : FAINT);
      line3D(x, TY0, NEAR, x, TY0, FAR);
      line3D(x, TY1, NEAR, x, TY1, FAR);
    }
  }

  function drawBuilding(b) {
    if (tunnel.active) return;
    ctx.strokeStyle = b.z > 500 ? FAINT : (b.z > 250 ? DIM : FG);
    ctx.lineWidth = 1;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2;
    const y0 = GROUND_Y, y1 = GROUND_Y + b.h;
    const z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    line3D(x0, y0, z0, x0, y1, z0);
    line3D(x1, y0, z0, x1, y1, z0);
    line3D(x0, y0, z1, x0, y1, z1);
    line3D(x1, y0, z1, x1, y1, z1);
    line3D(x0, y1, z0, x1, y1, z0);
    line3D(x1, y1, z0, x1, y1, z1);
    line3D(x1, y1, z1, x0, y1, z1);
    line3D(x0, y1, z1, x0, y1, z0);
    line3D(x0, y0, z0, x1, y0, z0);
  }

  function drawRing(r) {
    if (r.z <= NEAR) return;
    const N = 22;
    ctx.strokeStyle = r.hit ? FAINT : (r.missed ? DIM : FG);
    ctx.lineWidth = r.hit || r.missed ? 1 : 2;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const px = r.x + Math.cos(a) * r.r;
      const py = r.y + Math.sin(a) * r.r;
      const p = project(px, py, r.z);
      if (!p) continue;
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    if (!r.hit && !r.missed) {
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 1;
      const inner = r.r * 0.7;
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const px = r.x + Math.cos(a) * inner;
        const py = r.y + Math.sin(a) * inner;
        const p = project(px, py, r.z);
        if (!p) continue;
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
  }

  function drawRingFx() {
    for (const fx of ringFx) {
      if (fx.age < 0) continue;
      const t = fx.age / fx.max;
      const radius = fx.r * (1 + t * 1.4);
      ctx.strokeStyle = t < 0.5 ? FG : DIM;
      ctx.lineWidth = 2 * (1 - t);
      ctx.beginPath();
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const px = fx.x + Math.cos(a) * radius;
        const py = fx.y + Math.sin(a) * radius;
        const p = project(px, py, fx.z);
        if (!p) continue;
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
  }

  function drawEnemy(e) {
    if (e.z <= NEAR) return;
    const c = project(e.x, e.y, e.z);
    if (!c) return;
    const s = c[2] * e.r;

    // Afterburner trail when overtaking (entity moving fwd faster than camera)
    if (e.phase === 'overtake') {
      const back = project(e.x, e.y, e.z - 22);
      if (back) {
        ctx.strokeStyle = FG;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(back[0], back[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.stroke();
        ctx.strokeStyle = DIM;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const flick = 4 + Math.random() * 6;
        ctx.moveTo(back[0] - flick, back[1]);
        ctx.lineTo(back[0] + flick, back[1]);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(c[0], c[1]);
    if (e.phase === 'turn') ctx.rotate(e.tail * 9);
    ctx.strokeStyle = e.z > 400 ? DIM : FG;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, 0);
    ctx.lineTo(s * 0.6, 0);
    ctx.moveTo(0, -s * 0.6);
    ctx.lineTo(0, s * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoss() {
    if (!boss) return;
    if (boss.z <= NEAR) return;
    const c = project(boss.x, boss.y, boss.z);
    if (!c) return;
    const s = c[2] * boss.r;
    ctx.strokeStyle = FG;
    ctx.lineWidth = 2;
    // outer hex
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = c[0] + Math.cos(a) * s;
      const y = c[1] + Math.sin(a) * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    // inner diamond
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c[0], c[1] - s * 0.6);
    ctx.lineTo(c[0] + s * 0.6, c[1]);
    ctx.lineTo(c[0], c[1] + s * 0.6);
    ctx.lineTo(c[0] - s * 0.6, c[1]);
    ctx.closePath();
    ctx.stroke();
    // core
    ctx.fillStyle = FG;
    ctx.beginPath();
    ctx.arc(c[0], c[1], s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    // crosshatch arms
    ctx.lineWidth = 1;
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(c[0] - s, c[1]);
    ctx.lineTo(c[0] + s, c[1]);
    ctx.moveTo(c[0], c[1] - s);
    ctx.lineTo(c[0], c[1] + s);
    ctx.stroke();

    // boss HP bar (top of screen)
    const bw = W * 0.5;
    const bx = (W - bw) / 2;
    const by = 50;
    ctx.strokeStyle = FG;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, 6);
    ctx.fillStyle = FG;
    ctx.fillRect(bx + 2, by + 2, (bw - 4) * (boss.hp / boss.maxHp), 2);
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HOSTILE', W / 2, by - 4);
    ctx.textAlign = 'left';
  }

  function drawBullet(b, isPlayer) {
    if (b.z <= NEAR) return;
    const tail = isPlayer ? 18 : 8;
    const front = project(b.x, b.y, b.z);
    if (!front) return;
    const back = project(b.x - (isPlayer ? 0 : b.vx * 0.04),
                         b.y - (isPlayer ? 0 : b.vy * 0.04),
                         b.z - tail);
    ctx.strokeStyle = FG;
    ctx.lineWidth = isPlayer ? 2 : 1.5;
    if (back) {
      ctx.beginPath();
      ctx.moveTo(back[0], back[1]);
      ctx.lineTo(front[0], front[1]);
      ctx.stroke();
    }
    ctx.fillStyle = FG;
    const r = Math.max(1, front[2] * (isPlayer ? 1.4 : 1.0));
    ctx.beginPath();
    ctx.arc(front[0], front[1], r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDebris() {
    ctx.fillStyle = FG;
    for (const d of debris) {
      const p = project(d.x, d.y, d.z);
      if (!p) continue;
      const s = Math.max(1, p[2] * 1.5);
      ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
    }
  }

  function drawFloaters() {
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const f of floaters) {
      const p = project(f.x, f.y, f.z);
      if (!p) continue;
      const t = f.age / f.life;
      ctx.fillStyle = t < 0.7 ? FG : DIM;
      ctx.fillText(f.text, p[0], p[1] - t * 12);
    }
    ctx.textAlign = 'left';
  }

  function drawShip() {
    if (!player.alive) return;
    const cx = W / 2;
    const cy = H - 70;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(player.bank);
    ctx.translate(0, player.pitch * 8);
    ctx.strokeStyle = FG;
    ctx.fillStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(14, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 8);
    ctx.lineTo(-30, 14);
    ctx.lineTo(-22, 16);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, 8);
    ctx.lineTo(30, 14);
    ctx.lineTo(22, 16);
    ctx.lineTo(10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = boostTimer > 0 ? FG : DIM;
    ctx.lineWidth = boostTimer > 0 ? 2 : 1;
    ctx.beginPath();
    const fl = boostTimer > 0 ? 10 : 3;
    ctx.moveTo(-3, 8);
    ctx.lineTo(-3, 14 + Math.random() * fl);
    ctx.moveTo(3, 8);
    ctx.lineTo(3, 14 + Math.random() * fl);
    ctx.stroke();
    ctx.restore();
  }

  function drawReticle() {
    const cx = W / 2;
    const cy = H / 2 + 10;
    ctx.strokeStyle = FG;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 10);
    ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy + 14);
    ctx.stroke();
  }

  function drawHUD() {
    ctx.fillStyle = FG;
    ctx.font = '12px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`SCORE ${String(player.score).padStart(5, '0')}`, 12, 10);
    ctx.fillText(`KILLS ${String(player.kills).padStart(2, '0')}`, 12, 26);

    if (streak > 0) {
      ctx.fillStyle = streak >= 5 ? FG : DIM;
      ctx.fillText(`STREAK x${streak}`, 12, 42);
    }

    // Shield bar
    const bw = 140, bh = 8;
    const bx = 12, by = H - 22;
    ctx.strokeStyle = FG;
    ctx.fillStyle = FG;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    const pct = player.shield / 100;
    ctx.fillRect(bx + 2, by + 2, (bw - 4) * pct, bh - 4);
    ctx.fillText(`SHIELD ${Math.floor(player.shield)}`, bx, by - 14);

    // Top right
    ctx.textAlign = 'right';
    ctx.fillText(`HI ${String(hs.hi).padStart(5, '0')}`, W - 12, 10);
    ctx.fillText(`SPD ${String(Math.floor(BASE_SPEED * speedMult * 7)).padStart(4, '0')}`, W - 12, 26);
    ctx.fillText(`Z ${Math.floor(worldZ)}`, W - 12, 42);

    // Boost indicator (bottom right)
    if (boostTimer > 0) {
      ctx.fillStyle = FG;
      ctx.fillText('BOOST', W - 12, H - 36);
      ctx.strokeStyle = FG;
      ctx.strokeRect(W - 92 + 0.5, H - 22 + 0.5, 80, 8);
      ctx.fillRect(W - 90, H - 20, 76 * (boostTimer / 1.6), 4);
    }
    ctx.textAlign = 'left';

    // Boss warn
    if (bossWarnTimer > 0) {
      const t = bossWarnTimer;
      if ((t * 4) % 1 < 0.5) {
        ctx.fillStyle = FG;
        ctx.font = '20px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!! HOSTILE INBOUND !!', W / 2, H / 2 - 50);
        ctx.textAlign = 'left';
      }
    }

    // Tunnel banner
    if (tunnel.active && tunnel.t < 1.5) {
      const a = 1 - tunnel.t / 1.5;
      ctx.fillStyle = `rgba(244,244,244,${a})`;
      ctx.font = '16px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('// TUNNEL //', W / 2, H / 2 - 40);
      ctx.textAlign = 'left';
    }

    // Hit flash
    if (player.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${player.hitFlash * 0.45})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function updateDeadOverlay() {
    const el = document.getElementById('dead');
    const stats = document.getElementById('dead-stats');
    if (stats) {
      const lines = [];
      lines.push(`<div class="row"><span>SCORE</span><span>${player.score}</span></div>`);
      lines.push(`<div class="row"><span>KILLS</span><span>${player.kills}</span></div>`);
      lines.push(`<div class="row"><span>BEST STREAK</span><span>${bestStreak}</span></div>`);
      lines.push(`<div class="row"><span>HIGH SCORE</span><span>${hs.hi}</span></div>`);
      if (hs.runs.length) {
        lines.push(`<div class="hist">RECENT</div>`);
        for (const r of hs.runs.slice(0, 5)) {
          lines.push(`<div class="row sub"><span>${r.score}</span><span>${r.kills}k · x${r.streak}</span></div>`);
        }
      }
      stats.innerHTML = lines.join('');
    }
    el.classList.remove('hidden');
  }

  // ============================================================
  // MAIN LOOP
  // ============================================================
  let last = performance.now();
  let state = 'BOOT';
  const bootOverlay = document.getElementById('boot');
  const deadOverlay = document.getElementById('dead');

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state === 'BOOT') {
      if (anyKeySeen) {
        bootOverlay.classList.add('hidden');
        reset();
        state = 'PLAY';
      }
    } else if (state === 'PLAY') {
      if (wasPressed('p')) state = 'PAUSE';
      if (player.alive) {
        update(dt);
      } else {
        update(dt);
        if (wasPressed('r')) {
          deadOverlay.classList.add('hidden');
          reset();
          state = 'PLAY';
        }
      }
    } else if (state === 'PAUSE') {
      if (wasPressed('p')) state = 'PLAY';
    }

    // Apply screen shake via canvas transform
    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(-20, -20, W + 40, H + 40);

    drawSky(dt);
    drawHorizon();
    drawMountains();
    drawGrid();

    // Sort objects far→near for correct overlap
    const sorted = [
      ...buildings.map(b => ({ k: 'b', z: b.z, o: b })),
      ...enemies.map(e => ({ k: 'e', z: e.z, o: e })),
      ...rings.map(r => ({ k: 'r', z: r.z, o: r })),
    ].sort((a, b) => b.z - a.z);
    for (const it of sorted) {
      if (it.k === 'b') drawBuilding(it.o);
      else if (it.k === 'e') drawEnemy(it.o);
      else drawRing(it.o);
    }

    drawBoss();
    drawRingFx();

    for (const b of eBullets) drawBullet(b, false);
    for (const b of pBullets) drawBullet(b, true);
    drawDebris();
    drawFloaters();

    drawReticle();
    drawShip();
    drawHUD();

    if (state === 'PAUSE') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = FG;
      ctx.font = '24px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2 - 10);
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('press P to resume', W / 2, H / 2 + 14);
      ctx.textAlign = 'left';
    }

    ctx.restore();

    pressed.clear();
    requestAnimationFrame(frame);
  }

  // Display HI on boot screen
  const bootHi = document.getElementById('boot-hi');
  if (bootHi) bootHi.textContent = `HI ${hs.hi}`;

  requestAnimationFrame((t) => { last = t; frame(t); });
})();
