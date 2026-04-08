'use strict';

const STORAGE_KEY = 'todo-localstorage-tasks';
const DATA_VERSION = 1;

// ── Sanitization ────────────────────────────────────────────────────

function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Data Layer ──────────────────────────────────────────────────────

function loadTasks() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    // Handle versioned data
    if (Array.isArray(data)) {
      return migrateTasks(data);
    }
    return [];
  } catch (e) {
    console.warn('Corrupt localStorage data, resetting:', e);
    return [];
  }
}

function migrateTasks(tasks) {
  // V0 → V1: add missing fields
  return tasks.map(t => ({
    id: t.id || Date.now().toString() + Math.random().toString(36).slice(2, 7),
    text: sanitize(String(t.text || '')),
    completed: !!t.completed,
    createdAt: Number(t.createdAt) || Date.now(),
  }));
}

function saveTasks(tasks) {
  try {
    const payload = { version: DATA_VERSION, tasks };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('Хранилище переполнено. Удалите старые задачи.');
    } else {
      console.error('Failed to save tasks:', e);
    }
    return false;
  }
}

function createTask(text) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    text: sanitize(text),
    completed: false,
    createdAt: Date.now(),
  };
}

// ── Rendering ───────────────────────────────────────────────────────

function render(tasks) {
  const list = document.getElementById('task-list');
  const counter = document.getElementById('task-counter');
  const empty = document.getElementById('empty-state');

  // Update counter
  if (counter) {
    const done = tasks.filter(t => t.completed).length;
    counter.textContent = `${done}/${tasks.length} выполнено`;
  }

  // Show/hide empty state
  if (empty) {
    empty.style.display = tasks.length === 0 ? 'block' : 'none';
  }

  // Use DocumentFragment for batch DOM
  const fragment = document.createDocumentFragment();
  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = task.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', `Отметить задачу: ${task.text}`);
    checkbox.addEventListener('change', () => toggleTask(task.id));

    const label = document.createElement('span');
    label.className = 'task-text' + (task.completed ? ' completed' : '');
    label.textContent = task.text;
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '0');
    label.addEventListener('click', () => toggleTask(task.id));
    label.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTask(task.id);
      }
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.innerHTML = '✏️';
    editBtn.setAttribute('aria-label', 'Редактировать задачу');
    editBtn.addEventListener('click', () => editTask(task.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.setAttribute('aria-label', 'Удалить задачу');
    deleteBtn.addEventListener('click', () => deleteTask(task.id));

    li.appendChild(checkbox);
    li.appendChild(label);
    li.appendChild(editBtn);
    li.appendChild(deleteBtn);
    fragment.appendChild(li);
  });

  list.innerHTML = '';
  list.appendChild(fragment);
}

// ── Actions ─────────────────────────────────────────────────────────

function addTask(text) {
  if (!text || !text.trim()) return false;
  const tasks = loadTasks();
  // Dedup: check if same text already exists and is not completed
  const duplicate = tasks.find(t => t.text === sanitize(text.trim()) && !t.completed);
  if (duplicate) {
    alert('Такая задача уже существует!');
    return false;
  }
  tasks.push(createTask(text.trim()));
  return saveTasks(tasks);
}

function toggleTask(id) {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks(tasks);
    render(tasks);
  }
}

function deleteTask(id) {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx !== -1) {
    tasks.splice(idx, 1);
    saveTasks(tasks);
    render(tasks);
  }
}

function editTask(id) {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const newText = prompt('Редактировать задачу:', task.text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  if (newText !== null && newText.trim()) {
    task.text = sanitize(newText.trim());
    saveTasks(tasks);
    render(tasks);
  }
}

// ── Init ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const tasks = loadTasks();
  render(tasks);

  const form = document.getElementById('task-form');
  const input = document.getElementById('task-input');

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value;
    if (addTask(text)) {
      input.value = '';
      render(loadTasks());
    }
  });
});
