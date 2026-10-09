import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalendarRichMessage } from './calendar-rich-message.js';
import type { CalendarEntry } from './calendar-summary.js';
import type { CalendarRichEntry } from './calendar-rich-message.js';

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

function render(entries: CalendarRichEntry[] = [visibleEntry], timeZone?: string, language = 'es') {
  return buildCalendarRichMessage({
    entries,
    language,
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
  assert.match(html, /<td align="left" valign="top"><b>1:30–3h<\/b><\/td>/);
  assert.match(html, /<h3>Sábado 10 octubre<\/h3>/);
  assert.ok((rows[1] ?? '').includes('<td align="right">6 plazas</td><td>Taula &amp; entrada'));
  assert.doesNotMatch(html, /2\/6 libres|Mesa abierta|6p/);
  assert.match(html, /<a href="[^"]*schedule_event_42"><b>Nit &lt;script&gt; &amp; roll<\/b> ℹ️<\/a>/);
  assert.doesNotMatch(html, /schedule_details_42|Ver detalles|Ver descripción/);
});

test('calendar seat count and closed state occupy the second-row left cell in Catalan, Spanish and English', () => {
  const cases = [
    { language: 'ca', expected: '6 places', closed: '6 places 🔒' },
    { language: 'es', expected: '6 plazas', closed: '6 plazas 🔒' },
    { language: 'en', expected: '6 seats', closed: '6 seats 🔒' },
  ];
  for (const { language, expected, closed } of cases) {
    const openHtml = render([visibleEntry], undefined, language);
    const openRows = [...openHtml.matchAll(/<tr>(.*?)<\/tr>/g)].map((match) => match[1] ?? '');
    assert.ok((openRows[1] ?? '').includes(`<td align="right">${expected}</td><td>`));
    assert.doesNotMatch(openRows[1] ?? '', /Mesa abierta|Mesa cerrada|2\/6 libres/);

    const closedHtml = render([{ ...visibleEntry, attendanceMode: 'closed' }], undefined, language);
    const closedRows = [...closedHtml.matchAll(/<tr>(.*?)<\/tr>/g)].map((match) => match[1] ?? '');
    assert.ok((closedRows[1] ?? '').includes(`<td align="right">${closed}</td><td>`));
    assert.doesNotMatch(closedRows[1] ?? '', /Mesa cerrada|Mesa abierta|2\/6 libres/);
  }
});

test('calendar second-row right cell retains table, equipment and venue impact while scheduled descriptions stay out of line', () => {
  const html = render([{
    ...visibleEntry,
    description: 'Descripción breve <script>',
    hasDetails: false,
    equipmentNames: ['Proyector'],
    venueImpactText: 'Aforo parcial',
  }]);
  const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map((match) => match[1] ?? '');
  assert.match(rows[0] ?? '', /schedule_event_42/);
  assert.match(rows[1] ?? '', /<td align="right">6 plazas<\/td><td>Taula &amp; entrada · Equipamiento: Proyector.*Aforo parcial<\/td>/);
  assert.match(rows[0] ?? '', /<b>Nit &lt;script&gt; &amp; roll<\/b> ℹ️<\/a>/);
  assert.doesNotMatch(html, /Descripción breve|<script>|Ver detalles|Ver descripción|schedule_details_42/);
  assert.doesNotMatch(rows[1] ?? '', /Mesa abierta|Mesa cerrada|2\/6 libres/);
});

test('single-seat activities use the localized singular noun and preserve the closed marker', () => {
  for (const [language, noun] of [['ca', 'plaça'], ['es', 'plaza'], ['en', 'seat']]) {
    assert.match(render([{ ...visibleEntry, capacity: 1 }], undefined, language), new RegExp(`<td align="right">1 ${noun}</td>`));
    assert.match(render([{ ...visibleEntry, capacity: 1, attendanceMode: 'closed' }], undefined, language), new RegExp(`<td align="right">1 ${noun} 🔒</td>`));
  }
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

test('schedule title shows the info icon for details or a description in Catalan, Spanish and English', () => {
  for (const language of ['ca', 'es', 'en']) {
    const detailsOnly = render([{ ...visibleEntry, description: null, hasDetails: true }], undefined, language);
    assert.match(detailsOnly, /<a href="[^"]*schedule_event_42"><b>Nit &lt;script&gt; &amp; roll<\/b> ℹ️<\/a>/);
    assert.doesNotMatch(detailsOnly, /schedule_details_42|Ver detalles|Ver descripción/);

    const descriptionOnly = render([{ ...visibleEntry, hasDetails: false, description: 'Tiene descripción' }], undefined, language);
    assert.match(descriptionOnly, /<a href="[^"]*schedule_event_42"><b>Nit &lt;script&gt; &amp; roll<\/b> ℹ️<\/a>/);
    assert.doesNotMatch(descriptionOnly, /Tiene descripción|schedule_details_42|Ver detalles|Ver descripción/);
  }
});

test('schedule title omits the info icon when details are absent and description is empty or whitespace', () => {
  for (const description of [null, '', '   \n  ']) {
    const html = render([{ ...visibleEntry, hasDetails: false, description }]);
    assert.match(html, /<a href="[^"]*schedule_event_42"><b>Nit &lt;script&gt; &amp; roll<\/b><\/a>/);
    assert.doesNotMatch(html, /ℹ️|schedule_details_42|Ver detalles|Ver descripción/);
  }
});

test('local date headings retain their weekday and month across the UTC+14 month boundary', () => {
  const html = render([{
    ...visibleEntry,
    startsAt: '2026-10-30T23:30:00.000Z',
    endsAt: '2026-10-31T01:00:00.000Z',
  }], 'Pacific/Kiritimati');
  assert.match(html, /<h3>Sábado 31 octubre<\/h3>/);
  assert.match(html, /<b>13:30–15h<\/b>/);
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
  assert.match(html, /<td align="left" valign="top"><b>Todo el día<\/b><\/td>/);
  assert.match(html, /<tr><td><\/td><td>Local[\s\S]*<\/td><\/tr>/);
});
