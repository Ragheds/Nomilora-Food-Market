import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WriteQueue } from '../src/lib/write-queue.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('rapid edits save in order and a failed write pauses later edits until explicit retry', async () => {
  const writes: number[] = [];
  let offline = true;
  let pending = 0; let message = '';
  const queue = new WriteQueue((count, error) => { pending = count; message = error; });
  queue.enqueue(async () => { if (offline) throw new Error('offline'); writes.push(1); });
  queue.enqueue(async () => { writes.push(2); });
  await tick();
  assert.equal(pending, 2); assert.equal(message, 'offline'); assert.deepEqual(writes, []);
  offline = false; queue.retry(); await tick();
  assert.deepEqual(writes, [1, 2]); assert.equal(pending, 0); assert.equal(message, '');
});
test('sign-out disposal prevents queued writes from being sent under a new session', async () => {
  let finish!: () => void;
  const calls: number[] = [];
  const queue = new WriteQueue(() => {});
  queue.enqueue(async () => { calls.push(1); await new Promise<void>(resolve => { finish = resolve; }); });
  queue.enqueue(async () => { calls.push(2); });
  queue.dispose(); finish(); await tick();
  assert.deepEqual(calls, [1]);
});
