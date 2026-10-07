import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshApp, registeredAgent } from './helpers.js';

describe('task list', () => {
  test('requires login', async () => {
    const { app } = freshApp();
    await request(app).get('/api/tasks').expect(401);
    await request(app).post('/api/tasks').send({ title: 'x' }).expect(401);
  });

  test('add, list, complete and delete a task', async () => {
    const { app } = freshApp();
    const alice = await registeredAgent(app, 'alice');

    const created = await alice.post('/api/tasks').send({ title: '  Buy milk  ' }).expect(201);
    assert.equal(created.body.task.title, 'Buy milk');
    assert.equal(created.body.task.completed, false);
    const id = created.body.task.id;

    let list = await alice.get('/api/tasks').expect(200);
    assert.deepEqual(list.body.tasks.map((t) => t.title), ['Buy milk']);

    const done = await alice.patch(`/api/tasks/${id}`).send({ completed: true }).expect(200);
    assert.equal(done.body.task.completed, true);

    await alice.delete(`/api/tasks/${id}`).expect(204);
    list = await alice.get('/api/tasks').expect(200);
    assert.deepEqual(list.body.tasks, []);
  });

  test('rejects empty, whitespace-only and too-long titles', async () => {
    const { app } = freshApp();
    const alice = await registeredAgent(app, 'alice');
    await alice.post('/api/tasks').send({ title: '' }).expect(400);
    await alice.post('/api/tasks').send({ title: '    ' }).expect(400);
    await alice.post('/api/tasks').send({}).expect(400);
    await alice.post('/api/tasks').send({ title: 123 }).expect(400);
    await alice.post('/api/tasks').send({ title: 'x'.repeat(201) }).expect(400);
    const list = await alice.get('/api/tasks').expect(200);
    assert.equal(list.body.tasks.length, 0);
  });

  test('rejects a non-boolean completed value and bad ids', async () => {
    const { app } = freshApp();
    const alice = await registeredAgent(app, 'alice');
    const { body } = await alice.post('/api/tasks').send({ title: 'A' }).expect(201);
    await alice.patch(`/api/tasks/${body.task.id}`).send({ completed: 'yes' }).expect(400);
    await alice.delete('/api/tasks/abc').expect(400);
    await alice.delete('/api/tasks/99999').expect(404);
  });

  test('malformed JSON returns 400, not a crash', async () => {
    const { app } = freshApp();
    const alice = await registeredAgent(app, 'alice');
    await alice.post('/api/tasks').set('Content-Type', 'application/json').send('{bad json').expect(400);
  });
});

describe('isolation between users', () => {
  async function twoUsers() {
    const { app } = freshApp();
    const alice = await registeredAgent(app, 'alice');
    const bob = await registeredAgent(app, 'bob');
    const { body } = await alice.post('/api/tasks').send({ title: "Alice's secret" }).expect(201);
    return { alice, bob, aliceTaskId: body.task.id };
  }

  test("each user sees only their own tasks", async () => {
    const { alice, bob } = await twoUsers();
    await bob.post('/api/tasks').send({ title: "Bob's task" }).expect(201);

    const a = await alice.get('/api/tasks').expect(200);
    const b = await bob.get('/api/tasks').expect(200);
    assert.deepEqual(a.body.tasks.map((t) => t.title), ["Alice's secret"]);
    assert.deepEqual(b.body.tasks.map((t) => t.title), ["Bob's task"]);
  });

  test("a user cannot delete another user's task", async () => {
    const { alice, bob, aliceTaskId } = await twoUsers();
    await bob.delete(`/api/tasks/${aliceTaskId}`).expect(404);
    const a = await alice.get('/api/tasks').expect(200);
    assert.equal(a.body.tasks.length, 1);
  });

  test("a user cannot complete another user's task", async () => {
    const { alice, bob, aliceTaskId } = await twoUsers();
    await bob.patch(`/api/tasks/${aliceTaskId}`).send({ completed: true }).expect(404);
    const a = await alice.get('/api/tasks').expect(200);
    assert.equal(a.body.tasks[0].completed, false);
  });
});
