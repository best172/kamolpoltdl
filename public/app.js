const $ = (sel) => document.querySelector(sel);
const authView = $('#auth-view');
const tasksView = $('#tasks-view');
const errorBox = $('#error');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function showError(message) {
  errorBox.textContent = message || '';
  errorBox.hidden = !message;
}

function showAuth() {
  tasksView.hidden = true;
  authView.hidden = false;
}

async function showTasks(user) {
  $('#whoami').textContent = `Signed in as ${user.username}`;
  authView.hidden = true;
  tasksView.hidden = false;
  await loadTasks();
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = task.completed ? 'done' : '';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', 'Mark complete');
  checkbox.addEventListener('change', () => run(async () => {
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { completed: checkbox.checked } });
    await loadTasks();
  }));

  const title = document.createElement('span');
  title.textContent = task.title; // textContent, never innerHTML, so task text can't inject HTML

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = 'Delete';
  del.addEventListener('click', () => run(async () => {
    await api(`/tasks/${task.id}`, { method: 'DELETE' });
    await loadTasks();
  }));

  li.append(checkbox, title, del);
  return li;
}

async function loadTasks() {
  const { tasks } = await api('/tasks');
  $('#task-list').replaceChildren(...tasks.map(renderTask));
  $('#empty').hidden = tasks.length > 0;
}

// Runs an action, showing any error; a 401 means the session ended, so go back to login.
async function run(action) {
  showError('');
  try {
    await action();
  } catch (err) {
    if (err.status === 401 && !tasksView.hidden) showAuth();
    showError(err.message);
  }
}

$('#auth-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const action = e.submitter?.dataset.action === 'register' ? 'register' : 'login';
  const form = new FormData(e.target);
  run(async () => {
    const { user } = await api(`/${action}`, {
      method: 'POST',
      body: { username: form.get('username'), password: form.get('password') },
    });
    e.target.reset();
    await showTasks(user);
  });
});

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = e.target.elements.title;
  run(async () => {
    await api('/tasks', { method: 'POST', body: { title: input.value } });
    input.value = '';
    await loadTasks();
  });
});

$('#logout').addEventListener('click', () => run(async () => {
  await api('/logout', { method: 'POST' });
  showAuth();
}));

// On page load: if the session cookie is still valid, go straight to the task list.
api('/me').then(({ user }) => showTasks(user)).catch(showAuth);
