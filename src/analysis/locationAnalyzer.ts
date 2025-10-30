/**
 * Location Analyzer - Coordination layer for location type colorization
 *
 * **Purpose:** Find all locations in a document for syntax highlighting in the editor.
 *
 * **Not related to visualization:** This is separate from LSPGraphExtractor (which generates
 * Hydroscope visualization JSON). This module is only for editor colorization.
 *
 * **Strategy:**
 * - Tree-sitter finds operator positions
 * - LSP hover queries provide concrete instantiated types (e.g., Process<Leader>)
 * - More accurate than type definitions which may return generics
 *
 * @see TreeSitterRustParser for operator position finding
 * @see lspAnalyzer.ts for LSP hover query implementation
 * @see ARCHITECTURE.md for complete system architecture
 */

import * as vscode from 'vscode';
import { TreeSitterRustParser, VariableBindingNode } from './treeSitterParser';
import { LSPAnalyzer, LocationInfo, CacheStats } from './lspAnalyzer';

/**
 * Simplified operator call information for location colorization
 */
interface OperatorCall {
  /** Operator name (method name) */
  name: string;
  /** Line number (0-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
}

/**
 * Variable binding information for colorization
 */
interface VariableBinding {
  /** Variable name */
  variableName: string;
  /** Line where the variable is declared */
  line: number;
  /** Operators in the assignment chain */
  operators: OperatorCall[];
  /** Usages of this variable (references, arguments, etc.) */
  usages: Array<{ line: number; column: number }>;
}

/**
 * Global instances
 */
let treeSitterParser: TreeSitterRustParser | null = null;
let lspAnalyzer: LSPAnalyzer | null = null;

/**
 * Initialize the analyzer with an output channel
 */
export function initialize(channel?: vscode.OutputChannel): void {
  // Create a channel for tree-sitter if none provided
  const tsChannel =
    channel ||
    ({
      name: 'LocationAnalyzer',
      append: () => {},
      appendLine: () => {},
      replace: () => {},
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
    } as unknown as vscode.OutputChannel);

  treeSitterParser = new TreeSitterRustParser(tsChannel);
  lspAnalyzer = new LSPAnalyzer(channel);
}

/**
 * Analyze a document to find all identifiers with Location types
 *
 * Strategy:
 * 1. Tree-sitter finds all operator positions
 * 2. LSP hover queries provide concrete types (e.g., Process<Leader>)
 * 3. Variables are colorized based on their operator chains
 */
export async function analyzeDocument(document: vscode.TextDocument): Promise<LocationInfo[]> {
  if (!treeSitterParser || !lspAnalyzer) {
    console.error('LocationAnalyzer not initialized');
    return [];
  }

  // Step 1: Use tree-sitter to find all operator positions
  const rawBindings: VariableBindingNode[] = treeSitterParser.parseVariableBindings(document);
  const rawChains = treeSitterParser.parseStandaloneChains(document);

  // Convert to simplified format and collect all positions
  const allPositions: Array<{ position: vscode.Position; operatorName: string }> = [];
  const variableBindings: VariableBinding[] = [];

  // Process variable bindings
  for (const binding of rawBindings) {
    const operators: OperatorCall[] = binding.operators.map((op) => ({
      name: op.name,
      line: op.line,
      column: op.column,
    }));

    variableBindings.push({
      variableName: binding.varName,
      line: binding.line,
      operators,
      usages: binding.usages,
    });

    // Add positions for hover queries
    for (const op of binding.operators) {
      allPositions.push({
        position: new vscode.Position(op.line, op.column),
        operatorName: op.name,
      });
    }
  }

  // Process standalone chains and implicit returns
  for (const chain of rawChains) {
    for (const op of chain) {
      allPositions.push({
        position: new vscode.Position(op.line, op.column),
        operatorName: op.name,
      });
    }
  }

  if (allPositions.length === 0) {
    return [];
  }

  // Step 2: Query hover at each position to get concrete types
  const hoverResults = await lspAnalyzer.analyzePositions(document, allPositions);

  // Step 3: Colorize variables based on their operator chains
  const variableResults = await lspAnalyzer.colorizeVariables(
    document,
    hoverResults,
    variableBindings
  );

  return [...hoverResults, ...variableResults];
}

/**
 * Clear cache (LSP analyzer only)
 */
export function clearCache(uri?: string): void {
  if (lspAnalyzer) {
    lspAnalyzer.clearCache(uri);
  }
}

/**
 * Get cache statistics (LSP analyzer only)
 */
export function getCacheStats(): CacheStats {
  if (lspAnalyzer) {
    return lspAnalyzer.getCacheStats();
  }
  return { hits: 0, misses: 0, numFiles: 0, hitRatePercent: 0 };
}

// Re-export types for compatibility
export type { LocationInfo };
