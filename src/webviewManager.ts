/**
 * WebviewManager - Manages webview panel lifecycle and communication
 * 
 * Responsibilities:
 * - Create and manage webview panels
 * - Handle panel reuse vs. new panel creation
 * - Implement panel disposal and cleanup
 * - Set up message passing between extension and webview
 */

import * as vscode from 'vscode';

/**
 * View state for preserving zoom and pan across updates
 * Matches ReactFlow's Viewport interface
 */
export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Current state of the webview
 */
export interface WebviewState {
  graphJson: string;
  viewState?: ViewState;
  scopeType?: 'function' | 'file' | 'workspace';
  targetName?: string;
}

/**
 * Message types sent from extension to webview
 */
export type ExtensionToWebviewMessage =
  | { 
      type: 'updateGraph'; 
      graphJson: string; 
      viewState?: ViewState;
      graphConfig?: {
        showMetadata?: boolean;
        showLocationGroups?: boolean;
        useShortLabels?: boolean;
      };
    }
  | { type: 'exportPng' }
  | { type: 'exportJson' };

/**
 * Message types sent from webview to extension
 */
export type WebviewToExtensionMessage =
  | { type: 'viewStateChanged'; viewState: ViewState }
  | { type: 'exportPngData'; dataUrl: string }
  | { type: 'exportJsonData'; jsonData: string }
  | { type: 'error'; message: string; details?: string }
  | { type: 'ready' }
  | { type: 'nodeSelected'; nodeId: string; metadata: unknown };

/**
 * WebviewManager handles all webview panel operations
 */
export class WebviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private currentState: WebviewState | undefined;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private isPanelVisible: boolean = false;

  constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.context = context;
    this.outputChannel = outputChannel;
  }

  /**
   * Show visualization in webview panel
   * Reuses existing panel if available, creates new one otherwise
   */
  async showVisualization(
    graphJson: string,
    options?: {
      scopeType?: 'function' | 'file' | 'workspace';
      targetName?: string;
      preserveViewState?: boolean;
      graphConfig?: {
        showMetadata?: boolean;
        showLocationGroups?: boolean;
        useShortLabels?: boolean;
      };
    }
  ): Promise<void> {
    this.outputChannel.appendLine('[WebviewManager] Showing visualization');

    // Validate graph JSON
    try {
      JSON.parse(graphJson);
    } catch (error) {
      throw new Error(`Invalid graph JSON: ${error}`);
    }

    if (this.panel) {
      // Reuse existing panel
      this.outputChannel.appendLine('[WebviewManager] Reusing existing panel');
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.isPanelVisible = true;
    } else {
      // Create new panel
      this.outputChannel.appendLine('[WebviewManager] Creating new panel');
      this.createPanel();
    }

    // Update panel title based on scope
    if (options?.targetName) {
      const scopeLabel = options.scopeType === 'function' ? 'Function' :
                        options.scopeType === 'file' ? 'File' :
                        'Workspace';
      this.panel!.title = `Hydro: ${scopeLabel} - ${options.targetName}`;
    }

    // Preserve view state if requested and available
    const viewState = options?.preserveViewState && this.currentState?.viewState
      ? this.currentState.viewState
      : undefined;

    // Send graph data to webview with configuration
    await this.postMessage({
      type: 'updateGraph',
      graphJson,
      viewState,
      graphConfig: options?.graphConfig,
    });

    // Update current state
    this.currentState = {
      graphJson,
      viewState,
      scopeType: options?.scopeType,
      targetName: options?.targetName,
    };

    this.outputChannel.appendLine('[WebviewManager] Visualization displayed');
  }

  /**
   * Refresh the current visualization
   * Rebuilds and updates the graph while preserving view state
   */
  async refresh(graphJson: string): Promise<void> {
    if (!this.panel) {
      this.outputChannel.appendLine('[WebviewManager] No active panel to refresh');
      throw new Error('No active visualization to refresh');
    }

    this.outputChannel.appendLine('[WebviewManager] Refreshing visualization');

    // Validate graph JSON
    try {
      JSON.parse(graphJson);
    } catch (error) {
      throw new Error(`Invalid graph JSON: ${error}`);
    }

    // Send updated graph with preserved view state
    await this.postMessage({
      type: 'updateGraph',
      graphJson,
      viewState: this.currentState?.viewState,
    });

    // Update state
    if (this.currentState) {
      this.currentState.graphJson = graphJson;
    }

    this.outputChannel.appendLine('[WebviewManager] Visualization refreshed');
  }

  /**
   * Export current visualization as JSON
   * Requests JSON data from webview
   */
  async exportJson(): Promise<void> {
    if (!this.panel || !this.currentState) {
      throw new Error('No active visualization to export');
    }

    this.outputChannel.appendLine('[WebviewManager] Requesting JSON export from webview');

    // Request JSON export from webview
    await this.postMessage({
      type: 'exportJson',
    });

    // The webview will respond with a 'exportJsonData' message containing the JSON
    // This is handled in handleWebviewMessage
  }

  /**
   * Export current visualization as PNG
   * Requests PNG data from webview
   */
  async exportPng(): Promise<void> {
    if (!this.panel || !this.currentState) {
      throw new Error('No active visualization to export');
    }

    this.outputChannel.appendLine('[WebviewManager] Requesting PNG export from webview');

    // Request PNG export from webview
    await this.postMessage({
      type: 'exportPng',
    });

    // The webview will respond with a 'exportPngData' message containing the data URL
    // This is handled in handleWebviewMessage
  }

  /**
   * Check if there's an active visualization
   */
  hasActiveVisualization(): boolean {
    return this.panel !== undefined && this.currentState !== undefined;
  }

  /**
   * Check if the visualization panel is visible
   */
  isPanelVisibleAndActive(): boolean {
    return this.hasActiveVisualization() && this.isPanelVisible;
  }

  /**
   * Get current visualization state
   */
  getCurrentState(): WebviewState | undefined {
    return this.currentState;
  }

  /**
   * Dispose of the webview manager and clean up resources
   */
  dispose(): void {
    this.outputChannel.appendLine('[WebviewManager] Disposing');
    
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }

    this.currentState = undefined;

    // Dispose all disposables
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }

  /**
   * Create a new webview panel with proper configuration
   */
  private createPanel(): void {
    this.panel = vscode.window.createWebviewPanel(
      'hydroIde',
      'Hydro Dataflow Graph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        ],
      }
    );

    // Track initial visibility
    this.isPanelVisible = this.panel.visible;

    // Set up panel disposal handler
    this.panel.onDidDispose(
      () => {
        this.outputChannel.appendLine('[WebviewManager] Panel disposed');
        this.panel = undefined;
        this.currentState = undefined;
        this.isPanelVisible = false;
      },
      null,
      this.disposables
    );

    // Set up visibility change handler
    this.panel.onDidChangeViewState(
      (e) => {
        this.isPanelVisible = e.webviewPanel.visible;
        this.outputChannel.appendLine(`[WebviewManager] Panel visibility changed: ${this.isPanelVisible}`);
      },
      null,
      this.disposables
    );

    // Set up message handler
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => this.handleWebviewMessage(message),
      null,
      this.disposables
    );

    // Set webview HTML content
    this.panel.webview.html = this.getWebviewContent(this.panel.webview);

    this.outputChannel.appendLine('[WebviewManager] Panel created');
  }

  /**
   * Generate HTML content for the webview
   */
  private getWebviewContent(webview: vscode.Webview): string {
    // Get URIs for bundled assets
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );

    // Generate a nonce for Content Security Policy
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    img-src ${webview.cspSource} data:;
    font-src ${webview.cspSource};
    connect-src ${webview.cspSource};
  ">
  <title>Hydro Dataflow Graph</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Generate a cryptographically secure nonce for CSP
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Handle messages received from the webview
   */
  private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.outputChannel.appendLine('[WebviewManager] Webview ready');
        break;

      case 'viewStateChanged':
        this.outputChannel.appendLine('[WebviewManager] View state changed');
        if (this.currentState) {
          this.currentState.viewState = message.viewState;
        }
        break;

      case 'exportPngData':
        this.outputChannel.appendLine('[WebviewManager] Received PNG data from webview');
        await this.handlePngExport(message.dataUrl);
        break;

      case 'exportJsonData':
        this.outputChannel.appendLine('[WebviewManager] Received JSON data from webview');
        await this.handleJsonExport(message.jsonData);
        break;

      case 'nodeSelected':
        this.outputChannel.appendLine(`[WebviewManager] Node selected: ${message.nodeId}`);
        // Could be used for future features like code navigation
        break;

      case 'error':
        this.outputChannel.appendLine(`[WebviewManager] Webview error: ${message.message}`);
        if (message.details) {
          this.outputChannel.appendLine(`[WebviewManager] Details: ${message.details}`);
        }
        vscode.window.showErrorMessage(`Visualization error: ${message.message}`);
        break;

      default:
        this.outputChannel.appendLine(`[WebviewManager] Unknown message type: ${(message as { type?: string }).type}`);
    }
  }

  /**
   * Handle JSON export data from webview
   */
  private async handleJsonExport(jsonData: string): Promise<void> {
    // Prompt user for save location
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('hydro-graph.json'),
      filters: {
        'JSON Files': ['json'],
        'All Files': ['*'],
      },
    });

    if (!uri) {
      this.outputChannel.appendLine('[WebviewManager] JSON export cancelled by user');
      return;
    }

    try {
      // Write JSON to file
      await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonData, 'utf8'));
      
      vscode.window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
      this.outputChannel.appendLine(`[WebviewManager] JSON exported to ${uri.fsPath}`);
    } catch (error) {
      const errorMsg = `Failed to export JSON: ${error}`;
      vscode.window.showErrorMessage(errorMsg);
      this.outputChannel.appendLine(`[WebviewManager] ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Handle PNG export data from webview
   */
  private async handlePngExport(dataUrl: string): Promise<void> {
    // Prompt user for save location
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('hydro-graph.png'),
      filters: {
        'PNG Images': ['png'],
        'All Files': ['*'],
      },
    });

    if (!uri) {
      this.outputChannel.appendLine('[WebviewManager] PNG export cancelled by user');
      return;
    }

    try {
      // Convert data URL to buffer
      // Data URL format: data:image/png;base64,<base64-data>
      const base64Data = dataUrl.split(',')[1];
      if (!base64Data) {
        throw new Error('Invalid data URL format');
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      // Write to file
      await vscode.workspace.fs.writeFile(uri, buffer);
      
      vscode.window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
      this.outputChannel.appendLine(`[WebviewManager] PNG exported to ${uri.fsPath}`);
    } catch (error) {
      const errorMsg = `Failed to export PNG: ${error}`;
      vscode.window.showErrorMessage(errorMsg);
      this.outputChannel.appendLine(`[WebviewManager] ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Post a message to the webview
   */
  private async postMessage(message: ExtensionToWebviewMessage): Promise<void> {
    if (!this.panel) {
      throw new Error('No active panel to send message to');
    }

    const success = await this.panel.webview.postMessage(message);
    if (!success) {
      this.outputChannel.appendLine('[WebviewManager] Failed to post message to webview');
      throw new Error('Failed to send message to webview');
    }
  }
}
