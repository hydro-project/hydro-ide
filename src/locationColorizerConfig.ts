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
 * Using ColorBrewer Set2 palette with higher opacity and adjusted colors for dark backgrounds
 */
export const DARK_MODE_PALETTE = [
  'rgba(102, 194, 165, 0.25)', // teal - slightly more opaque
  'rgba(252, 141, 98, 0.25)',  // coral
  'rgba(141, 160, 203, 0.25)', // lavender
  'rgba(231, 138, 195, 0.25)', // pink
  'rgba(166, 216, 84, 0.25)',  // lime
  'rgba(255, 217, 47, 0.25)',  // yellow
  'rgba(229, 196, 148, 0.25)', // tan
  'rgba(200, 200, 200, 0.25)', // lighter gray for dark mode
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
