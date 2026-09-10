export const spacing = Object.freeze({
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
});

export const radii = Object.freeze({
  xs: 7,
  sm: 9,
  md: 14,
  lg: 20,
  pill: 999,
});

export const typography = Object.freeze({
  eyebrow: {fontSize: 11, lineHeight: 16, fontWeight: '800' as const},
  caption: {fontSize: 12, lineHeight: 17, fontWeight: '500' as const},
  body: {fontSize: 14, lineHeight: 21, fontWeight: '400' as const},
  bodyStrong: {fontSize: 14, lineHeight: 21, fontWeight: '800' as const},
  title: {fontSize: 22, lineHeight: 28, fontWeight: '900' as const},
  display: {fontSize: 30, lineHeight: 37, fontWeight: '900' as const},
});

export interface DesignTokens {
  colors: {
    background: string;
    surface: string;
    surfaceSoft: string;
    text: string;
    muted: string;
    line: string;
    accent: string;
    accentEnd: string;
    accentSoft: string;
    orange: string;
    pink: string;
    purple: string;
    success: string;
    danger: string;
    overlay: string;
    onAccent: string;
  };
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
}

const shared = {spacing, radii, typography};

export const storefrontTokens: DesignTokens = Object.freeze({
  ...shared,
  colors: {
    background: '#f7f6f3',
    surface: '#ffffff',
    surfaceSoft: '#fff9f7',
    text: '#24152f',
    muted: '#71666f',
    line: '#e8dfdc',
    accent: '#ff3856',
    accentEnd: '#d730ff',
    accentSoft: '#fff0f5',
    orange: '#ff7a00',
    pink: '#ff3856',
    purple: '#d730ff',
    success: '#12805c',
    danger: '#d92d20',
    overlay: 'rgba(36, 21, 47, 0.48)',
    onAccent: '#ffffff',
  },
});
