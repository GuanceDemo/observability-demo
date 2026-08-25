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
      text: '#1c1a18',
      accent: '#f04b3f',
      accentSoft: '#fff1ed',
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
