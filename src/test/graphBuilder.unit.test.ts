/**
 * Unit tests for GraphBuilder
 *
 * Tests graph construction from tree-sitter analysis.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphBuilder } from '../analysis/graphBuilder';
import type { TreeSitterRustParser, OperatorNode } from '../analysis/treeSitterParser';
import { OperatorRegistry } from '../analysis/operatorRegistry';
import * as vscode from 'vscode';

// Mock vscode
vi.mock('vscode', () => ({
  OutputChannel: vi.fn(),
  Range: vi.fn(),
}));

describe('GraphBuilder', () => {
  let graphBuilder: GraphBuilder;
  let mockParser: TreeSitterRustParser;
  let mockRegistry: OperatorRegistry;
  let mockOutputChannel: vscode.OutputChannel;

  beforeEach(() => {
    // Create mock output channel
    mockOutputChannel = {
      appendLine: vi.fn(),
    } as unknown as vscode.OutputChannel;

    // Create mock tree-sitter parser
    mockParser = {
      parseVariableBindings: vi.fn().mockReturnValue([]),
      parseStandaloneChains: vi.fn().mockReturnValue([]),
      findEnclosingFunctionName: vi.fn().mockReturnValue('test_fn'),
    } as unknown as TreeSitterRustParser;

    // Create operator registry
    mockRegistry = OperatorRegistry.getInstance();

    // Create graph builder
    graphBuilder = new GraphBuilder(mockParser, mockRegistry, mockOutputChannel);
  });

  describe('buildFromTreeSitter', () => {
    it('returns empty graph for document with no chains', () => {
      const mockDocument = createMockDocument(['let x = 42;']);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('creates nodes for variable binding chain', () => {
      const mockDocument = createMockDocument(['let result = source.map().filter();']);

      vi.mocked(mockParser.parseVariableBindings).mockReturnValue([
        {
          varName: 'result',
          line: 0,
          operators: [createOperatorNode('map', 0, 21), createOperatorNode('filter', 0, 27)],
        },
      ]);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].shortLabel).toBe('map');
      expect(result.nodes[1].shortLabel).toBe('filter');
    });

    it('creates edges between operators in chain', () => {
      const mockDocument = createMockDocument(['let result = source.map().filter();']);

      vi.mocked(mockParser.parseVariableBindings).mockReturnValue([
        {
          varName: 'result',
          line: 0,
          operators: [createOperatorNode('map', 0, 21), createOperatorNode('filter', 0, 27)],
        },
      ]);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('0'); // map node
      expect(result.edges[0].target).toBe('1'); // filter node
    });

    it('skips unknown operators', () => {
      const mockDocument = createMockDocument(['let result = source.unknown_op().filter();']);

      vi.mocked(mockParser.parseVariableBindings).mockReturnValue([
        {
          varName: 'result',
          line: 0,
          operators: [createOperatorNode('unknown_op', 0, 21), createOperatorNode('filter', 0, 33)],
        },
      ]);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      // Only filter should be included
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].shortLabel).toBe('filter');
      expect(result.edges).toHaveLength(0); // No edge since only one valid node
    });

    it('handles standalone chains', () => {
      const mockDocument = createMockDocument(['result.map().filter();']);

      vi.mocked(mockParser.parseStandaloneChains).mockReturnValue([
        [createOperatorNode('map', 0, 7), createOperatorNode('filter', 0, 13)],
      ]);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it('creates inter-variable edges', () => {
      const mockDocument = createMockDocument(['let x = source.map();', 'let y = x.filter();']);

      vi.mocked(mockParser.parseVariableBindings).mockReturnValue([
        {
          varName: 'x',
          line: 0,
          operators: [createOperatorNode('map', 0, 15)],
        },
        {
          varName: 'y',
          line: 1,
          operators: [createOperatorNode('filter', 1, 10)],
        },
      ]);

      // Mock detectVariableReference to return 'x' when checking line 1
      const detectSpy = vi.spyOn(graphBuilder, 'detectVariableReference');
      detectSpy.mockReturnValue('x');

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      // Should have 2 nodes and 1 inter-variable edge
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('0'); // map
      expect(result.edges[0].target).toBe('1'); // filter
    });

    it('sets node type based on operator', () => {
      const mockDocument = createMockDocument(['let x = source_iter();']);

      vi.mocked(mockParser.parseVariableBindings).mockReturnValue([
        {
          varName: 'x',
          line: 0,
          operators: [createOperatorNode('source_iter', 0, 8)],
        },
      ]);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      expect(result.nodes[0].nodeType).toBe('Source');
    });

    it('includes tick variable when present', () => {
      const mockDocument = createMockDocument(['let t = tick();']);

      vi.mocked(mockParser.parseVariableBindings).mockReturnValue([
        {
          varName: 't',
          line: 0,
          operators: [createOperatorNode('tick', 0, 8, 'ticker')],
        },
      ]);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      expect(result.nodes[0].data.tickVariable).toBe('test_fn::ticker');
    });

    it('avoids duplicate nodes for same operator position', () => {
      const mockDocument = createMockDocument(['let x = source.map();']);

      // Same operator appearing twice (shouldn't happen, but defensive)
      vi.mocked(mockParser.parseVariableBindings).mockReturnValue([
        {
          varName: 'x',
          line: 0,
          operators: [
            createOperatorNode('map', 0, 15),
            createOperatorNode('map', 0, 15), // Duplicate
          ],
        },
      ]);

      const result = graphBuilder.buildFromTreeSitter(mockDocument, {});

      // Should only create one node
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('detectVariableReference', () => {
    it('detects variable at start of line', () => {
      const mockDocument = createMockDocument(['x.map()']);

      const result = graphBuilder.detectVariableReference(mockDocument, 0, ['x', 'y']);

      expect(result).toBe('x');
    });

    it('detects variable with whitespace', () => {
      const mockDocument = createMockDocument(['x .map()']);

      const result = graphBuilder.detectVariableReference(mockDocument, 0, ['x']);

      expect(result).toBe('x');
    });

    it('returns null when variable not found', () => {
      const mockDocument = createMockDocument(['z.map()']);

      const result = graphBuilder.detectVariableReference(mockDocument, 0, ['x', 'y']);

      expect(result).toBeNull();
    });

    it('detects variable on previous line for dot continuation', () => {
      const mockDocument = createMockDocument(['x', '.map()']);

      const result = graphBuilder.detectVariableReference(mockDocument, 1, ['x']);

      expect(result).toBe('x');
    });

    it('detects variable after assignment on previous line', () => {
      const mockDocument = createMockDocument(['let y = x', '.map()']);

      const result = graphBuilder.detectVariableReference(mockDocument, 1, ['x']);

      expect(result).toBe('x');
    });

    it('handles out of bounds line numbers', () => {
      const mockDocument = createMockDocument(['x.map()']);

      const result = graphBuilder.detectVariableReference(mockDocument, 100, ['x']);

      expect(result).toBeNull();
    });

    it('prioritizes correct variable when multiple match', () => {
      const mockDocument = createMockDocument(['x.map()']);

      const result = graphBuilder.detectVariableReference(mockDocument, 0, ['x', 'xx']);

      expect(result).toBe('x'); // Exact match should win
    });
  });

  describe('enhanceWithLSP', () => {
    it('enhances nodes with LSP location information', () => {
      const mockDocument = createMockDocument(['let x = source.map();']);

      const nodes = [createGraphNode('0', 'Transform', 'map', 0, 15)];

      const locations = [
        {
          operatorName: 'map',
          locationKind: 'Process<Leader>',
          range: {
            start: { line: 0, character: 15 },
            end: { line: 0, character: 18 },
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphBuilder.enhanceWithLSP(nodes, locations as any[], mockDocument);

      expect(nodes[0].data.locationKind).toBe('Process<Leader>');
      expect(nodes[0].data.locationType).toBe('Process');
      expect(nodes[0].data.locationId).not.toBeNull();
    });

    it('does not enhance when operator names mismatch', () => {
      const mockDocument = createMockDocument(['let x = source.map();']);

      const nodes = [createGraphNode('0', 'Transform', 'map', 0, 15)];

      const locations = [
        {
          operatorName: 'filter', // Different operator
          locationKind: 'Process<Leader>',
          range: {
            start: { line: 0, character: 15 },
            end: { line: 0, character: 21 },
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphBuilder.enhanceWithLSP(nodes, locations as any[], mockDocument);

      expect(nodes[0].data.locationKind).toBeUndefined();
      expect(nodes[0].data.locationType).toBeNull();
    });

    it('matches closest location when multiple candidates', () => {
      const mockDocument = createMockDocument(['map(); map();']);

      const nodes = [createGraphNode('0', 'Transform', 'map', 0, 0)];

      const locations = [
        {
          operatorName: 'map',
          locationKind: 'Process<Leader>',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
        },
        {
          operatorName: 'map',
          locationKind: 'Process<Worker>',
          range: {
            start: { line: 0, character: 7 },
            end: { line: 0, character: 10 },
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphBuilder.enhanceWithLSP(nodes, locations as any[], mockDocument);

      // Should match first location (closer)
      expect(nodes[0].data.locationKind).toBe('Process<Leader>');
    });

    it('skips enhancement when distance too large', () => {
      const mockDocument = createMockDocument(['map();', '', '', '', '', 'map();']);

      const nodes = [createGraphNode('0', 'Transform', 'map', 0, 0)];

      const locations = [
        {
          operatorName: 'map',
          locationKind: 'Process<Leader>',
          range: {
            start: { line: 5, character: 0 }, // Far away
            end: { line: 5, character: 3 },
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphBuilder.enhanceWithLSP(nodes, locations as any[], mockDocument);

      // Should not enhance (distance > 300)
      expect(nodes[0].data.locationKind).toBeUndefined();
    });
  });
});

/**
 * Helper to create mock OperatorNode
 */
function createOperatorNode(
  name: string,
  line: number,
  column: number,
  tickVariable?: string
): OperatorNode {
  return {
    name,
    line,
    column,
    endLine: line,
    endColumn: column + name.length,
    tickVariable,
  };
}

/**
 * Helper to create mock graph node
 */
function createGraphNode(
  id: string,
  nodeType: 'Transform' | 'Source' | 'Sink',
  shortLabel: string,
  line: number,
  column: number
) {
  return {
    id,
    nodeType,
    shortLabel,
    fullLabel: shortLabel,
    label: shortLabel,
    data: {
      locationId: null,
      locationType: null,
      locationKind: undefined,
      backtrace: [] as [],
      treeSitterPosition: {
        line,
        column,
      },
    },
  };
}

/**
 * Helper to create mock VS Code document
 */
function createMockDocument(lines: string[]): vscode.TextDocument {
  return {
    lineCount: lines.length,
    lineAt: (line: number) => ({
      text: lines[line] || '',
      range: {} as vscode.Range,
    }),
    getText: (range?: vscode.Range) => {
      if (!range) {
        return lines.join('\n');
      }
      // Simple mock - just return the line text
      return lines[0] || '';
    },
  } as unknown as vscode.TextDocument;
}
