/**
 * Location Analyzer - Compatibility facade
 * 
 * Provides backward compatibility with the existing LocationAnalyzer interface
 * while delegating to the new GraphExtractor architecture.
 */

import * as vscode from 'vscode';
import { GraphExtractor, LocationInfo, CacheStats } from './graphExtractor';
import { ScopeTarget } from '../core/types';

/**
 * Global GraphExtractor instance
 */
let graphExtractor: GraphExtractor | null = null;

/**
 * Initialize the analyzer with an output channel
 */
export function initialize(channel?: vscode.OutputChannel): void {
  graphExtractor = new GraphExtractor(channel);
}

/**
 * Analyze a document to find all identifiers with Location types
 * 
 * This is the main compatibility function that existing code expects.
 */
export async function analyzeDocument(document: vscode.TextDocument): Promise<LocationInfo[]> {
  if (!graphExtractor) {
    console.error('LocationAnalyzer not initialized');
    return [];
  }

  // Use file scope as default
  const scopeTarget: ScopeTarget = {
    type: 'file',
    functions: [],
    workspaceRoot: '',
    activeFilePath: document.fileName,
  };

  const result = await graphExtractor.extractGraph(document, scopeTarget);
  
  // Return just the location info for compatibility
  return result.matchedOperators.map(matched => matched.locationInfo);
}

/**
 * Clear cache
 */
export function clearCache(uri?: string): void {
  if (graphExtractor) {
    graphExtractor.clearCache(uri);
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