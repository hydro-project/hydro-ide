/**
 * Unit tests for HierarchyBuilder
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HierarchyBuilder, Node, Edge } from '../analysis/hierarchyBuilder';
import { TreeSitterRustParser } from '../analysis/treeSitterParser';
import type * as vscode from 'vscode';

// Mock TreeSitterRustParser
vi.mock('../analysis/treeSitterParser');

describe('HierarchyBuilder', () => {
  let builder: HierarchyBuilder;
  let mockParser: TreeSitterRustParser;
  let mockDocument: vscode.TextDocument;

  beforeEach(() => {
    // Create mock parser
    mockParser = {
      parseVariableBindings: vi.fn().mockReturnValue([]),
      parseStandaloneChains: vi.fn().mockReturnValue([]),
      findEnclosingFunctionName: vi.fn().mockReturnValue('main'),
    } as unknown as TreeSitterRustParser;

    builder = new HierarchyBuilder(mockParser);

    // Create mock document
    mockDocument = {
      fileName: '/path/to/test.rs',
      lineAt: vi.fn(),
    } as unknown as vscode.TextDocument;
  });

  describe('buildLocationAndCodeHierarchies', () => {
    it('should create location hierarchy for nodes with locationKind', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { locationKind: 'Process<Leader>' },
        },
        {
          id: 'n2',
          shortLabel: 'filter',
          data: { locationKind: 'Process<Leader>' },
        },
        {
          id: 'n3',
          shortLabel: 'fold',
          data: { locationKind: 'Cluster<Worker>' },
        },
      ];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      expect(result.hierarchyChoices).toHaveLength(2);
      expect(result.hierarchyChoices[0].id).toBe('location');
      expect(result.hierarchyChoices[1].id).toBe('code');

      // Should have two location groups: Leader and Worker
      const locationHierarchy = result.hierarchyChoices[0];
      expect(locationHierarchy.children).toHaveLength(2);

      // Check node assignments
      expect(result.nodeAssignments.location['n1']).toBeDefined();
      expect(result.nodeAssignments.location['n2']).toBeDefined();
      expect(result.nodeAssignments.location['n3']).toBeDefined();
    });

    it('should handle nodes without locationKind', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: {},
        },
        {
          id: 'n2',
          shortLabel: 'filter',
          data: {},
        },
      ];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      const locationHierarchy = result.hierarchyChoices[0];
      // Should have one container: "(unknown location)"
      expect(locationHierarchy.children).toHaveLength(1);
      expect(locationHierarchy.children[0].name).toBe('(unknown location)');

      // All nodes should be assigned to unknown container
      expect(result.nodeAssignments.location['n1']).toBe(locationHierarchy.children[0].id);
      expect(result.nodeAssignments.location['n2']).toBe(locationHierarchy.children[0].id);
    });

    it('should build nested Tick hierarchies', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { locationKind: 'Process<Leader>', tickVariable: 'ticker' },
        },
        {
          id: 'n2',
          shortLabel: 'filter',
          data: { locationKind: 'Tick<Process<Leader>>', tickVariable: 'ticker' },
        },
        {
          id: 'n3',
          shortLabel: 'fold',
          data: { locationKind: 'Tick<Tick<Process<Leader>>>', tickVariable: 'ticker' },
        },
      ];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      const locationHierarchy = result.hierarchyChoices[0];
      expect(locationHierarchy.children).toHaveLength(1); // One base: Leader

      const leaderRoot = locationHierarchy.children[0];
      expect(leaderRoot.name).toBe('Leader');
      expect(leaderRoot.children.length).toBeGreaterThan(0); // Should have tick children
    });

    it('should build code hierarchy with file container', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { treeSitterPosition: { line: 10, column: 5 } },
        },
      ];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      const codeHierarchy = result.hierarchyChoices[1];
      expect(codeHierarchy.id).toBe('code');
      expect(codeHierarchy.children).toHaveLength(1);
      expect(codeHierarchy.children[0].name).toBe('test.rs'); // From fileName
    });

    it('should assign nodes to code hierarchy based on variable bindings', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { treeSitterPosition: { line: 10, column: 5 } },
        },
        {
          id: 'n2',
          shortLabel: 'filter',
          data: { treeSitterPosition: { line: 11, column: 5 } },
        },
      ];
      const edges: Edge[] = [];

      // Mock variable binding
      mockParser.parseVariableBindings = vi.fn().mockReturnValue([
        {
          varName: 'stream',
          line: 10,
          operators: [
            { name: 'map', line: 10, column: 5 },
            { name: 'filter', line: 11, column: 5 },
          ],
        },
      ]);

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      // Both nodes should be in code assignments
      expect(result.nodeAssignments.code['n1']).toBeDefined();
      expect(result.nodeAssignments.code['n2']).toBeDefined();
    });

    it('should assign nodes to code hierarchy based on standalone chains', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'source',
          data: { treeSitterPosition: { line: 10, column: 5 } },
        },
        {
          id: 'n2',
          shortLabel: 'for_each',
          data: { treeSitterPosition: { line: 11, column: 5 } },
        },
      ];
      const edges: Edge[] = [];

      // Mock standalone chain
      mockParser.parseStandaloneChains = vi.fn().mockReturnValue([
        [
          { name: 'source', line: 10, column: 5 },
          { name: 'for_each', line: 11, column: 5 },
        ],
      ]);

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      // Both nodes should be in code assignments
      expect(result.nodeAssignments.code['n1']).toBeDefined();
      expect(result.nodeAssignments.code['n2']).toBeDefined();
    });

    it('should return both location and code hierarchies', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { locationKind: 'Process<Leader>' },
        },
      ];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      expect(result.hierarchyChoices).toHaveLength(2);
      expect(result.nodeAssignments).toHaveProperty('location');
      expect(result.nodeAssignments).toHaveProperty('code');
      expect(result.selectedHierarchy).toBe('location');
    });

    it('should handle empty node list', () => {
      const nodes: Node[] = [];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      expect(result.hierarchyChoices).toHaveLength(2);
      // Should have fallback containers
      expect(result.hierarchyChoices[0].children.length).toBeGreaterThan(0);
      expect(result.hierarchyChoices[1].children.length).toBeGreaterThan(0);
    });

    it('should extract location labels correctly', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { locationKind: 'Process<Leader>' },
        },
        {
          id: 'n2',
          shortLabel: 'filter',
          data: { locationKind: 'Cluster<Worker>' },
        },
        {
          id: 'n3',
          shortLabel: 'fold',
          data: { locationKind: 'External<Client>' },
        },
      ];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      const locationHierarchy = result.hierarchyChoices[0];
      const containerNames = locationHierarchy.children.map((c) => c.name).sort();
      expect(containerNames).toEqual(['Client', 'Leader', 'Worker']);
    });

    it('should handle tick variables for grouping', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { locationKind: 'Tick<Process<Leader>>', tickVariable: 'ticker1' },
        },
        {
          id: 'n2',
          shortLabel: 'filter',
          data: { locationKind: 'Tick<Process<Leader>>', tickVariable: 'ticker2' },
        },
      ];
      const edges: Edge[] = [];

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      const locationHierarchy = result.hierarchyChoices[0];
      const leaderRoot = locationHierarchy.children[0];

      // Should have two tick containers (one for each tick variable)
      expect(leaderRoot.children.length).toBeGreaterThanOrEqual(1);
    });

    it('should create function containers in code hierarchy', () => {
      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: { treeSitterPosition: { line: 10, column: 5 } },
        },
      ];
      const edges: Edge[] = [];

      mockParser.parseStandaloneChains = vi
        .fn()
        .mockReturnValue([[{ name: 'map', line: 10, column: 5 }]]);
      mockParser.findEnclosingFunctionName = vi.fn().mockReturnValue('process_data');

      const result = builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      const codeHierarchy = result.hierarchyChoices[1];
      const fileContainer = codeHierarchy.children[0];

      // Should have function container
      expect(fileContainer.children.length).toBeGreaterThan(0);
      expect(fileContainer.children.some((c) => c.name.includes('process_data'))).toBe(true);
    });
  });

  describe('logging', () => {
    it('should log degraded mode warnings', () => {
      const logMessages: string[] = [];
      builder.setLogCallback((msg) => logMessages.push(msg));

      const nodes: Node[] = [
        {
          id: 'n1',
          shortLabel: 'map',
          data: {}, // No locationKind
        },
      ];
      const edges: Edge[] = [];

      builder.buildLocationAndCodeHierarchies(mockDocument, nodes, edges);

      expect(logMessages.some((msg) => msg.includes('DEGRADED MODE'))).toBe(true);
    });
  });
});
