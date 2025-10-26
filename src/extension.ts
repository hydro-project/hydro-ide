import * as vscode from 'vscode';
import { HydroIDE } from './hydroIDE';
import * as locationColorizer from './coloring/locationColorizer';
import * as locationAnalyzer from './analysis/locationAnalyzer';

/**
 * Output channel for logging extension operations
 */
let outputChannel: vscode.OutputChannel;

/**
 * Main HydroIDE instance
 */
let hydroIDE: HydroIDE;

/**
 * Debounce timer for document change events
 * 
 * DEBOUNCING IMPLEMENTATION:
 * - Delays analysis execution until user stops typing
 * - Prevents excessive re-analysis during rapid typing
 * - Timer is reset on each document change (debounce restart)
 * - Immediate analysis bypasses debounce (on save, open, switch)
 * 
 * EXAMPLE:
 * - User types "hello" rapidly (5 keystrokes in 500ms)
 * - Without debounce: 5 analyses triggered (wasteful)
 * - With debounce (500ms): 1 analysis after user stops typing
 * - Result: 80% reduction in analysis overhead
 */
let debounceTimer: NodeJS.Timeout | undefined;

/**
 * Status bar item for showing analysis status
 * 
 * Displays current analysis state in VSCode status bar:
 * - "$(sync~spin) Analyzing locations..." - Analysis in progress
 * - "$(check) Locations ready" - Analysis complete (auto-hides after 3s)
 * - "$(sync~spin) Waiting for rust-analyzer..." - Waiting for LSP
 * - "$(error) Analysis failed" - Error occurred (auto-hides after 3s)
 */
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Timer for auto-hiding the status bar
 * 
 * AUTO-HIDE LOGIC:
 * - Status bar shows for important events (analysis complete, errors)
 * - Auto-hides after 3 seconds to reduce visual clutter
 * - Timer is cleared if new status is shown before timeout
 * - "Analyzing..." status does not auto-hide (stays visible during work)
 */
let statusHideTimer: NodeJS.Timeout | undefined;

/**
 * Flag to track if rust-analyzer is ready
 * 
 * RUST-ANALYZER READY DETECTION:
 * - rust-analyzer needs time to index project after startup
 * - Analysis requires semantic tokens from rust-analyzer
 * - This flag tracks when rust-analyzer is ready to provide tokens
 * - Documents opened before ready are queued for analysis
 */
let rustAnalyzerReady = false;

/**
 * Set of document URIs waiting for rust-analyzer to be ready
 * 
 * DEFERRED ANALYSIS QUEUE:
 * - Documents opened before rust-analyzer is ready are added here
 * - When rust-analyzer becomes ready, all queued documents are analyzed
 * - Prevents "no semantic tokens" errors during startup
 * - Queue is cleared after processing
 */
const documentsWaitingForAnalysis = new Set<string>();

/**
 * Extension activation entry point
 * Called when the extension is activated (on Rust file open or command invocation)
 */
export function activate(context: vscode.ExtensionContext) {
  // Create output channel for logging
  outputChannel = vscode.window.createOutputChannel('Hydro IDE');
  outputChannel.appendLine('Hydro IDE extension activated');
  outputChannel.appendLine(`Extension path: ${context.extensionPath}`);
  outputChannel.appendLine(`VSCode version: ${vscode.version}`);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  // Initialize HydroIDE orchestrator
  hydroIDE = new HydroIDE(context, outputChannel);

  // Initialize location colorizer with output channel
  locationColorizer.initializeDecorationTypes(outputChannel);

  // Register visualization commands
  registerVisualizationCommands(context);

  // Register refresh and export commands
  registerUtilityCommands(context);

  // Register location colorization commands
  registerLocationColorizationCommands(context);

  // Set up file watcher for auto-refresh
  context.subscriptions.push(hydroIDE.setupFileWatcher());

  // Set up configuration change handler
  setupConfigurationChangeHandler(context);

  // Set up rust-analyzer ready detection
  setupRustAnalyzerReadyDetection(context);

  outputChannel.appendLine('All commands registered successfully');
}

/**
 * Show a status message in the status bar
 * 
 * STATUS BAR MANAGEMENT:
 * - Provides visual feedback about analysis state
 * - Supports auto-hide to reduce clutter after completion
 * - Clears previous auto-hide timer to prevent premature hiding
 * 
 * AUTO-HIDE BEHAVIOR:
 * - autoHide=false: Status stays visible (e.g., "Analyzing...")
 * - autoHide=true: Status hides after 3 seconds (e.g., "Ready", "Failed")
 * - Timer is cleared if new status is shown before timeout
 * 
 * USAGE EXAMPLES:
 * - showStatus('$(sync~spin) Analyzing...', false) - Show until complete
 * - showStatus('$(check) Ready', true) - Show briefly then hide
 * - showStatus('$(error) Failed', true) - Show error briefly
 * 
 * @param message The message to display (supports VSCode icons like $(sync~spin))
 * @param autoHide If true, hide the status bar after 3 seconds
 */
export function showStatus(message: string, autoHide: boolean = false): void {
  if (!statusBarItem) {
    return;
  }

  // Clear any existing auto-hide timer to prevent premature hiding
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = undefined;
  }

  // Update status bar text and show it
  statusBarItem.text = message;
  statusBarItem.show();

  // Set up auto-hide timer if requested
  if (autoHide) {
    statusHideTimer = setTimeout(() => {
      if (statusBarItem) {
        statusBarItem.hide();
      }
      statusHideTimer = undefined;
    }, 3000); // Hide after 3 seconds
  }
}

/**
 * Register commands for visualizing Hydro code at different scopes
 */
function registerVisualizationCommands(context: vscode.ExtensionContext) {
  // Visualize function at cursor (smart router - uses configured default mode)
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFunction', async () => {
      await hydroIDE.visualizeScope('function');
    })
  );

  // Visualize all functions in current file (smart router - uses configured default mode)
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFile', async () => {
      await hydroIDE.visualizeScope('file');
    })
  );

  // Visualize all Hydro code in workspace (smart router - uses configured default mode)
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeWorkspace', async () => {
      await hydroIDE.visualizeScope('workspace');
    })
  );

  // LSP-specific commands (fast path without compilation)
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFunctionLSP', async () => {
      await hydroIDE.visualizeScopeLSP('function');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFileLSP', async () => {
      await hydroIDE.visualizeScopeLSP('file');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeWorkspaceLSP', async () => {
      await hydroIDE.visualizeScopeLSP('workspace');
    })
  );

  // Cargo-specific commands (complete path with backtraces)
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFunctionCargo', async () => {
      await hydroIDE.visualizeScopeCargo('function');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFileCargo', async () => {
      await hydroIDE.visualizeScopeCargo('file');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeWorkspaceCargo', async () => {
      await hydroIDE.visualizeScopeCargo('workspace');
    })
  );
}

/**
 * Register utility commands for refresh and export operations
 */
function registerUtilityCommands(context: vscode.ExtensionContext) {
  // Refresh current visualization
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.refresh', async () => {
      await hydroIDE.refresh();
    })
  );

  // Export visualization as JSON
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.exportJson', async () => {
      await hydroIDE.exportJson();
    })
  );

  // Export visualization as PNG
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.exportPng', async () => {
      await hydroIDE.exportPng();
    })
  );
}

/**
 * Check if rust-analyzer extension is active
 */
async function isRustAnalyzerActive(): Promise<boolean> {
  const rustAnalyzer = vscode.extensions.getExtension('rust-lang.rust-analyzer');
  if (!rustAnalyzer) {
    return false;
  }
  
  if (!rustAnalyzer.isActive) {
    try {
      await rustAnalyzer.activate();
    } catch (error) {
      return false;
    }
  }
  
  return rustAnalyzer.isActive;
}

/**
 * Handle rust-analyzer becoming ready
 * Triggers analysis for all visible Rust documents that were waiting
 */
async function onRustAnalyzerReady() {
  if (rustAnalyzerReady) {
    return; // Already processed
  }
  
  rustAnalyzerReady = true;
  outputChannel.appendLine('[RustAnalyzer] rust-analyzer is now ready');
  
  // Update status bar
  showStatus('$(check) rust-analyzer ready', true);
  
  // Trigger analysis for all waiting documents
  if (documentsWaitingForAnalysis.size > 0) {
    outputChannel.appendLine(`[RustAnalyzer] Triggering analysis for ${documentsWaitingForAnalysis.size} waiting documents`);
    
    for (const uri of documentsWaitingForAnalysis) {
      const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri);
      if (document) {
        const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
        if (editor) {
          outputChannel.appendLine(`[RustAnalyzer] Analyzing waiting document: ${document.fileName}`);
          scheduleAnalysis(editor, true);
        }
      }
    }
    
    documentsWaitingForAnalysis.clear();
  }
  
  // Also trigger analysis for all currently visible Rust documents
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.languageId === 'rust') {
      const uri = editor.document.uri.toString();
      if (!documentsWaitingForAnalysis.has(uri)) {
        outputChannel.appendLine(`[RustAnalyzer] Analyzing visible document: ${editor.document.fileName}`);
        scheduleAnalysis(editor, true);
      }
    }
  }
}

/**
 * Check if rust-analyzer is ready and has semantic tokens for a document
 * If not ready, adds document to waiting list
 */
async function checkRustAnalyzerReadyAndSchedule(editor: vscode.TextEditor, immediate: boolean = false): Promise<boolean> {
  if (rustAnalyzerReady) {
    scheduleAnalysis(editor, immediate);
    return true;
  }
  
  // Check if rust-analyzer is active
  const isActive = await isRustAnalyzerActive();
  if (!isActive) {
    outputChannel.appendLine(`[RustAnalyzer] rust-analyzer not active for ${editor.document.fileName}, adding to waiting list`);
    documentsWaitingForAnalysis.add(editor.document.uri.toString());
    showStatus('$(sync~spin) Waiting for rust-analyzer...', false);
    return false;
  }
  
  // Check if semantic tokens are available
  const hasTokens = await hasSemanticTokens(editor.document);
  if (hasTokens) {
    // rust-analyzer is ready!
    await onRustAnalyzerReady();
    return true;
  } else {
    outputChannel.appendLine(`[RustAnalyzer] Semantic tokens not ready for ${editor.document.fileName}, adding to waiting list`);
    documentsWaitingForAnalysis.add(editor.document.uri.toString());
    showStatus('$(sync~spin) Waiting for rust-analyzer...', false);
    return false;
  }
}

/**
 * Check if rust-analyzer has semantic tokens ready for a document
 */
async function hasSemanticTokens(document: vscode.TextDocument): Promise<boolean> {
  try {
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      document.uri
    );
    return tokens !== null && tokens !== undefined && tokens.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Automatically colorize a Rust file if enabled and rust-analyzer is available
 */
async function autoColorizeIfReady(editor: vscode.TextEditor) {
  if (editor.document.languageId !== 'rust') {
    return;
  }

  // Check if location coloring is enabled
  const config = vscode.workspace.getConfiguration('hydroIde');
  const coloringEnabled = config.get<boolean>('locationColoring.enabled', true);
  
  if (!coloringEnabled) {
    outputChannel.appendLine('[AutoColorize] Location coloring is disabled');
    return;
  }

  const rustAnalyzerActive = await isRustAnalyzerActive();
  if (!rustAnalyzerActive) {
    outputChannel.appendLine('[AutoColorize] rust-analyzer is not active');
    return;
  }

  outputChannel.appendLine(`[AutoColorize] Waiting for semantic tokens for ${editor.document.fileName}`);

  // Wait for rust-analyzer to have semantic tokens ready
  // Try up to 10 times with 500ms delays (5 seconds total)
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const hasTokens = await hasSemanticTokens(editor.document);
    if (hasTokens) {
      outputChannel.appendLine(`[AutoColorize] Semantic tokens ready after ${(attempt + 1) * 500}ms, colorizing...`);
      // Wait one more second to be safe, then colorize
      setTimeout(() => {
        locationColorizer.colorizeFile(editor);
      }, 1000);
      return;
    }
  }
  
  // If we get here, rust-analyzer didn't provide tokens in time
  outputChannel.appendLine('[AutoColorize] Timeout waiting for semantic tokens - use manual colorize command');
}

/**
 * Schedule analysis for a document with optional debouncing
 * 
 * DEBOUNCING LOGIC:
 * 1. Check if analysis is enabled in configuration
 * 2. Verify document is a Rust file
 * 3. Clear any existing debounce timer (restart debounce)
 * 4. Get debounce delay from configuration (default: 500ms)
 * 5. Schedule analysis with setTimeout
 * 6. If immediate=true, use 0ms delay (bypass debounce)
 * 
 * DEBOUNCE RESTART:
 * - Each call clears the previous timer
 * - This delays analysis until user stops typing
 * - Example: User types 5 keys in 500ms
 *   - Key 1: Schedule analysis in 500ms
 *   - Key 2: Cancel previous, schedule in 500ms
 *   - Key 3: Cancel previous, schedule in 500ms
 *   - Key 4: Cancel previous, schedule in 500ms
 *   - Key 5: Cancel previous, schedule in 500ms
 *   - Result: Only 1 analysis runs, 500ms after last keystroke
 * 
 * IMMEDIATE ANALYSIS:
 * - Used for: file open, file save, file switch
 * - Bypasses debounce (delay=0) for instant feedback
 * - Still clears pending debounced analysis to avoid duplicate work
 * 
 * @param editor The text editor to analyze
 * @param immediate If true, run analysis immediately without debouncing
 */
function scheduleAnalysis(editor: vscode.TextEditor, immediate: boolean = false) {
  // Check if analysis is enabled in configuration
  const config = vscode.workspace.getConfiguration('hydroIde');
  const enabled = config.get<boolean>('analysis.enabled', true);
  
  if (!enabled) {
    outputChannel.appendLine('[ScheduleAnalysis] Analysis is disabled');
    return;
  }

  // Only analyze Rust files
  if (editor.document.languageId !== 'rust') {
    return;
  }

  // DEBOUNCE RESTART: Clear existing timer to delay analysis
  // This is the core of debouncing - each new event resets the timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }

  // Get debounce delay from configuration (default: 500ms)
  // If immediate=true, use 0ms delay to bypass debounce
  const delay = immediate ? 0 : config.get<number>('analysis.debounceDelay', 500);

  // Schedule the analysis with setTimeout
  // Timer will be cleared if another change occurs before delay expires
  debounceTimer = setTimeout(async () => {
    outputChannel.appendLine(`[ScheduleAnalysis] Running analysis for ${editor.document.fileName} (immediate: ${immediate})`);
    await locationColorizer.colorizeFile(editor);
    debounceTimer = undefined; // Clear timer after analysis completes
  }, delay);
}

/**
 * Register location colorization commands
 */
function registerLocationColorizationCommands(context: vscode.ExtensionContext) {
  // Manual colorize command
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.colorizeLocations', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'rust') {
        const rustAnalyzerActive = await isRustAnalyzerActive();
        if (!rustAnalyzerActive) {
          vscode.window.showWarningMessage('rust-analyzer is not active. Please wait for it to start.');
          return;
        }
        await locationColorizer.colorizeFile(editor);
      } else {
        vscode.window.showInformationMessage('Please open a Rust file to colorize locations.');
      }
    })
  );

  // Clear colorizations command
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.clearColorizations', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        locationColorizer.clearColorizations(editor);
        vscode.window.showInformationMessage('Location colorizations cleared.');
      }
    })
  );

  // Clear type cache command
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.clearTypeCache', () => {
      locationColorizer.clearCache();
      vscode.window.showInformationMessage('Type cache cleared. Re-colorize to rebuild cache.');
    })
  );

  // Show cache statistics command
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.showCacheStats', () => {
      const stats = locationAnalyzer.getCacheStats();
      
      // Format statistics for display
      const message = [
        'Location Analyzer Cache Statistics:',
        '',
        `Total Files Cached: ${stats.numFiles}`,
        `Cache Hits: ${stats.hits}`,
        `Cache Misses: ${stats.misses}`,
        `Hit Rate: ${stats.hitRatePercent}%`,
        '',
        `Cache Size Limit: ${vscode.workspace.getConfiguration('hydroIde').get<number>('performance.cacheSize', 50)} entries`
      ].join('\n');
      
      // Display in output channel
      outputChannel.appendLine('');
      outputChannel.appendLine('='.repeat(60));
      outputChannel.appendLine(message);
      outputChannel.appendLine('='.repeat(60));
      outputChannel.show();
      
      // Also show a brief notification
      vscode.window.showInformationMessage(
        `Cache: ${stats.numFiles} files, ${stats.hitRatePercent}% hit rate`
      );
    })
  );

  // Clear analysis cache command
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.clearCache', () => {
      // Clear the location analyzer cache
      locationAnalyzer.clearCache();
      
      // Clear decorations in the active editor
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        locationColorizer.clearColorizations(editor);
      }
      
      // Trigger re-analysis if a Rust file is open
      if (editor && editor.document.languageId === 'rust') {
        const config = vscode.workspace.getConfiguration('hydroIde');
        const coloringEnabled = config.get<boolean>('locationColoring.enabled', true);
        
        if (coloringEnabled) {
          // Re-colorize after a short delay to allow cache to clear
          setTimeout(() => {
            locationColorizer.colorizeFile(editor);
          }, 100);
        }
      }
      
      vscode.window.showInformationMessage('Analysis cache cleared and re-analyzing...');
    })
  );

  // Handle document change events (typing)
  // 
  // DEBOUNCED ANALYSIS ON TYPE:
  // - Triggered on every keystroke in a Rust file
  // - scheduleAnalysis() with immediate=false uses debounce delay
  // - Each keystroke resets the debounce timer
  // - Analysis only runs after user stops typing for debounceDelay ms
  // - Can be disabled with analyzeOnType=false configuration
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document && event.document.languageId === 'rust') {
        const config = vscode.workspace.getConfiguration('hydroIde');
        const analyzeOnType = config.get<boolean>('analysis.analyzeOnType', true);
        
        if (analyzeOnType) {
          // Schedule debounced analysis (immediate=false)
          // Timer will be reset on next keystroke
          scheduleAnalysis(editor, false);
        }
      }
    })
  );

  // Handle document save events
  // 
  // IMMEDIATE ANALYSIS ON SAVE:
  // - Triggered when user saves a Rust file (Ctrl+S / Cmd+S)
  // - scheduleAnalysis() with immediate=true bypasses debounce (delay=0)
  // - Provides instant feedback after save
  // - Also clears cache to get fresh type information from rust-analyzer
  // - Can be disabled with analyzeOnSave=false configuration
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && document === editor.document && document.languageId === 'rust') {
        const config = vscode.workspace.getConfiguration('hydroIde');
        const analyzeOnSave = config.get<boolean>('analysis.analyzeOnSave', true);
        
        if (analyzeOnSave) {
          // Schedule immediate analysis (immediate=true, no debounce)
          scheduleAnalysis(editor, true);
        }
        
        // Clear cache for this file to get fresh types from rust-analyzer
        // rust-analyzer may have updated type information after save
        locationColorizer.clearCache(document.uri.toString());
      }
    })
  );

  // Handle document open events
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && document === editor.document && document.languageId === 'rust') {
        // Schedule immediate analysis for newly opened documents (once rust-analyzer is ready)
        await checkRustAnalyzerReadyAndSchedule(editor, true);
      }
    })
  );

  // Handle document close events
  // 
  // CLEANUP ON DOCUMENT CLOSE:
  // - Clear pending debounce timer (no need to analyze closed document)
  // - Schedule cache invalidation after 60 seconds
  // - Delayed invalidation allows quick re-open without re-analysis
  // - After 60s, cache entry is cleared to free memory
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.languageId === 'rust') {
        // Clear any pending debounce timer for this document
        // No point analyzing a document that's no longer visible
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        
        // Schedule cache invalidation after 60 seconds
        // Delayed to allow quick re-open without re-analysis
        // If user re-opens within 60s, cached results are still available
        const documentUri = document.uri.toString();
        setTimeout(() => {
          outputChannel.appendLine(`[DocumentClose] Clearing cache for closed document: ${document.fileName}`);
          locationAnalyzer.clearCache(documentUri);
        }, 60000); // 60 seconds delay
      }
    })
  );

  // Automatically colorize when opening or switching to a Rust file
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && editor.document.languageId === 'rust') {
        // Check if rust-analyzer is ready and schedule analysis
        await checkRustAnalyzerReadyAndSchedule(editor, true);
      }
    })
  );

  // Re-colorize when configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Handle location coloring enabled/disabled
      if (e.affectsConfiguration('hydroIde.locationColoring.enabled')) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const config = vscode.workspace.getConfiguration('hydroIde');
          const coloringEnabled = config.get<boolean>('locationColoring.enabled', true);
          
          if (coloringEnabled) {
            autoColorizeIfReady(editor);
          } else {
            // Clear colorizations when disabled
            locationColorizer.clearColorizations(editor);
          }
        }
      }
      
      // Handle color configuration changes
      if (e.affectsConfiguration('hydroIde.colors')) {
        outputChannel.appendLine('[ConfigChange] Color configuration changed, clearing decoration types...');
        
        // Clear decoration types so they get recreated with new colors
        locationColorizer.clearDecorationTypes();
        
        // Trigger re-colorization of active editor
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'rust') {
          const config = vscode.workspace.getConfiguration('hydroIde');
          const coloringEnabled = config.get<boolean>('locationColoring.enabled', true);
          
          if (coloringEnabled) {
            outputChannel.appendLine('[ConfigChange] Re-colorizing active editor with new colors...');
            // Schedule immediate re-colorization
            scheduleAnalysis(editor, true);
          }
        }
      }
    })
  );

  // Re-colorize when theme changes (to update colors for new theme)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'rust') {
        const config = vscode.workspace.getConfiguration('hydroIde');
        const coloringEnabled = config.get<boolean>('locationColoring.enabled', true);
        
        if (coloringEnabled) {
          // Clear old decorations and re-colorize with new theme colors
          locationColorizer.clearCache();
          autoColorizeIfReady(editor);
        }
      }
    })
  );



  // Colorize the currently active editor on startup
  if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'rust') {
    checkRustAnalyzerReadyAndSchedule(vscode.window.activeTextEditor, true);
  }
}



/**
 * Set up configuration change handler
 */
function setupConfigurationChangeHandler(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration('hydroIde')) {
        hydroIDE.handleConfigurationChange();
      }
    })
  );
  
  outputChannel.appendLine('Configuration change handler registered');
}

/**
 * Set up rust-analyzer ready detection
 * Monitors rust-analyzer extension and triggers analysis when it becomes ready
 */
function setupRustAnalyzerReadyDetection(context: vscode.ExtensionContext) {
  outputChannel.appendLine('[RustAnalyzer] Setting up rust-analyzer ready detection');
  
  // Listen for rust-analyzer extension activation
  const rustAnalyzer = vscode.extensions.getExtension('rust-lang.rust-analyzer');
  if (rustAnalyzer) {
    if (rustAnalyzer.isActive) {
      outputChannel.appendLine('[RustAnalyzer] rust-analyzer is already active');
      // Check if it's ready by testing semantic tokens on visible documents
      setTimeout(async () => {
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document.languageId === 'rust') {
            const hasTokens = await hasSemanticTokens(editor.document);
            if (hasTokens) {
              await onRustAnalyzerReady();
              break;
            }
          }
        }
      }, 1000);
    } else {
      outputChannel.appendLine('[RustAnalyzer] rust-analyzer is not active yet, will monitor for activation');
    }
  } else {
    outputChannel.appendLine('[RustAnalyzer] rust-analyzer extension not found');
  }
  
  // Periodically check if rust-analyzer becomes ready (for documents waiting for analysis)
  const checkInterval = setInterval(async () => {
    if (rustAnalyzerReady || documentsWaitingForAnalysis.size === 0) {
      return;
    }
    
    // Check if rust-analyzer is now ready
    const isActive = await isRustAnalyzerActive();
    if (!isActive) {
      return;
    }
    
    // Check if semantic tokens are available for any waiting document
    for (const uri of documentsWaitingForAnalysis) {
      const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri);
      if (document) {
        const hasTokens = await hasSemanticTokens(document);
        if (hasTokens) {
          await onRustAnalyzerReady();
          break;
        }
      }
    }
  }, 2000); // Check every 2 seconds
  
  // Clean up interval on deactivation
  context.subscriptions.push({
    dispose: () => {
      clearInterval(checkInterval);
    }
  });
  
  outputChannel.appendLine('[RustAnalyzer] rust-analyzer ready detection configured');
}

/**
 * Extension deactivation cleanup
 * 
 * CLEANUP RESPONSIBILITIES:
 * 1. Clear all timers (debounce, status hide)
 * 2. Dispose UI elements (status bar)
 * 3. Clear state (rust-analyzer ready, waiting documents)
 * 4. Clear caches (analysis cache)
 * 5. Dispose components (HydroIDE, colorizer, output channel)
 * 
 * IMPORTANCE:
 * - Prevents memory leaks from active timers
 * - Releases VSCode resources properly
 * - Ensures clean state for next activation
 * - Required for proper extension lifecycle management
 * 
 * Called when:
 * - Extension is disabled by user
 * - VSCode is closing
 * - Extension is being updated
 * - Window is reloading
 */
export function deactivate() {
  outputChannel.appendLine('Hydro IDE extension deactivated');
  
  // Clear debounce timer to prevent analysis after deactivation
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  
  // Clear status hide timer to prevent UI updates after deactivation
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = undefined;
  }
  
  // Dispose status bar item to release VSCode resources
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
  
  // Clear rust-analyzer ready state and waiting queue
  rustAnalyzerReady = false;
  documentsWaitingForAnalysis.clear();
  
  // Clear analysis cache to free memory
  locationAnalyzer.clearCache();
  
  // Dispose HydroIDE (which disposes all visualization components)
  if (hydroIDE) {
    hydroIDE.dispose();
  }

  // Dispose location colorizer (clears decoration types)
  locationColorizer.dispose();
  
  // Dispose output channel
  if (outputChannel) {
    outputChannel.dispose();
  }
}
