import * as vscode from 'vscode';
import { HydroIDE } from './hydroIDE';
import * as locationColorizer from './locationColorizer';

/**
 * Output channel for logging extension operations
 */
let outputChannel: vscode.OutputChannel;

/**
 * Main HydroIDE instance
 */
let hydroIDE: HydroIDE;

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

  outputChannel.appendLine('All commands registered successfully');
}

/**
 * Register commands for visualizing Hydro code at different scopes
 */
function registerVisualizationCommands(context: vscode.ExtensionContext) {
  // Visualize function at cursor
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFunction', async () => {
      await hydroIDE.visualizeScope('function');
    })
  );

  // Visualize all functions in current file
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeFile', async () => {
      await hydroIDE.visualizeScope('file');
    })
  );

  // Visualize all Hydro code in workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('hydro-ide.visualizeWorkspace', async () => {
      await hydroIDE.visualizeScope('workspace');
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
    return;
  }

  const rustAnalyzerActive = await isRustAnalyzerActive();
  if (!rustAnalyzerActive) {
    return;
  }

  // Wait for rust-analyzer to have semantic tokens ready
  // Try up to 10 times with 500ms delays (5 seconds total)
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const hasTokens = await hasSemanticTokens(editor.document);
    if (hasTokens) {
      // Wait one more second to be safe, then colorize
      setTimeout(() => {
        locationColorizer.colorizeFile(editor);
      }, 1000);
      return;
    }
  }
  
  // If we get here, rust-analyzer didn't provide tokens in time
  // Don't colorize automatically - user can trigger manually
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

  // Automatically colorize when opening or switching to a Rust file
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        autoColorizeIfReady(editor);
      }
    })
  );

  // Re-colorize when configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
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

  // Clear cache when rust-analyzer restarts or file is saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === 'rust') {
        // Clear cache for this specific file to get fresh types
        locationColorizer.clearCache(document.uri.toString());
      }
    })
  );

  // Colorize the currently active editor on startup
  if (vscode.window.activeTextEditor) {
    autoColorizeIfReady(vscode.window.activeTextEditor);
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
 * Extension deactivation cleanup
 * Called when the extension is deactivated
 */
export function deactivate() {
  outputChannel.appendLine('Hydro IDE extension deactivated');
  
  // Dispose HydroIDE (which disposes all components)
  if (hydroIDE) {
    hydroIDE.dispose();
  }

  // Dispose location colorizer
  locationColorizer.dispose();
  
  // Dispose output channel
  if (outputChannel) {
    outputChannel.dispose();
  }
}
