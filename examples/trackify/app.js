"use strict";

/* ============================================================
   Trackify — vanilla time tracker, localStorage only, no DB.
   Data model: entries[] = { id, project, customer, task, notes,
   start (ms epoch), stop (ms epoch|null), rate (number), billable (bool) }
   ============================================================ */

const KEY = "trackify.entries.v1";
const RUNNING_KEY = "trackify.running.v1";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let entries = load();
let running = JSON.parse(localStorage.getItem(RUNNING_KEY) || "null"); // partial entry without stop
let tickHandle = null;
let editingId = null;

/* ---------- persistence ---------- */
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(entries));
}
function saveRunning() {
  if (running) localStorage.setItem(RUNNING_KEY, JSON.stringify(running));
  else localStorage.removeItem(RUNNING_KEY);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- time helpers ---------- */
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function fmtHM(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}
function entryMs(e) {
  return (e.stop ?? Date.now()) - e.start;
}
function fmtWhen(ms) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function toLocalInput(ms) {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  return new Date(v).getTime();
}
function money(n) {
  return "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* ============================================================
   TIMER
   ============================================================ */
const fProject = $("#f-project"), fCustomer = $("#f-customer"), fTask = $("#f-task"),
      fNotes = $("#f-notes"), fRate = $("#f-rate"), fBillable = $("#f-billable");

$("#f-task").addEventListener("input", () => {
  $("#taskCount").textContent = `${fTask.value.length}/300`;
});

fBillable.addEventListener("click", () => {
  const on = fBillable.classList.toggle("on");
  fBillable.setAttribute("aria-pressed", String(on));
  fBillable.textContent = on ? "$" : "—";
});

$("#startStop").addEventListener("click", () => {
  if (running) stopTimer();
  else startTimer();
});

function startTimer() {
  running = {
    id: uid(),
    project: fProject.value.trim(),
    customer: fCustomer.value.trim(),
    task: fTask.value.trim(),
    notes: fNotes.value.trim(),
    start: Date.now(),
    stop: null,
    rate: parseFloat(fRate.value) || 0,
    billable: fBillable.classList.contains("on"),
  };
  saveRunning();
  setRunningUI(true);
  startTick();
  render();
}

function stopTimer() {
  running.stop = Date.now();
  // refresh fields in case user edited them while running
  running.project = fProject.value.trim();
  running.customer = fCustomer.value.trim();
  running.task = fTask.value.trim();
  running.notes = fNotes.value.trim();
  running.rate = parseFloat(fRate.value) || 0;
  running.billable = fBillable.classList.contains("on");
  entries.unshift(running);
  save();
  running = null;
  saveRunning();
  stopTick();
  setRunningUI(false);
  $("#liveTimer").textContent = "00:00:00";
  fTask.value = ""; fNotes.value = "";
  $("#taskCount").textContent = "0/300";
  render();
}

function setRunningUI(on) {
  const btn = $("#startStop");
  btn.textContent = on ? "Stop" : "Start";
  btn.classList.toggle("running", on);
}

function startTick() {
  stopTick();
  tickHandle = setInterval(() => {
    $("#liveTimer").textContent = fmtDur(Date.now() - running.start);
    // update the live row + summary cheaply
    const liveDur = document.querySelector(".row.live .r-dur");
    if (liveDur) liveDur.textContent = fmtDur(Date.now() - running.start);
    updateTrackerSummary();
  }, 1000);
}
function stopTick() { if (tickHandle) clearInterval(tickHandle); tickHandle = null; }

/* restore running session on load */
if (running) {
  fProject.value = running.project;
  fCustomer.value = running.customer;
  fTask.value = running.task;
  fNotes.value = running.notes;
  fRate.value = running.rate || "";
  fBillable.classList.toggle("on", running.billable);
  fBillable.textContent = running.billable ? "$" : "—";
  $("#taskCount").textContent = `${running.task.length}/300`;
  setRunningUI(true);
  startTick();
}

/* ---------- manual entry ---------- */
$("#manualAdd").addEventListener("click", () => {
  const now = Date.now();
  openModal({
    id: uid(),
    project: fProject.value.trim(),
    customer: fCustomer.value.trim(),
    task: fTask.value.trim(),
    notes: fNotes.value.trim(),
    start: now - 3600000,
    stop: now,
    rate: parseFloat(fRate.value) || 0,
    billable: fBillable.classList.contains("on"),
  }, true);
});

/* ============================================================
   GROUPING + RENDER (Tracker view)
   ============================================================ */
function groupKey(e) {
  return [e.project || "—", e.customer || "—", e.task || "—"].join("\u0001");
}

function allEntries() {
  // include running as a live entry at top
  return running ? [running, ...entries] : entries;
}

function render() {
  refreshDatalists();
  renderEntries();
  updateTrackerSummary();
  if ($("#view-analytics").classList.contains("active")) renderAnalytics();
}

function renderEntries() {
  const list = $("#entriesList");
  const data = allEntries();
  $("#emptyState").style.display = data.length ? "none" : "block";

  // group
  const groups = new Map();
  for (const e of data) {
    const k = groupKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  list.innerHTML = "";
  for (const [k, items] of groups) {
    const [project, customer, task] = k.split("\u0001");
    const total = items.reduce((s, e) => s + entryMs(e), 0);
    const earn = items.reduce((s, e) => s + (e.billable ? entryMs(e) / 3600000 * e.rate : 0), 0);
    const hasLive = items.some((e) => running && e.id === running.id);

    const g = document.createElement("div");
    g.className = "group" + (hasLive ? " open" : "");
    g.innerHTML = `
      <div class="group-head">
        <span class="caret">▶</span>
        <span class="g-title">${esc(task)}<small>${esc(project)} · ${esc(customer)}</small></span>
        <span class="g-meta">
          ${earn > 0 ? `<span class="g-earn">${money(earn)}</span>` : ""}
          <span class="badge">${items.length}×</span>
          <span class="g-total">${fmtDur(total)}</span>
        </span>
      </div>
      <div class="group-items"></div>`;

    const itemsEl = g.querySelector(".group-items");
    for (const e of items) {
      const live = running && e.id === running.id;
      const row = document.createElement("div");
      row.className = "row" + (live ? " live" : "");
      row.innerHTML = `
        <span class="r-when">${fmtWhen(e.start)}${e.stop ? " → " + new Date(e.stop).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}) : " · running"}</span>
        <span class="r-notes">${esc(e.notes || "")}</span>
        <span class="r-dur">${fmtDur(entryMs(e))}</span>
        ${live ? "" : `<button class="r-edit" data-id="${e.id}">Edit</button>`}`;
      itemsEl.appendChild(row);
    }
    g.querySelector(".group-head").addEventListener("click", () => g.classList.toggle("open"));
    list.appendChild(g);
  }

  $$(".r-edit").forEach((b) => b.addEventListener("click", () => {
    const e = entries.find((x) => x.id === b.dataset.id);
    if (e) openModal(e, false);
  }));
}

function updateTrackerSummary() {
  const data = allEntries();
  const total = data.reduce((s, e) => s + entryMs(e), 0);
  const today = data.filter((e) => sameDay(e.start, Date.now())).reduce((s, e) => s + entryMs(e), 0);
  $("#trackerSummary").textContent = `Today ${fmtHM(today)} · Total ${fmtHM(total)}`;
}

/* ---------- datalists (the growing "enum") ---------- */
function refreshDatalists() {
  const projects = new Set(), customers = new Set();
  for (const e of allEntries()) {
    if (e.project) projects.add(e.project);
    if (e.customer) customers.add(e.customer);
  }
  $("#projects").innerHTML = [...projects].map((p) => `<option value="${esc(p)}">`).join("");
  $("#customers").innerHTML = [...customers].map((c) => `<option value="${esc(c)}">`).join("");
}

/* ============================================================
   EDIT MODAL
   ============================================================ */
function openModal(entry, isNew) {
  editingId = entry.id;
  $("#modalTitle").textContent = isNew ? "Add manual entry" : "Edit entry";
  $("#m-project").value = entry.project || "";
  $("#m-customer").value = entry.customer || "";
  $("#m-task").value = entry.task || "";
  $("#m-notes").value = entry.notes || "";
  $("#m-start").value = toLocalInput(entry.start);
  $("#m-stop").value = toLocalInput(entry.stop ?? Date.now());
  $("#m-rate").value = entry.rate || 0;
  $("#m-billable").checked = !!entry.billable;
  $("#m-delete").style.display = isNew ? "none" : "";
  $("#modal").classList.add("open");
  $("#modal")._isNew = isNew;
  $("#modal")._draft = entry;
}
function closeModal() { $("#modal").classList.remove("open"); editingId = null; }

$("#m-cancel").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

$("#m-save").addEventListener("click", () => {
  const start = fromLocalInput($("#m-start").value);
  const stop = fromLocalInput($("#m-stop").value);
  if (isNaN(start) || isNaN(stop) || stop < start) { alert("Stop must be after start."); return; }
  const data = {
    id: editingId,
    project: $("#m-project").value.trim(),
    customer: $("#m-customer").value.trim(),
    task: $("#m-task").value.trim().slice(0, 300),
    notes: $("#m-notes").value.trim(),
    start, stop,
    rate: parseFloat($("#m-rate").value) || 0,
    billable: $("#m-billable").checked,
  };
  if ($("#modal")._isNew) entries.unshift(data);
  else { const i = entries.findIndex((x) => x.id === editingId); if (i >= 0) entries[i] = data; }
  // keep sorted by start desc
  entries.sort((a, b) => b.start - a.start);
  save();
  closeModal();
  render();
});

$("#m-delete").addEventListener("click", () => {
  if (!confirm("Delete this entry?")) return;
  entries = entries.filter((x) => x.id !== editingId);
  save();
  closeModal();
  render();
});

/* ============================================================
   ANALYTICS
   ============================================================ */
let currentRange = "today";

$$(".chip").forEach((c) => c.addEventListener("click", () => {
  $$(".chip").forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  currentRange = c.dataset.range;
  renderAnalytics();
}));

function inRange(ms) {
  const now = new Date();
  const d = new Date(ms);
  if (currentRange === "all") return true;
  if (currentRange === "today") return sameDay(ms, now.getTime());
  if (currentRange === "week") {
    const start = new Date(now); const day = (now.getDay() + 6) % 7; // Mon=0
    start.setDate(now.getDate() - day); start.setHours(0,0,0,0);
    return d >= start;
  }
  if (currentRange === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  return true;
}

function renderAnalytics() {
  const data = allEntries().filter((e) => inRange(e.start));
  const total = data.reduce((s, e) => s + entryMs(e), 0);
  const billableMs = data.filter((e) => e.billable).reduce((s, e) => s + entryMs(e), 0);
  const earnings = data.reduce((s, e) => s + (e.billable ? entryMs(e) / 3600000 * e.rate : 0), 0);

  $("#statTime").textContent = fmtHM(total);
  $("#statBillable").textContent = fmtHM(billableMs);
  $("#statEarnings").textContent = money(earnings);
  $("#statEntries").textContent = data.length;

  renderBars($("#byProject"), data, "project");
  renderBars($("#byCustomer"), data, "customer");
}

function renderBars(el, data, field) {
  const map = new Map();
  for (const e of data) {
    const k = e[field] || "—";
    map.set(k, (map.get(k) || 0) + entryMs(e));
  }
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 0;
  if (!rows.length) { el.innerHTML = `<p class="empty">No data for this range.</p>`; return; }
  el.innerHTML = rows.map(([k, ms]) => `
    <div class="bar-row">
      <div class="bar-label"><span>${esc(k)}</span><span class="v">${fmtHM(ms)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${max ? (ms/max*100) : 0}%"></div></div>
    </div>`).join("");
}

/* ============================================================
   TABS
   ============================================================ */
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${t.dataset.view}`).classList.add("active");
  if (t.dataset.view === "analytics") renderAnalytics();
}));

/* ============================================================
   IMPORT / EXPORT
   ============================================================ */
$("#exportJson").addEventListener("click", () => {
  download(`trackify-${Date.now()}.json`, JSON.stringify(entries, null, 2), "application/json");
});

$("#exportCsv").addEventListener("click", () => {
  const head = ["project","customer","task","notes","start","stop","hours","rate","billable","earnings"];
  const lines = [head.join(",")];
  for (const e of entries) {
    const hours = entryMs(e) / 3600000;
    const earn = e.billable ? hours * e.rate : 0;
    lines.push([
      e.project, e.customer, e.task, e.notes,
      new Date(e.start).toISOString(), e.stop ? new Date(e.stop).toISOString() : "",
      hours.toFixed(2), e.rate, e.billable, earn.toFixed(2),
    ].map(csvCell).join(","));
  }
  download(`trackify-${Date.now()}.csv`, lines.join("\n"), "text/csv");
});

$("#importJson").addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("not an array");
      const existing = new Set(entries.map((e) => e.id));
      let added = 0;
      for (const e of imported) {
        if (e && e.id && !existing.has(e.id)) { entries.push(e); added++; }
      }
      entries.sort((a, b) => b.start - a.start);
      save();
      render();
      alert(`Imported ${added} new entr${added === 1 ? "y" : "ies"}.`);
    } catch (err) {
      alert("Invalid JSON backup file.");
    }
    ev.target.value = "";
  };
  reader.readAsText(file);
});

/* ---------- utils ---------- */
function sameDay(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* boot */
render();
