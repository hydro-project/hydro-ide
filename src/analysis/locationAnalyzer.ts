/**
 * Location Analyzer - Coordination layer
 *
 * Coordinates between tree-sitter (for operator positioning) and LSP hover analysis
 * (for concrete type information). By default, uses hover-based analysis as the primary
 * strategy since it provides concrete instantiated types rather than generic signatures.
 */

import * as vscode from 'vscode';
import { GraphExtractor, LocationInfo, CacheStats } from './graphExtractor';
import { LSPAnalyzer } from './lspAnalyzer';
import { ScopeTarget } from '../core/types';

/**
 * Global GraphExtractor instance
 */
let graphExtractor: GraphExtractor | null = null;
let lspAnalyzer: LSPAnalyzer | null = null;

/**
 * Initialize the analyzer with an output channel
 */
export function initialize(channel?: vscode.OutputChannel): void {
  graphExtractor = new GraphExtractor(channel);
  lspAnalyzer = new LSPAnalyzer(channel);
}

/**
 * Analyze a document to find all identifiers with Location types
 *
 * Uses two strategies (configurable via hydroIde.analysis.useHoverFirst):
 *
 * 1. Hover-first (default, recommended):
 *    - Tree-sitter finds operator positions
 *    - LSP hover queries provide concrete types (e.g., Process<Leader>)
 *    - Better accuracy for instantiated generic types
 *
 * 2. GraphExtractor-first (legacy):
 *    - LSP type definitions provide types (may return generics like Process<P>)
 *    - Hover used as fallback for unmatched operators
 */
export async function analyzeDocument(document: vscode.TextDocument): Promise<LocationInfo[]> {
  if (!graphExtractor || !lspAnalyzer) {
    console.error('LocationAnalyzer not initialized');
    return [];
  }

  const config = vscode.workspace.getConfiguration('hydroIde');
  const useHoverFirst = config.get<boolean>('analysis.useHoverFirst', true);

  // Use file scope as default
  const scopeTarget: ScopeTarget = {
    type: 'file',
    functions: [],
    workspaceRoot: '',
    activeFilePath: document.fileName,
  };

  if (useHoverFirst) {
    // HOVER-FIRST STRATEGY (default): Use hover-based analysis as primary method
    // Hover provides concrete instantiated types (e.g., Process<Leader>) rather than
    // generic signatures (e.g., Process<P>), leading to more accurate colorization.

    // Step 1: Use tree-sitter to find all operator positions
    const result = await graphExtractor.extractGraph(document, scopeTarget);

    // Collect ALL operator positions from both matched and unmatched
    const allPositions: Array<{ position: vscode.Position; operatorName: string }> = [];

    // Add positions from matched operators
    for (const matched of result.matchedOperators) {
      allPositions.push({
        position: matched.locationInfo.range.start,
        operatorName: matched.locationInfo.operatorName,
      });
    }

    // Add positions from unmatched operators
    for (const op of result.unmatchedTreeSitterOperators) {
      allPositions.push({
        position: new vscode.Position(op.line, op.column),
        operatorName: op.name,
      });
    }

    if (allPositions.length === 0) {
      return [];
    }

    // Step 2: Query hover at each position to get concrete types
    const hoverResults = await lspAnalyzer.analyzePositions(document, allPositions);

    return hoverResults;
  } else {
    // GRAPHEXTRACTOR-FIRST STRATEGY (legacy): Use LSP type definitions first
    // This may return generic types; hover is used as fallback for unmatched operators.
    const result = await graphExtractor.extractGraph(document, scopeTarget);
    const matched = result.matchedOperators.map((m) => m.locationInfo);

    // Use hover analysis for operators that GraphExtractor couldn't type
    if (result.unmatchedTreeSitterOperators.length > 0) {
      const enableFallback = config.get<boolean>('analysis.fallbackToHoverAnalyzer', true);

      if (enableFallback) {
        try {
          const positions = result.unmatchedTreeSitterOperators.map((op) => ({
            position: new vscode.Position(op.line, op.column),
            operatorName: op.name,
          }));

          const hoverResults = await lspAnalyzer.analyzePositions(document, positions);

          if (hoverResults && hoverResults.length > 0) {
            const matchedPositions = new Set(
              matched.map((m) => `${m.range.start.line}:${m.range.start.character}`)
            );

            const additionalResults = hoverResults.filter((h) => {
              const posKey = `${h.range.start.line}:${h.range.start.character}`;
              return !matchedPositions.has(posKey);
            });

            if (additionalResults.length > 0) {
              return [...matched, ...additionalResults];
            }
          }
        } catch (err) {
          // Continue with GraphExtractor results only
        }
      }
    }

    return matched;
  }
}

/**
 * Clear cache
 */
export function clearCache(uri?: string): void {
  if (graphExtractor) {
    graphExtractor.clearCache(uri);
  }
  if (lspAnalyzer) {
    lspAnalyzer.clearCache(uri);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats {
  if (graphExtractor) {
    return graphExtractor.getCacheStats();
  }
  return { hits: 0, misses: 0, numFiles: 0, hitRatePercent: 0 };
}

// Re-export types for compatibility
export type { LocationInfo };
