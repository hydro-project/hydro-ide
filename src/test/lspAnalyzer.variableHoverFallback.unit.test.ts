/**
 * Unit test: variables assigned from function-returned Hydro collections are colored via variable hover
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
  const getConfiguration = (_section?: string) => {
    return {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    } as unknown as import('vscode').WorkspaceConfiguration;
  };
  const commands = {
    executeCommand: vi.fn(async (cmd: string, _uri: unknown, position: { line: number; character: number }) => {
      if (cmd !== 'vscode.executeHoverProvider') return [];
      if (position.line === 0) {
        // Hovering 'ht' variable name shows its concrete type
        return [
          { contents: [{ value: "```rust\nlet ht: KeyedSingleton<String, V, Tick<Process<'a, Leader>>, Bounded>\n```" }] },
        ];
      }
      if (position.line === 1) {
        // Hovering 'gets' variable name shows its concrete type
        return [
          { contents: [{ value: "```rust\nlet gets: Stream<(String, ()), Tick<Process<'a, Leader>>, Bounded>\n```" }] },
        ];
      }
      return [];
    })
  };
  return { Range: MockRange, Position: MockPosition, workspace: { getConfiguration }, commands };
});

const mockDocumentLines: string[] = [];

function createMockDocument(lines: string[]): vscode.TextDocument {
  mockDocumentLines.splice(0, mockDocumentLines.length, ...lines);
  const doc: Partial<vscode.TextDocument> = {
    lineCount: lines.length,
    lineAt: (pos: number | vscode.Position) => {
      const line = typeof pos === 'number' ? pos : pos.line;
      return { text: lines[line] } as unknown as vscode.TextLine;
    },
    getWordRangeAtPosition: (_pos: vscode.Position) => {
      // Not used in this test path
      return undefined;
    },
    fileName: 'mock.rs',
    uri: { fsPath: '/mock.rs' } as unknown as vscode.Uri,
  };
  return doc as vscode.TextDocument;
}

describe('LSPAnalyzer variable hover fallback', () => {
  const analyzer = new LSPAnalyzer(undefined);

  it('colors variables assigned from function-returned collections via hover', async () => {
    const lines = [
      'let ht = Self::ht_build(operations.clone());',
      'let gets = Self::batch_gets(operations.clone().batch(ticker, nondet!()));',
    ];
    const doc = createMockDocument(lines);

    const variableBindings = [
      { variableName: 'ht', line: 0, operators: [] as Array<{ name: string; line: number; column: number }>, usages: [] },
      { variableName: 'gets', line: 1, operators: [] as Array<{ name: string; line: number; column: number }>, usages: [] },
    ];

    const results = await analyzer.colorizeVariables(doc, [], variableBindings);

    const byName = new Map(results.map((r) => [r.operatorName, r]));
    const htLoc = byName.get('ht')?.locationKind;
    const getsLoc = byName.get('gets')?.locationKind;
    expect(htLoc === 'Process<Leader>' || htLoc === 'Tick<Process<Leader>>').toBe(true);
    expect(getsLoc === 'Process<Leader>' || getsLoc === 'Tick<Process<Leader>>').toBe(true);
  });
});
