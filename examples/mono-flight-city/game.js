(() => {
  'use strict';

  const W = 800;
  const H = 500;
  const FOV = 380;
  const NEAR = 10;
  const FAR = 700;
  const FORWARD = 142;
  const CHUNK = 120;
  const GRID = 70;
  /** World Z before obstacle rows (≈18 m on HUD). */
  const OBSTACLE_START_Z = 180;
  const ROW_STEP_Z = 72;
  /** Clear lane in ±X; pillars live beyond this. */
  const CORRIDOR_HALF = 88;
  const FACE_ALPHA = 0.7;

  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  let DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * DPR;
    cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.25;
    ctx.textBaseline = 'top';
  }
  resize();
  addEventListener('resize', resize);

  // --- Perlin noise (2D) ---
  const perm = new Uint8Array(512);
  (function initPerm() {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function grad(h, x, y) {
    const u = h & 1 ? x : y;
    const v = h & 1 ? y : x;
    return ((h & 2) === 0 ? u : -u) + ((h & 4) === 0 ? v : -v);
  }
  function noise2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[X + perm[Y]];
    const ab = perm[X + perm[Y + 1]];
    const ba = perm[X + 1 + perm[Y]];
    const bb = perm[X + 1 + perm[Y + 1]];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }
  function terrainHeight(x, z) {
    let h = 0;
    let amp = 1;
    let freq = 0.012;
    for (let o = 0; o < 4; o++) {
      h += noise2(x * freq, z * freq) * amp;
      amp *= 0.52;
      freq *= 2.05;
    }
    return h * 58 - 12;
  }

  function fract01(n) {
    return n - Math.floor(n);
  }
  function hash2(ix, iz) {
    const d =
      Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123 +
      Math.cos(ix * 269.5 - iz * 183.3) * 23421.631;
    return fract01(Math.abs(d));
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  /** @type {{ cx:number, cz:number, hw:number, hd:number, h:number, y0:number }[]} */
  let buildings = [];
  let chunkLo = -1;
  let chunkHi = -1;

  function genChunk(cz) {
    const z0 = cz * CHUNK;
    const z1 = z0 + CHUNK;
    const rowBegin = Math.ceil(z0 / ROW_STEP_Z);
    const rowEnd = Math.ceil(z1 / ROW_STEP_Z);
    for (let r = rowBegin; r < rowEnd; r++) {
      const gz = r * ROW_STEP_Z;
      if (gz < OBSTACLE_START_Z) continue;
      const rowKey = r;
      const rowRoll = hash2(rowKey, 41);
      if (rowRoll < 0.12) continue;

      const sporadic = hash2(rowKey, 99) < 0.32;
      if (sporadic) {
        const side = hash2(rowKey, 55) < 0.5 ? -1 : 1;
        const cx = side * (CORRIDOR_HALF + 32 + hash2(gz, 2) * 64);
        const hw = 18 + hash2(gz, 3) * 24;
        const hd = 22 + hash2(gz, 4) * 22;
        const h = 50 + hash2(gz, 5) * 88;
        const czc = gz + (hash2(gz, 1) - 0.5) * 18;
        buildings.push({ cx, cz: czc, hw, hd, h, y0: terrainHeight(cx, czc) });
        continue;
      }

      const gapX = noise2(rowKey * 0.37, 3.1) * 92;
      const gapHalf = 54 + hash2(rowKey, 12) * 20;
      const hd = 26 + hash2(rowKey, 18) * 28;
      const h = 78 + hash2(rowKey, 23) * 110;
      const czc = gz + (hash2(rowKey, 29) - 0.5) * 16;
      const edge = 238;
      const leftOuter = -edge;
      const leftInner = gapX - gapHalf;
      const rightInner = gapX + gapHalf;
      const rightOuter = edge;

      if (leftInner - leftOuter > 30) {
        const cx = (leftOuter + leftInner) * 0.5;
        const hw = (leftInner - leftOuter) * 0.5;
        buildings.push({ cx, cz: czc, hw, hd, h, y0: terrainHeight(cx, czc) });
      }
      if (rightOuter - rightInner > 30) {
        const cx = (rightInner + rightOuter) * 0.5;
        const hw = (rightOuter - rightInner) * 0.5;
        buildings.push({ cx, cz: czc, hw, hd, h, y0: terrainHeight(cx, czc) });
      }

      if (hash2(rowKey, 71) > 0.35) {
        const dodgeSide = hash2(rowKey, 73) < 0.5 ? -1 : 1;
        const hw = 10 + hash2(rowKey, 83) * 10;
        const offset = Math.min(gapHalf - hw - 8, 24 + hash2(rowKey, 79) * 30);
        const cx = Math.max(-78, Math.min(78, gapX + dodgeSide * offset));
        const hd2 = 20 + hash2(rowKey, 89) * 18;
        const h2 = 52 + hash2(rowKey, 97) * 76;
        buildings.push({ cx, cz: czc, hw, hd: hd2, h: h2, y0: terrainHeight(cx, czc) });
      }
    }
  }

  function ensureChunks(flightZ) {
    const needLo = Math.floor((flightZ - 80) / CHUNK) - 1;
    const needHi = Math.floor((flightZ + FAR + 120) / CHUNK) + 1;
    if (chunkLo === -1) {
      for (let c = needLo; c <= needHi; c++) genChunk(c);
      chunkLo = needLo;
      chunkHi = needHi;
      return;
    }
    while (chunkLo > needLo) {
      chunkLo--;
      genChunk(chunkLo);
    }
    while (chunkHi < needHi) {
      chunkHi++;
      genChunk(chunkHi);
    }
    const dropZ = flightZ - CHUNK * 3;
    buildings = buildings.filter((b) => b.cz > dropZ);
  }

  const cam = { x: 0, y: 0 };
  const ship = { x: 0, y: 18, vx: 0, vy: 0, hull: 100, r: 5, rz: 8 };
  let flightZ = 0;
  let paused = false;
  let started = false;
  let alive = true;
  let hitCd = 0;
  let speedMult = 1;
  const speedWave = { active: false, t: 0, dur: 0, next: rand(4, 8), boost: 0 };
  const keys = new Set();

  addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase()))
      e.preventDefault();
    if (!started && e.key !== 'Tab') {
      started = true;
      document.getElementById('title').classList.add('hidden');
    }
    if (e.key.toLowerCase() === 'p') paused = !paused;
    if (e.key.toLowerCase() === 'r') reset();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  function reset() {
    buildings = [];
    chunkLo = -1;
    chunkHi = -1;
    flightZ = 0;
    ship.x = 0;
    ship.y = 18;
    ship.vx = 0;
    ship.vy = 0;
    ship.hull = 100;
    alive = true;
    hitCd = 0;
    speedMult = 1;
    speedWave.active = false;
    speedWave.t = 0;
    speedWave.next = rand(4, 8);
    speedWave.boost = 0;
    paused = false;
    started = true;
    document.getElementById('title').classList.add('hidden');
    document.getElementById('dead').classList.add('hidden');
    ensureChunks(flightZ);
  }

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

  /** @type {{ z:number, lw:number, fn:()=>void }[]} */
  const drawQ = [];
  /** @type {{ z:number, fn:()=>void }[]} */
  const faceQ = [];

  function enqueue(z, lw, fn) {
    drawQ.push({ z, lw, fn });
  }

  function enqueueFace(z, fn) {
    faceQ.push({ z, fn });
  }

  function line3D(x1, y1, z1, x2, y2, z2, lw) {
    const seg = clipSeg([x1, y1, z1], [x2, y2, z2]);
    if (!seg) return;
    const pa = project(seg[0][0], seg[0][1], seg[0][2]);
    const pb = project(seg[1][0], seg[1][1], seg[1][2]);
    if (!pa || !pb) return;
    const zm = (seg[0][2] + seg[1][2]) * 0.5;
    enqueue(zm, lw, () => {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    });
  }

  function face3D(points) {
    const pts = [];
    let z = 0;
    for (const p of points) {
      if (p[2] <= NEAR) return;
      const q = project(p[0], p[1], p[2]);
      if (!q) return;
      pts.push(q);
      z += p[2];
    }
    enqueueFace(z / points.length, () => {
      ctx.globalAlpha = FACE_ALPHA;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  function flushFaces() {
    faceQ.sort((a, b) => b.z - a.z);
    for (const f of faceQ) f.fn();
    faceQ.length = 0;
    ctx.fillStyle = '#fff';
  }

  function flushDraw() {
    drawQ.sort((a, b) => b.z - a.z);
    for (const d of drawQ) {
      d.fn();
    }
    drawQ.length = 0;
    ctx.lineWidth = 1.25;
  }

  function drawTerrain(fz) {
    const zMin = fz + NEAR + 20;
    const zMax = fz + FAR;
    const xMin = -260;
    const xMax = 260;
    for (let gz = Math.floor(zMin / GRID) * GRID; gz < zMax; gz += GRID) {
      for (let gx = xMin; gx < xMax; gx += GRID) {
        const x1 = gx;
        const x2 = gx + GRID;
        const z1 = gz;
        const z2 = gz + GRID;
        const y11 = terrainHeight(x1, z1);
        const y21 = terrainHeight(x2, z1);
        const y12 = terrainHeight(x1, z2);
        const y22 = terrainHeight(x2, z2);
        const zr = (r) => r - fz;
        line3D(x1, y11, zr(z1), x2, y21, zr(z1), 1);
        line3D(x2, y21, zr(z1), x2, y22, zr(z2), 1);
        line3D(x2, y22, zr(z2), x1, y12, zr(z2), 1);
        line3D(x1, y12, zr(z2), x1, y11, zr(z1), 1);
      }
    }
  }

  function drawBuilding(b, fz) {
    const { cx, cz, hw, hd, h, y0 } = b;
    const z0 = cz - fz;
    if (z0 + hd < NEAR || z0 - hd > FAR) return;
    const x0 = cx - hw;
    const x1 = cx + hw;
    const yb = y0;
    const yt = y0 + h;
    const zb0 = z0 - hd;
    const zb1 = z0 + hd;

    const corners = [
      [x0, yb, zb0],
      [x1, yb, zb0],
      [x1, yb, zb1],
      [x0, yb, zb1],
      [x0, yt, zb0],
      [x1, yt, zb0],
      [x1, yt, zb1],
      [x0, yt, zb1],
    ];
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    for (const face of faces) {
      face3D(face.map((i) => corners[i]));
    }
    for (const [i, j] of edges) {
      const a = corners[i];
      const b2 = corners[j];
      line3D(a[0], a[1], a[2], b2[0], b2[1], b2[2], 1.35);
    }
  }

  function drawShip() {
    const x = W / 2;
    const y = H / 2 + 18;
    const bank = Math.max(-0.5, Math.min(0.5, ship.vx / 360));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bank);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(-24, 16);
    ctx.lineTo(0, 6);
    ctx.lineTo(24, 16);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, 18);
    ctx.stroke();
    ctx.restore();
  }

  function collide(dt) {
    const sz = flightZ;
    const sx = ship.x;
    const sy = ship.y;
    hitCd = Math.max(0, hitCd - dt);
    for (const b of buildings) {
      const dz = Math.abs(sz - b.cz);
      if (dz > b.hd + ship.rz) continue;
      if (Math.abs(sx - b.cx) > b.hw + ship.r) continue;
      const halfY = b.h * 0.5;
      const cy = b.y0 + halfY;
      if (Math.abs(sy - cy) > halfY + ship.r) continue;
      if (hitCd <= 0) {
        const dmg = 14 + dz * 0.02;
        ship.hull -= dmg;
        hitCd = 0.35;
        if (ship.hull <= 0) {
          ship.hull = 0;
          alive = false;
          document.getElementById('dead').classList.remove('hidden');
          document.getElementById('dead-dist').textContent = `Distance ${(flightZ * 0.1).toFixed(0)} m`;
        }
      }
    }
  }

  function updateHUD() {
    const el = document.getElementById('hull');
    const p = Math.max(0, Math.min(100, ship.hull));
    el.style.setProperty('--p', `${p}%`);
    const boost = speedMult > 1.08 ? `  SURGE x${speedMult.toFixed(1)}` : '';
    document.getElementById('dist').textContent = `${(flightZ * 0.1).toFixed(0)} m${boost}`;
  }

  function updateSpeedWave(dt) {
    if (speedWave.active) {
      speedWave.t += dt;
      const p = Math.min(1, speedWave.t / speedWave.dur);
      speedMult = 1 + Math.sin(p * Math.PI) * speedWave.boost;
      if (p >= 1) {
        speedWave.active = false;
        speedWave.next = rand(3.5, 8);
        speedMult = 1;
      }
      return;
    }

    speedWave.next -= dt;
    speedMult = 1;
    if (speedWave.next <= 0) {
      speedWave.active = true;
      speedWave.t = 0;
      speedWave.dur = rand(3.2, 5.8);
      speedWave.boost = rand(1, 1.55);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) * 0.001);
    last = now;

    if (started && alive && !paused) {
      let ax = 0;
      let ay = 0;
      if (keys.has('a') || keys.has('arrowleft')) ax -= 1;
      if (keys.has('d') || keys.has('arrowright')) ax += 1;
      if (keys.has('w') || keys.has('arrowup')) ay += 1;
      if (keys.has('s') || keys.has('arrowdown')) ay -= 1;
      const accel = 420;
      ship.vx += ax * accel * dt;
      ship.vy += ay * accel * dt;
      const damp = Math.pow(0.88, dt * 60);
      ship.vx *= damp;
      ship.vy *= damp;
      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;
      ship.x = Math.max(-210, Math.min(210, ship.x));
      const ymin = terrainHeight(ship.x, flightZ + 40) + 8;
      const ymax = 155;
      ship.y = Math.max(ymin, Math.min(ymax, ship.y));

      updateSpeedWave(dt);
      flightZ += FORWARD * speedMult * dt;
      ensureChunks(flightZ);
      collide(dt);
    }

    cam.x += (ship.x - cam.x) * Math.min(1, dt * 8);
    cam.y += (ship.y - cam.y) * Math.min(1, dt * 8);

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#000';

    drawTerrain(flightZ);
    flushDraw();
    for (const b of buildings) {
      if (b.cz > flightZ - 40 && b.cz < flightZ + FAR + 80) drawBuilding(b, flightZ);
    }
    flushFaces();
    flushDraw();
    drawShip();
    flushDraw();

    updateHUD();
    requestAnimationFrame(frame);
  }

  ensureChunks(0);
  requestAnimationFrame(frame);
})();
