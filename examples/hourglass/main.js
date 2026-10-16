// Hourglass — WebGL falling-sand clock.
// The glass is a baked mask. Each frame a fragment shader moves grains on a
// ping-pong texture (straight down, then diagonal slides) so piles and the
// neck stream are simulated on the GPU, not on the CPU.

(() => {
  const SIM_W = 101;
  const SIM_H = 221;
  const CX = (SIM_W - 1) / 2;
  const CY = (SIM_H - 1) / 2;
  const HALF = SIM_H * 0.47;
  const MAX_R = SIM_W * 0.4;
  const SUBSTEPS = 5;

  const canvas = document.getElementById('glass');
  const fallback = document.getElementById('fallback');
  const timeEl = document.getElementById('time');
  const durationButtons = [...document.querySelectorAll('.durations button')];

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FLIP_MS = reduceMotion ? 0 : 780;

  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });

  if (!gl) {
    canvas.hidden = true;
    fallback.hidden = false;
    timeEl.textContent = '–:––';
    durationButtons.forEach((btn) => {
      btn.disabled = true;
    });
    return;
  }

  function glassRadius(y, mask) {
    const a = Math.abs((y - CY) / HALF);
    if (a > 1) return 0;
    const u = Math.min(1, a / 0.92);
    const shape = Math.pow(Math.sin(u * Math.PI * 0.5), 0.72);
    let r = 2.35 + (MAX_R - 2.35) * shape;
    if (a > 0.9) {
      const t = (a - 0.9) / 0.1;
      r *= 1 - t * t;
    }
    // One grain wide at the neck so the pour rate is one grain per open step.
    if (mask && Math.abs(y - CY) < 0.5) return 1.15;
    return r;
  }

  function interior(x, y) {
    return Math.abs(x - CX) <= glassRadius(y, true) - 0.5;
  }

  function hash01(x, y) {
    let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function buildState() {
    const data = new Uint8Array(SIM_W * SIM_H * 4);
    const floorY = new Int16Array(SIM_W);
    floorY.fill(-1);
    for (let x = 0; x < SIM_W; x++) {
      for (let y = 0; y < CY; y++) {
        if (interior(x, y)) {
          floorY[x] = y;
          break;
        }
      }
    }
    // Upper bulb: the timed load, with a shallow funnel. Lower bulb: a small cone.
    const topLimit = CY + HALF * 0.62;
    for (let y = 0; y < SIM_H; y++) {
      for (let x = 0; x < SIM_W; x++) {
        const i = (y * SIM_W + x) * 4;
        if (!interior(x, y)) {
          data[i] = 255;
          data[i + 3] = 255;
          continue;
        }
        const dx = Math.abs(x - CX);
        let sand = false;
        if (y > CY && y < topLimit) {
          const dip = Math.max(0, 16 - dx) * 0.4;
          if (y <= topLimit - dip) sand = true;
        } else if (y < CY && floorY[x] >= 0) {
          const height = 20 - dx * 0.55;
          if (height > 1 && y <= floorY[x] + height && y < CY - 4) sand = true;
        }
        if (sand && !(x === CX && y === CY)) {
          data[i] = 128;
          data[i + 1] = 100 + Math.floor(hash01(x, y) * 140);
          data[i + 3] = 255;
        } else {
          data[i + 3] = 255;
        }
      }
    }
    return data;
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log || 'shader compile failed');
    }
    return shader;
  }

  function program(vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'program link failed');
    }
    return prog;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const SIM = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uSim;
uniform vec2 uCenter;
uniform vec2 uDir;
uniform vec2 uSlide;
uniform float uMode;
uniform float uPhase;
uniform float uGate;
uniform float uNeckY;

vec4 at(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uSim.x || p.y >= uSim.y) {
    return vec4(1.0, 0.0, 0.0, 1.0);
  }
  return texture2D(uState, (p + 0.5) / uSim);
}
bool isSand(vec4 s) { return s.r > 0.25 && s.r < 0.75; }
bool isEmpty(vec4 s) { return s.r < 0.25; }

bool neckBlocks(vec2 from, vec2 to) {
  if (abs(to.y - uNeckY) > 0.5) return false;
  if (abs(from.y - to.y) < 0.5) return false;
  if (abs(to.x - uCenter.x) > 0.5) return false;
  return uGate < 0.5;
}

bool canSlide(vec2 src, vec2 dest) {
  vec4 s = at(src);
  vec4 d = at(dest);
  if (!isSand(s) || !isEmpty(d)) return false;
  if (mod(floor(src.x), 2.0) != uPhase) return false;
  if (neckBlocks(src, dest)) return false;
  vec2 fwd = src + uDir;
  bool forwardBlocked = !isEmpty(at(fwd)) || neckBlocks(src, fwd);
  if (!forwardBlocked) return false;
  vec2 side = vec2(dest.x, src.y);
  vec2 below = vec2(src.x, dest.y);
  if (at(side).r > 0.75 && at(below).r > 0.75) return false;
  return true;
}

void main() {
  vec2 p = floor(gl_FragCoord.xy);
  vec4 self = at(p);
  if (self.r > 0.75) {
    gl_FragColor = self;
    return;
  }

  if (uMode < 0.5) {
    float axis = abs(uDir.x) > 0.5 ? p.x : p.y;
    float sgn = abs(uDir.x) > 0.5 ? uDir.x : uDir.y;
    bool upstream = sgn > 0.0 ? mod(axis, 2.0) == uPhase : mod(axis, 2.0) != uPhase;
    if (upstream) {
      vec2 dest = p + uDir;
      if (isSand(self) && isEmpty(at(dest)) && !neckBlocks(p, dest)) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      } else {
        gl_FragColor = self;
      }
    } else {
      vec2 src = p - uDir;
      vec4 s = at(src);
      if (isEmpty(self) && isSand(s) && !neckBlocks(src, p)) {
        gl_FragColor = s;
      } else {
        gl_FragColor = self;
      }
    }
    return;
  }

  vec2 incoming = p - uSlide;
  bool arrives = canSlide(incoming, p);
  bool leaves = canSlide(p, p + uSlide);
  if (arrives) gl_FragColor = at(incoming);
  else if (leaves) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  else gl_FragColor = self;
}`;

  const DRAW = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uSim;
uniform vec2 uCenter;
uniform vec2 uResolution;
uniform float uAngle;
uniform float uHalf;
uniform float uMaxR;

vec4 at(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uSim.x || p.y >= uSim.y) {
    return vec4(1.0, 0.0, 0.0, 1.0);
  }
  return texture2D(uState, (floor(p) + 0.5) / uSim);
}

float glassRadius(float y) {
  float a = abs((y - uCenter.y) / uHalf);
  if (a > 1.0) return 0.0;
  float u = min(1.0, a / 0.92);
  float shape = pow(sin(u * 3.14159265 * 0.5), 0.72);
  float r = 2.35 + (uMaxR - 2.35) * shape;
  if (a > 0.9) {
    float t = (a - 0.9) / 0.1;
    r *= 1.0 - t * t;
  }
  return r;
}

float sdf(vec2 sim) {
  float a = abs((sim.y - uCenter.y) / uHalf);
  float radial = glassRadius(sim.y) - abs(sim.x - uCenter.x);
  if (a > 1.0) return -(a - 1.0) * uHalf - abs(sim.x - uCenter.x);
  return radial;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float roundBox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void over(inout vec3 c, inout float a, vec3 sc, float sa) {
  c = sc * sa + c * (1.0 - sa);
  a = sa + a * (1.0 - sa);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float scale = min(uResolution.x, uResolution.y) * 0.82 / uSim.y;
  vec2 local = frag - uResolution * 0.5;
  float co = cos(uAngle);
  float si = sin(uAngle);
  vec2 obj = vec2(co * local.x - si * local.y, si * local.x + co * local.y);
  vec2 sim = obj / scale + uCenter;
  float sd = sdf(sim);

  vec3 col = vec3(0.0);
  float alpha = 0.0;

  vec2 shadowAt = vec2(uResolution.x * 0.5, uResolution.y * 0.5 - uSim.y * scale * 0.42);
  vec2 sh = (frag - shadowAt) / (scale * vec2(42.0, 11.0));
  float shadow = exp(-dot(sh, sh)) * 0.55;
  over(col, alpha, vec3(0.02, 0.012, 0.008), shadow);

  float inside = smoothstep(0.2, 1.4, sd);
  float ny = clamp((sim.y - uCenter.y) / uHalf, -1.0, 1.0);
  vec3 cavity = mix(vec3(0.07, 0.055, 0.045), vec3(0.2, 0.15, 0.11), inside);
  cavity *= 0.92 + 0.08 * ny;
  float edgeDark = smoothstep(8.0, 0.8, sd);
  cavity *= mix(1.0, 0.72, edgeDark);
  if (sd > -1.0) over(col, alpha, cavity, smoothstep(-1.0, 1.6, sd) * 0.72);

  vec2 cell = floor(sim);
  vec4 st = at(cell);
  if (st.r > 0.25 && st.r < 0.75 && sd > 0.15) {
    float shade = st.g;
    vec3 deep = vec3(0.36, 0.16, 0.05);
    vec3 midc = vec3(0.86, 0.5, 0.16);
    vec3 hi = vec3(0.98, 0.86, 0.58);
    vec3 sand = mix(deep, midc, smoothstep(0.15, 0.62, shade));
    sand = mix(sand, hi, smoothstep(0.62, 1.0, shade));
    vec2 gv = sim - cell - 0.5;
    float j = hash(cell);
    gv -= (vec2(j, hash(cell + 19.0)) - 0.5) * 0.18;
    float d = length(gv);
    float body = smoothstep(0.58, 0.22, d);
    float spec = smoothstep(0.42, 0.0, length(gv - vec2(-0.14, 0.16)));
    sand *= 0.62 + 0.5 * spec;
    sand = mix(sand * 0.55, sand, body);
    float grainA = smoothstep(0.56, 0.3, d);
    over(col, alpha, sand, grainA);
  }

  float rim = smoothstep(3.2, 0.15, abs(sd)) * smoothstep(-8.0, -0.4, sd);
  vec2 g = vec2(sdf(sim + vec2(0.8, 0.0)) - sdf(sim - vec2(0.8, 0.0)),
                sdf(sim + vec2(0.0, 0.8)) - sdf(sim - vec2(0.0, 0.8)));
  float gln = length(g);
  vec2 n = gln > 1e-4 ? g / gln : vec2(0.0, 1.0);
  float light = clamp(dot(n, normalize(vec2(-0.45, 0.9))), 0.0, 1.0);
  vec3 glass = mix(vec3(0.55, 0.62, 0.66), vec3(0.96, 0.97, 0.95), light);
  glass = mix(glass, vec3(0.93, 0.78, 0.48), 0.18);
  float rimA = rim * (0.28 + 0.55 * light);
  float core = smoothstep(1.5, 0.0, abs(sd));
  rimA = max(rimA, core * 0.22);
  over(col, alpha, glass, rimA * smoothstep(-6.0, 0.5, sd));

  float yTop = uCenter.y + uHalf * 0.985;
  float yBot = uCenter.y - uHalf * 0.985;
  float capT = roundBox(sim, vec2(uCenter.x, yTop), vec2(13.0, 2.4), 3.4);
  float capB = roundBox(sim, vec2(uCenter.x, yBot), vec2(13.0, 2.4), 3.4);
  float cap = min(capT, capB);
  float capA = smoothstep(1.3, -0.2, cap);
  float localY = capT < capB ? (sim.y - yTop) : (yBot - sim.y);
  float sheen = smoothstep(5.0, -6.0, sim.x - uCenter.x);
  vec3 brass = mix(vec3(0.34, 0.18, 0.06), vec3(0.75, 0.54, 0.24), 0.45 + 0.55 * smoothstep(-3.0, 3.0, localY));
  brass = mix(brass, vec3(0.96, 0.86, 0.62), sheen * 0.38);
  over(col, alpha, brass, capA);

  gl_FragColor = vec4(col, alpha);
}`;

  let simProg;
  let drawProg;
  try {
    simProg = program(VERT, SIM);
    drawProg = program(VERT, DRAW);
  } catch (err) {
    console.error(err);
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = 'WebGL failed to start, so the sand simulation can’t run.';
    timeEl.textContent = '–:––';
    return;
  }

  const simLoc = {
    uState: gl.getUniformLocation(simProg, 'uState'),
    uSim: gl.getUniformLocation(simProg, 'uSim'),
    uCenter: gl.getUniformLocation(simProg, 'uCenter'),
    uDir: gl.getUniformLocation(simProg, 'uDir'),
    uSlide: gl.getUniformLocation(simProg, 'uSlide'),
    uMode: gl.getUniformLocation(simProg, 'uMode'),
    uPhase: gl.getUniformLocation(simProg, 'uPhase'),
    uGate: gl.getUniformLocation(simProg, 'uGate'),
    uNeckY: gl.getUniformLocation(simProg, 'uNeckY'),
  };
  const drawLoc = {
    uState: gl.getUniformLocation(drawProg, 'uState'),
    uSim: gl.getUniformLocation(drawProg, 'uSim'),
    uCenter: gl.getUniformLocation(drawProg, 'uCenter'),
    uResolution: gl.getUniformLocation(drawProg, 'uResolution'),
    uAngle: gl.getUniformLocation(drawProg, 'uAngle'),
    uHalf: gl.getUniformLocation(drawProg, 'uHalf'),
    uMaxR: gl.getUniformLocation(drawProg, 'uMaxR'),
  };

  function makeTarget(data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM_W, SIM_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('framebuffer incomplete');
    }
    return { tex, fbo };
  }

  const targets = [makeTarget(null), makeTarget(null)];
  let read = 0;
  const pixels = new Uint8Array(SIM_W * SIM_H * 4);
  let initial = null;
  let angle = 0;

  function upload(data) {
    gl.bindTexture(gl.TEXTURE_2D, targets[0].tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM_W, SIM_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    read = 0;
  }

  function bindSim(mode, dir, slide, phase, gate) {
    const write = 1 - read;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write].fbo);
    gl.viewport(0, 0, SIM_W, SIM_H);
    gl.disable(gl.BLEND);
    gl.useProgram(simProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[read].tex);
    gl.uniform1i(simLoc.uState, 0);
    gl.uniform2f(simLoc.uSim, SIM_W, SIM_H);
    gl.uniform2f(simLoc.uCenter, CX, CY);
    gl.uniform2f(simLoc.uDir, dir[0], dir[1]);
    gl.uniform2f(simLoc.uSlide, slide[0], slide[1]);
    gl.uniform1f(simLoc.uMode, mode);
    gl.uniform1f(simLoc.uPhase, phase);
    gl.uniform1f(simLoc.uGate, gate);
    gl.uniform1f(simLoc.uNeckY, CY);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    read = write;
  }

  function axisDir(deg) {
    const phi = (deg * Math.PI) / 180;
    const gx = Math.sin(phi);
    const gy = -Math.cos(phi);
    if (Math.abs(gy) >= Math.abs(gx)) return [0, gy >= 0 ? 1 : -1];
    return [gx >= 0 ? 1 : -1, 0];
  }

  let stepId = 0;

  // Pairing phase that lets the cell just upstream of the neck move into it.
  function phaseForGate(dir) {
    const src = dir[1] !== 0 ? CY - dir[1] : CX - dir[0];
    const mod = ((src % 2) + 2) % 2;
    const sgn = dir[1] !== 0 ? dir[1] : dir[0];
    return sgn > 0 ? mod : 1 - mod;
  }

  function substep(open) {
    const dir = axisDir(angle);
    const perp = [-dir[1], dir[0]];
    const slides = [
      [dir[0] + perp[0], dir[1] + perp[1]],
      [dir[0] - perp[0], dir[1] - perp[1]],
    ];
    if (stepId % 2) slides.reverse();
    const gatePhase = phaseForGate(dir);
    bindSim(0, dir, [0, 0], gatePhase, open ? 1 : 0);
    bindSim(0, dir, [0, 0], 1 - gatePhase, 0);
    bindSim(1, dir, slides[0], stepId % 2, 0);
    bindSim(1, dir, slides[1], (stepId + 1) % 2, 0);
    stepId += 1;
  }

  function counts() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[read].fbo);
    gl.readPixels(0, 0, SIM_W, SIM_H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let high = 0;
    let low = 0;
    for (let y = 0; y < SIM_H; y++) {
      for (let x = 0; x < SIM_W; x++) {
        const r = pixels[(y * SIM_W + x) * 4];
        if (r > 64 && r < 192) {
          if (y > CY) high += 1;
          else if (y < CY) low += 1;
        }
      }
    }
    return { high, low };
  }

  function sourceIsHigh(deg) {
    const a = ((deg % 360) + 360) % 360;
    return a < 90 || a >= 270;
  }

  function sourceCount(c, deg) {
    return sourceIsHigh(deg) ? c.high : c.low;
  }

  upload(buildState());
  for (let i = 0; i < 140; i++) substep(false);
  initial = pixels.slice();
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets[read].fbo);
  gl.readPixels(0, 0, SIM_W, SIM_H, gl.RGBA, gl.UNSIGNED_BYTE, initial);

  let flipFrom = 0;
  let flipTo = 0;
  let flipStart = 0;
  let flipT = 1;
  let duration = 180;
  let pourSand = 1;
  let rate = 1;
  let tokens = 0;
  let virtualSand = 0;
  let actualSource = 0;
  let lastCounts = { high: 0, low: 0 };
  let lastRead = 0;

  function beginPour() {
    lastCounts = counts();
    const sand = Math.max(1, sourceCount(lastCounts, angle));
    pourSand = sand;
    rate = sand / duration;
    virtualSand = sand;
    actualSource = sand;
    tokens = 0;
  }

  function resetGlass() {
    upload(initial);
    angle = 0;
    flipT = 1;
    stepId = 0;
    beginPour();
    paintTime(true);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds - 1e-6));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  let shown = '';
  function paintTime(force) {
    const text = formatTime(Math.max(0, virtualSand) / rate);
    if (force || text !== shown) {
      shown = text;
      timeEl.textContent = text;
    }
  }

  function setDuration(seconds) {
    duration = seconds;
    durationButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.seconds) === seconds));
    });
    resetGlass();
  }

  function onFlipDone() {
    beginPour();
    paintTime(true);
  }

  function flip() {
    if (flipT < 1) return;
    flipFrom = angle;
    flipTo = angle + 180;
    flipStart = performance.now();
    flipT = 0;
    if (FLIP_MS <= 0) {
      angle = flipTo;
      flipT = 1;
      onFlipDone();
    }
  }

  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function update(dt, now) {
    if (flipT < 1) {
      const t = Math.min(1, (now - flipStart) / FLIP_MS);
      flipT = t;
      angle = flipFrom + (flipTo - flipFrom) * ease(t);
      if (t >= 1) {
        angle = flipTo;
        onFlipDone();
      }
      return;
    }

    for (let i = 0; i < SUBSTEPS; i++) {
      tokens += (rate * dt) / SUBSTEPS;
      let open = false;
      if (tokens >= 1 && actualSource > 0) {
        tokens -= 1;
        open = true;
        virtualSand = Math.max(0, virtualSand - 1);
      }
      substep(open);
    }

    if (now - lastRead > 400) {
      lastCounts = counts();
      lastRead = now;
      actualSource = sourceCount(lastCounts, angle);
      virtualSand += (actualSource - virtualSand) * 0.45;
      if (actualSource === 0) virtualSand = 0;
    }
    paintTime(false);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function render(now) {
    resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(drawProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[read].tex);
    gl.uniform1i(drawLoc.uState, 0);
    gl.uniform2f(drawLoc.uSim, SIM_W, SIM_H);
    gl.uniform2f(drawLoc.uCenter, CX, CY);
    gl.uniform2f(drawLoc.uResolution, canvas.width, canvas.height);
    gl.uniform1f(drawLoc.uAngle, (angle * Math.PI) / 180);
    gl.uniform1f(drawLoc.uHalf, HALF);
    gl.uniform1f(drawLoc.uMaxR, MAX_R);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    flip();
  });

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'Space' || event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      flip();
    } else if (event.key === '1') setDuration(60);
    else if (event.key === '3') setDuration(180);
    else if (event.key === '5') setDuration(300);
  });

  durationButtons.forEach((btn) => {
    btn.addEventListener('click', () => setDuration(Number(btn.dataset.seconds)));
  });

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    fallback.hidden = false;
    fallback.textContent = 'WebGL reset. Reload the page to restart the sand.';
  });

  resetGlass();

  let last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (!document.hidden && canvas.clientWidth > 0) update(dt, now);
    if (canvas.clientWidth > 0) render(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (new URLSearchParams(location.search).has('debug')) {
    const hud = document.createElement('pre');
    hud.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;color:#f4efe6;font:12px/1.4 ui-monospace,monospace;background:rgba(0,0,0,.45);padding:8px;border-radius:8px';
    document.body.appendChild(hud);
    setInterval(() => {
      const c = counts();
      hud.textContent = `high ${c.high}  low ${c.low}\nvirtual ${virtualSand.toFixed(1)}  rate ${rate.toFixed(2)}/s\nangle ${angle.toFixed(1)}  pour ${pourSand}`;
    }, 250);
    window.__hg = {
      counts,
      substep,
      resetGlass,
      setDuration,
      flip,
      tick(dt) { update(dt, performance.now()); },
      map() {
        counts();
        const lines = [];
        for (let y = SIM_H - 1; y >= 0; y -= 2) {
          let s = '';
          for (let x = 0; x < SIM_W; x += 2) {
            const r = pixels[(y * SIM_W + x) * 4];
            if (r > 64 && r < 192) s += '#';
            else if (interior(x, y)) s += '.';
            else s += ' ';
          }
          lines.push(s);
        }
        return lines.join('\n');
      },
      get rate() { return rate; },
      get angle() { return angle; },
      get virtualSand() { return virtualSand; },
      get fullLoad() { return pourSand; },
      get timeText() { return timeEl.textContent; },
    };
  }
})();
