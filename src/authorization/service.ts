export interface AuthorizationPermissionAssignment {
  permissionKey: string;
  scopeType: 'global' | 'resource';
  resourceType: string | null;
  resourceId: string | null;
  effect: 'allow' | 'deny';
}

export interface AuthorizationSubject {
  actorId: number;
  status: 'pending' | 'approved' | 'blocked';
  isAdmin: boolean;
  permissions: AuthorizationPermissionAssignment[];
}

export interface AuthorizationResource {
  type: string;
  id: string;
}

export type AuthorizationReason =
  | 'admin-override'
  | 'blocked-subject'
  | 'resource-deny'
  | 'resource-allow'
  | 'global-deny'
  | 'global-allow'
  | 'no-match';

export interface AuthorizationDecision {
  allowed: boolean;
  permissionKey: string;
  reason: AuthorizationReason;
}

export interface AuthorizationService {
  authorize(permissionKey: string, resource?: AuthorizationResource): AuthorizationDecision;
  can(permissionKey: string, resource?: AuthorizationResource): boolean;
}

export function createAuthorizationService({
  subject,
}: {
  subject: AuthorizationSubject;
}): AuthorizationService {
  return {
    authorize(permissionKey, resource) {
      return authorize({ subject, permissionKey, ...(resource ? { resource } : {}) });
    },
    can(permissionKey, resource) {
      return can({ subject, permissionKey, ...(resource ? { resource } : {}) });
    },
  };
}

export function authorize({
  subject,
  permissionKey,
  resource,
}: {
  subject: AuthorizationSubject;
  permissionKey: string;
  resource?: AuthorizationResource;
}): AuthorizationDecision {
  if (subject.status === 'blocked') {
    return {
      allowed: false,
      permissionKey,
      reason: 'blocked-subject',
    };
  }

  if (subject.isAdmin) {
    return {
      allowed: true,
      permissionKey,
      reason: 'admin-override',
    };
  }

  const matchingAssignments = subject.permissions.filter(
    (permission) => permission.permissionKey === permissionKey,
  );

  if (resource) {
    const matchingResourceAssignments = matchingAssignments.filter(
      (permission) =>
        permission.scopeType === 'resource' &&
        permission.resourceType === resource.type &&
        permission.resourceId === resource.id,
    );

    if (matchingResourceAssignments.some((permission) => permission.effect === 'deny')) {
      return {
        allowed: false,
        permissionKey,
        reason: 'resource-deny',
      };
    }

    if (matchingResourceAssignments.some((permission) => permission.effect === 'allow')) {
      return {
        allowed: true,
        permissionKey,
        reason: 'resource-allow',
      };
    }
  }

  const globalAssignments = matchingAssignments.filter((permission) => permission.scopeType === 'global');

  if (globalAssignments.some((permission) => permission.effect === 'deny')) {
    return {
      allowed: false,
      permissionKey,
      reason: 'global-deny',
    };
  }

  if (globalAssignments.some((permission) => permission.effect === 'allow')) {
    return {
      allowed: true,
      permissionKey,
      reason: 'global-allow',
    };
  }

  return {
    allowed: false,
    permissionKey,
    reason: 'no-match',
  };
}

export function can({
  subject,
  permissionKey,
  resource,
}: {
  subject: AuthorizationSubject;
  permissionKey: string;
  resource?: AuthorizationResource;
}): boolean {
  return authorize({ subject, permissionKey, ...(resource ? { resource } : {}) }).allowed;
}
