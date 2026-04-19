import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authorize,
  can,
  createAuthorizationService,
  type AuthorizationSubject,
} from './service.js';

function createSubject(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return {
    actorId: 42,
    status: 'approved',
    isAdmin: false,
    permissions: [],
    ...overrides,
  };
}

test('authorize allows admins immediately', async () => {
  const decision = authorize({
    subject: createSubject({ isAdmin: true }),
    permissionKey: 'table.manage',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'admin-override');
});

test('authorize denies blocked subjects before permission evaluation', async () => {
  const decision = authorize({
    subject: createSubject({ status: 'blocked', isAdmin: false }),
    permissionKey: 'table.manage',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'blocked-subject');
});

test('authorize keeps revoked subjects outside approved permissions unless explicitly allowed', async () => {
  const decision = authorize({
    subject: createSubject({ status: 'revoked', isAdmin: false }),
    permissionKey: 'table.manage',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'no-match');
});

test('authorize applies resource deny before broader allows', async () => {
  const decision = authorize({
    subject: createSubject({
      permissions: [
        {
          permissionKey: 'table.reserve',
          scopeType: 'global',
          resourceType: null,
          resourceId: null,
          effect: 'allow',
        },
        {
          permissionKey: 'table.reserve',
          scopeType: 'resource',
          resourceType: 'table',
          resourceId: 'table-7',
          effect: 'deny',
        },
      ],
    }),
    permissionKey: 'table.reserve',
    resource: {
      type: 'table',
      id: 'table-7',
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'resource-deny');
});

test('authorize applies resource allow before global deny', async () => {
  const decision = authorize({
    subject: createSubject({
      permissions: [
        {
          permissionKey: 'table.reserve',
          scopeType: 'global',
          resourceType: null,
          resourceId: null,
          effect: 'deny',
        },
        {
          permissionKey: 'table.reserve',
          scopeType: 'resource',
          resourceType: 'table',
          resourceId: 'table-7',
          effect: 'allow',
        },
      ],
    }),
    permissionKey: 'table.reserve',
    resource: {
      type: 'table',
      id: 'table-7',
    },
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'resource-allow');
});

test('authorize falls back to matching global permissions', async () => {
  const allowDecision = authorize({
    subject: createSubject({
      permissions: [
        {
          permissionKey: 'loan.borrow',
          scopeType: 'global',
          resourceType: null,
          resourceId: null,
          effect: 'allow',
        },
      ],
    }),
    permissionKey: 'loan.borrow',
  });
  const denyDecision = authorize({
    subject: createSubject({
      permissions: [
        {
          permissionKey: 'loan.borrow',
          scopeType: 'global',
          resourceType: null,
          resourceId: null,
          effect: 'deny',
        },
      ],
    }),
    permissionKey: 'loan.borrow',
  });

  assert.equal(allowDecision.allowed, true);
  assert.equal(allowDecision.reason, 'global-allow');
  assert.equal(denyDecision.allowed, false);
  assert.equal(denyDecision.reason, 'global-deny');
});

test('authorize explains default deny when no rule matches', async () => {
  const decision = authorize({
    subject: createSubject(),
    permissionKey: 'game.import',
    resource: {
      type: 'game',
      id: '42',
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'no-match');
});

test('createAuthorizationService exposes reusable can and authorize helpers', async () => {
  const service = createAuthorizationService({
    subject: createSubject({
      permissions: [
        {
          permissionKey: 'schedule.manage',
          scopeType: 'global',
          resourceType: null,
          resourceId: null,
          effect: 'allow',
        },
      ],
    }),
  });

  assert.equal(service.can('schedule.manage'), true);
  assert.deepEqual(service.authorize('schedule.manage'), {
    allowed: true,
    permissionKey: 'schedule.manage',
    reason: 'global-allow',
  });
  assert.equal(can({ subject: createSubject(), permissionKey: 'schedule.manage' }), false);
});
