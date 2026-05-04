import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/uninstall-debian-stack.sh');

test('uninstall-debian-stack dry run removes service, polkit rule, and operator autostart', () => {
  assert.equal(existsSync(scriptPath), true, 'uninstall script must exist');

  const operatorUser = userInfo().username;
  const result = spawnSync('bash', [scriptPath, '--dry-run', '--operator-user', operatorUser], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\+ sudo systemctl disable --now gameclubtelegrambot\.service/);
  assert.match(result.stdout, /\+ sudo rm -f \/etc\/systemd\/system\/gameclubtelegrambot\.service/);
  assert.match(result.stdout, /\+ sudo rm -f \/etc\/polkit-1\/rules\.d\/50-gameclubtelegrambot\.rules/);
  assert.match(
    result.stdout,
    new RegExp(`\\+ sudo rm -f .*${operatorUser}.*/\\.config/autostart/gameclubtelegrambot-tray\\.desktop`),
  );
  assert.match(result.stdout, /\+ sudo systemctl daemon-reload/);
});
