export type VenueEventOccupancyScope = 'partial' | 'full';
export type VenueEventImpactLevel = 'low' | 'medium' | 'high';
export type VenueEventLifecycleStatus = 'scheduled' | 'cancelled';

export interface VenueEventRecord {
  id: number;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  occupancyScope: VenueEventOccupancyScope;
  impactLevel: VenueEventImpactLevel;
  lifecycleStatus: VenueEventLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface VenueEventRepository {
  createVenueEvent(input: {
    name: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    occupancyScope: VenueEventOccupancyScope;
    impactLevel: VenueEventImpactLevel;
  }): Promise<VenueEventRecord>;
  findVenueEventById(eventId: number): Promise<VenueEventRecord | null>;
  listVenueEvents(input: {
    includeCancelled: boolean;
    startsAtFrom?: string;
    endsAtTo?: string;
  }): Promise<VenueEventRecord[]>;
  updateVenueEvent(input: {
    eventId: number;
    name: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    occupancyScope: VenueEventOccupancyScope;
    impactLevel: VenueEventImpactLevel;
  }): Promise<VenueEventRecord>;
  cancelVenueEvent(input: {
    eventId: number;
    reason?: string | null;
  }): Promise<VenueEventRecord>;
}

export async function createVenueEvent({
  repository,
  name,
  description,
  startsAt,
  endsAt,
  occupancyScope,
  impactLevel,
}: {
  repository: VenueEventRepository;
  name: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  occupancyScope: VenueEventOccupancyScope;
  impactLevel: VenueEventImpactLevel;
}): Promise<VenueEventRecord> {
  const normalizedStartsAt = normalizeTimestamp(startsAt, 'inici');
  const normalizedEndsAt = normalizeTimestamp(endsAt, 'final');
  ensureTimeRange(normalizedStartsAt, normalizedEndsAt);

  return repository.createVenueEvent({
    name: normalizeName(name),
    description: normalizeDescription(description),
    startsAt: normalizedStartsAt,
    endsAt: normalizedEndsAt,
    occupancyScope: normalizeOccupancyScope(occupancyScope),
    impactLevel: normalizeImpactLevel(impactLevel),
  });
}

export async function listVenueEvents({
  repository,
  includeCancelled = false,
  startsAtFrom,
  endsAtTo,
}: {
  repository: VenueEventRepository;
  includeCancelled?: boolean;
  startsAtFrom?: string;
  endsAtTo?: string;
}): Promise<VenueEventRecord[]> {
  return repository.listVenueEvents({
    includeCancelled,
    ...(startsAtFrom ? { startsAtFrom: normalizeTimestamp(startsAtFrom, 'inici') } : {}),
    ...(endsAtTo ? { endsAtTo: normalizeTimestamp(endsAtTo, 'final') } : {}),
  });
}

export async function updateVenueEvent({
  repository,
  eventId,
  name,
  description,
  startsAt,
  endsAt,
  occupancyScope,
  impactLevel,
}: {
  repository: VenueEventRepository;
  eventId: number;
  name: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  occupancyScope: VenueEventOccupancyScope;
  impactLevel: VenueEventImpactLevel;
}): Promise<VenueEventRecord> {
  const existing = await repository.findVenueEventById(eventId);
  if (!existing) {
    throw new Error(`Venue event ${eventId} not found`);
  }
  if (existing.lifecycleStatus === 'cancelled') {
    throw new Error('No es pot editar un esdeveniment cancel.lat');
  }

  const normalizedStartsAt = normalizeTimestamp(startsAt, 'inici');
  const normalizedEndsAt = normalizeTimestamp(endsAt, 'final');
  ensureTimeRange(normalizedStartsAt, normalizedEndsAt);

  return repository.updateVenueEvent({
    eventId,
    name: normalizeName(name),
    description: normalizeDescription(description),
    startsAt: normalizedStartsAt,
    endsAt: normalizedEndsAt,
    occupancyScope: normalizeOccupancyScope(occupancyScope),
    impactLevel: normalizeImpactLevel(impactLevel),
  });
}

export async function cancelVenueEvent({
  repository,
  eventId,
  reason,
}: {
  repository: VenueEventRepository;
  eventId: number;
  reason?: string | null;
}): Promise<VenueEventRecord> {
  const existing = await repository.findVenueEventById(eventId);
  if (!existing) {
    throw new Error(`Venue event ${eventId} not found`);
  }
  if (existing.lifecycleStatus === 'cancelled') {
    return existing;
  }

  return repository.cancelVenueEvent({
    eventId,
    ...(reason !== undefined ? { reason: normalizeDescription(reason) } : {}),
  });
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error('El nom de l esdeveniment es obligatori');
  }
  return normalized;
}

function normalizeDescription(description: string | null | undefined): string | null {
  const normalized = description?.trim();
  return normalized ? normalized : null;
}

function normalizeTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`La data de ${label} ha de ser valida`);
  }
  return parsed.toISOString();
}

function ensureTimeRange(startsAt: string, endsAt: string): void {
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error('El final ha de ser posterior a l inici');
  }
}

function normalizeOccupancyScope(scope: VenueEventOccupancyScope): VenueEventOccupancyScope {
  if (scope !== 'partial' && scope !== 'full') {
    throw new Error('L ocupacio del local no es valida');
  }
  return scope;
}

function normalizeImpactLevel(level: VenueEventImpactLevel): VenueEventImpactLevel {
  if (level !== 'low' && level !== 'medium' && level !== 'high') {
    throw new Error('El nivell d impacte no es valid');
  }
  return level;
}
