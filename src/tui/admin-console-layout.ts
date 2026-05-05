import type {
  AdminConsoleContentSummary,
  AdminConsoleMessageRecord,
  AdminConsoleRuntimeSnapshot,
  AdminConsoleUserRecord,
} from '../operations/admin-console.js';

export function formatDashboardPanel(snapshot: AdminConsoleRuntimeSnapshot): string {
  const lines: string[] = [
    `Generat: ${formatTimestamp(snapshot.generatedAt)}`,
    `Config: ${snapshot.config.state} | Service: ${snapshot.service.state} | DB: ${snapshot.database.state}`,
    '',
    `Users: total ${snapshot.users.total} | pending ${snapshot.users.pending} | approved ${snapshot.users.approved} | blocked ${snapshot.users.blocked} | revoked ${snapshot.users.revoked}`,
    `Admins: ${snapshot.admins.total} (${snapshot.users.admins} actius)`,
    `Contingut: ${formatContentTotals(snapshot.content)}`,
    '',
    `Config files`,
    `  runtime: ${snapshot.config.resolvedConfigPath}`,
    `  env: ${snapshot.config.resolvedEnvPath}`,
    `  bot: ${snapshot.config.botPublicName ?? 's/r'} (${snapshot.config.botClubName ?? 's/r'})`,
    `  language: ${snapshot.config.botLanguage ?? 's/r'}`,
    '',
    `DB: ${snapshot.database.summary}`,
  ];

  return lines.join('\n');
}

export function formatConfigPanel(snapshot: AdminConsoleRuntimeSnapshot): string {
  const status = snapshot.config.state === 'loaded' ? 'OK' : 'MISSATGE';
  const configLines = snapshot.config.rawConfigText.split('\n').slice(0, 220);
  const envLines = snapshot.config.rawEnvText.split('\n').slice(0, 120);

  return [
    `CONFIGURACIO (${status})`,
    `Nom bot: ${snapshot.config.botPublicName ?? 's/r'}`,
    `Club: ${snapshot.config.botClubName ?? 's/r'}`,
    `Idioma: ${snapshot.config.botLanguage ?? 's/r'}`,
    `DB: ${snapshot.config.databaseUser ?? 's/r'}@${snapshot.config.databaseHost ?? 's/r'}:${snapshot.config.databasePort ?? '-'} / ${snapshot.config.databaseName ?? 's/r'}`,
    '',
    'runtime.json',
    ...configLines.map((line) => `  ${line}`),
    '',
    '.env',
    ...envLines.map((line) => `  ${line}`),
    '',
    snapshot.config.validationError ? `ERROR: ${snapshot.config.validationError}` : 'Validació: correcta',
  ].join('\n');
}

export function formatDatabasePanel(snapshot: AdminConsoleRuntimeSnapshot): string {
  return [`BASE DE DADES`, `Disponibilitat: ${snapshot.database.available ? 'activa' : 'inactiva'}`, '', snapshot.database.summary].join(
    '\n',
  );
}

export function formatContentPanel(content: AdminConsoleContentSummary): string {
  return [
    'CONTINGUT DEL BOT',
    `Cataleg -> itemes: ${content.catalogItems} | grups: ${content.catalogGroups} | famílies: ${content.catalogFamilies}`,
    `Préstecs -> catalog_loans: ${content.catalogLoans}`,
    `Magatzem -> categories: ${content.storageCategories} | entrades: ${content.storageEntries} | missatges: ${content.storageMessages}`,
    `Agenda: events: ${content.scheduleEvents} | sala: ${content.venueEvents}`,
    `Compres de grup: ${content.groupPurchases}`,
  ].join('\n');
}

export function formatUsersPanel(users: AdminConsoleUserRecord[], selectedIndex: number): string {
  if (users.length === 0) {
    return 'No hi ha usuaris en aquest filtre.';
  }

  const max = Math.min(users.length, 30);
  const lines: string[] = [];
  for (let index = 0; index < max; index += 1) {
    const user = users[index];
    if (!user) {
      continue;
    }

    const marker = index === selectedIndex ? '>' : ' ';
    const adminBadge = user.isAdmin ? '[A]' : '[ ]';
    const status = user.status.padEnd(8);
    const name = truncate(`${user.displayName} (${user.username ?? 'sense user'})`, 28);
    lines.push(`${marker} ${String(user.telegramUserId).padStart(10)} ${adminBadge} ${status} ${name}`);
  }

  return ['USUARIS', 'ID         ADM ESTAT   NOM/USUARI', ...lines, '', `Total visibles: ${users.length}`].join('\n');
}

export function formatAdminsPanel(admins: AdminConsoleUserRecord[], selectedIndex: number): string {
  if (admins.length === 0) {
    return 'No hi ha administradors actius.';
  }

  const lines = admins
    .slice(0, 40)
    .map((admin, index) => {
      const marker = index === selectedIndex ? '>' : ' ';
      return `${marker} ${String(admin.telegramUserId).padStart(10)} ${admin.status.padEnd(8)} ${truncate(admin.displayName, 24)}`;
    });

  return ['ADMINISTRADORS', 'ID         ESTAT    NOM', ...lines, '', `Total administradors: ${admins.length}`].join('\n');
}

export function formatMessagesPanel(messages: AdminConsoleMessageRecord[]): string {
  if (messages.length === 0) {
    return 'Encara no hi ha missatges de registre.';
  }

  return ['ACTIVITAT RECIENT', ...messages.slice(0, 25).map(formatMessageRow)].join('\n');
}

export function formatLogsHint(): string {
  return [
    'Registre del servei',
    'Per pantalla de servei, manteniu la vista de Logs i feu servir r per recarregar.',
    'Les accions més habituals estan sempre en el footer.',
  ].join('\n');
}

function formatMessageRow(message: AdminConsoleMessageRecord): string {
  return `${formatTimestamp(message.createdAt)} | ${message.source.padEnd(13)} | ${truncate(message.summary, 82)}`;
}

function formatContentTotals(content: AdminConsoleContentSummary): string {
  return `${content.catalogItems + content.scheduleEvents + content.venueEvents} items`;
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength - 1)}…`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${min} UTC`;
}
