import {
  radii,
  spacing,
  storefrontTokens,
  typography,
} from '../src/designTokens';

describe('mobile design tokens', () => {
  it('keeps the colorful website appearance aligned', () => {
    expect(storefrontTokens.colors).toMatchObject({
      background: '#f7f6f3',
      surface: '#ffffff',
      text: '#24152f',
      accent: '#ff3856',
      accentSoft: '#fff0f5',
      orange: '#ff7a00',
      purple: '#d730ff',
    });
  });

  it('uses the shared spacing, radius and typography scales', () => {
    expect(storefrontTokens.spacing).toBe(spacing);
    expect(storefrontTokens.radii).toBe(radii);
    expect(storefrontTokens.typography).toBe(typography);
    expect(spacing.md).toBe(16);
    expect(radii.md).toBe(14);
  });
});
