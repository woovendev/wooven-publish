/** Block editor: live markdown, slash menu, wikilinks, comments. */

import {
  uid, now, getPage, getBlock, getPersona, getPersonaByHandle, resolveWikiTitle,
  createPage, createBlock, createComment, createDatabase, createProperty, createView,
  appendBlock, insertBlockAfter, removeBlock, moveBlock, pageBlocks, commentCount,
  commentsForBlock, mentionHandles, pushActivity, TASK_PROP, PROJECT_PROP,
} from "./model.js?v=3";
import { mutate, toast } from "./store.js?v=3";

const SLASH_ITEMS = [
  { t: "paragraph", label: "Paragraph", hint: "text" },
  { t: "heading1", label: "Heading 1", hint: "#" },
  { t: "heading2", label: "Heading 2", hint: "##" },
  { t: "heading3", label: "Heading 3", hint: "###" },
  { t: "bullet", label: "Bullet", hint: "-" },
  { t: "numbered", label: "Numbered", hint: "1." },
  { t: "todo", label: "To-do", hint: "[]" },
  { t: "toggle", label: "Toggle", hint: "▸" },
  { t: "quote", label: "Quote", hint: ">" },
  { t: "callout", label: "Callout", hint: "note" },
  { t: "divider", label: "Divider", hint: "---" },
  { t: "code", label: "Code", hint: "```" },
  { t: "image", label: "Image", hint: "url" },
  { t: "embed", label: "Embed", hint: "url" },
  { t: "page", label: "Page", hint: "child" },
  { t: "database", label: "Database", hint: "table" },
];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function renderInline(raw, ws) {
  let s = esc(raw);
  const holes = [];
  s = s.replace(/`([^`]+)`/g, (_, inner) => {
    holes.push(`<code>${inner}</code>`);
    return `\0H${holes.length - 1}\0`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\[\[@([a-zA-Z0-9_]+)\]\]/g, (_, h) => mentionHtml(ws, h));
  s = s.replace(/\[\[([^[\]]+)\]\]/g, (_, title) => wikiHtml(ws, title));
  s = s.replace(/@([a-zA-Z0-9_]+)/g, (_, h) => mentionHtml(ws, h));
  s = s.replace(/\0H(\d+)\0/g, (_, i) => holes[Number(i)]);
  return s || "<span class=ph>Empty</span>";
}

function wikiHtml(ws, title) {
  const page = resolveWikiTitle(ws, title);
  const id = page?.id || "";
  return `<a class="wiki${page ? "" : " missing"}" data-wiki="${esc(title)}" data-page="${id}">${esc(title)}</a>`;
}

function mentionHtml(ws, handle) {
  const p = getPersonaByHandle(ws, handle);
  const color = p?.color || "#6f6b63";
  return `<span class="mention" data-handle="${esc(handle)}" data-persona="${p?.id || ""}" style="--c:${color}">@${esc(handle)}</span>`;
}

function serialize(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  const tag = node.tagName;
  if (tag === "BR") return "\n";
  const inner = [...node.childNodes].map(serialize).join("");
  if (node.dataset?.wiki) return `[[${node.dataset.wiki}]]`;
  if (node.dataset?.handle) return `@${node.dataset.handle}`;
  if (tag === "STRONG" || tag === "B") return `**${inner}**`;
  if (tag === "EM" || tag === "I") return `*${inner}*`;
  if (tag === "CODE") return `\`${inner}\``;
  if (tag === "S" || tag === "DEL") return `~~${inner}~~`;
  if (tag === "A") {
    const href = node.getAttribute("href") || "";
    if (href) return `[${inner}](${href})`;
    return inner;
  }
  return inner;
}

function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function setCaret(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = Math.max(0, offset);
  let node = null;
  while ((node = walker.nextNode())) {
    if (node.length >= left) {
      const r = document.createRange();
      r.setStart(node, left);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    left -= node.length;
  }
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

let slash = null;
let editingId = null;

export function getSlash() {
  return slash;
}

export function closeSlash() {
  slash = null;
}

export function renderPage(root, ws, page, ctx) {
  root.dataset.page = page.id;
  const blocks = pageBlocks(ws, page);
  root.innerHTML = blocks.map((b) => blockHtml(ws, b, ctx)).join("") || emptyHint();
  bind(root, ws, page, ctx);
}

function emptyHint() {
  return `<div class="block" data-empty="1"><div class="block-body ph" data-role="empty">Type '/' for commands, or just start writing…</div></div>`;
}

function blockHtml(ws, block, ctx) {
  const n = commentCount(ws, block.id);
  const badge = n ? `<button class="cmt-badge" data-cmt="${block.id}" title="Comments">${n}</button>` : "";
  const kids = (block.childBlockIds || []).map((id) => getBlock(ws, id)).filter(Boolean);
  const nested = kids.length
    ? `<div class="nested">${kids.map((k) => blockHtml(ws, k, ctx)).join("")}</div>`
    : "";
  return `<div class="block" data-id="${block.id}" data-type="${block.type}">
    <div class="block-gutter">
      <button class="drag" data-drag="${block.id}" title="Drag or ⌘⇧↑↓" aria-label="Move">⋮⋮</button>
      <button class="plus" data-plus="${block.id}" title="Insert">+</button>
    </div>
    ${renderBody(ws, block)}
    ${badge}
    ${nested}
  </div>`;
}

function renderBody(ws, block) {
  const t = block.type;
  if (t === "divider") return `<hr class="block-body" />`;
  if (t === "image") {
    const src = block.content || "";
    return `<div class="block-body media">${src ? `<img src="${esc(src)}" alt="">` : `<span class="ph">Image URL…</span>`}<input class="media-src" data-src="${block.id}" value="${esc(src)}" placeholder="https://…"></div>`;
  }
  if (t === "embed") {
    const src = block.content || "";
    return `<div class="block-body media embed-card"><a href="${esc(src)}" target="_blank" rel="noopener">${esc(src || "Paste a URL")}</a><input class="media-src" data-src="${block.id}" value="${esc(src)}" placeholder="https://…"></div>`;
  }
  if (t === "page") {
    const pid = block.props.pageId;
    const pg = getPage(ws, pid);
    return `<div class="block-body child-page" data-open="${pid || ""}">${esc(pg?.icon || "📄")} ${esc(pg?.title || "Untitled page")}</div>`;
  }
  if (t === "databaseView") {
    return `<div class="block-body ph">Database view is on the database page.</div>`;
  }
  if (t === "table") {
    const rows = block.props.rows || [["", ""], ["", ""]];
    const cells = rows.map((r, i) => `<tr>${r.map((c, j) => `<td contenteditable="true" data-cell="${block.id}:${i}:${j}">${esc(c)}</td>`).join("")}</tr>`).join("");
    return `<div class="block-body"><table class="mini-table">${cells}</table></div>`;
  }
  if (t === "todo") {
    const on = block.props.checked ? "on" : "";
    return `<div class="block-body todo-row"><button class="chk ${on}" data-chk="${block.id}" aria-pressed="${!!block.props.checked}"></button><div class="edit" data-edit="${block.id}" contenteditable="true" spellcheck="true">${renderInline(block.content, ws)}</div></div>`;
  }
  const emoji = t === "callout" ? `<span class="co-emoji">${esc(block.props.emoji || "✦")}</span>` : "";
  const lang = t === "code" ? `<span class="lang">${esc(block.props.lang || "")}</span>` : "";
  return `<div class="block-body ${t}">${emoji}${lang}<div class="edit" data-edit="${block.id}" contenteditable="true" spellcheck="true">${block.content ? renderInline(block.content, ws) : ""}</div></div>`;
}

function bind(root, ws, page, ctx) {
  root.onclick = (e) => {
    const wiki = e.target.closest("[data-wiki]");
    if (wiki) {
      e.preventDefault();
      ctx.openWiki(wiki.dataset.wiki);
      return;
    }
    const mention = e.target.closest("[data-persona]");
    if (mention?.dataset.persona) {
      ctx.openPersona?.(mention.dataset.persona);
      return;
    }
    const child = e.target.closest("[data-open]");
    if (child?.dataset.open) {
      ctx.openPage(child.dataset.open);
      return;
    }
    const chk = e.target.closest("[data-chk]");
    if (chk) {
      mutate((w) => {
        const b = getBlock(w, chk.dataset.chk);
        if (b) b.props.checked = !b.props.checked;
      });
      return;
    }
    const cmt = e.target.closest("[data-cmt]");
    if (cmt) {
      ctx.focusBlock(cmt.dataset.cmt);
      return;
    }
    const plus = e.target.closest("[data-plus]");
    if (plus) {
      openSlashAt(plus.dataset.plus, "", plus.getBoundingClientRect(), ctx);
      ctx.redraw();
      return;
    }
    const empty = e.target.closest("[data-role=empty]");
    if (empty) {
      mutate((w) => {
        const pg = getPage(w, page.id);
        appendBlock(w, pg, createBlock({ type: "paragraph", content: "" }));
      });
    }
  };

  root.oninput = (e) => {
    const cell = e.target.closest("[data-cell]");
    if (cell) {
      const [id, r, c] = cell.dataset.cell.split(":");
      mutate((w) => {
        const b = getBlock(w, id);
        if (!b.props.rows) b.props.rows = [["", ""], ["", ""]];
        b.props.rows[Number(r)][Number(c)] = cell.textContent;
      });
      return;
    }
    const src = e.target.closest("[data-src]");
    if (src) {
      mutate((w) => {
        const b = getBlock(w, src.dataset.src);
        if (b) b.content = src.value.trim();
      });
      return;
    }
    const edit = e.target.closest("[data-edit]");
    if (!edit) return;
    onEditInput(edit, page, ctx);
  };

  root.onkeydown = (e) => onKey(e, page, ctx);

  root.onfocusin = (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      editingId = edit.dataset.edit;
      ctx.focusBlock(editingId);
    }
  };

  root.onfocusout = (e) => {
    const edit = e.target.closest("[data-edit]");
    if (!edit) return;
    const md = serialize(edit);
    const handles = mentionHandles(md);
    if (!handles.length) return;
    mutate((w) => {
      for (const h of handles) {
        const p = getPersonaByHandle(w, h);
        if (!p) continue;
        const body = `@${h} mentioned in “${getPage(w, page.id)?.title || "page"}”`;
        if (w.activity[0]?.body === body) continue;
        pushActivity(w, {
          type: "mention",
          personaId: w.actingPersonaId,
          targetId: p.id,
          body,
        });
      }
    }, { silent: true });
  };

  root.querySelectorAll("[data-drag]").forEach((handle) => {
    handle.draggable = true;
    handle.ondragstart = (e) => {
      e.dataTransfer.setData("text/plain", handle.dataset.drag);
      e.dataTransfer.effectAllowed = "move";
    };
  });
  root.ondragover = (e) => {
    if (e.dataTransfer.types.includes("text/plain")) e.preventDefault();
  };
  root.ondrop = (e) => {
    e.preventDefault();
    const from = e.dataTransfer.getData("text/plain");
    const target = e.target.closest(".block[data-id]");
    if (!from || !target) return;
    const to = target.dataset.id;
    mutate((w) => {
      const pg = getPage(w, page.id);
      const ids = pg.childBlockIds;
      const i = ids.indexOf(from);
      const j = ids.indexOf(to);
      if (i < 0 || j < 0 || i === j) return;
      ids.splice(i, 1);
      ids.splice(j, 0, from);
    });
  };
}

function onEditInput(edit, page, ctx) {
  const id = edit.dataset.edit;
  const md = serialize(edit);
  const off = caretOffset(edit);
  if (md.startsWith("/") && !md.includes("\n") && md.length < 40) {
    const rect = edit.getBoundingClientRect();
    openSlashAt(id, md.slice(1), rect, ctx);
  } else if (slash) {
    slash = null;
  }
  const converted = convertPrefix(md);
  mutate((w) => {
    const b = getBlock(w, id);
    if (!b) return;
    if (converted) {
      b.type = converted.type;
      b.content = converted.content;
      if (converted.props) Object.assign(b.props, converted.props);
      b.updatedAt = now();
    } else if (b.type === "bullet" && /^\[ \]\s?/.test(md)) {
      b.type = "todo";
      b.content = md.replace(/^\[ \]\s?/, "");
      b.props.checked = false;
      b.updatedAt = now();
    } else {
      b.content = md;
      b.updatedAt = now();
    }
  }, { silent: !converted && !(md.startsWith("[ ]") || false) });
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-edit="${id}"]`);
    if (!el) return;
    if (converted) setCaret(el, converted.content.length);
    else {
      el.innerHTML = md ? renderInline(md, ctx.ws()) : "";
      setCaret(el, off);
    }
    if (slash) ctx.redrawOverlays?.();
  });
}

function convertPrefix(md) {
  const pair = [
    [/^###\s+/, "heading3"],
    [/^##\s+/, "heading2"],
    [/^#\s+/, "heading1"],
    [/^>\s+/, "quote"],
    [/^```\s*/, "code"],
  ];
  for (const [re, type] of pair) {
    if (re.test(md) && (md.match(re)[0].endsWith(" ") || type === "code" && md === "```")) {
      return { type, content: md.replace(re, "") };
    }
  }
  if (md === "---" || md === "--- ") return { type: "divider", content: "" };
  if (/^(\*|-)\s$/.test(md) || /^(\*|-)\s\S/.test(md)) {
    if (/^(\*|-)\s\[ \]\s?/.test(md) || /^(\*|-)\s\[\s\]\s?/.test(md)) {
      return { type: "todo", content: md.replace(/^(\*|-)\s\[ \]\s?/, ""), props: { checked: false } };
    }
    return { type: "bullet", content: md.replace(/^(\*|-)\s/, "") };
  }
  if (/^\[\]\s?/.test(md) || /^\[ \]\s?/.test(md)) {
    return { type: "todo", content: md.replace(/^\[ \]?\s?/, ""), props: { checked: false } };
  }
  if (/^\d+\.\s/.test(md)) return { type: "numbered", content: md.replace(/^\d+\.\s/, "") };
  return null;
}

function onKey(e, page, ctx) {
  const edit = e.target.closest("[data-edit]");
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const id = edit?.dataset.edit || editingId;
    if (!id) return;
    mutate((w) => moveBlock(w, getPage(w, page.id), id, e.key === "ArrowUp" ? -1 : 1));
    return;
  }
  if (slash && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape")) {
    e.preventDefault();
    if (e.key === "Escape") {
      slash = null;
      ctx.redrawOverlays?.();
      return;
    }
    if (e.key === "ArrowDown") slash.i = Math.min(slash.items.length - 1, slash.i + 1);
    if (e.key === "ArrowUp") slash.i = Math.max(0, slash.i - 1);
    if (e.key === "Enter") applySlash(page, slash.items[slash.i], ctx);
    ctx.redrawOverlays?.();
    return;
  }
  if (!edit) return;
  const id = edit.dataset.edit;
  if (e.key === "Enter" && !e.shiftKey && edit.closest(".code") == null) {
    e.preventDefault();
    const md = serialize(edit);
    const off = caretOffset(edit);
    const after = md.slice(off);
    const before = md.slice(0, off);
    let newId = null;
    mutate((w) => {
      const b = getBlock(w, id);
      const pg = getPage(w, page.id);
      b.content = before;
      const nb = createBlock({ type: b.type === "heading1" || b.type === "heading2" || b.type === "heading3" || b.type === "quote" ? "paragraph" : b.type, content: after, props: { ...b.props, checked: false } });
      insertBlockAfter(w, pg, id, nb);
      newId = nb.id;
    });
    ctx.focusBlock(newId);
    requestAnimationFrame(() => document.querySelector(`[data-edit="${newId}"]`)?.focus());
    return;
  }
  if (e.key === "Backspace" && caretOffset(edit) === 0 && !serialize(edit)) {
    e.preventDefault();
    mutate((w) => {
      const pg = getPage(w, page.id);
      const i = pg.childBlockIds.indexOf(id);
      const prev = i > 0 ? pg.childBlockIds[i - 1] : null;
      const b = getBlock(w, id);
      if (b && b.type !== "paragraph") {
        b.type = "paragraph";
        return;
      }
      removeBlock(w, pg, id);
      if (prev) ctx.focusBlock(prev);
    });
    return;
  }
  if (e.key === "Backspace" && caretOffset(edit) === 0 && serialize(edit)) {
    e.preventDefault();
    mutate((w) => {
      const pg = getPage(w, page.id);
      const i = pg.childBlockIds.indexOf(id);
      if (i <= 0) {
        const b = getBlock(w, id);
        if (b && b.type !== "paragraph") b.type = "paragraph";
        return;
      }
      const prev = getBlock(w, pg.childBlockIds[i - 1]);
      const b = getBlock(w, id);
      prev.content = (prev.content || "") + (b.content || "");
      removeBlock(w, pg, id);
      ctx.focusBlock(prev.id);
    });
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    indent(page.id, id, e.shiftKey ? -1 : 1, ctx);
    return;
  }
  if (e.key === "ArrowUp" || e.key === "k" && !e.metaKey && caretOffset(edit) === 0) {
    if (e.key === "k" && edit.textContent) return;
    const ids = [...document.querySelectorAll("[data-edit]")].map((el) => el.dataset.edit);
    const i = ids.indexOf(id);
    if (i > 0) {
      e.preventDefault();
      document.querySelector(`[data-edit="${ids[i - 1]}"]`)?.focus();
    }
  }
  if (e.key === "ArrowDown" || e.key === "j" && !e.metaKey) {
    const md = serialize(edit);
    if (e.key === "j" && md) return;
    if (caretOffset(edit) < (edit.textContent || "").length && e.key === "ArrowDown") return;
    const ids = [...document.querySelectorAll("[data-edit]")].map((el) => el.dataset.edit);
    const i = ids.indexOf(id);
    if (i >= 0 && i < ids.length - 1) {
      e.preventDefault();
      document.querySelector(`[data-edit="${ids[i + 1]}"]`)?.focus();
    }
  }
}

function indent(pageId, blockId, dir, ctx) {
  mutate((w) => {
    const pg = getPage(w, pageId);
    const ids = pg.childBlockIds;
    const i = ids.indexOf(blockId);
    if (i < 0) return;
    const block = getBlock(w, blockId);
    if (dir > 0 && i > 0) {
      const prev = getBlock(w, ids[i - 1]);
      if (prev.type === "bullet" || prev.type === "numbered" || prev.type === "todo" || prev.type === "toggle") {
        ids.splice(i, 1);
        prev.childBlockIds = prev.childBlockIds || [];
        prev.childBlockIds.push(blockId);
      }
      if (pg.properties && TASK_PROP.status in (pg.properties || {})) {
        /* task page: tab on a child task is handled in props, not here */
      }
    }
    if (dir < 0) {
      for (const parent of w.blocks.filter((b) => (b.childBlockIds || []).includes(blockId))) {
        parent.childBlockIds = parent.childBlockIds.filter((id) => id !== blockId);
        const pi = ids.indexOf(parent.id);
        ids.splice(pi >= 0 ? pi + 1 : ids.length, 0, blockId);
        return;
      }
    }
    void block;
  });
}

function openSlashAt(blockId, query, rect, ctx) {
  const q = query.toLowerCase();
  const items = SLASH_ITEMS.filter((x) => x.label.toLowerCase().includes(q) || x.t.includes(q) || x.hint.includes(q));
  slash = {
    blockId,
    query,
    items,
    i: 0,
    x: rect.left,
    y: rect.bottom + 6,
  };
  ctx.redrawOverlays?.();
}

export function applySlash(page, item, ctx) {
  if (!item || !slash) return;
  const blockId = slash.blockId;
  slash = null;
  if (item.t === "page") {
    let newId = null;
    mutate((w) => {
      const child = createPage({ title: "Untitled", parentPageId: page.id, icon: "📄" });
      w.pages.push(child);
      appendBlock(w, child, createBlock({ type: "paragraph", content: "" }));
      const b = getBlock(w, blockId);
      b.type = "page";
      b.content = "";
      b.props.pageId = child.id;
      newId = child.id;
    });
    ctx.openPage(newId);
    return;
  }
  if (item.t === "database") {
    let newId = null;
    mutate((w) => {
      const dbPage = createPage({ title: "New database", parentPageId: page.id, icon: "▦", type: "database" });
      const view = createView({ name: "Table", layout: "table" });
      const db = createDatabase({
        pageId: dbPage.id,
        properties: [
          createProperty({ name: "Status", type: "status", options: ["Inbox", "Doing", "Done"] }),
          createProperty({ name: "Priority", type: "priority", options: ["P1", "P2", "P3"] }),
        ],
        views: [view],
        defaultViewId: view.id,
      });
      w.pages.push(dbPage);
      w.databases.push(db);
      appendBlock(w, dbPage, createBlock({ type: "paragraph", content: "Rows are pages." }));
      const b = getBlock(w, blockId);
      b.type = "page";
      b.props.pageId = dbPage.id;
      newId = dbPage.id;
    });
    ctx.openPage(newId);
    return;
  }
  if (item.t === "image" || item.t === "embed") {
    const url = prompt(item.t === "image" ? "Image URL (https://) — large files belong as URLs, not data-URLs." : "Embed URL (https://)");
    mutate((w) => {
      const b = getBlock(w, blockId);
      b.type = item.t;
      b.content = (url || "").trim();
    });
    return;
  }
  mutate((w) => {
    const b = getBlock(w, blockId);
    b.type = item.t;
    b.content = "";
    if (item.t === "callout") b.props.emoji = "✦";
    if (item.t === "todo") b.props.checked = false;
  });
  requestAnimationFrame(() => document.querySelector(`[data-edit="${blockId}"]`)?.focus());
}

export function pickImageFile(blockId, file) {
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    toast("warn", `Image is ${(file.size / 1048576).toFixed(1)} MB (> 1.5 MB). Prefer a URL embed.`);
  }
  const reader = new FileReader();
  reader.onload = () => {
    mutate((w) => {
      const b = getBlock(w, blockId);
      if (b) {
        b.type = "image";
        b.content = String(reader.result);
      }
    });
  };
  reader.readAsDataURL(file);
}

export function addComment(blockId, body, personaId) {
  mutate((w) => {
    w.comments.push(createComment({ blockId, personaId, body }));
    for (const handle of mentionHandles(body)) {
      const p = getPersonaByHandle(w, handle);
      if (p) {
        pushActivity(w, {
          type: "mention",
          personaId,
          targetId: p.id,
          body: `@${handle} mentioned in a comment`,
        });
      }
    }
  });
}

export function renderComments(root, ws, blockId, ctx) {
  if (!blockId) {
    const feed = (ws.activity || []).slice(0, 20);
    root.innerHTML = `
      <header class="cmt-head"><strong>Activity</strong></header>
      <div class="cmt-list">
        ${feed.map((e) => {
          const p = getPersona(ws, e.personaId);
          return `<article class="cmt">
            <span class="dot" style="background:${p?.color || "#999"}"></span>
            <div><div class="cmt-meta"><strong>${esc(p?.name || "Lattice")}</strong></div>
            <p>${renderInline(e.body, ws)}</p></div>
          </article>`;
        }).join("") || `<p class="ph">No activity yet. Focus a block to comment.</p>`}
      </div>`;
    return;
  }
  const block = getBlock(ws, blockId);
  const threads = commentsForBlock(ws, blockId);
  const acting = getPersona(ws, ws.actingPersonaId);
  root.innerHTML = `
    <header class="cmt-head">
      <strong>Comments</strong>
      <span class="ph">${esc(block?.type || "")}</span>
    </header>
    <div class="cmt-list">
      ${threads.map((c) => {
        const p = getPersona(ws, c.personaId);
        const nested = c.parentCommentId ? " reply" : "";
        return `<article class="cmt${nested}">
          <span class="dot" style="background:${p?.color || "#999"}"></span>
          <div>
            <div class="cmt-meta"><strong>${esc(p?.name || "?")}</strong> <span class="ph">@${esc(p?.handle || "")}</span></div>
            <p>${renderInline(c.body, ws)}</p>
          </div>
        </article>`;
      }).join("") || `<p class="ph">No comments yet.</p>`}
    </div>
    <form class="cmt-form">
      <textarea name="body" rows="3" placeholder="Comment as ${esc(acting?.handle || "persona")}… use @handle"></textarea>
      <button type="submit" class="btn">Send</button>
    </form>`;
  root.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim();
    if (!body) return;
    addComment(blockId, body, ws.actingPersonaId);
    e.target.reset();
    ctx.redraw();
  };
}

export function slashHtml() {
  if (!slash) return "";
  return `<div class="slash" style="left:${slash.x}px;top:${slash.y}px">
    ${slash.items.map((it, i) => `<button class="slash-item${i === slash.i ? " on" : ""}" data-slash-i="${i}"><span>${esc(it.label)}</span><kbd>${esc(it.hint)}</kbd></button>`).join("") || `<div class="ph">No matches</div>`}
  </div>`;
}

export function slashIndexClick(i, page, ctx) {
  if (!slash) return;
  applySlash(page, slash.items[i], ctx);
}

export { SLASH_ITEMS };
