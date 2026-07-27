import {radii, spacing, themeFor, themes, typography} from '../src/theme';

describe('mobile design tokens', () => {
  it('keeps the website theme semantics aligned', () => {
    expect(themeFor('colorful').colors).toMatchObject({
      background: '#f7f6f3',
      surface: '#ffffff',
      text: '#1c1a18',
      accent: '#f04b3f',
      accentSoft: '#fff1ed',
    });
    expect(themeFor('white').colors).toMatchObject({
      background: '#ffffff',
      surface: '#ffffff',
      text: '#111111',
      line: '#111111',
      accent: '#111111',
    });
  });

  it('shares spacing, radius and typography scales across both themes', () => {
    expect(themes.colorful.spacing).toBe(spacing);
    expect(themes.white.radii).toBe(radii);
    expect(themes.colorful.typography).toBe(typography);
    expect(spacing.md).toBe(16);
    expect(radii.md).toBe(14);
  });
});
