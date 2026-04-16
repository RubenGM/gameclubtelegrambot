import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveIntegrationRuntimeEnv } from './integration-runtime.js';

test('resolveIntegrationRuntimeEnv prefers explicit runtime paths from the environment', async () => {
  const resolved = await resolveIntegrationRuntimeEnv({
    GAMECLUB_CONFIG_PATH: '/tmp/gameclub/runtime.ci.json',
    GAMECLUB_ENV_PATH: '/tmp/gameclub/runtime.ci.env',
  });

  assert.deepEqual(resolved, {
    GAMECLUB_CONFIG_PATH: '/tmp/gameclub/runtime.ci.json',
    GAMECLUB_ENV_PATH: '/tmp/gameclub/runtime.ci.env',
  });
});

test('resolveIntegrationRuntimeEnv falls back to config/runtime.local.json when present', async () => {
  const resolved = await resolveIntegrationRuntimeEnv(
    {},
    async (filePath: string) => filePath === 'config/runtime.local.json',
  );

  assert.deepEqual(resolved, {
    GAMECLUB_CONFIG_PATH: 'config/runtime.local.json',
  });
});

test('resolveIntegrationRuntimeEnv returns null when no integration config is available', async () => {
  const resolved = await resolveIntegrationRuntimeEnv({}, async () => false);

  assert.equal(resolved, null);
});
