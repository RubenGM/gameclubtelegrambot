import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, stat, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('deployment restores operator-readable static schemas while preserving credential and unrelated JSON permissions', async () => {
  const stage = await mkdtemp(join(tmpdir(), 'gameclub-schema-permissions-'));
  try {
    await mkdir(join(stage, 'src', 'telegram'), { recursive: true });
    const schema = join(stage, 'src', 'telegram', 'decision.schema.json');
    const credentials = join(stage, 'src', 'telegram', 'credentials.json');
    const external = join(stage, 'private.schema.json');
    for (const file of [schema, credentials, external]) await writeFile(file, '{}', { mode: 0o600 });
    await symlink(external, join(stage, 'src', 'telegram', 'linked.schema.json'));
    const installer = await readFile(join(process.cwd(), 'scripts/install-debian-stack.sh'), 'utf8');
    const normalize = /^normalize_codex_schema_permissions\(\) \{[\s\S]*?^\}/m.exec(installer)?.[0];
    assert.ok(normalize, 'deployment normalization function exists');
    const result = spawnSync('/bin/bash', ['-c', `set -euo pipefail\nAPP_ROOT="$1"\nrun_root_cmd() { "$@"; }\n${normalize}\nnormalize_codex_schema_permissions`, 'schema-permissions-test', stage], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await stat(schema)).mode & 0o777, 0o644);
    assert.equal((await stat(credentials)).mode & 0o777, 0o600);
    assert.equal((await stat(external)).mode & 0o777, 0o600);
    assert.match(installer, /chown -R "\$SERVICE_USER:\$SERVICE_GROUP" "\$APP_ROOT"\n  normalize_codex_schema_permissions/);
  } finally { await rm(stage, { recursive: true, force: true }); }
});
