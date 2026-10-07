import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

// Each test gets a fresh in-memory database, so tests never touch the real .db file.
export function freshApp() {
  const db = openDb(':memory:');
  return { app: createApp({ db }), db };
}

// supertest agent keeps cookies between requests, like a browser.
export async function registeredAgent(app, username, password = 'correct-horse') {
  const agent = request.agent(app);
  await agent.post('/api/register').send({ username, password }).expect(201);
  return agent;
}
