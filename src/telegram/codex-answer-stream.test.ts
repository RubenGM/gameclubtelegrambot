import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { CodexAnswerDecoder } from './codex-answer-stream.js';
import { createLlmCommandService, LlmCommandServiceError, type LlmCommandSpawn } from './llm-command-service.js';

function processDouble(action: (rpc: Record<string, unknown>, emit: (event: object) => void) => void) {
  const writes: Record<string, unknown>[] = [];
  let killed = false;
  const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; stdin: Writable; kill(): boolean; exitCode: number | null };
  child.stdout = new Readable({ read() {} }); child.stderr = new Readable({ read() {} }); child.exitCode = null;
  const emit = (event: object) => child.stdout.push(`${JSON.stringify(event)}\n`);
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const rpc = JSON.parse(String(chunk)) as Record<string, unknown>;
    writes.push(rpc);
    queueMicrotask(() => action(rpc, emit));
    callback();
  } });
  child.kill = () => { killed = true; child.exitCode = 0; queueMicrotask(() => child.emit('close', 0)); return true; };
  const spawn: LlmCommandSpawn = () => child as unknown as ReturnType<LlmCommandSpawn>;
  return { spawn, writes, emit, killed: () => killed };
}
const params = { threadId: 'thread', turnId: 'turn' };
function initialized(rpc: Record<string, unknown>, emit: (event: object) => void): boolean {
  if (rpc.id === 1) emit({ id: 1, result: {} });
  else if (rpc.id === 2) emit({ id: 2, result: { config: { mcp_servers: { private_data: {} } } } });
  else if (rpc.id === 3) emit({ id: 3, result: { thread: { id: 'thread' } } });
  else if (rpc.id === 4) { emit({ id: 4, result: { turn: { id: 'turn' } } }); return true; }
  return false;
}
function start(emit: (event: object) => void) { emit({ method: 'item/started', params: { ...params, item: { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: '' } } }); }
function delta(emit: (event: object) => void, text: string) { emit({ method: 'item/agentMessage/delta', params: { ...params, itemId: 'answer', delta: text } }); }
function terminal(emit: (event: object) => void, answer: string) {
  emit({ method: 'item/completed', params: { ...params, item: { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: answer } } });
  emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
}
function service(spawn: LlmCommandSpawn, timeoutMs = 1000) { return createLlmCommandService({ config: { provider: 'codex', codexBin: './scripts/codex-cawa.sh', model: 'gpt-6-luna', reasoningEffort: 'low', timeoutMs }, spawnImpl: spawn }); }

test('answer decoder emits only decoded answer text over arbitrary fragments and complete Unicode pairs', () => {
  const decoder = new CodexAnswerDecoder();
  const json = '{"answer":"Hola\\n\\uD83D\\uDE00 \\"texto\\""}';
  const emitted = [...json].map((char) => decoder.push(char)).join('');
  assert.equal(emitted, 'Hola\n😀 "texto"');
  assert.equal(decoder.finish(json), emitted);
});

test('answer decoder rejects unexpected fields, malformed escapes, surrogates and oversized output', () => {
  for (const value of ['{"secret":"reasoning"}', '{"answer":"ok","reasoning":"secret"}', '{"answer":"\\x"}', '{"answer":"\\uD800"}']) {
    assert.throws(() => new CodexAnswerDecoder().push(value), LlmCommandServiceError);
  }
  assert.throws(() => new CodexAnswerDecoder().push('{"answer":"' + 'a'.repeat(65536)), LlmCommandServiceError);
  assert.throws(() => new CodexAnswerDecoder().finish('{"answer":"a","other":1}'), LlmCommandServiceError);
});

test('app-server streams genuine deltas before terminal, ignores reasoning/commentary/foreign items and disables configured MCP', async () => {
  let terminalSeen = false;
  const output: string[] = [];
  const mock = processDouble((rpc, emit) => {
    if (!initialized(rpc, emit)) return;
    emit({ method: 'item/reasoning/textDelta', params: { ...params, delta: 'PRIVATE REASONING' } });
    emit({ method: 'item/started', params: { ...params, item: { type: 'agentMessage', id: 'comment', phase: 'commentary', text: '' } } });
    emit({ method: 'item/agentMessage/delta', params: { ...params, itemId: 'comment', delta: 'PRIVATE COMMENTARY' } });
    start(emit);
    emit({ method: 'item/agentMessage/delta', params: { ...params, threadId: 'foreign', itemId: 'answer', delta: 'PRIVATE FOREIGN' } });
    delta(emit, '{"answer":"Hola');
    setTimeout(() => { delta(emit, ', mundo."}'); terminalSeen = true; terminal(emit, '{"answer":"Hola, mundo."}'); }, 20);
  });
  const answer = await service(mock.spawn).generateText!('prompt', { onTextDelta(text) { if (text === 'Hola') assert.equal(terminalSeen, false); output.push(text); } });
  assert.equal(answer, 'Hola, mundo.');
  assert.deepEqual(output, ['Hola', ', mundo.']);
  assert.equal(mock.killed(), true);
  const threadParams = mock.writes.find((rpc) => rpc.id === 3)?.params as { config: Record<string, unknown>; ephemeral: boolean };
  assert.equal(threadParams.config['mcp_servers.private_data.enabled'], false);
  assert.equal(threadParams.ephemeral, true);
});

test('Stop abort sends turn interrupt, terminates process and drops subsequent deltas', async () => {
  const controller = new AbortController();
  const output: string[] = [];
  const mock = processDouble((rpc, emit) => {
    if (!initialized(rpc, emit)) return;
    start(emit); delta(emit, '{"answer":"Hola');
    controller.abort(); delta(emit, ' PRIVATE LATE"}');
  });
  await assert.rejects(service(mock.spawn).generateText!('prompt', { signal: controller.signal, onTextDelta: (text) => output.push(text) }), (error) => error instanceof LlmCommandServiceError && error.code === 'cancelled');
  assert.deepEqual(output, ['Hola']);
  assert.equal(mock.killed(), true);
  assert.equal(mock.writes.some((rpc) => rpc.method === 'turn/interrupt'), true);
});

test('app-server fails closed on tools, mismatched completed JSON, failed turn and line limits', async () => {
  const actions = [
    (emit: (event: object) => void) => emit({ method: 'item/started', params: { ...params, item: { type: 'commandExecution', id: 'tool' } } }),
    (emit: (event: object) => void) => { start(emit); delta(emit, '{"answer":"a"}'); terminal(emit, '{"answer":"b"}'); },
    (emit: (event: object) => void) => { start(emit); delta(emit, '{"answer":"a"}'); emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'failed' } } }); },
    (emit: (event: object) => void) => emit({ method: 'item/reasoning/textDelta', params: { ...params, delta: 'x'.repeat(270000) } }),
  ];
  for (const action of actions) {
    const mock = processDouble((rpc, emit) => { if (initialized(rpc, emit)) action(emit); });
    await assert.rejects(service(mock.spawn).generateText!('prompt', { onTextDelta() {} }), LlmCommandServiceError);
    assert.equal(mock.killed(), true);
  }
});

test('timeout and pre-aborted signal terminate or avoid starting inference', async () => {
  const mock = processDouble(() => {});
  await assert.rejects(service(mock.spawn, 10).generateText!('prompt', { onTextDelta() {} }), (error) => error instanceof LlmCommandServiceError && error.code === 'timeout');
  assert.equal(mock.killed(), true);
  const never = processDouble(() => {});
  await assert.rejects(service(never.spawn).generateText!('prompt', { signal: AbortSignal.abort(), onTextDelta() {} }), (error) => error instanceof LlmCommandServiceError && error.code === 'cancelled');
  assert.equal(never.writes.length, 0);
});
