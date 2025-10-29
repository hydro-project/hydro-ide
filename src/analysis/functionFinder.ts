/**
 * Simple function finder for Rust files
 *
 * This replaces the old scopeAnalyzer with a simpler implementation that:
 * 1. Uses tree-sitter to parse all functions
 * 2. Adds module path and cargo metadata
 * 3. Returns ALL functions without filtering
 * 4. Lets downstream consumers (LSP/Cargo) decide what to do with them
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { RustParser, RustFunction } from './rustParser';
import { extractModulePath, findCargoToml } from './utils';

export interface FunctionMetadata extends RustFunction {
  modulePath: string;
  cargoTomlPath: string | null;
}

export class FunctionFinder {
  private parser: RustParser;

  constructor() {
    this.parser = new RustParser();
  }

  /**
   * Find all functions in a Rust file
   *
   * @param document VS Code document
   * @returns Array of functions with metadata
   */
  async findFunctions(document: vscode.TextDocument): Promise<FunctionMetadata[]> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceRoot = workspaceFolder?.uri.fsPath || path.dirname(document.uri.fsPath);

    // Parse all functions using tree-sitter
    const functions = this.parser.parseFunctions(document.getText());

    // Find Cargo.toml
    const cargoTomlPath = await findCargoToml(workspaceRoot, document.uri.fsPath);

    // Add metadata to each function
    const modulePath = extractModulePath(document.uri.fsPath);

    return functions.map((func) => ({
      ...func,
      modulePath,
      cargoTomlPath,
    }));
  }

  /**
   * Find a specific function at a cursor position
   *
   * @param document VS Code document
   * @param position Cursor position
   * @returns Function at position with metadata, or null
   */
  async findFunctionAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<FunctionMetadata | null> {
    const functions = await this.findFunctions(document);

    return (
      functions.find((func) => func.startLine <= position.line && func.endLine >= position.line) ||
      null
    );
  }

  /**
   * Find functions by name
   *
   * @param document VS Code document
   * @param name Function name to search for
   * @returns Array of matching functions
   */
  async findFunctionsByName(
    document: vscode.TextDocument,
    name: string
  ): Promise<FunctionMetadata[]> {
    const functions = await this.findFunctions(document);
    return functions.filter((func) => func.name === name);
  }
}
