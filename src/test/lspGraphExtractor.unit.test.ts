/**
 * Unit tests for LSP Graph Extractor filtering logic
 *
 * These tests validate the type-based filtering that should exclude
 * location constructors like flow.cluster() while including dataflow operators.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { LSPGraphExtractor } from '../analysis/lspGraphExtractor';
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
    it('should identify method calls vs variable references', () => {
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
