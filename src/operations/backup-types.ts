import type { ServiceLifecycleState } from './service-control.js';

export interface BackupManifestInfo {
  formatVersion: string | null;
  createdAt: string | null;
  serviceName: string | null;
}

export interface BackupArchiveInfo {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: string;
  manifest: BackupManifestInfo | null;
}

export interface BackupConfigFileStatus {
  label: string;
  path: string;
  state: 'present' | 'missing' | 'unreadable';
}

export interface BackupDependencyStatus {
  command: string;
  state: 'installed' | 'installing' | 'missing' | 'error';
  packageName: string;
  autoInstallSupported: boolean;
  message?: string;
}

export interface ConnectedDatabaseSummary {
  state: 'connected';
  host: string;
  port: number;
  databaseName: string;
  sizeBytes: number;
  totalTables: number;
  knownTableCounts: Array<{
    tableName: string;
    rowCount: number;
  }>;
}

export interface UnavailableDatabaseSummary {
  state: 'unavailable';
  message: string;
}

export type DatabaseSummary = ConnectedDatabaseSummary | UnavailableDatabaseSummary;

export interface BackupConsoleServiceStatus {
  serviceName: string;
  state: ServiceLifecycleState;
  rawState: string;
  message: string | null;
}

export interface BackupConsoleStatus {
  service: BackupConsoleServiceStatus;
  dependencies: BackupDependencyStatus[];
  configFiles: BackupConfigFileStatus[];
  database: DatabaseSummary;
  backups: {
    directory: string;
    totalCount: number;
    latestBackup: BackupArchiveInfo | null;
    archives: BackupArchiveInfo[];
  };
}

export interface BackupOperationResult {
  output: string;
}

export interface CreateBackupResult extends BackupOperationResult {
  archivePath: string;
}
