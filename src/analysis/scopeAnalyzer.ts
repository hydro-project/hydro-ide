/**
 * ScopeAnalyzer - Detects and analyzes Hydro code in Rust source files
 *
 * This class is responsible for:
 * - Identifying Hydro functions at different scopes (function, file, workspace)
 * - Parsing Rust source code to extract function metadata
 * - Detecting Hydro-specific markers (attributes, macros, imports)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  ScopeType,
  ScopeTarget,
  HydroFunction,
  ScopeDetectionError,
  ScopeErrorCategory,
  ScopeAnalyzerConfig,
} from '../core/types';
import { RustParser } from './rustParser';
import { findCargoToml, findRustFilesInWorkspace } from './utils';

/**
 * Default configuration for scope analysis
 */
const DEFAULT_CONFIG: ScopeAnalyzerConfig = {
  includeImplicitFunctions: false,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  workspaceScanTimeout: 30000, // 30 seconds
};

/**
 * Patterns for detecting Hydro code
 */
const HYDRO_PATTERNS = {
  /** Hydro attribute pattern: #[hydro::flow] or #[hydro_lang::flow] */
  attribute: /#\[(?:hydro|hydro_lang)::(?:flow|main)\]/,

  /** Hydro macro pattern: hydro_lang::flow! or hydro::flow! */
  macro: /(?:hydro|hydro_lang)::flow!\s*\(/,

  /** Function definition pattern */
  functionDef: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,

  /** Hydro imports */
  hydroImport: /use\s+(?:hydro|hydro_lang|dfir_rs)(?:::|;)/,

  /** FlowBuilder parameter pattern: &FlowBuilder<'a> or similar */
  flowBuilderParam: /&\s*FlowBuilder\s*(?:<[^>]*>)?/,

  /** FlowBuilder method calls: flow.cluster(), flow.process(), flow.external() */
  flowBuilderMethods: /\b(?:flow|builder)\s*\.\s*(?:cluster|process|external|tick)\s*\(/,

  /** Hydro method chains: .map(), .fold(), .send_bincode(), etc. */
  hydroMethodChains:
    /\.\s*(?:map|filter|fold|reduce|send_bincode|send_partitioned|cross_product|batch|persist|all_ticks|for_each|inspect|source_iter|source_external_bincode|decouple_cluster|decouple_process|demux_bincode|assume_ordering|assume_retries|sample_every|key_count)\s*\(/,
};

/**
 * Internal function metadata with additional parsing information
 */
interface ParsedFunction extends HydroFunction {
  returnType?: string;
}

/**
 * ScopeAnalyzer class for detecting Hydro code
 */
export class ScopeAnalyzer {
  private config: ScopeAnalyzerConfig;
  private outputChannel: vscode.OutputChannel;
  private rustParser: RustParser;

  constructor(outputChannel: vscode.OutputChannel, config: Partial<ScopeAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.outputChannel = outputChannel;

    try {
      this.rustParser = new RustParser();
      this.outputChannel.appendLine('[ScopeAnalyzer] Tree-sitter parser initialized successfully');
    } catch (error) {
      this.outputChannel.appendLine(
        `[ScopeAnalyzer] Warning: Tree-sitter initialization failed: ${error}`
      );
      this.outputChannel.appendLine('[ScopeAnalyzer] Will use legacy regex-based parsing');
      this.rustParser = null as unknown as RustParser; // Will trigger fallback
    }
  }

  /**
   * Analyze scope based on editor state and scope type
   */
  async analyzeScope(editor: vscode.TextEditor, scopeType: ScopeType): Promise<ScopeTarget> {
    this.outputChannel.appendLine(`[ScopeAnalyzer] Analyzing ${scopeType} scope`);

    try {
      switch (scopeType) {
        case 'function':
          return await this.analyzeFunctionScope(editor);
        case 'file':
          return await this.analyzeFileScope(editor.document);
        case 'workspace':
          return await this.analyzeWorkspaceScope();
        default:
          throw new ScopeDetectionError(
            ScopeErrorCategory.PARSE_ERROR,
            `Unknown scope type: ${scopeType}`
          );
      }
    } catch (error) {
      if (error instanceof ScopeDetectionError) {
        throw error;
      }

      // Wrap unexpected errors
      throw new ScopeDetectionError(
        ScopeErrorCategory.PARSE_ERROR,
        `Failed to analyze ${scopeType} scope: ${error}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Analyze function-level scope (function at cursor position)
   */
  private async analyzeFunctionScope(editor: vscode.TextEditor): Promise<ScopeTarget> {
    const position = editor.selection.active;
    const document = editor.document;

    this.outputChannel.appendLine(`[ScopeAnalyzer] Finding function at line ${position.line + 1}`);

    const hydroFunction = await this.findHydroFunctionAtPosition(document, position);

    if (!hydroFunction) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NO_HYDRO_CODE,
        'No Hydro function found at cursor position',
        `Searched at line ${position.line + 1} in ${document.fileName}`
      );
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NOT_IN_WORKSPACE,
        'File is not part of a workspace',
        document.fileName
      );
    }

    this.outputChannel.appendLine(`[ScopeAnalyzer] Found function: ${hydroFunction.name}`);

    // Find Cargo.toml for this file
    const cargoTomlPath = await findCargoToml(workspaceFolder.uri.fsPath, document.fileName);
    if (!cargoTomlPath) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NOT_IN_WORKSPACE,
        'No Cargo.toml found for this file',
        'Cannot build without Cargo.toml'
      );
    }

    return {
      type: 'function',
      functions: [hydroFunction],
      workspaceRoot: workspaceFolder.uri.fsPath,
      activeFilePath: document.fileName,
      cargoTomlPath,
    };
  }

  /**
   * Analyze file-level scope (all Hydro functions in file)
   */
  private async analyzeFileScope(document: vscode.TextDocument): Promise<ScopeTarget> {
    this.outputChannel.appendLine(`[ScopeAnalyzer] Analyzing file: ${document.fileName}`);

    const functions = await this.findAllHydroFunctionsInFile(document);

    if (functions.length === 0) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NO_HYDRO_CODE,
        'No Hydro functions found in file',
        document.fileName
      );
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NOT_IN_WORKSPACE,
        'File is not part of a workspace',
        document.fileName
      );
    }

    this.outputChannel.appendLine(`[ScopeAnalyzer] Found ${functions.length} Hydro function(s)`);

    // Find Cargo.toml for this file
    const cargoTomlPath = await findCargoToml(workspaceFolder.uri.fsPath, document.fileName);
    if (!cargoTomlPath) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NOT_IN_WORKSPACE,
        'No Cargo.toml found for this file',
        'Cannot build without Cargo.toml'
      );
    }

    return {
      type: 'file',
      functions,
      workspaceRoot: workspaceFolder.uri.fsPath,
      activeFilePath: document.fileName,
      cargoTomlPath,
    };
  }

  /**
   * Analyze workspace-level scope (all Hydro code in workspace)
   */
  private async analyzeWorkspaceScope(): Promise<ScopeTarget> {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NOT_IN_WORKSPACE,
        'No workspace folder open'
      );
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    this.outputChannel.appendLine(`[ScopeAnalyzer] Scanning workspace: ${workspaceRoot}`);

    // Find Cargo.toml to confirm this is a Rust workspace
    const cargoTomlPath = await findCargoToml(workspaceRoot);
    if (!cargoTomlPath) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NOT_IN_WORKSPACE,
        'No Cargo.toml found in workspace',
        'This does not appear to be a Rust project'
      );
    }

    this.outputChannel.appendLine(`[ScopeAnalyzer] Found Cargo.toml at: ${cargoTomlPath}`);

    // Find all Rust files in workspace
    const rustFiles = await findRustFilesInWorkspace(workspaceRoot);
    this.outputChannel.appendLine(`[ScopeAnalyzer] Found ${rustFiles.length} Rust file(s)`);

    // Collect all Hydro functions from all files
    const allFunctions: HydroFunction[] = [];
    for (const filePath of rustFiles) {
      try {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const functions = await this.findAllHydroFunctionsInFile(document);
        allFunctions.push(...functions);
      } catch (error) {
        this.outputChannel.appendLine(
          `[ScopeAnalyzer] Warning: Failed to analyze ${filePath}: ${error}`
        );
        // Continue with other files
      }
    }

    if (allFunctions.length === 0) {
      throw new ScopeDetectionError(
        ScopeErrorCategory.NO_HYDRO_CODE,
        'No Hydro functions found in workspace',
        `Scanned ${rustFiles.length} Rust files`
      );
    }

    this.outputChannel.appendLine(
      `[ScopeAnalyzer] Found ${allFunctions.length} total Hydro function(s)`
    );

    return {
      type: 'workspace',
      functions: allFunctions,
      workspaceRoot,
      cargoTomlPath,
    };
  }

  /**
   * Find Hydro function at specific position in document
   */
  private async findHydroFunctionAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<HydroFunction | null> {
    const text = document.getText();
    const cursorLine = position.line;

    // Find all functions in the file
    const functions = this.parseFunctionsInText(text, document.fileName);

    // Find the function containing the cursor position
    for (const func of functions) {
      if (cursorLine >= func.startLine && cursorLine <= func.endLine) {
        // Check if this is a Hydro function
        if (this.isHydroFunction(func, text)) {
          this.outputChannel.appendLine(
            `[ScopeAnalyzer] Found Hydro function: ${func.name} at lines ${func.startLine + 1}-${func.endLine + 1}`
          );
          return func;
        }
      }
    }

    this.outputChannel.appendLine(
      `[ScopeAnalyzer] No Hydro function found at line ${cursorLine + 1}`
    );
    return null;
  }

  /**
   * Find all Hydro functions in a file
   */
  private async findAllHydroFunctionsInFile(
    document: vscode.TextDocument
  ): Promise<HydroFunction[]> {
    const text = document.getText();
    const allFunctions = this.parseFunctionsInText(text, document.fileName);

    // Filter to only Hydro functions and exclude test functions
    const hydroFunctions = allFunctions.filter(
      (func) => this.isHydroFunction(func, text) && !this.isInTestModule(func, text)
    );

    this.outputChannel.appendLine(
      `[ScopeAnalyzer] Found ${hydroFunctions.length} Hydro function(s) in ${document.fileName}`
    );

    return hydroFunctions;
  }

  /**
   * Read file content with size validation
   * Protected method for use in subclass implementations or testing
   */
  protected async readFileContent(filePath: string): Promise<string> {
    try {
      const stats = await fs.stat(filePath);

      if (stats.size > this.config.maxFileSize) {
        throw new ScopeDetectionError(
          ScopeErrorCategory.IO_ERROR,
          `File too large: ${stats.size} bytes (max: ${this.config.maxFileSize})`,
          filePath
        );
      }

      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (error instanceof ScopeDetectionError) {
        throw error;
      }

      throw new ScopeDetectionError(
        ScopeErrorCategory.IO_ERROR,
        `Failed to read file: ${error}`,
        filePath
      );
    }
  }

  /**
   * Check if text contains Hydro macros
   */
  private hasHydroMacros(text: string): boolean {
    return HYDRO_PATTERNS.macro.test(text);
  }

  /**
   * Parse all functions in text and return their metadata using tree-sitter
   */
  private parseFunctionsInText(text: string, filePath: string): ParsedFunction[] {
    // Use tree-sitter parser
    if (!this.rustParser) {
      throw new Error('Tree-sitter parser not initialized');
    }

    const rustFunctions = this.rustParser.parseFunctions(text);
    const modulePath = this.extractModulePath(filePath);

    return rustFunctions.map((rustFunc) => ({
      name: rustFunc.name,
      modulePath,
      filePath,
      startLine: rustFunc.startLine,
      endLine: rustFunc.endLine,
      attributes: rustFunc.attributes,
      usesMacro: this.hasHydroMacros(rustFunc.body),
      returnType: rustFunc.returnType,
    }));
  }

  /**
   * Check if a function is a Hydro function based on various markers
   */
  private isHydroFunction(func: ParsedFunction, fullText: string): boolean {
    // Check 1: Has Hydro attributes (#[hydro::flow] or #[hydro_lang::flow])
    const hasHydroAttribute = func.attributes.some(
      (attr) =>
        attr.includes('hydro::flow') ||
        attr.includes('hydro_lang::flow') ||
        attr.includes('hydro::main') ||
        attr.includes('hydro_lang::main')
    );

    if (hasHydroAttribute) {
      this.outputChannel.appendLine(`[ScopeAnalyzer] Function ${func.name} has Hydro attribute`);
      return true;
    }

    // Check 2: Uses Hydro macros (hydro_lang::flow!, etc.)
    if (func.usesMacro) {
      this.outputChannel.appendLine(`[ScopeAnalyzer] Function ${func.name} uses Hydro macro`);
      return true;
    }

    // Check 3: Returns Hydro types (Dfir, HydroFlow, etc.)
    const returnType = func.returnType;
    if (returnType) {
      const hasHydroReturnType =
        returnType.includes('Dfir') ||
        returnType.includes('HydroFlow') ||
        returnType.includes('hydroflow') ||
        returnType.includes('Process') ||
        returnType.includes('Cluster') ||
        returnType.includes('External');

      if (hasHydroReturnType) {
        this.outputChannel.appendLine(
          `[ScopeAnalyzer] Function ${func.name} returns Hydro type: ${returnType}`
        );
        return true;
      }
    }

    // Get function signature and body for pattern matching
    const lines = fullText.split('\n');
    const functionBody = lines.slice(func.startLine, func.endLine + 1).join('\n');

    // Check 4: Has FlowBuilder parameter (check entire function, not just first line)
    if (HYDRO_PATTERNS.flowBuilderParam.test(functionBody)) {
      this.outputChannel.appendLine(
        `[ScopeAnalyzer] Function ${func.name} has FlowBuilder parameter`
      );
      return true;
    }

    // Check 5: Uses FlowBuilder methods
    if (HYDRO_PATTERNS.flowBuilderMethods.test(functionBody)) {
      this.outputChannel.appendLine(
        `[ScopeAnalyzer] Function ${func.name} uses FlowBuilder methods`
      );
      return true;
    }

    // Check 6: Uses Hydro method chains
    if (HYDRO_PATTERNS.hydroMethodChains.test(functionBody)) {
      this.outputChannel.appendLine(
        `[ScopeAnalyzer] Function ${func.name} uses Hydro method chains`
      );
      return true;
    }

    // Check 7: Function body contains Hydro-specific patterns
    // Note: dfir_syntax! macro detection removed as IDE extension doesn't target DFIR

    // Look for hydro_lang::flow! or hydro::flow! macro
    if (/(?:hydro|hydro_lang)::flow!\s*\(/.test(functionBody)) {
      this.outputChannel.appendLine(
        `[ScopeAnalyzer] Function ${func.name} contains hydro flow macro`
      );
      return true;
    }

    return false;
  }

  /**
   * Check if a function is inside a #[cfg(test)] module or is a test function
   */
  private isInTestModule(func: ParsedFunction, fullText: string): boolean {
    // Check 1: Function has test attributes
    const hasTestAttribute = func.attributes.some(
      (attr) =>
        attr.includes('#[test]') ||
        attr.includes('#[tokio::test]') ||
        attr.includes('#[async_std::test]')
    );

    if (hasTestAttribute) {
      this.outputChannel.appendLine(
        `[ScopeAnalyzer] Function ${func.name} has test attribute, skipping`
      );
      return true;
    }

    // Check 2: Look backwards from the function start to find if it's in a test module
    const lines = fullText.split('\n');
    let braceDepth = 0;
    let inTestModule = false;

    // Start from the line before the function
    for (let i = func.startLine - 1; i >= 0; i--) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for #[cfg(test)] attribute BEFORE counting braces
      if (trimmed.includes('#[cfg(test)]')) {
        inTestModule = true;
        break;
      }

      // Check for mod tests { pattern
      if (trimmed.match(/mod\s+tests\s*{/) || trimmed.match(/mod\s+test\s*{/)) {
        inTestModule = true;
        break;
      }

      // Count braces to track scope depth
      // Going backwards: closing braces mean we're going deeper into parent scope
      const closingBraces = (line.match(/}/g) || []).length;
      const openingBraces = (line.match(/{/g) || []).length;
      braceDepth += closingBraces - openingBraces;

      // If we've exited the immediate parent scope, stop looking
      // We need to check at least one level up to find the module declaration
      if (braceDepth < -1) {
        break;
      }
    }

    if (inTestModule) {
      this.outputChannel.appendLine(
        `[ScopeAnalyzer] Function ${func.name} is in test module, skipping`
      );
    }

    return inTestModule;
  }

  /**
   * Extract module path from file path
   */
  private extractModulePath(filePath: string): string {
    // Extract the module path from the file path
    // For example: /path/to/project/src/module/submodule.rs -> module::submodule

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
}
