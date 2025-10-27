/**
 * Graph Extractor - Coordination layer
 * 
 * Coordinates between TreeSitterAnalyzer and LSPAnalyzer to build graphs:
 * - Matches operators from both sources
 * - Filters to valid dataflow operators
 * - Builds final graph structure
 * - Handles coordinate reconciliation
 */

import * as vscode from 'vscode';
import { TreeSitterAnalyzer, OperatorCall } from './treeSitterAnalyzer';
import { LSPAnalyzer, LocationInfo, CacheStats } from './lspAnalyzer';
import { ScopeTarget } from '../core/types';

/**
 * Matched operator with both syntactic and semantic information
 */
export interface MatchedOperator {
  /** Operator call info from tree-sitter */
  operatorCall: OperatorCall;
  /** Location info from LSP */
  locationInfo: LocationInfo;
}

/**
 * Graph extraction results
 */
export interface GraphExtractionResult {
  /** Successfully matched operators */
  matchedOperators: MatchedOperator[];
  /** Operators found by tree-sitter but not matched with LSP */
  unmatchedTreeSitterOperators: OperatorCall[];
  /** Identifiers found by LSP but not matched with tree-sitter */
  unmatchedLSPIdentifiers: LocationInfo[];
}

/**
 * Coordinates between tree-sitter and LSP analysis to extract graph information
 */
export class GraphExtractor {
  private treeSitterAnalyzer: TreeSitterAnalyzer;
  private lspAnalyzer: LSPAnalyzer;
  private outputChannel: vscode.OutputChannel | null = null;

  constructor(outputChannel?: vscode.OutputChannel) {
    this.outputChannel = outputChannel || null;
    this.treeSitterAnalyzer = new TreeSitterAnalyzer(outputChannel);
    this.lspAnalyzer = new LSPAnalyzer(outputChannel);
  }

  /**
   * Log message to output channel
   */
  private log(message: string): void {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[GraphExtractor] ${message}`);
    }
  }

  /**
   * Extract graph information by coordinating tree-sitter and LSP analysis
   */
  public async extractGraph(
    document: vscode.TextDocument,
    scopeTarget: ScopeTarget
  ): Promise<GraphExtractionResult> {
    this.log(`Extracting graph for ${document.fileName}`);

    // Run both analyses in parallel
    const [treeSitterResult, lspLocations] = await Promise.all([
      this.treeSitterAnalyzer.analyzeDocument(document),
      this.lspAnalyzer.analyzeDocument(document),
    ]);

    this.log(`Tree-sitter found ${treeSitterResult.allOperatorCalls.length} operator calls`);
    this.log(`LSP found ${lspLocations.length} location-typed identifiers`);

    // Filter LSP results to scope
    const scopedLSPLocations = this.filterToScope(lspLocations, scopeTarget, document);
    this.log(`Filtered to ${scopedLSPLocations.length} identifiers in scope`);

    // Match operators between tree-sitter and LSP results
    const matchResult = this.matchOperators(treeSitterResult.allOperatorCalls, scopedLSPLocations);
    
    this.log(`Matched ${matchResult.matchedOperators.length} operators`);
    this.log(`${matchResult.unmatchedTreeSitterOperators.length} tree-sitter operators unmatched`);
    this.log(`${matchResult.unmatchedLSPIdentifiers.length} LSP identifiers unmatched`);

    // Filter to only valid dataflow operators
    const validOperators = matchResult.matchedOperators.filter(matched => {
      const returnType = matched.locationInfo.fullReturnType || matched.locationInfo.locationType;
      
      if (returnType && !this.isValidDataflowOperator(matched.operatorCall.name, returnType)) {
        this.log(`Filtered out ${matched.operatorCall.name} - not a dataflow operator (return type: ${returnType})`);
        return false;
      }

      return true;
    });

    this.log(`Filtered to ${validOperators.length} valid dataflow operators`);

    return {
      matchedOperators: validOperators,
      unmatchedTreeSitterOperators: matchResult.unmatchedTreeSitterOperators,
      unmatchedLSPIdentifiers: matchResult.unmatchedLSPIdentifiers,
    };
  }

  /**
   * Match operators between tree-sitter and LSP results
   */
  private matchOperators(
    operatorCalls: OperatorCall[],
    lspLocations: LocationInfo[]
  ): {
    matchedOperators: MatchedOperator[];
    unmatchedTreeSitterOperators: OperatorCall[];
    unmatchedLSPIdentifiers: LocationInfo[];
  } {
    const matchedOperators: MatchedOperator[] = [];
    const unmatchedTreeSitterOperators: OperatorCall[] = [];
    const unmatchedLSPIdentifiers: LocationInfo[] = [...lspLocations];

    for (const operatorCall of operatorCalls) {
      // Find matching LSP location with flexible coordinate matching
      let bestMatch: LocationInfo | null = null;
      let bestDistance = Infinity;
      let bestMatchIndex = -1;

      for (let i = 0; i < unmatchedLSPIdentifiers.length; i++) {
        const lspLoc = unmatchedLSPIdentifiers[i];
        
        // Must match operator name and be on same line
        if (lspLoc.operatorName === operatorCall.name && lspLoc.range.start.line === operatorCall.line) {
          const distance = Math.abs(lspLoc.range.start.character - operatorCall.column);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = lspLoc;
            bestMatchIndex = i;
          }
        }
      }

      if (bestMatch && bestDistance <= 10) { // Allow up to 10 character difference
        matchedOperators.push({
          operatorCall,
          locationInfo: bestMatch,
        });
        
        // Remove from unmatched list
        unmatchedLSPIdentifiers.splice(bestMatchIndex, 1);
      } else {
        unmatchedTreeSitterOperators.push(operatorCall);
      }
    }

    return {
      matchedOperators,
      unmatchedTreeSitterOperators,
      unmatchedLSPIdentifiers,
    };
  }

  /**
   * Filter locations to scope boundaries
   */
  private filterToScope(
    locations: LocationInfo[],
    scopeTarget: ScopeTarget,
    _document: vscode.TextDocument
  ): LocationInfo[] {
    switch (scopeTarget.type) {
      case 'function':
        // Filter to operators within the target function(s)
        if (scopeTarget.functions.length === 0) {
          return [];
        }
        // Implementation would go here - for now return all
        return locations;

      case 'file':
        // Filter to operators in the active file
        if (!scopeTarget.activeFilePath) {
          return locations;
        }
        // Implementation would go here - for now return all
        return locations;

      default:
        return locations;
    }
  }

  /**
   * Check if an operator is a valid dataflow operator based on its return type
   */
  private isValidDataflowOperator(operatorName: string, returnType: string | null): boolean {
    if (!returnType) {
      return false;
    }

    // Accept operators that return live collection types
    if (
      returnType.includes('Stream') ||
      returnType.includes('Singleton') ||
      returnType.includes('Optional') ||
      returnType.includes('KeyedStream') ||
      returnType.includes('KeyedSingleton')
    ) {
      return true;
    }

    // Accept sink operators that return unit type ()
    if (returnType.includes('()') && this.isSinkOperator(operatorName)) {
      return true;
    }

    return false;
  }

  /**
   * Check if an operator is a sink operator
   */
  private isSinkOperator(_operatorName: string): boolean {
    // Trust the LSP analyzer's sink detection
    return true;
  }

  /**
   * Get cache statistics from LSP analyzer
   */
  public getCacheStats(): CacheStats {
    return this.lspAnalyzer.getCacheStats();
  }

  /**
   * Clear cache in LSP analyzer
   */
  public clearCache(uri?: string): void {
    this.lspAnalyzer.clearCache(uri);
  }
}

// Re-export types for compatibility
export type { LocationInfo, CacheStats };