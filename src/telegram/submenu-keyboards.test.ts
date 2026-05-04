import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubmenuReplyKeyboard } from './submenu-keyboards.js';

test('buildSubmenuReplyKeyboard appends localized start and help navigation', () => {
  assert.deepEqual(buildSubmenuReplyKeyboard({ language: 'es', rows: [['Ver actividades']] }), {
    replyKeyboard: [['Ver actividades'], ['Inicio', 'Ayuda']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
});
