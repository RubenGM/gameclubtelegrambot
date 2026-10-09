import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm, access, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const supervisor = join(root, 'scripts/codex-operator-supervisor.sh');

test('operator supervisor preserves stdin and literal argv and kills a TERM-resistant child before exiting', async () => {
  const stage = await mkdtemp(join(tmpdir(), 'gameclub-supervisor-test-'));
  const worker = join(stage, 'worker.mjs');
  const binary = join(stage, 'fixture');
  const sentinel = join(stage, 'unexpected-injection');
  const arg = `literal;$(touch ${sentinel})`;
  let workerPid = 0;
  try {
    await writeFile(worker, 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);process.stdin.on("data",b=>console.log(JSON.stringify({pid:process.pid,text:String(b),args:process.argv.slice(2)})));');
    await writeFile(binary, `#!/bin/bash\nexec '${process.execPath}' '${worker}' "$@"\n`); await chmod(binary, 0o755);
    const child = spawn(supervisor, ['--local-bin', binary, arg], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let stderr = '';
    child.stderr.on('data', (data) => { stderr += String(data); });
    const closed = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => resolve()); });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.stdout.on('data', (data) => { output += String(data); if (output.includes('\n') && !workerPid) { workerPid = (JSON.parse(output) as { pid: number }).pid; child.kill('SIGTERM'); } });
    child.stdin.write('¿Prueba por stdin?\n');
    await closed; clearTimeout(timeout);
    const result = JSON.parse(output) as { pid: number; text: string; args: string[] };
    assert.equal(result.text, '¿Prueba por stdin?\n'); assert.deepEqual(result.args, [arg]);
    assert.equal(child.exitCode, 143); assert.equal(stderr, '');
    assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
    await assert.rejects(access(sentinel));
  } finally { if (workerPid) { try { process.kill(workerPid, 'SIGKILL'); } catch {} } await rm(stage, { recursive: true, force: true }); }
});

test('installed supervisor checks its fixed canonical binary and keeps stdout clean on rejection', async () => {
  const stage = await mkdtemp(join(tmpdir(), 'gameclub-supervisor-contract-'));
  try {
    const installed = join(stage, 'codex-operator-supervisor.sh');
    await copyFile(supervisor, installed); await chmod(installed, 0o755);
    await writeFile(join(stage, 'codex-operator-bin'), '/fixed/canonical/codex\n');
    const result = spawnSync(installed, ['/bin/sh', '-c', 'true'], { encoding: 'utf8' });
    assert.equal(result.status, 64); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  } finally { await rm(stage, { recursive: true, force: true }); }
});
