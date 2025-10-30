/**
 * Unit test for LSPAnalyzer receiver-hover fallback across lines (multiline dot-chain start)
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
  const getConfiguration = (section?: string) => {
    return {
      get: (key: string, defaultValue?: unknown) => {
        if (section === 'hydroIde.operators') {
          if (key === 'networkingOperators') return [] as string[];
          if (key === 'coreDataflowOperators') return ['map', 'filter', 'into_keyed', 'fold', 'clone'];
          if (key === 'sinkOperators') return ['for_each'];
        }
        return defaultValue;
      },
    } as unknown as import('vscode').WorkspaceConfiguration;
  };
  const commands = {
    executeCommand: vi.fn(
      async (cmd: string, _uri: unknown, position: { line: number; character: number }) => {
        if (cmd !== 'vscode.executeHoverProvider') return [];
        const lineText = mockDocumentLines[position.line];
        const dotIdx = lineText.indexOf('.');
        if (dotIdx !== -1) {
          // When hovering an operator token on a ".op()" line, return a signature that yields Self
          if (position.character >= dotIdx + 1) {
            return [
              {
                contents: [
                  { value: '```rust\nimpl Stream<T, L>\npub fn clone(&self) -> Self\n```' },
                ],
              },
            ];
          }
        }
        // Otherwise, treat as hovering the receiver identifier and return its concrete type
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
    ),
  };
  return { Range: MockRange, Position: MockPosition, workspace: { getConfiguration }, commands };
});

// Helper to create a mock TextDocument for a multi-line snippet
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

describe('LSPAnalyzer multiline receiver-hover fallback', () => {
  const analyzer = new LSPAnalyzer(undefined);

  it('colors clone at chain start when receiver is on previous line', async () => {
    // Simulate:
    //   ops
    //     .clone()
    const lines = ['ops', '  .clone()'];
    const doc = createMockDocument(lines);

    const opStart = lines[1].indexOf('clone');
    const PositionCtor = (
      vscode as unknown as { Position: new (l: number, c: number) => vscode.Position }
    ).Position;
    const pos = new PositionCtor(1, opStart);

    const results = await analyzer.analyzePositions(
      doc,
      [{ position: pos, operatorName: 'clone' }],
      2000
    );

    expect(results.length).toBe(1);
    expect(results[0].operatorName).toBe('clone');
    expect(results[0].locationKind).toBe('Process<Leader>');
  });
});
