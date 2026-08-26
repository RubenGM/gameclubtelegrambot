import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHttpPage, renderNav } from './http-pages.js';

test('renderNav mantiene la navegación pública siempre visible', () => {
  const html = renderNav([{ href: '/actividades', label: 'Actividades' }]);

  assert.match(html, /class="site-nav site-nav-public"/);
  assert.doesNotMatch(html, /<details/);
});

test('renderHttpPage ofrece un menú admin móvil nativo y conserva los enlaces de escritorio', () => {
  const html = renderHttpPage({ title: 'Administración', body: '<p>Panel</p>', shell: 'admin' });

  assert.match(html, /<nav class="site-nav site-nav-admin" aria-label="Administración">/);
  assert.match(html, /<details class="site-nav-mobile">/);
  assert.match(html, /<summary><span>Menú<\/span>/);
  assert.match(html, /class="site-nav-desktop site-nav-links"/);
  assert.equal((html.match(/href="\/admin\/google-calendar"/g) ?? []).length, 2);
  assert.match(html, /@media \(max-width:760px\).*\.site-nav-desktop\{display:none\}/);
});
