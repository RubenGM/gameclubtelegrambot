export type ScheduleEventLifecycleStatus = 'scheduled' | 'cancelled';
export type ScheduleParticipantStatus = 'active' | 'removed';

export interface ScheduleEventRecord {
  id: number;
  title: string;
  description: string | null;
  startsAt: string;
  organizerTelegramUserId: number;
  createdByTelegramUserId: number;
  tableId: number | null;
  capacity: number;
  lifecycleStatus: ScheduleEventLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledByTelegramUserId: number | null;
  cancellationReason: string | null;
}

export interface ScheduleParticipantRecord {
  scheduleEventId: number;
  participantTelegramUserId: number;
  status: ScheduleParticipantStatus;
  addedByTelegramUserId: number;
  removedByTelegramUserId: number | null;
  joinedAt: string;
  updatedAt: string;
  leftAt: string | null;
}

export interface ScheduleRepository {
  createEvent(input: {
    title: string;
    description: string | null;
    startsAt: string;
    organizerTelegramUserId: number;
    createdByTelegramUserId: number;
    tableId: number | null;
    capacity: number;
  }): Promise<ScheduleEventRecord>;
  findEventById(eventId: number): Promise<ScheduleEventRecord | null>;
  listEvents(input: {
    includeCancelled: boolean;
    startsAtFrom?: string;
    startsAtTo?: string;
  }): Promise<ScheduleEventRecord[]>;
  updateEvent(input: {
    eventId: number;
    title: string;
    description: string | null;
    startsAt: string;
    organizerTelegramUserId: number;
    tableId: number | null;
    capacity: number;
  }): Promise<ScheduleEventRecord>;
  cancelEvent(input: {
    eventId: number;
    actorTelegramUserId: number;
    reason?: string | null;
  }): Promise<ScheduleEventRecord>;
  findParticipant(eventId: number, participantTelegramUserId: number): Promise<ScheduleParticipantRecord | null>;
  listParticipants(eventId: number): Promise<ScheduleParticipantRecord[]>;
  upsertParticipant(input: {
    eventId: number;
    participantTelegramUserId: number;
    actorTelegramUserId: number;
    status: ScheduleParticipantStatus;
  }): Promise<ScheduleParticipantRecord>;
}

export async function createScheduleEvent({
  repository,
  title,
  description,
  startsAt,
  organizerTelegramUserId,
  createdByTelegramUserId,
  tableId,
  capacity,
}: {
  repository: ScheduleRepository;
  title: string;
  description?: string | null;
  startsAt: string;
  organizerTelegramUserId: number;
  createdByTelegramUserId: number;
  tableId?: number | null;
  capacity: number;
}): Promise<ScheduleEventRecord> {
  const event = await repository.createEvent({
    title: normalizeTitle(title),
    description: normalizeDescription(description),
    startsAt: normalizeStartsAt(startsAt),
    organizerTelegramUserId: normalizeTelegramUserId(organizerTelegramUserId, 'organitzador'),
    createdByTelegramUserId: normalizeTelegramUserId(createdByTelegramUserId, 'creador'),
    tableId: normalizeTableId(tableId),
    capacity: normalizeCapacity(capacity),
  });

  await repository.upsertParticipant({
    eventId: event.id,
    participantTelegramUserId: event.organizerTelegramUserId,
    actorTelegramUserId: event.organizerTelegramUserId,
    status: 'active',
  });

  return event;
}

export async function listScheduleEvents({
  repository,
  includeCancelled = false,
  startsAtFrom,
  startsAtTo,
}: {
  repository: ScheduleRepository;
  includeCancelled?: boolean;
  startsAtFrom?: string;
  startsAtTo?: string;
}): Promise<ScheduleEventRecord[]> {
  return repository.listEvents({
    includeCancelled,
    ...(startsAtFrom ? { startsAtFrom: normalizeStartsAt(startsAtFrom) } : {}),
    ...(startsAtTo ? { startsAtTo: normalizeStartsAt(startsAtTo) } : {}),
  });
}

export async function cancelScheduleEvent({
  repository,
  eventId,
  actorTelegramUserId,
  reason,
}: {
  repository: ScheduleRepository;
  eventId: number;
  actorTelegramUserId: number;
  reason?: string | null;
}): Promise<ScheduleEventRecord> {
  const event = await repository.findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }

  if (event.lifecycleStatus === 'cancelled') {
    return event;
  }

  return repository.cancelEvent({
    eventId,
    actorTelegramUserId: normalizeTelegramUserId(actorTelegramUserId, 'actor'),
    ...(reason !== undefined ? { reason: normalizeDescription(reason) } : {}),
  });
}

export async function updateScheduleEvent({
  repository,
  eventId,
  title,
  description,
  startsAt,
  organizerTelegramUserId,
  tableId,
  capacity,
}: {
  repository: ScheduleRepository;
  eventId: number;
  title: string;
  description?: string | null;
  startsAt: string;
  organizerTelegramUserId: number;
  tableId?: number | null;
  capacity: number;
}): Promise<ScheduleEventRecord> {
  const event = await repository.findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }

  if (event.lifecycleStatus === 'cancelled') {
    throw new Error('No es pot editar una activitat cancel.lada');
  }

  return repository.updateEvent({
    eventId,
    title: normalizeTitle(title),
    description: normalizeDescription(description),
    startsAt: normalizeStartsAt(startsAt),
    organizerTelegramUserId: normalizeTelegramUserId(organizerTelegramUserId, 'organitzador'),
    tableId: normalizeTableId(tableId),
    capacity: normalizeCapacity(capacity),
  });
}

export async function setScheduleEventParticipantStatus({
  repository,
  eventId,
  participantTelegramUserId,
  actorTelegramUserId,
  status,
}: {
  repository: ScheduleRepository;
  eventId: number;
  participantTelegramUserId: number;
  actorTelegramUserId: number;
  status: ScheduleParticipantStatus;
}): Promise<ScheduleParticipantRecord> {
  const event = await repository.findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }

  if (event.lifecycleStatus === 'cancelled') {
    throw new Error('No es poden gestionar participants en una activitat cancel.lada');
  }

  const existing = await repository.findParticipant(eventId, participantTelegramUserId);
  if (existing?.status === status) {
    return existing;
  }

  if (status === 'active') {
    const snapshot = await getScheduleCapacitySnapshot({ repository, eventId });
    if (snapshot.availableSeats <= 0) {
      throw new Error('L activitat ja no te places disponibles');
    }
  }

  return repository.upsertParticipant({
    eventId,
    participantTelegramUserId: normalizeTelegramUserId(participantTelegramUserId, 'participant'),
    actorTelegramUserId: normalizeTelegramUserId(actorTelegramUserId, 'actor'),
    status,
  });
}

export async function getScheduleCapacitySnapshot({
  repository,
  eventId,
}: {
  repository: ScheduleRepository;
  eventId: number;
}): Promise<{
  capacity: number;
  occupiedSeats: number;
  availableSeats: number;
  isFull: boolean;
}> {
  const event = await repository.findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }

  const occupiedSeats = (await repository.listParticipants(eventId)).filter(
    (participant) => participant.status === 'active',
  ).length;
  const availableSeats = Math.max(0, event.capacity - occupiedSeats);

  return {
    capacity: event.capacity,
    occupiedSeats,
    availableSeats,
    isFull: availableSeats === 0,
  };
}

export async function joinScheduleEvent({
  repository,
  eventId,
  participantTelegramUserId,
  actorTelegramUserId,
}: {
  repository: ScheduleRepository;
  eventId: number;
  participantTelegramUserId: number;
  actorTelegramUserId: number;
}): Promise<ScheduleParticipantRecord> {
  const existing = await repository.findParticipant(eventId, participantTelegramUserId);
  if (existing?.status === 'active') {
    throw new Error('Ja estas apuntat a aquesta activitat');
  }

  return setScheduleEventParticipantStatus({
    repository,
    eventId,
    participantTelegramUserId,
    actorTelegramUserId,
    status: 'active',
  });
}

export async function leaveScheduleEvent({
  repository,
  eventId,
  participantTelegramUserId,
  actorTelegramUserId,
}: {
  repository: ScheduleRepository;
  eventId: number;
  participantTelegramUserId: number;
  actorTelegramUserId: number;
}): Promise<ScheduleParticipantRecord> {
  const existing = await repository.findParticipant(eventId, participantTelegramUserId);
  if (!existing || existing.status !== 'active') {
    throw new Error('No estas apuntat a aquesta activitat');
  }

  return setScheduleEventParticipantStatus({
    repository,
    eventId,
    participantTelegramUserId,
    actorTelegramUserId,
    status: 'removed',
  });
}

export async function getScheduleEventAttendance({
  repository,
  eventId,
}: {
  repository: ScheduleRepository;
  eventId: number;
}): Promise<{
  activeParticipantTelegramUserIds: number[];
  snapshot: {
    capacity: number;
    occupiedSeats: number;
    availableSeats: number;
    isFull: boolean;
  };
}> {
  const participants = await repository.listParticipants(eventId);
  const activeParticipantTelegramUserIds = participants
    .filter((participant) => participant.status === 'active')
    .map((participant) => participant.participantTelegramUserId)
    .sort((left, right) => left - right);

  return {
    activeParticipantTelegramUserIds,
    snapshot: await getScheduleCapacitySnapshot({ repository, eventId }),
  };
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new Error('El titol de l activitat es obligatori');
  }

  return normalized;
}

function normalizeDescription(description: string | null | undefined): string | null {
  const normalized = description?.trim();
  return normalized ? normalized : null;
}

function normalizeStartsAt(startsAt: string): string {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('La data d inici ha de ser valida');
  }

  return parsed.toISOString();
}

function normalizeTelegramUserId(value: number, role: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`L identificador de ${role} ha de ser un enter positiu`);
  }

  return value;
}

function normalizeTableId(tableId: number | null | undefined): number | null {
  if (tableId === undefined || tableId === null) {
    return null;
  }

  if (!Number.isInteger(tableId) || tableId <= 0) {
    throw new Error('La taula associada ha de ser un enter positiu');
  }

  return tableId;
}

function normalizeCapacity(capacity: number): number {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error('La capacitat ha de ser un enter positiu');
  }

  return capacity;
}
