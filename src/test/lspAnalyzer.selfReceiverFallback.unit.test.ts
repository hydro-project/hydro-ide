/**
 * Unit test for LSPAnalyzer receiver-hover fallback when operator returns Self at chain start
 */

import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { LSPAnalyzer } from '../analysis/lspAnalyzer';

// Mock VSCode minimal API used by LSPAnalyzer
vi.mock('vscode', () => {
  class MockRange {
    start: { line: number; character: number };
    end: { line: number; character: number };
    constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }
  }
  class MockPosition {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  // Provide workspace.getConfiguration used by isValidHydroOperator
  const getConfiguration = (section?: string) => {
    return {
      get: (key: string, defaultValue?: unknown) => {
        if (section === 'hydroIde.operators') {
          if (key === 'networkingOperators') return [] as string[];
          if (key === 'coreDataflowOperators') return ['map', 'filter', 'into_keyed', 'fold'];
          if (key === 'sinkOperators') return ['for_each'];
        }
        return defaultValue;
      },
    } as unknown as import('vscode').WorkspaceConfiguration;
  };
  // Mock commands.executeCommand for hover provider
  const commands = {
    executeCommand: vi.fn(
      async (cmd: string, _uri: unknown, position: { line: number; character: number }) => {
        if (cmd !== 'vscode.executeHoverProvider') return [];
        const lineText = mockDocumentLines[position.line];
        const dotIdx = lineText.indexOf('.');
        if (dotIdx !== -1) {
          // Operator hover when position is on/after operator token
          if (position.character >= dotIdx + 1) {
            // Return a rust code block with a function signature that returns Self
            return [
              {
                contents: [
                  {
                    value:
                      '```rust\nimpl Stream<T, L, B, O, R>\npub fn filter<F>(self, f: F) -> Self\n```',
                  },
                ],
              },
            ];
          }
          // Receiver hover returns a variable decl with its type after the colon
          return [
            {
              contents: [
                {
                  value:
                    "```rust\nlet ops: Stream<KVSOperation<V>, Process<'a, Leader>, Unbounded, TotalOrder, ExactlyOnce>\n```",
                },
              ],
            },
          ];
        }
        return [];
      }
    ),
  };
  return {
    Range: MockRange,
    Position: MockPosition,
    workspace: { getConfiguration },
    commands,
  };
});

// Helper to create a mock TextDocument for a single-line snippet
const mockDocumentLines: string[] = [];

function createMockDocument(lines: string[]): vscode.TextDocument {
  mockDocumentLines.splice(0, mockDocumentLines.length, ...lines);
  const doc: Partial<vscode.TextDocument> = {
    lineCount: lines.length,
    lineAt: (pos: number | vscode.Position) => {
      const line = typeof pos === 'number' ? pos : pos.line;
      return { text: lines[line] } as unknown as vscode.TextLine;
    },
    getWordRangeAtPosition: (pos: vscode.Position) => {
      const text = lines[pos.line];
      // Expand around position to word characters [A-Za-z_]
      let s = pos.character;
      let e = pos.character;
      const isWord = (ch: string) => /[A-Za-z_]/.test(ch);
      while (s > 0 && isWord(text[s - 1])) s--;
      while (e < text.length && isWord(text[e])) e++;
      if (s === e) return undefined;
      const RangeCtor = (
        vscode as unknown as {
          Range: new (sl: number, sc: number, el: number, ec: number) => vscode.Range;
        }
      ).Range;
      return new RangeCtor(pos.line, s, pos.line, e);
    },
    fileName: 'mock.rs',
    uri: { fsPath: '/mock.rs' } as unknown as vscode.Uri,
  };
  return doc as vscode.TextDocument;
}

describe('LSPAnalyzer receiver-hover fallback', () => {
  const analyzer = new LSPAnalyzer(undefined);

  it('colors filter at chain start by deriving location from receiver hover', async () => {
    // Simulate: ops.filter(q!(...)) on a single line (chain start)
    const line = 'ops.filter(q!(|op| matches!(op, KVSOperation::Put(_, _))))';
    const doc = createMockDocument([line]);

    // Position at start of 'filter'
    const opStart = line.indexOf('filter');
    const PositionCtor = (
      vscode as unknown as { Position: new (l: number, c: number) => vscode.Position }
    ).Position;
    const pos = new PositionCtor(0, opStart);

    const results = await analyzer.analyzePositions(
      doc,
      [{ position: pos, operatorName: 'filter' }],
      2000
    );

    expect(results.length).toBe(1);
    expect(results[0].operatorName).toBe('filter');
    expect(results[0].locationKind).toBe('Process<Leader>');
  });
});
