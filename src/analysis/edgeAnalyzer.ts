/**
 * Edge Analyzer
 *
 * Analyzes and enriches edges in the Hydroscope graph with semantic information.
 * Focuses on identifying network edges and adding appropriate tags for visualization.
 *
 * Responsibilities:
 * - Identify network edges (edges involving networking operators)
 * - Tag edges with network-related semantic information
 * - Differentiate between network source and network target edges
 */

import { OperatorRegistry } from './operatorRegistry';
import type { GraphEdge, GraphNode } from '../core/graphTypes';

// Use shared graph types. This service only reads a subset of fields.
export type Edge = GraphEdge;
export type Node = Pick<GraphNode, 'id' | 'shortLabel'>;

/**
 * EdgeAnalyzer service for analyzing and enriching graph edges
 *
 * Uses singleton pattern for consistent access across the application.
 */
export class EdgeAnalyzer {
  private static instance: EdgeAnalyzer | null = null;
  private operatorRegistry: OperatorRegistry;
  private logCallback: ((message: string) => void) | null = null;

  private constructor() {
    this.operatorRegistry = OperatorRegistry.getInstance();
  }

  /**
   * Get the singleton instance of EdgeAnalyzer
   */
  public static getInstance(): EdgeAnalyzer {
    if (!EdgeAnalyzer.instance) {
      EdgeAnalyzer.instance = new EdgeAnalyzer();
    }
    return EdgeAnalyzer.instance;
  }

  /**
   * Set a logging callback for debugging
   */
  public setLogCallback(callback: (message: string) => void): void {
    this.logCallback = callback;
  }

  /**
   * Internal logging helper
   */
  private log(message: string): void {
    if (this.logCallback) {
      this.logCallback(`[EdgeAnalyzer] ${message}`);
    }
  }

  /**
   * Analyze edges to identify and tag network edges
   *
   * A network edge is one where either the source or target node is a networking operator.
   * Network edges are marked with appropriate semantic tags for visualization:
   * - 'network': Base tag for all network edges
   * - 'network-source': Source node is a networking operator (sender side)
   * - 'network-target': Target node is a networking operator (receiver side)
   * - 'remote-sender': Source is sending data over the network
   * - 'remote-receiver': Target is receiving data from the network
   * - 'network-to-network': Both nodes are networking operators (rare case)
   *
   * @param edges Array of edges to analyze
   * @param nodes Array of nodes (for operator lookup)
   * @returns Array of edges with network tags added
   */
  public analyzeNetworkEdges(edges: Edge[], nodes: Node[]): Edge[] {
    // Create a map for quick node lookup
    const nodeMap = new Map<string, Node>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    let networkEdgeCount = 0;

    const analyzedEdges = edges.map((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode || !targetNode) {
        return edge; // Skip if nodes not found
      }

      const sourceIsNetwork = this.operatorRegistry.isNetworkingOperator(sourceNode.shortLabel);
      const targetIsNetwork = this.operatorRegistry.isNetworkingOperator(targetNode.shortLabel);

      if (sourceIsNetwork || targetIsNetwork) {
        // This is a network edge
        networkEdgeCount++;
        const networkTags = ['network'];

        if (sourceIsNetwork && targetIsNetwork) {
          // Both sides are network operators (rare case)
          networkTags.push('network-to-network');
          this.log(
            `Network edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel} (both network ops)`
          );
        } else if (sourceIsNetwork) {
          // Source is network operator (sender side)
          networkTags.push('network-source', 'remote-sender');
          this.log(
            `Network edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel} (network source)`
          );
        } else {
          // Target is network operator (receiver side)
          networkTags.push('network-target', 'remote-receiver');
          this.log(
            `Network edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel} (network target)`
          );
        }

        return {
          ...edge,
          semanticTags: [...edge.semanticTags, ...networkTags],
        };
      }

      return edge; // Not a network edge
    });

    this.log(`Analyzed ${edges.length} edges, found ${networkEdgeCount} network edges`);
    return analyzedEdges;
  }

  /**
   * Reset the singleton instance (mainly for testing)
   */
  public static resetInstance(): void {
    EdgeAnalyzer.instance = null;
  }
}
