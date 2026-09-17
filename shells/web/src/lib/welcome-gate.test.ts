// SPDX-License-Identifier: MPL-2.0
/**
 * lib/welcome-gate.ts: when background maintenance may start on a visit that can
 * show the first-run welcome.
 *
 *   node --test shells/web/src/lib/welcome-gate.test.ts
 *
 * Every test leaves the gate open again, so each one starts from "nothing holds it".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const gate = await import('./welcome-gate.ts');

/** Whether a welcomeSettled() call made now resolves within a few turns. */
async function opensSoon(): Promise<boolean> {
  let open = false;
  void gate.welcomeSettled().then(() => { open = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  return open;
}

test('with no welcome held, maintenance may start at once', async () => {
  assert.equal(await opensSoon(), true);
});

test('an open welcome holds the gate until it is released, and a second release changes nothing', async () => {
  const release = gate.holdWelcomeGate();
  const order: string[] = [];
  const waiting = gate.welcomeSettled().then(() => order.push('maintenance'));
  assert.equal(await opensSoon(), false);
  order.push('closed');
  release();
  await waiting;
  assert.deepEqual(order, ['closed', 'maintenance']);
  release();
  assert.equal(await opensSoon(), true, 'a repeated release must not unbalance the count');
});

test('two holds: the gate opens only when the last one is released', async () => {
  const decision = gate.holdWelcomeGate();
  const dialog = gate.holdWelcomeGate();
  decision();
  assert.equal(await opensSoon(), false, 'the dialog still holds it');
  dialog();
  assert.equal(await opensSoon(), true);
});

test('the boot hold waits for the first decision, and settling twice is harmless', async () => {
  store.clear();
  gate.expectWelcomeDecision();
  gate.expectWelcomeDecision();
  assert.equal(await opensSoon(), false);
  let answer!: (shown: boolean) => void;
  const decided = gate.decideWelcome(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  assert.equal(await opensSoon(), false, 'still deciding');
  answer(false);
  assert.equal(await decided, false);
  assert.equal(await opensSoon(), true, 'a welcome that will not show releases the decision and the boot hold');
  gate.settleWelcomeDecision();
  assert.equal(await opensSoon(), true);
});

test('a decision that opens the dialog hands over to the dialog hold', async () => {
  store.clear();
  let closeDialog!: () => void;
  await gate.decideWelcome(async () => { closeDialog = gate.holdWelcomeGate(); });
  assert.equal(await opensSoon(), false, 'the dialog is open');
  closeDialog();
  assert.equal(await opensSoon(), true, 'closing it, even by a navigation teardown, opens the gate');
});

test('an error while deciding releases the gate and the boot hold', async () => {
  store.clear();
  gate.expectWelcomeDecision();
  await assert.rejects(gate.decideWelcome(async () => { throw new Error('token lookup failed'); }), /token lookup failed/);
  assert.equal(await opensSoon(), true);
});

test('a settled welcome takes no decision hold unless a deep link forces it', async () => {
  gate.markWelcomeDismissed();
  assert.equal(gate.isWelcomeDismissed(), true);
  let finish!: () => void;
  const unforced = gate.decideWelcome(() => new Promise<void>((resolve) => { finish = resolve; }));
  assert.equal(await opensSoon(), true, 'nothing can open, so nothing waits');
  finish();
  await unforced;
  const forced = gate.decideWelcome(() => new Promise<void>((resolve) => { finish = resolve; }), true);
  assert.equal(await opensSoon(), false, '#/?welcome reopens it, so maintenance waits for that answer');
  finish();
  await forced;
  assert.equal(await opensSoon(), true);
  store.clear();
});

test('unreadable storage counts as dismissed, so a broken profile is never held', async () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => { throw new Error('denied'); } } as unknown as Storage;
  try {
    assert.equal(gate.isWelcomeDismissed(), true);
    assert.doesNotThrow(() => gate.markWelcomeDismissed());
  } finally {
    globalThis.localStorage = saved;
  }
});
