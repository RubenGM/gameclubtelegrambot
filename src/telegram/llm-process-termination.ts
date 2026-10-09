import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/** Spawn callers use detached groups so wrapper/sudo descendants receive termination too. */
export function terminateLlmProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  const signal = (name: NodeJS.Signals) => {
    if (child.pid && child.pid > 0) {
      try { process.kill(-child.pid, name); } catch { /* sudo forwards signals when the operator has a different UID */ }
    }
    try { child.kill(name); } catch { /* process may already have closed */ }
  };
  // Injection doubles have no OS pid. Production always waits for the process to close.
  if (!child.pid) { signal('SIGTERM'); return Promise.resolve(); }
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(escalation); clearTimeout(deadline); child.removeListener('close', done); resolve(); };
    const escalation = setTimeout(() => signal('SIGKILL'), 750);
    const deadline = setTimeout(done, 1500);
    child.once('close', done);
    signal('SIGTERM');
  });
}
