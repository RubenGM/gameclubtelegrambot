# Telegram Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe Telegram printing feature for approved members, with admin activation, direct attachment printing, Storage printing, duplex choice, abuse confirmations, and admin-visible history.

**Architecture:** Add a focused `src/printing/` domain for parsing, CUPS process orchestration, settings, and history. Add Telegram flows for member printing and admin printer controls, wiring them into existing action menus and Storage detail actions. Persist history in PostgreSQL with Drizzle migration artifacts; keep temporary files ephemeral and all process calls injectable for tests.

**Tech Stack:** TypeScript, Node test runner, grammY runtime boundary, Drizzle/PostgreSQL, CUPS `lp`/`lpstat`/`lpoptions`, `pdfinfo`, `pdfseparate`, LibreOffice headless, existing Telegram sessions and editable progress helpers.

---

### Task 1: Printing Domain Foundation

**Files:**
- Create: `src/printing/page-selection.ts`
- Create: `src/printing/page-selection.test.ts`
- Create: `src/printing/print-settings.ts`
- Create: `src/printing/print-settings.test.ts`

- [ ] **Step 1: Write failing page selection tests**

Add tests for `parsePrintPageSelection(input, totalPages)`:

```ts
test('parsePrintPageSelection accepts all pages', () => {
  assert.deepEqual(parsePrintPageSelection('Todas', 4), { ok: true, pages: [1, 2, 3, 4], label: '1-4' });
});

test('parsePrintPageSelection deduplicates ranges and lists', () => {
  assert.deepEqual(parsePrintPageSelection('1,3,2-4,3', 5), { ok: true, pages: [1, 2, 3, 4], label: '1-4' });
});

test('parsePrintPageSelection rejects pages outside the document', () => {
  assert.deepEqual(parsePrintPageSelection('1,8', 4), { ok: false, reason: 'out-of-range' });
});
```

- [ ] **Step 2: Run red test**

Run: `node --import tsx --test src/printing/page-selection.test.ts`

Expected: failure because `src/printing/page-selection.ts` does not exist.

- [ ] **Step 3: Implement page selection parser**

Create a pure parser returning either `{ ok: true, pages, label }` or `{ ok: false, reason }`. Accept `all`, `todas`, `todos`, `tot`, `totes`, and `todo`.

- [ ] **Step 4: Verify green**

Run: `node --import tsx --test src/printing/page-selection.test.ts`

Expected: pass.

- [ ] **Step 5: Add settings store tests**

Test an app-metadata-backed store with key `printing.settings`, default disabled, queue fallback, and enable/disable updates.

- [ ] **Step 6: Implement settings store**

Create `createAppMetadataPrintingSettingsStore({ storage, defaultQueue })` with `getSettings()` and `saveSettings(settings)`.

- [ ] **Step 7: Verify settings tests**

Run: `node --import tsx --test src/printing/print-settings.test.ts`

Expected: pass.

### Task 2: Persistent Print Job History

**Files:**
- Modify: `src/infrastructure/database/schema.ts`
- Create: `src/printing/print-job-history.ts`
- Create: `src/printing/print-job-history.test.ts`
- Generate: `drizzle/*.sql`
- Generate: `drizzle/meta/*.json`

- [ ] **Step 1: Write failing repository tests**

Test that a memory repository and database-shaped mapper can record and list jobs with user, origin, pages, copies, sides, queue, status, CUPS job ID, and safe error.

- [ ] **Step 2: Run red test**

Run: `node --import tsx --test src/printing/print-job-history.test.ts`

Expected: failure because the module does not exist.

- [ ] **Step 3: Add schema table**

Add `print_jobs` to `src/infrastructure/database/schema.ts` with columns from the spec and indexes on `created_at`, `requested_by_telegram_user_id`, and `status`.

- [ ] **Step 4: Implement repository**

Expose `createDatabasePrintJobHistoryRepository({ database })` and `createMemoryPrintJobHistoryRepository()` with `createJob`, `markSubmitted`, `markFailed`, `markCancelled`, and `listRecent`.

- [ ] **Step 5: Generate migration**

Run: `npm run db:generate -- --name add_print_jobs`

Expected: new Drizzle SQL and snapshot files.

- [ ] **Step 6: Verify migration state**

Run: `npm run db:check`

Expected: pass.

### Task 3: Print Service Process Boundary

**Files:**
- Create: `src/printing/print-service.ts`
- Create: `src/printing/print-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover:

- PDF inspection calls `pdfinfo`.
- Office conversion calls `soffice --headless --convert-to pdf`.
- Duplex capability is detected from `lpoptions`.
- Submission calls `lp` with `-d`, `-n`, `-o page-ranges`, and `-o sides`.
- Temporary paths are removed on success and failure.

- [ ] **Step 2: Run red test**

Run: `node --import tsx --test src/printing/print-service.test.ts`

Expected: failure because the service does not exist.

- [ ] **Step 3: Implement injectable process runner**

Define a `PrintingProcessRunner` interface and implement the service without executing real commands in tests.

- [ ] **Step 4: Verify green**

Run: `node --import tsx --test src/printing/print-service.test.ts`

Expected: pass.

### Task 4: Telegram Printing Flow

**Files:**
- Create: `src/telegram/i18n-printing.ts`
- Create: `src/telegram/print-flow.ts`
- Create: `src/telegram/print-flow.test.ts`
- Modify: `src/telegram/i18n.ts`
- Modify: `src/telegram/action-menu.ts`
- Modify: `src/telegram/action-menu.test.ts`
- Modify: `src/telegram/runtime-boundary-registration.ts`
- Modify: `src/telegram/command-registry.ts`
- Modify: `src/telegram/runtime-boundary-support.ts`

- [ ] **Step 1: Write failing menu tests**

Add tests that `Imprimir` appears only for approved users when printing is enabled and never for blocked/unapproved users or when disabled.

- [ ] **Step 2: Implement menu visibility**

Thread a `printingEnabled` boolean through action menu context and add localized `print` labels.

- [ ] **Step 3: Write failing flow tests**

Cover disabled start, attachment request, unsupported attachment, page selection, copy selection, duplex choice, extra confirmations, final submit, and already-started session continuing after disable.

- [ ] **Step 4: Implement print flow**

Use existing session runtime, `downloadFile`, and editable progress. Keep process and history repositories injectable.

- [ ] **Step 5: Wire runtime dispatch**

Register `/print`, the `Imprimir` menu action, callbacks, and session text/media handlers.

- [ ] **Step 6: Verify Telegram tests**

Run:

```bash
node --import tsx --test src/telegram/action-menu.test.ts
node --import tsx --test src/telegram/print-flow.test.ts
node --import tsx --test src/telegram/runtime-boundary.test.ts
```

Expected: pass.

### Task 5: Admin Printer Controls

**Files:**
- Create: `src/telegram/printer-admin-flow.ts`
- Create: `src/telegram/printer-admin-flow.test.ts`
- Modify: `src/telegram/action-menu.ts`
- Modify: `src/telegram/action-menu.test.ts`
- Modify: `src/telegram/runtime-boundary-registration.ts`

- [ ] **Step 1: Write failing admin tests**

Cover `Admin` -> `Impresora`, enable, disable, refresh status, and recent history list.

- [ ] **Step 2: Implement admin flow**

Use settings store, CUPS status from print service, and history repository. Keep all controls private/admin-only.

- [ ] **Step 3: Verify admin tests**

Run: `node --import tsx --test src/telegram/printer-admin-flow.test.ts src/telegram/action-menu.test.ts`

Expected: pass.

### Task 6: Storage Print Entry Point

**Files:**
- Modify: `src/telegram/storage-flow.ts`
- Modify: `src/telegram/storage-flow.test.ts`
- Modify: `src/telegram/print-flow.ts`
- Modify: `src/telegram/i18n-storage.ts`

- [ ] **Step 1: Write failing Storage tests**

Cover print action visible for a readable PDF entry when enabled, hidden when disabled, hidden for non-printable entries, and denied when permissions do not allow read.

- [ ] **Step 2: Implement Storage callback**

Add a callback that starts the print flow from a selected `StorageEntryMessageRecord` with `telegramFileId`.

- [ ] **Step 3: Verify Storage tests**

Run: `node --import tsx --test src/telegram/storage-flow.test.ts src/telegram/print-flow.test.ts`

Expected: pass.

### Task 7: Docs, Config, and Final Validation

**Files:**
- Modify: `docs/feature-status.md`
- Modify: `docs/runtime-configuration.md`
- Modify: `config/runtime.example.json` if present
- Modify: `src/config/runtime-config.ts` if runtime queue settings are represented there

- [ ] **Step 1: Update docs**

Document the feature, runtime variables, validation caveat, and virtual-printer testing boundary.

- [ ] **Step 2: Run focused tests**

Run all tests touched in earlier tasks.

- [ ] **Step 3: Run repository validation**

Run:

```bash
npm run typecheck
npm run db:check
./scripts/feature-status-audit.sh
./startup.sh
```

Expected: all pass. Do not send a real print job to `HP-LaserJet-P2015-Series`.

