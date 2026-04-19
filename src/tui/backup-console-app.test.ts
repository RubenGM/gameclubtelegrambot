import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindBackupConsoleButtonAction,
  resolveNextBackupConsoleFocusIndex,
} from './backup-console-app.js';

test('bindBackupConsoleButtonAction wires both press and click to the same handler', async () => {
  const events: string[] = [];
  const calls: string[] = [];
  const fakeButton = {
    on(eventName: string, handler: () => void) {
      events.push(eventName);
      if (eventName === 'click') {
        handler();
      }
      if (eventName === 'press') {
        handler();
      }
    },
  };

  bindBackupConsoleButtonAction(
    fakeButton as { on(eventName: 'press' | 'click', handler: () => void): void },
    () => {
      calls.push('called');
    },
  );

  assert.deepEqual(events, ['press', 'click']);
  assert.deepEqual(calls, ['called', 'called']);
});

test('resolveNextBackupConsoleFocusIndex wraps focus forward and backward', async () => {
  assert.equal(resolveNextBackupConsoleFocusIndex(0, 6, 1), 1);
  assert.equal(resolveNextBackupConsoleFocusIndex(5, 6, 1), 0);
  assert.equal(resolveNextBackupConsoleFocusIndex(0, 6, -1), 5);
  assert.equal(resolveNextBackupConsoleFocusIndex(3, 6, -1), 2);
});
