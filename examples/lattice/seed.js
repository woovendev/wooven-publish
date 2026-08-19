/** Studio demo workspace. Loaded only when the store is empty. */

import {
  TASK_PROP, PROJECT_PROP, TASK_STATUSES, PROJECT_STATUSES, PRIORITIES, RECURRENCE,
  todayISO, addDays, now, createWorkspace, createPersona, createPage, createBlock,
  createComment, createDatabase, createProperty, createView, createEvent, appendBlock,
} from "./model.js";

export function studio() {
  const t = now();
  const today = todayISO();
  const personas = [
    createPersona({ id: "per-andres", name: "Andres", handle: "andres", color: "#0f766e", role: "Eng", initials: "AN", capacityHoursPerWeek: 32 }),
    createPersona({ id: "per-maya", name: "Maya", handle: "maya", color: "#7c3aed", role: "Design", initials: "MY", capacityHoursPerWeek: 30 }),
    createPersona({ id: "per-priya", name: "Priya", handle: "priya", color: "#b45309", role: "PM", initials: "PR", capacityHoursPerWeek: 40 }),
    createPersona({ id: "per-jonah", name: "Jonah", handle: "jonah", color: "#0369a1", role: "Ops", initials: "JO", capacityHoursPerWeek: 35 }),
  ];

  const home = page("page-home", "Home", null, "⌂");
  const handbook = page("page-handbook", "Handbook", home.id, "📘");
  const meetings = page("page-meetings", "Meeting notes", home.id, "✎");
  const projectsPage = page("page-projects", "Projects", home.id, "▦", "database");
  const tasksPage = page("page-tasks", "Tasks", home.id, "☑", "database");

  const projectProps = [
    createProperty({ id: PROJECT_PROP.status, name: "Status", type: "status", options: PROJECT_STATUSES }),
    createProperty({ id: PROJECT_PROP.priority, name: "Priority", type: "priority", options: PRIORITIES }),
    createProperty({ id: PROJECT_PROP.start, name: "Start", type: "date" }),
    createProperty({ id: PROJECT_PROP.due, name: "Due", type: "date" }),
    createProperty({ id: PROJECT_PROP.owner, name: "Owner", type: "person" }),
    createProperty({ id: PROJECT_PROP.blocking, name: "Blocking", type: "blocking" }),
    createProperty({ id: PROJECT_PROP.summary, name: "Summary", type: "text" }),
  ];
  const taskProps = [
    createProperty({ id: TASK_PROP.status, name: "Status", type: "status", options: TASK_STATUSES }),
    createProperty({ id: TASK_PROP.priority, name: "Priority", type: "priority", options: PRIORITIES }),
    createProperty({ id: TASK_PROP.due, name: "Due", type: "date" }),
    createProperty({ id: TASK_PROP.assignees, name: "Assignees", type: "person" }),
    createProperty({ id: TASK_PROP.project, name: "Project", type: "relation" }),
    createProperty({ id: TASK_PROP.parent, name: "Parent", type: "relation" }),
    createProperty({ id: TASK_PROP.blocking, name: "Blocking", type: "blocking" }),
    createProperty({ id: TASK_PROP.recurrence, name: "Recurrence", type: "select", options: RECURRENCE }),
    createProperty({ id: TASK_PROP.estimate, name: "Hours", type: "number" }),
  ];

  const projectsBoard = createView({ id: "view-proj-board", name: "Board", layout: "board", groupBy: PROJECT_PROP.status });
  const projectsTimeline = createView({ id: "view-proj-timeline", name: "Timeline", layout: "timeline" });
  const tasksTable = createView({ id: "view-task-table", name: "Table", layout: "table", sorts: [{ propId: TASK_PROP.due, dir: "asc" }] });
  const tasksBoard = createView({ id: "view-task-board", name: "Board", layout: "board", groupBy: TASK_PROP.status });
  const tasksByPersona = createView({ id: "view-task-people", name: "By persona", layout: "board", groupBy: TASK_PROP.assignees });
  const tasksList = createView({ id: "view-task-list", name: "List", layout: "list" });
  const tasksCal = createView({ id: "view-task-cal", name: "Calendar", layout: "calendar" });
  const tasksGallery = createView({ id: "view-task-gal", name: "Gallery", layout: "gallery" });

  const projectsDb = createDatabase({
    id: "db-projects",
    pageId: projectsPage.id,
    properties: projectProps,
    views: [projectsBoard, projectsTimeline],
    defaultViewId: projectsTimeline.id,
  });
  const tasksDb = createDatabase({
    id: "db-tasks",
    pageId: tasksPage.id,
    properties: taskProps,
    views: [tasksTable, tasksBoard, tasksByPersona, tasksList, tasksCal, tasksGallery],
    defaultViewId: tasksBoard.id,
  });

  const lattice = row("page-proj-lattice", "Lattice v1", projectsPage.id, "⬡", {
    [PROJECT_PROP.status]: "Active",
    [PROJECT_PROP.priority]: "P1",
    [PROJECT_PROP.start]: addDays(today, -14),
    [PROJECT_PROP.due]: addDays(today, 21),
    [PROJECT_PROP.owner]: ["per-andres"],
    [PROJECT_PROP.blocking]: [],
    [PROJECT_PROP.summary]: "Ship a local-first block workspace you can actually run work from.",
  });

  const tEditor = task("page-task-editor", "Ship the block editor", {
    status: "Doing", priority: "P1", due: addDays(today, 1),
    assignees: ["per-andres"], estimate: 8, recurrence: "none",
  });
  const tCards = task("page-task-cards", "Design board cards", {
    status: "Next", priority: "P2", due: addDays(today, 3),
    assignees: ["per-maya"], estimate: 5, recurrence: "none",
  });
  const tHandbook = task("page-task-handbook", "Write handbook stub", {
    status: "Done", priority: "P3", due: addDays(today, -1),
    assignees: ["per-priya"], estimate: 2, recurrence: "none",
  });
  const tLegal = task("page-task-legal", "Legal review of policies", {
    status: "Inbox", priority: "P2", due: addDays(today, 4),
    assignees: ["per-jonah"], estimate: 3, recurrence: "none",
  });
  const tLanding = task("page-task-landing", "Publish landing copy", {
    status: "Blocked", priority: "P1", due: addDays(today, 2),
    assignees: ["per-maya", "per-priya"], estimate: 4, recurrence: "none",
    blocking: [],
  });
  const tSync = task("page-task-sync", "Weekly studio sync", {
    status: "Next", priority: "P2", due: addDays(today, 2),
    assignees: ["per-priya"], estimate: 1, recurrence: "weekly",
  });
  const tLaunch = task("page-task-launch", "Launch checklist", {
    status: "Next", priority: "P1", due: addDays(today, 5),
    assignees: ["per-andres"], estimate: 6, recurrence: "none",
  });
  const tQa = task("page-task-qa", "QA seed data", {
    status: "Inbox", priority: "P2", due: addDays(today, 4),
    assignees: ["per-andres"], estimate: 2, recurrence: "none",
    parent: [tLaunch.id],
  });
  const tGif = task("page-task-gif", "Record demo walkthrough", {
    status: "Next", priority: "P3", due: addDays(today, 6),
    assignees: ["per-maya"], estimate: 3, recurrence: "none",
    parent: [tLaunch.id],
  });
  const tBanner = task("page-task-banner", "Fix localStorage quota banner", {
    status: "Inbox", priority: "P1", due: addDays(today, -3),
    assignees: ["per-andres"], estimate: 2, recurrence: "none",
  });

  tLegal.properties[TASK_PROP.blocking] = [tLanding.id];

  const pages = [
    home, handbook, meetings, projectsPage, tasksPage, lattice,
    tEditor, tCards, tHandbook, tLegal, tLanding, tSync, tLaunch, tQa, tGif, tBanner,
  ];
  const blocks = [];
  const ws = createWorkspace({
    id: "ws-studio",
    name: "Studio",
    updatedAt: t,
    actingPersonaId: "per-andres",
    personas,
    pages,
    blocks,
    comments: [],
    databases: [projectsDb, tasksDb],
    activity: [],
  });

  fill(ws, home, [
    h1("Studio"),
    p("A local-first knowledge + work hub. Everything is a block. Work is assigned to **personas**, not accounts."),
    p("Jump to [[Tasks]] or [[Projects]]. Acting as @andres."),
    callout("Tip: type `/` in any block. Wikilink with `[[Page title]]`. Mention with `@handle`."),
    h2("This week"),
    bullet("Ship the editor on [[Tasks]]"),
    bullet("Unblock [[Publish landing copy]] after legal review"),
    bullet("Keep [[Handbook]] short and true"),
  ]);

  fill(ws, handbook, [
    h1("Handbook"),
    p("Policies stub — living, not a PDF graveyard."),
    h2("How we work"),
    bullet("Personas are hats. Switch **Acting as** before you comment."),
    bullet("A blocked task can still be marked done — you get a warning, not a lock."),
    bullet("Recurring tasks clone on complete. No RRULE."),
    h2("Security"),
    quote("One browser, one workspace. Nothing leaves this machine unless you export."),
    p("Questions → @priya."),
  ]);

  fill(ws, meetings, [
    h1("Meeting notes"),
    p(`Studio standup — ${today}`),
    bullet("Andres: editor prefixes convert on space.", [
      bullet("Maya wants compact cards: title, dots, due, blocked chip."),
      bullet("Jonah: quota banner before images > 1.5MB."),
    ]),
    todo("Schedule legal review", false),
    todo("Demo workload screen", true),
    code("cd examples/lattice && python3 -m http.server 8766", "bash"),
  ]);

  fill(ws, projectsPage, [
    p("Projects are pages with a timeline. Open **Lattice v1** for the active bet."),
  ]);
  fill(ws, tasksPage, [
    p("Same set of task pages, many views. Board is the default."),
  ]);

  const editorBody = fill(ws, tEditor, [
    p("Click a block. Markdown renders live. Prefixes convert on space or enter."),
    p("Remaining: slash **move**, image size warning, `[[wikilinks]]` create-if-missing."),
    todo("Caret restore after inline convert", false),
  ]);
  fill(ws, tCards, [p("Compact: title, persona dots, due, blocked chip. No rainbow soup.")]);
  fill(ws, tHandbook, [p("Stub is on [[Handbook]]. Marked done.")]);
  fill(ws, tLegal, [p("Must finish before [[Publish landing copy]] can start. Blocking is stored once; blocked-by is derived.")]);
  fill(ws, tLanding, [p("Waiting on legal. Card should show **blocked by Legal review of policies**.")]);
  fill(ws, tSync, [p("Recurrence: weekly. Completing this clones next week and keeps a series link.")]);
  fill(ws, tLaunch, [p("Parent task. Sub-tasks: QA seed data, Record demo walkthrough. Progress is a hint — do not auto-close.")]);
  fill(ws, tQa, [p("Child of [[Launch checklist]].")]);
  fill(ws, tGif, [p("Child of [[Launch checklist]]. After the editor feels like a published doc.")]);
  fill(ws, tBanner, [p("Overdue. Quota / parse failures must keep last-good in memory.")]);
  fill(ws, lattice, [
    p("Active project. Owner @andres."),
    p("Related tasks live in [[Tasks]] via the Project relation."),
  ]);

  const threadBlock = editorBody[0];
  ws.comments.push(createComment({
    id: "cmt-1",
    blockId: threadBlock.id,
    personaId: "per-priya",
    body: "Can we ship prefixes this week? @maya needs the cards to sit on real tasks.",
  }));
  ws.comments.push(createComment({
    id: "cmt-2",
    blockId: threadBlock.id,
    personaId: "per-andres",
    parentCommentId: "cmt-1",
    body: "Yes — prefixes land first, then slash insert.",
  }));
  ws.activity.push(createEvent({
    type: "mention",
    personaId: "per-priya",
    targetId: "per-maya",
    body: "@maya mentioned on Ship the block editor",
  }));
  ws.activity.push(createEvent({
    type: "status",
    personaId: "per-andres",
    targetId: tEditor.id,
    body: "Ship the block editor → Doing",
  }));

  return ws;

  function task(id, title, opts) {
    return row(id, title, tasksPage.id, "☐", {
      [TASK_PROP.status]: opts.status,
      [TASK_PROP.priority]: opts.priority,
      [TASK_PROP.due]: opts.due,
      [TASK_PROP.assignees]: opts.assignees || [],
      [TASK_PROP.project]: [lattice.id],
      [TASK_PROP.parent]: opts.parent || [],
      [TASK_PROP.blocking]: opts.blocking || [],
      [TASK_PROP.recurrence]: opts.recurrence || "none",
      [TASK_PROP.estimate]: opts.estimate ?? null,
    });
  }
}

function page(id, title, parentPageId, icon, type = "page") {
  return createPage({ id, title, parentPageId, icon, type });
}

function row(id, title, parentPageId, icon, properties) {
  return createPage({ id, title, parentPageId, icon, type: "page", properties });
}

function h1(content) { return createBlock({ type: "heading1", content }); }
function h2(content) { return createBlock({ type: "heading2", content }); }
function p(content) { return createBlock({ type: "paragraph", content }); }
function bullet(content, children = []) {
  const b = createBlock({ type: "bullet", content });
  if (children.length) b._children = children;
  return b;
}
function quote(content) { return createBlock({ type: "quote", content }); }
function callout(content) { return createBlock({ type: "callout", content, props: { emoji: "✦" } }); }
function todo(content, checked) { return createBlock({ type: "todo", content, props: { checked: !!checked } }); }
function code(content, lang) { return createBlock({ type: "code", content, props: { lang } }); }

function fill(ws, pg, blocks) {
  for (const b of blocks) graft(ws, pg, b);
  return blocks;
}

function graft(ws, pg, block) {
  const kids = block._children || [];
  delete block._children;
  appendBlock(ws, pg, block);
  for (const k of kids) {
    k.pageId = pg.id;
    const grand = k._children || [];
    delete k._children;
    ws.blocks.push(k);
    block.childBlockIds = block.childBlockIds || [];
    block.childBlockIds.push(k.id);
    for (const g of grand) {
      g.pageId = pg.id;
      ws.blocks.push(g);
      k.childBlockIds = k.childBlockIds || [];
      k.childBlockIds.push(g.id);
    }
  }
  return block;
}
