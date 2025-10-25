/**
 * Configuration for Location Colorizer
 * 
 * Shared constants for colors and styles used by the colorizer.
 * This file is used by both the implementation and tests.
 */

/**
 * Color palette for different location instances
 * Using ColorBrewer Set2 palette for maximum distinction
 */
export const COLOR_PALETTE = [
  'rgba(102, 194, 165, 0.20)', // teal
  'rgba(252, 141, 98, 0.20)',  // coral
  'rgba(141, 160, 203, 0.20)', // lavender
  'rgba(231, 138, 195, 0.20)', // pink
  'rgba(166, 216, 84, 0.20)',  // lime
  'rgba(255, 217, 47, 0.20)',  // yellow
  'rgba(229, 196, 148, 0.20)', // tan
  'rgba(179, 179, 179, 0.20)', // gray
] as const;

/**
 * Border style configuration for different location kinds
 */
export interface BorderStyle {
  borderRadius: string;
  border?: string;
  outline?: string;
}

/**
 * Get border style based on location kind (Process, Cluster, External)
 */
export function getBorderStyle(locationKind: string): BorderStyle {
  if (locationKind.startsWith('Process')) {
    // Process: no border, just background
    return {
      borderRadius: '3px',
    };
  } else if (locationKind.startsWith('Cluster')) {
    // Cluster: double border (darker)
    return {
      borderRadius: '3px',
      border: '2px double rgba(0, 0, 0, 0.4)',
    };
  } else if (locationKind.startsWith('External')) {
    // External: single border (darker)
    return {
      borderRadius: '3px',
      border: '1px solid rgba(0, 0, 0, 0.4)',
    };
  }
  return {
    borderRadius: '3px',
  };
}

/**
 * Get color from palette by index (with wrapping)
 */
export function getColorByIndex(index: number): string {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}
