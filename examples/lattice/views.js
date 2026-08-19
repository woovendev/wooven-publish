/** Database views: table, board, list, calendar, timeline, gallery. */

import {
  TASK_PROP, PROJECT_PROP, TASK_STATUSES, PROJECT_STATUSES,
  getPage, getPersona, getProp, setProp, asIdList, dbByPageId, dbRows,
  propById, now, createPage, createBlock, appendBlock, archivePage,
  blockedByPages, childTasks, taskProgress, tasksForProject, setBlocking,
} from "./model.js";
import { mutate } from "./store.js";
import { esc, renderInline } from "./editor.js";
import {
  dueOf, startOf, taskStatus, assigneesOf, ownerOf, blockerLabel, progressLabel,
  setStatus, isOverdue, isOpenTask, createTask, createProject,
} from "./work.js";

export function renderDatabase(root, ws, page, ctx) {
  const db = dbByPageId(ws, page.id);
  if (!db) {
    root.innerHTML = `<p class="ph">Not a database.</p>`;
    return;
  }
  const view = db.views.find((v) => v.id === (ctx.viewId || db.defaultViewId)) || db.views[0];
  let rows = applyFilters(ws, db, dbRows(ws, db), view, ctx.personaFilter);
  rows = applySorts(db, rows, view);
  root.innerHTML = `
    <div class="db-toolbar">
      <div class="view-tabs">
        ${db.views.map((v) => `<button type="button" class="tab${v.id === view.id ? " on" : ""}" data-view="${v.id}">${esc(v.name)}</button>`).join("")}
      </div>
      <label class="filter">Persona
        <select data-persona-filter>
          <option value="">All</option>
          ${ws.personas.filter((p) => !p.archived).map((p) => `<option value="${p.id}" ${ctx.personaFilter === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
        </select>
      </label>
      <button class="btn" data-new-row>+ New</button>
      <button class="btn ghost" data-csv>CSV</button>
    </div>
    <div class="db-body" data-layout="${view.layout}"></div>`;
  const body = root.querySelector(".db-body");
  const layout = view.layout;
  if (layout === "board") renderBoard(body, ws, db, rows, view, ctx);
  else if (layout === "list") renderList(body, ws, db, rows, ctx);
  else if (layout === "calendar") renderCalendar(body, ws, db, rows, ctx);
  else if (layout === "timeline") renderTimeline(body, ws, db, rows, ctx);
  else if (layout === "gallery") renderGallery(body, ws, db, rows, ctx);
  else renderTable(body, ws, db, rows, ctx);

  root.querySelector(".view-tabs").onclick = (e) => {
    const t = e.target.closest("[data-view]");
    if (t) ctx.setView(t.dataset.view);
  };
  root.querySelector("[data-persona-filter]").onchange = (e) => {
    ctx.setPersonaFilter(e.target.value || null);
  };
  root.querySelector("[data-new-row]").onclick = () => {
    if (db.id === "db-tasks") {
      const created = createTask(ws, { title: "Untitled" });
      if (created) ctx.openPage(created.id);
      return;
    }
    if (db.id === "db-projects") {
      const created = createProject({ title: "Untitled project" });
      if (created) ctx.openPage(created.id);
      return;
    }
    let id = null;
    mutate((w) => {
      const p = createPage({ title: "Untitled", parentPageId: db.pageId, properties: {} });
      w.pages.push(p);
      appendBlock(w, p, createBlock({ type: "paragraph", content: "" }));
      id = p.id;
    });
    if (id) ctx.openPage(id);
  };
  root.querySelector("[data-csv]").onclick = () => ctx.exportCSV(db, view, rows);
}

function applyFilters(ws, db, rows, view, personaFilter) {
  let out = rows;
  for (const f of view.filters || []) {
    out = out.filter((p) => matchFilter(p, db, f));
  }
  if (personaFilter) {
    out = out.filter((p) => {
      const people = asIdList(p.properties?.[TASK_PROP.assignees]).concat(asIdList(p.properties?.[PROJECT_PROP.owner]));
      return people.includes(personaFilter);
    });
  }
  return out;
}

function matchFilter(page, db, f) {
  const v = getProp(page, db, f.propId);
  if (f.op === "eq") return String(v ?? "") === String(f.value ?? "");
  if (f.op === "neq") return String(v ?? "") !== String(f.value ?? "");
  return true;
}

function applySorts(db, rows, view) {
  const sorts = view.sorts || [];
  if (!sorts.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const av = String(getProp(a, db, s.propId) ?? "");
      const bv = String(getProp(b, db, s.propId) ?? "");
      const c = av.localeCompare(bv);
      if (c) return s.dir === "desc" ? -c : c;
    }
    return 0;
  });
}

function renderTable(el, ws, db, rows, ctx) {
  const cols = db.properties.filter((p) => p.type !== "title");
  el.innerHTML = `<div class="table-wrap"><table class="db-table">
    <thead><tr><th>Title</th>${cols.map((c) => `<th>${esc(c.name)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map((row) => `<tr data-open-row="${row.id}">
        <td class="title-cell"><button class="link" data-open="${row.id}">${esc(row.icon || "")} ${esc(row.title)}</button></td>
        ${cols.map((c) => `<td>${cellHtml(ws, db, row, c)}</td>`).join("")}
      </tr>`).join("") || `<tr><td colspan="${cols.length + 1}" class="ph">No rows</td></tr>`}
    </tbody>
  </table></div>`;
  bindCells(el, ws, db, ctx);
}

function cellHtml(ws, db, row, prop) {
  const v = row.properties?.[prop.id];
  if (prop.type === "status") return selectHtml(row.id, prop, v, prop.options || TASK_STATUSES);
  if (prop.type === "priority") return selectHtml(row.id, prop, v, ["", ... (prop.options || ["P1", "P2", "P3"])]);
  if (prop.type === "select") return selectHtml(row.id, prop, v, prop.options || []);
  if (prop.type === "date") return `<input type="date" data-prop="${row.id}:${prop.id}" value="${esc(v || "")}">`;
  if (prop.type === "number") return `<input type="number" step="0.5" data-prop="${row.id}:${prop.id}" value="${v ?? ""}">`;
  if (prop.type === "text") return `<input data-prop="${row.id}:${prop.id}" value="${esc(v || "")}">`;
  if (prop.type === "checkbox") return `<input type="checkbox" data-prop="${row.id}:${prop.id}" ${v ? "checked" : ""}>`;
  if (prop.type === "person") return peopleHtml(ws, row, prop, asIdList(v));
  if (prop.type === "relation" || prop.type === "blocking") return relationHtml(ws, row, prop, asIdList(v));
  return esc(v ?? "");
}

function selectHtml(rowId, prop, v, options) {
  return `<select data-prop="${rowId}:${prop.id}">${options.map((o) => `<option value="${esc(o)}" ${String(v || "") === o ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>`;
}

function peopleHtml(ws, row, prop, ids) {
  const chips = ids.map((id) => {
    const p = getPersona(ws, id);
    return p ? `<span class="chip person" style="--c:${p.color}">${esc(p.initials)}</span>` : "";
  }).join("");
  const opts = ws.personas.filter((p) => !p.archived).map((p) => `<option value="${p.id}" ${ids.includes(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  return `<div class="people-cell">${chips}<select multiple data-prop="${row.id}:${prop.id}">${opts}</select></div>`;
}

function relationHtml(ws, row, prop, ids) {
  const chips = ids.map((id) => {
    const p = getPage(ws, id);
    return p ? `<button class="chip" data-open="${p.id}">${esc(p.title)}</button>` : "";
  }).join("");
  const candidates = ws.pages.filter((p) => !p.archived && p.id !== row.id && p.type === "page");
  const opts = candidates.slice(0, 80).map((p) => `<option value="${p.id}" ${ids.includes(p.id) ? "selected" : ""}>${esc(p.title)}</option>`).join("");
  return `<div class="rel-cell">${chips}<select data-prop="${row.id}:${prop.id}"><option value="">—</option>${opts}</select></div>`;
}

function bindCells(el, ws, db, ctx) {
  el.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
  el.onchange = (e) => {
    const field = e.target.closest("[data-prop]");
    if (!field) return;
    const [pageId, propId] = field.dataset.prop.split(":");
    const prop = propById(db, propId);
    let value;
    if (field.type === "checkbox") value = field.checked;
    else if (field.multiple) value = [...field.selectedOptions].map((o) => o.value);
    else if (prop?.type === "number") value = field.value === "" ? null : Number(field.value);
    else if (prop?.type === "relation" || prop?.type === "blocking" || prop?.type === "person") {
      value = field.value ? [field.value] : [];
      if (field.multiple) value = [...field.selectedOptions].map((o) => o.value);
    } else value = field.value;
    if (prop?.type === "status") {
      setStatus(pageId, value);
      return;
    }
    mutate((w) => {
      const page = getPage(w, pageId);
      if (prop?.type === "blocking") {
        setBlocking(w, page, value);
      } else {
        page.properties[propId] = value;
        page.updatedAt = now();
      }
    });
  };
}

function renderBoard(el, ws, db, rows, view, ctx) {
  const groupProp = propById(db, view.groupBy) || db.properties.find((p) => p.type === "status" || p.type === "person");
  let columns = [];
  if (groupProp?.type === "person") {
    columns = [{ id: "unassigned", name: "Unassigned" }, ...ws.personas.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name }))];
  } else {
    const opts = groupProp?.options || (db.id === "db-projects" ? PROJECT_STATUSES : TASK_STATUSES);
    columns = opts.map((o) => ({ id: o, name: o || "None" }));
  }
  el.innerHTML = `<div class="board">${columns.map((col) => {
    const cards = rows.filter((r) => inColumn(r, groupProp, col.id));
    return `<section class="lane" data-col="${col.id}">
      <header><span>${esc(col.name)}</span><span class="ph">${cards.length}</span></header>
      <div class="lane-cards">${cards.map((r) => cardHtml(ws, r)).join("") || `<div class="ph">Empty</div>`}</div>
    </section>`;
  }).join("")}</div>`;
  el.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
}

function inColumn(row, prop, colId) {
  if (!prop) return true;
  const v = row.properties?.[prop.id];
  if (prop.type === "person") {
    const ids = asIdList(v);
    if (colId === "unassigned") return !ids.length;
    return ids.includes(colId);
  }
  return String(v || "") === String(colId);
}

function cardHtml(ws, row) {
  const people = assigneesOf(row).concat(ownerOf(row) ? [ownerOf(row)] : []);
  const uniq = [...new Set(people)];
  const dots = uniq.map((id) => {
    const p = getPersona(ws, id);
    return p ? `<span class="dot" title="${esc(p.name)}" style="background:${p.color}"></span>` : "";
  }).join("");
  const due = dueOf(row);
  const blocked = blockerLabel(ws, row);
  const prog = progressLabel(ws, row);
  const overdue = isOverdue(row) ? " overdue" : "";
  return `<article class="card${overdue}${blocked ? " is-blocked" : ""}" data-open="${row.id}">
    <div class="card-title">${esc(row.title)}</div>
    <div class="card-meta">
      ${dots}
      ${due ? `<time>${esc(due)}</time>` : ""}
      ${prog ? `<span class="token">${esc(prog)}</span>` : ""}
    </div>
    ${blocked ? `<span class="blocked-chip">${esc(blocked)}</span>` : ""}
  </article>`;
}

function renderList(el, ws, db, rows, ctx) {
  const top = rows.filter((r) => !asIdList(r.properties?.[TASK_PROP.parent]).length);
  const rest = rows.filter((r) => asIdList(r.properties?.[TASK_PROP.parent]).length);
  const renderRow = (r, depth) => {
    const kids = rest.filter((k) => asIdList(k.properties?.[TASK_PROP.parent])[0] === r.id);
    const prog = progressLabel(ws, r);
    return `<div class="list-row" style="padding-left:${12 + depth * 18}px">
      <button class="link" data-open="${r.id}">${esc(r.title)}</button>
      <span class="token">${esc(taskStatus(r) || getProp(r, db, "Status") || "")}</span>
      ${prog ? `<span class="ph">${esc(prog)}</span>` : ""}
      ${blockerLabel(ws, r) ? `<span class="blocked-chip">blocked</span>` : ""}
    </div>${kids.map((k) => renderRow(k, depth + 1)).join("")}`;
  };
  el.innerHTML = `<div class="list">${top.map((r) => renderRow(r, 0)).join("") || `<p class="ph">No rows</p>`}</div>`;
  el.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
}

function renderCalendar(el, ws, db, rows, ctx) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({ iso, inMonth: d.getMonth() === month, items: rows.filter((r) => dueOf(r) === iso) });
  }
  el.innerHTML = `<div class="cal-head">${now.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
    <div class="cal-grid">
      ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
      ${cells.map((c) => `<div class="cal-day${c.inMonth ? "" : " dim"}">
        <span class="num">${Number(c.iso.slice(8))}</span>
        ${c.items.map((r) => `<button class="cal-item" data-open="${r.id}">${esc(r.title)}</button>`).join("")}
      </div>`).join("")}
    </div>`;
  el.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
}

function renderTimeline(el, ws, db, rows, ctx) {
  const dates = rows.flatMap((r) => [startOf(r), dueOf(r)].filter(Boolean)).sort();
  const min = dates[0] || new Date().toISOString().slice(0, 10);
  const max = dates[dates.length - 1] || min;
  const minT = Date.parse(min);
  const maxT = Date.parse(max) + 86400000;
  const span = Math.max(maxT - minT, 86400000 * 7);
  el.innerHTML = `<div class="timeline">
    ${rows.map((r) => {
      const a = Date.parse(startOf(r) || dueOf(r) || min);
      const b = Date.parse(dueOf(r) || startOf(r) || min) + 86400000;
      const left = ((a - minT) / span) * 100;
      const width = Math.max(4, ((b - a) / span) * 100);
      const blocked = blockerLabel(ws, r);
      return `<div class="tl-row">
        <button class="link tl-label" data-open="${r.id}">${esc(r.title)}</button>
        <div class="tl-track">
          <button class="tl-bar${blocked ? " blocked" : ""}" data-open="${r.id}" style="left:${left}%;width:${width}%" title="${esc(blocked || r.title)}"></button>
        </div>
      </div>`;
    }).join("") || `<p class="ph">No projects</p>`}
  </div>`;
  el.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
}

function renderGallery(el, ws, db, rows, ctx) {
  el.innerHTML = `<div class="gallery">${rows.map((r) => `<article class="gal-card" data-open="${r.id}">
    <div class="gal-cover">${esc(r.icon || "▦")}</div>
    <h3>${esc(r.title)}</h3>
    <div class="card-meta">${esc(taskStatus(r) || r.properties?.[PROJECT_PROP.status] || "")}
      ${dueOf(r) ? `<time>${esc(dueOf(r))}</time>` : ""}</div>
  </article>`).join("") || `<p class="ph">No cards</p>`}</div>`;
  el.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
}

export function renderProps(root, ws, page, ctx) {
  const db = page.parentPageId ? dbByPageId(ws, page.parentPageId) : null;
  if (!db) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = `<div class="prop-strip">${db.properties.map((p) => {
    if (p.type === "title") return "";
    return `<label>${esc(p.name)}${cellHtml(ws, db, page, p)}</label>`;
  }).join("")}
  <button class="btn ghost danger" data-archive>Archive</button>
  </div>`;
  bindCells(root, ws, db, ctx);
  root.querySelector("[data-archive]").onclick = () => {
    if (!confirm(`Archive “${page.title}”?`)) return;
    mutate((w) => archivePage(w, getPage(w, page.id)));
    ctx.openPage(db.pageId);
  };
}

export function renderMyWork(root, ws, ctx, groups) {
  const labels = { overdue: "Overdue", today: "Today", week: "This week", later: "Later" };
  root.innerHTML = `<div class="work-groups">${Object.entries(groups).map(([k, rows]) => `<section>
    <h2>${labels[k]} <span class="ph">${rows.length}</span></h2>
    ${rows.map((r) => cardHtml(ws, r)).join("") || `<p class="ph">Nothing here.</p>`}
  </section>`).join("")}</div>`;
  root.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
}

export function renderWorkload(root, ws, ctx, rows) {
  root.innerHTML = `<div class="workload">${rows.map((r) => {
    const cap = r.capacity || 0;
    const pct = r.hasHours && cap ? Math.min(100, Math.round((r.hours / cap) * 100)) : Math.min(100, r.open * 12);
    return `<button class="wl-row${r.over ? " over" : ""}" data-persona="${r.persona.id}">
      <span class="dot" style="background:${r.persona.color}"></span>
      <div class="wl-meta">
        <strong>${esc(r.persona.name)}</strong>
        <span class="ph">${esc(r.persona.role)} · ${r.open} open · ${r.overdue} overdue${r.hasHours ? ` · ${r.hours}h / ${cap}h` : ""}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
    </button>`;
  }).join("")}</div>`;
  root.onclick = (e) => {
    const p = e.target.closest("[data-persona]");
    if (p) ctx.openPersona(p.dataset.persona);
  };
}

export function renderReport(root, ws, ctx, data) {
  const maxP = Math.max(1, ...data.byPersona.map((x) => x.open));
  const maxJ = Math.max(1, ...data.byProject.map((x) => x.open + x.done));
  root.innerHTML = `<div class="report">
    <div class="stats">
      <div class="stat"><b>${data.open}</b><span>Open</span></div>
      <div class="stat"><b>${data.doneWeek}</b><span>Done this week</span></div>
      <div class="stat"><b>${data.overdue}</b><span>Overdue</span></div>
      <div class="stat"><b>${data.blocked}</b><span>Blocked</span></div>
    </div>
    <h2>By persona</h2>
    ${data.byPersona.map((x) => `<div class="bar-row"><span>${esc(x.persona.name)}</span><div class="bar"><i style="width:${(x.open / maxP) * 100}%"></i></div><span class="ph">${x.open} open · ${x.done} done</span></div>`).join("")}
    <h2>By project</h2>
    ${data.byProject.map((x) => `<div class="bar-row"><button class="link" data-open="${x.project.id}">${esc(x.project.title)}</button><div class="bar"><i style="width:${((x.open + x.done) / maxJ) * 100}%"></i></div><span class="ph">${x.open} open · ${x.done} done</span></div>`).join("")}
  </div>`;
  root.onclick = (e) => {
    const open = e.target.closest("[data-open]");
    if (open) ctx.openPage(open.dataset.open);
  };
}

export { cardHtml };
