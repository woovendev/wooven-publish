import { BLACK_CUTOFF, hueDist, rgbToHsl, survey, visibleBounds } from "./survey.js";

const $ = (id) => document.getElementById(id);

const statement = $("statement");
const prompt = $("prompt");
const figure = $("figure");
const fit = $("fit");
const sheet = $("sheet");
const ink = $("ink");
const sheetCtx = sheet.getContext("2d");
const inkCtx = ink.getContext("2d");
const loupe = $("loupe");
const loupeCanvas = $("loupeCanvas");
const loupeCtx = loupeCanvas.getContext("2d");
const loupeHex = $("loupeHex");
const meta = $("meta");
const swatches = $("swatches");
const hueLabel = $("hueLabel");
const maskRow = $("maskRow");
const dropText = document.querySelector(".drop p");

const nf = new Intl.NumberFormat("de-CH");
const pf = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const state = {
  pixels: null,
  width: 0,
  height: 0,
  source: null,
  mask: null,
  view: null,
  frame: null,
  interaction: "idle",
  rule: "paved",
  samples: [],
  polarity: "strain",
  hueWindow: 22,
  excludeBlack: true,
  showLayer: true,
  parity: false,
  tool: "brush",
  brush: 28,
  place: "Zürich Kreis 5",
  dirty: false,
  reading: null,
  undo: [],
  poly: [],
};

let job = 0;
let anim = 0;
let dragDepth = 0;
let drawing = false;
let lastPt = null;
let rectStart = null;
let scratch = null;

const COPY = {
  paved: "Betonierte",
  green: "Begrünte",
  samples: "Markierte",
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function yieldFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function statementText(rule, place) {
  return `Anteil an\n${COPY[rule] || "Markierte"}\nFläche in\n${place}`;
}

function writeStatement() {
  if (state.dirty) return;
  statement.textContent = statementText(state.rule, state.place);
}

function setPressed(id, on) {
  $(id).setAttribute("aria-pressed", on ? "true" : "false");
}

function syncControls() {
  setPressed("presetPaved", state.rule === "paved");
  setPressed("presetGreen", state.rule === "green");
  setPressed("modeSample", state.interaction === "sample");
  setPressed("modeMask", state.interaction === "mask");
  setPressed("layer", state.showLayer);
  setPressed("black", state.excludeBlack);
  setPressed("polarity", state.polarity === "strain");
  $("polarity").textContent = state.polarity === "strain" ? "Rot = viel" : "Rot = wenig";
  hueLabel.hidden = state.rule !== "samples";
  maskRow.hidden = state.interaction !== "mask";
  document.body.classList.toggle("sample", state.interaction === "sample");
  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.tool === state.tool ? "true" : "false");
  });
  const note = $("maskNote");
  if (note) {
    const notes = {
      brush: "Pinsel schraffiert Fläche aus der Zählung.",
      erase: "Radierer holt diese Fläche zurück.",
      rect: "Rechteck zieht eine Fläche ab.",
      poly: "Polygon: Punkte setzen, Enter schliesst.",
    };
    note.textContent = notes[state.tool] || "";
  }
  renderSwatches();
}

function renderSwatches() {
  swatches.replaceChildren();
  if (state.rule !== "samples") return;
  state.samples.forEach((sample, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.style.background = sample.hex;
    btn.setAttribute("aria-label", `Farbe ${sample.hex} entfernen`);
    btn.addEventListener("click", () => {
      state.samples.splice(index, 1);
      syncControls();
      resurvey(true);
    });
    swatches.append(btn);
  });
}

function ruleOptions() {
  return {
    type: state.rule,
    samples: state.samples,
    hueWindow: state.hueWindow,
    minSat: 0.12,
    lightWindow: 0.5,
  };
}

function signalU(pct) {
  if (pct == null) return 0;
  if (state.polarity === "cover") {
    return 1 - clamp((pct - 8) / 34, 0, 1);
  }
  return clamp((pct - 18) / 60, 0, 1);
}

function renderFigure(value, settled) {
  if (value == null || Number.isNaN(value)) {
    figure.textContent = "—";
    figure.style.color = "";
    figure.style.textShadow = "none";
    figure.dataset.pct = "";
    figure.dataset.settled = "false";
    document.title = "PLOT — Flächenanteil";
    return;
  }
  const shown = Math.round(value);
  figure.textContent = `${shown}%`;
  const u = signalU(value);
  const hue = 140 * (1 - u);
  const color = `hsl(${hue} 100% 50%)`;
  const glow = document.documentElement.classList.contains("light") ? 0.2 : 1;
  const a = (n) => (n * glow).toFixed(3);
  figure.style.color = color;
  figure.style.textShadow = `0 0 10px hsl(${hue} 100% 50% / ${a(1)}), 0 0 28px hsl(${hue} 100% 50% / ${a(0.95)}), 0 0 56px hsl(${hue} 100% 50% / ${a(0.7)}), 0 0 100px hsl(${hue} 100% 50% / ${a(0.4)})`;
  figure.dataset.pct = value.toFixed(2);
  figure.dataset.settled = settled ? "true" : "false";
  if (settled) document.title = `${shown}% — PLOT`;
}

function play(pct) {
  cancelAnimationFrame(anim);
  if (pct == null) {
    renderFigure(null, false);
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderFigure(pct, true);
    return;
  }
  const t0 = performance.now();
  const dur = 1800;
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - (1 - t) ** 3;
    renderFigure(pct * e, t === 1);
    if (t < 1) anim = requestAnimationFrame(tick);
  };
  anim = requestAnimationFrame(tick);
}

function updateMeta(extra) {
  const reading = state.reading;
  if (!state.pixels) {
    meta.textContent = "Karte ablegen. Schwarz maskierte Pixel zählen nicht zur sichtbaren Fläche.";
    return;
  }
  if (!reading || reading.pct == null) {
    meta.textContent = extra || "Farbe auf der Karte wählen. Shift fügt eine weitere Schicht hinzu.";
    return;
  }
  const kind =
    state.rule === "paved"
      ? "Beton = sichtbar − Grün − Wasser"
      : state.rule === "green"
        ? "Grünfläche im sichtbaren Boden"
        : "Gewählte Farbschicht";
  const parts = [
    `${pf.format(reading.pct)} % ohne Schwarz und ohne Maske`,
    `${nf.format(reading.tracked)} / ${nf.format(reading.visible)}`,
    `Schwarz ${nf.format(reading.excludedBlack || 0)}`,
    `Maske ${nf.format(reading.excludedPaint || 0)}`,
    kind,
  ];
  if (!state.excludeBlack && reading.blackPixels > 0) {
    parts.push("Schwarzmaske ist aus, der schwarze Rand zählt mit");
  } else if ((reading.excludedBlack || 0) === 0 && (reading.excludedPaint || 0) === 0) {
    parts.push("kein schwarzer Rand im Bild, das ganze Rechteck zählt");
  }
  meta.textContent = parts.join(" · ");
}

function layoutMap() {
  if (!state.view) return;
  const copy = document.querySelector(".copy");
  const dock = document.querySelector(".dock");
  const slot = $("slot");
  const gap = 28;
  const chrome = 68 + (dock?.offsetHeight || 88) + gap;
  const availH = Math.max(120, window.innerHeight - chrome - (copy?.offsetHeight || 280) - gap);
  const maxH = Math.min(availH, window.innerHeight * 0.36);
  const narrow = window.innerWidth < 760;
  slot.classList.toggle("stack-proof", narrow);
  const gutter = 20;
  const captionH = 22;
  const buttonH = 26;
  const edge = 28;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let scale = Math.min(Math.min(640, vw * 0.46) / state.view.w, maxH / state.view.h);
  if (!narrow) {
    const room = vw / 2 - edge - gutter + captionH;
    const fitScale = room / (state.view.w / 2 + state.view.h);
    if (fitScale < scale) scale = fitScale;
  } else {
    scale = Math.min((vw * 0.86) / state.view.w, maxH / state.view.h);
  }
  const pack = (s) => {
    const Mw = Math.max(1, Math.round(state.view.w * s));
    const Mh = Math.max(1, Math.round(state.view.h * s));
    const side = state.parity ? Math.sqrt(Mw * Mh) : Math.max(96, Mh - captionH);
    return { Mw, Mh, side };
  };
  if (state.parity) {
    for (let i = 0; i < 6; i++) {
      const { Mw, Mh, side } = pack(scale);
      const mapLeft = (vw - Mw) / 2;
      const gridRight = mapLeft + Mw + gutter + side;
      const shift = narrow ? 0 : Math.max(0, gridRight - (vw - edge));
      const left = mapLeft - shift;
      const right = gridRight - shift;
      let overflow = Math.max(0, edge - left, right - (vw - edge));
      const copyH = copy?.offsetHeight || 280;
      const dockH = dock?.offsetHeight || 88;
      const inner = vh - 68 - 96;
      const mapTop = 68 + Math.max(0, (inner - (Mh + gap + copyH)) / 2);
      const gridBottom = mapTop + captionH + side + buttonH;
      const vLimit = vh - dockH - 8;
      if (gridBottom > vLimit) overflow = Math.max(overflow, gridBottom - vLimit);
      if (overflow < 0.5) break;
      const group = Mw + gutter + side;
      scale *= Math.max(0.55, (group - overflow) / group);
    }
  }
  const { Mw, Mh, side } = pack(scale);
  fit.style.width = `${Mw}px`;
  fit.style.height = `${Mh}px`;
  const proof = $("proof");
  if (proof) {
    proof.style.width = `${side}px`;
    proof.style.height = `${side}px`;
  }
  let shift = 0;
  if (state.parity && !narrow) {
    const mapLeft = (vw - Mw) / 2;
    const gridRight = mapLeft + Mw + gutter + side;
    shift = Math.max(0, gridRight - (vw - edge));
    if (mapLeft - shift < edge) shift = Math.max(0, mapLeft - edge);
  }
  const slide = `translateX(${-shift}px)`;
  slot.style.transform = slide;
  if (copy) copy.style.transform = slide;
  document.body.classList.add("laid-out");
  const { view } = state;
  sheet.dataset.vx = String(view.x);
  sheet.dataset.vy = String(view.y);
  sheet.dataset.vw = String(view.w);
  sheet.dataset.vh = String(view.h);
  requestAnimationFrame(sizeInk);
}

function sizeInk() {
  const rect = sheet.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ink.width = Math.max(1, Math.round(rect.width * dpr));
  ink.height = Math.max(1, Math.round(rect.height * dpr));
  inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  inkCtx.clearRect(0, 0, rect.width, rect.height);
}

function ensureFrame(w, h) {
  const n = w * h * 4;
  if (!state.frame || state.frame.length !== n) state.frame = new Uint8ClampedArray(n);
  return state.frame;
}

function paintSheet() {
  const { view, frame } = state;
  if (!view || !frame) return;
  if (sheet.width !== view.w || sheet.height !== view.h) {
    sheet.width = view.w;
    sheet.height = view.h;
  }
  sheetCtx.putImageData(new ImageData(frame, view.w, view.h), 0, 0);
}

function drawProof(result) {
  const wrap = $("proofWrap");
  const canvas = $("proof");
  const cap = $("proofCap");
  if (!wrap || !canvas) return;
  if (!result || result.pct == null || !result.visible) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const n = 10;
  const size = 400;
  const gap = 8;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const cell = (size - gap * (n + 1)) / n;
  const greenCells = (result.tracked / result.visible) * 100;
  const fillColor = result.mean
    ? `rgb(${result.mean[0]},${result.mean[1]},${result.mean[2]})`
    : "#c8f5d4";
  for (let i = 0; i < 100; i++) {
    const gx = i % n;
    const gy = Math.floor(i / n);
    const x = gap + gx * (cell + gap);
    const y = gap + gy * (cell + gap);
    const fill = Math.min(1, Math.max(0, greenCells - i));
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(x, y, cell, cell);
    if (fill > 0) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y + cell * (1 - fill), cell, cell * fill);
    }
  }
  if (cap) cap.textContent = `${pf.format(result.pct)} % in 100 Zellen`;
}

async function resurvey(animate) {
  if (!state.pixels) return;
  const id = ++job;
  if (animate) figure.dataset.settled = "false";
  if (document.fonts?.ready) await document.fonts.ready;
  await yieldFrame();
  if (id !== job) return;
  const view =
    state.excludeBlack && state.bounds && !state.bounds.empty
      ? state.bounds
      : { x: 0, y: 0, w: state.width, h: state.height };
  state.view = view;
  const out = ensureFrame(view.w, view.h);
  const result = survey(state.pixels, state.width, state.height, state.mask, {
    rule: ruleOptions(),
    excludeBlack: state.excludeBlack,
    blackCutoff: BLACK_CUTOFF,
    showLayer: state.showLayer && state.interaction !== "mask",
    hatchStep: hatchStep(),
    view,
    out,
  });
  if (id !== job) return;
  const prev = state.reading?.pct;
  state.reading = result;
  paintSheet();
  layoutMap();
  drawProof(result);
  updateMeta();
  const changed = prev == null || result.pct == null || Math.round(prev) !== Math.round(result.pct);
  if (result.pct == null) renderFigure(null, false);
  else if (animate && changed) play(result.pct);
  else renderFigure(result.pct, true);
}

function resetMask() {
  state.mask = new Uint8Array(state.width * state.height);
  state.undo = [];
  state.poly = [];
}

async function loadBitmap(bitmap, place) {
  const maxPixels = 7_500_000;
  let dw = bitmap.width;
  let dh = bitmap.height;
  if (dw * dh > maxPixels) {
    const s = Math.sqrt(maxPixels / (dw * dh));
    dw = Math.max(1, Math.round(bitmap.width * s));
    dh = Math.max(1, Math.round(bitmap.height * s));
  }
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, dw, dh);
  const image = ctx.getImageData(0, 0, dw, dh);
  bitmap.close?.();
  state.pixels = image.data;
  state.width = dw;
  state.height = dh;
  state.source = canvas;
  resetMask();
  if (place) {
    state.place = place;
    state.dirty = false;
    writeStatement();
  }
  fit.hidden = false;
  document.body.classList.add("has-map");
  state.bounds = visibleBounds(state.pixels, dw, dh, BLACK_CUTOFF);
  const view =
    state.excludeBlack && !state.bounds.empty
      ? state.bounds
      : { x: 0, y: 0, w: dw, h: dh };
  state.view = view;
  sheet.width = view.w;
  sheet.height = view.h;
  sheetCtx.drawImage(canvas, view.x, view.y, view.w, view.h, 0, 0, view.w, view.h);
  layoutMap();
  await resurvey(true);
}

async function loadBlob(blob, place) {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "from-image",
    colorSpaceConversion: "none",
  });
  await loadBitmap(bitmap, place);
}

function placeFromName(name) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base || "diesem Ausschnitt";
}

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    meta.textContent = "Bitte eine PNG- oder JPG-Karte ablegen.";
    return;
  }
  try {
    await loadBlob(file, placeFromName(file.name));
  } catch (err) {
    meta.textContent = "Bild konnte nicht gelesen werden.";
    console.error(err);
  }
}

function pointerToImage(event) {
  const rect = sheet.getBoundingClientRect();
  const x = state.view.x + ((event.clientX - rect.left) / rect.width) * state.view.w;
  const y = state.view.y + ((event.clientY - rect.top) / rect.height) * state.view.h;
  return [x, y];
}

function imageToScreen(x, y) {
  const rect = sheet.getBoundingClientRect();
  return [
    ((x - state.view.x) / state.view.w) * rect.width,
    ((y - state.view.y) / state.view.h) * rect.height,
  ];
}

function hatchStep() {
  if (!state.view) return 28;
  const rect = sheet.getBoundingClientRect();
  const scale = rect.width > 0 ? state.view.w / rect.width : 4;
  return Math.max(8, Math.round(scale * 8));
}

function brushRadius() {
  const rect = sheet.getBoundingClientRect();
  return (state.brush / 2) * (state.view.w / rect.width);
}

function stamp(cx, cy, radius, value) {
  const { mask, width, height } = state;
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  const x0 = clamp(Math.floor(cx) - r, 0, width - 1);
  const x1 = clamp(Math.floor(cx) + r, 0, width - 1);
  const y0 = clamp(Math.floor(cy) - r, 0, height - 1);
  const y1 = clamp(Math.floor(cy) + r, 0, height - 1);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) mask[row + x] = value;
    }
  }
}

function stroke(x0, y0, x1, y1, radius, value) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1, radius / 3);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, value);
  }
}

function previewStamp(x, y, radius, erase) {
  const px = x - state.view.x;
  const py = y - state.view.y;
  sheetCtx.save();
  sheetCtx.beginPath();
  sheetCtx.arc(px, py, radius, 0, Math.PI * 2);
  sheetCtx.clip();
  if (erase) {
    sheetCtx.drawImage(
      state.source,
      state.view.x,
      state.view.y,
      state.view.w,
      state.view.h,
      0,
      0,
      state.view.w,
      state.view.h,
    );
  } else {
    const step = hatchStep();
    sheetCtx.fillStyle = "#000";
    sheetCtx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
    sheetCtx.fillStyle = "#fff";
    const x0 = Math.floor((x - radius) / step) * step;
    const y0 = Math.floor((y - radius) / step) * step;
    for (let iy = y0; iy <= y + radius; iy += step) {
      for (let ix = x0; ix <= x + radius; ix += step) {
        if ((Math.floor(ix / step) + Math.floor(iy / step)) % 2 === 0) {
          sheetCtx.fillRect(ix - state.view.x, iy - state.view.y, step, step);
        }
      }
    }
  }
  sheetCtx.restore();
}

function pushUndo() {
  state.undo.push(state.mask.slice());
  if (state.undo.length > 8) state.undo.shift();
}

function fillPolygon(points) {
  if (!scratch) scratch = document.createElement("canvas");
  scratch.width = state.width;
  scratch.height = state.height;
  const ctx = scratch.getContext("2d");
  ctx.clearRect(0, 0, scratch.width, scratch.height);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  const data = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
  for (let i = 0; i < state.mask.length; i++) {
    if (data[(i << 2) + 3] > 0) state.mask[i] = 1;
  }
}

function fillRect(a, b) {
  const x0 = clamp(Math.floor(Math.min(a[0], b[0])), 0, state.width - 1);
  const x1 = clamp(Math.ceil(Math.max(a[0], b[0])), 0, state.width - 1);
  const y0 = clamp(Math.floor(Math.min(a[1], b[1])), 0, state.height - 1);
  const y1 = clamp(Math.ceil(Math.max(a[1], b[1])), 0, state.height - 1);
  for (let y = y0; y <= y1; y++) {
    const row = y * state.width;
    for (let x = x0; x <= x1; x++) state.mask[row + x] = 1;
  }
}

function clearInk() {
  const rect = sheet.getBoundingClientRect();
  inkCtx.clearRect(0, 0, rect.width, rect.height);
}

function drawCursor(event) {
  if (state.interaction !== "mask" || !state.view) return;
  if (state.tool === "poly" || state.tool === "rect") return;
  const rect = sheet.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  clearInk();
  inkCtx.beginPath();
  inkCtx.arc(x, y, state.brush / 2, 0, Math.PI * 2);
  inkCtx.strokeStyle = "rgba(255,255,255,0.85)";
  inkCtx.lineWidth = 1;
  inkCtx.stroke();
}

function drawPoly(mouse) {
  clearInk();
  if (!state.poly.length) return;
  inkCtx.beginPath();
  const first = imageToScreen(state.poly[0][0], state.poly[0][1]);
  inkCtx.moveTo(first[0], first[1]);
  for (let i = 1; i < state.poly.length; i++) {
    const p = imageToScreen(state.poly[i][0], state.poly[i][1]);
    inkCtx.lineTo(p[0], p[1]);
  }
  if (mouse) inkCtx.lineTo(mouse[0], mouse[1]);
  inkCtx.strokeStyle = "#fff";
  inkCtx.lineWidth = 1;
  inkCtx.stroke();
}

function drawRectPreview(a, b) {
  clearInk();
  const p = imageToScreen(a[0], a[1]);
  const q = imageToScreen(b[0], b[1]);
  inkCtx.strokeStyle = "#fff";
  inkCtx.lineWidth = 1;
  inkCtx.strokeRect(p[0], p[1], q[0] - p[0], q[1] - p[1]);
}

function sampleAt(x, y, add) {
  const ix = clamp(Math.round(x), 0, state.width - 1);
  const iy = clamp(Math.round(y), 0, state.height - 1);
  const i = (iy * state.width + ix) << 2;
  const r = state.pixels[i];
  const g = state.pixels[i + 1];
  const b = state.pixels[i + 2];
  if (state.excludeBlack && r <= BLACK_CUTOFF && g <= BLACK_CUTOFF && b <= BLACK_CUTOFF) return;
  const hsl = rgbToHsl(r, g, b);
  const sample = {
    ...hsl,
    hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
  };
  if (add) state.samples.push(sample);
  else {
    state.samples = [sample];
    const greenish = sample.s >= 0.15 && hueDist(sample.h, 145) <= 35;
    state.polarity = greenish ? "cover" : "strain";
  }
  state.rule = "samples";
  writeStatement();
  syncControls();
  resurvey(true);
}

function showLoupe(event, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  const half = 5;
  loupeCtx.imageSmoothingEnabled = false;
  for (let py = -half; py <= half; py++) {
    for (let px = -half; px <= half; px++) {
      const sx = clamp(ix + px, 0, state.width - 1);
      const sy = clamp(iy + py, 0, state.height - 1);
      const i = (sy * state.width + sx) << 2;
      loupeCtx.fillStyle = `rgb(${state.pixels[i]},${state.pixels[i + 1]},${state.pixels[i + 2]})`;
      loupeCtx.fillRect((px + half) * 8, (py + half) * 8, 8, 8);
    }
  }
  loupeCtx.strokeStyle = "#fff";
  loupeCtx.lineWidth = 1;
  loupeCtx.strokeRect(half * 8 + 0.5, half * 8 + 0.5, 7, 7);
  const i = (clamp(iy, 0, state.height - 1) * state.width + clamp(ix, 0, state.width - 1)) << 2;
  const hex = `#${[state.pixels[i], state.pixels[i + 1], state.pixels[i + 2]]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
  loupeHex.textContent = hex;
  const pad = 16;
  let left = event.clientX + pad;
  let top = event.clientY + pad;
  if (left + 100 > window.innerWidth) left = event.clientX - 108;
  if (top + 120 > window.innerHeight) top = event.clientY - 124;
  loupe.style.left = `${left}px`;
  loupe.style.top = `${top}px`;
  loupe.hidden = false;
}

function closePoly() {
  if (state.poly.length < 3) {
    state.poly = [];
    clearInk();
    return;
  }
  pushUndo();
  fillPolygon(state.poly);
  state.poly = [];
  clearInk();
  resurvey(true);
}

ink.addEventListener("pointerdown", (event) => {
  if (!state.pixels || !state.view) return;
  ink.setPointerCapture(event.pointerId);
  const pt = pointerToImage(event);
  if (state.interaction === "sample") {
    sampleAt(pt[0], pt[1], event.shiftKey);
    return;
  }
  if (state.interaction !== "mask") return;
  if (state.tool === "poly") {
    if (state.poly.length >= 3) {
      const first = state.poly[0];
      const a = imageToScreen(first[0], first[1]);
      const b = imageToScreen(pt[0], pt[1]);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 14) {
        closePoly();
        return;
      }
    }
    state.poly.push(pt);
    drawPoly(null);
    return;
  }
  if (state.tool === "rect") {
    rectStart = pt;
    pushUndo();
    return;
  }
  drawing = true;
  lastPt = pt;
  pushUndo();
  const radius = brushRadius();
  const value = state.tool === "erase" ? 0 : 1;
  stamp(pt[0], pt[1], radius, value);
  previewStamp(pt[0], pt[1], radius, state.tool === "erase");
});

ink.addEventListener("pointermove", (event) => {
  if (!state.pixels || !state.view) return;
  const pt = pointerToImage(event);
  if (state.interaction === "sample") {
    showLoupe(event, pt[0], pt[1]);
    return;
  }
  loupe.hidden = true;
  if (state.interaction !== "mask") return;
  if (state.tool === "poly") {
    const rect = sheet.getBoundingClientRect();
    drawPoly([event.clientX - rect.left, event.clientY - rect.top]);
    return;
  }
  if (state.tool === "rect" && rectStart) {
    drawRectPreview(rectStart, pt);
    return;
  }
  drawCursor(event);
  if (!drawing || !lastPt) return;
  const radius = brushRadius();
  const value = state.tool === "erase" ? 0 : 1;
  stroke(lastPt[0], lastPt[1], pt[0], pt[1], radius, value);
  previewStamp(pt[0], pt[1], radius, state.tool === "erase");
  lastPt = pt;
});

function finishStroke(event) {
  if (state.tool === "rect" && rectStart && state.interaction === "mask") {
    const pt = pointerToImage(event);
    fillRect(rectStart, pt);
    rectStart = null;
    clearInk();
    resurvey(true);
    return;
  }
  if (!drawing) return;
  drawing = false;
  lastPt = null;
  clearInk();
  resurvey(true);
}

ink.addEventListener("pointerup", finishStroke);
ink.addEventListener("pointercancel", finishStroke);

ink.addEventListener("pointerleave", () => {
  loupe.hidden = true;
  if (!drawing && state.tool !== "poly") clearInk();
});

function setRule(rule) {
  state.rule = rule;
  state.interaction = "idle";
  state.polarity = rule === "green" ? "cover" : "strain";
  state.dirty = false;
  state.poly = [];
  writeStatement();
  syncControls();
  clearInk();
  resurvey(true);
}

$("presetPaved").addEventListener("click", () => setRule("paved"));
$("presetGreen").addEventListener("click", () => setRule("green"));

$("modeSample").addEventListener("click", () => {
  state.interaction = state.interaction === "sample" ? "idle" : "sample";
  if (state.interaction === "sample" && state.samples.length) state.rule = "samples";
  state.poly = [];
  syncControls();
  clearInk();
  if (state.rule === "samples") resurvey(false);
});

$("modeMask").addEventListener("click", () => {
  state.interaction = state.interaction === "mask" ? "idle" : "mask";
  if (state.interaction !== "mask") state.poly = [];
  syncControls();
  clearInk();
  resurvey(false);
});

$("layer").addEventListener("click", () => {
  state.showLayer = !state.showLayer;
  syncControls();
  resurvey(false);
});

$("parity").addEventListener("click", () => {
  state.parity = !state.parity;
  $("parity").setAttribute("aria-pressed", state.parity ? "true" : "false");
  layoutMap();
});

function applyTheme(light) {
  document.documentElement.classList.toggle("light", light);
  const btn = $("theme");
  btn.setAttribute("aria-pressed", light ? "true" : "false");
  btn.setAttribute("aria-label", light ? "Dunkles Layout" : "Helles Layout");
  try {
    localStorage.setItem("plot-theme", light ? "light" : "dark");
  } catch (e) {}
  if (figure.dataset.pct) renderFigure(Number(figure.dataset.pct), figure.dataset.settled === "true");
}

$("theme").addEventListener("click", () => {
  applyTheme(!document.documentElement.classList.contains("light"));
});
applyTheme(document.documentElement.classList.contains("light"));

$("polarity").addEventListener("click", () => {
  state.polarity = state.polarity === "strain" ? "cover" : "strain";
  syncControls();
  if (state.reading?.pct != null) play(state.reading.pct);
});

$("hue").addEventListener("input", (event) => {
  state.hueWindow = Number(event.target.value);
  if (state.rule === "samples") resurvey(true);
});

$("black").addEventListener("click", () => {
  state.excludeBlack = !state.excludeBlack;
  syncControls();
  resurvey(true);
});

$("brush").addEventListener("input", (event) => {
  state.brush = Number(event.target.value);
});

document.querySelectorAll("[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.tool = btn.dataset.tool;
    state.poly = [];
    syncControls();
    clearInk();
  });
});

$("undo").addEventListener("click", () => {
  const prev = state.undo.pop();
  if (!prev) return;
  state.mask.set(prev);
  resurvey(true);
});

$("clearMask").addEventListener("click", () => {
  pushUndo();
  state.mask.fill(0);
  state.poly = [];
  resurvey(true);
});

figure.addEventListener("click", () => {
  if (state.reading?.pct != null) play(state.reading.pct);
});

statement.addEventListener("input", () => {
  state.dirty = true;
});

$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => {
  const file = $("file").files?.[0];
  if (file) loadFile(file);
  $("file").value = "";
});

$("specimen").addEventListener("click", () => {
  loadSpecimen();
});

window.addEventListener("dragenter", (event) => {
  if (![...event.dataTransfer?.types || []].includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add("drag");
  if (dropText) dropText.textContent = "Loslassen";
});

window.addEventListener("dragleave", () => {
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("drag");
    if (dropText) dropText.textContent = "Karte ablegen";
  }
});

window.addEventListener("dragover", (event) => event.preventDefault());

window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("drag");
  if (dropText) dropText.textContent = "Karte ablegen";
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

window.addEventListener("resize", () => {
  layoutMap();
});

window.addEventListener("keydown", (event) => {
  const typing = event.target?.isContentEditable;
  if (typing) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    $("undo").click();
    return;
  }
  if (event.key === "Escape") {
    state.poly = [];
    rectStart = null;
    clearInk();
  } else if (event.key === "Enter" && state.tool === "poly") {
    closePoly();
  } else if (event.key === "[") {
    state.brush = Math.max(8, state.brush - 4);
    $("brush").value = String(state.brush);
  } else if (event.key === "]") {
    state.brush = Math.min(96, state.brush + 4);
    $("brush").value = String(state.brush);
  } else if (event.key.toLowerCase() === "b") setRule("paved");
  else if (event.key.toLowerCase() === "g") setRule("green");
  else if (event.key.toLowerCase() === "f") $("modeSample").click();
  else if (event.key.toLowerCase() === "m") $("modeMask").click();
  else if (event.key.toLowerCase() === "l") $("layer").click();
});

async function loadSpecimen() {
  const res = await fetch("specimen.png");
  if (!res.ok) throw new Error("specimen missing");
  const blob = await res.blob();
  await loadBlob(blob, "Zürich Kreis 5");
}

syncControls();

loadSpecimen().catch(() => {
  meta.textContent = "Probe nicht geladen. Karte ablegen.";
});
