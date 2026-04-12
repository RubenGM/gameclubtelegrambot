# Database Integrity and Concurrency Design

## Goal

Protect catalog loan invariants at the PostgreSQL layer so duplicate active loans cannot be created under concurrency, while keeping operator-friendly application errors and idempotent loan returns.

## Background

The current loan repository keeps the main business rule in TypeScript: it checks for an active loan before inserting a new one. That is useful for a friendly message, but it is not a safe final guard when two concurrent requests race on the same item.

The return path also uses a read-then-update flow. That works in the common case, but it is weaker than a single conditional write when duplicate return attempts arrive close together.

## Scope

### In scope

- Add a database-enforced invariant for one active loan per item.
- Preserve the existing friendly duplicate-loan error at the application boundary.
- Make loan closing atomic and idempotent.
- Add repository and integration coverage for duplicate active loans and duplicate returns.

### Out of scope

- New loan lifecycle states beyond `returned_at` being null or non-null.
- Broader row-locking patterns across the catalog domain.
- New operator UI or Telegram flow changes.
- Repair logic for pre-existing invalid historical data.

## Design Summary

Use PostgreSQL as the final source of truth for the active-loan invariant by adding a partial unique index on `catalog_loans(item_id)` where `returned_at is null`.

Keep the existing pre-check in the repository for user-friendly feedback, but treat it as advisory only. The insert path must also catch the corresponding Postgres unique-violation error and translate it to the same friendly message.

Replace the close-loan read-then-update sequence with a single conditional update that only closes active loans. If that update affects no rows, read the loan once to distinguish between "already returned" and "not found".

## Component Changes

### `src/infrastructure/database/schema.ts`

Add a named partial unique index for active loans on `catalog_loans.item_id` with the predicate `returned_at is null`.

Responsibilities:

- document the invariant in the schema definition
- keep the index name stable for migration generation and error mapping

### Database migration

Generate a migration that creates the partial unique index in PostgreSQL.

Requirements:

- the migration must be additive and safe for normal rollout
- the index name must match the schema declaration so runtime errors can be recognized reliably

### `src/catalog/catalog-loan-store.ts`

#### Create path

Keep the current active-loan pre-check before insert so the common duplicate case still returns a short friendly message without relying on a database exception.

On insert failure, detect the Postgres unique-violation raised by the new partial unique index and map it to the same error text currently used for duplicate active loans.

All other database failures should continue to surface as unexpected errors.

#### Close path

Change `closeLoan()` to this behavior:

1. Run `update ... where id = ? and returned_at is null returning *`.
2. If a row is returned, map and return it.
3. If no row is returned, read the loan by id.
4. If the loan exists and already has `returnedAt`, return it unchanged.
5. If the loan does not exist, throw the existing not-found error.

This keeps duplicate close attempts idempotent without introducing explicit row locks.

## Data Flow

### Create loan

1. The repository checks whether an active loan already exists for the item.
2. If one exists, it returns the existing friendly duplicate-loan error immediately.
3. If none exists, it attempts the insert.
4. If the insert succeeds, the new loan is returned.
5. If the insert fails because another concurrent transaction already created an active loan, the unique index rejects it and the repository returns the same friendly duplicate-loan error.

### Close loan

1. The repository attempts a conditional update that only matches active loans.
2. If the update returns a row, the loan was closed by this request.
3. If the update returns no row, the repository reads the loan by id.
4. If the loan exists and is already returned, it returns that record unchanged.
5. If the loan does not exist, it throws a not-found error.

## Error Handling Rules

- Duplicate active loans must always converge on `Aquest item ja esta prestat.` regardless of whether the pre-check or the database constraint catches the conflict.
- Duplicate close attempts must be idempotent and return the already-closed loan record.
- Closing a missing loan must still throw `Catalog loan <id> not found`.
- Unexpected database failures must not be swallowed or rewritten unless they match the specific duplicate-active-loan constraint.

## Testing

### Repository tests

Add focused tests for `catalog-loan-store` covering:

- unique-violation mapping on create
- successful close through conditional update
- idempotent second close returning the existing closed loan
- missing loan close continuing to throw not found

### Integration tests

Add real-Postgres coverage proving the database invariant, not just mocked behavior.

Required cases:

- inserting a second active loan for the same item fails because of the partial unique index
- two concurrent create attempts for the same item result in one success and one predictable duplicate-loan failure
- a second close attempt on the same loan returns the already-closed record without changing it further

The tests should stay at the repository/database boundary. No Telegram flow changes are required for this improvement.

## Acceptance Criteria

- PostgreSQL rejects any attempt to persist more than one active loan for the same item.
- The application still returns the existing friendly duplicate-loan error.
- `closeLoan()` is atomic with respect to the active-loan predicate and remains idempotent.
- Integration tests cover the unique-index invariant and concurrent create behavior.
- The change stays focused on loan persistence and does not introduce broader locking infrastructure.
