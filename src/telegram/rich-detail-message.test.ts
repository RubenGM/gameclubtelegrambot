import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTelegramRichDetailMessage } from './rich-detail-message.js';

test('multiline formatted descriptions stay balanced inside a rich table cell', () => {
  const rich = buildTelegramRichDetailMessage('Catan', '<b>Catan</b>\n<b>Descripción:</b> <i>Primera\nSegunda</i>\n<b>Jugadores:</b> 3-4');
  assert.equal(rich.html, '<h2>Catan</h2><table><tr><th>Descripción:</th><td><i>Primera\nSegunda</i></td></tr><tr><th>Jugadores:</th><td>3-4</td></tr></table>');
});

test('nested inline formatting across newline stays within one paragraph', () => {
  const rich = buildTelegramRichDetailMessage('Agenda', '<b>Agenda</b>\n<i>Primera <b>línea\nSegunda</b></i>\n<a href="https://example.test/">Enlace</a>');
  assert.equal(rich.html, '<h2>Agenda</h2><p><i>Primera <b>línea\nSegunda</b></i></p><p><a href="https://example.test/">Enlace</a></p>');
});
