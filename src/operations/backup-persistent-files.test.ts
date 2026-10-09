import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync, symlinkSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const helper = resolve('scripts/backup-persistent-files.py');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gameclub-backup-test-'));
  const app = join(root, 'source');
  const target = join(root, 'recovered');
  const archive = join(root, 'archive');
  const config = join(root, 'runtime.json');
  mkdirSync(join(app, 'data/http-assets'), { recursive: true });
  writeFileSync(config, JSON.stringify({ googleCalendar: { serviceAccountFile: 'credentials/calendar.json' } }));
  const run = (operation: string, appRoot = app, extra: string[] = []) => execFileSync('python3', [helper, operation, '--config', config, '--app-root', appRoot, '--archive', archive, '--owner', userInfo().username, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { root, app, target, archive, config, run };
}

test('persistent backup recovers feedback, binary assets and Calendar credentials with service permissions', () => {
  const f = fixture();
  try {
    const feedback = '{"message":"¡Hola, català!"}\n';
    const image = Buffer.from([0, 255, 137, 80, 78, 71]);
    writeFileSync(join(f.app, 'data/feedback.jsonl'), feedback);
    writeFileSync(join(f.app, 'data/http-assets/logo.png'), image);
    mkdirSync(join(f.app, 'credentials'));
    writeFileSync(join(f.app, 'credentials/calendar.json'), '{"private_key":"test"}');
    mkdirSync(join(f.app, 'data/http-cache'));
    writeFileSync(join(f.app, 'data/http-cache/cache'), 'excluded');
    f.run('backup');
    assert.equal(existsSync(join(f.archive, 'data/http-cache')), false);
    mkdirSync(join(f.target, 'data/http-assets'), { recursive: true });
    writeFileSync(join(f.target, 'data/http-assets/stale.png'), 'stale');
    f.run('restore', f.target, ['--dry-run']);
    assert.equal(existsSync(join(f.target, 'data/feedback.jsonl')), false);
    f.run('restore', f.target);
    assert.equal(readFileSync(join(f.target, 'data/feedback.jsonl'), 'utf8'), feedback);
    assert.deepEqual(readFileSync(join(f.target, 'data/http-assets/logo.png')), image);
    assert.equal(existsSync(join(f.target, 'data/http-assets/stale.png')), false);
    const credential = join(f.target, 'credentials/calendar.json');
    assert.equal(readFileSync(credential, 'utf8'), '{"private_key":"test"}');
    assert.equal(statSync(credential).mode & 0o777, 0o600);
    assert.equal(statSync(credential).uid, userInfo().uid);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('configured absolute feedback and credential paths are included; absent files and old archives preserve existing data', () => {
  const f = fixture();
  try {
    const customFeedback = join(f.root, 'feedback.jsonl');
    const customCalendar = join(f.root, 'calendar.json');
    writeFileSync(customFeedback, 'feedback');
    writeFileSync(customCalendar, 'credential');
    writeFileSync(f.config, JSON.stringify({ httpServer: { feedbackFile: customFeedback }, googleCalendar: { serviceAccountFile: customCalendar } }));
    f.run('backup');
    writeFileSync(customFeedback, 'modified');
    f.run('restore', f.target);
    assert.equal(readFileSync(customFeedback, 'utf8'), 'feedback');
    rmSync(join(f.archive, 'metadata/persistent-files.json'));
    writeFileSync(customFeedback, 'keep');
    f.run('restore', f.target);
    assert.equal(readFileSync(customFeedback, 'utf8'), 'keep');
    rmSync(customFeedback);
    rmSync(customCalendar);
    f.run('backup');
    assert.deepEqual(JSON.parse(readFileSync(join(f.archive, 'metadata/persistent-files.json'), 'utf8')).included, ['http-assets']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('incomplete payloads and symlinks fail validation before modifying destination data', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.app, 'data/feedback.jsonl'), 'source');
    f.run('backup');
    rmSync(join(f.archive, 'data/feedback.jsonl'));
    assert.throws(() => f.run('validate', f.target), /feedback.jsonl/);
    assert.equal(existsSync(f.target), false);
    symlinkSync(f.config, join(f.app, 'data/http-assets/link'));
    assert.throws(() => f.run('backup'), /Unsupported persistent file type/);
    rmSync(join(f.app, 'data/http-assets/link'));
    f.run('backup');
    mkdirSync(join(f.target, 'data'), { recursive: true });
    symlinkSync(f.config, join(f.target, 'data/feedback.jsonl'));
    assert.throws(() => f.run('validate', f.target), /Symlink restore destination/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('full shell backup archives persistent payload and restore dry-run honors explicit destination', () => {
  const f = fixture();
  try {
    const repo = join(f.root, 'repo');
    const scripts = join(repo, 'scripts');
    const bin = join(f.root, 'bin');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(bin);
    for (const name of ['backup-full.sh', 'restore-full.sh', 'backup-persistent-files.py', 'resolve-node-bin.sh']) {
      copyFileSync(resolve('scripts', name), join(scripts, name));
    }
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'node'), 0o755);
    const dumpScript = '#!/bin/bash\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output-dir ]; then shift; output_dir="$1"; fi; shift; done\nmkdir -p "$output_dir"\nprintf "fixture SQL" | gzip > "$output_dir/gameclub-postgres-test.sql.gz"\n';
    writeFileSync(join(scripts, 'backup-postgres.sh'), dumpScript);
    writeFileSync(join(scripts, 'restore-postgres.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(scripts, 'backup-postgres.sh'), 0o755);
    chmodSync(join(scripts, 'restore-postgres.sh'), 0o755);
    const envFile = join(f.root, 'runtime.env');
    writeFileSync(envFile, '');
    writeFileSync(join(f.app, 'data/feedback.jsonl'), 'feedback from full backup');
    const env = { ...process.env, GAMECLUB_NODE_BIN: join(bin, 'node'), PATH: `${bin}:${process.env.PATH}`, GAMECLUB_SYSTEMD_UNIT_PATH: join(f.root, 'absent-unit'), GAMECLUB_POLKIT_RULE_PATH: join(f.root, 'absent-rule') };
    const output = execFileSync('bash', [join(scripts, 'backup-full.sh'), '--config', f.config, '--env', envFile, '--service-env', envFile, '--app-root', f.app, '--output-dir', join(f.root, 'zips')], { env, encoding: 'utf8' });
    const zip = output.trim().split('\n').at(-1)!;
    assert.equal(statSync(zip).mode & 0o777, 0o640);
    const dryRun = execFileSync('bash', [join(scripts, 'restore-full.sh'), '--input', zip, '--app-root', f.target, '--service-name', 'test-explicit.service', '--dry-run'], { env, encoding: 'utf8' });
    assert.ok(dryRun.includes(`data/feedback.jsonl -> ${f.target}/data/feedback.jsonl`));
    assert.ok(dryRun.includes('systemctl stop test-explicit.service'));
    assert.equal(existsSync(f.target), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
