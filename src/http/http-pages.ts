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
}

const defaultNavItems: PageNavItem[] = [
  { href: '/', label: 'Inicio' },
  { href: '/feedback', label: 'Feedback' },
  { href: '/admin', label: 'Admin' },
  { href: '/admin/resources', label: 'Recursos' },
];

export function renderHttpPage({
  title,
  body,
  navItems = defaultNavItems,
  themeName = defaultHttpThemeName,
  shell = 'public',
}: RenderHttpPageOptions): string {
  const theme = resolveHttpTheme(themeName);
  return `<!doctype html><html lang="ca" data-theme="${escapeHtml(theme.name)}" data-shell="${escapeHtml(shell)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${renderHttpThemeCss(theme.name)}${baseCss()}</style></head><body><header class="site-header"><a class="brand" href="/">CAWA Girona</a>${renderNav(navItems)}</header><main class="page-shell"><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

export function renderNav(items: PageNavItem[]): string {
  return `<nav aria-label="Principal">${items.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('')}</nav>`;
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
  return `*{box-sizing:border-box}body{font-family:var(--font-body);max-width:1120px;margin:32px auto;padding:0 16px;line-height:1.45;background:var(--cawa-background);color:var(--cawa-text)}.site-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px;border-bottom:1px solid var(--cawa-line);padding-bottom:16px}.brand{font-family:var(--font-heading);font-weight:700;color:var(--cawa-brand);text-decoration:none}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:var(--cawa-brand)}a:hover{color:var(--cawa-brand-hover)}h1,h2,h3{font-family:var(--font-heading);color:var(--cawa-ink,var(--cawa-text));line-height:1.15}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;padding:8px;margin:4px 0 12px;background:var(--cawa-surface);color:var(--cawa-text);border:1px solid var(--cawa-line)}textarea{min-height:140px}button{padding:8px 12px;border:1px solid var(--cawa-brand);background:var(--cawa-brand);color:#fff;cursor:pointer}button:hover{background:var(--cawa-brand-hover);border-color:var(--cawa-brand-hover)}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--cawa-focus-ring);outline-offset:2px}table{border-collapse:collapse;width:100%;font-size:14px;background:var(--cawa-surface)}th,td{border-bottom:1px solid var(--cawa-line);padding:6px;text-align:left;vertical-align:top}section{border-top:1px solid var(--cawa-line);padding-top:16px;margin-top:16px}.row{display:flex;gap:8px;flex-wrap:wrap}.inline{display:inline}pre{white-space:pre-wrap;background:var(--cawa-surface-alt);padding:12px;overflow:auto}`;
}
