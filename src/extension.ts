import * as vscode from 'vscode';
import { HydroIDE } from './hydroIDE';

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

  // Register visualization commands
  registerVisualizationCommands(context);

  // Register refresh and export commands
  registerUtilityCommands(context);

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
  
  // Dispose output channel
  if (outputChannel) {
    outputChannel.dispose();
  }
}
