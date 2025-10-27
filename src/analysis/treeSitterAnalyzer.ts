/**
 * Tree-sitter based AST analyzer for Hydro code
 * 
 * Provides pure syntactic analysis without type information:
 * - Identifies operator calls vs variable bindings
 * - Extracts operator chains and method calls
 * - Determines structural relationships in code
 */

import * as vscode from 'vscode';
import { TreeSitterRustParser, OperatorNode } from './treeSitterParser';

/**
 * Information about an operator call identified by tree-sitter
 */
export interface OperatorCall {
  /** Operator name (method name) */
  name: string;
  /** Line number (0-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
  /** Whether this is a method call (preceded by .) */
  isMethodCall: boolean;
}

/**
 * Information about a variable binding and its operator chain
 */
export interface VariableBinding {
  /** Variable name */
  variableName: string;
  /** Line where the variable is declared */
  line: number;
  /** Operators in the assignment chain */
  operators: OperatorCall[];
}

/**
 * Results from tree-sitter analysis
 */
export interface TreeSitterAnalysisResult {
  /** Variable bindings (let statements) */
  variableBindings: VariableBinding[];
  /** Standalone operator chains (not assigned to variables) */
  standaloneChains: OperatorCall[][];
  /** All operator calls (flattened) */
  allOperatorCalls: OperatorCall[];
}

/**
 * Tree-sitter based analyzer for identifying operators and structure
 */
export class TreeSitterAnalyzer {
  private parser: TreeSitterRustParser;
  private outputChannel: vscode.OutputChannel | null = null;

  constructor(outputChannel?: vscode.OutputChannel) {
    this.outputChannel = outputChannel || null;
    if (outputChannel) {
      this.parser = new TreeSitterRustParser(outputChannel);
    } else {
      // Create a dummy output channel if none provided
      const dummyChannel = {
        name: 'TreeSitterAnalyzer',
        append: () => {},
        appendLine: () => {},
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      } as unknown as vscode.OutputChannel;
      this.parser = new TreeSitterRustParser(dummyChannel);
    }
  }

  /**
   * Log message to output channel
   */
  private log(message: string): void {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[TreeSitterAnalyzer] ${message}`);
    }
  }

  /**
   * Analyze a document to identify operators and their structure
   */
  public analyzeDocument(document: vscode.TextDocument): TreeSitterAnalysisResult {
    this.log(`Analyzing document structure: ${document.fileName}`);

    // Parse variable bindings and standalone chains
    const variableBindings = this.parseVariableBindings(document);
    const standaloneChains = this.parseStandaloneChains(document);

    // Flatten all operator calls
    const allOperatorCalls: OperatorCall[] = [];

    // Add operators from variable bindings
    for (const binding of variableBindings) {
      allOperatorCalls.push(...binding.operators);
    }

    // Add operators from standalone chains
    for (const chain of standaloneChains) {
      allOperatorCalls.push(...chain);
    }

    this.log(`Found ${variableBindings.length} variable bindings, ${standaloneChains.length} standalone chains`);
    this.log(`Total operator calls: ${allOperatorCalls.length}`);

    return {
      variableBindings,
      standaloneChains,
      allOperatorCalls,
    };
  }

  /**
   * Parse variable bindings from the document
   */
  private parseVariableBindings(document: vscode.TextDocument): VariableBinding[] {
    const rawBindings = this.parser.parseVariableBindings(document);
    
    return rawBindings.map(binding => ({
      variableName: binding.varName,
      line: binding.line,
      operators: binding.operators.map(op => this.convertOperatorNode(op, document)),
    }));
  }

  /**
   * Parse standalone operator chains from the document
   */
  private parseStandaloneChains(document: vscode.TextDocument): OperatorCall[][] {
    const rawChains = this.parser.parseStandaloneChains(document);
    
    return rawChains.map(chain => 
      chain.map(op => this.convertOperatorNode(op, document))
    );
  }

  /**
   * Convert a raw OperatorNode to an OperatorCall with additional context
   */
  private convertOperatorNode(op: OperatorNode, document: vscode.TextDocument): OperatorCall {
    // Determine if this is a method call by checking if preceded by '.'
    let isMethodCall = false;
    try {
      if (op.line < document.lineCount && op.column > 0) {
        const lineText = document.lineAt(op.line).text;
        const charBefore = op.column > 0 ? lineText[op.column - 1] : '';
        isMethodCall = charBefore === '.';
      }
    } catch (error) {
      // Ignore errors in method call detection
    }

    return {
      name: op.name,
      line: op.line,
      column: op.column,
      isMethodCall,
    };
  }

  /**
   * Create a unique key for an operator call
   */
  public static createOperatorKey(op: OperatorCall): string {
    return `${op.line}:${op.column}:${op.name}`;
  }

  /**
   * Check if a position matches an operator call (with tolerance)
   */
  public static matchesOperator(
    op: OperatorCall, 
    line: number, 
    column: number, 
    name: string,
    tolerance: number = 5
  ): boolean {
    return (
      op.line === line &&
      op.name === name &&
      Math.abs(op.column - column) <= tolerance
    );
  }
}