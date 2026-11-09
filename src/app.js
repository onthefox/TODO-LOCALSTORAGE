'use strict';

/**
 * UI controller on top of the pure data layer (core.js).
 * All text is rendered via textContent (XSS-safe by construction).
 * Destructive actions (delete, bulk clear, import) are undoable for 10s.
 */

const STORAGE_KEY = 'todo-localstorage-tasks';
const THEME_KEY = 'todo-theme';
const UNDO_TIMEOUT_MS = 10000;

// ── Storage ─────────────────────────────────────────────────────────

function loadTasks() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return window.TodoCore.migrateTasks(data); // v0/v1
    if (data && typeof data === 'object' && data.version === 2 && Array.isArray(data.tasks)) {
      return window.TodoCore.migrateTasks(data.tasks);
    }
    return [];
  } catch (e) {
    console.warn('Corrupt localStorage data, resetting:', e);
    return [];
  }
}

function saveTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, tasks }));
    return true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      alert('Хранилище переполнено. Удалите старые задачи.');
    } else {
      console.error('Failed to save tasks:', e);
    }
    return false;
  }
}

function createTask(text, due) {
  const parsed = window.TodoCore.parseTags(text);
  return {
    id: window.TodoCore.uid(),
    text: parsed.text,
    completed: false,
    createdAt: Date.now(),
    tags: parsed.tags,
    due: due || null,
  };
}

// ── App state ───────────────────────────────────────────────────────

const state = { filter: 'all', sort: 'manual', activeTag: null };
let undoTimer = null;
let undoSnapshot = null;

function snapshotForUndo() {
  undoSnapshot = loadTasks();
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoSnapshot = null; hideUndo(); }, UNDO_TIMEOUT_MS);
}

function undoLast() {
  if (!undoSnapshot) return;
  saveTasks(undoSnapshot);
  undoSnapshot = null;
  clearTimeout(undoTimer);
  hideUndo();
  renderAll();
}

// ── Actions ─────────────────────────────────────────────────────────

function addTask(text, due) {
  if (!text || !text.trim()) return false;
  const tasks = loadTasks();
  const candidate = createTask(text.trim(), due);
  if (candidate.text.length === 0 && candidate.tags.length === 0) return false;
  const duplicate = tasks.some((t) => t.text === candidate.text && !t.completed);
  if (duplicate) {
    alert('Такая задача уже существует!');
    return false;
  }
  tasks.push(candidate);
  const ok = saveTasks(tasks);
  if (ok) renderAll();
  return ok;
}

function toggleTask(id) {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks(tasks);
    renderAll();
  }
}

function deleteTask(id) {
  snapshotForUndo();
  saveTasks(loadTasks().filter((t) => t.id !== id));
  showUndo('Задача удалена');
  renderAll();
}

function editTask(id) {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const newText = prompt('Редактировать задачу:', task.text);
  if (newText === null) return;
  const trimmed = newText.trim();
  if (!trimmed) return;
  const parsed = window.TodoCore.parseTags(trimmed);
  task.text = parsed.text;
  task.tags = parsed.tags;
  saveTasks(tasks);
  renderAll();
}

function clearCompleted() {
  const tasks = loadTasks();
  const { kept, removed } = window.TodoCore.deleteCompleted(tasks);
  if (removed.length === 0) return;
  snapshotForUndo();
  saveTasks(kept);
  showUndo(`Удалено выполненных: ${removed.length}`);
  renderAll();
}

function moveTask(id, dir) {
  const tasks = loadTasks();
  saveTasks(window.TodoCore.reorderStep(tasks, id, dir));
  renderAll();
}

function dropTask(fromId, toId) {
  const tasks = loadTasks();
  saveTasks(window.TodoCore.reorder(tasks, fromId, toId));
  renderAll();
}

function setFilter(filter) { state.filter = filter; renderAll(); }
function setSort(sort) { state.sort = sort; renderAll(); }
function setActiveTag(tag) { state.activeTag = state.activeTag === tag ? null : tag; renderAll(); }

// ── Import / Export ─────────────────────────────────────────────────

function exportJson() {
  const data = JSON.stringify({ version: 2, tasks: loadTasks(), exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `todo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(String(reader.result)); } catch { alert('Файл не является корректным JSON.'); return; }
    const imported = window.TodoCore.validateImport(data);
    if (imported === null) { alert('Импорт отклонён: некорректный формат данных.'); return; }
    snapshotForUndo();
    saveTasks(imported);
    showUndo(`Импортировано задач: ${imported.length}`);
    renderAll();
  };
  reader.readAsText(file);
}

// ── Theme ───────────────────────────────────────────────────────────

function getTheme() { return localStorage.getItem(THEME_KEY) || 'auto'; }

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.style.colorScheme = dark ? 'dark' : 'light';
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = dark ? '☀️ Светлая' : '🌙 Тёмная';
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(getTheme()) + 1) % order.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ── Rendering ───────────────────────────────────────────────────────

function currentView() {
  const tasks = loadTasks();
  const manual = state.sort === 'manual';
  const filtered = window.TodoCore.applyFilter(tasks, state.filter, state.activeTag);
  return { tasks, view: manual ? filtered : window.TodoCore.sortTasks(filtered, state.sort) };
}

function renderAll() {
  renderList();
  renderToolbar();
  renderTagChips();
}

function renderList() {
  const { tasks, view } = currentView();
  const list = document.getElementById('task-list');
  const counter = document.getElementById('task-counter');
  const empty = document.getElementById('empty-state');
  const done = tasks.filter((t) => t.completed).length;

  if (counter) counter.textContent = `${done}/${tasks.length} выполнено`;
  if (empty) empty.style.display = view.length === 0 ? 'block' : 'none';

  const manual = state.sort === 'manual';
  const fragment = document.createDocumentFragment();
  view.forEach((task) => fragment.appendChild(renderItem(task, manual)));
  list.innerHTML = '';
  list.appendChild(fragment);
}

function renderItem(task, dndEnabled) {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.completed ? ' is-completed' : '');
  li.dataset.id = task.id;

  if (dndEnabled) {
    li.draggable = true;
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '⠿';
    grip.setAttribute('aria-hidden', 'true');
    li.appendChild(grip);
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drop-target');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drop-target');
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== task.id) dropTask(fromId, task.id);
    });
    li.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveTask(task.id, -1); }
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveTask(task.id, 1); }
    });
  }

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `Отметить задачу: ${task.text}`);
  checkbox.addEventListener('change', () => toggleTask(task.id));

  const content = document.createElement('div');
  content.className = 'task-content';

  const label = document.createElement('span');
  label.className = 'task-text';
  label.textContent = task.text;
  label.setAttribute('role', 'button');
  label.setAttribute('tabindex', '0');
  label.addEventListener('click', () => toggleTask(task.id));
  label.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id); }
  });
  content.appendChild(label);

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const status = window.TodoCore.dueStatus(task.due);
  if (task.due) {
    const due = document.createElement('span');
    due.className = 'badge due-' + (status ?? 'later');
    due.textContent = status === 'overdue' ? `⚠ просрочено ${task.due}` : status === 'today' ? `📍 сегодня` : `📅 ${task.due}`;
    meta.appendChild(due);
  }
  task.tags.forEach((tag) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.activeTag === tag ? ' chip-active' : '');
    chip.textContent = '#' + tag;
    chip.setAttribute('aria-label', `Фильтровать по тегу ${tag}`);
    chip.addEventListener('click', () => setActiveTag(tag));
    meta.appendChild(chip);
  });
  if (meta.childElementCount > 0) content.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  if (dndEnabled) {
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn-icon';
    up.innerHTML = '↑';
    up.setAttribute('aria-label', `Переместить выше: ${task.text}`);
    up.addEventListener('click', () => moveTask(task.id, -1));
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn-icon';
    down.innerHTML = '↓';
    down.setAttribute('aria-label', `Переместить ниже: ${task.text}`);
    down.addEventListener('click', () => moveTask(task.id, 1));
    actions.appendChild(up);
    actions.appendChild(down);
  }
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-icon';
  editBtn.innerHTML = '✏️';
  editBtn.setAttribute('aria-label', 'Редактировать задачу');
  editBtn.addEventListener('click', () => editTask(task.id));
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-icon';
  deleteBtn.innerHTML = '🗑️';
  deleteBtn.setAttribute('aria-label', 'Удалить задачу');
  deleteBtn.addEventListener('click', () => deleteTask(task.id));
  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(checkbox);
  li.appendChild(content);
  li.appendChild(actions);
  return li;
}

function renderToolbar() {
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    const active = btn.dataset.filter === state.filter;
    btn.classList.toggle('seg-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const sortSel = document.getElementById('sort-select');
  if (sortSel) sortSel.value = state.sort;
  const clearBtn = document.getElementById('clear-completed');
  if (clearBtn) {
    const tasks = loadTasks();
    const done = tasks.filter((t) => t.completed).length;
    clearBtn.disabled = done === 0;
    clearBtn.textContent = `Убрать выполненные (${done})`;
  }
}

function renderTagChips() {
  const box = document.getElementById('tag-chips');
  if (!box) return;
  const tasks = loadTasks();
  const counts = new Map();
  tasks.forEach((t) => t.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
  box.innerHTML = '';
  if (counts.size === 0) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([tag, n]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.activeTag === tag ? ' chip-active' : '');
    chip.textContent = `#${tag} (${n})`;
    chip.setAttribute('aria-label', `Фильтровать по тегу ${tag}, задач: ${n}`);
    chip.addEventListener('click', () => setActiveTag(tag));
    box.appendChild(chip);
  });
}

// ── Undo snackbar ───────────────────────────────────────────────────

function showUndo(message) {
  const bar = document.getElementById('snackbar');
  if (!bar) return;
  document.getElementById('snackbar-text').textContent = message;
  bar.classList.add('visible');
}

function hideUndo() {
  const bar = document.getElementById('snackbar');
  if (bar) bar.classList.remove('visible');
}

// ── Init ────────────────────────────────────────────────────────────

function initApp() {
  applyTheme(getTheme());
  renderAll();

  document.getElementById('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('task-input');
    const dueInput = document.getElementById('due-input');
    if (addTask(input.value, dueInput.value || null)) {
      input.value = '';
      dueInput.value = '';
      input.focus();
    }
  });

  document.querySelectorAll('[data-filter]').forEach((btn) =>
    btn.addEventListener('click', () => setFilter(btn.dataset.filter)));
  document.getElementById('sort-select').addEventListener('change', (e) => setSort(e.target.value));
  document.getElementById('clear-completed').addEventListener('click', () => clearCompleted());
  document.getElementById('export-btn').addEventListener('click', () => exportJson());
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('theme-toggle').addEventListener('click', () => cycleTheme());
  document.getElementById('undo-btn').addEventListener('click', () => undoLast());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'auto') applyTheme('auto');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

if (typeof window !== 'undefined') {
  window.TodoApp = {
    loadTasks, saveTasks, createTask, addTask, toggleTask, deleteTask, editTask,
    clearCompleted, moveTask, dropTask, setFilter, setSort, setActiveTag,
    exportJson, importJson, undoLast, applyTheme, getTheme, state,
  };
}
