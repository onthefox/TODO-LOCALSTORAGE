const STORAGE_KEY = 'todo-localstorage-tasks';

function loadTasks() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function createTask(text) {
  return {
    id: Date.now().toString(),
    text,
    completed: false,
    createdAt: Date.now(),
  };
}

function render(tasks) {
  const list = document.getElementById('task-list');
  list.innerHTML = '';
  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item';

    const label = document.createElement('span');
    label.className = 'task-text' + (task.completed ? ' completed' : '');
    label.textContent = task.text;
    label.onclick = () => {
      task.completed = !task.completed;
      saveTasks(tasks);
      render(tasks);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.innerText = '🗑️';
    deleteBtn.onclick = () => {
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        tasks.splice(idx, 1);
        saveTasks(tasks);
        render(tasks);
      }
    };

    li.appendChild(label);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  let tasks = loadTasks();
  render(tasks);

  const form = document.getElementById('task-form');
  form.onsubmit = e => {
    e.preventDefault();
    const input = document.getElementById('task-input');
    const text = input.value.trim();
    if (text) {
      tasks.push(createTask(text));
      saveTasks(tasks);
      render(tasks);
      input.value = '';
    }
  };
});