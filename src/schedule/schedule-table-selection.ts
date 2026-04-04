import { listClubTables, type ClubTableRecord, type ClubTableRepository } from '../tables/table-catalog.js';

export async function listSchedulableTables({ repository }: { repository: ClubTableRepository }): Promise<ClubTableRecord[]> {
  return listClubTables({ repository });
}

export async function requireSchedulableTableSelection({
  repository,
  tableId,
}: {
  repository: ClubTableRepository;
  tableId: number | null;
}): Promise<ClubTableRecord | null> {
  if (tableId === null) {
    return null;
  }

  const table = await repository.findTableById(tableId);
  if (!table) {
    throw new Error('La taula seleccionada no existeix');
  }
  if (table.lifecycleStatus !== 'active') {
    throw new Error('La taula seleccionada ja no esta activa');
  }

  return table;
}

export async function resolveScheduleTableReference({
  repository,
  tableId,
}: {
  repository: ClubTableRepository;
  tableId: number | null;
}): Promise<ClubTableRecord | null> {
  if (tableId === null) {
    return null;
  }

  return repository.findTableById(tableId);
}

export function getScheduleTableCapacityAdvisories({
  table,
  requestedCapacity,
}: {
  table: ClubTableRecord | null;
  requestedCapacity: number;
}): string[] {
  if (!table || table.recommendedCapacity === null || requestedCapacity <= table.recommendedCapacity) {
    return [];
  }

  return [
    `La capacitat indicada supera la capacitat recomanada de la taula (${table.recommendedCapacity}). Aixo es mostra com a avis, no bloqueja la reserva.`,
  ];
}
