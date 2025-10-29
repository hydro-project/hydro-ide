/**
 * Unit tests for EdgeAnalyzer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EdgeAnalyzer, Edge, Node } from '../analysis/edgeAnalyzer';
import { OperatorRegistry } from '../analysis/operatorRegistry';

describe('EdgeAnalyzer', () => {
  let analyzer: EdgeAnalyzer;
  let logMessages: string[];

  beforeEach(() => {
    // Reset singleton state
    EdgeAnalyzer.resetInstance();
    OperatorRegistry.resetInstance();

    analyzer = EdgeAnalyzer.getInstance();
    logMessages = [];
    analyzer.setLogCallback((msg) => logMessages.push(msg));
  });

  afterEach(() => {
    EdgeAnalyzer.resetInstance();
    OperatorRegistry.resetInstance();
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = EdgeAnalyzer.getInstance();
      const instance2 = EdgeAnalyzer.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('analyzeNetworkEdges', () => {
    it('should identify edges with networking operators as network edges', () => {
      const nodes: Node[] = [
        { id: 'n1', shortLabel: 'map' },
        { id: 'n2', shortLabel: 'send_bincode' }, // Networking operator
        { id: 'n3', shortLabel: 'filter' },
      ];

      const edges: Edge[] = [
        { id: 'e1', source: 'n1', target: 'n2', semanticTags: [] },
        { id: 'e2', source: 'n2', target: 'n3', semanticTags: [] },
      ];

      const result = analyzer.analyzeNetworkEdges(edges, nodes);

      // First edge: n1 (map) -> n2 (send_bincode) - network target
      expect(result[0].semanticTags).toContain('network');
      expect(result[0].semanticTags).toContain('network-target');
      expect(result[0].semanticTags).toContain('remote-receiver');

      // Second edge: n2 (send_bincode) -> n3 (filter) - network source
      expect(result[1].semanticTags).toContain('network');
      expect(result[1].semanticTags).toContain('network-source');
      expect(result[1].semanticTags).toContain('remote-sender');
    });

    it('should handle edges between two networking operators', () => {
      const nodes: Node[] = [
        { id: 'n1', shortLabel: 'send_bincode' },
        { id: 'n2', shortLabel: 'recv_bincode' },
      ];

      const edges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2', semanticTags: [] }];

      const result = analyzer.analyzeNetworkEdges(edges, nodes);

      expect(result[0].semanticTags).toContain('network');
      expect(result[0].semanticTags).toContain('network-to-network');
    });

    it('should preserve existing semantic tags', () => {
      const nodes: Node[] = [
        { id: 'n1', shortLabel: 'map' },
        { id: 'n2', shortLabel: 'send_bincode' },
      ];

      const edges: Edge[] = [
        { id: 'e1', source: 'n1', target: 'n2', semanticTags: ['Stream', 'Unbounded'] },
      ];

      const result = analyzer.analyzeNetworkEdges(edges, nodes);

      expect(result[0].semanticTags).toContain('Stream');
      expect(result[0].semanticTags).toContain('Unbounded');
      expect(result[0].semanticTags).toContain('network');
      expect(result[0].semanticTags).toContain('network-target');
    });

    it('should not modify non-network edges', () => {
      const nodes: Node[] = [
        { id: 'n1', shortLabel: 'map' },
        { id: 'n2', shortLabel: 'filter' },
        { id: 'n3', shortLabel: 'fold' },
      ];

      const edges: Edge[] = [
        { id: 'e1', source: 'n1', target: 'n2', semanticTags: ['Stream'] },
        { id: 'e2', source: 'n2', target: 'n3', semanticTags: ['Keyed'] },
      ];

      const result = analyzer.analyzeNetworkEdges(edges, nodes);

      expect(result[0].semanticTags).toEqual(['Stream']);
      expect(result[1].semanticTags).toEqual(['Keyed']);
    });

    it('should handle edges with missing nodes gracefully', () => {
      const nodes: Node[] = [{ id: 'n1', shortLabel: 'map' }];

      const edges: Edge[] = [
        { id: 'e1', source: 'n1', target: 'n999', semanticTags: ['Stream'] }, // n999 doesn't exist
        { id: 'e2', source: 'n888', target: 'n1', semanticTags: ['Keyed'] }, // n888 doesn't exist
      ];

      const result = analyzer.analyzeNetworkEdges(edges, nodes);

      // Edges with missing nodes should be returned unchanged
      expect(result[0]).toEqual(edges[0]);
      expect(result[1]).toEqual(edges[1]);
    });

    it('should handle empty edges array', () => {
      const nodes: Node[] = [{ id: 'n1', shortLabel: 'map' }];
      const edges: Edge[] = [];

      const result = analyzer.analyzeNetworkEdges(edges, nodes);

      expect(result).toEqual([]);
    });

    it('should handle empty nodes array', () => {
      const nodes: Node[] = [];
      const edges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2', semanticTags: [] }];

      const result = analyzer.analyzeNetworkEdges(edges, nodes);

      // All edges will have missing nodes, should be returned unchanged
      expect(result[0]).toEqual(edges[0]);
    });

    it('should log network edge detection', () => {
      const nodes: Node[] = [
        { id: 'n1', shortLabel: 'map' },
        { id: 'n2', shortLabel: 'send_bincode' },
      ];

      const edges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2', semanticTags: [] }];

      analyzer.analyzeNetworkEdges(edges, nodes);

      expect(logMessages.length).toBeGreaterThan(0);
      expect(logMessages.some((msg) => msg.includes('network target'))).toBe(true);
      expect(logMessages.some((msg) => msg.includes('Analyzed'))).toBe(true);
    });

    it('should count network edges correctly', () => {
      const nodes: Node[] = [
        { id: 'n1', shortLabel: 'map' },
        { id: 'n2', shortLabel: 'send_bincode' },
        { id: 'n3', shortLabel: 'filter' },
        { id: 'n4', shortLabel: 'recv_bincode' },
        { id: 'n5', shortLabel: 'fold' },
      ];

      const edges: Edge[] = [
        { id: 'e1', source: 'n1', target: 'n2', semanticTags: [] }, // Network edge
        { id: 'e2', source: 'n2', target: 'n3', semanticTags: [] }, // Network edge
        { id: 'e3', source: 'n3', target: 'n4', semanticTags: [] }, // Network edge
        { id: 'e4', source: 'n4', target: 'n5', semanticTags: [] }, // Network edge
      ];

      analyzer.analyzeNetworkEdges(edges, nodes);

      // Check log message for correct count
      const summaryLog = logMessages.find((msg) => msg.includes('Analyzed'));
      expect(summaryLog).toContain('Analyzed 4 edges');
      expect(summaryLog).toContain('found 4 network edges');
    });
  });
});
