/**
 * Configuration management for Hydro IDE extension
 * 
 * Provides centralized access to extension configuration settings
 * and handles configuration changes at runtime.
 */

import * as vscode from 'vscode';

/**
 * Complete configuration interface for the extension
 */
export interface HydroIdeConfig {
  /** Auto-refresh on file save */
  autoRefresh: boolean;
  
  /** Cargo build settings */
  cargo: {
    releaseMode: boolean;
    features: string[];
    timeout: number;
  };
  
  /** Hydro graph generation settings */
  graph: {
    showMetadata: boolean;
    showLocationGroups: boolean;
    useShortLabels: boolean;
  };
  
  /** Performance settings */
  performance: {
    largeGraphThreshold: number;
    warnOnLargeGraphs: boolean;
  };
}

/**
 * Configuration manager class
 */
export class ConfigManager {
  private static readonly CONFIG_SECTION = 'hydroIde';
  private config: HydroIdeConfig;
  private changeListeners: Array<(config: HydroIdeConfig) => void> = [];

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from VSCode settings
   */
  private loadConfig(): HydroIdeConfig {
    const vscodeConfig = vscode.workspace.getConfiguration(ConfigManager.CONFIG_SECTION);

    return {
      autoRefresh: vscodeConfig.get<boolean>('autoRefresh', false),
      cargo: {
        releaseMode: vscodeConfig.get<boolean>('cargo.releaseMode', false),
        features: vscodeConfig.get<string[]>('cargo.features', []),
        timeout: vscodeConfig.get<number>('cargo.timeout', 120000),
      },
      graph: {
        showMetadata: vscodeConfig.get<boolean>('graph.showMetadata', true),
        showLocationGroups: vscodeConfig.get<boolean>('graph.showLocationGroups', true),
        useShortLabels: vscodeConfig.get<boolean>('graph.useShortLabels', false),
      },
      performance: {
        largeGraphThreshold: vscodeConfig.get<number>('performance.largeGraphThreshold', 500),
        warnOnLargeGraphs: vscodeConfig.get<boolean>('performance.warnOnLargeGraphs', true),
      },
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): HydroIdeConfig {
    return { ...this.config };
  }

  /**
   * Get auto-refresh setting
   */
  getAutoRefresh(): boolean {
    return this.config.autoRefresh;
  }

  /**
   * Get Cargo configuration
   */
  getCargoConfig(): HydroIdeConfig['cargo'] {
    return { ...this.config.cargo };
  }

  /**
   * Get graph configuration
   */
  getGraphConfig(): HydroIdeConfig['graph'] {
    return { ...this.config.graph };
  }

  /**
   * Get performance configuration
   */
  getPerformanceConfig(): HydroIdeConfig['performance'] {
    return { ...this.config.performance };
  }

  /**
   * Reload configuration from VSCode settings
   * Called when configuration changes
   */
  reloadConfig(): void {
    const oldConfig = this.config;
    this.config = this.loadConfig();

    // Notify listeners if configuration changed
    if (JSON.stringify(oldConfig) !== JSON.stringify(this.config)) {
      this.notifyListeners();
    }
  }

  /**
   * Register a listener for configuration changes
   */
  onConfigChange(listener: (config: HydroIdeConfig) => void): vscode.Disposable {
    this.changeListeners.push(listener);

    // Return disposable to unregister
    return {
      dispose: () => {
        const index = this.changeListeners.indexOf(listener);
        if (index !== -1) {
          this.changeListeners.splice(index, 1);
        }
      },
    };
  }

  /**
   * Notify all listeners of configuration change
   */
  private notifyListeners(): void {
    const config = this.getConfig();
    for (const listener of this.changeListeners) {
      try {
        listener(config);
      } catch (error) {
        console.error('Error in config change listener:', error);
      }
    }
  }

  /**
   * Check if a graph is considered large based on node count
   */
  isLargeGraph(nodeCount: number): boolean {
    return nodeCount > this.config.performance.largeGraphThreshold;
  }

  /**
   * Check if large graph warnings are enabled
   */
  shouldWarnOnLargeGraphs(): boolean {
    return this.config.performance.warnOnLargeGraphs;
  }
}
