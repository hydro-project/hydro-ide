/**
 * Utility functions for analysis
 *
 * Pure utility functions with no dependencies on other analysis modules.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';

/**
 * Extract module path from file path
 *
 * Examples:
 * - /path/to/project/src/module/submodule.rs -> module::submodule
 * - /path/to/project/src/lib.rs -> crate
 * - /path/to/project/src/main.rs -> crate
 *
 * @param filePath Absolute file path
 * @returns Module path in Rust syntax (e.g., "module::submodule")
 */
export function extractModulePath(filePath: string): string {
  const parts = filePath.split(path.sep);
  const srcIndex = parts.findIndex((p) => p === 'src');

  if (srcIndex === -1) {
    // If no src directory, use the file name
    const fileName = path.basename(filePath, '.rs');
    return fileName === 'lib' || fileName === 'main' ? 'crate' : fileName;
  }

  // Get parts after src/
  const moduleParts = parts.slice(srcIndex + 1);

  // Remove .rs extension from last part
  const lastPart = moduleParts[moduleParts.length - 1];
  if (lastPart) {
    moduleParts[moduleParts.length - 1] = lastPart.replace(/\.rs$/, '');
  }

  // Handle lib.rs and main.rs
  const lastModule = moduleParts[moduleParts.length - 1];
  if (lastModule === 'lib' || lastModule === 'main') {
    moduleParts.pop();
  }

  // Join with ::
  return moduleParts.length > 0 ? moduleParts.join('::') : 'crate';
}

/**
 * Find Cargo.toml starting from a file path and walking up the directory tree
 *
 * @param startPath File path to start searching from
 * @returns Path to Cargo.toml or null if not found
 */
export async function findCargoTomlFromFile(startPath: string): Promise<string | null> {
  let currentDir = path.dirname(startPath);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const cargoTomlPath = path.join(currentDir, 'Cargo.toml');

    try {
      await fs.access(cargoTomlPath);
      return cargoTomlPath;
    } catch {
      // File doesn't exist, continue searching
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached root
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Find Cargo.toml in workspace, optionally starting from a specific file
 *
 * @param workspaceRoot Workspace root path
 * @param filePath Optional file path to start searching from
 * @returns Path to Cargo.toml or null if not found
 */
export async function findCargoToml(
  workspaceRoot: string,
  filePath?: string
): Promise<string | null> {
  // Strategy 1: If filePath provided, search upwards from that file
  if (filePath) {
    const result = await findCargoTomlFromFile(filePath);
    if (result) {
      return result;
    }
  }

  // Strategy 2: Check workspace root
  const workspaceCargoToml = path.join(workspaceRoot, 'Cargo.toml');
  try {
    await fs.access(workspaceCargoToml);
    return workspaceCargoToml;
  } catch {
    // Not at root, continue searching
  }

  // Strategy 3: Search common locations
  const commonPaths = [
    path.join(workspaceRoot, 'hydro', 'Cargo.toml'),
    path.join(workspaceRoot, 'rust', 'Cargo.toml'),
  ];

  for (const cargoPath of commonPaths) {
    try {
      await fs.access(cargoPath);
      return cargoPath;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Find all Rust files in a workspace
 *
 * @param workspaceRoot Workspace root path
 * @returns Array of absolute file paths
 */
export async function findRustFilesInWorkspace(workspaceRoot: string): Promise<string[]> {
  const files: string[] = [];

  const findRustFiles = async (dir: string) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip common ignored directories
        if (entry.isDirectory()) {
          if (['target', 'node_modules', '.git', '.vscode'].includes(entry.name)) {
            continue;
          }
          await findRustFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.rs')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
    }
  };

  await findRustFiles(workspaceRoot);
  return files;
}

/**
 * Get the function at a specific position in a document
 *
 * @param functions List of functions
 * @param position Cursor position
 * @returns The function containing the position, or null
 */
export function getFunctionAtPosition<T extends { startLine: number; endLine: number }>(
  functions: T[],
  position: vscode.Position
): T | null {
  return (
    functions.find((func) => func.startLine <= position.line && func.endLine >= position.line) ||
    null
  );
}
