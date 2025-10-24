/**
 * ProgressReporter - Manages progress notifications and loading indicators
 * 
 * Provides user feedback during long-running operations like Cargo builds
 */

import * as vscode from 'vscode';
import { Logger } from './logger';

/**
 * Progress step information
 */
export interface ProgressStep {
  /** Step name/description */
  message: string;
  
  /** Progress increment (0-100) */
  increment?: number;
}

/**
 * ProgressReporter class for managing progress notifications
 */
export class ProgressReporter {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Show progress notification for a long-running operation
   * Returns a cancellation token that can be checked during the operation
   */
  async withProgress<T>(
    title: string,
    task: (
      reporter: (step: ProgressStep) => void,
      token: vscode.CancellationToken
    ) => Promise<T>
  ): Promise<T> {
    this.logger.info(`Starting progress: ${title}`, 'ProgressReporter');

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      async (progress, token) => {
        // Create reporter function
        const reporter = (step: ProgressStep) => {
          this.logger.debug(`Progress step: ${step.message}`, 'ProgressReporter');
          progress.report({
            message: step.message,
            increment: step.increment,
          });
        };

        // Handle cancellation
        token.onCancellationRequested(() => {
          this.logger.warning('Operation cancelled by user', 'ProgressReporter');
        });

        try {
          const result = await task(reporter, token);
          this.logger.info(`Progress completed: ${title}`, 'ProgressReporter');
          return result;
        } catch (error) {
          this.logger.error(`Progress failed: ${title}`, 'ProgressReporter', error);
          throw error;
        }
      }
    );
  }

  /**
   * Show a simple loading indicator in the status bar
   */
  async withStatusBarProgress<T>(
    message: string,
    task: () => Promise<T>
  ): Promise<T> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: message,
      },
      async () => {
        try {
          return await task();
        } catch (error) {
          this.logger.error(`Status bar progress failed: ${message}`, 'ProgressReporter', error);
          throw error;
        }
      }
    );
  }

  /**
   * Show indeterminate progress in the status bar
   */
  showStatusBarMessage(message: string, hideAfterMs?: number): vscode.Disposable {
    this.logger.debug(`Status bar message: ${message}`, 'ProgressReporter');
    
    if (hideAfterMs) {
      return vscode.window.setStatusBarMessage(message, hideAfterMs);
    }
    
    return vscode.window.setStatusBarMessage(message);
  }

  /**
   * Create a progress reporter for Cargo builds
   */
  async withCargoBuildProgress<T>(
    scopeType: 'function' | 'file' | 'workspace',
    task: (
      reporter: (step: ProgressStep) => void,
      token: vscode.CancellationToken
    ) => Promise<T>
  ): Promise<T> {
    const title = `Building Hydro ${scopeType}...`;
    
    return await this.withProgress(title, async (reporter, token) => {
      // Report initial step
      reporter({ message: 'Analyzing scope...', increment: 10 });
      
      // Execute the task
      const result = await task(reporter, token);
      
      // Report completion
      reporter({ message: 'Complete', increment: 100 });
      
      return result;
    });
  }

  /**
   * Show a loading message in the webview
   */
  createWebviewLoadingMessage(): string {
    return JSON.stringify({
      type: 'loading',
      message: 'Building and analyzing Hydro code...',
    });
  }
}

/**
 * Helper function to create standard progress steps for Cargo builds
 */
export function createCargoBuildSteps(): {
  analyzing: ProgressStep;
  building: ProgressStep;
  extracting: ProgressStep;
  rendering: ProgressStep;
} {
  return {
    analyzing: { message: 'Analyzing scope...', increment: 10 },
    building: { message: 'Running Cargo build...', increment: 30 },
    extracting: { message: 'Extracting graph data...', increment: 20 },
    rendering: { message: 'Rendering visualization...', increment: 40 },
  };
}
