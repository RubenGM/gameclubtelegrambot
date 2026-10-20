import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHttpPage, renderNav } from './http-pages.js';

test('pages declare Spanish by default and retain the explicit language of Catalan and English content', () => {
  assert.match(renderHttpPage({ title: 'Actividades', body: '<p>Consulta las actividades.</p>' }), /<html lang="es"/);
  for (const language of ['ca', 'en'] as const) {
    assert.match(renderHttpPage({ title: 'Club', body: '<p>Club</p>', language }), new RegExp(`<html lang="${language}"`));
  }
});

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
