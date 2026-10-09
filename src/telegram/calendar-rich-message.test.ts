import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalendarRichMessage } from './calendar-rich-message.js';
import type { CalendarEntry } from './calendar-summary.js';

const visibleEntry: CalendarEntry = {
  id: 42,
  kind: 'schedule',
  startsAt: '2026-10-09T23:30:00.000Z',
  endsAt: '2026-10-10T01:00:00.000Z',
  title: 'Nit <script> & roll',
  description: null,
  tableName: 'Taula & entrada',
  attendanceMode: 'open',
  isPublic: true,
  capacity: 6,
  availableSeats: 2,
  hasDetails: true,
};

function render(entries: CalendarEntry[] = [visibleEntry], timeZone?: string) {
  return buildCalendarRichMessage({
    entries,
    language: 'es',
    title: 'Calendario <club>',
    emptyText: 'Sin actividades',
    footerHtml: '<i>Admin ha creado la actividad</i>',
    actionsHtml: '<p><a href="https://t.me/example?start=schedule_create">Haz tu reserva</a></p>',
    now: new Date('2026-10-09T08:20:00.000Z'),
    startsAtTo: '2026-11-08T08:20:00.000Z',
    ...(timeZone ? { timeZone } : {}),
  }).html ?? '';
}

test('calendar rich message renders the approved two-column, two-row activity layout in the configured time zone', () => {
  const html = render();
  const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map((match) => match[1] ?? '');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => [...row.matchAll(/<td\b/g)].length === 2));
  assert.match(html, /<table compact>/);
  assert.match(html, /<td align="left" valign="top">1:30–3h<\/td>/);
  assert.match(html, /<h3>Sábado 10 octubre<\/h3>/);
  assert.match(html, /Taula &amp; entrada · 2\/6 libres · Mesa abierta/);
  assert.match(html, /schedule_details_42/);
});

test('calendar rich message escapes untrusted labels and titles while preserving supplied safe footer and action HTML', () => {
  const html = render();
  assert.match(html, /<h2>Calendario &lt;club&gt;<\/h2>/);
  assert.match(html, /Nit &lt;script&gt; &amp; roll/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<i>Admin ha creado la actividad<\/i>/);
  assert.match(html, /<a href="https:\/\/t\.me\/example\?start=schedule_create">Haz tu reserva<\/a>/);
  assert.match(html, /Próximos 30 días · 9 oct 2026 – 8 nov 2026/);
});

test('schedule summaries preserve the existing length limit and localized full-description link', () => {
  const description = 'Descripción larga con más de treinta caracteres <script>';
  const html = render([{ ...visibleEntry, description, hasDetails: false }]);
  assert.match(html, /<i>Descripción larga con más d\.\.\.<\/i>/);
  assert.match(html, /schedule_event_42[^>]*>Ver descripción<\/a>/);
  assert.doesNotMatch(html, /treinta caracteres/);
  assert.doesNotMatch(html, /schedule_details_42/);
});

test('short schedule descriptions are escaped while extra details suppress inline descriptions', () => {
  const description = '<b>Breve & clara</b>';
  const html = render([{ ...visibleEntry, description, hasDetails: false }]);
  assert.match(html, /<i>&lt;b&gt;Breve &amp; clara&lt;\/b&gt;<\/i>/);
  assert.doesNotMatch(html, /Ver descripción/);
  const withDetails = render([{ ...visibleEntry, description }]);
  assert.match(withDetails, /schedule_details_42/);
  assert.doesNotMatch(withDetails, /Breve/);
});

test('local date headings retain their weekday and month across the UTC+14 month boundary', () => {
  const html = render([{
    ...visibleEntry,
    startsAt: '2026-10-30T23:30:00.000Z',
    endsAt: '2026-10-31T01:00:00.000Z',
  }], 'Pacific/Kiritimati');
  assert.match(html, /<h3>Sábado 31 octubre<\/h3>/);
  assert.match(html, /13:30–15h/);
  assert.doesNotMatch(html, /Domingo 31 noviembre/);
});

test('empty calendars render the caller-provided empty message and retain footer links', () => {
  const html = render([]);
  assert.match(html, /<p>Sin actividades<\/p>/);
  assert.match(html, /schedule_create/);
  assert.doesNotMatch(html, /<table compact>/);
});

test('venue activities keep a plain title and use the all-day label', () => {
  const venue: CalendarEntry = {
    kind: 'venue',
    startsAt: '2026-10-10T22:00:00.000Z',
    endsAt: '2026-10-11T22:00:00.000Z',
    title: 'Trobada & vermut',
    description: 'Trae <material> & bebida\nEntrada libre',
    allDay: true,
  };
  const html = render([venue]);
  assert.match(html, /<b>Trobada &amp; vermut<\/b>/);
  assert.doesNotMatch(html, /schedule_event_/);
  assert.match(html, /Local/);
  assert.match(html, /<i>Trae &lt;material&gt; &amp; bebida\nEntrada libre<\/i>/);
  assert.match(html, /<td align="left" valign="top">Todo el día<\/td>/);
});
