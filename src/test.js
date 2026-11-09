'use strict';

/**
 * Browser test suite for TODO-LOCALSTORAGE.
 * Covers TodoCore (pure data layer) and TodoApp (storage, actions, undo, theme, rendering).
 * Open test.html to run. window.TestResults holds { total, passed, failed } for CI checks.
 */

(function () {
  // Silence blocking dialogs triggered by app code paths under test.
  window.alert = function () {};
  window.prompt = function () { return null; };
  window.confirm = function () { return false; };

  const STORAGE_KEY = 'todo-localstorage-tasks';
  const THEME_KEY = 'todo-theme';

  let passed = 0;
  let failed = 0;
  let section = '';
  const failures = [];
  const out = [];

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }

  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || 'eq failed'}: got ${a}, expected ${b}`);
  }

  function test(name, fn) {
    try {
      fn();
      passed += 1;
      out.push({ section, name, ok: true });
    } catch (e) {
      failed += 1;
      out.push({ section, name, ok: false, error: e.message });
      failures.push(`${section} > ${name}: ${e.message}`);
    }
  }

  function resetStorage() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(THEME_KEY);
  }

  const C = () => window.TodoCore;
  const A = () => window.TodoApp;

  function makeTask(text, extra) {
    return Object.assign(
      { id: C().uid(), text, completed: false, createdAt: 1700000000000, tags: [], due: null },
      extra
    );
  }

  // ── TodoCore ────────────────────────────────────────────────────────

  section = 'TodoCore';

  test('decodeEntities: расшифровывает пять базовых сущностей', () => {
    eq(C().decodeEntities('&amp;&lt;&gt;&quot;&#39;'), '&<>"\'');
  });

  test('decodeEntities: неизвестные сущности не трогает', () => {
    eq(C().decodeEntities('&nbsp;x'), '&nbsp;x');
  });

  test('parseTags: извлекает латинские и кириллические теги, приводит к нижнему регистру', () => {
    const r = C().parseTags('Купить хлеб #Покупки и #work');
    eq(r.tags, ['покупки', 'work']);
    eq(r.text, 'Купить хлеб и');
  });

  test('parseTags: дедуплицирует теги без учёта регистра', () => {
    const r = C().parseTags('#Work #work #WORK');
    eq(r.tags, ['work']);
  });

  test('migrateTasks: декодирует HTML-сущности из данных v1', () => {
    const [t] = C().migrateTasks([{ text: 'a &lt;b&gt; &amp; c', completed: 1 }]);
    eq(t.text, 'a <b> & c');
    eq(t.completed, true);
    assert(typeof t.id === 'string' && t.id.length > 0, 'id сгенерирован');
    assert(Number.isFinite(t.createdAt), 'createdAt заполнен');
  });

  test('migrateTasks: нормализует due и tags', () => {
    const [t] = C().migrateTasks([
      { text: 'x', due: '2025-13-99', tags: ['A', 'a', '', 42] },
    ]);
    eq(t.due, null, 'невалидная дата → null');
    eq(t.tags, ['a'], 'теги очищены и приведены к нижнему регистру');
    const [ok] = C().migrateTasks([{ text: 'x', due: '2025-06-01' }]);
    eq(ok.due, '2025-06-01');
  });

  test('migrateTasks: календарные даты — 2024-02-29 валиден, 2025-02-29 нет', () => {
    eq(C().migrateTasks([{ text: 'x', due: '2024-02-29' }])[0].due, '2024-02-29', 'високосный год');
    eq(C().migrateTasks([{ text: 'x', due: '2025-02-29' }])[0].due, null, 'не високосный год');
    eq(C().migrateTasks([{ text: 'x', due: '2025-04-31' }])[0].due, null, '31 апреля не существует');
  });

  test('migrateTasks: ограничивает объём 5000 задачами', () => {
    const big = Array.from({ length: 5001 }, () => ({ text: 'x' }));
    eq(C().migrateTasks(big).length, 5000);
  });

  test('migrateTasks: не-массив → пустой список', () => {
    eq(C().migrateTasks(null), []);
    eq(C().migrateTasks('nope'), []);
  });

  test('validateImport: принимает массив задач', () => {
    const r = C().validateImport([{ text: 'hello' }]);
    assert(Array.isArray(r) && r.length === 1);
  });

  test('validateImport: принимает { tasks: [...] }', () => {
    const r = C().validateImport({ tasks: [{ text: 'hello' }] });
    assert(Array.isArray(r) && r.length === 1);
  });

  test('validateImport: отклоняет больше 5000 задач', () => {
    const big = Array.from({ length: 5001 }, () => ({ text: 'x' }));
    eq(C().validateImport(big), null);
  });

  test('validateImport: отклоняет пустой текст задачи', () => {
    eq(C().validateImport([{ text: '' }]), null);
  });

  test('validateImport: отклоняет текст длиннее 500 символов', () => {
    eq(C().validateImport([{ text: 'x'.repeat(501) }]), null);
  });

  test('validateImport: отклоняет не-массив и не-объект', () => {
    eq(C().validateImport(null), null);
    eq(C().validateImport('string'), null);
    eq(C().validateImport({ nope: true }), null);
  });

  test('applyFilter: all / active / completed', () => {
    const tasks = [makeTask('a'), makeTask('b', { completed: true })];
    eq(C().applyFilter(tasks, 'all').length, 2);
    eq(C().applyFilter(tasks, 'active').map((t) => t.text), ['a']);
    eq(C().applyFilter(tasks, 'completed').map((t) => t.text), ['b']);
  });

  test('applyFilter: фильтр по тегу, включая комбинацию со статусом', () => {
    const tasks = [
      makeTask('a', { tags: ['work'] }),
      makeTask('b', { tags: ['home'] }),
      makeTask('c', { tags: ['work'], completed: true }),
    ];
    eq(C().applyFilter(tasks, 'all', 'work').length, 2);
    eq(C().applyFilter(tasks, 'active', 'work').map((t) => t.text), ['a']);
  });

  test('sortTasks: date-desc и date-asc', () => {
    const tasks = [
      makeTask('mid', { createdAt: 2000 }),
      makeTask('old', { createdAt: 1000 }),
      makeTask('new', { createdAt: 3000 }),
    ];
    eq(C().sortTasks(tasks, 'date-desc').map((t) => t.text), ['new', 'mid', 'old']);
    eq(C().sortTasks(tasks, 'date-asc').map((t) => t.text), ['old', 'mid', 'new']);
  });

  test('sortTasks: alpha с кириллицей (locale ru)', () => {
    const tasks = [makeTask('яблоко'), makeTask('апельсин'), makeTask('банан')];
    eq(C().sortTasks(tasks, 'alpha').map((t) => t.text), ['апельсин', 'банан', 'яблоко']);
  });

  test('sortTasks: выполненные всегда опускаются вниз', () => {
    const tasks = [
      makeTask('done', { completed: true, createdAt: 3000 }),
      makeTask('old', { createdAt: 1000 }),
    ];
    eq(C().sortTasks(tasks, 'date-desc').map((t) => t.text), ['old', 'done']);
  });

  test('reorder: перемещает задачу на позицию другой', () => {
    const tasks = [makeTask('a', { id: '1' }), makeTask('b', { id: '2' }), makeTask('c', { id: '3' })];
    eq(C().reorder(tasks, '3', '1').map((t) => t.id), ['3', '1', '2']);
  });

  test('reorder: no-op при отсутствии или совпадении id', () => {
    const tasks = [makeTask('a', { id: '1' }), makeTask('b', { id: '2' })];
    eq(C().reorder(tasks, 'x', '1'), tasks);
    eq(C().reorder(tasks, '1', '1'), tasks);
  });

  test('reorderStep: сдвиг вверх и вниз', () => {
    const tasks = [makeTask('a', { id: '1' }), makeTask('b', { id: '2' }), makeTask('c', { id: '3' })];
    eq(C().reorderStep(tasks, '2', -1).map((t) => t.id), ['2', '1', '3']);
    eq(C().reorderStep(tasks, '2', 1).map((t) => t.id), ['1', '3', '2']);
  });

  test('reorderStep: границы массива — no-op', () => {
    const tasks = [makeTask('a', { id: '1' }), makeTask('b', { id: '2' })];
    eq(C().reorderStep(tasks, '1', -1), tasks);
    eq(C().reorderStep(tasks, '2', 1), tasks);
    eq(C().reorderStep(tasks, 'ghost', 1), tasks);
  });

  test('dueStatus: overdue / today / later при фиксированном «сейчас»', () => {
    const now = new Date(2025, 5, 15, 12, 0, 0);
    eq(C().dueStatus('2025-06-14', now), 'overdue');
    eq(C().dueStatus('2025-06-15', now), 'today');
    eq(C().dueStatus('2025-06-16', now), 'later');
  });

  test('dueStatus: null и мусор → null', () => {
    const now = new Date(2025, 5, 15);
    eq(C().dueStatus(null, now), null);
    eq(C().dueStatus('', now), null);
    eq(C().dueStatus('не дата', now), null);
  });

  test('deleteCompleted: разделяет на оставшиеся и удалённые', () => {
    const tasks = [makeTask('a'), makeTask('b', { completed: true }), makeTask('c', { completed: true })];
    const r = C().deleteCompleted(tasks);
    eq(r.kept.map((t) => t.text), ['a']);
    eq(r.removed.length, 2);
  });

  // ── TodoApp (требует DOM и localStorage) ────────────────────────────

  section = 'TodoApp';

  test('createTask: парсит теги, текст очищен, due по умолчанию null', () => {
    const t = A().createTask('Сделать #work и #отчёт', '2025-01-02');
    eq(t.text, 'Сделать и');
    eq(t.tags, ['work', 'отчёт']);
    eq(t.due, '2025-01-02');
    eq(A().createTask('plain').due, null);
  });

  test('addTask: сохраняет формат v2 {version, tasks} с тегами и due', () => {
    resetStorage();
    assert(A().addTask('hello #work', '2025-01-02') === true, 'addTask вернул true');
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    eq(raw.version, 2);
    assert(Array.isArray(raw.tasks) && raw.tasks.length === 1);
    eq(raw.tasks[0].text, 'hello');
    eq(raw.tasks[0].tags, ['work']);
    eq(raw.tasks[0].due, '2025-01-02');
  });

  test('addTask: дубликат среди активных отклоняется', () => {
    resetStorage();
    A().addTask('дубль');
    assert(A().addTask('дубль') === false, 'дубликат отклонён');
    eq(A().loadTasks().length, 1);
  });

  test('addTask: пустой текст отклоняется', () => {
    resetStorage();
    assert(A().addTask('   ') === false);
    eq(A().loadTasks(), []);
  });

  test('loadTasks: мигрирует legacy-массив (v0/v1) из localStorage', () => {
    resetStorage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ text: 'legacy &lt;b&gt;', completed: true }]));
    const migrated = A().loadTasks();
    eq(migrated.length, 1);
    eq(migrated[0].text, 'legacy <b>', 'сущности v1 декодированы');
    eq(migrated[0].completed, true);
    assert(typeof migrated[0].id === 'string', 'id сгенерирован');
    assert(migrated[0].tags.length === 0 && migrated[0].due === null, 'поля v2 дозаполнены');
  });

  test('loadTasks: битый JSON → пустой список без исключения', () => {
    resetStorage();
    localStorage.setItem(STORAGE_KEY, '{сломанный json');
    eq(A().loadTasks(), []);
  });

  test('toggleTask: переключает выполненность', () => {
    resetStorage();
    A().addTask('toggle me');
    const id = A().loadTasks()[0].id;
    A().toggleTask(id);
    eq(A().loadTasks()[0].completed, true);
    A().toggleTask(id);
    eq(A().loadTasks()[0].completed, false);
  });

  test('deleteTask + undoLast: удаление можно отменить', () => {
    resetStorage();
    A().addTask('undo me');
    const id = A().loadTasks()[0].id;
    A().deleteTask(id);
    eq(A().loadTasks().length, 0, 'задача удалена');
    A().undoLast();
    eq(A().loadTasks().map((t) => t.text), ['undo me'], 'задача восстановлена');
  });

  test('clearCompleted: удаляет только выполненные', () => {
    resetStorage();
    A().addTask('a');
    A().addTask('b');
    const first = A().loadTasks()[0];
    A().toggleTask(first.id);
    A().clearCompleted();
    const after = A().loadTasks();
    eq(after.length, 1);
    eq(after[0].text, 'b');
  });

  test('moveTask: сдвиг по стрелкам меняет порядок', () => {
    resetStorage();
    A().addTask('one');
    A().addTask('two');
    A().addTask('three');
    const ids = A().loadTasks().map((t) => t.id);
    A().moveTask(ids[2], -1);
    eq(A().loadTasks().map((t) => t.id), [ids[0], ids[2], ids[1]]);
  });

  test('dropTask: drag-and-drop переносит задачу', () => {
    resetStorage();
    A().addTask('one');
    A().addTask('two');
    A().addTask('three');
    const ids = A().loadTasks().map((t) => t.id);
    A().dropTask(ids[0], ids[1]);
    eq(A().loadTasks().map((t) => t.id), [ids[1], ids[0], ids[2]]);
  });

  test('setFilter / setSort / setActiveTag: обновляют состояние', () => {
    A().setFilter('active');
    eq(A().state.filter, 'active');
    A().setSort('alpha');
    eq(A().state.sort, 'alpha');
    A().setActiveTag('work');
    eq(A().state.activeTag, 'work');
    A().setActiveTag('work');
    eq(A().state.activeTag, null, 'повторный клик снимает фильтр');
    A().setFilter('all');
    A().setSort('manual');
  });

  test('тема: applyTheme меняет data-theme и color-scheme, getTheme по умолчанию auto', () => {
    resetStorage();
    eq(A().getTheme(), 'auto');
    A().applyTheme('dark');
    eq(document.documentElement.dataset.theme, 'dark');
    eq(document.documentElement.style.colorScheme, 'dark');
    A().applyTheme('light');
    eq(document.documentElement.dataset.theme, 'light');
  });

  test('XSS: HTML в тексте рендерится как текст, скрипт не исполняется', () => {
    resetStorage();
    const payload = '<img src=x onerror=window.__xss_fired=1>';
    assert(A().addTask(payload) === true);
    const label = document.querySelector('#task-list .task-text');
    assert(label, 'задача отрендерена');
    eq(label.textContent, payload, 'текст сохранён дословно через textContent');
    assert(!document.querySelector('#task-list img'), 'img-элемент не создан');
    assert(window.__xss_fired === undefined, 'onerror не сработал');
  });

  // ── Отрисовка результатов ───────────────────────────────────────────

  function render() {
    const summary = document.getElementById('test-summary');
    const output = document.getElementById('test-output');
    if (!summary || !output) return;

    summary.textContent = failed === 0
      ? `✅ Все тесты пройдены: ${passed}/${passed + failed}`
      : `❌ Провалено: ${failed} из ${passed + failed}`;
    summary.className = `test-summary ${failed === 0 ? 'all-pass' : 'has-fail'}`;

    output.innerHTML = '';
    let current = null;
    let ul = null;
    out.forEach((r) => {
      if (r.section !== current) {
        current = r.section;
        const h = document.createElement('div');
        h.className = 'test-section';
        h.textContent = current;
        output.appendChild(h);
        ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.paddingLeft = '8px';
        output.appendChild(ul);
      }
      const li = document.createElement('li');
      li.className = `test-case ${r.ok ? '' : 'fail'}`;
      li.textContent = `${r.ok ? '✔' : '✘'} ${r.name}`;
      if (!r.ok) {
        const err = document.createElement('div');
        err.className = 'err';
        err.textContent = r.error;
        li.appendChild(err);
      }
      ul.appendChild(li);
    });

    window.TestResults = { total: passed + failed, passed, failed, failures };
  }

  function run() {
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run); // initApp (зарегистрирован раньше) уже выполнится
  } else {
    run();
  }
})();
