/**
 * Hierarchy Builder
 *
 * Builds hierarchical groupings of nodes for visualization in Hydroscope.
 * Creates both location-based hierarchies (Process, Cluster, External) and
 * code-based hierarchies (file -> function -> variable).
 *
 * Responsibilities:
 * - Group nodes by their Location type (Process, Cluster, External)
 * - Build nested Tick hierarchies for temporal operators
 * - Create code structure hierarchies (file -> function -> variable)
 * - Assign nodes to appropriate containers
 * - Handle nodes without location information (degraded mode)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { TreeSitterRustParser } from './treeSitterParser';
import type {
  GraphNode,
  GraphEdge,
  Hierarchy as CoreHierarchy,
  HierarchyContainer as CoreHierarchyContainer,
} from '../core/graphTypes';

// Use shared graph types; only a subset of fields is required here
// Accept any subset of GraphNode.data fields to keep tests flexible
export type Node = Pick<GraphNode, 'id' | 'shortLabel'> & {
  data: Partial<GraphNode['data']>;
};

export type Edge = Pick<GraphEdge, 'id' | 'source' | 'target'>;

export type HierarchyContainer = CoreHierarchyContainer;

export type Hierarchy = CoreHierarchy;

/**
 * Combined hierarchy data with choices and node assignments
 */
export interface HierarchyData {
  hierarchyChoices: Hierarchy[];
  nodeAssignments: Record<string, Record<string, string>>;
  selectedHierarchy: string;
}

/**
 * Location metadata for a node
 */
interface LocMeta {
  base: string;
  depth: number;
  kind: string | null;
}

/**
 * HierarchyBuilder service for building node hierarchies
 */
export class HierarchyBuilder {
  private treeSitterParser: TreeSitterRustParser;
  private logCallback: ((message: string) => void) | null = null;

  constructor(treeSitterParser: TreeSitterRustParser) {
    this.treeSitterParser = treeSitterParser;
  }

  /**
   * Set a logging callback for debugging
   */
  public setLogCallback(callback: (message: string) => void): void {
    this.logCallback = callback;
  }

  /**
   * Internal logging helper
   */
  private log(message: string): void {
    if (this.logCallback) {
      this.logCallback(`[HierarchyBuilder] ${message}`);
    }
  }

  /**
   * Build location-based and code-based hierarchies
   *
   * Groups nodes by their Location type (Process, Cluster, External) and creates
   * a hierarchical structure for visualization. Also builds code structure
   * hierarchies based on file, function, and variable organization.
   *
   * Implements degraded mode operation:
   * - Creates basic hierarchy even with incomplete location info
   * - Handles null/undefined location types gracefully
   * - Assigns nodes without location info to default container
   * - Logs warnings for degraded mode operation
   *
   * @param document The document being analyzed
   * @param nodes Previously extracted nodes
   * @param edges Previously extracted edges (for connectivity analysis)
   * @returns HierarchyData containing hierarchy choices and node assignments
   */
  public buildLocationAndCodeHierarchies(
    document: vscode.TextDocument,
    nodes: Node[],
    edges: Edge[]
  ): HierarchyData {
    // Build location hierarchy
    const { nodeAssignments: locationAssignments, children: locationChildren } =
      this.buildLocationHierarchy(nodes, edges);

    // Build code hierarchy
    const { nodeAssignments: codeAssignments, children: codeChildren } = this.buildCodeHierarchy(
      document,
      nodes
    );

    const hierarchyChoices: Hierarchy[] = [
      { id: 'location', name: 'Location', children: locationChildren },
      { id: 'code', name: 'Code', children: codeChildren },
    ];

    return {
      hierarchyChoices,
      nodeAssignments: {
        location: locationAssignments,
        code: codeAssignments,
      },
      selectedHierarchy: 'location',
    };
  }

  /**
   * Build location-based hierarchy with nested Tick support
   */
  private buildLocationHierarchy(
    nodes: Node[],
    edges: Edge[]
  ): { nodeAssignments: Record<string, string>; children: HierarchyContainer[] } {
    const nodeAssignments: Record<string, string> = {};
    let containerIdCounter = 0;

    // Build adjacency for all nodes using edges (undirected for connectivity)
    const adjacency = new Map<string, Set<string>>();
    const addEdge = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    };
    for (const e of edges) {
      addEdge(e.source, e.target);
    }

    // Precompute base label and tick depth for each node
    const metaById = new Map<string, LocMeta>();
    const nodesByBase = new Map<string, Node[]>();
    const unknownNodes: Node[] = [];

    for (const n of nodes) {
      const kind = n.data.locationKind || null;
      if (!kind) {
        unknownNodes.push(n);
        continue;
      }
      const base = this.extractLocationLabel(kind);
      const depth = this.countTickDepth(kind);
      metaById.set(n.id, { base, depth, kind });
      if (!nodesByBase.has(base)) nodesByBase.set(base, []);
      nodesByBase.get(base)!.push(n);
    }

    // Build base location roots
    const rootsByLabel = new Map<string, HierarchyContainer>();
    const children: HierarchyContainer[] = [];

    for (const [base, baseNodes] of nodesByBase.entries()) {
      const root: HierarchyContainer = {
        id: `loc_${containerIdCounter++}`,
        name: base,
        children: [],
      };
      rootsByLabel.set(base, root);
      children.push(root);

      // Determine max depth present for this base
      let maxDepth = 0;
      for (const n of baseNodes) {
        const m = metaById.get(n.id)!;
        if (m.depth > maxDepth) maxDepth = m.depth;
      }

      // Mapping node -> container at previous level (for parenting)
      const parentAtLevel = new Map<number, Map<string, string>>();

      // Level 1..maxDepth: split by tick variable
      for (let level = 1; level <= maxDepth; level++) {
        const nodesAtLevel = new Map<string, string[]>(); // tick variable -> node IDs

        for (const n of baseNodes) {
          const m = metaById.get(n.id)!;
          if (m.depth >= level) {
            // Group by tick variable
            const tickVar = n.data.tickVariable || '_unknown_';
            if (!nodesAtLevel.has(tickVar)) {
              nodesAtLevel.set(tickVar, []);
            }
            nodesAtLevel.get(tickVar)!.push(n.id);
          }
        }

        if (nodesAtLevel.size === 0) continue;

        const mapThisLevel = new Map<string, string>();

        // Create a container for each tick variable group
        for (const [tickVar, nodeIds] of nodesAtLevel.entries()) {
          // Determine parent container for this tick group
          let parentContainer: HierarchyContainer = root;
          if (level > 1) {
            const parentMap = parentAtLevel.get(level - 1)!;
            // Pick the first node's parent
            for (const nid of nodeIds) {
              const pid = parentMap.get(nid);
              if (pid) {
                // Find the actual container reference
                const stack: HierarchyContainer[] = [root];
                while (stack.length) {
                  const c = stack.pop()!;
                  if (c.id === pid) {
                    parentContainer = c;
                    break;
                  }
                  for (const ch of c.children) stack.push(ch);
                }
                break;
              }
            }
          }

          // Use tick variable name for container label if available
          let tickLabel: string;
          if (tickVar !== '_unknown_') {
            const parts = tickVar.split('::');
            tickLabel = parts.length > 1 ? parts[parts.length - 1] : tickVar;
          } else {
            tickLabel = this.buildTickLabel(base, level);
          }

          const cont: HierarchyContainer = {
            id: `loc_${containerIdCounter++}`,
            name: tickLabel,
            children: [],
          };
          parentContainer.children.push(cont);

          // Record parent for nodes in this tick scope
          for (const nid of nodeIds) {
            mapThisLevel.set(nid, cont.id);
          }
        }

        parentAtLevel.set(level, mapThisLevel);
      }

      // Assign nodes to deepest level container matching their depth
      for (const n of baseNodes) {
        const m = metaById.get(n.id)!;
        if (m.depth === 0) {
          nodeAssignments[n.id] = root.id;
        } else {
          const mapForDepth = parentAtLevel.get(m.depth);
          if (mapForDepth && mapForDepth.get(n.id)) {
            nodeAssignments[n.id] = mapForDepth.get(n.id)!;
          } else {
            nodeAssignments[n.id] = root.id;
          }
        }
      }
    }

    // Handle nodes without location information
    const unassignedNodes = nodes.filter((node) => !(node.id in nodeAssignments));
    if (unassignedNodes.length > 0) {
      const defaultContainerId = `loc_${containerIdCounter++}`;
      children.push({ id: defaultContainerId, name: '(unknown location)', children: [] });
      for (const node of unassignedNodes) nodeAssignments[node.id] = defaultContainerId;

      this.log(
        `DEGRADED MODE: Created default container '${defaultContainerId}' for ${unassignedNodes.length} unassigned nodes`
      );
    }

    // Ensure we have at least one container
    if (children.length === 0) {
      const fallbackContainerId = 'loc_0';
      children.push({
        id: fallbackContainerId,
        name: '(default)',
        children: [],
      });
      this.log('DEGRADED MODE: Created fallback container as no location groups were found');
    }

    return { nodeAssignments, children };
  }

  /**
   * Build code-based hierarchy (file -> function -> variable)
   */
  private buildCodeHierarchy(
    document: vscode.TextDocument,
    nodes: Node[]
  ): { nodeAssignments: Record<string, string>; children: HierarchyContainer[] } {
    const codeAssignments: Record<string, string> = {};
    let codeIdCounter = 0;

    const fileLabel = path.basename(document.fileName);
    const fileContainer: HierarchyContainer = {
      id: `code_${codeIdCounter++}`,
      name: fileLabel,
      children: [],
    };

    const functionMap = new Map<string, HierarchyContainer>();
    const variableMap = new Map<string, HierarchyContainer>();
    const containerAssignmentCount: Record<string, number> = {};

    const bumpCount = (id: string) => {
      containerAssignmentCount[id] = (containerAssignmentCount[id] || 0) + 1;
    };

    const getFunctionContainer = (fnNameRaw: string): HierarchyContainer => {
      const fnName = `fn ${fnNameRaw}`;
      if (functionMap.has(fnName)) return functionMap.get(fnName)!;
      const fnContainer: HierarchyContainer = {
        id: `code_${codeIdCounter++}`,
        name: fnName,
        children: [],
      };
      functionMap.set(fnName, fnContainer);
      return fnContainer;
    };

    const getVariableContainer = (
      fnContainer: HierarchyContainer,
      varName: string
    ): HierarchyContainer => {
      const key = `${fnContainer.id}:${varName}`;
      if (variableMap.has(key)) return variableMap.get(key)!;
      const varContainer: HierarchyContainer = {
        id: `code_${codeIdCounter++}`,
        name: varName,
        children: [],
      };
      variableMap.set(key, varContainer);
      return varContainer;
    };

    // Build mapping from tree-sitter positions to node IDs
    const nodeByPos = new Map<string, Node>();
    for (const n of nodes) {
      const pos = n.data.treeSitterPosition;
      if (pos) nodeByPos.set(`${pos.line}:${pos.column}:${n.shortLabel}`, n);
    }

    // Variable chains → assign operator nodes into variable containers
    const varChains = this.treeSitterParser.parseVariableBindings(document);
    for (const binding of varChains) {
      const fnName =
        this.treeSitterParser.findEnclosingFunctionName(document, binding.line) || '(top-level)';
      const fnContainer = getFunctionContainer(fnName);
      const varContainer = getVariableContainer(fnContainer, binding.varName);

      for (const op of binding.operators) {
        const node = nodeByPos.get(`${op.line}:${op.column}:${op.name}`);
        if (node) {
          codeAssignments[node.id] = varContainer.id;
          bumpCount(varContainer.id);
        }
      }
    }

    // Standalone chains → assign operator nodes directly to function containers
    const standaloneChains = this.treeSitterParser.parseStandaloneChains(document);
    for (const chain of standaloneChains) {
      if (chain.length === 0) continue;
      const fnName =
        this.treeSitterParser.findEnclosingFunctionName(document, chain[0].line) || '(top-level)';
      const fnContainer = getFunctionContainer(fnName);
      for (const op of chain) {
        const node = nodeByPos.get(`${op.line}:${op.column}:${op.name}`);
        if (node && !(node.id in codeAssignments)) {
          codeAssignments[node.id] = fnContainer.id;
          bumpCount(fnContainer.id);
        }
      }
    }

    // Any remaining nodes → put under file container
    for (const n of nodes) {
      if (!(n.id in codeAssignments)) {
        codeAssignments[n.id] = fileContainer.id;
        bumpCount(fileContainer.id);
      }
    }

    // Finalize hierarchy: add only containers with assignments
    for (const [, fnContainer] of functionMap.entries()) {
      const variableChildren: HierarchyContainer[] = [];
      for (const [key, varContainer] of variableMap.entries()) {
        if (key.startsWith(fnContainer.id + ':')) {
          if ((containerAssignmentCount[varContainer.id] || 0) > 0) {
            variableChildren.push(varContainer);
          }
        }
      }

      const hasFnAssignments = (containerAssignmentCount[fnContainer.id] || 0) > 0;
      const hasVarAssignments = variableChildren.length > 0;
      if (hasFnAssignments || hasVarAssignments) {
        fnContainer.children = variableChildren;
        fileContainer.children.push(fnContainer);
      }
    }

    // Collapse single-child container chains
    const reassignAll = (fromId: string, toId: string) => {
      for (const [nodeId, cid] of Object.entries(codeAssignments)) {
        if (cid === fromId) {
          codeAssignments[nodeId] = toId;
        }
      }
      containerAssignmentCount[toId] =
        (containerAssignmentCount[toId] || 0) + (containerAssignmentCount[fromId] || 0);
      delete containerAssignmentCount[fromId];
    };

    const collapseChains = (container: HierarchyContainer, isTopLevel: boolean) => {
      // First collapse children
      for (const child of container.children) {
        collapseChains(child, false);
      }

      // Then collapse this container if it has exactly one child and no direct assignments
      if (!isTopLevel && container.children.length === 1) {
        const onlyChild = container.children[0];
        const thisCount = containerAssignmentCount[container.id] || 0;
        if (thisCount === 0) {
          reassignAll(onlyChild.id, container.id);
          container.name = `${container.name}→${onlyChild.name}`;
          container.children = onlyChild.children;
        }
      }
    };

    collapseChains(fileContainer, true);

    return { nodeAssignments: codeAssignments, children: [fileContainer] };
  }

  /**
   * Count nested Tick<> wrappers around a location kind string
   */
  private countTickDepth(locationKind: string): number {
    let depth = 0;
    let current = locationKind.trim();
    while (current.startsWith('Tick<') && current.endsWith('>')) {
      depth++;
      current = current.substring(5, current.length - 1).trim();
    }
    return depth;
  }

  /**
   * Build a nested Tick label for a given base label and depth
   */
  private buildTickLabel(baseLabel: string, depth: number): string {
    if (depth <= 0) return baseLabel;
    let label = baseLabel;
    for (let i = 0; i < depth; i++) {
      label = `Tick<${label}>`;
    }
    return label;
  }

  /**
   * Extract location label from locationKind string
   *
   * Examples:
   * - "Process<Leader>" -> "Leader"
   * - "Cluster<Worker>" -> "Worker"
   * - "Tick<Process<Proposer>>" -> "Proposer"
   */
  private extractLocationLabel(locationKind: string | null): string {
    if (!locationKind) {
      return '(unknown location)';
    }

    // Strip Tick wrappers to get the base location
    let unwrapped = locationKind;
    while (unwrapped.startsWith('Tick<') && unwrapped.endsWith('>')) {
      unwrapped = unwrapped.substring(5, unwrapped.length - 1);
    }

    // Try to extract type parameter name from patterns like "Process<Leader>"
    const paramMatch = unwrapped.match(/^(?:Process|Cluster|External)<([^>]+)>/);
    if (paramMatch) {
      const param = paramMatch[1].trim();
      // Handle lifetime parameters (e.g., "'a, Leader" -> "Leader")
      const cleanParam = param.replace(/^'[a-z]+,\s*/, '');
      return cleanParam;
    }

    // If no type parameter found, try to extract just the base type
    const baseMatch = unwrapped.match(/^(Process|Cluster|External)/);
    if (baseMatch) {
      return baseMatch[1];
    }

    // Fallback: return the original locationKind
    return locationKind;
  }
}
