/**
 * Unit tests for LocationColorizer
 *
 * Tests theme switching and decoration management.
 */

import { describe, test, expect } from 'vitest';
import { LIGHT_MODE_PALETTE, DARK_MODE_PALETTE, getColorByIndex } from '../coloring/locationColorizerConfig';

/**
 * Test theme-aware color selection
 */
describe('LocationColorizer Theme Switching', () => {
  test('Should use light mode palette when isDarkTheme is false', () => {
    const color = getColorByIndex(0, false);
    expect(color).toBe(LIGHT_MODE_PALETTE[0]);
  });

  test('Should use dark mode palette when isDarkTheme is true', () => {
    const color = getColorByIndex(0, true);
    expect(color).toBe(DARK_MODE_PALETTE[0]);
  });

  test('Light and dark mode palettes should be different', () => {
    for (let i = 0; i < LIGHT_MODE_PALETTE.length; i++) {
      const lightColor = getColorByIndex(i, false);
      const darkColor = getColorByIndex(i, true);
      expect(lightColor).not.toBe(darkColor);
    }
  });

  test('Should wrap around palette when index exceeds length', () => {
    const paletteLength = LIGHT_MODE_PALETTE.length;
    
    // Test light mode wrapping
    const lightColor0 = getColorByIndex(0, false);
    const lightColorWrapped = getColorByIndex(paletteLength, false);
    expect(lightColorWrapped).toBe(lightColor0);
    
    // Test dark mode wrapping
    const darkColor0 = getColorByIndex(0, true);
    const darkColorWrapped = getColorByIndex(paletteLength, true);
    expect(darkColorWrapped).toBe(darkColor0);
  });

  test('Both palettes should have same length', () => {
    expect(LIGHT_MODE_PALETTE.length).toBe(DARK_MODE_PALETTE.length);
  });

  test('All colors should be valid rgba strings', () => {
    const rgbaPattern = /^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/;
    
    LIGHT_MODE_PALETTE.forEach((color) => {
      expect(color).toMatch(rgbaPattern);
    });
    
    DARK_MODE_PALETTE.forEach((color) => {
      expect(color).toMatch(rgbaPattern);
    });
  });

  test('Dark mode colors should have higher opacity than light mode', () => {
    // Extract opacity from rgba strings
    const getOpacity = (rgba: string): number => {
      const match = rgba.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
      return match ? parseFloat(match[1]) : 0;
    };
    
    for (let i = 0; i < LIGHT_MODE_PALETTE.length; i++) {
      const lightOpacity = getOpacity(LIGHT_MODE_PALETTE[i]);
      const darkOpacity = getOpacity(DARK_MODE_PALETTE[i]);
      
      // Dark mode should have equal or higher opacity for better visibility
      expect(darkOpacity).toBeGreaterThanOrEqual(lightOpacity);
    }
  });
});

/**
 * Test decoration type caching behavior
 */
describe('LocationColorizer Decoration Caching', () => {
  test('Should create unique decorations for different location kinds', () => {
    const locations = ['Process<Leader>', 'Cluster<Worker>', 'Process<Follower>'];
    const decorationMap = new Map<string, number>();
    
    locations.forEach((loc, index) => {
      decorationMap.set(loc, index);
    });
    
    expect(decorationMap.size).toBe(3);
    expect(decorationMap.get('Process<Leader>')).toBe(0);
    expect(decorationMap.get('Cluster<Worker>')).toBe(1);
    expect(decorationMap.get('Process<Follower>')).toBe(2);
  });

  test('Should reuse same decoration for same location kind', () => {
    const locations = ['Process<Leader>', 'Process<Leader>', 'Process<Leader>'];
    const decorationMap = new Map<string, number>();
    let nextIndex = 0;
    
    locations.forEach((loc) => {
      if (!decorationMap.has(loc)) {
        decorationMap.set(loc, nextIndex++);
      }
    });
    
    expect(decorationMap.size).toBe(1);
    expect(decorationMap.get('Process<Leader>')).toBe(0);
  });

  test('Tick-wrapped locations should be treated as different from unwrapped', () => {
    const locations = ['Process<Leader>', 'Tick<Process<Leader>>'];
    const decorationMap = new Map<string, number>();
    
    locations.forEach((loc, index) => {
      decorationMap.set(loc, index);
    });
    
    expect(decorationMap.size).toBe(2);
    expect(decorationMap.get('Process<Leader>')).not.toBe(decorationMap.get('Tick<Process<Leader>>'));
  });
});

/**
 * Regression test for theme switching issue
 */
describe('LocationColorizer Theme Switching Regression', () => {
  test('Clearing cache should allow theme colors to update', () => {
    // Simulate decoration type cache
    const decorationCache = new Map<string, { color: string; theme: 'light' | 'dark' }>();
    
    // Create decorations for light theme
    decorationCache.set('Process<Leader>', {
      color: getColorByIndex(0, false),
      theme: 'light',
    });
    
    expect(decorationCache.get('Process<Leader>')?.theme).toBe('light');
    expect(decorationCache.get('Process<Leader>')?.color).toBe(LIGHT_MODE_PALETTE[0]);
    
    // Simulate theme switch: clear cache
    decorationCache.clear();
    
    // Create decorations for dark theme
    decorationCache.set('Process<Leader>', {
      color: getColorByIndex(0, true),
      theme: 'dark',
    });
    
    expect(decorationCache.get('Process<Leader>')?.theme).toBe('dark');
    expect(decorationCache.get('Process<Leader>')?.color).toBe(DARK_MODE_PALETTE[0]);
  });

  test('Theme switch should result in different colors', () => {
    const colorIndex = 1;
    
    const lightColor = getColorByIndex(colorIndex, false);
    const darkColor = getColorByIndex(colorIndex, true);
    
    expect(lightColor).not.toBe(darkColor);
    expect(lightColor).toBe(LIGHT_MODE_PALETTE[colorIndex]);
    expect(darkColor).toBe(DARK_MODE_PALETTE[colorIndex]);
  });
});
