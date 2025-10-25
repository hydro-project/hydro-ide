/**
 * Location Colorizer
 *
 * Applies color decorations to Hydro operators based on their Location type.
 */

import * as vscode from 'vscode';
import * as locationAnalyzer from './locationAnalyzer';
import { getBorderStyle, getColorByIndex } from './locationColorizerConfig';

/**
 * Check if the current theme is dark
 */
function isDarkTheme(): boolean {
  const theme = vscode.window.activeColorTheme;
  return theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
}

/**
 * Output channel for logging
 */
let outputChannel: vscode.OutputChannel | null = null;

/**
 * Decoration types mapped by full location type (e.g., "Process<Leader>")
 */
const decorationTypesByLocation = new Map<string, vscode.TextEditorDecorationType>();

/**
 * Initialize decoration types and output channel
 */
export function initializeDecorationTypes(channel?: vscode.OutputChannel): void {
  // Set output channel if provided
  if (channel) {
    outputChannel = channel;
    locationAnalyzer.initialize(channel);
  }

  // Clear existing decorations
  decorationTypesByLocation.forEach((d) => d.dispose());
  decorationTypesByLocation.clear();
}

/**
 * Get or create a decoration type for a specific location
 * Theme-aware: uses appropriate colors and borders for light/dark themes
 */
function getDecorationForLocation(
  locationKind: string,
  colorIndex: number
): vscode.TextEditorDecorationType {
  if (!decorationTypesByLocation.has(locationKind)) {
    const isDark = isDarkTheme();
    const borderStyle = getBorderStyle(locationKind, isDark);
    const decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: getColorByIndex(colorIndex, isDark),
      ...borderStyle,
    });
    decorationTypesByLocation.set(locationKind, decorationType);
  }
  return decorationTypesByLocation.get(locationKind)!;
}

/**
 * Log message to output channel
 */
function log(message: string): void {
  if (outputChannel) {
    outputChannel.appendLine(`[LocationColorizer] ${message}`);
  }
}

/**
 * Apply decorations to the editor
 */
function applyDecorations(
  editor: vscode.TextEditor,
  locationInfos: locationAnalyzer.LocationInfo[]
): void {
  // Clear existing decorations
  decorationTypesByLocation.forEach((d) => editor.setDecorations(d, []));

  // Group ranges by location kind and assign colors
  const rangesByLocation = new Map<string, vscode.Range[]>();
  const locationToColorIndex = new Map<string, number>();
  let nextColorIndex = 0;

  for (const info of locationInfos) {
    if (!rangesByLocation.has(info.locationKind)) {
      rangesByLocation.set(info.locationKind, []);
      locationToColorIndex.set(info.locationKind, nextColorIndex++);
    }
    rangesByLocation.get(info.locationKind)!.push(info.range);
  }

  // Apply decorations for each location kind with its assigned color
  rangesByLocation.forEach((ranges, locationKind) => {
    const colorIndex = locationToColorIndex.get(locationKind)!;
    const decorationType = getDecorationForLocation(locationKind, colorIndex);
    editor.setDecorations(decorationType, ranges);
  });
}

/**
 * Colorize all Hydro operators in the entire file by their Location type
 */
export async function colorizeFile(editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;

  // Show status immediately
  vscode.window.setStatusBarMessage('$(sync~spin) Colorizing locations...', 10000);

  try {
    // Don't show output channel - user can open it manually if needed
    
    log(`========================================`);
    log(`Colorizing file: ${document.fileName}`);

    // Analyze the document to find all Location-typed identifiers
    const locationInfos = await locationAnalyzer.analyzeDocument(document);

    if (locationInfos.length === 0) {
      log('No Hydro operators with Location types found.');
      log(`========================================`);
      return;
    }

    // Apply decorations
    applyDecorations(editor, locationInfos);

    // Show summary
    const locationCounts = new Map<string, number>();
    locationInfos.forEach((info) => {
      locationCounts.set(info.locationKind, (locationCounts.get(info.locationKind) || 0) + 1);
    });

    const summary = Array.from(locationCounts.entries())
      .map(([loc, count]) => `${loc}: ${count}`)
      .join(', ');

    log(`Colorized ${locationInfos.length} identifiers: ${summary}`);
    log(`========================================`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`ERROR during colorization: ${errorMsg}`);
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`);
    }
    log(`========================================`);
  }
}

/**
 * Clear all location colorizations
 */
export function clearColorizations(editor: vscode.TextEditor): void {
  decorationTypesByLocation.forEach((d) => editor.setDecorations(d, []));
}

/**
 * Clear all decoration types (useful when theme changes)
 */
export function clearDecorationTypes(): void {
  decorationTypesByLocation.forEach((d) => d.dispose());
  decorationTypesByLocation.clear();
}

/**
 * Clear the type cache (useful when rust-analyzer reanalyzes)
 * Optionally clear cache for a specific file only
 */
export function clearCache(fileUri?: string): void {
  locationAnalyzer.clearCache(fileUri);
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats() {
  return locationAnalyzer.getCacheStats();
}

/**
 * Dispose all decoration types
 */
export function dispose(): void {
  decorationTypesByLocation.forEach((d) => d.dispose());
  decorationTypesByLocation.clear();
  locationAnalyzer.clearCache();
}
