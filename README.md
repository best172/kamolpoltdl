# Full-stack to-do

A small to-do web app with username/password login. Each user sees only their own tasks and can add, complete and delete them. Data is stored in SQLite.

**Stack:** Node.js 24, Express 5, SQLite through Node's built-in `node:sqlite`, and a plain HTML/CSS/JS front end. Tests use `node:test` with `supertest`. The Vercel entry point serves both the API and the front end.

## Run locally

```bash
npm install
cp .env.example .env   # optional; defaults work without it
npm start              # http://localhost:3000
npm test               # runs the login and task-list tests against an in-memory DB
```

## Project layout

```
public/            Front end (served as static files)
  index.html       Login form + task list markup
  app.js           Calls the API with fetch(), renders tasks
  styles.css
src/
  app.js           Express app: auth + task API routes
  auth.js          Password hashing (scrypt) and session tokens
  db.js            Opens SQLite, creates the schema
server.js          Local entry point (app.listen)
api/index.js       Vercel serverless entry point (exports the app)
vercel.json        Routes /api/* to the serverless function
test/              Tests for login and the task list
```

## How a request travels

1. **Front end.** `public/app.js` calls `fetch('/api/tasks', …)`. The browser sends the `session` cookie with the request automatically.
2. **API.** `src/app.js` → `requireAuth` hashes the cookie token and looks it up in the `sessions` table. If the token is missing or expired, the API returns `401`. Otherwise it sets `req.user`.
3. **Database.** The route runs a prepared SQL statement. Every task query includes `WHERE user_id = ?`, so a user can never read or change another user's rows. If a user asks for someone else's task, the API returns `404`.

### API

| Method | Path              | Body                      | Notes                         |
|--------|-------------------|---------------------------|-------------------------------|
| POST   | /api/register     | `{username, password}`    | Creates the user and logs in  |
| POST   | /api/login        | `{username, password}`    | Sets an httpOnly cookie       |
| POST   | /api/logout       |                           | Deletes the session           |
| GET    | /api/me           |                           | Current user, or 401          |
| GET    | /api/tasks        |                           | Your tasks only               |
| POST   | /api/tasks        | `{title}`                 | Empty or whitespace → 400     |
| PATCH  | /api/tasks/:id    | `{completed: boolean}`    | Not yours → 404               |
| DELETE | /api/tasks/:id    |                           | Not yours → 404               |

### Schema

- `users(id, username UNIQUE NOCASE, password_hash, created_at)`
- `sessions(token_hash PK, user_id → users, expires_at)`
- `tasks(id, user_id → users, title, completed 0/1, created_at)`

## Security notes

- Passwords are hashed with salted **scrypt** and are never stored as plain text. The stored format is `scrypt$salt$hash`.
- Session tokens are 32 random bytes. The database stores only their SHA-256 hash, and the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Login returns the same error for an unknown user and for a wrong password, and both take about the same time.
- Task titles are rendered with `textContent`, so a title can't inject HTML.
- `.env` and `*.db` files are in `.gitignore`.
- Not included: rate limiting on login, CSRF tokens (`SameSite=Lax` covers the basic case) and password reset.

## Deploying to Vercel: SQLite caveat

The Vercel configuration now routes both `/api/*` and front-end paths through the Express entry point, so the web UI works after deployment. SQLite is still suitable for a demo, but **production would need a hosted database** (for example Supabase/Postgres, Turso or Neon).

On Vercel, the only writable location is `/tmp`, so the app stores the database at `/tmp/todo.db`. That file:

- is **wiped** whenever the serverless function cold-starts or is redeployed, and
- is **not shared** between function instances, so under load one user's request can reach an instance that has no record of their account.

For a hosted database, swap out `src/db.js` and the prepared statements in `src/app.js`. The routes and the front end can stay the same.
