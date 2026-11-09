'use strict';

/**
 * Pure data layer — no DOM access, testable in Node and browser.
 * Storage format v2: { version: 2, tasks: [{ id, text, completed, createdAt, tags, due }] }
 * Text is stored RAW and escaped only at render time (textContent).
 */

const DATA_VERSION = 2;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Decode HTML entities left by v1 data (which stored escaped text). */
function decodeEntities(str) {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
  return String(str).replace(/&(amp|lt|gt|quot|#39);/g, (m, ent) => map[ent] ?? m);
}

/** Parse `#tag` tokens out of the text. Cyrillic and latin tags supported. */
function parseTags(text) {
  const tags = [];
  const cleanText = String(text)
    .replace(/#([\wа-яё][\wа-яё-]{0,30})/giu, (_m, tag) => {
      const t = tag.toLowerCase();
      if (!tags.includes(t)) tags.push(t);
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: cleanText, tags };
}

/** Strict YYYY-MM-DD calendar check (rejects 2025-13-99, 2025-02-30, …). */
function isValidDue(due) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Migrate any historical shape (v0 array, v1 {version:1}, raw text) to v2. */
function migrateTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice(0, 5000).map((t) => {
    let text = typeof t.text === 'string' ? t.text : '';
    if (/&amp;|&lt;|&gt;|&quot;|&#39;/.test(text)) text = decodeEntities(text);
    const due = typeof t.due === 'string' && isValidDue(t.due) ? t.due : null;
    const tags = Array.isArray(t.tags)
      ? [...new Set(t.tags.filter((x) => typeof x === 'string' && x.length > 0).map((x) => x.toLowerCase()))]
      : [];
    return {
      id: typeof t.id === 'string' && t.id.length > 0 ? t.id : uid(),
      text,
      completed: !!t.completed,
      createdAt: Number(t.createdAt) || Date.now(),
      tags,
      due,
    };
  });
}

/** Validate and normalize an imported payload. Returns tasks array or null. */
function validateImport(data) {
  let raw = null;
  if (Array.isArray(data)) raw = data;
  else if (data && typeof data === 'object' && Array.isArray(data.tasks)) raw = data.tasks;
  if (raw === null) return null;
  if (raw.length > 5000) return null;
  const migrated = migrateTasks(raw);
  return migrated.every((t) => t.text.length > 0 && t.text.length <= 500) ? migrated : null;
}

function applyFilter(tasks, filter, activeTag) {
  let out = tasks;
  if (filter === 'active') out = out.filter((t) => !t.completed);
  else if (filter === 'completed') out = out.filter((t) => t.completed);
  if (activeTag) out = out.filter((t) => t.tags.includes(activeTag));
  return out;
}

/** sort: 'date-desc' (newest first), 'date-asc', 'alpha'. Completed tasks sink to the bottom. */
function sortTasks(tasks, mode) {
  const byMode = (a, b) => {
    if (mode === 'alpha') return a.text.localeCompare(b.text, 'ru');
    if (mode === 'date-asc') return a.createdAt - b.createdAt;
    return b.createdAt - a.createdAt;
  };
  return [...tasks].sort((a, b) => (a.completed === b.completed ? byMode(a, b) : a.completed ? 1 : -1));
}

/** Move task with fromId to the position of toId. Returns a new array. */
function reorder(tasks, fromId, toId) {
  const from = tasks.findIndex((t) => t.id === fromId);
  const to = tasks.findIndex((t) => t.id === toId);
  if (from === -1 || to === -1 || from === to) return tasks;
  const out = [...tasks];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/** Move task one position up (dir=-1) or down (dir=1). */
function reorderStep(tasks, id, dir) {
  const idx = tasks.findIndex((t) => t.id === id);
  const target = idx + dir;
  if (idx === -1 || target < 0 || target >= tasks.length) return tasks;
  const out = [...tasks];
  [out[idx], out[target]] = [out[target], out[idx]];
  return out;
}

/** Pure due-date check: 'overdue' | 'today' | 'later' | null. */
function dueStatus(due, now = new Date()) {
  if (!due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDate = new Date(due + 'T23:59:59');
  if (Number.isNaN(dueDate.getTime())) return null;
  if (dueDate.getTime() < today.getTime()) return 'overdue';
  if (dueDate.getFullYear() === today.getFullYear() && dueDate.getMonth() === today.getMonth() && dueDate.getDate() === today.getDate()) return 'today';
  return 'later';
}

/** Bulk delete: remove completed tasks, return { kept, removed }. */
function deleteCompleted(tasks) {
  const removed = tasks.filter((t) => t.completed);
  return { kept: tasks.filter((t) => !t.completed), removed };
}

if (typeof window !== 'undefined') {
  window.TodoCore = {
    DATA_VERSION, uid, decodeEntities, parseTags, migrateTasks, validateImport,
    applyFilter, sortTasks, reorder, reorderStep, dueStatus, deleteCompleted,
  };
}
