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
   * @param document The document to parse
   * @returns Array of standalone operator chains
   */
  public parseStandaloneChains(document: vscode.TextDocument): OperatorNode[][] {
    const sourceCode = document.getText();
    const tree = this.parser.parse(sourceCode);
    const chains: OperatorNode[][] = [];

    this.log(`Parsing standalone chains with tree-sitter: ${document.fileName}`);

    // Walk the AST to find expression statements, return expressions, and other contexts with method chains
    this.walkTree(tree.rootNode, (node) => {
      // Look for expression_statement nodes that contain method chains
      if (node.type === 'expression_statement') {
        // Check if this expression statement contains a method chain
        const chainNode = node.children.find(
          (child: SyntaxNode) =>
            child.type === 'call_expression' || child.type === 'field_expression'
        );

        if (chainNode) {
          const operators = this.extractOperatorChain(chainNode);
          if (operators.length > 0) {
            chains.push(operators);
            this.log(
              `Found standalone chain with ${operators.length} operators: [${operators.map((op) => op.name).join(', ')}]`
            );
          }
        }
      }

      // Also look for return expressions with method chains
      if (node.type === 'return_expression') {
        // The return expression should have a child that is the returned value
        const returnValue = node.children.find(
          (child: SyntaxNode) =>
            child.type === 'call_expression' || child.type === 'field_expression'
        );

        if (returnValue) {
          const operators = this.extractOperatorChain(returnValue);
          if (operators.length > 0) {
            chains.push(operators);
            this.log(
              `Found return chain with ${operators.length} operators: [${operators.map((op) => op.name).join(', ')}]`
            );
          }
        }
      }
    });

    this.log(`Extracted ${chains.length} standalone chains`);
    return chains;
  }

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
   * Extract operators only from the main method chain, not from arguments
   */
  private extractFromMainChain(node: SyntaxNode, operators: OperatorNode[]): void {
    if (node.type === 'call_expression') {
      // This is a method call - extract from the method part, but skip arguments
      const method = node.children.find((child: SyntaxNode) => child.type === 'field_expression');
      if (method) {
        this.extractFromMainChain(method, operators);
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
      // This is a method call in the main chain
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
