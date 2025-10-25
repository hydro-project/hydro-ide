/**
 * CargoOrchestrator - Manages Cargo build integration for Hydro visualization
 *
 * This class is responsible for:
 * - Constructing Cargo build commands with appropriate flags
 * - Executing Cargo builds with stdout/stderr capture
 * - Managing build processes (cancellation, timeout)
 * - Extracting JSON output from build results
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import { ScopeTarget, HydroFunction } from './types';

/**
 * Configuration for Cargo builds
 */
export interface CargoConfig {
  /** Path to Cargo.toml */
  manifestPath: string;

  /** Target triple (optional) */
  target?: string;

  /** Additional features to enable */
  features: string[];

  /** Build in release mode */
  releaseMode: boolean;

  /** Build timeout in milliseconds */
  timeout: number;
}

/**
 * Result of a Cargo build operation
 */
export interface BuildResult {
  /** Whether the build succeeded */
  success: boolean;

  /** Extracted graph JSON (if successful) */
  graphJson?: string;

  /** Compilation errors */
  errors: string[];

  /** Compilation warnings */
  warnings: string[];

  /** Full stdout output */
  stdout: string;

  /** Full stderr output */
  stderr: string;

  /** Exit code */
  exitCode: number;
}

/**
 * Error thrown during Cargo operations
 */
export class CargoError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
    public readonly buildResult?: BuildResult
  ) {
    super(message);
    this.name = 'CargoError';
  }
}

/**
 * CargoOrchestrator class for managing Cargo builds
 */
export class CargoOrchestrator {
  private outputChannel: vscode.OutputChannel;
  private currentProcess?: ChildProcess;
  private currentProcessAbortController?: AbortController;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Build Hydro code with visualization enabled
   */
  async buildWithVisualization(target: ScopeTarget, config: CargoConfig): Promise<BuildResult> {
    this.outputChannel.appendLine('[CargoOrchestrator] Starting build');
    this.outputChannel.appendLine(`[CargoOrchestrator] Manifest: ${config.manifestPath}`);
    this.outputChannel.appendLine(`[CargoOrchestrator] Release mode: ${config.releaseMode}`);
    this.outputChannel.appendLine(`[CargoOrchestrator] Features: ${config.features.join(', ')}`);

    let testFilePath: string | undefined;

    try {
      // For function/file scope, create temporary test file
      if (target.type !== 'workspace') {
        testFilePath = await this.createVisualizationTest(target);
        this.outputChannel.appendLine(`[CargoOrchestrator] Created test file: ${testFilePath}`);
      }

      // Construct Cargo command
      const args = this.buildCargoArgs(target, config);
      this.outputChannel.appendLine(`[CargoOrchestrator] Command: cargo ${args.join(' ')}`);

      // Execute Cargo build
      const result = await this.executeCargo(args, config);

      this.outputChannel.appendLine(
        `[CargoOrchestrator] Build ${result.success ? 'succeeded' : 'failed'} (exit code: ${result.exitCode})`
      );

      // Extract JSON from output if build succeeded
      if (result.success) {
        const graphJson = this.extractGraphJson(result.stdout, target);
        if (graphJson) {
          result.graphJson = graphJson;
          this.outputChannel.appendLine('[CargoOrchestrator] Successfully extracted graph JSON');
        } else {
          this.outputChannel.appendLine(
            '[CargoOrchestrator] Warning: No graph JSON found in output'
          );
        }
      }

      return result;
    } catch (error) {
      if (error instanceof CargoError) {
        throw error;
      }

      throw new CargoError(
        `Cargo build failed: ${error}`,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      // Clean up temporary test file
      if (testFilePath) {
        try {
          await fs.unlink(testFilePath);
          this.outputChannel.appendLine(
            `[CargoOrchestrator] Cleaned up test file: ${testFilePath}`
          );
        } catch (error) {
          this.outputChannel.appendLine(
            `[CargoOrchestrator] Warning: Failed to clean up test file: ${error}`
          );
        }
      }
    }
  }

  /**
   * Build Cargo command arguments
   */
  private buildCargoArgs(target: ScopeTarget, config: CargoConfig): string[] {
    // For visualization, we need to actually run the test to get output, not just compile
    const args: string[] = ['test'];

    // Add manifest path
    args.push('--manifest-path', config.manifestPath);

    // Add features if specified
    const features = [...config.features];
    if (features.length > 0) {
      args.push('--features', features.join(','));
    }

    // Add release mode flag
    if (config.releaseMode) {
      args.push('--release');
    }

    // Add target if specified
    if (config.target) {
      args.push('--target', config.target);
    }

    // For function/file scope, specify the test name
    if (target.type !== 'workspace') {
      args.push('--test', 'hydro_viz_temp');
      // Add -- --nocapture to see test output
      args.push('--', '--nocapture');
    }

    return args;
  }

  /**
   * Create temporary test file for visualization
   */
  private async createVisualizationTest(target: ScopeTarget): Promise<string> {
    // Get the crate directory from the Cargo.toml path
    if (!target.cargoTomlPath) {
      throw new CargoError('No Cargo.toml path found in target');
    }

    const crateDir = path.dirname(target.cargoTomlPath);
    const testsDir = path.join(crateDir, 'tests');

    // Ensure tests directory exists
    try {
      await fs.mkdir(testsDir, { recursive: true });
    } catch (error) {
      throw new CargoError(`Failed to create tests directory: ${error}`);
    }

    // Generate test code
    const testCode = await this.generateVisualizationTestCode(target);

    // Write test file
    const testFilePath = path.join(testsDir, 'hydro_viz_temp.rs');
    try {
      await fs.writeFile(testFilePath, testCode, 'utf-8');
      this.outputChannel.appendLine(
        `[CargoOrchestrator] Generated test file content:\n${testCode}`
      );
    } catch (error) {
      throw new CargoError(`Failed to write test file: ${error}`);
    }

    return testFilePath;
  }

  /**
   * Generate Rust test code that builds and visualizes Hydro flows
   */
  private async generateVisualizationTestCode(target: ScopeTarget): Promise<string> {
    const functions = target.functions;

    // Get the crate name from Cargo.toml
    const crateName = await this.getCrateName(target.cargoTomlPath!);

    // Generate imports for each function and deduplicate
    const allImports = functions.map((func) =>
      this.generateFunctionImport(func, crateName, target.cargoTomlPath!)
    );
    const uniqueImports = [...new Set(allImports)];
    const imports = uniqueImports.join('\n');

    // Generate test body for each function
    const testBodies = functions
      .map((func, index) => this.generateFunctionTestBody(func, index))
      .join('\n\n');

    return `
// Auto-generated test file for Hydro visualization
// This file is temporary and will be deleted after the build

${imports}

#[test]
fn visualize_hydro_flows() {
${testBodies}
}
`.trim();
  }

  /**
   * Get crate name from Cargo.toml
   */
  private async getCrateName(cargoTomlPath: string): Promise<string> {
    try {
      const content = await fs.readFile(cargoTomlPath, 'utf-8');
      const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (nameMatch) {
        return nameMatch[1];
      }
      throw new Error('Could not find crate name in Cargo.toml');
    } catch (error) {
      throw new CargoError(`Failed to read crate name from Cargo.toml: ${error}`);
    }
  }

  /**
   * Generate import statement for a Hydro function
   */
  private generateFunctionImport(
    func: HydroFunction,
    crateName: string,
    cargoTomlPath: string
  ): string {
    // Build the module path from the file location
    const crateDir = path.dirname(cargoTomlPath);
    const srcDir = path.join(crateDir, 'src');
    const relativePath = path.relative(srcDir, func.filePath);

    // Convert file path to module path
    // e.g., "cluster/compute_pi.rs" -> "cluster::compute_pi"
    const modulePath = relativePath
      .replace(/\.rs$/, '')
      .replace(/\/mod$/, '')
      .replace(/\//g, '::')
      .replace(/^main$/, 'crate')
      .replace(/^lib$/, 'crate');

    // Convert crate name from kebab-case to snake_case for Rust imports
    // e.g., "hydro-template" -> "hydro_template"
    const rustCrateName = crateName.replace(/-/g, '_');

    // Build the full import path
    // For lib.rs or main.rs at root, use crate::function_name
    // Otherwise use crate_name::module::function_name
    if (modulePath === 'crate') {
      return `use ${rustCrateName}::${func.name};`;
    } else {
      return `use ${rustCrateName}::${modulePath}::${func.name};`;
    }
  }

  /**
   * Generate test body code for a single function
   */
  private generateFunctionTestBody(func: HydroFunction, index: number): string {
    // Generate code that:
    // 1. Creates a FlowBuilder
    // 2. Calls the Hydro function with default parameters
    // 3. Finalizes the builder to get the IR
    // 4. Generates JSON using the visualization API
    // 5. Prints JSON with markers for extraction

    // This approach creates Process/Cluster objects from FlowBuilder
    // and calls the function with those parameters

    return `
    // Visualize function: ${func.name}
    {

        
        eprintln!("[DEBUG] Step 1: Creating FlowBuilder");
        let flow = hydro_lang::compile::builder::FlowBuilder::new();
        
        eprintln!("[DEBUG] Step 2: Creating Process and Cluster objects");
        let leader = flow.process();
        let workers = flow.cluster();
        
        eprintln!("[DEBUG] Step 3: Calling function ${func.name}");
        ${func.name}(&leader, &workers);
        
        eprintln!("[DEBUG] Step 4: Finalizing builder");
        let built = flow.finalize();
        
        eprintln!("[DEBUG] Step 5: Getting graph API");
        let graph_api = built.graph_api();
        
        println!("__HYDRO_VIZ_JSON_START_${index}__");
        
        // Try different API methods based on what's available
        eprintln!("[DEBUG] Step 6: Attempting to generate JSON");
        
        eprintln!("[DEBUG] Using hydroscope_to_string method");
        let json_output = graph_api.hydroscope_to_string(false, true, true);
        
        eprintln!("[DEBUG] Generated {} bytes of JSON output", json_output.len());
        println!("{}", json_output);
        
        println!("__HYDRO_VIZ_JSON_END_${index}__");
    }
`.trim();
  }

  /**
   * Execute Cargo command with timeout and cancellation support
   */
  private async executeCargo(args: string[], config: CargoConfig): Promise<BuildResult> {
    return new Promise((resolve, reject) => {
      const workspaceDir = path.dirname(config.manifestPath);

      this.outputChannel.appendLine(`[CargoOrchestrator] Working directory: ${workspaceDir}`);

      // Create abort controller for timeout and cancellation
      this.currentProcessAbortController = new AbortController();
      const { signal } = this.currentProcessAbortController;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.outputChannel.appendLine('[CargoOrchestrator] Build timeout - cancelling');
        this.currentProcessAbortController?.abort();
      }, config.timeout);

      // Spawn Cargo process
      this.currentProcess = spawn('cargo', args, {
        cwd: workspaceDir,
        signal,
      });

      let stdout = '';
      let stderr = '';

      // Capture stdout
      this.currentProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        // Always log stdout for debugging
        this.outputChannel.appendLine(`[Cargo stdout] ${text.trim()}`);
      });

      // Capture stderr
      this.currentProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        // Always log stderr for debugging
        this.outputChannel.appendLine(`[Cargo stderr] ${text.trim()}`);
      });

      // Handle process completion
      this.currentProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        this.currentProcess = undefined;
        this.currentProcessAbortController = undefined;

        const exitCode = code ?? -1;
        const success = exitCode === 0;

        this.outputChannel.appendLine(`[CargoOrchestrator] Process exited with code ${exitCode}`);

        // Parse errors and warnings from stderr
        const errors = this.parseErrors(stderr);
        const warnings = this.parseWarnings(stderr);

        resolve({
          success,
          exitCode,
          stdout,
          stderr,
          errors,
          warnings,
        });
      });

      // Handle process errors
      this.currentProcess.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        this.currentProcess = undefined;
        this.currentProcessAbortController = undefined;

        this.outputChannel.appendLine(`[CargoOrchestrator] Process error: ${error.message}`);

        if (error.message.includes('ENOENT')) {
          reject(
            new CargoError(
              'Cargo not found. Please ensure Rust and Cargo are installed.',
              undefined,
              error.message
            )
          );
        } else {
          reject(new CargoError(`Failed to execute Cargo: ${error.message}`));
        }
      });
    });
  }

  /**
   * Parse error messages from Cargo stderr
   */
  private parseErrors(stderr: string): string[] {
    const errors: string[] = [];
    const lines = stderr.split('\n');

    let currentError: string[] = [];
    let inErrorBlock = false;

    for (const line of lines) {
      // Detect start of error block
      if (line.includes('error:') || line.includes('error[E')) {
        if (currentError.length > 0) {
          errors.push(currentError.join('\n'));
        }
        currentError = [line.trim()];
        inErrorBlock = true;
      } else if (inErrorBlock) {
        // Continue collecting error context
        if (
          line.trim().startsWith('-->') ||
          line.trim().startsWith('|') ||
          line.trim().startsWith('=')
        ) {
          currentError.push(line.trim());
        } else if (line.trim() === '') {
          // Empty line might end the error block
          if (currentError.length > 0) {
            errors.push(currentError.join('\n'));
            currentError = [];
          }
          inErrorBlock = false;
        } else if (line.includes('error:') || line.includes('warning:')) {
          // New error/warning starts
          if (currentError.length > 0) {
            errors.push(currentError.join('\n'));
            currentError = [];
          }
          inErrorBlock = false;
        }
      }
    }

    // Add last error if any
    if (currentError.length > 0) {
      errors.push(currentError.join('\n'));
    }

    return errors;
  }

  /**
   * Parse warning messages from Cargo stderr
   */
  private parseWarnings(stderr: string): string[] {
    const warnings: string[] = [];
    const lines = stderr.split('\n');

    let currentWarning: string[] = [];
    let inWarningBlock = false;

    for (const line of lines) {
      // Detect start of warning block
      if (line.includes('warning:')) {
        if (currentWarning.length > 0) {
          warnings.push(currentWarning.join('\n'));
        }
        currentWarning = [line.trim()];
        inWarningBlock = true;
      } else if (inWarningBlock) {
        // Continue collecting warning context
        if (
          line.trim().startsWith('-->') ||
          line.trim().startsWith('|') ||
          line.trim().startsWith('=')
        ) {
          currentWarning.push(line.trim());
        } else if (line.trim() === '') {
          // Empty line might end the warning block
          if (currentWarning.length > 0) {
            warnings.push(currentWarning.join('\n'));
            currentWarning = [];
          }
          inWarningBlock = false;
        } else if (line.includes('error:') || line.includes('warning:')) {
          // New error/warning starts
          if (currentWarning.length > 0) {
            warnings.push(currentWarning.join('\n'));
            currentWarning = [];
          }
          inWarningBlock = false;
        }
      }
    }

    // Add last warning if any
    if (currentWarning.length > 0) {
      warnings.push(currentWarning.join('\n'));
    }

    return warnings;
  }

  /**
   * Format error messages for display to user
   */
  formatErrorsForDisplay(errors: string[]): string {
    if (errors.length === 0) {
      return 'Build failed with no specific error messages';
    }

    if (errors.length === 1) {
      return this.formatSingleError(errors[0]);
    }

    // Multiple errors - show summary
    const summary = `Build failed with ${errors.length} error(s):\n\n`;
    const formattedErrors = errors
      .slice(0, 3) // Show first 3 errors
      .map((error, index) => `${index + 1}. ${this.formatSingleError(error)}`)
      .join('\n\n');

    const remaining = errors.length > 3 ? `\n\n... and ${errors.length - 3} more error(s)` : '';

    return summary + formattedErrors + remaining;
  }

  /**
   * Format a single error message
   */
  private formatSingleError(error: string): string {
    // Extract the main error message (first line)
    const lines = error.split('\n');
    const mainError = lines[0];

    // Try to extract file location if present
    const locationMatch = error.match(/-->\s*(.+):(\d+):(\d+)/);
    if (locationMatch) {
      const [, file, line, col] = locationMatch;
      return `${mainError}\n  at ${file}:${line}:${col}`;
    }

    return mainError;
  }

  /**
   * Extract relevant error information for logging
   */
  extractErrorDetails(result: BuildResult): {
    summary: string;
    details: string;
    suggestions: string[];
  } {
    const summary =
      result.errors.length > 0
        ? `Compilation failed with ${result.errors.length} error(s)`
        : 'Compilation failed';

    const details = [
      `Exit code: ${result.exitCode}`,
      '',
      'Errors:',
      ...result.errors.map((e, i) => `${i + 1}. ${e}`),
    ].join('\n');

    const suggestions: string[] = [];

    // Analyze errors for common issues and provide suggestions
    const allErrors = result.errors.join('\n');

    if (allErrors.includes('could not find') || allErrors.includes('unresolved import')) {
      suggestions.push('Check that all dependencies are listed in Cargo.toml');
      suggestions.push('Run "cargo check" to verify the project builds correctly');
    }

    if (allErrors.includes('feature') || allErrors.includes('cfg')) {
      suggestions.push('Ensure the "viz" feature is properly configured in Cargo.toml');
    }

    if (allErrors.includes('macro') || allErrors.includes('hydro')) {
      suggestions.push('Verify that hydro_lang or dfir_rs is properly imported');
      suggestions.push('Check that Hydro functions are properly annotated');
    }

    if (allErrors.includes('type') || allErrors.includes('trait')) {
      suggestions.push('Ensure all Hydro types are correctly imported');
    }

    if (suggestions.length === 0) {
      suggestions.push('Check the output channel for full error details');
      suggestions.push('Verify that the project builds with "cargo build"');
    }

    return { summary, details, suggestions };
  }

  /**
   * Cancel the current build process
   */
  cancel(): void {
    if (this.currentProcess && this.currentProcessAbortController) {
      this.outputChannel.appendLine('[CargoOrchestrator] Cancelling build');
      this.currentProcessAbortController.abort();
      this.currentProcess = undefined;
      this.currentProcessAbortController = undefined;
    }
  }

  /**
   * Check if a build is currently in progress
   */
  isBuilding(): boolean {
    return this.currentProcess !== undefined;
  }

  /**
   * Extract graph JSON from Cargo output
   */
  private extractGraphJson(stdout: string, target: ScopeTarget): string | undefined {
    this.outputChannel.appendLine('[CargoOrchestrator] Extracting JSON from output');

    // For workspace builds, look for a single JSON block
    if (target.type === 'workspace') {
      return this.extractSingleJsonBlock(stdout);
    }

    // For function/file builds, extract JSON for each function
    const jsonBlocks: unknown[] = [];
    for (let i = 0; i < target.functions.length; i++) {
      const json = this.extractJsonBlock(stdout, i);
      if (json) {
        try {
          const parsed: unknown = JSON.parse(json);
          jsonBlocks.push(parsed);
        } catch (error) {
          this.outputChannel.appendLine(
            `[CargoOrchestrator] Warning: Failed to parse JSON for function ${i}: ${error}`
          );
        }
      }
    }

    if (jsonBlocks.length === 0) {
      return undefined;
    }

    // If we have multiple functions, combine them into a single graph
    if (jsonBlocks.length > 1) {
      return JSON.stringify(this.combineGraphs(jsonBlocks));
    }

    return JSON.stringify(jsonBlocks[0]);
  }

  /**
   * Extract a single JSON block from output (for workspace builds)
   */
  private extractSingleJsonBlock(stdout: string): string | undefined {
    const startMarker = '__HYDRO_VIZ_JSON_START__';
    const endMarker = '__HYDRO_VIZ_JSON_END__';

    const startIdx = stdout.indexOf(startMarker);
    const endIdx = stdout.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
      return undefined;
    }

    const json = stdout.substring(startIdx + startMarker.length, endIdx).trim();

    // Validate JSON
    try {
      JSON.parse(json);
      return json;
    } catch (error) {
      this.outputChannel.appendLine(`[CargoOrchestrator] Invalid JSON: ${error}`);
      return undefined;
    }
  }

  /**
   * Extract JSON block for a specific function index
   */
  private extractJsonBlock(stdout: string, index: number): string | undefined {
    const startMarker = `__HYDRO_VIZ_JSON_START_${index}__`;
    const endMarker = `__HYDRO_VIZ_JSON_END_${index}__`;

    const startIdx = stdout.indexOf(startMarker);
    const endIdx = stdout.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
      this.outputChannel.appendLine(
        `[CargoOrchestrator] No JSON markers found for function ${index}`
      );
      return undefined;
    }

    const rawContent = stdout.substring(startIdx + startMarker.length, endIdx).trim();

    // Filter out non-JSON lines (status messages from generate_graph_with_config)
    const lines = rawContent.split('\n');
    const jsonLines = lines.filter((line) => {
      const trimmed = line.trim();
      // Skip empty lines and status messages
      if (!trimmed) return false;
      if (trimmed.startsWith('Generated:')) return false;
      if (trimmed.startsWith('Graph written to')) return false;
      return true;
    });

    const cleanedContent = jsonLines.join('\n').trim();
    this.outputChannel.appendLine(
      `[CargoOrchestrator] Extracted ${cleanedContent.length} characters of content`
    );

    // Check if this is DOT format (starts with "digraph" or "graph")
    if (cleanedContent.startsWith('digraph') || cleanedContent.startsWith('graph')) {
      this.outputChannel.appendLine(
        `[CargoOrchestrator] Detected DOT format, converting to Hydroscope JSON`
      );

      try {
        const hydroscopeJson = this.convertDotToHydroscopeJson(cleanedContent);
        this.outputChannel.appendLine(
          `[CargoOrchestrator] Successfully converted DOT to Hydroscope format`
        );
        return hydroscopeJson;
      } catch (error) {
        this.outputChannel.appendLine(`[CargoOrchestrator] DOT conversion failed: ${error}`);
        // Fallback to wrapper format
        const dotJson = JSON.stringify({
          format: 'dot',
          data: cleanedContent,
          message: 'DOT format detected - conversion failed',
        });
        return dotJson;
      }
    }

    return cleanedContent;
  }

  /**
   * Combine multiple graph JSONs into a single graph
   */
  private combineGraphs(graphs: unknown[]): unknown {
    // Simple combination strategy: merge all nodes and edges
    const combined = {
      nodes: [] as unknown[],
      edges: [] as unknown[],
      hierarchyChoices: [] as unknown[],
      nodeAssignments: {} as Record<string, unknown>,
      selectedHierarchy: 'location',
      edgeStyleConfig: {} as Record<string, unknown>,
      nodeTypeConfig: {} as Record<string, unknown>,
      legend: {} as Record<string, unknown>,
    };

    for (const graph of graphs) {
      const graphObj = graph as Record<string, unknown>;

      // The JSON structure has nodes/edges at the top level, not nested under 'graph'
      if (graphObj.nodes && Array.isArray(graphObj.nodes)) {
        combined.nodes.push(...graphObj.nodes);
      }
      if (graphObj.edges && Array.isArray(graphObj.edges)) {
        combined.edges.push(...graphObj.edges);
      }

      // Copy metadata from the first graph
      if (combined.hierarchyChoices.length === 0) {
        if (graphObj.hierarchyChoices) {
          combined.hierarchyChoices = graphObj.hierarchyChoices as unknown[];
        }
        if (graphObj.nodeAssignments) {
          combined.nodeAssignments = graphObj.nodeAssignments as Record<string, unknown>;
        }
        if (graphObj.selectedHierarchy) {
          combined.selectedHierarchy = graphObj.selectedHierarchy as string;
        }
        if (graphObj.edgeStyleConfig) {
          combined.edgeStyleConfig = graphObj.edgeStyleConfig as Record<string, unknown>;
        }
        if (graphObj.nodeTypeConfig) {
          combined.nodeTypeConfig = graphObj.nodeTypeConfig as Record<string, unknown>;
        }
        if (graphObj.legend) {
          combined.legend = graphObj.legend as Record<string, unknown>;
        }
      }
    }

    return combined;
  }

  /**
   * Validate JSON against Hydroscope specification
   */
  validateGraphJson(json: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const parsed = JSON.parse(json);

      // Check for required top-level structure
      if (!parsed.graph && !parsed.nodes) {
        errors.push('Missing required "graph" or "nodes" property');
      }

      // Check for nodes array
      const nodes = parsed.graph?.nodes || parsed.nodes;
      if (!Array.isArray(nodes)) {
        errors.push('Missing or invalid "nodes" array');
      }

      // Check for edges array
      const edges = parsed.graph?.edges || parsed.edges;
      if (!Array.isArray(edges)) {
        errors.push('Missing or invalid "edges" array');
      }

      // Validate node structure
      if (Array.isArray(nodes)) {
        for (let i = 0; i < Math.min(nodes.length, 10); i++) {
          const node = nodes[i];
          if (!node.id) {
            errors.push(`Node at index ${i} missing required "id" property`);
          }
        }
      }

      // Validate edge structure
      if (Array.isArray(edges)) {
        for (let i = 0; i < Math.min(edges.length, 10); i++) {
          const edge = edges[i];
          if (!edge.source || !edge.target) {
            errors.push(`Edge at index ${i} missing required "source" or "target" property`);
          }
        }
      }
    } catch (error) {
      errors.push(`Invalid JSON: ${error}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Convert DOT format to Hydroscope JSON format
   */
  private convertDotToHydroscopeJson(dotContent: string): string {
    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];

    // Parse DOT content to extract nodes and edges
    const lines = dotContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Parse node definitions: n21 [label="(21) cast", shape=box, fillcolor="#ffffb3"]
      const nodeMatch = trimmed.match(/^n(\d+)\s*\[label="([^"]+)".*?\]/);
      if (nodeMatch) {
        const [, id, label] = nodeMatch;
        nodes.push({
          id: id,
          label: label.replace(/^\(\d+\)\s*/, ''), // Remove number prefix
          nodeType: this.inferNodeTypeFromLabel(label),
          data: {
            locationId: null,
            locationType: null,
            backtrace: [],
          },
        });
        continue;
      }

      // Parse edge definitions: n0 -> n1
      const edgeMatch = trimmed.match(/^n(\d+)\s*->\s*n(\d+)(?:\s*\[([^\]]+)\])?/);
      if (edgeMatch) {
        const [, source, target, attributes] = edgeMatch;
        const edge: Record<string, unknown> = {
          id: `e${edges.length}`,
          source: source,
          target: target,
          semanticTags: ['Local', 'Stream', 'TotalOrder', 'Unbounded'],
        };

        // Parse edge attributes if present
        if (attributes) {
          const labelMatch = attributes.match(/label="([^"]+)"/);
          if (labelMatch) {
            edge.label = labelMatch[1];
          }

          if (attributes.includes('dashed')) {
            edge.semanticTags = ['Network', 'Stream', 'TotalOrder', 'Unbounded'];
          }
        }

        edges.push(edge);
      }
    }

    // Create basic Hydroscope JSON structure
    const hydroscopeData = {
      nodes,
      edges,
      hierarchyChoices: [
        {
          id: 'location',
          name: 'Location',
          children: [],
        },
      ],
      nodeAssignments: {
        location: {},
      },
      selectedHierarchy: 'location',
      edgeStyleConfig: {
        semanticMappings: {},
        semanticPriorities: [],
      },
      nodeTypeConfig: {
        defaultType: 'Transform',
        types: [
          { id: 'Source', label: 'Source', colorIndex: 0 },
          { id: 'Transform', label: 'Transform', colorIndex: 1 },
          { id: 'Aggregation', label: 'Aggregation', colorIndex: 2 },
          { id: 'Sink', label: 'Sink', colorIndex: 3 },
          { id: 'Network', label: 'Network', colorIndex: 4 },
        ],
      },
      legend: {
        title: 'Node Types',
        items: [
          { type: 'Source', label: 'Source' },
          { type: 'Transform', label: 'Transform' },
          { type: 'Aggregation', label: 'Aggregation' },
          { type: 'Sink', label: 'Sink' },
          { type: 'Network', label: 'Network' },
        ],
      },
    };

    return JSON.stringify(hydroscopeData);
  }

  /**
   * Infer node type from DOT label
   */
  private inferNodeTypeFromLabel(label: string): string {
    const cleanLabel = label.toLowerCase().replace(/^\(\d+\)\s*/, '');

    if (cleanLabel.includes('source')) return 'Source';
    if (cleanLabel.includes('sink') || cleanLabel.includes('for_each')) return 'Sink';
    if (
      cleanLabel.includes('fold') ||
      cleanLabel.includes('reduce') ||
      cleanLabel.includes('aggregate')
    )
      return 'Aggregation';
    if (cleanLabel.includes('network')) return 'Network';

    return 'Transform';
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cancel();
  }
}
