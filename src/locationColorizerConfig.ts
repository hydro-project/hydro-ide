/**
 * Configuration for Location Colorizer
 * 
 * Shared constants for colors and styles used by the colorizer.
 * This file is used by both the implementation and tests.
 */

/**
 * Color palette for light theme
 * Using ColorBrewer Set2 palette with lower opacity for light backgrounds
 */
export const LIGHT_MODE_PALETTE = [
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
 * Color palette for dark theme
 * Using ColorBrewer Set1 palette with higher saturation for better visibility on dark backgrounds
 */
export const DARK_MODE_PALETTE = [
  'rgba(228, 26, 28, 0.30)',   // red
  'rgba(55, 126, 184, 0.30)',  // blue
  'rgba(77, 175, 74, 0.30)',   // green
  'rgba(152, 78, 163, 0.30)',  // purple
  'rgba(255, 127, 0, 0.30)',   // orange
  'rgba(255, 255, 51, 0.30)',  // yellow
  'rgba(166, 86, 40, 0.30)',   // brown
  'rgba(247, 129, 191, 0.30)', // pink
] as const;

/**
 * Legacy color palette for backwards compatibility
 * Defaults to light mode palette
 */
export const COLOR_PALETTE = LIGHT_MODE_PALETTE;

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
 * Borders are theme-aware: darker for light mode, lighter for dark mode
 */
export function getBorderStyle(locationKind: string, isDarkTheme: boolean = false): BorderStyle {
  // Theme-aware border colors
  const borderColor = isDarkTheme 
    ? 'rgba(200, 200, 200, 0.4)'  // Light gray for dark theme
    : 'rgba(0, 0, 0, 0.4)';        // Dark gray for light theme

  if (locationKind.startsWith('Process')) {
    // Process: no border, just background
    return {
      borderRadius: '3px',
    };
  } else if (locationKind.startsWith('Cluster')) {
    // Cluster: double border
    return {
      borderRadius: '3px',
      border: `2px double ${borderColor}`,
    };
  } else if (locationKind.startsWith('External')) {
    // External: single border
    return {
      borderRadius: '3px',
      border: `1px solid ${borderColor}`,
    };
  }
  return {
    borderRadius: '3px',
  };
}

/**
 * Get color from palette by index (with wrapping)
 * Automatically selects the appropriate palette based on theme
 */
export function getColorByIndex(index: number, isDarkTheme: boolean = false): string {
  const palette = isDarkTheme ? DARK_MODE_PALETTE : LIGHT_MODE_PALETTE;
  return palette[index % palette.length];
}
