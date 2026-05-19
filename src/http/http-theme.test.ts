import test from 'node:test';
import assert from 'node:assert/strict';

import { listHttpThemes, resolveHttpTheme, renderHttpThemeCss } from './http-theme.js';

test('resolveHttpTheme returns the CAWA classic theme by default', () => {
  const theme = resolveHttpTheme(undefined);

  assert.equal(theme.name, 'classic');
  assert.equal(theme.tokens.brand, '#184b1f');
});

test('resolveHttpTheme only accepts allowlisted theme names', () => {
  assert.equal(resolveHttpTheme('club-dark').name, 'club-dark');
  assert.equal(resolveHttpTheme('../secret.css').name, 'classic');
  assert.equal(resolveHttpTheme('unknown').name, 'classic');
});

test('renderHttpThemeCss emits required CAWA design tokens for every theme', () => {
  for (const theme of listHttpThemes()) {
    const css = renderHttpThemeCss(theme.name);

    assert.match(css, /--cawa-background:/);
    assert.match(css, /--cawa-surface:/);
    assert.match(css, /--cawa-text:/);
    assert.match(css, /--cawa-muted:/);
    assert.match(css, /--cawa-line:/);
    assert.match(css, /--cawa-brand:/);
    assert.match(css, /--cawa-brand-hover:/);
    assert.match(css, /--cawa-action:/);
    assert.match(css, /--cawa-danger:/);
    assert.match(css, /--cawa-focus-ring:/);
  }
});
