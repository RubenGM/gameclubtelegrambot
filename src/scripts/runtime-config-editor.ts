import { runRuntimeConfigEditor } from '../config/runtime-config-editor.js';

const initMode = process.argv.includes('--init');

try {
  await runRuntimeConfigEditor({ init: initMode });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
