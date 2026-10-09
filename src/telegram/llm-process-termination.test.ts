import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createLlmCommandService, LlmCommandServiceError, type LlmCommandSpawn } from './llm-command-service.js';

test('interpretation AbortSignal escalates a real process that ignores SIGTERM and waits for exit before rejecting', async () => {
  const controller = new AbortController();
  let child: ChildProcessWithoutNullStreams | undefined;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const spawnImpl: LlmCommandSpawn = (_command, _args, options) => {
    child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); process.stdin.resume(); setInterval(()=>{},1000); console.log("ready");'], options);
    child.stdout.once('data', () => ready());
    return child;
  };
  const service = createLlmCommandService({ config: { provider: 'opencode', opencodeBin: './scripts/opencode-cawa.sh', model: 'test', timeoutMs: 5000 }, spawnImpl });
  const pending = service.interpret('prompt', { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof LlmCommandServiceError && error.code === 'cancelled');
  assert.equal(child!.signalCode, 'SIGKILL');
  assert.throws(() => process.kill(child!.pid!, 0), { code: 'ESRCH' });
});
