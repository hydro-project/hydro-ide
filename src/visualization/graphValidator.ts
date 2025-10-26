/**
 * GraphValidator - Validates and analyzes graph data
 * 
 * Responsibilities:
 * - Count nodes and edges in graph JSON
 * - Warn about large graphs that may impact performance
 * - Validate graph structure
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

/**
 * Graph statistics
 */
export interface GraphStats {
  /** Number of nodes */
  nodeCount: number;
  
  /** Number of edges */
  edgeCount: number;
  
  /** Whether the graph is considered large */
  isLarge: boolean;
  
  /** Estimated complexity score */
  complexity: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the graph is valid */
  valid: boolean;
  
  /** Validation errors */
  errors: string[];
  
  /** Validation warnings */
  warnings: string[];
  
  /** Graph statistics */
  stats?: GraphStats;
}

/**
 * GraphValidator class for analyzing graph data
 */
export class GraphValidator {
  private readonly logger: Logger;
  private readonly largeGraphThreshold: number;
  private readonly warnOnLargeGraphs: boolean;

  constructor(
    logger: Logger,
    largeGraphThreshold: number = 500,
    warnOnLargeGraphs: boolean = true
  ) {
    this.logger = logger;
    this.largeGraphThreshold = largeGraphThreshold;
    this.warnOnLargeGraphs = warnOnLargeGraphs;
  }

  /**
   * Validate graph JSON and return statistics
   */
  validate(graphJson: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Parse JSON
      const graph = JSON.parse(graphJson);

      // Extract nodes and edges
      const nodes = this.extractNodes(graph);
      const edges = this.extractEdges(graph);

      if (!nodes) {
        errors.push('Graph JSON missing "nodes" array');
      }

      if (!edges) {
        errors.push('Graph JSON missing "edges" array');
      }

      // Calculate statistics
      const stats: GraphStats = {
        nodeCount: nodes?.length || 0,
        edgeCount: edges?.length || 0,
        isLarge: (nodes?.length || 0) > this.largeGraphThreshold,
        complexity: this.calculateComplexity(nodes?.length || 0, edges?.length || 0),
      };

      // Check for large graphs
      if (stats.isLarge && this.warnOnLargeGraphs) {
        warnings.push(
          `Graph contains ${stats.nodeCount} nodes, which may impact performance`
        );
      }

      // Validate node structure
      if (nodes) {
        const nodeErrors = this.validateNodes(nodes);
        errors.push(...nodeErrors);
      }

      // Validate edge structure
      if (edges) {
        const edgeErrors = this.validateEdges(edges);
        errors.push(...edgeErrors);
      }

      this.logger.info(
        `Graph validation: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`,
        'GraphValidator'
      );

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats,
      };
    } catch (error) {
      this.logger.error('Failed to validate graph JSON', 'GraphValidator', error);
      
      return {
        valid: false,
        errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
        warnings,
      };
    }
  }

  /**
   * Check if user wants to proceed with a large graph
   * Returns true if user confirms, false if cancelled
   */
  async checkLargeGraph(stats: GraphStats): Promise<boolean> {
    if (!stats.isLarge || !this.warnOnLargeGraphs) {
      return true;
    }

    this.logger.warning(
      `Large graph detected: ${stats.nodeCount} nodes`,
      'GraphValidator'
    );

    const message = 
      `This graph contains ${stats.nodeCount} nodes, which may impact performance. ` +
      `Rendering may be slow or cause high memory usage.`;

    const selection = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Proceed Anyway',
      'Cancel'
    );

    const proceed = selection === 'Proceed Anyway';
    
    if (proceed) {
      this.logger.info('User chose to proceed with large graph', 'GraphValidator');
    } else {
      this.logger.info('User cancelled large graph visualization', 'GraphValidator');
    }

    return proceed;
  }

  /**
   * Extract nodes array from graph JSON
   */
  private extractNodes(graph: unknown): unknown[] | undefined {
    if (typeof graph !== 'object' || graph === null) {
      return undefined;
    }

    const graphObj = graph as Record<string, unknown>;

    // Try graph.nodes first
    if (Array.isArray(graphObj.nodes)) {
      return graphObj.nodes;
    }

    // Try graph.graph.nodes
    if (graphObj.graph && typeof graphObj.graph === 'object') {
      const nestedGraph = graphObj.graph as Record<string, unknown>;
      if (Array.isArray(nestedGraph.nodes)) {
        return nestedGraph.nodes;
      }
    }

    return undefined;
  }

  /**
   * Extract edges array from graph JSON
   */
  private extractEdges(graph: unknown): unknown[] | undefined {
    if (typeof graph !== 'object' || graph === null) {
      return undefined;
    }

    const graphObj = graph as Record<string, unknown>;

    // Try graph.edges first
    if (Array.isArray(graphObj.edges)) {
      return graphObj.edges;
    }

    // Try graph.graph.edges
    if (graphObj.graph && typeof graphObj.graph === 'object') {
      const nestedGraph = graphObj.graph as Record<string, unknown>;
      if (Array.isArray(nestedGraph.edges)) {
        return nestedGraph.edges;
      }
    }

    return undefined;
  }

  /**
   * Validate node structure
   */
  private validateNodes(nodes: unknown[]): string[] {
    const errors: string[] = [];

    // Check first few nodes for required properties
    const samplesToCheck = Math.min(nodes.length, 10);
    
    for (let i = 0; i < samplesToCheck; i++) {
      const node = nodes[i];
      
      if (typeof node !== 'object' || node === null) {
        errors.push(`Node at index ${i} is not an object`);
        continue;
      }

      const nodeObj = node as Record<string, unknown>;
      
      if (!nodeObj.id) {
        errors.push(`Node at index ${i} missing required "id" property`);
      }
    }

    return errors;
  }

  /**
   * Validate edge structure
   */
  private validateEdges(edges: unknown[]): string[] {
    const errors: string[] = [];

    // Check first few edges for required properties
    const samplesToCheck = Math.min(edges.length, 10);
    
    for (let i = 0; i < samplesToCheck; i++) {
      const edge = edges[i];
      
      if (typeof edge !== 'object' || edge === null) {
        errors.push(`Edge at index ${i} is not an object`);
        continue;
      }

      const edgeObj = edge as Record<string, unknown>;
      
      if (!edgeObj.source) {
        errors.push(`Edge at index ${i} missing required "source" property`);
      }
      
      if (!edgeObj.target) {
        errors.push(`Edge at index ${i} missing required "target" property`);
      }
    }

    return errors;
  }

  /**
   * Calculate complexity score based on nodes and edges
   */
  private calculateComplexity(nodeCount: number, edgeCount: number): number {
    // Simple complexity metric: weighted sum of nodes and edges
    // Edges contribute more to complexity than nodes
    return nodeCount + (edgeCount * 1.5);
  }

  /**
   * Get performance recommendation based on graph size
   */
  getPerformanceRecommendation(stats: GraphStats): string | undefined {
    if (stats.nodeCount < 100) {
      return undefined; // Small graph, no recommendation needed
    }

    if (stats.nodeCount < 500) {
      return 'Consider using hierarchy features to organize the graph';
    }

    if (stats.nodeCount < 1000) {
      return 'Large graph detected. Use zoom and pan to navigate. Consider filtering nodes.';
    }

    return 'Very large graph. Performance may be impacted. Consider visualizing a smaller scope.';
  }

  /**
   * Update configuration
   */
  updateConfig(largeGraphThreshold: number, warnOnLargeGraphs: boolean): void {
    // Use Object.assign to update private properties
    Object.assign(this, { largeGraphThreshold, warnOnLargeGraphs });
    
    this.logger.info(
      `Graph validator config updated: threshold=${largeGraphThreshold}, warn=${warnOnLargeGraphs}`,
      'GraphValidator'
    );
  }
}
