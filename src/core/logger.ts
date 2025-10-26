/**
 * Logger - Structured logging utility for the extension
 * 
 * Provides consistent logging with timestamps, categories, and formatting
 */

import * as vscode from 'vscode';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

/**
 * Logger class for structured output channel logging
 */
export class Logger {
  private readonly outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel, _name: string = 'Hydro IDE') {
    this.outputChannel = outputChannel;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: string): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: string): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message
   */
  warning(message: string, context?: string): void {
    this.log(LogLevel.WARNING, message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: string, error?: unknown): void {
    this.log(LogLevel.ERROR, message, context);
    
    if (error) {
      if (error instanceof Error) {
        this.outputChannel.appendLine(`  Error: ${error.message}`);
        if (error.stack) {
          this.outputChannel.appendLine(`  Stack: ${error.stack}`);
        }
      } else {
        this.outputChannel.appendLine(`  Error: ${String(error)}`);
      }
    }
  }

  /**
   * Log a message with timestamp and formatting
   */
  private log(level: LogLevel, message: string, context?: string): void {
    const timestamp = this.formatTimestamp(new Date());
    const contextStr = context ? `[${context}]` : '';
    const levelStr = `[${level}]`;
    
    this.outputChannel.appendLine(`${timestamp} ${levelStr} ${contextStr} ${message}`);
  }

  /**
   * Log a section header
   */
  section(title: string): void {
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('='.repeat(80));
    this.outputChannel.appendLine(`  ${title}`);
    this.outputChannel.appendLine('='.repeat(80));
  }

  /**
   * Log a subsection header
   */
  subsection(title: string): void {
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine(`--- ${title} ---`);
  }

  /**
   * Log key-value pairs
   */
  keyValue(key: string, value: unknown): void {
    this.outputChannel.appendLine(`  ${key}: ${String(value)}`);
  }

  /**
   * Log a list of items
   */
  list(items: string[], title?: string): void {
    if (title) {
      this.outputChannel.appendLine(`${title}:`);
    }
    items.forEach((item, index) => {
      this.outputChannel.appendLine(`  ${index + 1}. ${item}`);
    });
  }

  /**
   * Log raw text without formatting
   */
  raw(text: string): void {
    this.outputChannel.appendLine(text);
  }

  /**
   * Show the output channel
   */
  show(): void {
    this.outputChannel.show();
  }

  /**
   * Clear the output channel
   */
  clear(): void {
    this.outputChannel.clear();
  }

  /**
   * Format timestamp for logging
   */
  private formatTimestamp(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  /**
   * Dispose the output channel
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}
