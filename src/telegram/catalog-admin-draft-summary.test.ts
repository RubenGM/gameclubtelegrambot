import test from 'node:test';
import assert from 'node:assert/strict';

import { formatCatalogAdminDraftSummary } from './catalog-admin-draft-summary.js';

test('formatCatalogAdminDraftSummary keeps long imported BGG data within the Telegram message limit', async () => {
  const summary = await formatCatalogAdminDraftSummary({
    botLanguage: 'es',
    data: {
      itemType: 'board-game',
      displayName: 'Pandemic',
      originalName: 'Pandemic',
      description: `Descripción traducida con caracteres <&>. ${'Una descripción extensa. '.repeat(250)}`,
      language: 'es',
      publisher: 'Z-Man Games',
      publicationYear: 2008,
      playerCountMin: 2,
      playerCountMax: 4,
      recommendedAge: 8,
      playTimeMinutes: 45,
      externalRefs: { boardGameGeekId: 30549, url: `https://example.test/${'x'.repeat(2_000)}` },
      metadata: { source: 'boardgamegeek', notes: '"<&>'.repeat(2_000) },
    },
    resolveFamilyName: async () => null,
    resolveGroupName: async () => null,
    itemTypeSupportsPlayers: () => true,
  });

  assert.ok(summary.length < 3_500, `summary length was ${summary.length}`);
  assert.match(summary, /<b>Nombre:<\/b> Pandemic/);
  assert.match(summary, /<b>Descripción:<\/b> .*…/);
  assert.doesNotMatch(summary, /<(?!\/?b>)/);
});
