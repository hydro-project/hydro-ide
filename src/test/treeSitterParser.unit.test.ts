/**
 * Unit tests for TreeSitterRustParser
 * 
 * These tests validate the tree-sitter parsing logic in isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { TreeSitterRustParser } from '../analysis/treeSitterParser';

// Mock VSCode
vi.mock('vscode', () => ({
  Range: class MockRange {
    constructor(public start: { line: number; character: number }, public end: { line: number; character: number }) {}
  },
  Position: class MockPosition {
    constructor(public line: number, public character: number) {}
  },
  OutputChannel: {
    appendLine: vi.fn(),
  },
}));

describe('TreeSitterRustParser Unit Tests', () => {
  let mockOutputChannel: vscode.OutputChannel;
  let parser: TreeSitterRustParser;

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
    parser = new TreeSitterRustParser(mockOutputChannel);
  });

  describe('Variable Binding Extraction', () => {
    it('should extract simple variable assignments', () => {
      const code = 'let process = flow.process();';
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      
      expect(bindings).toHaveLength(1);
      expect(bindings[0].varName).toBe('process');
      expect(bindings[0].operators).toHaveLength(1);
      expect(bindings[0].operators[0].name).toBe('process');
    });

    it('should extract method chain assignments', () => {
      const code = `let words = process
        .source_iter(vec!["abc"])
        .map(|s| s.to_string());`;
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      
      expect(bindings).toHaveLength(1);
      expect(bindings[0].varName).toBe('words');
      expect(bindings[0].operators).toHaveLength(2);
      expect(bindings[0].operators.map(op => op.name)).toEqual(['source_iter', 'map']);
    });

    it('should extract complex multi-line chains', () => {
      const code = `let batches = partitioned_words
        .batch(&cluster.tick())
        .fold(|| 0, |count, _| *count += 1)
        .entries()
        .values();`;
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      
      expect(bindings).toHaveLength(1);
      expect(bindings[0].varName).toBe('batches');
      expect(bindings[0].operators).toHaveLength(4);
      expect(bindings[0].operators.map(op => op.name)).toEqual(['batch', 'fold', 'entries', 'values']);
    });

    it('should not include argument operators in main chains', () => {
      const code = `let batches = partitioned_words
        .batch(&cluster.tick())
        .fold(|| 0, |count, _| *count += 1);`;
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      
      expect(bindings).toHaveLength(1);
      const operatorNames = bindings[0].operators.map(op => op.name);
      expect(operatorNames).toEqual(['batch', 'fold']);
      expect(operatorNames).not.toContain('tick'); // tick is an argument, not main chain
    });
  });

  describe('Standalone Chain Extraction', () => {
    it('should extract standalone operator chains', () => {
      const code = `reduced
        .snapshot(&process.tick())
        .entries()
        .all_ticks()
        .for_each(|x| println!("{:?}", x));`;
      const mockDocument = createMockDocument(code);
      
      const chains = parser.parseStandaloneChains(mockDocument);
      
      expect(chains).toHaveLength(1);
      expect(chains[0]).toHaveLength(4);
      expect(chains[0].map(op => op.name)).toEqual(['snapshot', 'entries', 'all_ticks', 'for_each']);
    });

    it('should not extract variable assignments as standalone chains', () => {
      const code = `let words = process.source_iter(vec!["abc"]).map(|s| s);`;
      const mockDocument = createMockDocument(code);
      
      const chains = parser.parseStandaloneChains(mockDocument);
      
      expect(chains).toHaveLength(0); // This is a variable assignment, not standalone
    });

    it('should handle multiple standalone chains', () => {
      const code = `
        reduced.snapshot().entries().for_each(|x| println!("{:?}", x));
        other.map().filter().collect();
      `;
      const mockDocument = createMockDocument(code);
      
      const chains = parser.parseStandaloneChains(mockDocument);
      
      expect(chains).toHaveLength(2);
      expect(chains[0].map(op => op.name)).toEqual(['snapshot', 'entries', 'for_each']);
      expect(chains[1].map(op => op.name)).toEqual(['map', 'filter', 'collect']);
    });
  });

  describe('Operator Position Tracking', () => {
    it('should track correct line and column positions', () => {
      const code = `let words = process
        .source_iter(vec!["abc"])
        .map(|s| s.to_string());`;
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      const operators = bindings[0].operators;
      
      // Verify positions are tracked (exact values depend on AST structure)
      expect(operators[0].line).toBeGreaterThanOrEqual(0);
      expect(operators[0].column).toBeGreaterThanOrEqual(0);
      expect(operators[1].line).toBeGreaterThanOrEqual(operators[0].line);
    });

    it('should sort operators by position', () => {
      const code = `let result = data.map().filter().collect();`;
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      const operators = bindings[0].operators;
      
      // Operators should be sorted by line, then column
      for (let i = 1; i < operators.length; i++) {
        const prev = operators[i - 1];
        const curr = operators[i];
        
        if (prev.line === curr.line) {
          expect(curr.column).toBeGreaterThanOrEqual(prev.column);
        } else {
          expect(curr.line).toBeGreaterThanOrEqual(prev.line);
        }
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty files', () => {
      const code = '';
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      const chains = parser.parseStandaloneChains(mockDocument);
      
      expect(bindings).toHaveLength(0);
      expect(chains).toHaveLength(0);
    });

    it('should handle files with no operator chains', () => {
      const code = `
        let x = 5;
        let y = "hello";
        println!("test");
      `;
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      const chains = parser.parseStandaloneChains(mockDocument);
      
      expect(bindings).toHaveLength(0); // No method chains
      expect(chains).toHaveLength(0);
    });

    it('should handle malformed code gracefully', () => {
      const code = `let incomplete = process.`;
      const mockDocument = createMockDocument(code);
      
      // Should not throw, even with incomplete syntax
      expect(() => {
        parser.parseVariableBindings(mockDocument);
        parser.parseStandaloneChains(mockDocument);
      }).not.toThrow();
    });

    it('should handle very long operator chains', () => {
      const operators = Array.from({ length: 10 }, (_, i) => `op${i}`); // Reduce to 10 for valid syntax
      const code = `let result = data.${operators.map(op => `${op}()`).join('.')};`;
      const mockDocument = createMockDocument(code);
      
      const bindings = parser.parseVariableBindings(mockDocument);
      
      expect(bindings).toHaveLength(1);
      expect(bindings[0].operators).toHaveLength(10);
    });
  });

  describe('Regression Tests', () => {
    it('should maintain compatibility with map_reduce.rs structure', () => {
      // Test key patterns from the actual map_reduce.rs file
      const testCases = [
        {
          name: 'process assignment',
          code: 'let process = flow.process();',
          expectedVar: 'process',
          expectedOps: ['process']
        },
        {
          name: 'words chain',
          code: `let words = process
            .source_iter(q!(vec!["abc"]))
            .map(q!(|s| s.to_string()));`,
          expectedVar: 'words',
          expectedOps: ['source_iter', 'map']
        },
        {
          name: 'batches complex chain',
          code: `let batches = partitioned_words
            .batch(&cluster.tick())
            .fold(q!(|| 0), q!(|count, _| *count += 1))
            .entries()
            .inspect(q!(|(string, count)| println!("{}: {}", string, count)))
            .all_ticks()
            .send_bincode(&process)
            .values();`,
          expectedVar: 'batches',
          expectedOps: ['batch', 'fold', 'entries', 'inspect', 'all_ticks', 'send_bincode', 'values']
        }
      ];

      testCases.forEach(testCase => {
        const mockDocument = createMockDocument(testCase.code);
        const bindings = parser.parseVariableBindings(mockDocument);
        
        expect(bindings, `Failed for ${testCase.name}`).toHaveLength(1);
        expect(bindings[0].varName, `Wrong variable name for ${testCase.name}`).toBe(testCase.expectedVar);
        expect(bindings[0].operators.map(op => op.name), `Wrong operators for ${testCase.name}`)
          .toEqual(testCase.expectedOps);
      });
    });

    it('should handle the standalone chain from map_reduce.rs', () => {
      const code = `reduced
        .snapshot(&process.tick(), nondet!(/** intentional output */))
        .entries()
        .all_ticks()
        .assume_ordering(nondet!(/** unordered logs across keys are okay */))
        .for_each(q!(|(string, count)| println!("{}: {}", string, count)));`;
      
      const mockDocument = createMockDocument(code);
      const chains = parser.parseStandaloneChains(mockDocument);
      
      expect(chains).toHaveLength(1);
      expect(chains[0].map(op => op.name)).toEqual([
        'snapshot', 'entries', 'all_ticks', 'assume_ordering', 'for_each'
      ]);
    });
  });
});

/**
 * Helper function to create mock VSCode TextDocument
 */
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
        // Multi-line (shouldn't happen for variable names, but handle it)
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
  } as vscode.TextDocument;
}

