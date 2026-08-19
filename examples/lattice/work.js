/** Work layer: blockers, sub-tasks, recurrence, my-work, workload, report. */

import {
  TASK_PROP, PROJECT_PROP, TASK_STATUSES,
  todayISO, addDays, now, uid, createPage, createBlock, appendBlock,
  getPage, getPersona, getProp, setProp, asIdList, blockedByPages, setBlocking,
  tasksDb, projectsDb, dbRows, databaseForPage, childTasks, taskProgress,
  parentTaskId, tasksForProject, isDoneStatus, pushActivity, clone,
} from "./model.js?v=4";
import { mutate, toast } from "./store.js?v=4";

export function dueOf(page) {
  return page?.properties?.[TASK_PROP.due] || page?.properties?.[PROJECT_PROP.due] || "";
}

export function startOf(page) {
  return page?.properties?.[PROJECT_PROP.start] || "";
}

export function taskStatus(page) {
  return page?.properties?.[TASK_PROP.status] || "Inbox";
}

export function assigneesOf(page) {
  return asIdList(page?.properties?.[TASK_PROP.assignees]);
}

export function ownerOf(page) {
  return asIdList(page?.properties?.[PROJECT_PROP.owner])[0] || null;
}

export function recurrenceOf(page) {
  return page?.properties?.[TASK_PROP.recurrence] || "none";
}

export function estimateOf(page) {
  const n = page?.properties?.[TASK_PROP.estimate];
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

export function isOpenTask(page) {
  return !page.archived && !isDoneStatus(taskStatus(page));
}

export function isOverdue(page, today = todayISO()) {
  const due = dueOf(page);
  return due && due < today && isOpenTask(page);
}

export function dueBucket(page, today = todayISO()) {
  const due = dueOf(page);
  if (!due) return "later";
  if (due < today) return "overdue";
  if (due === today) return "today";
  const limit = addDays(today, 7 - new Date(`${today}T12:00:00`).getDay());
  if (due <= limit) return "week";
  return "later";
}

export function weekBounds(today = todayISO()) {
  const d = new Date(`${today}T12:00:00`);
  const dow = d.getDay();
  const start = addDays(today, -dow);
  const end = addDays(start, 6);
  return { start, end };
}

export function myWork(ws, personaId) {
  const db = tasksDb(ws);
  const groups = { overdue: [], today: [], week: [], later: [] };
  if (!db || !personaId) return groups;
  for (const page of dbRows(ws, db)) {
    if (!isOpenTask(page)) continue;
    if (!assigneesOf(page).includes(personaId)) continue;
    groups[dueBucket(page)].push(page);
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => (dueOf(a) || "9999").localeCompare(dueOf(b) || "9999"));
  }
  return groups;
}

export function tasksByPersona(ws) {
  const db = tasksDb(ws);
  const cols = new Map();
  cols.set("unassigned", []);
  for (const p of ws.personas.filter((x) => !x.archived)) cols.set(p.id, []);
  if (!db) return cols;
  for (const page of dbRows(ws, db)) {
    if (!isOpenTask(page)) continue;
    const people = assigneesOf(page);
    if (!people.length) cols.get("unassigned").push(page);
    else {
      for (const id of people) {
        if (!cols.has(id)) cols.set(id, []);
        cols.get(id).push(page);
      }
    }
  }
  return cols;
}

export function workload(ws, today = todayISO()) {
  const { start, end } = weekBounds(today);
  const db = tasksDb(ws);
  const rows = [];
  for (const persona of ws.personas.filter((p) => !p.archived)) {
    const tasks = db ? dbRows(ws, db).filter((p) => assigneesOf(p).includes(persona.id)) : [];
    const open = tasks.filter(isOpenTask);
    const thisWeek = open.filter((p) => {
      const due = dueOf(p);
      return !due || (due >= start && due <= end) || due < start;
    });
    const overdue = open.filter((p) => isOverdue(p, today));
    const hours = open.reduce((s, p) => s + (estimateOf(p) || 0), 0);
    const hasHours = open.some((p) => estimateOf(p) != null);
    const cap = persona.capacityHoursPerWeek || 0;
    rows.push({
      persona,
      open: open.length,
      overdue: overdue.length,
      week: thisWeek.length,
      hours,
      hasHours,
      capacity: cap,
      over: hasHours ? hours > cap : false,
      tasks: open,
    });
  }
  return rows;
}

export function report(ws, today = todayISO()) {
  const { start, end } = weekBounds(today);
  const tdb = tasksDb(ws);
  const pdb = projectsDb(ws);
  const tasks = tdb ? dbRows(ws, tdb, { includeArchived: true }) : [];
  const open = tasks.filter(isOpenTask);
  const doneWeek = tasks.filter((p) => isDoneStatus(taskStatus(p)) && (p.updatedAt || "").slice(0, 10) >= start && (p.updatedAt || "").slice(0, 10) <= end);
  const overdue = open.filter((p) => isOverdue(p, today));
  const blocked = open.filter((p) => blockedByPages(ws, p.id).length > 0 || taskStatus(p) === "Blocked");
  const byPersona = ws.personas.filter((p) => !p.archived).map((persona) => ({
    persona,
    open: open.filter((p) => assigneesOf(p).includes(persona.id)).length,
    done: doneWeek.filter((p) => assigneesOf(p).includes(persona.id)).length,
  }));
  const projects = pdb ? dbRows(ws, pdb) : [];
  const byProject = projects.map((project) => {
    const pts = tasksForProject(ws, project.id);
    return {
      project,
      open: pts.filter(isOpenTask).length,
      done: pts.filter((p) => isDoneStatus(taskStatus(p))).length,
    };
  });
  return { open: open.length, doneWeek: doneWeek.length, overdue: overdue.length, blocked: blocked.length, byPersona, byProject };
}

export function nextDue(due, recurrence, today = todayISO()) {
  const base = due && due >= today ? due : today;
  if (recurrence === "daily") return addDays(base, 1);
  if (recurrence === "weekly") return addDays(base, 7);
  if (recurrence === "weekday") {
    let d = addDays(base, 1);
    const day = new Date(`${d}T12:00:00`).getDay();
    if (day === 6) return addDays(d, 2);
    if (day === 0) return addDays(d, 1);
    return d;
  }
  if (recurrence === "monthly") {
    const dt = new Date(`${base}T12:00:00`);
    dt.setMonth(dt.getMonth() + 1);
    return todayISO(dt);
  }
  return null;
}

export function completeTask(ws, page, { force = false } = {}) {
  const blockers = blockedByPages(ws, page.id);
  if (blockers.length && !force) {
    return { warning: `Still blocked by ${blockers.map((p) => p.title).join(", ")}`, blockers };
  }
  const rec = recurrenceOf(page);
  const db = tasksDb(ws);
  setProp(page, db, TASK_PROP.status, "Done");
  page.updatedAt = now();
  let clonePage = null;
  if (rec && rec !== "none") {
    clonePage = spawnRecurrence(ws, page, rec);
  }
  pushActivity(ws, {
    type: "status",
    personaId: ws.actingPersonaId,
    targetId: page.id,
    body: `${page.title} → Done${clonePage ? ` · next ${clonePage.title}` : ""}`,
  });
  return { clone: clonePage };
}

function spawnRecurrence(ws, page, rec) {
  const seriesId = page.properties.seriesId || page.id;
  const next = clone(page);
  next.id = uid();
  next.createdAt = now();
  next.updatedAt = now();
  next.archived = false;
  next.childBlockIds = [];
  next.properties = { ...page.properties, [TASK_PROP.status]: "Inbox", [TASK_PROP.due]: nextDue(dueOf(page), rec), seriesId };
  page.properties.seriesId = seriesId;
  const body = createBlock({ pageId: next.id, type: "paragraph", content: `Next in series from [[${page.title}]].` });
  ws.pages.push(next);
  appendBlock(ws, next, body);
  return next;
}

const pendingDone = new Set();

export function setStatus(pageId, status) {
  mutate((ws) => {
    const page = getPage(ws, pageId);
    const db = databaseForPage(ws, page);
    if (!db) return;
    const isTask = db.id === "db-tasks" || db.properties.some((p) => p.id === TASK_PROP.status);
    if (isTask && status === "Done") {
      const blockers = blockedByPages(ws, page.id);
      if (blockers.length && !pendingDone.has(pageId)) {
        pendingDone.add(pageId);
        toast("warn", `Still blocked by ${blockers.map((p) => p.title).join(", ")}. Mark done again to override.`);
        return;
      }
      pendingDone.delete(pageId);
      completeTask(ws, page, { force: true });
      return;
    }
    pendingDone.delete(pageId);
    setProp(page, db, isTask ? TASK_PROP.status : PROJECT_PROP.status, status);
    page.updatedAt = now();
    pushActivity(ws, {
      type: "status",
      personaId: ws.actingPersonaId,
      targetId: page.id,
      body: `${page.title} → ${status}`,
    });
  });
}

export function setTaskBlocking(pageId, targetIds) {
  mutate((ws) => {
    const page = getPage(ws, pageId);
    setBlocking(ws, page, targetIds);
  });
}

export function assignPersonas(pageId, personaIds, propId = TASK_PROP.assignees) {
  mutate((ws) => {
    const page = getPage(ws, pageId);
    page.properties[propId] = asIdList(personaIds);
    page.updatedAt = now();
  });
}

export function setPageProject(taskId, projectId) {
  mutate((ws) => {
    const page = getPage(ws, taskId);
    page.properties[TASK_PROP.project] = projectId ? [projectId] : [];
    page.updatedAt = now();
  });
}

export function setParentTask(taskId, parentId) {
  mutate((ws) => {
    if (parentId === taskId) throw new Error("A task cannot be its own parent.");
    const page = getPage(ws, taskId);
    page.properties[TASK_PROP.parent] = parentId ? [parentId] : [];
    page.updatedAt = now();
  });
}

export function createTask(wsLike, { title, status = "Inbox", projectId, parentId, assigneeIds } = {}) {
  let created = null;
  mutate((ws) => {
    const db = tasksDb(ws);
    if (!db) throw new Error("Tasks database missing.");
    const page = createPage({
      title: title || "Untitled task",
      parentPageId: db.pageId,
      icon: "☐",
      properties: {
        [TASK_PROP.status]: status,
        [TASK_PROP.priority]: "",
        [TASK_PROP.due]: "",
        [TASK_PROP.assignees]: assigneeIds || (ws.actingPersonaId ? [ws.actingPersonaId] : []),
        [TASK_PROP.project]: projectId ? [projectId] : [],
        [TASK_PROP.parent]: parentId ? [parentId] : [],
        [TASK_PROP.blocking]: [],
        [TASK_PROP.recurrence]: "none",
        [TASK_PROP.estimate]: null,
      },
    });
    ws.pages.push(page);
    appendBlock(ws, page, createBlock({ type: "paragraph", content: "" }));
    created = page;
  });
  return created;
}

export function createProject({ title } = {}) {
  let created = null;
  mutate((ws) => {
    const db = projectsDb(ws);
    if (!db) throw new Error("Projects database missing.");
    const page = createPage({
      title: title || "Untitled project",
      parentPageId: db.pageId,
      icon: "⬡",
      properties: {
        [PROJECT_PROP.status]: "Proposed",
        [PROJECT_PROP.priority]: "P2",
        [PROJECT_PROP.start]: todayISO(),
        [PROJECT_PROP.due]: addDays(todayISO(), 14),
        [PROJECT_PROP.owner]: ws.actingPersonaId ? [ws.actingPersonaId] : [],
        [PROJECT_PROP.blocking]: [],
        [PROJECT_PROP.summary]: "",
      },
    });
    ws.pages.push(page);
    appendBlock(ws, page, createBlock({ type: "paragraph", content: "" }));
    created = page;
  });
  return created;
}

export function blockerLabel(ws, page) {
  const list = blockedByPages(ws, page.id);
  if (!list.length) return "";
  return "blocked by " + list.map((p) => p.title).join(", ");
}

export function progressLabel(ws, page) {
  const prog = taskProgress(ws, page);
  if (!prog) return "";
  return `${prog.done}/${prog.total}`;
}

export { blockedByPages, childTasks, taskProgress, tasksForProject, getPersona };
