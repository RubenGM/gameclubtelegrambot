import type { BackupArchiveInfo, BackupConsoleStatus, DatabaseSummary } from '../operations/backup-types.js';

export function formatSystemPanel(status: Pick<BackupConsoleStatus, 'service' | 'dependencies' | 'configFiles' | 'backups'>): string {
  const installedDependencies = status.dependencies.filter((item) => item.state === 'installed').length;
  const missingDependencies = status.dependencies.filter((item) => item.state !== 'installed').length;

  return [
    `Service: ${status.service.state}`,
    status.service.message ? `Service info: ${status.service.message}` : `Service unit: ${status.service.serviceName}`,
    `Dependencies: ${installedDependencies} installed, ${missingDependencies} missing`,
    ...status.dependencies.map((item) => `- ${item.command}: ${item.state}`),
    ...status.configFiles.map((item) => `${item.label}: ${item.state}`),
    `Backups dir: ${status.backups.directory}`,
    `Backups found: ${status.backups.totalCount}`,
  ].join('\n');
}

export function formatDatabasePanel(summary: DatabaseSummary): string {
  if (summary.state === 'unavailable') {
    return `Database: unavailable\n${summary.message}`;
  }

  return [
    `Database: ${summary.databaseName}`,
    `Host: ${summary.host}:${summary.port}`,
    `Size: ${formatBytes(summary.sizeBytes)}`,
    `Tables: ${summary.totalTables}`,
    ...summary.knownTableCounts.map((item) => `${item.tableName}: ${item.rowCount}`),
  ].join('\n');
}

export function formatBackupArchiveRow(archive: BackupArchiveInfo): string {
  return `${archive.fileName} | ${formatBytes(archive.sizeBytes)} | ${formatUtcTimestamp(archive.modifiedAt)}`;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUtcTimestamp(value: string): string {
  const timestamp = new Date(value);
  const year = String(timestamp.getUTCFullYear());
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getUTCDate()).padStart(2, '0');
  const hours = String(timestamp.getUTCHours()).padStart(2, '0');
  const minutes = String(timestamp.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
