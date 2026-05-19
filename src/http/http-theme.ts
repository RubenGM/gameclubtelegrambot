export type HttpThemeName = 'classic' | 'club-dark' | 'tabletop' | 'high-contrast';

interface HttpTheme {
  name: HttpThemeName;
  label: string;
  tokens: {
    background: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    mutedText: string;
    border: string;
    brand: string;
    brandHover: string;
    action: string;
    danger: string;
    focusRing: string;
  };
}

const httpThemes: Record<HttpThemeName, HttpTheme> = {
  classic: {
    name: 'classic',
    label: 'Classic',
    tokens: {
      background: '#f6f7f4',
      surface: '#ffffff',
      surfaceAlt: '#eef2ec',
      text: '#222222',
      mutedText: '#6a6a6a',
      border: '#dedede',
      brand: '#184b1f',
      brandHover: '#123918',
      action: '#0041d4',
      danger: '#b42318',
      focusRing: '#9e8c18',
    },
  },
  'club-dark': {
    name: 'club-dark',
    label: 'Club dark',
    tokens: {
      background: '#111411',
      surface: '#1a1a1a',
      surfaceAlt: '#202820',
      text: '#f5f7f2',
      mutedText: '#c5c9c1',
      border: '#364136',
      brand: '#65a36d',
      brandHover: '#7dbb84',
      action: '#7ca7ff',
      danger: '#ff8a80',
      focusRing: '#d2c15a',
    },
  },
  tabletop: {
    name: 'tabletop',
    label: 'Tabletop',
    tokens: {
      background: '#f7f4eb',
      surface: '#fffdf7',
      surfaceAlt: '#eee7d7',
      text: '#2a251d',
      mutedText: '#6e665a',
      border: '#d9cfbd',
      brand: '#184b1f',
      brandHover: '#123918',
      action: '#0041d4',
      danger: '#b42318',
      focusRing: '#9e8c18',
    },
  },
  'high-contrast': {
    name: 'high-contrast',
    label: 'High contrast',
    tokens: {
      background: '#ffffff',
      surface: '#ffffff',
      surfaceAlt: '#f1f1f1',
      text: '#000000',
      mutedText: '#333333',
      border: '#000000',
      brand: '#0f3d16',
      brandHover: '#09270e',
      action: '#0036b3',
      danger: '#8f130c',
      focusRing: '#ffbf00',
    },
  },
};

export const defaultHttpThemeName: HttpThemeName = 'classic';

export function listHttpThemes(): HttpTheme[] {
  return Object.values(httpThemes);
}

export function resolveHttpTheme(themeName: string | null | undefined): HttpTheme {
  if (themeName && isHttpThemeName(themeName)) {
    return httpThemes[themeName];
  }

  return httpThemes[defaultHttpThemeName];
}

export function renderHttpThemeCss(themeName: string | null | undefined = defaultHttpThemeName): string {
  const theme = resolveHttpTheme(themeName);

  return `:root{--cawa-background:${theme.tokens.background};--cawa-surface:${theme.tokens.surface};--cawa-surface-alt:${theme.tokens.surfaceAlt};--cawa-text:${theme.tokens.text};--cawa-muted:${theme.tokens.mutedText};--cawa-line:${theme.tokens.border};--cawa-brand:${theme.tokens.brand};--cawa-brand-hover:${theme.tokens.brandHover};--cawa-action:${theme.tokens.action};--cawa-danger:${theme.tokens.danger};--cawa-focus-ring:${theme.tokens.focusRing};--cawa-gold:#c8a828;--cawa-gold-soft:color-mix(in srgb,var(--cawa-gold) 18%,transparent);--cawa-brand-soft:color-mix(in srgb,var(--cawa-brand) 12%,transparent);--cawa-shadow:0 14px 40px color-mix(in srgb,var(--cawa-text) 14%,transparent);--font-heading:"Aptos Display","Trebuchet MS",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--font-body:"Atkinson Hyperlegible","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,sans-serif;--font-ui:"Aptos","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,sans-serif}`;
}

function isHttpThemeName(value: string): value is HttpThemeName {
  return Object.hasOwn(httpThemes, value);
}
