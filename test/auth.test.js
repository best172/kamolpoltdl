import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshApp, registeredAgent } from './helpers.js';
import { hashPassword, verifyPassword } from '../src/auth.js';

describe('password hashing', () => {
  test('hash is not the plain password and verifies correctly', async () => {
    const hash = await hashPassword('s3cret-pass');
    assert.notEqual(hash, 's3cret-pass');
    assert.ok(!hash.includes('s3cret-pass'));
    assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.equal(await verifyPassword('s3cret-pass', hash), true);
    assert.equal(await verifyPassword('wrong-pass', hash), false);
  });

  test('same password hashes differently each time (salted)', async () => {
    assert.notEqual(await hashPassword('same-password'), await hashPassword('same-password'));
  });

  test('database stores only the hash', async () => {
    const { app, db } = freshApp();
    await registeredAgent(app, 'alice', 'plaintext-check');
    const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('alice');
    assert.ok(!row.password_hash.includes('plaintext-check'));
  });
});

describe('register', () => {
  test('creates a user and logs them in', async () => {
    const { app } = freshApp();
    const agent = await registeredAgent(app, 'alice');
    const res = await agent.get('/api/me').expect(200);
    assert.equal(res.body.user.username, 'alice');
  });

  test('rejects a duplicate username (case-insensitive)', async () => {
    const { app } = freshApp();
    await registeredAgent(app, 'alice');
    await request(app).post('/api/register').send({ username: 'ALICE', password: 'another-pass' }).expect(409);
  });

  test('rejects invalid usernames and short passwords', async () => {
    const { app } = freshApp();
    await request(app).post('/api/register').send({ username: 'ab', password: 'long-enough' }).expect(400);
    await request(app).post('/api/register').send({ username: 'bad name!', password: 'long-enough' }).expect(400);
    await request(app).post('/api/register').send({ username: 'alice', password: 'short' }).expect(400);
    await request(app).post('/api/register').send({}).expect(400);
  });
});

describe('login', () => {
  test('succeeds with the right password and sets an httpOnly cookie', async () => {
    const { app } = freshApp();
    await registeredAgent(app, 'alice', 'correct-horse');
    const res = await request(app).post('/api/login').send({ username: 'alice', password: 'correct-horse' }).expect(200);
    const cookie = res.headers['set-cookie'].join(';');
    assert.match(cookie, /session=/);
    assert.match(cookie, /HttpOnly/i);
  });

  test('fails with the wrong password', async () => {
    const { app } = freshApp();
    await registeredAgent(app, 'alice', 'correct-horse');
    const res = await request(app).post('/api/login').send({ username: 'alice', password: 'wrong-horse' }).expect(401);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  test('fails for an unknown user with the same message', async () => {
    const { app } = freshApp();
    const res = await request(app).post('/api/login').send({ username: 'nobody', password: 'whatever1' }).expect(401);
    assert.equal(res.body.error, 'Invalid username or password');
  });

  test('logout ends the session', async () => {
    const { app } = freshApp();
    const agent = await registeredAgent(app, 'alice');
    await agent.post('/api/logout').expect(204);
    await agent.get('/api/me').expect(401);
  });

  test('a forged session cookie is rejected', async () => {
    const { app } = freshApp();
    await request(app).get('/api/tasks').set('Cookie', 'session=not-a-real-token').expect(401);
  });
});
