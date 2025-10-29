/**
 * Tree-sitter based Rust parser for operator chain extraction
 *
 * Uses tree-sitter to properly parse Rust syntax and extract operator chains,
 * replacing the regex-based approach with proper AST parsing.
 */

import Parser = require('tree-sitter');
import Rust = require('tree-sitter-rust');
import * as vscode from 'vscode';

// Type declarations for tree-sitter
interface SyntaxNode {
  type: string;
  children: SyntaxNode[];
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  parent: SyntaxNode | null;
  namedChildren: SyntaxNode[];
  childCount: number;
  namedChildCount: number;
  firstChild: SyntaxNode | null;
  lastChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
  firstNamedChild: SyntaxNode | null;
  lastNamedChild: SyntaxNode | null;
  nextNamedSibling: SyntaxNode | null;
  previousNamedSibling: SyntaxNode | null;
  namedChild(index: number): SyntaxNode | null;
  child(index: number): SyntaxNode | null;
}

interface Tree {
  rootNode: SyntaxNode;
}

interface TreeSitterParser {
  setLanguage(language: unknown): void;
  parse(input: string): Tree;
}

/**
 * Operator information extracted from the AST
 */
export interface OperatorNode {
  /** Operator name (method name) */
  name: string;
  /** Line number (0-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
  /** End line number (0-indexed) */
  endLine: number;
  /** End column number (0-indexed) */
  endColumn: number;
  /** Tick variable name for temporal operators (e.g., "ticker", "t") */
  tickVariable?: string;
}

/**
 * Variable binding information
 */
export interface VariableBindingNode {
  /** Variable name */
  varName: string;
  /** Line number where binding occurs */
  line: number;
  /** Operators in the chain assigned to this variable */
  operators: OperatorNode[];
}

/**
 * Tree-sitter based Rust parser
 */
export class TreeSitterRustParser {
  private parser: TreeSitterParser;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.parser = new Parser();
    this.parser.setLanguage(Rust);
    this.outputChannel = outputChannel;
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[TreeSitterParser] ${message}`);
  }

  /**
   * Parse document and extract all variable bindings with their operator chains
   *
   * @param document The document to parse
   * @returns Array of variable bindings
   */
  public parseVariableBindings(document: vscode.TextDocument): VariableBindingNode[] {
    const sourceCode = document.getText();
    const tree = this.parser.parse(sourceCode);
    const bindings: VariableBindingNode[] = [];

    this.log(`Parsing document with tree-sitter: ${document.fileName}`);

    // Walk the AST to find let statements
    this.walkTree(tree.rootNode, (node) => {
      // Look for let_declaration nodes
      if (node.type === 'let_declaration') {
        const newBindings = this.extractVariableBindingsFromLet(node, document);
        for (const b of newBindings) {
          bindings.push(b);
          this.log(`Found binding: ${b.varName} with ${b.operators.length} operators`);
        }
      }
    });

    this.log(`Extracted ${bindings.length} variable bindings`);
    return bindings;
  }

  /**
   * Parse document and extract standalone operator chains (not assigned to variables)
   *
   * This uses a comprehensive approach: find ALL method chains in the AST, regardless of context,
   * then filter out chains that are part of variable bindings (already captured by parseVariableBindings).
   *
   * @param document The document to parse
   * @returns Array of standalone operator chains
   */
  public parseStandaloneChains(document: vscode.TextDocument): OperatorNode[][] {
    const sourceCode = document.getText();
    const tree = this.parser.parse(sourceCode);
    const chains: OperatorNode[][] = [];
    const seenChainKeys = new Set<string>();

    this.log(`Parsing standalone chains with tree-sitter: ${document.fileName}`);

    // First, identify all chains that are part of variable bindings (to avoid duplicates)
    const variableBindingChainKeys = new Set<string>();
    this.walkTree(tree.rootNode, (node) => {
      if (node.type === 'let_declaration') {
        const valueNode = node.children.find(
          (child: SyntaxNode) =>
            child.type === 'call_expression' || child.type === 'field_expression'
        );
        if (valueNode) {
          // Mark this chain as belonging to a variable binding
          const chainKey = this.makeChainKey(valueNode);
          variableBindingChainKeys.add(chainKey);
        }
      }
    });

    // Now walk the entire tree and find ALL method chains
    this.walkTree(tree.rootNode, (node) => {
      // Look for any call_expression (start of potential chain)
      // We only look at call_expression (not field_expression) to avoid duplicates
      if (node.type === 'call_expression') {
        // Check if this is the outermost call in a chain
        // by checking if parent is a chain-related node
        const parent = node.parent;
        if (parent && (parent.type === 'call_expression' || parent.type === 'field_expression')) {
          // This is part of a larger chain, skip it (we'll process the outermost call)
          return;
        }

        // Skip if this call is inside the arguments of a METHOD call (part of parent chain)
        // but ALLOW if it's inside arguments of a FUNCTION call (separate chain)
        let ancestor = parent;
        while (ancestor) {
          if (ancestor.type === 'arguments') {
            // Check if this arguments node belongs to a method call (field_expression)
            // or a function call (direct call_expression with identifier)
            const argsParent = ancestor.parent;
            if (argsParent && argsParent.type === 'call_expression') {
              // Check if this is a method call (has field_expression as function)
              const functionNode = argsParent.children.find(
                (c: SyntaxNode) => c.type === 'field_expression' || c.type === 'identifier'
              );
              if (functionNode && functionNode.type === 'field_expression') {
                // This is inside arguments of a method call (part of parent chain), skip it
                return;
              }
              // Otherwise it's a function call argument - allow it (separate chain)
            }
            break; // Found arguments node, decision made
          }
          // Stop if we hit a statement boundary (these are safe boundaries)
          if (
            ancestor.type === 'expression_statement' ||
            ancestor.type === 'let_declaration' ||
            ancestor.type === 'return_expression'
          ) {
            break;
          }
          ancestor = ancestor.parent;
        }

        const operators = this.extractOperatorChain(node);
        if (operators.length > 0) {
          // Create a unique key for this chain based on its position
          const chainKey = this.makeChainKey(node);

          // Skip if this chain is part of a variable binding or already seen
          if (variableBindingChainKeys.has(chainKey) || seenChainKeys.has(chainKey)) {
            return;
          }

          seenChainKeys.add(chainKey);
          chains.push(operators);
          this.log(
            `Found chain with ${operators.length} operators: [${operators.map((op) => op.name).join(', ')}]`
          );
        }
      }
    });

    this.log(`Extracted ${chains.length} standalone chains`);
    return chains;
  }

  /**
   * Create a unique key for a chain based on its position in the source
   */
  private makeChainKey(node: SyntaxNode): string {
    return `${node.startPosition.row}:${node.startPosition.column}`;
  }

  /**
   * Find the last expression in a block that would be an implicit return
  /**
   * Extract operator chain from a specific line
   *
   * Finds the let_declaration that starts on the given line and extracts
   * only the operators from that specific declaration.
   *
   * @param document The document
   * @param startLine The line to start from (0-indexed)
   * @returns Array of operators in the chain
   */
  public extractChainFromLine(document: vscode.TextDocument, startLine: number): OperatorNode[] {
    const sourceCode = document.getText();
    const tree = this.parser.parse(sourceCode);
    const operators: OperatorNode[] = [];

    // Find the let_declaration that starts on this line
    this.walkTree(tree.rootNode, (node) => {
      // Only look at let_declaration nodes that start on the target line
      if (node.type === 'let_declaration' && node.startPosition.row === startLine) {
        // Extract operators only from this specific let declaration
        const chainOps = this.extractOperatorChain(node);
        operators.push(...chainOps);
      }
    });

    return operators;
  }

  /**
   * Extract variable binding from a let_declaration node
   */

  private extractVariableBindingsFromLet(
    letNode: SyntaxNode,
    document: vscode.TextDocument
  ): VariableBindingNode[] {
    // let_declaration structure varies:
    // - Simple: let identifier = value;
    // - Destructuring: let (a, b) = value; let (a, _b) = value; let (a, (b, c)) = value;
    // We collect all identifiers in the pattern and associate them with the same operator chain from value.

    const patternIdentifiers: string[] = [];
    let valueNode: SyntaxNode | null = null;

    // First pass: detect value node and pattern subtree
    for (let i = 0; i < letNode.childCount; i++) {
      const child = letNode.child(i);
      if (!child) continue;

      // Value expression can be call_expression or field_expression (start of chain)
      if (!valueNode && (child.type === 'call_expression' || child.type === 'field_expression')) {
        valueNode = child;
      }
    }

    // Second pass: collect identifiers from the pattern (any identifier under letNode before '=')
    // In tree-sitter, pattern forms are children before the '=' token; we'll conservatively collect
    // identifiers from children that are patterns or from direct 'identifier' children.
    const collectFromNode = (node: SyntaxNode) => {
      if (node.type === 'identifier') {
        const name = document.getText(
          new vscode.Range(
            new vscode.Position(node.startPosition.row, node.startPosition.column),
            new vscode.Position(node.endPosition.row, node.endPosition.column)
          )
        );
        if (name) patternIdentifiers.push(name);
        return;
      }
      // Recurse into common pattern node types
      const PATTERN_TYPES = new Set([
        'tuple_pattern',
        'parenthesized_pattern',
        'slice_pattern',
        'reference_pattern',
        'or_pattern',
        'mutable_specifier',
        'tuple_struct_pattern',
        'struct_pattern',
        'field_pattern',
        'box_pattern',
      ]);
      if (PATTERN_TYPES.has(node.type)) {
        for (const ch of node.children) collectFromNode(ch);
      }
    };

    // Heuristic: examine children until we hit '=' or the value node; collect identifiers in that region
    for (let i = 0; i < letNode.childCount; i++) {
      const child = letNode.child(i);
      if (!child) continue;
      if (child === valueNode) break;
      // '=' may be represented as punctuation node with text '='; skip once we reach it
      if (child.type === '=') break;
      if (child.type === 'identifier') {
        collectFromNode(child);
      } else {
        collectFromNode(child);
      }
    }

    if (!valueNode) {
      return [];
    }

    // Extract operator chain from the value expression or its main chain
    const operators = this.extractOperatorChain(valueNode);
    if (operators.length === 0) {
      return [];
    }

    // If no identifiers were found (unlikely), fallback to a single synthetic binding name
    const varNames = patternIdentifiers.length > 0 ? patternIdentifiers : ['_'];

    return varNames.map((varName) => ({
      varName,
      line: letNode.startPosition.row,
      operators,
    }));
  }

  /**
   * Extract operator chain from an expression node
   *
   * Handles:
   * - field_expression: a.b.c
   * - call_expression: a.b().c()
   * - let_declaration: let x = a.b().c()
   * - Nested chains
   *
   * Only extracts operators from the main method chain, not from arguments.
   */
  private extractOperatorChain(node: SyntaxNode): OperatorNode[] {
    const operators: OperatorNode[] = [];

    // If this is a let_declaration, find the value expression first
    if (node.type === 'let_declaration') {
      // Find the call_expression that represents the value being assigned
      const valueNode = node.children.find((child: SyntaxNode) => child.type === 'call_expression');
      if (valueNode) {
        this.extractFromMainChain(valueNode, operators);
      }
    } else {
      // Walk the main chain structure, avoiding arguments
      this.extractFromMainChain(node, operators);
    }

    // Sort operators by position (line, then column)
    operators.sort((a, b) => {
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.column - b.column;
    });

    return operators;
  }

  /**
   * Extract operators from the main method chain and tick variables for temporal operators
   */
  private extractFromMainChain(node: SyntaxNode, operators: OperatorNode[]): void {
    if (node.type === 'call_expression') {
      // This is a method call - extract from the method part and check for tick arguments
      const method = node.children.find((child: SyntaxNode) => child.type === 'field_expression');
      if (method) {
        // Get the operator name first
        const fieldIdentifier = method.children.find(
          (child: SyntaxNode) => child.type === 'field_identifier'
        );

        if (fieldIdentifier) {
          const operatorName = fieldIdentifier.text;

          // Check if this is a temporal operator that takes a tick argument
          const temporalOperators = [
            'batch',
            'snapshot',
            'snapshot_atomic',
            'sample_every',
            'timeout',
          ];
          let tickVariable: string | undefined;

          if (temporalOperators.includes(operatorName)) {
            // Extract the first argument (tick variable)
            tickVariable = this.extractFirstArgument(node);
          }

          operators.push({
            name: operatorName,
            line: fieldIdentifier.startPosition.row,
            column: fieldIdentifier.startPosition.column,
            endLine: fieldIdentifier.endPosition.row,
            endColumn: fieldIdentifier.endPosition.column,
            tickVariable,
          });
        }

        // Continue with the receiver chain
        const receiver = method.children.find(
          (child: SyntaxNode) => child.type !== 'field_identifier' && child.type !== '.'
        );
        if (receiver) {
          this.extractFromMainChain(receiver, operators);
        }
      }

      // Also check if the receiver is another call_expression (chained method calls)
      // This handles cases like: parsed_requests.clone().filter_map(...)
      const receiver = node.children.find(
        (child: SyntaxNode) => child.type === 'call_expression' || child.type === 'field_expression'
      );
      if (receiver && receiver !== method) {
        this.extractFromMainChain(receiver, operators);
      }
    } else if (node.type === 'field_expression') {
      // This is a field access without a call - shouldn't happen in chains but handle it
      const fieldIdentifier = node.children.find(
        (child: SyntaxNode) => child.type === 'field_identifier'
      );
      if (fieldIdentifier) {
        const operatorName = fieldIdentifier.text;

        operators.push({
          name: operatorName,
          line: fieldIdentifier.startPosition.row,
          column: fieldIdentifier.startPosition.column,
          endLine: fieldIdentifier.endPosition.row,
          endColumn: fieldIdentifier.endPosition.column,
        });
      }

      // Continue with the receiver (left side of the dot)
      const receiver = node.children.find(
        (child: SyntaxNode) => child.type !== 'field_identifier' && child.type !== '.'
      );
      if (receiver) {
        this.extractFromMainChain(receiver, operators);
      }
    }
    // For other node types (like identifier), stop recursion to avoid picking up arguments
  }

  /**
   * Extract the first argument from a call_expression node
   * Used to get tick variable from temporal operators like batch(ticker, ...)
   *
   * @param callNode The call_expression node
   * @returns The tick variable name (e.g., "ticker", "t") or undefined
   */
  private extractFirstArgument(callNode: SyntaxNode): string | undefined {
    // Find the arguments node
    const argsNode = callNode.children.find((child: SyntaxNode) => child.type === 'arguments');
    if (!argsNode) return undefined;

    // Get the first argument
    for (const child of argsNode.children) {
      // Skip punctuation like '(' and ','
      if (child.type === '(' || child.type === ')' || child.type === ',') {
        continue;
      }

      // Handle direct identifier: batch(ticker, ...)
      if (child.type === 'identifier') {
        return child.text;
      }

      // Handle reference: batch(&ticker, ...)
      if (child.type === 'reference_expression' || child.type === 'unary_expression') {
        const identifier = child.children.find((c: SyntaxNode) => c.type === 'identifier');
        if (identifier) {
          return identifier.text;
        }
      }

      // Found a non-identifier first arg, return undefined
      return undefined;
    }

    return undefined;
  }

  /**
   * Walk the syntax tree and call visitor for each node
   */
  private walkTree(node: SyntaxNode, visitor: (node: SyntaxNode) => void): void {
    visitor(node);

    for (const child of node.children) {
      this.walkTree(child, visitor);
    }
  }

  /**
   * Find the enclosing Rust function name for a given line in the document.
   * Returns the nearest function_item that spans the line (innermost by span).
   */
  public findEnclosingFunctionName(document: vscode.TextDocument, line: number): string | null {
    try {
      const sourceCode = document.getText();
      const tree = this.parser.parse(sourceCode);

      let bestFn: SyntaxNode | null = null;
      let bestSpan: number = Number.POSITIVE_INFINITY;

      this.walkTree(tree.rootNode, (node) => {
        if (node.type === 'function_item') {
          const start = node.startPosition.row;
          const end = node.endPosition.row;
          if (start <= line && line <= end) {
            const span = end - start;
            if (span < bestSpan) {
              bestSpan = span;
              bestFn = node;
            }
          }
        }
      });

      if (!bestFn) return null;

      // Extract the identifier for the function name
      const identifier = this.findChildOfType(bestFn, 'identifier');
      if (!identifier) return null;
      const name = document.getText(
        new vscode.Range(
          new vscode.Position(identifier.startPosition.row, identifier.startPosition.column),
          new vscode.Position(identifier.endPosition.row, identifier.endPosition.column)
        )
      );
      return name || null;
    } catch (e) {
      // Fall back silently
      return null;
    }
  }

  /** Find first descendant (direct child) of the given type */
  private findChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
    for (const child of node.children) {
      if (child.type === type) return child;
    }
    return null;
  }
}
