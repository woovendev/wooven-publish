/** Lattice ontology: ids, factories, lookups, invariants. No I/O. */

export const SCHEMA_VERSION = 1;

export const TASK_STATUSES = ["Inbox", "Next", "Doing", "Blocked", "Done"];
export const PROJECT_STATUSES = ["Proposed", "Active", "Paused", "Done"];
export const PRIORITIES = ["P1", "P2", "P3"];
export const RECURRENCE = ["none", "daily", "weekly", "weekday", "monthly"];
export const VIEW_LAYOUTS = ["table", "board", "list", "calendar", "timeline", "gallery"];
export const BLOCK_TYPES = [
  "paragraph", "heading1", "heading2", "heading3",
  "bullet", "numbered", "todo", "toggle", "quote", "callout",
  "divider", "code", "image", "embed", "table", "databaseView",
  "mention", "page",
];
export const PROP_TYPES = [
  "title", "status", "priority", "date", "person", "relation",
  "checkbox", "select", "number", "text", "blocking",
];

export const TASK_PROP = {
  status: "t-status",
  priority: "t-priority",
  due: "t-due",
  assignees: "t-assignees",
  project: "t-project",
  parent: "t-parent",
  blocking: "t-blocking",
  recurrence: "t-recurrence",
  estimate: "t-estimate",
};
export const PROJECT_PROP = {
  status: "p-status",
  priority: "p-priority",
  start: "p-start",
  due: "p-due",
  owner: "p-owner",
  blocking: "p-blocking",
  summary: "p-summary",
};

export function uid() {
  return crypto.randomUUID();
}

export function now() {
  return new Date().toISOString();
}

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

export function createWorkspace(partial = {}) {
  const t = now();
  return {
    id: uid(),
    name: "Workspace",
    updatedAt: t,
    actingPersonaId: null,
    personas: [],
    pages: [],
    blocks: [],
    comments: [],
    databases: [],
    activity: [],
    ...partial,
  };
}

export function createPersona(partial = {}) {
  const name = partial.name || "Persona";
  return {
    id: uid(),
    name,
    handle: (partial.handle || name).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "persona",
    color: "#0f766e",
    role: "",
    initials: initialsFrom(name),
    capacityHoursPerWeek: 40,
    archived: false,
    ...partial,
  };
}

export function initialsFrom(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

export function createPage(partial = {}) {
  const t = now();
  return {
    id: uid(),
    title: "Untitled",
    parentPageId: null,
    icon: "",
    cover: "",
    createdAt: t,
    updatedAt: t,
    type: "page",
    childBlockIds: [],
    properties: {},
    archived: false,
    ...partial,
  };
}

export function createBlock(partial = {}) {
  const t = now();
  return {
    id: uid(),
    pageId: partial.pageId || "",
    type: "paragraph",
    content: "",
    props: {},
    childBlockIds: [],
    createdAt: t,
    updatedAt: t,
    ...partial,
  };
}

export function createComment(partial = {}) {
  return {
    id: uid(),
    blockId: "",
    personaId: "",
    body: "",
    parentCommentId: null,
    createdAt: now(),
    ...partial,
  };
}

export function createDatabase(partial = {}) {
  return {
    id: uid(),
    pageId: "",
    properties: [],
    views: [],
    defaultViewId: "",
    ...partial,
  };
}

export function createProperty(partial = {}) {
  return {
    id: uid(),
    name: "Property",
    type: "text",
    options: [],
    ...partial,
  };
}

export function createView(partial = {}) {
  return {
    id: uid(),
    name: "View",
    layout: "table",
    filters: [],
    sorts: [],
    groupBy: null,
    ...partial,
  };
}

export function createEvent(partial = {}) {
  return {
    id: uid(),
    type: "note",
    personaId: null,
    targetId: null,
    body: "",
    createdAt: now(),
    ...partial,
  };
}

export function getPage(ws, id) {
  return ws.pages.find((p) => p.id === id) || null;
}
export function getBlock(ws, id) {
  return ws.blocks.find((b) => b.id === id) || null;
}
export function getPersona(ws, id) {
  return ws.personas.find((p) => p.id === id) || null;
}
export function getPersonaByHandle(ws, handle) {
  const h = String(handle || "").replace(/^@/, "").toLowerCase();
  return ws.personas.find((p) => !p.archived && p.handle.toLowerCase() === h) || null;
}
export function getDatabase(ws, id) {
  return ws.databases.find((d) => d.id === id) || null;
}
export function dbByPageId(ws, pageId) {
  return ws.databases.find((d) => d.pageId === pageId) || null;
}
export function getComment(ws, id) {
  return ws.comments.find((c) => c.id === id) || null;
}

export function isDbRow(ws, page) {
  if (!page || page.type === "database") return false;
  const parent = page.parentPageId ? getPage(ws, page.parentPageId) : null;
  return parent?.type === "database";
}

export function databaseForPage(ws, page) {
  if (!page) return null;
  if (page.type === "database") return dbByPageId(ws, page.id);
  if (page.parentPageId) {
    const parent = getPage(ws, page.parentPageId);
    if (parent?.type === "database") return dbByPageId(ws, parent.id);
  }
  return null;
}

export function dbRows(ws, db, { includeArchived = false } = {}) {
  if (!db) return [];
  return ws.pages.filter((p) => p.parentPageId === db.pageId && (includeArchived || !p.archived));
}

export function wikiPages(ws) {
  return ws.pages.filter((p) => !p.archived && (p.type === "database" || !isDbRow(ws, p)));
}

export function childPages(ws, parentId) {
  return wikiPages(ws).filter((p) => p.parentPageId === parentId);
}

export function rootPages(ws) {
  return wikiPages(ws).filter((p) => !p.parentPageId);
}

export function pageBlocks(ws, page) {
  if (!page) return [];
  return (page.childBlockIds || []).map((id) => getBlock(ws, id)).filter(Boolean);
}

export function propByName(db, name) {
  return db?.properties.find((p) => p.name.toLowerCase() === String(name).toLowerCase()) || null;
}

export function propById(db, id) {
  return db?.properties.find((p) => p.id === id) || null;
}

export function getProp(page, db, nameOrId) {
  if (!page || !db) return undefined;
  const p = propById(db, nameOrId) || propByName(db, nameOrId);
  if (!p) return undefined;
  if (p.type === "title") return page.title;
  return page.properties?.[p.id];
}

export function setProp(page, db, nameOrId, value) {
  const p = propById(db, nameOrId) || propByName(db, nameOrId);
  if (!p) return;
  if (p.type === "title") {
    page.title = value == null ? "" : String(value);
    return;
  }
  if (!page.properties) page.properties = {};
  page.properties[p.id] = value;
}

export function asIdList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return [v];
}

export function blockingProp(db) {
  return db?.properties.find((p) => p.type === "blocking") || null;
}

/** Pages this page must finish before (ids this page blocks). */
export function blockingIds(page, db) {
  const bp = blockingProp(db);
  if (!bp) return [];
  return asIdList(page.properties?.[bp.id]);
}

/** Pages that must finish before this one can start. */
export function blockedByPages(ws, pageId) {
  const out = [];
  for (const db of ws.databases) {
    const bp = blockingProp(db);
    if (!bp) continue;
    for (const row of dbRows(ws, db, { includeArchived: true })) {
      if (asIdList(row.properties?.[bp.id]).includes(pageId)) out.push(row);
    }
  }
  return out;
}

export function wouldCreateBlockCycle(ws, fromId, toId) {
  if (fromId === toId) return true;
  const seen = new Set();
  const stack = [toId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const page = getPage(ws, cur);
    const db = databaseForPage(ws, page);
    for (const next of blockingIds(page, db)) stack.push(next);
  }
  return false;
}

export function assertNoBlockCycle(ws, fromId, toIds) {
  for (const toId of asIdList(toIds)) {
    if (wouldCreateBlockCycle(ws, fromId, toId)) {
      const a = getPage(ws, fromId)?.title || fromId;
      const b = getPage(ws, toId)?.title || toId;
      throw new Error(`Blocking cycle: “${a}” → “${b}” would loop.`);
    }
  }
}

export function setBlocking(ws, page, ids) {
  const db = databaseForPage(ws, page);
  const bp = blockingProp(db);
  if (!bp) throw new Error("This page has no Blocking property.");
  const unique = [...new Set(asIdList(ids).filter((id) => id && id !== page.id))];
  assertNoBlockCycle(ws, page.id, unique);
  page.properties[bp.id] = unique;
  page.updatedAt = now();
}

export function tasksDb(ws) {
  return ws.databases.find((d) => d.id === "db-tasks" || propById(d, TASK_PROP.status)) || null;
}
export function projectsDb(ws) {
  return ws.databases.find((d) => d.id === "db-projects" || propById(d, PROJECT_PROP.status)) || null;
}

export function pageProjectIds(page) {
  return asIdList(page?.properties?.[TASK_PROP.project]);
}

export function tasksForProject(ws, projectId) {
  const db = tasksDb(ws);
  if (!db) return [];
  return dbRows(ws, db).filter((p) => pageProjectIds(p).includes(projectId));
}

export function parentTaskId(page) {
  const v = page?.properties?.[TASK_PROP.parent];
  return asIdList(v)[0] || null;
}

export function childTasks(ws, parentId) {
  const db = tasksDb(ws);
  if (!db) return [];
  return dbRows(ws, db).filter((p) => parentTaskId(p) === parentId);
}

export function taskProgress(ws, page) {
  const kids = childTasks(ws, page.id);
  if (!kids.length) return null;
  const done = kids.filter((k) => getProp(k, tasksDb(ws), TASK_PROP.status) === "Done").length;
  return { done, total: kids.length };
}

export function isDoneStatus(status) {
  return status === "Done";
}

export function commentsForBlock(ws, blockId) {
  return ws.comments
    .filter((c) => c.blockId === blockId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function commentCount(ws, blockId) {
  return ws.comments.filter((c) => c.blockId === blockId).length;
}

export function pushActivity(ws, event) {
  ws.activity.unshift(createEvent(event));
  if (ws.activity.length > 100) ws.activity.length = 100;
}

export function mentionHandles(text) {
  const out = [];
  const re = /(?:\[\[)?@([a-zA-Z0-9_]+)(?:\]\])?/g;
  let m;
  while ((m = re.exec(text || ""))) out.push(m[1].toLowerCase());
  return [...new Set(out)];
}

export function breadcrumbs(ws, page) {
  const chain = [];
  let cur = page;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentPageId ? getPage(ws, cur.parentPageId) : null;
  }
  return chain;
}

export function searchPages(ws, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return [];
  return ws.pages.filter((p) => !p.archived && p.title.toLowerCase().includes(s));
}

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Returns a list of issue strings. Empty = valid.
 * Cycle checks are also enforced at write time via assertNoBlockCycle.
 */
export function validate(ws) {
  const issues = [];
  if (!ws || typeof ws !== "object") return ["workspace missing"];
  const pageIds = new Set(ws.pages.map((p) => p.id));
  const blockIds = new Set(ws.blocks.map((b) => b.id));
  const personaIds = new Set(ws.personas.map((p) => p.id));

  for (const page of ws.pages) {
    if (page.parentPageId && !pageIds.has(page.parentPageId)) {
      issues.push(`page ${page.id} parent missing`);
    }
    for (const bid of page.childBlockIds || []) {
      const b = ws.blocks.find((x) => x.id === bid);
      if (!b) issues.push(`page ${page.id} missing block ${bid}`);
      else if (b.pageId !== page.id) issues.push(`block ${bid} pageId mismatch`);
    }
  }
  for (const b of ws.blocks) {
    if (b.pageId && !pageIds.has(b.pageId)) issues.push(`block ${b.id} orphan page`);
    for (const cid of b.childBlockIds || []) {
      if (!blockIds.has(cid)) issues.push(`block ${b.id} missing child ${cid}`);
    }
  }
  for (const c of ws.comments) {
    if (!blockIds.has(c.blockId)) issues.push(`comment ${c.id} missing block`);
    if (c.personaId && !personaIds.has(c.personaId)) issues.push(`comment ${c.id} missing persona`);
  }
  const handles = new Map();
  for (const p of ws.personas) {
    if (p.archived) continue;
    const h = p.handle.toLowerCase();
    if (handles.has(h)) issues.push(`duplicate handle @${p.handle}`);
    handles.set(h, p.id);
  }
  for (const db of ws.databases) {
    if (!pageIds.has(db.pageId)) issues.push(`database ${db.id} missing page`);
  }
  return issues;
}

export function appendBlock(ws, page, block) {
  block.pageId = page.id;
  ws.blocks.push(block);
  page.childBlockIds.push(block.id);
  page.updatedAt = now();
  return block;
}

export function insertBlockAfter(ws, page, afterId, block) {
  block.pageId = page.id;
  ws.blocks.push(block);
  const i = page.childBlockIds.indexOf(afterId);
  page.childBlockIds.splice(i >= 0 ? i + 1 : page.childBlockIds.length, 0, block.id);
  page.updatedAt = now();
  return block;
}

export function removeBlock(ws, page, blockId) {
  page.childBlockIds = page.childBlockIds.filter((id) => id !== blockId);
  const block = getBlock(ws, blockId);
  if (block) {
    for (const cid of block.childBlockIds || []) removeBlock(ws, page, cid);
  }
  ws.blocks = ws.blocks.filter((b) => b.id !== blockId);
  ws.comments = ws.comments.filter((c) => c.blockId !== blockId);
  page.updatedAt = now();
}

export function moveBlock(ws, page, blockId, dir) {
  const ids = page.childBlockIds;
  const i = ids.indexOf(blockId);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  page.updatedAt = now();
}

export function archivePage(ws, page) {
  page.archived = true;
  page.updatedAt = now();
  for (const child of ws.pages.filter((p) => p.parentPageId === page.id && !p.archived)) {
    archivePage(ws, child);
  }
}

export function canReparent(ws, pageId, newParentId) {
  if (!newParentId) return true;
  if (pageId === newParentId) return false;
  let cur = getPage(ws, newParentId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    if (cur.id === pageId) return false;
    seen.add(cur.id);
    cur = cur.parentPageId ? getPage(ws, cur.parentPageId) : null;
  }
  return true;
}

/** where: "into" | "before" | "after" | "root" */
export function movePage(ws, pageId, targetId, where) {
  const page = getPage(ws, pageId);
  if (!page) return;
  let newParentId = null;
  if (where === "root") newParentId = null;
  else {
    const target = getPage(ws, targetId);
    if (!target) return;
    newParentId = where === "into" ? target.id : target.parentPageId;
  }
  if (!canReparent(ws, pageId, newParentId)) {
    throw new Error("Can't nest a page inside itself.");
  }
  page.parentPageId = newParentId;
  page.updatedAt = now();
  const rest = ws.pages.filter((p) => p.id !== pageId);
  if ((where === "before" || where === "after") && targetId) {
    const i = rest.findIndex((p) => p.id === targetId);
    rest.splice(Math.max(0, i) + (where === "after" ? 1 : 0), 0, page);
    ws.pages = rest;
  } else {
    rest.push(page);
    ws.pages = rest;
  }
}

export function resolveWikiTitle(ws, title) {
  const t = String(title || "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  return ws.pages.find((p) => !p.archived && p.title.toLowerCase() === lower) || null;
}
