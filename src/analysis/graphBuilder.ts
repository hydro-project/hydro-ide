/**
 * GraphBuilder - Builds operator graphs from tree-sitter analysis
 *
 * This service extracts operator chains from Rust source code using tree-sitter
 * parsing and creates graph nodes/edges. It can optionally enhance nodes with
 * LSP semantic information when available.
 *
 * Key responsibilities:
 * - Parse variable bindings and standalone operator chains
 * - Create graph nodes for operators
 * - Build edges between operators in chains
 * - Detect inter-variable references
 * - Enhance nodes with LSP location/type information
 *
 * Design decisions:
 * - Uses tree-sitter as primary source (reliable structure)
 * - LSP enhancement is optional (best-effort)
 * - Pure graph construction (no hierarchy or semantic tags)
 * - Stateless service (can be reused)
 */

import * as vscode from 'vscode';
import { TreeSitterRustParser, OperatorNode as TreeSitterOperatorNode } from './treeSitterParser';
import { OperatorRegistry } from './operatorRegistry';
import type { LocationInfo } from './locationAnalyzer';
import type { GraphNode, GraphEdge } from '../core/graphTypes';

/**
 * Graph node representing an operator
 */
export type Node = GraphNode;

/**
 * Graph edge connecting two operators
 */
export type Edge = GraphEdge;

/**
 * Result of graph building
 */
export interface GraphBuildResult {
  nodes: Node[];
  edges: Edge[];
}

/**
 * GraphBuilder - Constructs operator graphs from tree-sitter analysis
 *
 * Builds graph structure (nodes and edges) from Rust source code by:
 * 1. Parsing operator chains with tree-sitter
 * 2. Creating nodes for each operator
 * 3. Building edges between operators in chains
 * 4. Optionally enhancing with LSP semantic information
 *
 * Usage:
 * ```typescript
 * const builder = new GraphBuilder(treeSitterParser, operatorRegistry, outputChannel);
 * const { nodes, edges } = builder.buildFromTreeSitter(document, scopeTarget);
 * builder.enhanceWithLSP(nodes, lspLocations, document);
 * ```
 */
export class GraphBuilder {
  private treeSitterParser: TreeSitterRustParser;
  private operatorRegistry: OperatorRegistry;
  private outputChannel: vscode.OutputChannel;

  /**
   * Create a new graph builder
   *
   * @param treeSitterParser Tree-sitter parser for Rust code
   * @param operatorRegistry Operator classification registry
   * @param outputChannel Output channel for logging
   */
  constructor(
    treeSitterParser: TreeSitterRustParser,
    operatorRegistry: OperatorRegistry,
    outputChannel: vscode.OutputChannel
  ) {
    this.treeSitterParser = treeSitterParser;
    this.operatorRegistry = operatorRegistry;
    this.outputChannel = outputChannel;
  }

  /**
   * Build operator graph from tree-sitter analysis
   *
   * Creates nodes and edges from operator chains identified by tree-sitter.
   * Handles:
   * - Variable binding chains (let x = source.map()...)
   * - Standalone chains (reduced.snapshot()...)
   * - Inter-variable references (edges between variables)
   * - Scoped tick variables for temporal operators
   *
   * @param document Document to analyze
   * @param _scopeTarget Scope target (currently unused, for future filtering)
   * @returns Graph with nodes and edges
   */
  public buildFromTreeSitter(
    document: vscode.TextDocument,
    _scopeTarget: unknown
  ): GraphBuildResult {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let nodeIdCounter = 0;
    let edgeIdCounter = 0;

    // Parse variable bindings and standalone chains using tree-sitter
    const variableChains = this.treeSitterParser.parseVariableBindings(document);
    const standaloneChains = this.treeSitterParser.parseStandaloneChains(document);

    this.log(
      `Tree-sitter found ${variableChains.length} variable chains and ${standaloneChains.length} standalone chains`
    );

    // Create a map to track nodes by position to avoid duplicates
    const operatorToNode = new Map<string, Node>();

    // Map from variable names to their last operator node (for creating inter-variable edges)
    const variableToLastNode = new Map<string, Node>();

    // Helper function to create or get node for an operator
    const getOrCreateNode = (op: TreeSitterOperatorNode): Node | null => {
      const key = `${op.line}:${op.column}:${op.name}`;

      if (operatorToNode.has(key)) {
        return operatorToNode.get(key)!;
      }

      // Check if this is a known dataflow operator
      if (!this.operatorRegistry.isKnownDataflowOperator(op.name)) {
        this.log(`Skipping unknown operator: ${op.name}`);
        return null;
      }

      // Create new node
      const nodeId = String(nodeIdCounter++);
      const nodeType = this.operatorRegistry.inferNodeType(op.name);

      // Extract context for full label
      const lineText = document.lineAt(op.line).text;
      const contextStart = Math.max(0, op.column - 10);
      const contextEnd = Math.min(lineText.length, op.column + op.name.length + 10);
      const fullLabel = lineText.substring(contextStart, contextEnd).trim();

      // Scope tick variable by enclosing function to prevent collisions across scopes
      let scopedTickVariable: string | undefined = undefined;
      if (op.tickVariable) {
        const fnName =
          this.treeSitterParser.findEnclosingFunctionName(document, op.line) || '(top-level)';
        scopedTickVariable = `${fnName}::${op.tickVariable}`;
      }

      const node: Node = {
        id: nodeId,
        nodeType,
        shortLabel: op.name,
        fullLabel: fullLabel || op.name,
        label: op.name,
        data: {
          locationId: null, // Will be enhanced by LSP if available
          locationType: null,
          locationKind: undefined,
          tickVariable: scopedTickVariable, // Track scoped tick variable for temporal operators
          backtrace: [],
          // Store tree-sitter position for LSP enhancement
          treeSitterPosition: {
            line: op.line,
            column: op.column,
          },
        },
      };

      operatorToNode.set(key, node);
      nodes.push(node);

      this.log(`Created node for ${op.name} at line ${op.line}`);
      return node;
    };

    // Process variable binding chains
    for (const binding of variableChains) {
      this.log(
        `Processing variable chain '${binding.varName}' with ${binding.operators.length} operators`
      );

      // Create nodes for all valid operators first
      const validNodes: { node: Node; index: number }[] = [];
      for (let i = 0; i < binding.operators.length; i++) {
        const node = getOrCreateNode(binding.operators[i]);
        if (node) {
          validNodes.push({ node, index: i });
        }
      }

      // If this variable chain starts from a previously-defined variable reference
      // (e.g., `let reduced = batches\n  .into_keyed()...`), create an inter-variable edge
      if (binding.operators.length > 0 && validNodes.length > 0 && variableToLastNode.size > 0) {
        const firstOpLine = binding.operators[0].line;
        const variableNames = Array.from(variableToLastNode.keys());
        const referencedVar = this.detectVariableReference(document, firstOpLine, variableNames);
        if (referencedVar) {
          const lastNode = variableToLastNode.get(referencedVar);
          if (lastNode) {
            edges.push({
              id: String(edgeIdCounter++),
              source: lastNode.id,
              target: validNodes[0].node.id,
              semanticTags: [],
            });
            this.log(
              `Created inter-variable edge: ${lastNode.shortLabel} -> ${validNodes[0].node.shortLabel} (via variable '${referencedVar}')`
            );
          }
        }
      }

      // Create edges between consecutive valid nodes (bridging over skipped operators)
      for (let i = 0; i < validNodes.length - 1; i++) {
        const sourceNode = validNodes[i].node;
        const targetNode = validNodes[i + 1].node;

        edges.push({
          id: String(edgeIdCounter++),
          source: sourceNode.id,
          target: targetNode.id,
          semanticTags: [], // Empty semantic tags for tree-sitter edges
        });
        this.log(`Created edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel}`);
      }

      // Track the last node in this variable's chain for inter-variable edges
      if (validNodes.length > 0) {
        const lastNode = validNodes[validNodes.length - 1].node;
        variableToLastNode.set(binding.varName, lastNode);
        this.log(
          `Tracked last operator '${lastNode.shortLabel}' for variable '${binding.varName}'`
        );
      }
    }

    // Process standalone chains
    for (const chain of standaloneChains) {
      this.log(`Processing standalone chain with ${chain.length} operators`);

      // Create nodes for all valid operators first
      const validNodes: Node[] = [];
      for (const op of chain) {
        const node = getOrCreateNode(op);
        if (node) {
          validNodes.push(node);
        }
      }

      // Create edges between consecutive valid nodes (bridging over skipped operators)
      for (let i = 0; i < validNodes.length - 1; i++) {
        const sourceNode = validNodes[i];
        const targetNode = validNodes[i + 1];

        edges.push({
          id: String(edgeIdCounter++),
          source: sourceNode.id,
          target: targetNode.id,
          semanticTags: [], // Empty semantic tags for tree-sitter edges
        });
        this.log(`Created edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel}`);
      }

      // Check if this standalone chain starts with a variable reference
      // Example: reduced.snapshot(...) where 'reduced' was assigned earlier
      if (chain.length > 0 && validNodes.length > 0) {
        const firstOp = chain[0];
        const variableNames = Array.from(variableToLastNode.keys());
        const referencedVar = this.detectVariableReference(document, firstOp.line, variableNames);

        if (referencedVar) {
          const lastNode = variableToLastNode.get(referencedVar);
          if (lastNode) {
            // Create edge from the variable's last operator to this chain's first operator
            edges.push({
              id: String(edgeIdCounter++),
              source: lastNode.id,
              target: validNodes[0].id,
              semanticTags: [], // Empty semantic tags for tree-sitter edges
            });
            this.log(
              `Created inter-variable edge: ${lastNode.shortLabel} -> ${validNodes[0].shortLabel} (via variable '${referencedVar}')`
            );
          }
        }
      }
    }

    this.log(`Built ${nodes.length} nodes and ${edges.length} edges from tree-sitter`);
    return { nodes, edges };
  }

  /**
   * Detect variable reference on a line
   *
   * Checks if a line starts with or references one of the known variables.
   * Handles patterns like:
   * - `varname.operator()`
   * - `.operator()` where previous line is `varname`
   *
   * @param document Document being analyzed
   * @param line Line number to check
   * @param variableNames Known variable names
   * @returns Variable name if referenced, null otherwise
   */
  public detectVariableReference(
    document: vscode.TextDocument,
    line: number,
    variableNames: string[]
  ): string | null {
    if (line < 0 || line >= document.lineCount) {
      return null;
    }

    const lineText = document.lineAt(line).text.trim();

    // Check each known variable to see if this line starts with it
    for (const varName of variableNames) {
      // Pattern: varname.operator(...) at start of line (possibly with leading whitespace)
      if (lineText.startsWith(varName + '.') || lineText.match(new RegExp(`^${varName}\\s*\\.`))) {
        return varName;
      }
    }

    // If not found on current line and this looks like a dot-chain continuation,
    // check if previous line ends with a variable name
    if (lineText.startsWith('.') && line > 0) {
      const prevLineText = document.lineAt(line - 1).text.trim();

      for (const varName of variableNames) {
        // Check if previous line is just the variable name or ends with variable name
        if (
          prevLineText === varName ||
          prevLineText.endsWith(` ${varName}`) ||
          prevLineText.endsWith(`=${varName}`)
        ) {
          return varName;
        }
      }
    }

    return null;
  }

  /**
   * Enhance tree-sitter nodes with LSP semantic information
   *
   * This is a best-effort enhancement that adds location hierarchy and type information
   * when available from LSP, without breaking the core tree-sitter structure.
   *
   * Matches nodes to LSP locations by:
   * - Operator name (must match)
   * - Position (closest match within tolerance)
   *
   * Enhanced information:
   * - locationId: Numeric location ID
   * - locationType: Location type (Process, Cluster, etc.)
   * - locationKind: Full location kind string
   * - fullLabel: Better context from LSP if available
   *
   * @param nodes Nodes created from tree-sitter
   * @param locations LSP location information
   * @param document The document being analyzed
   */
  public enhanceWithLSP(
    nodes: Node[],
    locations: LocationInfo[],
    document: vscode.TextDocument
  ): void {
    this.log(
      `Enhancing ${nodes.length} nodes with LSP information from ${locations.length} locations`
    );

    let enhancedCount = 0;

    for (const node of nodes) {
      const treeSitterPos = node.data.treeSitterPosition;
      if (!treeSitterPos) continue;

      // Try to find matching LSP location information
      let bestMatch: LocationInfo | null = null;
      let bestDistance = Infinity;

      for (const location of locations) {
        if (location.operatorName !== node.shortLabel) continue;

        const lspLine = location.range.start.line;
        const lspColumn = location.range.start.character;

        // Calculate distance between tree-sitter and LSP positions
        const lineDistance = Math.abs(treeSitterPos.line - lspLine);
        const columnDistance = Math.abs(treeSitterPos.column - lspColumn);
        const totalDistance = lineDistance * 100 + columnDistance; // Weight lines more heavily

        if (totalDistance < bestDistance) {
          bestDistance = totalDistance;
          bestMatch = location;
        }
      }

      // If we found a reasonable match, enhance the node
      if (bestMatch && bestDistance < 300) {
        // Allow some tolerance
        node.data.locationId = this.getLocationId(bestMatch.locationKind);
        node.data.locationType = this.operatorRegistry.getLocationType(bestMatch.locationKind);
        node.data.locationKind = bestMatch.locationKind || undefined;

        // Update full label with LSP context if available
        try {
          const lspFullLabel = this.extractFullLabel(document, bestMatch.range);
          if (lspFullLabel && lspFullLabel.length > node.fullLabel.length) {
            node.fullLabel = lspFullLabel;
          }
        } catch (error) {
          // Keep existing full label if LSP extraction fails
        }

        enhancedCount++;
        this.log(`Enhanced node ${node.shortLabel} with LSP info (distance: ${bestDistance})`);
      } else {
        this.log(`No LSP enhancement for ${node.shortLabel} (best distance: ${bestDistance})`);
      }
    }

    this.log(`Enhanced ${enhancedCount} of ${nodes.length} nodes with LSP information`);
  }

  /**
   * Extract full label from operator code context
   *
   * Reads the source code text from the operator range and extracts
   * the operator call with parameters (e.g., "map(|x| x + 1)").
   * Truncates long expressions for readability.
   *
   * @param document Document being analyzed
   * @param range Range of the operator
   * @returns Full label string
   */
  private extractFullLabel(document: vscode.TextDocument, range: vscode.Range): string {
    try {
      const text = document.getText(range);
      // Truncate very long labels
      const maxLength = 100;
      if (text.length > maxLength) {
        return text.substring(0, maxLength) + '...';
      }
      return text;
    } catch (error) {
      return '';
    }
  }

  /**
   * Get location ID from location kind string
   *
   * Generates a numeric ID by hashing the location kind.
   * Same location kinds get the same ID for hierarchy grouping.
   *
   * @param locationKind Location kind string
   * @returns Numeric location ID or null
   */
  private getLocationId(locationKind: string | null): number | null {
    if (!locationKind) {
      return null;
    }

    // Simple hash function for location kind
    let hash = 0;
    for (let i = 0; i < locationKind.length; i++) {
      const char = locationKind.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Log message to output channel
   *
   * @param message Message to log
   */
  private log(message: string): void {
    this.outputChannel.appendLine(`[GraphBuilder] ${message}`);
  }
}
