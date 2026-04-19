export type ScheduleEventLifecycleStatus = 'scheduled' | 'cancelled';
export type ScheduleParticipantStatus = 'active' | 'removed';
export type ScheduleAttendanceMode = 'open' | 'closed';

export interface ScheduleEventRecord {
  id: number;
  title: string;
  description: string | null;
  startsAt: string;
  durationMinutes: number;
  organizerTelegramUserId: number;
  createdByTelegramUserId: number;
  tableId: number | null;
  attendanceMode: ScheduleAttendanceMode;
  initialOccupiedSeats: number;
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
    durationMinutes: number;
    organizerTelegramUserId: number;
    createdByTelegramUserId: number;
    tableId: number | null;
    attendanceMode: ScheduleAttendanceMode;
    initialOccupiedSeats: number;
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
    durationMinutes: number;
    organizerTelegramUserId: number;
    tableId: number | null;
    attendanceMode: ScheduleAttendanceMode;
    initialOccupiedSeats: number;
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
  durationMinutes,
  organizerTelegramUserId,
  createdByTelegramUserId,
  tableId,
  attendanceMode,
  initialOccupiedSeats,
  capacity,
}: {
  repository: ScheduleRepository;
  title: string;
  description?: string | null;
  startsAt: string;
  durationMinutes: number;
  organizerTelegramUserId: number;
  createdByTelegramUserId: number;
  tableId?: number | null;
  attendanceMode: ScheduleAttendanceMode;
  initialOccupiedSeats: number;
  capacity: number;
}): Promise<ScheduleEventRecord> {
  return repository.createEvent({
    title: normalizeTitle(title),
    description: normalizeDescription(description),
    startsAt: normalizeStartsAt(startsAt),
    durationMinutes: normalizeDurationMinutes(durationMinutes),
    organizerTelegramUserId: normalizeTelegramUserId(organizerTelegramUserId, 'organitzador'),
    createdByTelegramUserId: normalizeTelegramUserId(createdByTelegramUserId, 'creador'),
    tableId: normalizeTableId(tableId),
    attendanceMode: normalizeAttendanceMode(attendanceMode),
    initialOccupiedSeats: normalizeInitialOccupiedSeats({
      attendanceMode,
      initialOccupiedSeats,
      capacity,
    }),
    capacity: normalizeCapacity(capacity),
  });
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
  durationMinutes,
  organizerTelegramUserId,
  tableId,
  attendanceMode,
  initialOccupiedSeats,
  capacity,
}: {
  repository: ScheduleRepository;
  eventId: number;
  title: string;
  description?: string | null;
  startsAt: string;
  durationMinutes: number;
  organizerTelegramUserId: number;
  tableId?: number | null;
  attendanceMode: ScheduleAttendanceMode;
  initialOccupiedSeats: number;
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
    durationMinutes: normalizeDurationMinutes(durationMinutes),
    organizerTelegramUserId: normalizeTelegramUserId(organizerTelegramUserId, 'organitzador'),
    tableId: normalizeTableId(tableId),
    attendanceMode: normalizeAttendanceMode(attendanceMode),
    initialOccupiedSeats: normalizeInitialOccupiedSeats({
      attendanceMode,
      initialOccupiedSeats,
      capacity,
    }),
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

  if (event.attendanceMode === 'closed') {
    if (status === 'active') {
      throw new Error('No es pot apuntar gent a una activitat tancada');
    }
    throw new Error('No es poden gestionar participants en una activitat tancada');
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

  const activeParticipantCount = (await repository.listParticipants(eventId)).filter(
    (participant) => participant.status === 'active',
  ).length;
  if (event.attendanceMode === 'closed') {
    return {
      capacity: event.capacity,
      occupiedSeats: event.capacity,
      availableSeats: 0,
      isFull: true,
    };
  }

  const occupiedSeats = event.initialOccupiedSeats + activeParticipantCount;
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
  const event = await repository.findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }
  if (event.attendanceMode === 'closed') {
    throw new Error('No es pot apuntar gent a una activitat tancada');
  }

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
  const event = await repository.findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }
  if (event.attendanceMode === 'closed') {
    throw new Error('No es pot sortir d una activitat tancada');
  }

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

export async function detectScheduleConflicts({
  repository,
  eventId,
  actorTelegramUserId,
}: {
  repository: ScheduleRepository;
  eventId: number;
  actorTelegramUserId: number;
}): Promise<{
  overlappingEventIds: number[];
  impactedTelegramUserIds: number[];
  conflicts: Array<{
    eventId: number;
    overlappingEventId: number;
    impactedTelegramUserIds: number[];
  }>;
}> {
  const event = await repository.findEventById(eventId);
  if (!event) {
    throw new Error(`Schedule event ${eventId} not found`);
  }

  const candidates = (await repository.listEvents({ includeCancelled: false })).filter(
    (candidate) => candidate.id !== eventId,
  );
  const conflicts: Array<{ eventId: number; overlappingEventId: number; impactedTelegramUserIds: number[] }> = [];

  for (const candidate of candidates) {
    if (!eventsOverlap(event, candidate)) {
      continue;
    }

    const subjectAttendance = await getScheduleEventAttendance({ repository, eventId });
    const candidateAttendance = await getScheduleEventAttendance({ repository, eventId: candidate.id });
    const impactedTelegramUserIds = Array.from(
      new Set([
        event.organizerTelegramUserId,
        candidate.organizerTelegramUserId,
        ...subjectAttendance.activeParticipantTelegramUserIds,
        ...candidateAttendance.activeParticipantTelegramUserIds,
      ]),
    )
      .filter((telegramUserId) => telegramUserId !== actorTelegramUserId)
      .sort((left, right) => left - right);

    if (impactedTelegramUserIds.length > 0) {
      conflicts.push({
        eventId,
        overlappingEventId: candidate.id,
        impactedTelegramUserIds,
      });
    }
  }

  return {
    overlappingEventIds: conflicts.map((conflict) => conflict.overlappingEventId),
    impactedTelegramUserIds: Array.from(new Set(conflicts.flatMap((conflict) => conflict.impactedTelegramUserIds))).sort(
      (left, right) => left - right,
    ),
    conflicts,
  };
}

export function getScheduleEventEndsAt(event: Pick<ScheduleEventRecord, 'startsAt' | 'durationMinutes'>): string {
  return new Date(new Date(event.startsAt).getTime() + event.durationMinutes * 60000).toISOString();
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

function normalizeAttendanceMode(attendanceMode: ScheduleAttendanceMode): ScheduleAttendanceMode {
  if (attendanceMode !== 'open' && attendanceMode !== 'closed') {
    throw new Error('El mode d assistencia ha de ser open o closed');
  }

  return attendanceMode;
}

function normalizeInitialOccupiedSeats({
  attendanceMode,
  initialOccupiedSeats,
  capacity,
}: {
  attendanceMode: ScheduleAttendanceMode;
  initialOccupiedSeats: number;
  capacity: number;
}): number {
  const normalizedAttendanceMode = normalizeAttendanceMode(attendanceMode);
  const normalizedCapacity = normalizeCapacity(capacity);
  if (!Number.isInteger(initialOccupiedSeats) || initialOccupiedSeats < 0) {
    throw new Error('Les places ocupades inicials han de ser un enter zero o positiu');
  }
  if (normalizedAttendanceMode === 'closed') {
    return 0;
  }
  if (initialOccupiedSeats > normalizedCapacity) {
    throw new Error('Les places ocupades inicials no poden superar la capacitat');
  }

  return initialOccupiedSeats;
}

function normalizeDurationMinutes(durationMinutes: number): number {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('La durada ha de ser un enter positiu en minuts');
  }

  return durationMinutes;
}

function eventsOverlap(
  left: Pick<ScheduleEventRecord, 'startsAt' | 'durationMinutes'>,
  right: Pick<ScheduleEventRecord, 'startsAt' | 'durationMinutes'>,
): boolean {
  const leftStart = new Date(left.startsAt).getTime();
  const leftEnd = new Date(getScheduleEventEndsAt(left)).getTime();
  const rightStart = new Date(right.startsAt).getTime();
  const rightEnd = new Date(getScheduleEventEndsAt(right)).getTime();

  return leftStart < rightEnd && rightStart < leftEnd;
}
