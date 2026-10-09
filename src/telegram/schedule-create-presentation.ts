import type { TelegramRichMessage } from './rich-message-transport.js';
import { escapeHtml } from './schedule-presentation.js';
import type { ScheduleResourceAvailability } from './schedule-resource-availability.js';

export const scheduleCreateLabels = {
  ca: { availability: 'Disponibilitat de recursos', free: 'Lliure', busy: 'Ocupat', table: 'Taules', equipment: 'Equipament', note: 'La disponibilitat és orientativa. Els solapaments habituals no bloquegen la creació; les reserves prioritàries sí.', calendar: 'Sincronitzant Google Calendar…', conflicts: 'Avisant de solapaments…', news: 'Actualitzant els calendaris dels grups i canals…', partial: 'L’activitat està guardada. Algunes sincronitzacions o avisos no s’han pogut completar.' },
  es: { availability: 'Disponibilidad de recursos', free: 'Libre', busy: 'Ocupado', table: 'Mesas', equipment: 'Equipamiento', note: 'La disponibilidad es orientativa. Los solapamientos habituales no bloquean la creación; las reservas prioritarias sí.', calendar: 'Sincronizando Google Calendar…', conflicts: 'Avisando de solapamientos…', news: 'Actualizando los calendarios de grupos y canales…', partial: 'La actividad está guardada. Algunas sincronizaciones o avisos no se han podido completar.' },
  en: { availability: 'Resource availability', free: 'Free', busy: 'Busy', table: 'Tables', equipment: 'Equipment', note: 'Availability is advisory. Ordinary overlaps do not block creation; priority reservations do.', calendar: 'Synchronizing Google Calendar…', conflicts: 'Notifying overlapping activities…', news: 'Updating group and channel calendars…', partial: 'The activity is saved. Some synchronizations or notifications could not be completed.' },
} as const;

/** Every resource remains selectable; this view is a snapshot, not a reservation. */
export function buildScheduleResourceAvailabilityMessage(input: {
  availability: ScheduleResourceAvailability;
  kind: 'tables' | 'equipment';
  language: 'ca' | 'es' | 'en';
  prompt: string;
  intervalLabel: string;
}): { text: string; richMessage: TelegramRichMessage } {
  const labels = scheduleCreateLabels[input.language];
  const resources = input.availability[input.kind];
  const rows = resources.map((resource) => ({
    name: escapeHtml(resource.displayName),
    status: escapeHtml(resource.busy ? labels.busy : labels.free),
    marker: resource.busy ? '🟠' : '🟢',
  }));
  const heading = `${labels.availability} · ${input.kind === 'tables' ? labels.table : labels.equipment}`;
  return {
    text: [escapeHtml(input.prompt), `<b>${escapeHtml(heading)}</b>`, escapeHtml(input.intervalLabel), ...rows.map((row) => `${row.marker} ${row.name}: ${row.status}`), escapeHtml(labels.note)].join('\n\n'),
    richMessage: { html: `<h2>${escapeHtml(heading)}</h2><p>${escapeHtml(input.intervalLabel)}</p><table compact>${rows.map((row) => `<tr><td>${row.name}</td><td>${row.marker} ${row.status}</td></tr>`).join('')}</table><p>${escapeHtml(labels.note)}</p><p>${escapeHtml(input.prompt)}</p>` },
  };
}
