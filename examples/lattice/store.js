/** Lattice store: load/save/import/export/migrate. One localStorage key. */

import { SCHEMA_VERSION, clone, now, validate, createWorkspace } from "./model.js?v=4";
import { studio } from "./seed.js?v=4";

export const STORAGE_KEY = "lattice:v1";

const listeners = new Set();
let ws = null;
let lastGood = null;
let banner = null;
let saveTimer = 0;
const undoStack = [];

export function getWorkspace() {
  return ws;
}

export function getBanner() {
  return banner;
}

export function clearBanner() {
  banner = null;
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(ws);
}

export function load() {
  banner = null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    ws = studio();
    lastGood = clone(ws);
    persist(false);
    emit();
    return ws;
  }
  try {
    const doc = JSON.parse(raw);
    ws = migrate(doc);
    const issues = validate(ws);
    if (issues.length) {
      banner = { kind: "warn", text: `Workspace repaired: ${issues[0]}` };
      repair(ws);
    }
    lastGood = clone(ws);
    emit();
    return ws;
  } catch (err) {
    banner = { kind: "error", text: `Could not read saved workspace (${err.message}). Showing last good or demo.` };
    if (lastGood) {
      ws = clone(lastGood);
    } else {
      ws = studio();
      lastGood = clone(ws);
    }
    emit();
    return ws;
  }
}

function migrate(doc) {
  let version = 1;
  let workspace;
  if (doc && doc.workspace) {
    version = doc.schemaVersion || 1;
    workspace = doc.workspace;
  } else if (doc && doc.pages && doc.personas) {
    workspace = doc;
  } else {
    throw new Error("unrecognized document");
  }
  if (version > SCHEMA_VERSION) {
    banner = { kind: "warn", text: "Saved data is newer than this app. Extra fields were kept." };
  }
  if (!workspace.activity) workspace.activity = [];
  if (!workspace.comments) workspace.comments = [];
  if (!workspace.databases) workspace.databases = [];
  if (!Array.isArray(workspace.personas)) workspace.personas = [];
  if (!Array.isArray(workspace.pages)) workspace.pages = [];
  if (!Array.isArray(workspace.blocks)) workspace.blocks = [];
  if (!workspace.actingPersonaId && workspace.personas[0]) {
    workspace.actingPersonaId = workspace.personas[0].id;
  }
  return workspace;
}

function repair(workspace) {
  const pageIds = new Set(workspace.pages.map((p) => p.id));
  workspace.blocks = workspace.blocks.filter((b) => !b.pageId || pageIds.has(b.pageId));
  const blockIds = new Set(workspace.blocks.map((b) => b.id));
  for (const page of workspace.pages) {
    page.childBlockIds = (page.childBlockIds || []).filter((id) => blockIds.has(id));
  }
  workspace.comments = workspace.comments.filter((c) => blockIds.has(c.blockId));
}

function persist(debounced) {
  const write = () => {
    try {
      const doc = { schemaVersion: SCHEMA_VERSION, workspace: ws };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch (err) {
      banner = { kind: "error", text: `Save failed (${err.name}: ${err.message}). Keeping last good copy in memory.` };
      if (lastGood) ws = clone(lastGood);
      emit();
    }
  };
  if (!debounced) {
    write();
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 200);
}

export function mutate(fn, opts = {}) {
  if (!ws) load();
  const snapshot = clone(ws);
  try {
    fn(ws);
    ws.updatedAt = now();
    const issues = validate(ws);
    if (issues.length) {
      throw new Error(issues[0]);
    }
    lastGood = clone(ws);
    persist(true);
    if (!opts.silent) {
      undoStack.push(snapshot);
      if (undoStack.length > 20) undoStack.shift();
      emit();
    }
  } catch (err) {
    ws = snapshot;
    banner = { kind: "error", text: err.message || String(err) };
    emit();
    throw err;
  }
}

export function toast(kind, text) {
  banner = { kind, text };
  emit();
}

export function resetToDemo() {
  ws = studio();
  lastGood = clone(ws);
  persist(false);
  banner = { kind: "ok", text: "Loaded Studio demo workspace." };
  emit();
}

export function exportJSON() {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, workspace: ws }, null, 2);
}

export function downloadJSON() {
  const blob = new Blob([exportJSON()], { type: "application/json" });
  triggerDownload(blob, `${slug(ws.name)}-lattice.json`);
}

export function importJSON(text, mode) {
  const doc = JSON.parse(text);
  const incoming = migrate(doc);
  const issues = validate(incoming);
  if (issues.length) repair(incoming);
  if (mode === "replace") {
    ws = incoming;
  } else {
    ws = mergeWorkspaces(ws, incoming);
  }
  lastGood = clone(ws);
  persist(false);
  banner = { kind: "ok", text: mode === "replace" ? "Workspace replaced." : "Pages merged." };
  emit();
}

function mergeWorkspaces(base, incoming) {
  const out = clone(base);
  mergeById(out.personas, incoming.personas);
  mergeById(out.pages, incoming.pages);
  mergeById(out.blocks, incoming.blocks);
  mergeById(out.comments, incoming.comments);
  mergeById(out.databases, incoming.databases);
  out.activity = [...(incoming.activity || []), ...(out.activity || [])].slice(0, 100);
  if (incoming.name) out.name = incoming.name;
  if (incoming.actingPersonaId) out.actingPersonaId = incoming.actingPersonaId;
  return out;
}

function mergeById(arr, extra) {
  const map = new Map(arr.map((x) => [x.id, x]));
  for (const item of extra || []) map.set(item.id, item);
  arr.length = 0;
  arr.push(...map.values());
}

export function exportCSV(database, rows, properties) {
  const cols = properties.filter((p) => p.type !== "title");
  const header = ["Title", ...cols.map((p) => p.name)];
  const lines = [header.map(csvCell).join(",")];
  for (const page of rows) {
    const cells = [page.title, ...cols.map((p) => csvValue(page.properties?.[p.id], p))];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n");
}

export function downloadCSV(filename, csv) {
  triggerDownload(new Blob([csv], { type: "text/csv" }), filename);
}

export function importCSV(database, text, mapping) {
  const records = parseCSV(text);
  if (!records.length) throw new Error("CSV is empty.");
  const header = records[0].map((h) => h.trim());
  const body = records.slice(1);
  const created = [];
  mutate((w) => {
    for (const row of body) {
      if (row.every((c) => !c.trim())) continue;
      const page = {
        id: crypto.randomUUID(),
        title: "Untitled",
        parentPageId: database.pageId,
        icon: "",
        cover: "",
        createdAt: now(),
        updatedAt: now(),
        type: "page",
        childBlockIds: [],
        properties: {},
        archived: false,
      };
      header.forEach((col, i) => {
        const propId = mapping[col];
        const raw = row[i] ?? "";
        if (!propId) return;
        if (propId === "__title__") {
          page.title = raw || "Untitled";
          return;
        }
        const prop = database.properties.find((p) => p.id === propId);
        if (!prop) return;
        page.properties[prop.id] = coerceCSV(raw, prop);
      });
      w.pages.push(page);
      created.push(page);
    }
  });
  return created.length;
}

function coerceCSV(raw, prop) {
  const s = raw.trim();
  if (prop.type === "checkbox") return /^(1|true|yes|x)$/i.test(s);
  if (prop.type === "number") return s === "" ? null : Number(s);
  if (prop.type === "person" || prop.type === "relation" || prop.type === "blocking") {
    return s ? s.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : [];
  }
  return s || null;
}

function csvValue(v, prop) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const src = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function triggerDownload(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function slug(name) {
  return String(name || "lattice").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lattice";
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) {
    banner = { kind: "warn", text: "Nothing to undo." };
    emit();
    return;
  }
  ws = prev;
  lastGood = clone(ws);
  persist(false);
  emit();
}
