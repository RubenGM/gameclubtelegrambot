import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldDetachDebianTrayProcess } from './debian-tray-launch.js';

test('shouldDetachDebianTrayProcess detaches by default', () => {
  assert.equal(shouldDetachDebianTrayProcess({}), true);
});

test('shouldDetachDebianTrayProcess stays in foreground when explicitly requested', () => {
  assert.equal(shouldDetachDebianTrayProcess({ GAMECLUB_TRAY_FOREGROUND: '1' }), false);
});

test('shouldDetachDebianTrayProcess avoids recursive relaunch in detached child', () => {
  assert.equal(shouldDetachDebianTrayProcess({ GAMECLUB_TRAY_CHILD: '1' }), false);
});
