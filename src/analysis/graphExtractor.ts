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
   * Extract graph information using tree-sitter first, then LSP for type filtering
   */
  public async extractGraph(
    document: vscode.TextDocument,
    _scopeTarget: ScopeTarget
  ): Promise<GraphExtractionResult> {
    this.log(`Extracting graph for ${document.fileName}`);

    // Step 1: Use tree-sitter to find all operator calls (precise structural analysis)
    const treeSitterResult = await this.treeSitterAnalyzer.analyzeDocument(document);
    this.log(`Tree-sitter found ${treeSitterResult.allOperatorCalls.length} operator calls`);

    // Step 2: For each operator, query LSP for type information and filter by location types
    const matchedOperators: MatchedOperator[] = [];
    const rejectedOperators: OperatorCall[] = [];
    
    for (const operatorCall of treeSitterResult.allOperatorCalls) {
      // Query LSP for type information at this specific operator position
      const position = new vscode.Position(operatorCall.line, operatorCall.column);
      const typeInfo = await this.lspAnalyzer.getTypeAtPosition(document, position, operatorCall.isMethodCall);
      
      if (!typeInfo) {
        rejectedOperators.push(operatorCall);
        continue;
      }

      // Parse location type from the type information
      const locationKind = this.lspAnalyzer.parseLocationType(typeInfo);
      const isSink = await this.lspAnalyzer.isSinkOperator(document, position, operatorCall.name, typeInfo, 5000);
      
      // Check if this is a valid Hydro operator
      if (locationKind || isSink) {
        const isValidOperator = this.isValidDataflowOperator(operatorCall.name, typeInfo);
        
        if (isValidOperator) {
          // Create LocationInfo from the operator and type information
          const locationInfo: LocationInfo = {
            locationType: typeInfo,
            locationKind: locationKind || 'Process<Leader>', // Default for sink operators
            range: new vscode.Range(operatorCall.line, operatorCall.column, operatorCall.line, operatorCall.column + operatorCall.name.length),
            operatorName: operatorCall.name,
            fullReturnType: typeInfo,
          };

          matchedOperators.push({
            operatorCall,
            locationInfo,
          });
        } else {
          this.log(`Filtered out ${operatorCall.name} - not a dataflow operator (return type: ${typeInfo})`);
          rejectedOperators.push(operatorCall);
        }
      } else {
        rejectedOperators.push(operatorCall);
      }
    }

    this.log(`Found ${matchedOperators.length} valid Hydro operators`);
    this.log(`Rejected ${rejectedOperators.length} non-Hydro operators`);

    return {
      matchedOperators,
      unmatchedTreeSitterOperators: rejectedOperators,
      unmatchedLSPIdentifiers: [], // No unmatched LSP identifiers in this approach
    };
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

    // Accept Tick types (these are valid Hydro operators)
    if (returnType.includes('Tick<')) {
      return true;
    }

    // Accept location types directly (Process, Cluster, etc.)
    if (
      returnType.includes('Process<') ||
      returnType.includes('Cluster<') ||
      returnType.includes('External<')
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