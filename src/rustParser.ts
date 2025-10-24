/**
 * Rust Parser using Tree-sitter
 * 
 * Provides robust parsing of Rust source code to extract function metadata
 */

import Parser from 'tree-sitter';
import Rust from 'tree-sitter-rust';

export interface RustFunction {
  name: string;
  startLine: number;
  endLine: number;
  parameters: RustParameter[];
  returnType?: string;
  attributes: string[];
  body: string;
}

export interface RustParameter {
  name: string;
  type: string;
}

export class RustParser {
  private parser: Parser;

  constructor() {
    try {
      this.parser = new Parser();
      this.parser.setLanguage(Rust as any);
    } catch (error) {
      throw new Error(`Failed to initialize tree-sitter parser: ${error}`);
    }
  }

  /**
   * Parse Rust source code and extract all functions
   */
  parseFunctions(sourceCode: string): RustFunction[] {
    const tree = this.parser.parse(sourceCode);
    const functions: RustFunction[] = [];

    this.traverseTree(tree.rootNode, sourceCode, functions);

    return functions;
  }

  /**
   * Traverse the syntax tree to find function declarations
   */
  private traverseTree(
    node: Parser.SyntaxNode,
    sourceCode: string,
    functions: RustFunction[]
  ): void {
    if (node.type === 'function_item') {
      const func = this.extractFunction(node, sourceCode);
      if (func) {
        functions.push(func);
      }
    }

    for (const child of node.children) {
      this.traverseTree(child, sourceCode, functions);
    }
  }

  /**
   * Extract function metadata from a function_item node
   */
  private extractFunction(
    node: Parser.SyntaxNode,
    sourceCode: string
  ): RustFunction | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    const name = sourceCode.substring(nameNode.startIndex, nameNode.endIndex);
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;

    // Extract parameters
    const parameters = this.extractParameters(node, sourceCode);

    // Extract return type
    const returnType = this.extractReturnType(node, sourceCode);

    // Extract attributes
    const attributes = this.extractAttributes(node, sourceCode);

    // Extract body
    const bodyNode = node.childForFieldName('body');
    const body = bodyNode
      ? sourceCode.substring(bodyNode.startIndex, bodyNode.endIndex)
      : '';

    return {
      name,
      startLine,
      endLine,
      parameters,
      returnType,
      attributes,
      body,
    };
  }

  /**
   * Extract function parameters
   */
  private extractParameters(
    node: Parser.SyntaxNode,
    sourceCode: string
  ): RustParameter[] {
    const parameters: RustParameter[] = [];
    const paramsNode = node.childForFieldName('parameters');

    if (!paramsNode) {
      return parameters;
    }

    for (const child of paramsNode.children) {
      if (child.type === 'parameter') {
        const patternNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');

        if (patternNode && typeNode) {
          const name = sourceCode.substring(
            patternNode.startIndex,
            patternNode.endIndex
          );
          const type = sourceCode.substring(
            typeNode.startIndex,
            typeNode.endIndex
          );

          parameters.push({ name, type });
        }
      }
    }

    return parameters;
  }

  /**
   * Extract return type
   */
  private extractReturnType(
    node: Parser.SyntaxNode,
    sourceCode: string
  ): string | undefined {
    const returnTypeNode = node.childForFieldName('return_type');

    if (!returnTypeNode) {
      return undefined;
    }

    return sourceCode
      .substring(returnTypeNode.startIndex, returnTypeNode.endIndex)
      .replace(/^->\s*/, '')
      .trim();
  }

  /**
   * Extract attributes (like #[hydro::flow])
   */
  private extractAttributes(
    node: Parser.SyntaxNode,
    sourceCode: string
  ): string[] {
    const attributes: string[] = [];
    let currentNode: Parser.SyntaxNode | null = node;

    // Look for attribute_item nodes before the function
    while (currentNode && currentNode.previousSibling) {
      const sibling: Parser.SyntaxNode = currentNode.previousSibling;

      if (sibling.type === 'attribute_item') {
        const attrText = sourceCode.substring(
          sibling.startIndex,
          sibling.endIndex
        );
        // Extract content between #[ and ]
        const match = attrText.match(/#\[([^\]]+)\]/);
        if (match) {
          attributes.unshift(match[1]);
        }
      } else if (sibling.type !== 'line_comment' && sibling.type !== 'block_comment') {
        // Stop if we hit something that's not an attribute or comment
        break;
      }

      currentNode = sibling;
    }

    return attributes;
  }

  /**
   * Check if a function has a specific parameter type
   */
  hasParameterType(func: RustFunction, typePattern: RegExp): boolean {
    return func.parameters.some((param) => typePattern.test(param.type));
  }

  /**
   * Check if function body contains a pattern
   */
  bodyContains(func: RustFunction, pattern: RegExp): boolean {
    return pattern.test(func.body);
  }
}
