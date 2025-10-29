/**
 * Unit tests for LSP Graph Extractor filtering logic
 *
 * These tests validate the type-based filtering that should exclude
 * location constructors like flow.cluster() while including dataflow operators.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  LSPGraphExtractor,
  type Node as GNode,
  type Edge as GEdge,
  type Hierarchy,
  type HierarchyContainer,
} from '../analysis/lspGraphExtractor';
import { LocationInfo } from '../analysis/locationAnalyzer';

// Mock VSCode
vi.mock('vscode', () => ({
  Range: class MockRange {
    constructor(
      public start: { line: number; character: number },
      public end: { line: number; character: number }
    ) {}
  },
  Position: class MockPosition {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  Uri: {
    file: vi.fn().mockImplementation((path: string) => ({ path })),
  },
  commands: {
    executeCommand: vi.fn(),
  },
  workspace: {
    openTextDocument: vi.fn(),
  },
}));

describe('LSP Graph Extractor Unit Tests', () => {
  let mockOutputChannel: vscode.OutputChannel;
  let extractor: LSPGraphExtractor;

  beforeEach(() => {
    mockOutputChannel = {
      name: 'test',
      append: vi.fn(),
      appendLine: vi.fn(),
      replace: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    } as vscode.OutputChannel;

    extractor = new LSPGraphExtractor(mockOutputChannel);
  });

  describe('Type-based Filtering', () => {
    it('should exclude location constructors (flow.cluster, flow.process)', () => {
      // Test the isValidDataflowOperator method directly
      const testCases = [
        // Location constructors - should be excluded
        { operatorName: 'cluster', returnType: 'Cluster<Worker>', expected: false },
        { operatorName: 'process', returnType: 'Process<Leader>', expected: false },

        // Dataflow operators - should be included
        {
          operatorName: 'source_iter',
          returnType: 'Stream<String, Process<Leader>, Unbounded>',
          expected: true,
        },
        {
          operatorName: 'map',
          returnType: 'Stream<i32, Process<Leader>, Unbounded>',
          expected: true,
        },
        {
          operatorName: 'fold',
          returnType: 'Singleton<i32, Process<Leader>, Bounded>',
          expected: true,
        },

        // Sink operators - should be included
        { operatorName: 'for_each', returnType: '()', expected: true },
        {
          operatorName: 'inspect',
          returnType: 'Stream<String, Process<Leader>, Unbounded>',
          expected: true,
        },

        // Edge cases
        { operatorName: 'unknown', returnType: 'SomeOtherType', expected: false },
      ];

      for (const testCase of testCases) {
        // Access the private method for testing
        const result = (
          extractor as unknown as {
            isValidDataflowOperator: (name: string, returnType: string | null) => boolean;
          }
        ).isValidDataflowOperator(testCase.operatorName, testCase.returnType);
        expect(
          result,
          `${testCase.operatorName} with return type "${testCase.returnType}" should ${testCase.expected ? 'be included' : 'be excluded'}`
        ).toBe(testCase.expected);
      }
    });

    it('should handle null/undefined return types gracefully', () => {
      // When return type is not available, the operator should be allowed through
      // (this is the conservative approach - let it through and let other validation handle it)
      const result = (
        extractor as unknown as {
          isValidDataflowOperator: (name: string, returnType: string | null) => boolean;
        }
      ).isValidDataflowOperator('unknown_operator', null);
      expect(result).toBe(false); // null return type should return false, but the calling code allows it through
    });

    it('should identify sink operators correctly', () => {
      const testCases = [
        { operatorName: 'for_each', returnType: '()', expected: true },
        { operatorName: 'inspect', returnType: 'Stream<T>', expected: true }, // inspect returns the stream, not ()
        { operatorName: 'collect', returnType: '()', expected: true },
        { operatorName: 'source_iter', returnType: '()', expected: true }, // if source_iter returned (), it would be a sink
      ];

      for (const testCase of testCases) {
        const result = (
          extractor as unknown as {
            isValidDataflowOperator: (name: string, returnType: string | null) => boolean;
          }
        ).isValidDataflowOperator(testCase.operatorName, testCase.returnType);
        expect(
          result,
          `${testCase.operatorName} with return type "${testCase.returnType}" should ${testCase.expected ? 'be included' : 'be excluded'}`
        ).toBe(testCase.expected);
      }
    });
  });

  describe('Operator Call Detection', () => {
    it.skip('should identify method calls vs variable references', () => {
      const code = `
        let process = flow.process();
        let words = process.source_iter(vec!["abc"]);
        words.map(|x| x).for_each(|x| println!("{}", x));
      `;
      const mockDocument = createMockDocument(code);

      // Find the actual positions
      const lines = code.split('\n');
      const line1 = lines[1] || '';
      const line2 = lines[2] || '';
      const line3 = lines[3] || '';

      const processPos = line1.indexOf('process', line1.indexOf('flow.'));
      const sourceIterPos = line2.indexOf('source_iter');
      const mapPos = line3.indexOf('map');

      const testCases = [
        // flow.process() - should be detected as operator call (followed by parentheses)
        { line: 1, char: processPos, identifier: 'process', expected: true },

        // process.source_iter() - should be detected as operator call (preceded by dot)
        { line: 2, char: sourceIterPos, identifier: 'source_iter', expected: true },

        // words.map() - should be detected as operator call (preceded by dot)
        { line: 3, char: mapPos, identifier: 'map', expected: true },
      ];

      for (const testCase of testCases) {
        const mockLocation = {
          range: new vscode.Range(
            new vscode.Position(testCase.line, testCase.char),
            new vscode.Position(testCase.line, testCase.char + testCase.identifier.length)
          ),
          operatorName: testCase.identifier,
          locationType: 'test',
          locationKind: 'test',
          fullReturnType: 'test',
        };

        const result = (
          extractor as unknown as {
            isOperatorCall: (document: vscode.TextDocument, location: LocationInfo) => boolean;
          }
        ).isOperatorCall(mockDocument, mockLocation);
        expect(
          result,
          `${testCase.identifier} at line ${testCase.line} should ${testCase.expected ? 'be detected as operator call' : 'not be detected as operator call'}`
        ).toBe(testCase.expected);
      }
    });
  });

  describe('Hierarchy Construction', () => {
    it('Location: nests Tick levels and groups by tick variable', () => {
      const doc = createMockDocument('');

      // Create nodes across depths for base label Worker, with different tick variables
      const nodes = [
        // depth 0 (base)
        mkNode('a', 'map', 'Process<Worker>'),
        mkNode('b', 'filter', 'Process<Worker>'),
        // depth 1 (Tick<...>) - different tick variables
        {
          ...mkNode('c', 'reduce', 'Tick<Process<Worker>>'),
          data: { ...mkNode('c', 'reduce', 'Tick<Process<Worker>>').data, tickVariable: 'ticker1' },
        },
        {
          ...mkNode('d', 'fold', 'Tick<Process<Worker>>'),
          data: { ...mkNode('d', 'fold', 'Tick<Process<Worker>>').data, tickVariable: 'ticker2' },
        },
        // depth 2 (Tick<Tick<...>>) - uses same tick variable as c
        {
          ...mkNode('e', 'inspect', 'Tick<Tick<Process<Worker>>>'),
          data: {
            ...mkNode('e', 'inspect', 'Tick<Tick<Process<Worker>>>').data,
            tickVariable: 'ticker1',
          },
        },
      ];

      // Edges: a->c, b->d, c->e (c & e share ticker1; d uses ticker2)
      const edges = [mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('c', 'e')];

      const hierarchy = (
        extractor as unknown as {
          buildLocationAndCodeHierarchies: (
            doc: vscode.TextDocument,
            nodes: GNode[],
            edges: GEdge[]
          ) => {
            hierarchyChoices: Hierarchy[];
            nodeAssignments: Record<string, Record<string, string>>;
          };
        }
      ).buildLocationAndCodeHierarchies(doc, nodes, edges);

      const locationHierarchy = hierarchy.hierarchyChoices.find((h) => h.id === 'location');
      expect(locationHierarchy, 'location hierarchy exists').toBeTruthy();

      // Find the base Worker container
      const worker = (locationHierarchy as Hierarchy).children.find(
        (c: HierarchyContainer) => c.name === 'Worker'
      );
      expect(worker, 'Worker base container exists').toBeTruthy();

      // It should have at least two tick variable containers at depth 1 (ticker1 and ticker2)
      const tickChildren = (worker as HierarchyContainer).children;
      expect(tickChildren.length).toBeGreaterThanOrEqual(2);

      // Check assignments: a,b assigned to Worker; c,d assigned to different tick containers; e should be deeper
      const assign = hierarchy.nodeAssignments.location;
      const workerId = worker!.id;
      expect(assign['a']).toBe(workerId);
      expect(assign['b']).toBe(workerId);

      const tickContainersById: Record<string, HierarchyContainer> = {};
      for (const ch of (worker as HierarchyContainer).children) tickContainersById[ch.id] = ch;

      const tickIdC = assign['c'];
      const tickIdD = assign['d'];
      expect(tickIdC).toBeTruthy();
      expect(tickIdD).toBeTruthy();
      // They should be in different containers (different tick variables)
      expect(tickIdC).not.toBe(tickIdD);

      // e should be deeper: assigned to a nested container with the same tick variable name as c
      const eContainerId = assign['e'];
      expect(eContainerId).toBeTruthy();
      // Walk to find container by id and check its name matches the tick variable
      const findById = (root: HierarchyContainer, id: string): HierarchyContainer | null => {
        const stack: HierarchyContainer[] = [root];
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur.id === id) return cur;
          for (const ch of cur.children) stack.push(ch);
        }
        return null;
      };
      const eContainer = findById(worker as HierarchyContainer, eContainerId);
      // Container should be named after the tick variable (ticker1), not the generic Tick<Tick<Worker>>
      expect(eContainer?.name).toBe('ticker1');
    });

    it('Code: creates file→fn→var, prefixes fn, collapses single child chains', () => {
      // Prepare a mock document and build nodes from real tree-sitter positions
      const code = `fn foo() {\n  let words = data.map(|x| x).for_each(|_| {});\n}\n\nfn bar() {\n  data.inspect(42);\n}`;
      const doc = createMockDocument(code);

      const parser = (extractor as unknown as { treeSitterParser: unknown })
        .treeSitterParser as unknown as {
        parseVariableBindings: (d: vscode.TextDocument) => Array<{
          varName: string;
          line: number;
          operators: Array<{
            name: string;
            line: number;
            column: number;
            endLine: number;
            endColumn: number;
          }>;
        }>;
        parseStandaloneChains: (
          d: vscode.TextDocument
        ) => Array<
          Array<{ name: string; line: number; column: number; endLine: number; endColumn: number }>
        >;
      };

      const bindings = parser.parseVariableBindings(doc);
      const chains = parser.parseStandaloneChains(doc);

      // Create nodes based on parsed positions to ensure mapping works
      const nodes: GNode[] = [];
      for (const b of bindings) {
        for (const op of b.operators) {
          nodes.push(mkNodeWithTS(`n_${op.name}`, op.name, 'Process<Worker>', op.line, op.column));
        }
      }
      for (const chain of chains) {
        for (const op of chain) {
          nodes.push(mkNodeWithTS(`s_${op.name}`, op.name, 'Process<Worker>', op.line, op.column));
        }
      }

      const edges: GEdge[] = [];

      const hierarchy = (
        extractor as unknown as {
          buildLocationAndCodeHierarchies: (
            doc: vscode.TextDocument,
            nodes: GNode[],
            edges: GEdge[]
          ) => {
            hierarchyChoices: Hierarchy[];
            nodeAssignments: Record<string, Record<string, string>>;
          };
        }
      ).buildLocationAndCodeHierarchies(doc, nodes, edges);

      const codeHierarchy = hierarchy.hierarchyChoices.find((h) => h.id === 'code');
      expect(codeHierarchy, 'code hierarchy exists').toBeTruthy();

      // File container
      const fileContainer = (codeHierarchy as Hierarchy).children[0] as HierarchyContainer;
      expect(fileContainer.name).toBe('test.rs');

      // After collapse: expect a single container named "fn foo→words" under file for the variable chain
      const fnFooCollapsed = fileContainer.children.find(
        (c: HierarchyContainer) => c.name === 'fn foo→words'
      );
      expect(fnFooCollapsed, 'collapsed fn foo→words exists').toBeTruthy();

      const assign = hierarchy.nodeAssignments.code;
      // map and for_each from foo() should be assigned to the collapsed fn foo→words container
      expect(assign['n_map']).toBe(fnFooCollapsed!.id);
      expect(assign['n_for_each']).toBe(fnFooCollapsed!.id);
      // inspect from bar() should be assigned to a function container named 'fn bar'
      const sInspectContainerId = assign['s_inspect'];
      const findById = (root: HierarchyContainer, id: string): HierarchyContainer | null => {
        const stack: HierarchyContainer[] = [root];
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur.id === id) return cur;
          for (const ch of cur.children) stack.push(ch);
        }
        return null;
      };
      const sInspectContainer = findById(fileContainer, sInspectContainerId);
      expect(sInspectContainer?.name).toBe('fn bar');
    });
  });
});

function createMockDocument(code: string): vscode.TextDocument {
  const lines = code.split('\n');
  return {
    getText: (range?: vscode.Range) => {
      if (!range) {
        return code;
      }
      // Extract text from range
      const startLine = range.start.line;
      const startChar = range.start.character;
      const endLine = range.end.line;
      const endChar = range.end.character;

      if (startLine === endLine) {
        // Same line
        return lines[startLine]?.substring(startChar, endChar) || '';
      } else {
        // Multi-line
        let result = lines[startLine]?.substring(startChar) || '';
        for (let i = startLine + 1; i < endLine; i++) {
          result += '\n' + (lines[i] || '');
        }
        result += '\n' + (lines[endLine]?.substring(0, endChar) || '');
        return result;
      }
    },
    lineCount: lines.length,
    lineAt: (line: number) => ({
      text: lines[line] || '',
    }),
    fileName: 'test.rs',
    uri: { path: 'test.rs' },
    version: 1,
  } as vscode.TextDocument;
}

// Helpers to construct minimal nodes/edges for hierarchy tests
function mkNode(id: string, op: string, locationKind?: string): GNode {
  return {
    id,
    nodeType: 'Transform',
    shortLabel: op,
    fullLabel: op,
    label: op,
    data: {
      locationId: null,
      locationType: null,
      locationKind,
      backtrace: [],
    },
  };
}

function mkNodeWithTS(
  id: string,
  op: string,
  locationKind: string | undefined,
  line: number,
  column: number
): GNode {
  const n = mkNode(id, op, locationKind);
  (
    n as unknown as { data: { treeSitterPosition?: { line: number; column: number } } }
  ).data.treeSitterPosition = { line, column };
  return n;
}

function mkEdge(source: string, target: string): GEdge {
  return { id: `${source}->${target}`, source, target, semanticTags: [] } as GEdge;
}
