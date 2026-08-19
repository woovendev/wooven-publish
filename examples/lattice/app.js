/** Boot: sidebar, canvas, command palette, import/export, personas. */

import {
  getPage, getPersona, getPersonaByHandle, wikiPages, rootPages, childPages,
  breadcrumbs, searchPages, createPage, createBlock, createPersona, appendBlock,
  initialsFrom, now, archivePage, resolveWikiTitle, pushActivity, mentionHandles,
  dbByPageId,
} from "./model.js?v=3";
import {
  load, getWorkspace, subscribe, getBanner, clearBanner, mutate, toast,
  downloadJSON, importJSON, exportCSV, downloadCSV, resetToDemo, undo, importCSV,
} from "./store.js?v=3";
import { renderPage, renderComments, slashHtml, slashIndexClick, applySlash, getSlash, closeSlash, renderInline, esc } from "./editor.js?v=3";
import { renderDatabase, renderProps, renderMyWork, renderWorkload, renderReport } from "./views.js?v=3";
import { myWork, workload, report, tasksByPersona } from "./work.js?v=3";

const $ = (sel, el = document) => el.querySelector(sel);

let route = parseHash();
let ui = {
  search: "",
  cmdk: false,
  cmdq: "",
  personaEdit: null,
  importOpen: false,
  focusedBlock: null,
  viewId: null,
  personaFilter: null,
  viewByPage: {},
  filterByPage: {},
};

const THEME_KEY = "lattice:theme";

function currentTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme = currentTheme()) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  renderSidebar(getWorkspace());
}

function parseHash() {
  const h = (location.hash || "#/page/page-home").slice(1);
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "my-work") return { kind: "my-work" };
  if (parts[0] === "workload") return { kind: "workload" };
  if (parts[0] === "report") return { kind: "report" };
  if (parts[0] === "persona" && parts[1]) return { kind: "persona", id: parts[1] };
  if (parts[0] === "page" && parts[1]) return { kind: "page", id: parts[1] };
  return { kind: "page", id: "page-home" };
}

function go(next) {
  route = next;
  ui.viewId = next.kind === "page" ? (ui.viewByPage[next.id] || null) : null;
  ui.personaFilter = next.kind === "page" ? (ui.filterByPage[next.id] || null) : null;
  ui.focusedBlock = null;
  const hash =
    next.kind === "page" ? `#/page/${next.id}`
    : next.kind === "persona" ? `#/persona/${next.id}`
    : `#/${next.kind}`;
  if (location.hash !== hash) history.pushState(null, "", hash);
  render();
}

const ctx = {
  get viewId() { return ui.viewId; },
  get personaFilter() { return ui.personaFilter; },
  openPage: (id) => go({ kind: "page", id }),
  openPersona: (id) => go({ kind: "persona", id }),
  openWiki: (title) => {
    const ws = getWorkspace();
    let page = resolveWikiTitle(ws, title);
    if (!page) {
      mutate((w) => {
        page = createPage({ title, parentPageId: null, icon: "📄" });
        w.pages.push(page);
        appendBlock(w, page, createBlock({ type: "paragraph", content: "" }));
      });
      page = resolveWikiTitle(getWorkspace(), title);
    }
    go({ kind: "page", id: page.id });
  },
  focusBlock: (id) => {
    ui.focusedBlock = id;
    renderCommentsPane();
  },
  setView: (id) => {
    ui.viewId = id;
    if (route.kind === "page") ui.viewByPage[route.id] = id;
    render();
  },
  setPersonaFilter: (id) => {
    ui.personaFilter = id;
    if (route.kind === "page") ui.filterByPage[route.id] = id;
    render();
  },
  exportCSV: (db, view, rows) => {
    const csv = exportCSV(db, rows, db.properties);
    downloadCSV(`${slug(db.pageId)}-${view.name}.csv`, csv);
  },
  ws: () => getWorkspace(),
  redraw: () => render(),
  redrawOverlays: () => renderOverlays(),
};

function slug(s) {
  return String(s || "db").slice(0, 24);
}

function render() {
  const ws = getWorkspace();
  document.title = `${ws.name} — Lattice`;
  renderBanner();
  renderSidebar(ws);
  renderCanvas(ws);
  renderCommentsPane();
  renderOverlays();
}

function renderBanner() {
  const b = getBanner();
  const el = $("#banner");
  if (!b) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `banner ${b.kind}`;
  el.innerHTML = `<span>${esc(b.text)}</span><button class="btn ghost" data-dismiss>Dismiss</button>`;
}

function renderSidebar(ws) {
  const acting = getPersona(ws, ws.actingPersonaId);
  const q = ui.search.trim().toLowerCase();
  const tree = q
    ? wikiPages(ws).filter((p) => p.title.toLowerCase().includes(q))
    : rootPages(ws);
  $("#sidebar").innerHTML = `
    <div class="brand">
      <span class="mark"></span>
      <input class="ws-name" value="${esc(ws.name)}" title="Workspace name">
      <button class="btn ghost mini theme-btn" data-theme title="Toggle color theme">${currentTheme() === "dark" ? "Light" : "Dark"}</button>
    </div>
    <input class="search" placeholder="Search pages…" value="${esc(ui.search)}">
    <label class="acting">Acting as
      <select data-acting>
        ${ws.personas.filter((p) => !p.archived).map((p) => `<option value="${p.id}" ${p.id === ws.actingPersonaId ? "selected" : ""}>${esc(p.name)} / ${esc(p.role)}</option>`).join("")}
      </select>
    </label>
    <nav class="side-nav">
      <button data-go="my-work" class="${route.kind === "my-work" ? "on" : ""}">My work</button>
      <button data-go="workload" class="${route.kind === "workload" ? "on" : ""}">Workload</button>
      <button data-go="report" class="${route.kind === "report" ? "on" : ""}">Report</button>
    </nav>
    <div class="side-label">Pages</div>
    <div class="tree">${tree.map((p) => treeItem(ws, p, 0, q)).join("")}</div>
    <div class="side-label">Personas <button class="btn ghost mini" data-new-persona>+</button></div>
    <div class="personas">
      ${ws.personas.filter((p) => !p.archived).map((p) => `<button class="persona${route.kind === "persona" && route.id === p.id ? " on" : ""}" data-persona="${p.id}">
        <span class="dot" style="background:${p.color}"></span>${esc(p.name)} <span class="ph">${esc(p.role)}</span>
      </button>`).join("")}
    </div>
    <div class="side-foot">
      <button class="btn" data-theme>${currentTheme() === "dark" ? "Light mode" : "Dark mode"}</button>
      <button class="btn ghost" data-cmd>⌘K Jump</button>
      <button class="btn ghost" data-export>Export</button>
      <button class="btn ghost" data-import>Import</button>
      <button class="btn ghost" data-demo>Demo</button>
    </div>
  `;
  $("#sidebar .ws-name").onchange = (e) => mutate((w) => { w.name = e.target.value.trim() || w.name; });
  $("#sidebar .search").oninput = (e) => {
    ui.search = e.target.value;
    renderSidebar(getWorkspace());
  };
  $("#sidebar [data-acting]").onchange = (e) => mutate((w) => { w.actingPersonaId = e.target.value; });
  $("#sidebar").onclick = (e) => {
    if (e.target.closest("[data-theme]")) return toggleTheme();
    const goBtn = e.target.closest("[data-go]");
    if (goBtn) return go({ kind: goBtn.dataset.go });
    const pageBtn = e.target.closest("[data-page]");
    if (pageBtn) return go({ kind: "page", id: pageBtn.dataset.page });
    const per = e.target.closest("[data-persona]");
    if (per) return go({ kind: "persona", id: per.dataset.persona });
    if (e.target.closest("[data-new-persona]")) return openPersonaEdit(null);
    if (e.target.closest("[data-cmd]")) {
      ui.cmdk = true;
      renderOverlays();
      return;
    }
    if (e.target.closest("[data-export]")) return downloadJSON();
    if (e.target.closest("[data-import]")) {
      ui.importOpen = true;
      renderOverlays();
      return;
    }
    if (e.target.closest("[data-demo]")) {
      if (confirm("Replace the current workspace with the Studio demo?")) resetToDemo();
    }
  };
  void acting;
}

function treeItem(ws, page, depth, flattening) {
  const kids = flattening ? [] : childPages(ws, page.id);
  const on = route.kind === "page" && route.id === page.id;
  return `<div class="tree-item" style="padding-left:${8 + depth * 12}px">
    <button class="tree-btn${on ? " on" : ""}" data-page="${page.id}">${esc(page.icon || "·")} ${esc(page.title)}</button>
  </div>${kids.map((k) => treeItem(ws, k, depth + 1, flattening)).join("")}`;
}

function renderCanvas(ws) {
  const main = $("#canvas");
  if (route.kind === "my-work") {
    const acting = getPersona(ws, ws.actingPersonaId);
    main.innerHTML = canvasHeader(`My work`, `Open tasks for ${acting ? "@" + acting.handle : "—"}`);
    renderMyWork(ensureBody(main), ws, ctx, myWork(ws, ws.actingPersonaId));
    return;
  }
  if (route.kind === "workload") {
    main.innerHTML = canvasHeader("Workload", "This week · capacity is a soft budget");
    renderWorkload(ensureBody(main), ws, ctx, workload(ws));
    return;
  }
  if (route.kind === "report") {
    main.innerHTML = canvasHeader("Report", "Open vs done, overdue, blocked");
    renderReport(ensureBody(main), ws, ctx, report(ws));
    return;
  }
  if (route.kind === "persona") {
    const p = getPersona(ws, route.id);
    if (!p) {
      main.innerHTML = `<p class="ph">Unknown persona.</p>`;
      return;
    }
    const cols = tasksByPersona(ws);
    const tasks = cols.get(p.id) || [];
    main.innerHTML = canvasHeader(`${p.name}`, `${p.role} · @${p.handle} · ${p.capacityHoursPerWeek || 0}h/week`)
      + `<div class="persona-actions"><button class="btn" data-edit-p>Edit</button></div>`;
    const body = ensureBody(main);
    body.innerHTML = tasks.map((t) => `<button class="link" data-open="${t.id}">${esc(t.title)}</button>`).join("") || `<p class="ph">No open tasks.</p>`;
    main.querySelector("[data-edit-p]").onclick = () => openPersonaEdit(p.id);
    body.onclick = (e) => {
      const open = e.target.closest("[data-open]");
      if (open) ctx.openPage(open.dataset.open);
    };
    return;
  }

  const page = getPage(ws, route.id) || getPage(ws, "page-home") || wikiPages(ws)[0];
  if (!page) {
    main.innerHTML = `<p class="ph">No pages.</p>`;
    return;
  }
  const crumbs = breadcrumbs(ws, page).map((p) => `<button class="crumb" data-open="${p.id}">${esc(p.title)}</button>`).join("<span>/</span>");
  main.innerHTML = `
    <div class="crumbs">${crumbs}</div>
    <header class="page-head">
      <input class="icon-in" value="${esc(page.icon || "")}" maxlength="4" title="Icon">
      <input class="title-in" value="${esc(page.title)}" placeholder="Untitled">
      <button class="btn ghost" data-new-child>+ Page</button>
    </header>
    <div id="props"></div>
    <div id="page-body" class="page-body"></div>`;
  main.querySelector(".title-in").onchange = (e) => mutate((w) => {
    const p = getPage(w, page.id);
    p.title = e.target.value.trim() || "Untitled";
    p.updatedAt = now();
  });
  main.querySelector(".icon-in").onchange = (e) => mutate((w) => {
    getPage(w, page.id).icon = e.target.value;
  });
  main.querySelector("[data-new-child]").onclick = () => {
    let id = null;
    mutate((w) => {
      const child = createPage({ title: "Untitled", parentPageId: page.id, icon: "📄" });
      w.pages.push(child);
      appendBlock(w, child, createBlock({ type: "paragraph", content: "" }));
      id = child.id;
    });
    go({ kind: "page", id });
  };
  main.querySelector(".crumbs").onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
  renderProps($("#props"), ws, page, ctx);
  const body = $("#page-body");
  if (page.type === "database") renderDatabase(body, ws, page, ctx);
  else renderPage(body, ws, page, ctx);
}

function canvasHeader(title, sub) {
  return `<header class="page-head screen"><h1>${esc(title)}</h1><p class="ph">${esc(sub)}</p></header><div id="page-body" class="page-body"></div>`;
}

function ensureBody(main) {
  return main.querySelector("#page-body") || main;
}

function renderCommentsPane() {
  const ws = getWorkspace();
  renderComments($("#comments"), ws, ui.focusedBlock, ctx);
}

function renderOverlays() {
  const ws = getWorkspace();
  const layer = $("#overlays");
  let html = slashHtml();
  if (ui.cmdk) html += cmdkHtml(ws);
  if (ui.personaEdit !== null) html += personaModal(ws);
  if (ui.importOpen) html += importModal();
  layer.innerHTML = html;
  layer.querySelectorAll("[data-slash-i]").forEach((btn) => {
    btn.onclick = () => {
      const page = getPage(ws, route.id);
      slashIndexClick(Number(btn.dataset.slashI), page, ctx);
    };
  });
  const cmd = layer.querySelector("#cmdk-input");
  if (cmd) {
    cmd.focus();
    cmd.oninput = (e) => {
      ui.cmdq = e.target.value;
      renderOverlays();
      $("#cmdk-input")?.focus();
    };
    cmd.onkeydown = (e) => {
      if (e.key === "Escape") {
        ui.cmdk = false;
        renderOverlays();
      }
      if (e.key === "Enter") {
        const first = layer.querySelector("[data-jump]");
        if (first) first.click();
      }
    };
  }
  layer.querySelectorAll("[data-jump]").forEach((b) => {
    b.onclick = () => {
      ui.cmdk = false;
      const [kind, id] = b.dataset.jump.split(":");
      go({ kind, id });
    };
  });
  const form = layer.querySelector("#persona-form");
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      savePersona(new FormData(form));
    };
    form.querySelector("[data-cancel]")?.addEventListener("click", () => {
      ui.personaEdit = null;
      renderOverlays();
    });
    form.querySelector("[data-archive-p]")?.addEventListener("click", () => {
      mutate((w) => {
        const p = getPersona(w, ui.personaEdit);
        if (p) p.archived = true;
      });
      ui.personaEdit = null;
    });
  }
  const imp = layer.querySelector("#import-form");
  if (imp) {
    imp.onsubmit = (e) => {
      e.preventDefault();
      const file = imp.querySelector("input[type=file]").files[0];
      const mode = imp.mode.value;
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (file.name.endsWith(".csv")) {
            const page = getPage(getWorkspace(), route.id);
            importCsvFile(page, String(reader.result));
          } else {
            importJSON(String(reader.result), mode);
          }
          ui.importOpen = false;
        } catch (err) {
          toast("error", err.message);
        }
      };
      reader.readAsText(file);
    };
    imp.querySelector("[data-cancel]").onclick = () => {
      ui.importOpen = false;
      renderOverlays();
    };
  }
}

function importCsvFile(page, text) {
  const ws = getWorkspace();
  const db = dbByPageId(ws, page?.id);
  if (!db) throw new Error("Open a database to import CSV.");
  const first = text.split(/\r?\n/)[0] || "";
  const cols = first.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const mapping = {};
  for (const col of cols) {
    if (/^title$/i.test(col)) mapping[col] = "__title__";
    else {
      const prop = db.properties.find((p) => p.name.toLowerCase() === col.toLowerCase());
      if (prop) mapping[col] = prop.id;
    }
  }
  const n = importCSV(db, text, mapping);
  toast("ok", `Imported ${n} rows.`);
}

function cmdkHtml(ws) {
  const q = (ui.cmdq || "").toLowerCase();
  const pages = searchPages(ws, q).slice(0, 12);
  const fallback = !q ? wikiPages(ws).slice(0, 8) : pages;
  const personas = ws.personas.filter((p) => !p.archived && (!q || p.name.toLowerCase().includes(q) || p.handle.includes(q)));
  const tasks = ws.pages.filter((p) => !p.archived && p.parentPageId === "page-tasks" && (!q || p.title.toLowerCase().includes(q))).slice(0, 8);
  return `<div class="modal-bg" data-close-cmd>
    <div class="modal cmdk" role="dialog">
      <input id="cmdk-input" placeholder="Jump to page, persona, task…" value="${esc(ui.cmdq)}">
      <div class="cmdk-list">
        ${fallback.map((p) => `<button data-jump="page:${p.id}">${esc(p.icon || "")} ${esc(p.title)}</button>`).join("")}
        ${personas.map((p) => `<button data-jump="persona:${p.id}"><span class="dot" style="background:${p.color}"></span> @${esc(p.handle)}</button>`).join("")}
        ${q ? tasks.map((p) => `<button data-jump="page:${p.id}">☑ ${esc(p.title)}</button>`).join("") : ""}
      </div>
    </div>
  </div>`;
}

function personaModal(ws) {
  const p = ui.personaEdit ? getPersona(ws, ui.personaEdit) : {
    name: "", handle: "", color: "#0f766e", role: "", capacityHoursPerWeek: 30,
  };
  return `<div class="modal-bg">
    <form class="modal" id="persona-form">
      <h2>${ui.personaEdit ? "Edit persona" : "New persona"}</h2>
      <label>Name <input name="name" required value="${esc(p.name)}"></label>
      <label>Handle <input name="handle" required value="${esc(p.handle)}"></label>
      <label>Role <input name="role" value="${esc(p.role)}"></label>
      <label>Color <input name="color" type="color" value="${esc(p.color)}"></label>
      <label>Capacity h/week <input name="capacity" type="number" min="0" value="${p.capacityHoursPerWeek || 0}"></label>
      <div class="row">
        <button class="btn primary" type="submit">Save</button>
        <button class="btn ghost" type="button" data-cancel>Cancel</button>
        ${ui.personaEdit ? `<button class="btn ghost danger" type="button" data-archive-p>Archive</button>` : ""}
      </div>
    </form>
  </div>`;
}

function importModal() {
  return `<div class="modal-bg">
    <form class="modal" id="import-form">
      <h2>Import</h2>
      <p class="ph">JSON replaces or merges. CSV maps columns into the open database.</p>
      <input type="file" accept=".json,.csv,application/json,text/csv" required>
      <label><input type="radio" name="mode" value="replace"> Replace workspace</label>
      <label><input type="radio" name="mode" value="merge" checked> Merge pages</label>
      <div class="row">
        <button class="btn primary" type="submit">Import</button>
        <button class="btn ghost" type="button" data-cancel>Cancel</button>
      </div>
    </form>
  </div>`;
}

function openPersonaEdit(id) {
  ui.personaEdit = id || "";
  renderOverlays();
}

function savePersona(fd) {
  const name = String(fd.get("name") || "").trim();
  const handle = String(fd.get("handle") || "").trim().replace(/^@/, "").toLowerCase();
  const role = String(fd.get("role") || "").trim();
  const color = String(fd.get("color") || "#0f766e");
  const capacity = Number(fd.get("capacity")) || 0;
  mutate((w) => {
    if (ui.personaEdit) {
      const p = getPersona(w, ui.personaEdit);
      Object.assign(p, { name, handle, role, color, capacityHoursPerWeek: capacity, initials: initialsFrom(name) });
    } else {
      const p = createPersona({ name, handle, role, color, capacityHoursPerWeek: capacity });
      w.personas.push(p);
    }
  });
  ui.personaEdit = null;
}

function onGlobalKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "k") {
    e.preventDefault();
    ui.cmdk = !ui.cmdk;
    ui.cmdq = "";
    renderOverlays();
    return;
  }
  if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
    const tag = document.activeElement?.getAttribute?.("contenteditable");
    if (tag) return;
    e.preventDefault();
    undo();
    return;
  }
  if (e.key === "Escape") {
    ui.cmdk = false;
    ui.importOpen = false;
    ui.personaEdit = null;
    closeSlash();
    renderOverlays();
  }
}

function boot() {
  applyTheme();
  load();
  subscribe(() => render());
  window.addEventListener("hashchange", () => {
    route = parseHash();
    if (route.kind === "page") {
      ui.viewId = ui.viewByPage[route.id] || null;
      ui.personaFilter = ui.filterByPage[route.id] || null;
    }
    render();
  });
  document.addEventListener("keydown", onGlobalKey);
  $("#banner").addEventListener("click", (e) => {
    if (e.target.closest("[data-dismiss]")) clearBanner();
  });
  $("#overlays").addEventListener("click", (e) => {
    if (e.target.closest("[data-close-cmd]") === e.target) {
      ui.cmdk = false;
      renderOverlays();
    }
  });
  window.lattice = { getWorkspace, mutate, toast, go, ctx, ui, toggleTheme };
  render();
}

boot();
