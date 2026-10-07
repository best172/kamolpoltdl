import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import {
  hashPassword, verifyPassword, dummyVerify,
  newSessionToken, hashToken, SESSION_COOKIE, SESSION_TTL_MS,
} from './auth.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_TITLE = 200;

export function createApp({ db = openDb() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  const q = {
    insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
    userByName: db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(`
      SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    listTasks: db.prepare('SELECT id, title, completed, created_at FROM tasks WHERE user_id = ? ORDER BY id'),
    insertTask: db.prepare('INSERT INTO tasks (user_id, title) VALUES (?, ?) RETURNING id, title, completed, created_at'),
    // Every task query is scoped by user_id, so one user can never touch another's rows.
    updateTask: db.prepare('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ? RETURNING id, title, completed, created_at'),
    deleteTask: db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?'),
  };

  const toTask = (row) => ({ ...row, completed: row.completed === 1 });

  function startSession(res, userId) {
    const token = newSessionToken();
    const expires = Date.now() + SESSION_TTL_MS;
    q.purgeSessions.run(Date.now());
    q.insertSession.run(hashToken(token), userId, expires);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  function requireAuth(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];
    const user = token && q.sessionUser.get(hashToken(token), Date.now());
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  }

  function readCredentials(body) {
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    return { username, password };
  }

  // ---------- Auth ----------
  app.post('/api/register', async (req, res) => {
    const { username, password } = readCredentials(req.body);
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-32 letters, numbers or underscores' });
    }
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: `Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` });
    }
    if (q.userByName.get(username)) {
      return res.status(409).json({ error: 'Username is already taken' });
    }
    const { lastInsertRowid } = q.insertUser.run(username, await hashPassword(password));
    startSession(res, Number(lastInsertRowid));
    res.status(201).json({ user: { id: Number(lastInsertRowid), username } });
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = readCredentials(req.body);
    const user = username && q.userByName.get(username);
    const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
    if (!user || !ok) return res.status(401).json({ error: 'Invalid username or password' });
    startSession(res, user.id);
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) q.deleteSession.run(hashToken(token));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // ---------- Tasks ----------
  app.get('/api/tasks', requireAuth, (req, res) => {
    res.json({ tasks: q.listTasks.all(req.user.id).map(toTask) });
  });

  app.post('/api/tasks', requireAuth, (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'Task title cannot be empty' });
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `Task title must be at most ${MAX_TITLE} characters` });
    res.status(201).json({ task: toTask(q.insertTask.get(req.user.id, title)) });
  });

  app.patch('/api/tasks/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid task id' });
    if (typeof req.body?.completed !== 'boolean') {
      return res.status(400).json({ error: '"completed" must be true or false' });
    }
    const row = q.updateTask.get(req.body.completed ? 1 : 0, id, req.user.id);
    // 404 (not 403) for someone else's task, so we don't reveal that it exists.
    if (!row) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: toTask(row) });
  });

  app.delete('/api/tasks/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid task id' });
    const { changes } = q.deleteTask.run(id, req.user.id);
    if (changes === 0) return res.status(404).json({ error: 'Task not found' });
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Malformed JSON and unexpected errors come back as JSON, never a stack trace.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
