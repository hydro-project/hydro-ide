/**
 * ErrorHandler - Centralized error handling and user feedback
 * 
 * Responsibilities:
 * - Categorize errors by type (scope, compilation, JSON, visualization)
 * - Format error messages for user display
 * - Provide actionable error responses with "Learn More" and "Show Output" options
 * - Log detailed error information to output channel
 */

import * as vscode from 'vscode';
import { ScopeDetectionError, ScopeErrorCategory } from './types';
import { CargoError } from '../visualization/cargoOrchestrator';

/**
 * Error categories for the extension
 */
export enum ErrorCategory {
  /** Errors during scope detection and analysis */
  SCOPE = 'scope',
  
  /** Errors during Cargo compilation */
  COMPILATION = 'compilation',
  
  /** Errors with JSON extraction or validation */
  JSON = 'json',
  
  /** Errors during visualization rendering */
  VISUALIZATION = 'visualization',
  
  /** Configuration or setup errors */
  CONFIGURATION = 'configuration',
  
  /** Unknown or unexpected errors */
  UNKNOWN = 'unknown',
}

/**
 * Structured error information
 */
export interface ErrorInfo {
  /** Error category */
  category: ErrorCategory;
  
  /** User-friendly error message */
  message: string;
  
  /** Detailed error information for logging */
  details?: string;
  
  /** Suggestions for resolving the error */
  suggestions?: string[];
  
  /** Original error object */
  originalError?: unknown;
}

/**
 * ErrorHandler class for centralized error management
 */
export class ErrorHandler {
  private readonly outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel, _context: vscode.ExtensionContext) {
    this.outputChannel = outputChannel;
  }

  /**
   * Handle an error with appropriate user feedback and logging
   */
  async handleError(error: unknown, context?: string): Promise<void> {
    const errorInfo = this.categorizeError(error);
    
    // Log to output channel
    this.logError(errorInfo, context);
    
    // Show user notification with actions
    await this.showErrorNotification(errorInfo);
  }

  /**
   * Categorize an error into structured ErrorInfo
   */
  private categorizeError(error: unknown): ErrorInfo {
    // Handle ScopeDetectionError
    if (error instanceof ScopeDetectionError) {
      return this.categorizeScopeError(error);
    }
    
    // Handle CargoError
    if (error instanceof CargoError) {
      return this.categorizeCargoError(error);
    }
    
    // Handle standard Error
    if (error instanceof Error) {
      return this.categorizeStandardError(error);
    }
    
    // Handle unknown error types
    return {
      category: ErrorCategory.UNKNOWN,
      message: 'An unexpected error occurred',
      details: String(error),
      suggestions: ['Check the output channel for more details'],
      originalError: error,
    };
  }

  /**
   * Categorize scope detection errors
   */
  private categorizeScopeError(error: ScopeDetectionError): ErrorInfo {
    const suggestions: string[] = [];
    
    switch (error.category) {
      case ScopeErrorCategory.NO_HYDRO_CODE:
        suggestions.push('Ensure the file contains Hydro functions with #[hydro::flow] attribute');
        suggestions.push('Check that hydro_lang or dfir_rs is imported');
        suggestions.push('Verify the cursor is positioned within a Hydro function');
        break;
        
      case ScopeErrorCategory.INVALID_POSITION:
        suggestions.push('Place the cursor inside a Hydro function');
        suggestions.push('Ensure the file is saved and up to date');
        break;
        
      case ScopeErrorCategory.NOT_IN_WORKSPACE:
        suggestions.push('Open the file as part of a Cargo workspace');
        suggestions.push('Ensure Cargo.toml exists in the workspace root');
        break;
        
      case ScopeErrorCategory.PARSE_ERROR:
        suggestions.push('Check for syntax errors in the Rust code');
        suggestions.push('Ensure the file compiles with "cargo check"');
        break;
        
      case ScopeErrorCategory.IO_ERROR:
        suggestions.push('Check file permissions');
        suggestions.push('Ensure the file exists and is accessible');
        break;
    }
    
    return {
      category: ErrorCategory.SCOPE,
      message: error.message,
      details: error.details,
      suggestions,
      originalError: error,
    };
  }

  /**
   * Categorize Cargo compilation errors
   */
  private categorizeCargoError(error: CargoError): ErrorInfo {
    const suggestions: string[] = [];
    
    // Analyze error message for common issues
    const errorMsg = error.message.toLowerCase();
    const stderr = error.stderr?.toLowerCase() || '';
    
    if (errorMsg.includes('not found') || errorMsg.includes('enoent')) {
      suggestions.push('Install Rust and Cargo from https://rustup.rs');
      suggestions.push('Ensure Cargo is in your system PATH');
    } else if (stderr.includes('could not find') || stderr.includes('unresolved import')) {
      suggestions.push('Run "cargo check" to verify dependencies');
      suggestions.push('Check that all dependencies are listed in Cargo.toml');
    } else if (stderr.includes('feature') || stderr.includes('cfg')) {
      suggestions.push('Ensure the "viz" feature is configured in Cargo.toml');
      suggestions.push('Check feature flags in your Hydro dependencies');
    } else if (stderr.includes('macro') || stderr.includes('hydro')) {
      suggestions.push('Verify hydro_lang or dfir_rs is properly imported');
      suggestions.push('Check that Hydro functions are correctly annotated');
    } else {
      suggestions.push('Run "cargo build" to see full error details');
      suggestions.push('Check the output channel for complete build logs');
    }
    
    return {
      category: ErrorCategory.COMPILATION,
      message: error.message,
      details: error.stderr,
      suggestions,
      originalError: error,
    };
  }

  /**
   * Categorize standard Error objects
   */
  private categorizeStandardError(error: Error): ErrorInfo {
    const message = error.message.toLowerCase();
    
    // Try to infer category from error message
    if (message.includes('json') || message.includes('parse')) {
      return {
        category: ErrorCategory.JSON,
        message: error.message,
        details: error.stack,
        suggestions: [
          'Ensure the Hydro code generates valid visualization output',
          'Check that the "viz" feature is enabled',
          'Verify the graph JSON format matches Hydroscope specification',
        ],
        originalError: error,
      };
    }
    
    if (message.includes('webview') || message.includes('visualization') || message.includes('render')) {
      return {
        category: ErrorCategory.VISUALIZATION,
        message: error.message,
        details: error.stack,
        suggestions: [
          'Try closing and reopening the visualization panel',
          'Check the output channel for webview errors',
          'Ensure the graph data is valid',
        ],
        originalError: error,
      };
    }
    
    if (message.includes('config') || message.includes('setting')) {
      return {
        category: ErrorCategory.CONFIGURATION,
        message: error.message,
        details: error.stack,
        suggestions: [
          'Check extension settings in VSCode preferences',
          'Reset settings to defaults if needed',
        ],
        originalError: error,
      };
    }
    
    return {
      category: ErrorCategory.UNKNOWN,
      message: error.message,
      details: error.stack,
      suggestions: ['Check the output channel for more details'],
      originalError: error,
    };
  }

  /**
   * Log error information to output channel
   */
  private logError(errorInfo: ErrorInfo, context?: string): void {
    const timestamp = new Date().toISOString();
    
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('='.repeat(80));
    this.outputChannel.appendLine(`[ERROR] ${timestamp}`);
    
    if (context) {
      this.outputChannel.appendLine(`[Context] ${context}`);
    }
    
    this.outputChannel.appendLine(`[Category] ${errorInfo.category}`);
    this.outputChannel.appendLine(`[Message] ${errorInfo.message}`);
    
    if (errorInfo.details) {
      this.outputChannel.appendLine('[Details]');
      this.outputChannel.appendLine(errorInfo.details);
    }
    
    if (errorInfo.suggestions && errorInfo.suggestions.length > 0) {
      this.outputChannel.appendLine('[Suggestions]');
      errorInfo.suggestions.forEach((suggestion, index) => {
        this.outputChannel.appendLine(`  ${index + 1}. ${suggestion}`);
      });
    }
    
    if (errorInfo.originalError) {
      this.outputChannel.appendLine('[Original Error]');
      this.outputChannel.appendLine(String(errorInfo.originalError));
    }
    
    this.outputChannel.appendLine('='.repeat(80));
    this.outputChannel.appendLine('');
  }

  /**
   * Show error notification to user with actionable buttons
   */
  private async showErrorNotification(errorInfo: ErrorInfo): Promise<void> {
    const actions: string[] = [];
    
    // Add "Show Output" action for all errors
    actions.push('Show Output');
    
    // Add "Learn More" action for specific error categories
    if (this.hasLearnMoreLink(errorInfo.category)) {
      actions.push('Learn More');
    }
    
    // Add category-specific actions
    if (errorInfo.category === ErrorCategory.COMPILATION) {
      actions.push('Run Cargo Check');
    }
    
    // Format message with category prefix
    const categoryLabel = this.getCategoryLabel(errorInfo.category);
    const fullMessage = `${categoryLabel}: ${errorInfo.message}`;
    
    // Show error message with actions
    const selection = await vscode.window.showErrorMessage(
      fullMessage,
      ...actions
    );
    
    // Handle action selection
    if (selection === 'Show Output') {
      this.outputChannel.show();
    } else if (selection === 'Learn More') {
      await this.openLearnMoreLink(errorInfo.category);
    } else if (selection === 'Run Cargo Check') {
      await this.runCargoCheck();
    }
  }

  /**
   * Get user-friendly label for error category
   */
  private getCategoryLabel(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.SCOPE:
        return 'Scope Detection Error';
      case ErrorCategory.COMPILATION:
        return 'Compilation Error';
      case ErrorCategory.JSON:
        return 'JSON Error';
      case ErrorCategory.VISUALIZATION:
        return 'Visualization Error';
      case ErrorCategory.CONFIGURATION:
        return 'Configuration Error';
      case ErrorCategory.UNKNOWN:
        return 'Error';
    }
  }

  /**
   * Check if category has a "Learn More" documentation link
   */
  private hasLearnMoreLink(category: ErrorCategory): boolean {
    return [
      ErrorCategory.SCOPE,
      ErrorCategory.COMPILATION,
      ErrorCategory.JSON,
    ].includes(category);
  }

  /**
   * Open documentation link for error category
   */
  private async openLearnMoreLink(category: ErrorCategory): Promise<void> {
    // Base documentation URL (would be updated with actual docs)
    const baseUrl = 'https://github.com/hydro-project/hydro';
    
    let url: string;
    switch (category) {
      case ErrorCategory.SCOPE:
        url = `${baseUrl}#scope-detection`;
        break;
      case ErrorCategory.COMPILATION:
        url = `${baseUrl}#compilation-errors`;
        break;
      case ErrorCategory.JSON:
        url = `${baseUrl}#visualization-format`;
        break;
      default:
        url = baseUrl;
    }
    
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /**
   * Run "cargo check" in integrated terminal
   */
  private async runCargoCheck(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('No workspace folder open');
      return;
    }
    
    const terminal = vscode.window.createTerminal({
      name: 'Cargo Check',
      cwd: workspaceFolders[0].uri.fsPath,
    });
    
    terminal.show();
    terminal.sendText('cargo check');
  }

  /**
   * Show a warning message with optional actions
   */
  async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
    return await vscode.window.showWarningMessage(message, ...actions);
  }

  /**
   * Show an information message
   */
  showInfo(message: string): void {
    vscode.window.showInformationMessage(message);
  }

  /**
   * Log an informational message
   */
  logInfo(message: string, context?: string): void {
    const timestamp = new Date().toISOString();
    const prefix = context ? `[${context}]` : '[INFO]';
    this.outputChannel.appendLine(`${timestamp} ${prefix} ${message}`);
  }

  /**
   * Log a warning message
   */
  logWarning(message: string, context?: string): void {
    const timestamp = new Date().toISOString();
    const prefix = context ? `[${context}]` : '[WARNING]';
    this.outputChannel.appendLine(`${timestamp} ${prefix} ${message}`);
  }
}
