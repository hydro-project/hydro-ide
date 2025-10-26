/**
 * HydroIDE - Main orchestration class for Hydro IDE plugin
 * 
 * This class coordinates all IDE features for Hydro development:
 * - Visualization: Dataflow graph visualization powered by Hydroscope
 * - ScopeAnalyzer: Detects Hydro code at different scopes
 * - CargoOrchestrator: Builds code and extracts metadata
 * - WebviewManager: Displays visualizations and other UI
 * - ErrorHandler: Handles errors and user feedback
 * 
 * Current Features:
 * - Dataflow visualization at function/file/workspace scope
 * - Auto-refresh on file changes
 * - Export capabilities (JSON and PNG)
 * 
 * Future Features:
 * - Code completion and IntelliSense
 * - Debugging support
 * - Performance profiling
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ScopeAnalyzer } from './analysis/scopeAnalyzer';
import { CargoOrchestrator, CargoError } from './visualization/cargoOrchestrator';
import { WebviewManager } from './visualization/webviewManager';
import { ErrorHandler } from './core/errorHandler';
import { ConfigManager } from './core/config';
import { Logger } from './core/logger';
import { ProgressReporter, createCargoBuildSteps } from './core/progressReporter';
import { GraphValidator } from './visualization/graphValidator';
import { LSPGraphExtractor } from './analysis/lspGraphExtractor';
import { ScopeType, ScopeTarget, CargoConfig } from './core/types';

/**
 * HydroIDE orchestrates all IDE features for Hydro development
 * Currently focused on visualization, with plans to expand to other IDE features
 */
export class HydroIDE {
  private readonly scopeAnalyzer: ScopeAnalyzer;
  private readonly cargoOrchestrator: CargoOrchestrator;
  private readonly webviewManager: WebviewManager;
  private readonly errorHandler: ErrorHandler;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private readonly progressReporter: ProgressReporter;
  private readonly graphValidator: GraphValidator;
  private readonly lspGraphExtractor: LSPGraphExtractor;
  
  // Track current visualization state for refresh
  private currentScopeType?: ScopeType;
  private currentEditor?: vscode.TextEditor;
  
  // File watcher for auto-refresh
  private fileWatcherDisposable?: vscode.Disposable;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
  ) {
    
    // Initialize logger
    this.logger = new Logger(outputChannel, 'HydroIDE');
    this.logger.info('Initializing HydroIDE');
    
    // Initialize configuration manager
    this.configManager = new ConfigManager();
    
    // Initialize error handler
    this.errorHandler = new ErrorHandler(outputChannel, context);
    
    // Initialize progress reporter
    this.progressReporter = new ProgressReporter(this.logger);
    
    // Initialize graph validator
    const perfConfig = this.configManager.getPerformanceConfig();
    this.graphValidator = new GraphValidator(
      this.logger,
      perfConfig.largeGraphThreshold,
      perfConfig.warnOnLargeGraphs
    );
    
    // Initialize component managers
    this.scopeAnalyzer = new ScopeAnalyzer(outputChannel);
    this.cargoOrchestrator = new CargoOrchestrator(outputChannel);
    this.webviewManager = new WebviewManager(context, outputChannel);
    this.lspGraphExtractor = new LSPGraphExtractor(outputChannel);
    
    this.logger.info('HydroIDE initialized successfully');
  }

  /**
   * Visualize Hydro code using LSP (fast path)
   * Generates visualization without Cargo compilation
   */
  async visualizeScopeLSP(scopeType: ScopeType): Promise<void> {
    this.logger.section(`Visualize ${scopeType} scope (LSP)`);
    
    // Get active editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await this.errorHandler.handleError(
        new Error('No active editor found'),
        `visualize${this.capitalize(scopeType)}LSP`
      );
      return;
    }

    // Verify it's a Rust file
    if (editor.document.languageId !== 'rust') {
      await this.errorHandler.handleError(
        new Error('Active file is not a Rust file'),
        `visualize${this.capitalize(scopeType)}LSP`
      );
      return;
    }

    this.logger.keyValue('File', editor.document.fileName);
    if (scopeType === 'function') {
      const position = editor.selection.active;
      this.logger.keyValue('Cursor position', `line ${position.line + 1}, column ${position.character + 1}`);
    }

    try {
      // Analyze scope
      this.logger.info('Analyzing scope...');
      const scopeTarget = await this.scopeAnalyzer.analyzeScope(editor, scopeType);
      this.logger.info(`Found ${scopeTarget.functions.length} function(s)`);
      
      // Extract graph using LSP
      this.logger.info('Extracting graph via LSP...');
      const graphJson = await this.lspGraphExtractor.extractGraph(
        editor.document,
        scopeTarget
      );
      
      // Validate graph
      const validation = this.graphValidator.validate(JSON.stringify(graphJson));
      
      if (!validation.valid) {
        throw new Error(`Invalid graph JSON: ${validation.errors.join(', ')}`);
      }
      
      // Check for large graphs
      if (validation.stats && validation.stats.isLarge) {
        const proceed = await this.graphValidator.checkLargeGraph(validation.stats);
        if (!proceed) {
          this.logger.info('User cancelled visualization due to large graph');
          return;
        }
      }
      
      // Display visualization
      this.logger.info('Displaying visualization...');
      await this.displayVisualization(scopeTarget, JSON.stringify(graphJson));
      
      // Store current state for refresh
      this.currentScopeType = scopeType;
      this.currentEditor = editor;
      
      // Show success message
      const targetName = this.getTargetName(scopeTarget);
      this.errorHandler.showInfo(`LSP visualization displayed for: ${targetName}`);
      
      // Show performance recommendation if applicable
      if (validation.stats) {
        const recommendation = this.graphValidator.getPerformanceRecommendation(validation.stats);
        if (recommendation) {
          this.errorHandler.showInfo(recommendation);
        }
      }
    } catch (error) {
      // Detect when LSP extraction fails or times out
      // Requirements addressed:
      // - 6.1: Detect when LSP extraction fails or times out
      // - 1.5: Offer cargo fallback when LSP fails
      
      // Log fallback event for debugging
      this.logger.error(`LSP visualization failed: ${error}`);
      this.logger.warning('Offering cargo-based visualization as fallback');
      
      // Determine error type for better user messaging
      let errorMessage = 'LSP visualization failed.';
      if (error instanceof Error) {
        if (error.message.includes('timeout') || error.message.includes('timed out')) {
          errorMessage = 'LSP visualization timed out.';
          this.logger.warning('Failure reason: LSP query timeout');
        } else if (error.message.includes('rust-analyzer') || error.message.includes('LSP')) {
          errorMessage = 'LSP server not ready or unavailable.';
          this.logger.warning('Failure reason: LSP server issue');
        } else if (error.message.includes('Invalid graph')) {
          errorMessage = 'LSP extraction produced invalid graph.';
          this.logger.warning('Failure reason: Invalid graph structure');
        } else {
          this.logger.warning(`Failure reason: ${error.message}`);
        }
      }
      
      // Show user notification with "Use Cargo" option
      const selection = await this.errorHandler.showWarning(
        `${errorMessage} Try cargo-based visualization?`,
        'Use Cargo',
        'Cancel'
      );
      
      // Trigger cargo-based visualization if user accepts
      if (selection === 'Use Cargo') {
        this.logger.info('User accepted cargo fallback - switching to cargo-based visualization');
        await this.visualizeScopeCargo(scopeType);
      } else {
        this.logger.info('User declined cargo fallback');
      }
    }
  }

  /**
   * Visualize Hydro code using Cargo (complete path with backtraces)
   * Compiles code and extracts runtime information including backtrace hierarchy
   */
  async visualizeScopeCargo(scopeType: ScopeType): Promise<void> {
    this.logger.section(`Visualize ${scopeType} scope (Cargo)`);
    
    // Get active editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await this.errorHandler.handleError(
        new Error('No active editor found'),
        `visualize${this.capitalize(scopeType)}`
      );
      return;
    }

    // Verify it's a Rust file
    if (editor.document.languageId !== 'rust') {
      await this.errorHandler.handleError(
        new Error('Active file is not a Rust file'),
        `visualize${this.capitalize(scopeType)}`
      );
      return;
    }

    this.logger.keyValue('File', editor.document.fileName);
    if (scopeType === 'function') {
      const position = editor.selection.active;
      this.logger.keyValue('Cursor position', `line ${position.line + 1}, column ${position.character + 1}`);
    }

    try {
      await this.progressReporter.withCargoBuildProgress(scopeType, async (reporter, token) => {
        const steps = createCargoBuildSteps();
        
        // Check for cancellation
        if (token.isCancellationRequested) {
          this.logger.warning('Operation cancelled by user');
          return;
        }
        
        // Step 1: Analyze scope
        reporter(steps.analyzing);
        const scopeTarget = await this.scopeAnalyzer.analyzeScope(editor, scopeType);
        this.logger.info(`Found ${scopeTarget.functions.length} function(s)`);
        
        if (token.isCancellationRequested) {
          return;
        }
        
        // Step 2: Build with Cargo
        reporter(steps.building);
        const config = this.getCargoConfig(scopeTarget);
        const buildResult = await this.cargoOrchestrator.buildWithVisualization(scopeTarget, config);
        
        if (token.isCancellationRequested) {
          return;
        }
        
        // Step 3: Extract and validate JSON
        if (buildResult.success && buildResult.graphJson) {
          reporter(steps.extracting);
          
          // Validate graph
          const validation = this.graphValidator.validate(buildResult.graphJson);
          
          if (!validation.valid) {
            throw new Error(`Invalid graph JSON: ${validation.errors.join(', ')}`);
          }
          
          // Check for large graphs
          if (validation.stats && validation.stats.isLarge) {
            const proceed = await this.graphValidator.checkLargeGraph(validation.stats);
            if (!proceed) {
              this.logger.info('User cancelled visualization due to large graph');
              return;
            }
          }
          
          if (token.isCancellationRequested) {
            return;
          }
          
          // Step 4: Display in webview
          reporter(steps.rendering);
          await this.displayVisualization(scopeTarget, buildResult.graphJson);
          
          // Store current state for refresh
          this.currentScopeType = scopeType;
          this.currentEditor = editor;
          
          // Show success message
          const targetName = this.getTargetName(scopeTarget);
          this.errorHandler.showInfo(`Visualization displayed for: ${targetName}`);
          
          // Show performance recommendation if applicable
          if (validation.stats) {
            const recommendation = this.graphValidator.getPerformanceRecommendation(validation.stats);
            if (recommendation) {
              this.errorHandler.showInfo(recommendation);
            }
          }
        } else if (buildResult.success) {
          await this.errorHandler.showWarning(
            'Build succeeded but no graph JSON was found in output',
            'Show Output'
          ).then(selection => {
            if (selection === 'Show Output') {
              this.logger.show();
            }
          });
        } else {
          throw new CargoError(
            'Cargo build failed',
            buildResult.exitCode,
            buildResult.stderr,
            buildResult
          );
        }
      });
    } catch (error) {
      await this.errorHandler.handleError(error, `visualize${this.capitalize(scopeType)}`);
    }
  }

  /**
   * Visualize Hydro code at the specified scope
   * Smart router that chooses between LSP and Cargo based on configuration
   * Main entry point for visualization commands
   */
  async visualizeScope(scopeType: ScopeType): Promise<void> {
    // Read default visualization mode from configuration
    const defaultMode = this.configManager.getDefaultVisualizationMode();
    
    this.logger.info(`Using ${defaultMode} visualization mode (from configuration)`);
    
    // Route to appropriate visualization method
    if (defaultMode === 'lsp') {
      await this.visualizeScopeLSP(scopeType);
    } else {
      await this.visualizeScopeCargo(scopeType);
    }
  }

  /**
   * Refresh the current visualization
   * Rebuilds and updates the graph while preserving view state
   */
  async refresh(): Promise<void> {
    this.logger.section('Refresh Visualization');
    
    if (!this.webviewManager.hasActiveVisualization()) {
      this.errorHandler.showInfo('No active visualization to refresh');
      this.logger.warning('No active visualization');
      return;
    }

    if (!this.currentScopeType || !this.currentEditor) {
      await this.errorHandler.handleError(
        new Error('Cannot refresh: no visualization state'),
        'refresh'
      );
      return;
    }

    // Check if editor is still valid
    if (this.currentEditor.document.isClosed) {
      await this.errorHandler.handleError(
        new Error('Cannot refresh: original file is closed'),
        'refresh'
      );
      return;
    }

    this.logger.info(`Refreshing ${this.currentScopeType} scope`);

    try {
      await this.progressReporter.withCargoBuildProgress(this.currentScopeType, async (reporter, token) => {
        const steps = createCargoBuildSteps();
        
        if (token.isCancellationRequested) {
          return;
        }
        
        // Re-analyze scope
        reporter(steps.analyzing);
        const scopeTarget = await this.scopeAnalyzer.analyzeScope(
          this.currentEditor!,
          this.currentScopeType!
        );
        
        if (token.isCancellationRequested) {
          return;
        }
        
        // Rebuild
        reporter(steps.building);
        const config = this.getCargoConfig(scopeTarget);
        const buildResult = await this.cargoOrchestrator.buildWithVisualization(scopeTarget, config);
        
        if (token.isCancellationRequested) {
          return;
        }
        
        if (buildResult.success && buildResult.graphJson) {
          reporter(steps.extracting);
          
          // Validate graph
          const validation = this.graphValidator.validate(buildResult.graphJson);
          if (!validation.valid) {
            throw new Error(`Invalid graph JSON: ${validation.errors.join(', ')}`);
          }
          
          if (token.isCancellationRequested) {
            return;
          }
          
          // Refresh webview (preserves view state)
          reporter(steps.rendering);
          await this.webviewManager.refresh(buildResult.graphJson);
          
          this.errorHandler.showInfo('Visualization refreshed');
          this.logger.info('Visualization refreshed successfully');
        } else {
          throw new CargoError(
            'Refresh failed: build failed',
            buildResult.exitCode,
            buildResult.stderr,
            buildResult
          );
        }
      });
    } catch (error) {
      await this.errorHandler.handleError(error, 'refresh');
    }
  }

  /**
   * Export current visualization as JSON
   */
  async exportJson(): Promise<void> {
    this.logger.info('Export JSON requested');
    
    if (!this.webviewManager.hasActiveVisualization()) {
      this.errorHandler.showInfo('No active visualization to export');
      return;
    }

    try {
      await this.webviewManager.exportJson();
    } catch (error) {
      await this.errorHandler.handleError(error, 'exportJson');
    }
  }

  /**
   * Export current visualization as PNG
   */
  async exportPng(): Promise<void> {
    this.logger.info('Export PNG requested');
    
    if (!this.webviewManager.hasActiveVisualization()) {
      this.errorHandler.showInfo('No active visualization to export');
      return;
    }

    try {
      await this.webviewManager.exportPng();
    } catch (error) {
      await this.errorHandler.handleError(error, 'exportPng');
    }
  }

  /**
   * Handle file change events for auto-refresh
   * Called when a Rust file is saved
   */
  async handleFileChange(document: vscode.TextDocument): Promise<void> {
    // Only process if auto-refresh is enabled
    if (!this.configManager.getAutoRefresh()) {
      return;
    }

    // Only process if there's an active visualization
    if (!this.webviewManager.hasActiveVisualization()) {
      return;
    }

    // Only process if the panel is visible
    if (!this.webviewManager.isPanelVisibleAndActive()) {
      this.logger.info('Skipping auto-refresh: panel not visible');
      return;
    }

    // Check if the changed file is related to current visualization
    if (!this.isRelatedFile(document)) {
      this.logger.info('Skipping auto-refresh: file not related to current visualization');
      return;
    }

    this.logger.info(`Auto-refresh triggered by file save: ${document.fileName}`);
    
    // Trigger refresh
    await this.refresh();
  }

  /**
   * Set up file watcher for auto-refresh
   * Should be called during extension activation
   */
  setupFileWatcher(): vscode.Disposable {
    const autoRefresh = this.configManager.getAutoRefresh();
    this.logger.info(`Setting up file watcher (auto-refresh: ${autoRefresh})`);

    // Debounce timer for file changes
    let debounceTimer: NodeJS.Timeout | undefined;
    const DEBOUNCE_DELAY = 1000; // 1 second

    this.fileWatcherDisposable = vscode.workspace.onDidSaveTextDocument(
      (document: vscode.TextDocument) => {
        // Only process Rust files
        if (document.languageId !== 'rust') {
          return;
        }

        // Check if auto-refresh is enabled (may have changed since setup)
        if (!this.configManager.getAutoRefresh()) {
          return;
        }

        // Check if there's an active visualization
        if (!this.webviewManager.hasActiveVisualization()) {
          return;
        }

        this.logger.info(`File saved: ${document.fileName}`);
        
        // Clear existing debounce timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          this.logger.info('Debouncing - clearing previous timer');
        }

        // Set new debounce timer
        debounceTimer = setTimeout(() => {
          this.logger.info('Debounce complete - triggering auto-refresh');
          debounceTimer = undefined;
          
          this.handleFileChange(document).catch(error => {
            this.logger.error(`Auto-refresh failed: ${error}`);
          });
        }, DEBOUNCE_DELAY);
        
        this.logger.info(`Debounce timer set (${DEBOUNCE_DELAY}ms)`);
      }
    );

    return this.fileWatcherDisposable;
  }

  /**
   * Handle configuration changes
   * Updates component configurations when settings change
   */
  handleConfigurationChange(): void {
    this.logger.info('Configuration changed - reloading');
    
    // Reload configuration
    this.configManager.reloadConfig();
    
    const newConfig = this.configManager.getConfig();
    this.logger.subsection('Updated Configuration');
    this.logger.keyValue('Auto-refresh', newConfig.autoRefresh);
    this.logger.keyValue('Release mode', newConfig.cargo.releaseMode);
    this.logger.keyValue('Large graph threshold', newConfig.performance.largeGraphThreshold);
    
    // Update graph validator configuration
    this.graphValidator.updateConfig(
      newConfig.performance.largeGraphThreshold,
      newConfig.performance.warnOnLargeGraphs
    );
    
    // Show notification for significant changes
    if (newConfig.autoRefresh !== this.configManager.getAutoRefresh()) {
      const status = newConfig.autoRefresh ? 'enabled' : 'disabled';
      this.errorHandler.showInfo(`Auto-refresh ${status}`);
    }
  }

  /**
   * Dispose of resources
   * Called during extension deactivation
   */
  dispose(): void {
    this.logger.info('Disposing HydroIDE');
    
    // Dispose file watcher
    if (this.fileWatcherDisposable) {
      this.fileWatcherDisposable.dispose();
    }
    
    // Dispose components
    this.cargoOrchestrator.dispose();
    this.webviewManager.dispose();
    this.logger.dispose();
  }

  /**
   * Display visualization in webview
   * Private helper method
   */
  private async displayVisualization(
    scopeTarget: ScopeTarget,
    graphJson: string
  ): Promise<void> {
    const targetName = this.getTargetName(scopeTarget);
    const graphConfig = this.configManager.getGraphConfig();
    
    await this.webviewManager.showVisualization(graphJson, {
      scopeType: scopeTarget.type,
      targetName,
      graphConfig,
    });
  }

  /**
   * Get Cargo configuration for build
   * Private helper method
   */
  private getCargoConfig(scopeTarget: ScopeTarget): CargoConfig {
    const cargoConfig = this.configManager.getCargoConfig();
    
    // Use the Cargo.toml path from scope target, or fall back to workspace root
    const manifestPath = scopeTarget.cargoTomlPath || path.join(scopeTarget.workspaceRoot, 'Cargo.toml');
    
    // Use the features as specified, don't automatically add viz
    // The viz functionality should be available through dev-dependencies
    const features = [...cargoConfig.features];
    
    return {
      manifestPath,
      features,
      releaseMode: cargoConfig.releaseMode,
      timeout: cargoConfig.timeout,
    };
  }

  /**
   * Get display name for scope target
   * Private helper method
   */
  private getTargetName(scopeTarget: ScopeTarget): string {
    switch (scopeTarget.type) {
      case 'function':
        return scopeTarget.functions[0]?.name || 'Unknown Function';
      case 'file':
        return scopeTarget.activeFilePath
          ? path.basename(scopeTarget.activeFilePath)
          : 'Unknown File';
      case 'workspace':
        return path.basename(scopeTarget.workspaceRoot);
    }
  }

  /**
   * Check if a document is related to the current visualization
   * Private helper method
   */
  private isRelatedFile(document: vscode.TextDocument): boolean {
    if (!this.currentEditor) {
      return false;
    }

    // For function and file scope, check if it's the same file
    if (this.currentScopeType === 'function' || this.currentScopeType === 'file') {
      return document.fileName === this.currentEditor.document.fileName;
    }

    // For workspace scope, any Rust file in the workspace is related
    if (this.currentScopeType === 'workspace') {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const currentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(
        this.currentEditor.document.uri
      );
      return workspaceFolder?.uri.fsPath === currentWorkspaceFolder?.uri.fsPath;
    }

    return false;
  }

  /**
   * Capitalize first letter of string
   * Private helper method
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
