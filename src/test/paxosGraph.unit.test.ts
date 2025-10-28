/**
 * Paxos graph extraction tests (connections and hierarchies)
 *
 * These tests parse the real paxos.rs source and verify:
 * - Key networking operators are present and typed as Network
 * - Expected intra-chain edges exist (sample_every -> broadcast_bincode -> values)
 * - Location hierarchy groups networking ops under base location (Leader)
 * - Code hierarchy creates function containers (prefixed with `fn `)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  LSPGraphExtractor,
  type Node as GNode,
  type Edge as GEdge,
  type Hierarchy,
  type HierarchyContainer,
} from '../analysis/lspGraphExtractor';

// Mock VSCode minimal API used by extractor
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
    file: vi.fn().mockImplementation((p: string) => ({ path: p })),
  },
  commands: {
    executeCommand: vi.fn(),
  },
  workspace: {
    openTextDocument: vi.fn(),
  },
}));

describe('Paxos Graph Extraction', () => {
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

  it('extracts expected networking chains and hierarchies from paxos.rs', () => {
    // Load real paxos.rs from sibling hydro workspace
    const paxosPath = path.resolve(process.cwd(), '../hydro/hydro_test/src/cluster/paxos.rs');
    const code = fs.readFileSync(paxosPath, 'utf8');
    const doc = createMockDocument(code, paxosPath);

    // Build nodes/edges from tree-sitter
    const { nodes, edges } = (
      extractor as unknown as {
        buildOperatorChainsFromTreeSitter: (
          doc: vscode.TextDocument,
          scope: { type: string; functions: unknown[]; workspaceRoot: string }
        ) => { nodes: GNode[]; edges: GEdge[] };
      }
    ).buildOperatorChainsFromTreeSitter(doc, {
      type: 'file',
      functions: [],
      workspaceRoot: process.cwd(),
    });

    // Enhance with default locations (no LSP)
    (
      extractor as unknown as {
        enhanceNodesWithLSPInfo: (
          nodes: GNode[],
          locations: Array<{
            operatorName: string;
            range: vscode.Range;
            locationKind: string | null;
          }>,
          doc: vscode.TextDocument
        ) => void;
      }
    ).enhanceNodesWithLSPInfo(nodes, [], doc);

    // Build hierarchies
    const hier = (
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

    // Basic presence checks
    expect(nodes.length).toBeGreaterThan(0);
    const names = nodes.map((n) => n.shortLabel);
    expect(names).toContain('broadcast_bincode');
    expect(names).toContain('demux_bincode');

    // Node type checks for networking
    const broadcastNodes = nodes.filter((n) => n.shortLabel === 'broadcast_bincode');
    const demuxNodes = nodes.filter((n) => n.shortLabel === 'demux_bincode');
    expect(broadcastNodes.length).toBeGreaterThan(0);
    expect(demuxNodes.length).toBeGreaterThan(0);
    expect(broadcastNodes.every((n) => n.nodeType === 'Network')).toBe(true);
    expect(demuxNodes.every((n) => n.nodeType === 'Network')).toBe(true);

    // Check expected edge adjacencies in p_leader_heartbeat chain: sample_every -> broadcast_bincode -> values
    const hasEdge = (srcLabel: string, dstLabel: string) => {
      const byId = new Map(nodes.map((n) => [n.id, n] as const));
      return edges.some(
        (e) =>
          byId.get(e.source)?.shortLabel === srcLabel && byId.get(e.target)?.shortLabel === dstLabel
      );
    };
    expect(hasEdge('sample_every', 'broadcast_bincode')).toBe(true);
    expect(hasEdge('broadcast_bincode', 'values')).toBe(true);

    // Location hierarchy: networking ops default to Cluster<Leader> base (Leader)
    const locationHierarchy = hier.hierarchyChoices.find((h) => h.id === 'location') as Hierarchy;
    expect(locationHierarchy).toBeTruthy();
    // Find base Leader container
    const leaderRoot = locationHierarchy.children.find((c) => c.name === 'Leader');
    expect(leaderRoot, 'Leader base container exists').toBeTruthy();

    const assigned = hier.nodeAssignments.location;
    // All networking nodes should be assigned under the Leader subtree (root or tick children)
    for (const n of [...broadcastNodes, ...demuxNodes]) {
      const cid = assigned[n.id];
      expect(cid, `assignment for ${n.shortLabel}`).toBeTruthy();
      // Either assigned directly to Leader or to a child under Leader
      // Walk to verify ancestry
      const root = leaderRoot as HierarchyContainer;
      const contains = (nodeId: string) => {
        const stack: HierarchyContainer[] = [root];
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur.id === nodeId) return true;
          for (const ch of cur.children) stack.push(ch);
        }
        return false;
      };
      expect(contains(cid)).toBe(true);
    }

    // Code hierarchy: ensure functions are captured and prefixed with `fn `
    const codeHierarchy = hier.hierarchyChoices.find((h) => h.id === 'code') as Hierarchy;
    expect(codeHierarchy).toBeTruthy();
    const fileContainer = codeHierarchy.children[0];
    expect(fileContainer.name.endsWith('paxos.rs')).toBe(true);

    // Look for at least one known function container by name
    const fnNames = new Set((fileContainer.children as HierarchyContainer[]).map((c) => c.name));
    const expectedFns = [
      'fn leader_election',
      'fn p_leader_heartbeat',
      'fn acceptor_p1',
      'fn acceptor_p2',
    ];
    expect(expectedFns.some((fn) => fnNames.has(fn))).toBe(true);
  });
});

function createMockDocument(code: string, filename: string): vscode.TextDocument {
  const lines = code.split('\n');
  return {
    getText: (range?: vscode.Range) => {
      if (!range) {
        return code;
      }
      const startLine = range.start.line;
      const startChar = range.start.character;
      const endLine = range.end.line;
      const endChar = range.end.character;

      if (startLine === endLine) {
        return lines[startLine]?.substring(startChar, endChar) || '';
      } else {
        let result = lines[startLine]?.substring(startChar) || '';
        for (let i = startLine + 1; i < endLine; i++) {
          result += '\n' + (lines[i] || '');
        }
        result += '\n' + (lines[endLine]?.substring(0, endChar) || '');
        return result;
      }
    },
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] || '' }),
    fileName: filename,
    uri: { path: filename },
    version: 1,
  } as unknown as vscode.TextDocument;
}
