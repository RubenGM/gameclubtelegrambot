import { defaultHttpThemeName, renderHttpThemeCss, resolveHttpTheme } from './http-theme.js';

export interface PageNavItem {
  href: string;
  label: string;
}

export interface RenderHttpPageOptions {
  title: string;
  body: string;
  navItems?: PageNavItem[];
  themeName?: string | null;
  shell?: 'public' | 'admin';
  headerBrandName?: string;
  headerLogoAsset?: string | null;
  faviconAsset?: string | null;
}

const defaultBrandLogoAsset = '/brand/cawa_logo.svg';
const defaultFaviconAsset = '/brand/cawa_casco.svg';

const publicNavItems: PageNavItem[] = [
  { href: '/', label: 'Inicio' },
  { href: '/actividades', label: 'Actividades' },
  { href: '/catalogo', label: 'Catalogo' },
  { href: '/club', label: 'Club' },
  { href: '/alta', label: 'Alta socio' },
  { href: '/feedback', label: 'Feedback' },
  { href: '/admin', label: 'Admin' },
];

const adminNavItems: PageNavItem[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/web', label: 'Web publica' },
  { href: '/admin/activities', label: 'Actividades' },
  { href: '/admin/catalog', label: 'Catalogo' },
  { href: '/admin/users', label: 'Socios' },
  { href: '/admin/feedback', label: 'Feedback' },
  { href: '/admin/member-signups', label: 'Altas' },
  { href: '/admin/news', label: 'Noticias' },
  { href: '/admin/backups', label: 'Backups' },
  { href: '/admin/service', label: 'Servicio y logs' },
  { href: '/admin/config', label: 'Config tecnica' },
  { href: '/admin/resources', label: 'Recursos' },
  { href: '/', label: 'Ver web' },
];

export function renderHttpPage({
  title,
  body,
  navItems,
  themeName = defaultHttpThemeName,
  shell = 'public',
  headerBrandName = 'CAWA Girona',
  headerLogoAsset = null,
  faviconAsset = defaultFaviconAsset,
}: RenderHttpPageOptions): string {
  const theme = resolveHttpTheme(themeName);
  const resolvedNavItems = navItems ?? (shell === 'admin' ? adminNavItems : publicNavItems);
  const favicon = faviconAsset ? `<link rel="icon" href="${escapeHtml(faviconAsset)}" type="image/svg+xml">` : '';
  return `<!doctype html><html lang="ca" data-theme="${escapeHtml(theme.name)}" data-shell="${escapeHtml(shell)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${favicon}<title>${escapeHtml(title)}</title><style>${renderHttpThemeCss(theme.name)}${baseCss()}</style></head><body><header class="site-header">${renderBrand(headerBrandName, headerLogoAsset ?? defaultBrandLogoAsset)}${renderNav(resolvedNavItems)}</header><main class="page-shell"><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

export function renderNav(items: PageNavItem[]): string {
  return `<nav aria-label="Principal">${items.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('')}</nav>`;
}

function renderBrand(label: string, logoAsset: string | null): string {
  const logo = logoAsset ? `<img class="brand-logo" src="${escapeHtml(logoAsset)}" alt="" loading="lazy">` : '';
  return `<a class="brand" href="/">${logo}<span>${escapeHtml(label)}</span></a>`;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function baseCss(): string {
  return `*{box-sizing:border-box}html{background:var(--cawa-background)}body{font-family:var(--font-body);margin:0;min-height:100vh;line-height:1.52;background:radial-gradient(ellipse at 20% -10%,var(--cawa-gold-soft),transparent 34rem),linear-gradient(135deg,var(--cawa-brand-soft),transparent 24rem),var(--cawa-background);color:var(--cawa-text)}body:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(90deg,color-mix(in srgb,var(--cawa-line) 45%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--cawa-line) 35%,transparent) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,black,transparent 72%);opacity:.22}.site-header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:18px;max-width:1180px;margin:0 auto 34px;padding:14px 18px;border:1px solid color-mix(in srgb,var(--cawa-line) 78%,transparent);border-top:0;background:color-mix(in srgb,var(--cawa-surface) 90%,transparent);box-shadow:0 10px 28px color-mix(in srgb,var(--cawa-text) 10%,transparent);backdrop-filter:blur(14px)}.brand{display:inline-flex;align-items:center;gap:12px;min-width:max-content;font-family:var(--font-heading);font-weight:800;color:var(--cawa-brand);text-decoration:none}.brand span{font-size:18px}.brand-logo{width:48px;height:48px;object-fit:contain;border-radius:8px;padding:3px;background:linear-gradient(145deg,var(--cawa-surface),var(--cawa-surface-alt));box-shadow:inset 0 0 0 1px var(--cawa-line)}nav{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}nav a{display:inline-flex;align-items:center;min-height:34px;padding:7px 10px;border:1px solid transparent;border-radius:8px;color:var(--cawa-text);text-decoration:none;font-family:var(--font-ui);font-size:14px}nav a:hover{border-color:var(--cawa-line);background:var(--cawa-surface-alt);color:var(--cawa-brand)}a{color:var(--cawa-brand);text-underline-offset:3px}a:hover{color:var(--cawa-brand-hover)}.page-shell{max-width:1120px;margin:0 auto 56px;padding:0 18px}.page-shell>h1{position:relative;margin:0 0 24px;font-family:var(--font-heading);font-size:42px;line-height:1.05;color:var(--cawa-text)}.page-shell>h1:after{content:"";display:block;width:88px;height:5px;margin-top:14px;border-radius:8px;background:linear-gradient(90deg,var(--cawa-brand),var(--cawa-gold))}h2,h3{font-family:var(--font-heading);color:var(--cawa-text);line-height:1.18}h2{font-size:22px;margin:0 0 10px}h3{font-size:17px}p{max-width:76ch}small,.muted{color:var(--cawa-muted)}input,textarea,select,button{font:inherit}label{display:block;font-family:var(--font-ui);font-weight:650;color:var(--cawa-text)}input,textarea,select{width:100%;padding:10px 11px;margin:6px 0 14px;background:var(--cawa-surface);color:var(--cawa-text);border:1px solid var(--cawa-line);border-radius:8px;box-shadow:inset 0 1px 0 color-mix(in srgb,var(--cawa-surface-alt) 80%,transparent)}input[type=checkbox]{width:auto;margin-right:8px}textarea{min-height:140px;resize:vertical}button{min-height:38px;padding:9px 13px;border:1px solid var(--cawa-brand);border-radius:8px;background:linear-gradient(180deg,var(--cawa-brand),var(--cawa-brand-hover));color:#fff;cursor:pointer;font-family:var(--font-ui);font-weight:750;box-shadow:0 8px 18px color-mix(in srgb,var(--cawa-brand) 20%,transparent)}button:hover{filter:saturate(1.08) brightness(1.04)}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--cawa-focus-ring);outline-offset:2px}table{border-collapse:separate;border-spacing:0;width:100%;font-size:14px;background:var(--cawa-surface);border:1px solid var(--cawa-line);border-radius:8px;overflow:hidden;box-shadow:0 8px 24px color-mix(in srgb,var(--cawa-text) 7%,transparent)}th,td{border-bottom:1px solid var(--cawa-line);padding:10px 11px;text-align:left;vertical-align:top}th{background:var(--cawa-surface-alt);font-family:var(--font-ui);font-size:12px;text-transform:uppercase;color:var(--cawa-muted)}tr:last-child td{border-bottom:0}tbody tr:hover td{background:color-mix(in srgb,var(--cawa-surface-alt) 45%,transparent)}section{border-top:1px solid var(--cawa-line);padding-top:20px;margin-top:22px}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.inline{display:inline}.hero-image{display:block;width:100%;max-height:410px;object-fit:cover;border-radius:8px;margin:0 0 24px;border:1px solid var(--cawa-line);box-shadow:var(--cawa-shadow)}html[data-shell=public] .page-shell>p:first-of-type{font-size:19px;line-height:1.45}html[data-shell=public] .featured-links{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:26px 0}.featured-links a{position:relative;display:block;min-height:82px;padding:16px 42px 16px 16px;border:1px solid var(--cawa-line);background:linear-gradient(145deg,var(--cawa-surface),var(--cawa-surface-alt));border-radius:8px;text-decoration:none;font-family:var(--font-heading);font-weight:800;box-shadow:0 10px 24px color-mix(in srgb,var(--cawa-text) 8%,transparent)}.featured-links a:after{content:"";position:absolute;right:16px;top:50%;width:10px;height:10px;border-right:2px solid currentColor;border-top:2px solid currentColor;transform:translateY(-50%) rotate(45deg)}.featured-links a:hover{transform:translateY(-2px);box-shadow:var(--cawa-shadow)}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:22px}.gallery img,.asset-preview{display:block;width:100%;max-height:230px;object-fit:cover;border-radius:8px;border:1px solid var(--cawa-line);box-shadow:0 8px 20px color-mix(in srgb,var(--cawa-text) 8%,transparent)}.asset-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.asset-grid>section,.asset-panel{border:1px solid var(--cawa-line);background:linear-gradient(180deg,var(--cawa-surface),color-mix(in srgb,var(--cawa-surface-alt) 54%,var(--cawa-surface)));border-radius:8px;padding:16px;box-shadow:0 8px 22px color-mix(in srgb,var(--cawa-text) 7%,transparent)}.asset-grid>section{margin:0}.asset-grid>section h2{font-size:14px;color:var(--cawa-muted);text-transform:uppercase}.asset-grid>section p{font-family:var(--font-heading);font-size:24px;font-weight:800;margin:0;color:var(--cawa-brand)}form.search-form{display:grid;grid-template-columns:minmax(220px,1fr) minmax(160px,240px) auto;gap:12px;align-items:end;padding:14px;border:1px solid var(--cawa-line);border-radius:8px;background:var(--cawa-surface)}pre{white-space:pre-wrap;background:var(--cawa-surface-alt);border:1px solid var(--cawa-line);border-radius:8px;padding:14px;overflow:auto}html[data-shell=admin] body{background:linear-gradient(180deg,var(--cawa-background),color-mix(in srgb,var(--cawa-surface-alt) 55%,var(--cawa-background)))}html[data-shell=admin] .page-shell>h1{font-size:34px}html[data-shell=admin] section{margin-top:18px;padding-top:18px}@media (max-width:760px){.site-header{position:static;display:block;margin-bottom:24px}.brand{margin-bottom:12px}nav{justify-content:flex-start}.page-shell>h1{font-size:32px}form.search-form{grid-template-columns:1fr}.asset-grid{grid-template-columns:1fr}table{display:block;overflow-x:auto}}`;
}
