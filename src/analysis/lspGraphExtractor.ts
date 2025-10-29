/**
 * LSP Graph Extractor
 *
 * Extracts Hydroscope JSON visualizations directly from rust-analyzer's LSP
 * without requiring Cargo compilation. Provides instant visualization feedback
 * during development.
 */

import * as vscode from 'vscode';
import * as locationAnalyzer from './locationAnalyzer';
import { ScopeTarget } from '../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TreeSitterRustParser, OperatorNode as TreeSitterOperatorNode } from './treeSitterParser';

// Import LocationInfo type for internal use
import type { LocationInfo } from './locationAnalyzer';

/**
 * Hydroscope JSON format interfaces
 */

export interface Node {
  id: string;
  nodeType: NodeType;
  shortLabel: string;
  fullLabel: string;
  label: string;
  data: {
    locationId: number | null;
    locationType: string | null;
    locationKind?: string; // Original location kind (e.g., "Process<Leader>")
    tickVariable?: string; // Tick variable name for temporal operators (e.g., "ticker")
    backtrace: [];
    treeSitterPosition?: {
      line: number;
      column: number;
    };
  };
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  semanticTags: string[];
  label?: string;
}

export interface HierarchyContainer {
  id: string;
  name: string;
  children: HierarchyContainer[];
}

export interface Hierarchy {
  id: string;
  name: string;
  children: HierarchyContainer[];
}

export interface HydroscopeJson {
  nodes: Node[];
  edges: Edge[];
  hierarchyChoices: Hierarchy[];
  nodeAssignments: Record<string, Record<string, string>>;
  selectedHierarchy?: string;
  edgeStyleConfig: EdgeStyleConfig;
  nodeTypeConfig: NodeTypeConfig;
  legend: Legend;
}

export type NodeType = 'Source' | 'Transform' | 'Sink' | 'Join' | 'Network' | 'Tee' | 'Aggregation';

export interface EdgeStyleConfig {
  [key: string]: unknown;
}

export interface NodeTypeConfig {
  [key: string]: unknown;
}

export interface Legend {
  [key: string]: unknown;
}

/**
 * Cache entry for storing extracted graphs
 */
interface CachedGraph {
  /** The extracted Hydroscope JSON */
  json: HydroscopeJson;
  /** Document version when extraction was performed */
  version: number;
  /** Timestamp when the entry was created */
  timestamp: number;
}

/**
 * Internal tracking structure for operator information
 */
interface OperatorInfo {
  /** Operator name (e.g., "map", "filter") */
  name: string;
  /** Source code range */
  range: vscode.Range;
  /** Return type from rust-analyzer (if available) */
  returnType: string | null;
  /** Location type information */
  locationInfo: LocationInfo;
  /** Assigned node ID */
  nodeId: string;
}

/**
 * Internal tracking structure for operator chains
 */
interface OperatorChain {
  /** Sequence of operators in chain */
  operators: OperatorInfo[];
}

/**
 * Variable binding tracking structure
 *
 * Tracks which operators produce which variables through let bindings.
 * For example: `let words = source.map()` creates a binding from "words"
 * to the last operator in the chain (map).
 */
interface VariableBinding {
  /** Variable name (e.g., "words", "partitioned_words") */
  varName: string;
  /** The last operator in the chain that produces this variable */
  producingOperator: OperatorInfo;
  /** Line number where the binding occurs */
  line: number;
}

/**
 * Operator usage tracking structure
 *
 * Tracks which variable an operator is called on.
 * For example: `words.map()` creates a usage where map consumes "words".
 */
interface OperatorUsage {
  /** The operator being called */
  operator: OperatorInfo;
  /** The variable it's called on (if any) */
  consumedVariable: string | null;
  /** Line number where the usage occurs */
  line: number;
}

/**
 * Hierarchy data structure combining hierarchy choices and node assignments
 */
interface HierarchyData {
  /** Available hierarchy choices */
  hierarchyChoices: Hierarchy[];
  /** Mapping from hierarchy ID to node assignments */
  nodeAssignments: Record<string, Record<string, string>>;
  /** Selected hierarchy ID */
  selectedHierarchy: string;
}

/**
 * LSP Graph Extractor Class
 *
 * Extracts Hydroscope JSON from Rust source code using LSP queries.
 * Implements caching with LRU eviction to optimize performance.
 */
export class LSPGraphExtractor {
  private outputChannel: vscode.OutputChannel;
  private cache: Map<string, CachedGraph>;
  private lruOrder: string[];
  private cacheHits: number;
  private cacheMisses: number;
  private treeSitterParser: TreeSitterRustParser;

  /**
   * Create a new LSP Graph Extractor
   *
   * @param outputChannel Output channel for logging
   */
  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.cache = new Map();
    this.lruOrder = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.treeSitterParser = new TreeSitterRustParser(outputChannel);

    // Initialize the locationAnalyzer module with the output channel
    locationAnalyzer.initialize(outputChannel);

    this.log('LSPGraphExtractor initialized with tree-sitter parser');
  }

  /**
   * Log message to output channel
   */
  private log(message: string): void {
    this.outputChannel.appendLine(`[LSPGraphExtractor] ${message}`);
  }

  /**
   * Save generated JSON to disk for debugging
   *
   * Writes the Hydroscope JSON to a debug file in the workspace root
   * for inspection and troubleshooting.
   *
   * @param json The generated Hydroscope JSON
   * @param document The source document
   * @param scopeTarget The scope target
   */
  private async saveDebugJson(
    json: HydroscopeJson,
    document: vscode.TextDocument,
    scopeTarget: ScopeTarget
  ): Promise<void> {
    try {
      // Get workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.log('No workspace folder found, skipping debug JSON save');
        return;
      }

      // Create debug directory if it doesn't exist
      const debugDir = path.join(workspaceFolder.uri.fsPath, '.hydro-debug');
      try {
        await fs.mkdir(debugDir, { recursive: true });
      } catch (error) {
        // Directory might already exist, ignore
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const basename = path.basename(document.fileName, '.rs');
      const filename = `lsp-graph-${basename}-${scopeTarget.type}-${timestamp}.json`;
      const filepath = path.join(debugDir, filename);

      // Write JSON with pretty formatting
      await fs.writeFile(filepath, JSON.stringify(json, null, 2), 'utf8');

      this.log(`Debug JSON saved to: ${filepath}`);
      this.outputChannel.appendLine(`[LSPGraphExtractor] 📝 Debug JSON: ${filepath}`);

      // Show notification with option to open file
      vscode.window
        .showInformationMessage(`Debug JSON saved to .hydro-debug/${filename}`, 'Open File')
        .then((selection) => {
          if (selection === 'Open File') {
            vscode.workspace.openTextDocument(filepath).then((doc) => {
              vscode.window.showTextDocument(doc);
            });
          }
        });
    } catch (error) {
      this.log(`Failed to save debug JSON: ${error}`);
    }
  }

  /**
   * Generate cache key for a document and scope target
   *
   * Cache keys are composed of:
   * - Document URI (identifies the file)
   * - Document version (invalidates on edit)
   * - Scope type (function/file/workspace)
   * - Active file path (for function/file scope)
   *
   * @param document The document being analyzed
   * @param scopeTarget The scope target for visualization
   * @returns Cache key string
   */
  private getCacheKey(document: vscode.TextDocument, scopeTarget: ScopeTarget): string {
    const parts = [document.uri.toString(), `v${document.version}`, scopeTarget.type];

    if (scopeTarget.activeFilePath) {
      parts.push(scopeTarget.activeFilePath);
    }

    return parts.join('::');
  }

  /**
   * Retrieve cached graph extraction results
   *
   * Implements LRU cache access:
   * - On cache hit: Updates LRU order and returns cached JSON
   * - On cache miss: Returns null (caller will perform extraction)
   *
   * @param cacheKey The cache key to lookup
   * @returns Cached graph if found, null otherwise
   */
  private getCached(cacheKey: string): HydroscopeJson | null {
    const entry = this.cache.get(cacheKey);
    if (entry) {
      // Cache hit - update LRU order
      const idx = this.lruOrder.indexOf(cacheKey);
      if (idx >= 0) {
        this.lruOrder.splice(idx, 1);
      }
      this.lruOrder.push(cacheKey);

      this.cacheHits++;
      this.log(`Cache hit for key: ${cacheKey}`);
      return entry.json;
    }

    // Cache miss
    this.cacheMisses++;
    this.log(`Cache miss for key: ${cacheKey}`);
    return null;
  }

  /**
   * Store graph extraction results in cache with LRU eviction
   *
   * Implements LRU eviction algorithm:
   * - Reads cache size limit from configuration (default: 50)
   * - Evicts least recently used entries when at capacity
   * - Updates LRU order array
   *
   * @param cacheKey The cache key to store under
   * @param json The extracted Hydroscope JSON
   */
  private setCached(cacheKey: string, json: HydroscopeJson): void {
    // Read cache size limit from configuration
    const config = vscode.workspace.getConfiguration('hydro-ide');
    const maxSize = config.get<number>('lsp.cacheSize', 50);

    // LRU eviction: Remove oldest entries if at capacity
    while (this.cache.size >= maxSize && this.lruOrder.length > 0) {
      const oldest = this.lruOrder.shift()!;
      this.cache.delete(oldest);
      this.log(`Evicted cache entry: ${oldest} (LRU)`);
    }

    // Store new entry
    this.cache.set(cacheKey, {
      json,
      version: 0, // Version is encoded in cache key
      timestamp: Date.now(),
    });

    // Update LRU order
    const idx = this.lruOrder.indexOf(cacheKey);
    if (idx >= 0) {
      this.lruOrder.splice(idx, 1);
    }
    this.lruOrder.push(cacheKey);

    this.log(`Cached graph extraction: ${cacheKey}`);
  }

  /**
   * Clear cache entries
   *
   * @param cacheKey Optional specific cache key to clear. If not provided, clears entire cache
   */
  public clearCache(cacheKey?: string): void {
    if (cacheKey) {
      // Selective clear
      this.cache.delete(cacheKey);
      const idx = this.lruOrder.indexOf(cacheKey);
      if (idx >= 0) {
        this.lruOrder.splice(idx, 1);
      }
      this.log(`Cleared cache for: ${cacheKey}`);
    } else {
      // Complete clear
      this.cache.clear();
      this.lruOrder.length = 0;
      this.cacheHits = 0;
      this.cacheMisses = 0;
      this.log('Cleared entire cache');
    }
  }

  /**
   * Get cache statistics for monitoring and debugging
   *
   * @returns Object containing cache statistics
   */
  public getCacheStats() {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    return {
      numEntries: this.cache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: hitRate,
      hitRatePercent: (hitRate * 100).toFixed(1),
    };
  }

  /**
   * Extract Hydroscope JSON from document
   *
   * Main entry point for LSP-based extraction.
   * This is a placeholder implementation that will be completed in subsequent tasks.
   *
   * @param document The document to analyze
   * @param scopeTarget The scope target for visualization
   * @returns Promise resolving to Hydroscope JSON
   */
  public async extractGraph(
    document: vscode.TextDocument,
    scopeTarget: ScopeTarget
  ): Promise<HydroscopeJson> {
    this.log('=== Hybrid LSP + Tree-sitter Graph Extraction Started ===');
    this.log(`Extracting graph for ${document.fileName} (scope: ${scopeTarget.type})`);

    // Check cache first
    const cacheKey = this.getCacheKey(document, scopeTarget);
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Step 1: Build reliable structure from tree-sitter
      this.log('Step 1: Building graph structure from tree-sitter...');
      const { nodes, edges } = this.buildOperatorChainsFromTreeSitter(document, scopeTarget);
      this.log(`Tree-sitter created ${nodes.length} nodes and ${edges.length} edges`);

      // Step 2: Get LSP location information for semantic enhancement
      this.log('Step 2: Getting LSP location information for enhancement...');
      const locations = await locationAnalyzer.analyzeDocument(document);
      this.log(`LSP found ${locations.length} locations`);

      if (locations.length === 0) {
        this.log(
          `WARNING: LocationAnalyzer returned 0 locations. This suggests rust-analyzer LSP is not providing semantic tokens.`
        );
      }

      // Step 3: Enhance tree-sitter nodes with LSP semantic information (best-effort)
      this.log('Step 3: Enhancing nodes with LSP semantic information...');
      this.enhanceNodesWithLSPInfo(nodes, locations, document);

      // Step 4: Build hierarchies (Location + Code) from enhanced nodes
      const hierarchyData = this.buildLocationAndCodeHierarchies(document, nodes, edges);

      // Step 5: Assemble final JSON
      const json = this.assembleHydroscopeJson(nodes, edges, hierarchyData);

      // Debug: Save JSON to disk for inspection
      await this.saveDebugJson(json, document, scopeTarget);

      // Cache result
      this.setCached(cacheKey, json);

      this.log('=== Hybrid Graph Extraction Completed ===');
      this.log(`Final result: ${nodes.length} nodes, ${edges.length} edges`);

      return json;
    } catch (error) {
      this.log(`Error in hybrid graph extraction: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a line starts with a variable reference
   *
   * Detects patterns like:
   * - `varname.operator(...)`
   * - `varname .operator(...)` (with whitespace)
   *
   * Also handles multi-line chains where the variable is on the previous line:
   * ```
   * let x = varname
   *     .operator()
   * ```
   *
   * @param document The document being analyzed
   * @param line The line number to check
   * @param variableNames Array of variable names to check for
   * @returns The variable name if found, null otherwise
   */
  private detectVariableReference(
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
   * Build operator chains from tree-sitter analysis
   *
   * Creates edges between operators based on variable bindings and method chains.
   * Uses tree-sitter as the primary source for reliable dataflow structure.
   *
   * @param document The document being analyzed
   * @param scopeTarget The scope target for filtering
   * @returns Object containing both nodes and edges from tree-sitter analysis
   */
  private buildOperatorChainsFromTreeSitter(
    document: vscode.TextDocument,
    _scopeTarget: ScopeTarget
  ): { nodes: Node[]; edges: Edge[] } {
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
      if (!this.isKnownDataflowOperator(op.name)) {
        this.log(`Skipping unknown operator: ${op.name}`);
        return null;
      }

      // Create new node
      const nodeId = String(nodeIdCounter++);
      const nodeType = this.inferNodeType(op.name);

      // Extract context for full label
      const lineText = document.lineAt(op.line).text;
      const contextStart = Math.max(0, op.column - 10);
      const contextEnd = Math.min(lineText.length, op.column + op.name.length + 10);
      const fullLabel = lineText.substring(contextStart, contextEnd).trim();

      // Scope tick variable by enclosing function to prevent collisions across scopes
      let scopedTickVariable: string | undefined = undefined;
      if (op.tickVariable) {
        const fnName = this.treeSitterParser.findEnclosingFunctionName(document, op.line) || '(top-level)';
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
   * Enhance tree-sitter nodes with LSP semantic information
   *
   * This is a best-effort enhancement that adds location hierarchy and type information
   * when available from LSP, without breaking the core tree-sitter structure.
   *
   * @param nodes Nodes created from tree-sitter
   * @param locations LSP location information
   * @param document The document being analyzed
   */
  private enhanceNodesWithLSPInfo(
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
        node.data.locationType = this.getLocationType(bestMatch.locationKind);
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

    // Assign default locations to nodes that didn't get LSP enhancement
    this.assignDefaultLocations(nodes);
  }

  /**
   * Assign default locations to nodes that don't have LSP location information
   *
   * REMOVED: This function previously assigned fake location names like "Leader" and "Worker"
   * which don't exist in user code. Nodes without location information now get assigned to
   * an "(unknown location)" container during hierarchy building instead.
   *
   * @param _nodes Array of nodes to process (currently unused)
   */
  private assignDefaultLocations(_nodes: Node[]): void {
    // No longer assign fake location names
    // Nodes without location info will be handled by hierarchy building
    this.log(`Skipping default location assignment - nodes without locations will be grouped as "(unknown location)"`);
  }

  /**
   * Extract nodes from Hydro operators using hybrid LSP + tree-sitter approach
   *
   * Creates nodes from both LSP location information (when available) and
   * tree-sitter operator calls (when LSP info is missing). This ensures we
   * capture all operators in the dataflow graph.
   *
   * @param document The document being analyzed
   * @param locations Location information from LocationAnalyzer
   * @param scopeTarget The scope target for filtering
   * @returns Promise resolving to array of nodes
   */

  /*
  // REMAINING OLD METHOD CODE - COMMENTED OUT
    // Create nodes from LSP locations first (these have rich type information)
    const lspNodeIds = new Set<string>();
    
    for (const location of scopedLocations) {
      const returnType = location.fullReturnType || location.locationType;
      
      // Check if this is a valid dataflow operator
      if (!this.isValidDataflowOperator(location.operatorName, returnType)) {
        this.log(
          `Filtered out ${location.operatorName} - not a dataflow operator (return type: ${returnType || 'unknown'})`
        );
        continue;
      }

      this.log(`Accepted '${location.operatorName}' as valid dataflow operator (return type: ${returnType || 'unknown'})`);

      const nodeId = String(nodeIdCounter++);
      const nodeType = this.inferNodeType(location.operatorName);
      const fullLabel = this.extractFullLabel(document, location.range);
      
      nodes.push({
        id: nodeId,
        nodeType,
        shortLabel: location.operatorName,
        fullLabel,
        label: location.operatorName,
        data: {
          locationId: this.getLocationId(location.locationKind),
          locationType: this.getLocationType(location.locationKind),
          locationKind: location.locationKind || undefined,
          backtrace: [],
        },
      });

      // Track this operator so we don't duplicate it from tree-sitter
      const opKey = `${location.range.start.line}:${location.range.start.character}:${location.operatorName}`;
      lspNodeIds.add(opKey);
    }

    this.log(`Created ${nodes.length} nodes from LSP locations`);

    // Create additional nodes from tree-sitter operators that weren't covered by LSP
    let syntheticNodeCount = 0;
    
    for (const tsOp of allTreeSitterOps) {
      // Skip if we already have this operator from LSP
      const opKey = `${tsOp.line}:${tsOp.column}:${tsOp.name}`;
      if (lspNodeIds.has(opKey)) {
        continue;
      }

      // Check if this is a known dataflow operator
      if (!this.isKnownDataflowOperator(tsOp.name)) {
        continue;
      }

      this.log(`Creating synthetic node for tree-sitter operator: ${tsOp.name} at line ${tsOp.line}`);

      const nodeId = String(nodeIdCounter++);
      const nodeType = this.inferNodeType(tsOp.name);
      
      // Create synthetic full label
      const lineText = document.lineAt(tsOp.line).text;
      const operatorStart = tsOp.column;
      const operatorEnd = Math.min(operatorStart + tsOp.name.length, lineText.length);
      const fullLabel = lineText.substring(operatorStart, Math.min(operatorEnd + 20, lineText.length)).trim();
      
      nodes.push({
        id: nodeId,
        nodeType,
        shortLabel: tsOp.name,
        fullLabel: fullLabel || tsOp.name,
        label: tsOp.name,
        data: {
          locationId: null, // No location info from tree-sitter
          locationType: null,
          locationKind: undefined,
          backtrace: [],
        },
      });

      syntheticNodeCount++;
    }

    this.log(`Created ${syntheticNodeCount} synthetic nodes from tree-sitter operators`);
    this.log(`Total nodes: ${nodes.length} (${nodes.length - syntheticNodeCount} from LSP, ${syntheticNodeCount} synthetic)`);

    return nodes;
  }
  */

  /**
   * Extract edges by analyzing dataflow chains
   *
   * Tracks method call chains to infer connections between operators.
   * Creates Edge objects with semantic tags inferred from type information.
   *
   * @param document The document being analyzed
   * @param nodes Previously extracted nodes
   * @param locations Location information from LocationAnalyzer
   * @returns Promise resolving to array of edges
   */
  // OLD METHOD - REPLACED BY HYBRID APPROACH
  /*
  // OLD METHOD - REPLACED BY HYBRID APPROACH  
  // @ts-expect-error - Keeping for reference, will be removed later
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _extractEdges(
    document: vscode.TextDocument,
    nodes: Node[],
    locations: LocationInfo[]
  ): Promise<Edge[]> {
    const edges: Edge[] = [];
    let edgeIdCounter = 0;

    // Build operator chains by analyzing code structure
    const chains = await this.buildOperatorChains(document, locations, nodes);
    this.log(`Built ${chains.length} operator chains`);

    // Create edges from operator chains
    for (const chain of chains) {
      for (let i = 0; i < chain.operators.length - 1; i++) {
        const source = chain.operators[i];
        const target = chain.operators[i + 1];

        // Extract semantic tags from return type
        const semanticTags = this.extractSemanticTags(
          source.returnType,
          source.locationInfo,
          target.locationInfo
        );

        edges.push({
          id: `e${edgeIdCounter++}`,
          source: source.nodeId,
          target: target.nodeId,
          semanticTags,
        });
      }
    }

    return edges;
  }
  */

  /**
   * Track operator usages to identify which variables they consume
   *
   * Scans for patterns like `varname.operator()` to detect variable consumption.
   * Tracks both direct variable usage and chained usage.
   *
   * @param document The document being analyzed
   * @param locations Location information from LocationAnalyzer
   * @param locationToNode Map from location key to node
   * @param variableBindings Map of known variable bindings
   * @returns Array of operator usages
   */
  private trackOperatorUsages(
    document: vscode.TextDocument,
    locations: LocationInfo[],
    locationToNode: Map<string, Node>,
    variableBindings: Map<string, VariableBinding>
  ): OperatorUsage[] {
    const usages: OperatorUsage[] = [];
    const varNames = Array.from(variableBindings.keys());

    // Get all operators that are part of main chains (not arguments) using tree-sitter
    const allVariableChains = this.treeSitterParser.parseVariableBindings(document);
    const allStandaloneChains = this.treeSitterParser.parseStandaloneChains(document);

    // Create a set of main chain operators (line:column -> operator name)
    const mainChainOperators = new Set<string>();

    // Add operators from variable assignments
    for (const binding of allVariableChains) {
      for (const op of binding.operators) {
        mainChainOperators.add(`${op.line}:${op.column}:${op.name}`);
      }
    }

    // Add operators from standalone chains
    for (const chain of allStandaloneChains) {
      for (const op of chain) {
        mainChainOperators.add(`${op.line}:${op.column}:${op.name}`);
      }
    }

    for (const loc of locations) {
      const key = `${loc.range.start.line}:${loc.range.start.character}`;
      const node = locationToNode.get(key);

      if (!node) {
        continue;
      }

      const returnType = loc.fullReturnType || null;

      const operatorInfo: OperatorInfo = {
        name: loc.operatorName,
        range: loc.range,
        returnType,
        locationInfo: loc,
        nodeId: node.id,
      };

      // Check if this operator is part of a main chain (not an argument)
      const operatorKey = `${loc.range.start.line}:${loc.range.start.character}:${loc.operatorName}`;
      const isMainChainOperator = mainChainOperators.has(operatorKey);

      // Only track variable consumption for main chain operators
      let consumedVariable: string | null = null;

      if (isMainChainOperator) {
        // Use the shared helper to detect variable references
        consumedVariable = this.detectVariableReference(document, loc.range.start.line, varNames);
      }

      usages.push({
        operator: operatorInfo,
        consumedVariable,
        line: loc.range.start.line,
      });

      if (consumedVariable) {
        this.log(
          `Operator '${loc.operatorName}' consumes variable '${consumedVariable}' (line ${loc.range.start.line})`
        );
      }
    }

    this.log(
      `Tracked ${usages.length} operator usages (${usages.filter((u) => u.consumedVariable).length} with variable consumption)`
    );
    return usages;
  }

  /**
   * Find all operators in a multi-line chain starting from a given line using tree-sitter
   *
   * Uses tree-sitter AST parsing to accurately identify operator chains,
   * replacing the regex-based approach.
   *
   * @param document The document being analyzed
   * @param startLine The line to start searching from
   * @param locationsByLine Map of line numbers to locations on that line
   * @param locationToNode Map from location key to node
   * @returns Array of operators in the chain
   */
  private findOperatorsInChain(
    document: vscode.TextDocument,
    startLine: number,
    locationsByLine: Map<number, LocationInfo[]>,
    locationToNode: Map<string, Node>
  ): OperatorInfo[] {
    this.log(`[findOperatorsInChain] Starting at line ${startLine} (tree-sitter)`);

    // Use tree-sitter to extract the chain
    const tsOperators = this.treeSitterParser.extractChainFromLine(document, startLine);

    this.log(`[findOperatorsInChain] Tree-sitter found ${tsOperators.length} operators`);

    // Convert tree-sitter operators to our internal OperatorInfo format
    const chainOperators: OperatorInfo[] = [];

    for (const tsOp of tsOperators) {
      const operatorInfo = this.findOperatorInfo(
        tsOp,
        Array.from(locationsByLine.values()).flat(),
        locationToNode
      );

      if (operatorInfo) {
        chainOperators.push(operatorInfo);
        this.log(`[findOperatorsInChain]   Included: ${operatorInfo.name}`);
      } else {
        this.log(
          `[findOperatorsInChain]   WARNING: Could not find operator info for ${tsOp.name} at line ${tsOp.line}`
        );
      }
    }

    this.log(
      `[findOperatorsInChain] Found ${chainOperators.length} operators: ${chainOperators.map((o) => o.name).join(' -> ')}`
    );
    return chainOperators;
  }

  /**
   * Find OperatorInfo for a tree-sitter operator node
   *
   * Matches tree-sitter operator positions with LocationInfo from LSP
   *
   * @param tsOp Tree-sitter operator node
   * @param locations All location information
   * @param locationToNode Map from location key to node
   * @returns OperatorInfo if found, null otherwise
   */
  private findOperatorInfo(
    tsOp: TreeSitterOperatorNode,
    locations: LocationInfo[],
    locationToNode: Map<string, Node>
  ): OperatorInfo | null {
    // Find the LocationInfo that matches this tree-sitter operator
    // Use flexible matching: same line and operator name, with coordinate tolerance
    const candidates = locations.filter(
      (loc) => loc.range.start.line === tsOp.line && loc.operatorName === tsOp.name
    );

    // If we have multiple candidates on the same line, pick the closest one by column
    let bestMatch: LocationInfo | null = null;
    let bestDistance = Infinity;

    for (const loc of candidates) {
      const distance = Math.abs(loc.range.start.character - tsOp.column);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = loc;
      }
    }

    if (!bestMatch) {
      // Fallback 1: try to find any operator with the same name on nearby lines (±3 lines)
      for (let lineOffset = -3; lineOffset <= 3; lineOffset++) {
        const targetLine = tsOp.line + lineOffset;
        const nearbyCandidate = locations.find(
          (loc) => loc.range.start.line === targetLine && loc.operatorName === tsOp.name
        );
        if (nearbyCandidate) {
          bestMatch = nearbyCandidate;
          this.log(
            `[findOperatorInfo] Using nearby match for ${tsOp.name}: line ${targetLine} (offset ${lineOffset})`
          );
          break;
        }
      }
    }

    if (!bestMatch) {
      // Fallback 2: try to find any operator with the same name anywhere (relaxed matching)
      const anyMatch = locations.find((loc) => loc.operatorName === tsOp.name);
      if (anyMatch) {
        bestMatch = anyMatch;
        this.log(
          `[findOperatorInfo] Using relaxed match for ${tsOp.name}: found at line ${anyMatch.range.start.line} (tree-sitter expected line ${tsOp.line})`
        );
      }
    }

    if (!bestMatch) {
      // Fallback 3: Create synthetic location info for known operators without LSP data
      if (this.isKnownDataflowOperator(tsOp.name)) {
        this.log(
          `[findOperatorInfo] Creating synthetic location for known operator ${tsOp.name} at line ${tsOp.line}`
        );

        // Create a synthetic LocationInfo for this operator
        const syntheticLocation: LocationInfo = {
          operatorName: tsOp.name,
          range: new vscode.Range(
            new vscode.Position(tsOp.line, tsOp.column),
            new vscode.Position(tsOp.line, tsOp.column + tsOp.name.length)
          ),
          locationType: 'Unknown',
          locationKind: 'Process<Leader>',
          fullReturnType: undefined,
        };

        bestMatch = syntheticLocation;
      }
    }

    if (!bestMatch) {
      this.log(
        `[findOperatorInfo] No matching location found for ${tsOp.name} at line ${tsOp.line}`
      );
      return null;
    }

    const key = `${bestMatch.range.start.line}:${bestMatch.range.start.character}`;
    const node = locationToNode.get(key);

    if (!node) {
      // For synthetic locations, we need to create a synthetic node
      if (bestMatch && !bestMatch.locationKind && this.isKnownDataflowOperator(tsOp.name)) {
        this.log(
          `[findOperatorInfo] Creating synthetic node for ${tsOp.name} at line ${tsOp.line}`
        );

        // Create a synthetic node ID
        const syntheticNodeId = `synthetic_${tsOp.name}_${tsOp.line}_${tsOp.column}`;

        // We'll need to add this to the locationToNode map, but for now return the info
        // The caller will need to handle synthetic nodes appropriately
        return {
          name: tsOp.name,
          range: bestMatch.range,
          returnType: null,
          locationInfo: bestMatch,
          nodeId: syntheticNodeId,
        };
      }

      this.log(
        `[findOperatorInfo] No node found for key ${key} (${tsOp.name} at line ${tsOp.line})`
      );
      return null;
    }

    const returnType = bestMatch.fullReturnType || null;

    // Skip location constructors (they don't produce dataflow)
    // Only include Hydro dataflow operators
    if (returnType && !this.isValidDataflowOperator(tsOp.name, returnType)) {
      this.log(
        `[findOperatorInfo] Filtered out ${tsOp.name} at line ${tsOp.line} - non-dataflow type: ${returnType}`
      );
      return null;
    }

    // If no return type is available, check if it's a known dataflow operator
    if (!returnType) {
      if (this.isKnownDataflowOperator(tsOp.name)) {
        this.log(
          `[findOperatorInfo] No return type for ${tsOp.name} at line ${tsOp.line}, but it's a known dataflow operator - including`
        );
      } else {
        this.log(
          `[findOperatorInfo] WARNING: ${tsOp.name} at line ${tsOp.line} has no return type and is not a known dataflow operator - including anyway`
        );
      }
    }

    return {
      name: bestMatch.operatorName,
      range: bestMatch.range,
      returnType,
      locationInfo: bestMatch,
      nodeId: node.id,
    };
    return null;
  }

  /**
   * Scan document for variable bindings using tree-sitter
   *
   * Identifies let bindings that assign operator chains to variables.
   * For example: `let words = source.map()` creates a binding from "words"
   * to the map operator.
   *
   * This now captures the LAST operator in the chain (what the variable represents).
   *
   * @param document The document being analyzed
   * @param locations Location information from LocationAnalyzer
   * @param locationToNode Map from location key to node
   * @returns Map from variable name to variable binding info
   */
  private async scanVariableBindings(
    document: vscode.TextDocument,
    locations: LocationInfo[],
    locationToNode: Map<string, Node>
  ): Promise<Map<string, VariableBinding>> {
    const bindings = new Map<string, VariableBinding>();

    // Use tree-sitter to parse variable bindings
    const treeSitterBindings = this.treeSitterParser.parseVariableBindings(document);

    this.log(`Tree-sitter found ${treeSitterBindings.length} variable bindings`);

    // Convert tree-sitter bindings to our internal format
    for (const tsBinding of treeSitterBindings) {
      // Find the last operator in the chain (what the variable represents)
      if (tsBinding.operators.length === 0) {
        continue;
      }

      const lastTsOp = tsBinding.operators[tsBinding.operators.length - 1];

      // Find the corresponding OperatorInfo from our locations
      const operatorInfo = this.findOperatorInfo(lastTsOp, locations, locationToNode);

      if (!operatorInfo) {
        this.log(
          `WARNING: Could not find operator info for ${lastTsOp.name} at line ${lastTsOp.line}`
        );
        continue;
      }

      bindings.set(tsBinding.varName, {
        varName: tsBinding.varName,
        producingOperator: operatorInfo,
        line: tsBinding.line,
      });

      this.log(
        `Found variable binding: ${tsBinding.varName} = ${operatorInfo.name} (line ${tsBinding.line})`
      );
    }

    this.log(`Scanned ${bindings.size} variable bindings`);
    return bindings;
  }

  /**
   * Build operator chains by tracking dataflow sequences
   *
   * Uses variable binding graph approach to identify connections between operators.
   * This handles:
   * - Same-line chains: a.map().filter()
   * - Multi-line chains: a.map() \n .filter()
   * - Variable bindings: let x = a.map(); let y = x.filter();
   * - Location constructors in the dataflow
   *
   * @param document The document being analyzed
   * @param locations Location information from LocationAnalyzer
   * @param nodes Previously extracted nodes
   * @returns Promise resolving to array of operator chains
   */
  // @ts-expect-error - Old method, will be removed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async buildOperatorChains(
    document: vscode.TextDocument,
    locations: LocationInfo[],
    nodes: Node[]
  ): Promise<OperatorChain[]> {
    const chains: OperatorChain[] = [];

    // Create a map from location position key to node for quick lookup
    // The key issue: nodes are created from a filtered subset of locations (operatorLocations)
    // and we need to map each location back to its corresponding node.
    //
    // Since nodes don't store their source position, we match by:
    // 1. Operator name (shortLabel)
    // 2. Location kind (locationKind)
    // 3. Order of appearance (to handle duplicates)

    const locationToNode = new Map<string, Node>();

    // Group nodes by their signature for matching
    const nodesBySignature = new Map<string, Node[]>();
    for (const node of nodes) {
      const signature = `${node.shortLabel}@${node.data.locationKind}`;
      if (!nodesBySignature.has(signature)) {
        nodesBySignature.set(signature, []);
      }
      nodesBySignature.get(signature)!.push(node);
    }

    // Track which node index we've used for each signature
    const usedNodeIndices = new Map<string, number>();

    // Map each location to its corresponding node
    for (const loc of locations) {
      const key = `${loc.range.start.line}:${loc.range.start.character}`;
      const signature = `${loc.operatorName}@${loc.locationKind}`;

      const nodesWithSignature = nodesBySignature.get(signature);
      if (nodesWithSignature && nodesWithSignature.length > 0) {
        // Get the next unused node with this signature
        const usedIndex = usedNodeIndices.get(signature) || 0;
        if (usedIndex < nodesWithSignature.length) {
          const matchingNode = nodesWithSignature[usedIndex];
          locationToNode.set(key, matchingNode);
          usedNodeIndices.set(signature, usedIndex + 1);
        }
      }
    }

    // Group locations by line to identify chains
    const locationsByLine = new Map<number, LocationInfo[]>();
    for (const loc of locations) {
      const line = loc.range.start.line;
      if (!locationsByLine.has(line)) {
        locationsByLine.set(line, []);
      }
      locationsByLine.get(line)!.push(loc);
    }

    // Step 1: Scan for variable bindings
    const variableBindings = await this.scanVariableBindings(document, locations, locationToNode);

    // Step 2: Track operator usages (which variables they consume)
    const operatorUsages = this.trackOperatorUsages(
      document,
      locations,
      locationToNode,
      variableBindings
    );

    // Step 3: Build edges from variable producers to consumers
    for (const usage of operatorUsages) {
      if (usage.consumedVariable) {
        const binding = variableBindings.get(usage.consumedVariable);
        if (binding) {
          // Create edge from the variable's producer to this consumer
          chains.push({
            operators: [binding.producingOperator, usage.operator],
          });
          this.log(
            `Chain: ${binding.producingOperator.name} -> ${usage.operator.name} (via variable '${usage.consumedVariable}')`
          );
        }
      }
    }

    // Step 4: Build edges within same-line and multi-line chains
    // Process lines that have variable assignments
    for (const [varName, binding] of variableBindings) {
      const startLine = binding.line;

      // Find all operators in this chain (including multi-line)
      const chainOperators = this.findOperatorsInChain(
        document,
        startLine,
        locationsByLine,
        locationToNode
      );

      if (chainOperators.length >= 2) {
        // Create edges between consecutive operators in the chain
        for (let i = 0; i < chainOperators.length - 1; i++) {
          chains.push({
            operators: [chainOperators[i], chainOperators[i + 1]],
          });
          this.log(
            `Chain: ${chainOperators[i].name} -> ${chainOperators[i + 1].name} (in assignment to '${varName}')`
          );
        }
      }
    }

    // Step 5: Handle standalone operator chains (not assigned to variables)
    // Use tree-sitter to find standalone chains like: reduced.snapshot().entries().all_ticks()
    const standaloneChains = this.treeSitterParser.parseStandaloneChains(document);

    for (const standaloneChain of standaloneChains) {
      if (standaloneChain.length === 0) continue;

      // Convert tree-sitter operators to OperatorInfo
      const chainOperators: OperatorInfo[] = [];

      for (const tsOp of standaloneChain) {
        const operatorInfo = this.findOperatorInfo(tsOp, locations, locationToNode);
        if (operatorInfo) {
          chainOperators.push(operatorInfo);
        }
      }

      if (chainOperators.length >= 2) {
        // Create edges between consecutive operators in the standalone chain
        for (let i = 0; i < chainOperators.length - 1; i++) {
          chains.push({
            operators: [chainOperators[i], chainOperators[i + 1]],
          });
          this.log(
            `Chain: ${chainOperators[i].name} -> ${chainOperators[i + 1].name} (standalone chain)`
          );
        }
      }

      // Check if this standalone chain starts with a variable reference
      // If so, create an edge from the variable's producer to the first operator
      const firstLine = document.lineAt(standaloneChain[0].line);
      const lineText = firstLine.text.trim();

      for (const [varName, binding] of variableBindings) {
        if (lineText.startsWith(varName) && chainOperators.length > 0) {
          chains.push({
            operators: [binding.producingOperator, chainOperators[0]],
          });
          this.log(
            `Chain: ${binding.producingOperator.name} -> ${chainOperators[0].name} (from variable '${varName}' to standalone chain)`
          );
          break;
        }
      }
    }

    // Step 6: Handle single-line chains that don't involve variable bindings
    // (e.g., direct chains like process.source().map().for_each())
    // Track which lines have been processed by variable bindings and standalone chains
    const processedLines = new Set<number>();
    for (const binding of variableBindings.values()) {
      processedLines.add(binding.line);
    }
    for (const chain of standaloneChains) {
      for (const op of chain) {
        processedLines.add(op.line);
      }
    }

    for (const [lineNum, locsOnLine] of locationsByLine) {
      if (processedLines.has(lineNum) || locsOnLine.length < 2) {
        continue;
      }

      // Sort operators by column position (left to right)
      locsOnLine.sort((a, b) => a.range.start.character - b.range.start.character);

      const lineText = document.lineAt(lineNum).text;

      // Build chain of operators on this line
      const chainOperators: OperatorInfo[] = [];

      for (const loc of locsOnLine) {
        const key = `${loc.range.start.line}:${loc.range.start.character}`;
        const node = locationToNode.get(key);

        if (node) {
          const returnType = loc.fullReturnType || null;

          // Skip operators that are not valid dataflow operators
          if (returnType && !this.isValidDataflowOperator(loc.operatorName, returnType)) {
            this.log(
              `[buildOperatorChains] Filtered out ${loc.operatorName} - not a dataflow operator (return type: ${returnType})`
            );
            continue;
          }

          // If no return type is available, log it but allow the operator through
          // This handles cases where LSP isn't ready yet or type info is unavailable
          if (!returnType) {
            this.log(
              `[buildOperatorChains] WARNING: ${loc.operatorName} has no return type information - including anyway`
            );
          }

          chainOperators.push({
            name: loc.operatorName,
            range: loc.range,
            returnType,
            locationInfo: loc,
            nodeId: node.id,
          });
        }
      }

      // Verify this is actually a chain by checking for dots between operators
      let isChain = true;
      for (let i = 0; i < chainOperators.length - 1; i++) {
        const current = chainOperators[i];
        const next = chainOperators[i + 1];

        const betweenStart = current.range.end.character;
        const betweenEnd = next.range.start.character;
        const between = lineText.substring(betweenStart, betweenEnd);

        if (!between.includes('.')) {
          isChain = false;
          break;
        }
      }

      if (isChain && chainOperators.length >= 2) {
        for (let i = 0; i < chainOperators.length - 1; i++) {
          chains.push({
            operators: [chainOperators[i], chainOperators[i + 1]],
          });
          this.log(
            `Chain: ${chainOperators[i].name} -> ${chainOperators[i + 1].name} (direct chain)`
          );
        }
      }
    }

    this.log(`Built ${chains.length} operator chains using variable binding graph`);
    return chains;
  }

  /**
   * Parse Hydro type parameters from a generic type string
   *
   * Examples:
   * - "Stream<String, Process<'_, Leader>, Unbounded, TotalOrder, ExactlyOnce>"
   *   -> ["String", "Process<'_, Leader>", "Unbounded", "TotalOrder", "ExactlyOnce"]
   * - "KeyedSingleton<String, i32, Tick<Cluster<'_, Worker>>, Bounded::WhenValueUnbounded>"
   *   -> ["String", "i32", "Tick<Cluster<'_, Worker>>", "Bounded::WhenValueUnbounded"]
   */
  private parseHydroTypeParameters(typeString: string): string[] {
    try {
      // Find the main generic part: Type<...>
      const match = typeString.match(/^[^<]+<(.+)>$/);
      if (!match) {
        return [];
      }

      const params = match[1];
      const result: string[] = [];
      let current = '';
      let angleDepth = 0;
      let parenDepth = 0;

      for (let i = 0; i < params.length; i++) {
        const char = params[i];

        if (char === '<') {
          angleDepth++;
          current += char;
        } else if (char === '>') {
          angleDepth--;
          current += char;
        } else if (char === '(') {
          parenDepth++;
          current += char;
        } else if (char === ')') {
          parenDepth--;
          current += char;
        } else if (char === ',' && angleDepth === 0 && parenDepth === 0) {
          const trimmed = current.trim();
          if (trimmed) {
            result.push(trimmed);
          }
          current = '';
        } else {
          current += char;
        }
      }

      const trimmed = current.trim();
      if (trimmed) {
        result.push(trimmed);
      }

      return result;
    } catch (error) {
      this.log(`WARNING: Error parsing type parameters from '${typeString}': ${error}`);
      return [];
    }
  }

  /**
   * Extract boundedness information from type parameters
   * Handles both simple forms (Bounded, Unbounded) and qualified paths (Bounded::UnderlyingBound)
   * Also handles generic type parameters (B) by providing reasonable defaults
   */
  private extractBoundedness(typeParams: string[]): string | null {
    for (const param of typeParams) {
      const trimmed = param.trim();

      if (trimmed.startsWith('Bounded')) {
        return 'Bounded';
      } else if (trimmed.startsWith('Unbounded')) {
        return 'Unbounded';
      }

      // Handle generic type parameters for boundedness
      // In Hydro, the boundedness parameter is typically named B
      if (trimmed === 'B' || trimmed.match(/^B\b/)) {
        // For generic B parameter, default to Unbounded (most common case)
        return 'Unbounded';
      }
    }
    return null;
  }

  /**
   * Extract ordering information from type parameters
   * Handles both simple forms (TotalOrder, NoOrder) and complex associated types
   * Also handles generic type parameters (O) by providing reasonable defaults
   */
  private extractOrdering(typeParams: string[]): string | null {
    for (const param of typeParams) {
      const trimmed = param.trim();

      // Check for TotalOrder variants (including associated types)
      if (trimmed === 'TotalOrder' || trimmed.includes('TotalOrder')) {
        return 'TotalOrder';
      }

      // Check for NoOrder variants (including associated types)
      if (trimmed === 'NoOrder' || trimmed.includes('NoOrder')) {
        return 'NoOrder';
      }

      // Handle generic type parameters for ordering
      // In Hydro, the ordering parameter is typically named O
      if (trimmed === 'O' || trimmed.match(/^O\b/)) {
        // For generic O parameter, default to NoOrder (most common case)
        return 'NoOrder';
      }

      // Handle associated types that resolve to ordering types
      // Pattern: <SomeType as SomeTrait<OrderingType>>::AssociatedType
      const associatedTypeMatch = trimmed.match(/<[^>]*as[^>]*<([^>]*)>[^>]*>::/);
      if (associatedTypeMatch) {
        const innerType = associatedTypeMatch[1];
        if (innerType.includes('TotalOrder')) {
          return 'TotalOrder';
        }
        if (innerType.includes('NoOrder')) {
          return 'NoOrder';
        }
      }
    }
    return null;
  }

  /**
   * Extract semantic tags from return type information
   *
   * Parses return type generic parameters to infer edge properties:
   * - Collection type (Stream, Singleton, Optional)
   * - Boundedness (Bounded, Unbounded)
   * - Ordering (TotalOrder, NoOrder)
   * - Keyedness (Keyed, NotKeyed)
   * - Network/Local based on location comparison
   *
   * Implements degraded mode operation:
   * - Uses minimal semantic tags when type info unavailable
   * - Handles null/undefined return types gracefully
   * - Logs warnings when using default tags
   *
   * Requirements addressed:
   * - 6.2: Handle null/undefined responses from rust-analyzer gracefully
   * - 6.4: Use minimal semantic tags when type info unavailable
   * - 6.5: Log warnings for degraded mode operation
   *
   * @param returnType The return type string from rust-analyzer (may be null)
   * @param sourceLocation Location info for source operator
   * @param targetLocation Location info for target operator
   * @returns Array of semantic tag strings, sorted for deterministic output
   */
  // @ts-expect-error - Old method, will be removed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private extractSemanticTags(
    returnType: string | null,
    sourceLocation: LocationInfo,
    targetLocation: LocationInfo
  ): string[] {
    const tags: string[] = [];
    let usedDefaults = false;

    if (!returnType) {
      // No type information - use minimal defaults (degraded mode)
      tags.push('Stream', 'Unbounded', 'NoOrder', 'NotKeyed');
      usedDefaults = true;
      this.log('WARNING: No return type information, using minimal semantic tags (degraded mode)');
    } else {
      // Clean up the type string (remove leading colons, etc.)
      const cleanReturnType = returnType.replace(/^:\s*/, '').trim();

      // Collection type (Stream, Singleton, Optional)
      if (cleanReturnType.includes('Stream<')) {
        tags.push('Stream');
      } else if (cleanReturnType.includes('Singleton<')) {
        tags.push('Singleton');
      } else if (cleanReturnType.includes('Optional<')) {
        tags.push('Optional');
      } else {
        // Default to Stream if not specified
        tags.push('Stream');
        usedDefaults = true;
      }

      // Parse type parameters using a more robust approach
      const typeParams = this.parseHydroTypeParameters(cleanReturnType);

      // Debug logging for generic types
      if (
        typeParams.length > 0 &&
        (typeParams.includes('T') ||
          typeParams.includes('L') ||
          typeParams.includes('B') ||
          typeParams.includes('O'))
      ) {
        this.log(`DEBUG: Parsing generic type '${cleanReturnType}' -> [${typeParams.join(', ')}]`);
      }

      // Boundedness - look for the boundedness parameter
      // For Stream<T, Location, Boundedness, ...>: 3rd parameter (index 2)
      // For KeyedStream<K, V, Location, Boundedness, ...>: 4th parameter (index 3)
      // For KeyedSingleton<K, V, Location, Boundedness>: 4th parameter (index 3)
      const boundedness = this.extractBoundedness(typeParams);
      if (boundedness) {
        tags.push(boundedness);
      } else {
        // Default to Unbounded
        tags.push('Unbounded');
        usedDefaults = true;
      }

      // Ordering - look for the ordering parameter (4th parameter for most types)
      // Note: KeyedSingleton and Singleton types don't have ordering parameters
      const ordering = this.extractOrdering(typeParams);
      if (ordering) {
        tags.push(ordering);
      } else if (
        cleanReturnType.includes('Singleton<') ||
        cleanReturnType.includes('KeyedSingleton<')
      ) {
        // Singleton types don't have ordering - this is expected, not a degraded mode
        tags.push('NoOrder');
      } else {
        // Default to NoOrder for other types
        tags.push('NoOrder');
        usedDefaults = true;
      }

      // Keyedness - check if it's a Keyed collection type
      if (cleanReturnType.includes('KeyedStream<') || cleanReturnType.includes('KeyedSingleton<')) {
        tags.push('Keyed');
      } else {
        tags.push('NotKeyed');
      }

      if (usedDefaults) {
        this.log(
          `WARNING: Incomplete type information in '${returnType}', using default semantic tags (degraded mode)`
        );
      }
    }

    // Network vs Local (based on location comparison)
    // Handle null/undefined location kinds gracefully
    try {
      if (sourceLocation.locationKind && targetLocation.locationKind) {
        // Extract base location (remove Tick wrapper) for comparison
        const getBaseLocation = (locationKind: string): string => {
          // Match patterns like "Tick<Process<Leader>>" or "Process<Leader>"
          const match = locationKind.match(/(?:Tick<)?(\w+<\w+>)/);
          return match ? match[1] : locationKind;
        };

        const sourceBase = getBaseLocation(sourceLocation.locationKind);
        const targetBase = getBaseLocation(targetLocation.locationKind);

        if (sourceBase !== targetBase) {
          tags.push('Network');
        } else {
          tags.push('Local');
        }
      } else {
        // Default to Local if location info is missing
        tags.push('Local');
        this.log(
          'WARNING: Missing location kind information, defaulting to Local edge (degraded mode)'
        );
      }
    } catch (error) {
      // Fallback to Local on any error
      tags.push('Local');
      this.log('WARNING: Error determining Network/Local tag, defaulting to Local (degraded mode)');
    }

    // Sort tags for deterministic output
    return tags.sort();
  }

  /**
   * Filter LocationInfo results to scope boundaries
   *
   * @param locations All location information from analyzer
   * @param scopeTarget The scope target for filtering
   * @param _document The document being analyzed (unused but kept for future use)
   * @returns Filtered array of LocationInfo
   */
  // @ts-expect-error - Old method, will be removed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private filterToScope(
    locations: LocationInfo[],
    scopeTarget: ScopeTarget,
    _document: vscode.TextDocument
  ): LocationInfo[] {
    switch (scopeTarget.type) {
      case 'function':
        // Filter to operators within the target function(s)
        if (scopeTarget.functions.length === 0) {
          return [];
        }
        return locations.filter((loc) => {
          const line = loc.range.start.line;
          return scopeTarget.functions.some((fn) => line >= fn.startLine && line <= fn.endLine);
        });

      case 'file':
        // Filter to operators in the active file
        if (!scopeTarget.activeFilePath) {
          return locations;
        }
        // All locations from analyzeDocument are already in the current file
        return locations;

      case 'workspace':
        // Include all operators (no filtering)
        return locations;

      default:
        this.log(`WARNING: Unknown scope type: ${scopeTarget.type}`);
        return locations;
    }
  }

  /**
   * Build location-based hierarchy
   *
   * Groups nodes by their Location type (Process, Cluster, External) and creates
   * a hierarchical structure for visualization. Generates unique container IDs
   * and assigns nodes to their corresponding containers.
   *
   * Implements degraded mode operation:
   * - Creates basic hierarchy even with incomplete location info
   * - Handles null/undefined location types gracefully
   * - Assigns nodes without location info to default container
   * - Logs warnings for degraded mode operation
   *
   * Requirements addressed:
   * - 3.1: Groups nodes by Location type (Process, Cluster, External)
   * - 3.2: Assigns each node to its corresponding Location container
   * - 3.3: Extracts location type parameter names (e.g., Leader, Worker, Proposer)
   * - 3.4: Creates hierarchy structure with id, name, and children fields
   * - 3.5: Handles nodes without location information (assigns to default container)
   * - 6.4: Create basic hierarchy even with incomplete location info
   * - 6.5: Log warnings for degraded mode operation
   *
   * @param nodes Previously extracted nodes
   * @returns HierarchyData containing hierarchy choices and node assignments
   */
  private buildLocationAndCodeHierarchies(
    document: vscode.TextDocument,
    nodes: Node[],
    edges: Edge[]
  ): HierarchyData {
    // Build nested Tick hierarchy: base location (e.g., Worker), with children
    // Tick<Worker>, Tick<Tick<Worker>>, etc. Assign each node to the deepest
    // matching container based on the Tick depth present in its locationKind.

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
    interface LocMeta {
      base: string;
      depth: number;
      kind: string | null;
    }
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

      // Level 1..maxDepth: split by tick variable (not connected components!)
      // Nodes at the same tick level share a container if they use the same tick variable
      for (let level = 1; level <= maxDepth; level++) {
        const nodesAtLevel = new Map<string, string[]>(); // tick variable -> node IDs
        
        for (const n of baseNodes) {
          const m = metaById.get(n.id)!;
          if (m.depth >= level) {
            // Group by tick variable
            const tickVar = n.data.tickVariable || '_unknown_'; // Fallback for nodes without tick variable
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
            // Pick the first node's parent (tick groups shouldn't cross parents)
            for (const nid of nodeIds) {
              const pid = parentMap.get(nid);
              if (pid) {
                // Find the actual container reference by walking tree (small N, so simple search)
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
          // Strip function scope prefix for display (e.g., "main::ticker" -> "ticker")
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
            // Fallback: assign to root if no mapping found (shouldn't happen)
            nodeAssignments[n.id] = root.id;
          }
        }
      }
    }

    // Collect top-level children
    // children already collected during roots build

    // Handle nodes without location information (assign to default container)
    // This addresses requirement 3.5 and degraded mode requirement 6.4
    const unassignedNodes = nodes.filter((node) => !(node.id in nodeAssignments));
    if (unassignedNodes.length > 0) {
      const defaultContainerId = `loc_${containerIdCounter++}`;
      children.push({ id: defaultContainerId, name: '(unknown location)', children: [] });
      for (const node of unassignedNodes) nodeAssignments[node.id] = defaultContainerId;

      this.log(
        `DEGRADED MODE: Created default container '${defaultContainerId}' for ${unassignedNodes.length} unassigned nodes`
      );
    }

    // Ensure we have at least one container (even if empty)
    if (children.length === 0) {
      const fallbackContainerId = 'loc_0';
      children.push({
        id: fallbackContainerId,
        name: '(default)',
        children: [],
      });
      this.log('DEGRADED MODE: Created fallback container as no location groups were found');
    }

    // Build the complete hierarchy structure
    // Build Code hierarchy: file -> function -> variable
    const codeChildren: HierarchyContainer[] = [];
    const codeAssignments: Record<string, string> = {};
    let codeIdCounter = containerIdCounter;

    const fileLabel = path.basename(document.fileName);
    const fileContainer: HierarchyContainer = {
      id: `code_${codeIdCounter++}`,
      name: fileLabel,
      children: [],
    };
    codeChildren.push(fileContainer);

    // Helper maps (do not push children yet; finalize after we know which have nodes)
    const functionMap = new Map<string, HierarchyContainer>();
    const variableMap = new Map<string, HierarchyContainer>();
    const containerAssignmentCount: Record<string, number> = {};

    const bumpCount = (id: string) => {
      containerAssignmentCount[id] = (containerAssignmentCount[id] || 0) + 1;
    };

    const getFunctionContainer = (fnNameRaw: string): HierarchyContainer => {
      const fnName = `fn ${fnNameRaw}`; // label functions distinctly
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

    // Build mapping from tree-sitter positions to node IDs for assignment
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

    // Any remaining nodes without code assignment → put under file container
    for (const n of nodes) {
      if (!(n.id in codeAssignments)) {
        codeAssignments[n.id] = fileContainer.id;
        bumpCount(fileContainer.id);
      }
    }

    // Finalize hierarchy: add only containers with assignments
    // Add function containers with either their own assignments or variable children with assignments
    for (const [, fnContainer] of functionMap.entries()) {
      // Collect variable children for this function
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

    // Collapse single-child container chains (avoid collapsing the file container)
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

      // Then attempt to collapse this container if it has exactly one child and no direct assignments
      if (!isTopLevel && container.children.length === 1) {
        const onlyChild = container.children[0];
        const thisCount = containerAssignmentCount[container.id] || 0;
        if (thisCount === 0) {
          // Merge: move assignments from child to this container, adopt grandchildren, and combine name
          reassignAll(onlyChild.id, container.id);
          container.name = `${container.name}→${onlyChild.name}`;
          container.children = onlyChild.children;
        }
      }
    };

    collapseChains(fileContainer, true);

    const hierarchyChoices: Hierarchy[] = [
      { id: 'location', name: 'Location', children },
      { id: 'code', name: 'Code', children: codeChildren },
    ];

    return {
      hierarchyChoices,
      nodeAssignments: {
        location: nodeAssignments,
        code: codeAssignments,
      },
      selectedHierarchy: 'location',
    };
  }

  /**
   * Count nested Tick<> wrappers around a location kind string
   * Examples:
   * - "Process<Worker>" -> 0
   * - "Tick<Process<Worker>>" -> 1
   * - "Tick<Tick<Cluster<Leader>>>>" -> 2
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
   * depth=0 -> baseLabel
   * depth=1 -> Tick<baseLabel>
   * depth=2 -> Tick<Tick<baseLabel>>
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
   * Extracts human-readable labels from location kind strings.
   * Attempts to extract type parameter names (e.g., "Leader", "Worker", "Proposer")
   * from patterns like "Process<Leader>", "Cluster<Worker>", etc.
   *
   * Examples:
   * - "Process<Leader>" -> "Leader"
   * - "Cluster<Worker>" -> "Worker"
   * - "Tick<Process<Proposer>>" -> "Proposer"
   * - "Process" -> "Process"
   * - null -> "(unknown location)"
   *
   * @param locationKind The location kind string (e.g., "Process<Leader>")
   * @returns Human-readable location label
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
    // Match: Type<Parameter> where Parameter is the type parameter name
    const paramMatch = unwrapped.match(/^(?:Process|Cluster|External)<([^>]+)>/);
    if (paramMatch) {
      // Extract the type parameter (e.g., "Leader", "Worker", "Proposer")
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

  /**
   * Infer node type from operator name
   *
   * Uses pattern matching on common Hydro operators to classify them
   * into categories (Source, Sink, Transform, Join, Network, Aggregation, Tee).
   *
   * @param operatorName The operator name (e.g., "map", "filter", "join")
   * @returns The inferred node type
   */
  private inferNodeType(operatorName: string): NodeType {
    // Source operators: produce data
    if (
      /^(source_iter|source_stream|source_stdin|recv_stream|recv_bincode|recv_bytes)$/.test(
        operatorName
      )
    ) {
      return 'Source';
    }

    // Sink operators: consume data
    if (/^(dest_sink|for_each|inspect|dest_file|assert|assert_eq)$/.test(operatorName)) {
      return 'Sink';
    }

    // Join operators: combine multiple streams
    if (/^(join|cross_product|anti_join|cross_join|difference|join_multiset)$/.test(operatorName)) {
      return 'Join';
    }

    // Network operators: send/receive across locations
    if (
      /^(send_bincode|broadcast_bincode|demux_bincode|round_robin_bincode|send_bytes|broadcast_bytes|demux_bytes|network)$/.test(
        operatorName
      )
    ) {
      return 'Network';
    }

    // Aggregation operators: reduce/fold operations
    if (
      /^(fold|reduce|fold_keyed|reduce_keyed|count|sum|min|max|sort|sort_by)$/.test(operatorName)
    ) {
      return 'Aggregation';
    }

    // Tee operators: split/persist streams
    if (/^(tee|persist|clone)$/.test(operatorName)) {
      return 'Tee';
    }

    // Default: Transform
    return 'Transform';
  }

  /**
   * Extract full label from operator code context
   *
   * Reads the source code text from the operator range and extracts
   * the operator call with parameters (e.g., "map(|x| x + 1)").
   * Truncates long expressions for readability.
   *
   * @param document The document being analyzed
   * @param range The range of the operator in the document
   * @returns The full label string
   */
  private extractFullLabel(document: vscode.TextDocument, range: vscode.Range): string {
    try {
      // Get the line containing the operator
      const line = document.lineAt(range.start.line);
      const lineText = line.text;

      // Find the operator name in the line
      const operatorStart = range.start.character;
      const operatorEnd = range.end.character;
      const operatorName = lineText.substring(operatorStart, operatorEnd);

      // Look for opening parenthesis after the operator
      let searchStart = operatorEnd;
      while (searchStart < lineText.length && /\s/.test(lineText[searchStart])) {
        searchStart++;
      }

      if (searchStart >= lineText.length || lineText[searchStart] !== '(') {
        // No parameters, just return the operator name
        return operatorName;
      }

      // Find matching closing parenthesis
      let parenDepth = 0;
      let endPos = searchStart;
      let foundEnd = false;

      // Search within the current line first
      for (let i = searchStart; i < lineText.length; i++) {
        const char = lineText[i];
        if (char === '(') {
          parenDepth++;
        } else if (char === ')') {
          parenDepth--;
          if (parenDepth === 0) {
            endPos = i + 1;
            foundEnd = true;
            break;
          }
        }
      }

      // If not found on same line, search subsequent lines (multi-line operator call)
      if (!foundEnd) {
        let currentLine = range.start.line + 1;
        const maxLinesToSearch = 10; // Limit search to avoid performance issues
        let linesSearched = 0;

        while (currentLine < document.lineCount && linesSearched < maxLinesToSearch) {
          const nextLine = document.lineAt(currentLine);
          const nextText = nextLine.text;

          for (let i = 0; i < nextText.length; i++) {
            const char = nextText[i];
            if (char === '(') {
              parenDepth++;
            } else if (char === ')') {
              parenDepth--;
              if (parenDepth === 0) {
                // Found the end on a different line
                // For multi-line, just use operator name with "..."
                return `${operatorName}(...)`;
              }
            }
          }

          currentLine++;
          linesSearched++;
        }

        // Couldn't find end within reasonable search
        return `${operatorName}(...)`;
      }

      // Extract the full operator call
      let fullCall = lineText.substring(operatorStart, endPos);

      // Truncate if too long (for readability)
      const maxLength = 80;
      if (fullCall.length > maxLength) {
        // Try to truncate at a reasonable point
        const truncated = fullCall.substring(0, maxLength - 3);
        // Find last complete token
        const lastSpace = truncated.lastIndexOf(' ');
        const lastComma = truncated.lastIndexOf(',');
        const lastPipe = truncated.lastIndexOf('|');
        const cutPoint = Math.max(lastSpace, lastComma, lastPipe);

        if (cutPoint > operatorName.length + 5) {
          fullCall = truncated.substring(0, cutPoint) + '...)';
        } else {
          fullCall = truncated + '...)';
        }
      }

      return fullCall;
    } catch (error) {
      // On error, return just the operator name
      if (error instanceof Error) {
        this.log(`WARNING: Error extracting full label: ${error.message}`);
      }
      return document.getText(range);
    }
  }

  /**
   * Extract location ID from location kind string
   *
   * Normalizes location kinds to prevent duplicate containers for the same logical location.
   * For example, "Process<Leader>" and "Tick<Process<Leader>>" should map to the same container.
   *
   * @param locationKind The location kind (e.g., "Process<Leader>")
   * @returns Numeric location ID or null
   */
  private getLocationId(locationKind: string): number | null {
    // Normalize the location kind by removing Tick wrappers
    const normalized = this.normalizeLocationKind(locationKind);

    // Use a simple hash of the normalized location kind
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Normalize location kind string for consistent hierarchy grouping
   *
   * @param locationKind The raw location kind
   * @returns Normalized location kind
   */
  private normalizeLocationKind(locationKind: string): string {
    // Strip Tick wrappers to get the base location
    let normalized = locationKind;
    while (normalized.startsWith('Tick<') && normalized.endsWith('>')) {
      normalized = normalized.substring(5, normalized.length - 1);
    }
    return normalized;
  }

  /**
   * Check if an operator is a valid dataflow operator based on its return type
   *
   * Valid dataflow operators are those that either:
   * 1. Return Hydro live collection types (Stream, KeyedStream, Singleton, KeyedSingleton, Optional)
   * 2. Are sink operators that consume live collections and return unit type ()
   * 3. Are known dataflow operators by name (when type info is unavailable)
   *
   * This filtering is based on the canonical HydroNode IR definitions and includes
   * networking operators that are essential parts of Hydro dataflow pipelines.
   */
  private isValidDataflowOperator(operatorName: string, returnType: string | null): boolean {
    // If no return type available, use name-based heuristics for known dataflow operators
    if (!returnType) {
      return this.isKnownDataflowOperator(operatorName);
    }

    // Accept operators that return live collection types (canonical Hydro collections)
    // This includes networking operators like broadcast_bincode that return Stream<T, Cluster<...>, ...>
    const config = this.getOperatorConfig();
    if (
      config.collectionTypes.some((collectionType: string) => returnType.includes(collectionType))
    ) {
      return true;
    }

    // Accept sink operators that return unit type ()
    // If return type is strictly unit, accept regardless of operator name (common pattern like `collect`)
    if (returnType.trim() === '()') {
      return true;
    }
    if (returnType.includes('()') && this.isSinkOperator(operatorName)) {
      return true;
    }

    // Accept operators that return impl Into<Collection> (common Hydro pattern)
    if (
      returnType.includes('impl Into<') &&
      config.collectionTypes.some((collectionType: string) =>
        returnType.includes(collectionType.replace('<', ''))
      )
    ) {
      return true;
    }

    // Special case: Accept networking operators even if LSP returns incomplete type info
    // These are crucial parts of Hydro distributed dataflow pipelines
    if (this.isNetworkingOperator(operatorName)) {
      this.log(
        `Accepting networking operator ${operatorName} despite incomplete type info: ${returnType || 'null'}`
      );
      return true;
    }

    // Reject pure infrastructure operators that only return location types without collections
    // But be careful not to reject networking operators that might have incomplete type info
    if (
      returnType.includes('Process<') ||
      returnType.includes('Cluster<') ||
      returnType.includes('Tick<') ||
      returnType.includes('Atomic<')
    ) {
      // Double-check: if it's a known networking operator, accept it anyway
      if (this.isNetworkingOperator(operatorName)) {
        this.log(
          `Accepting networking operator ${operatorName} despite location-type return: ${returnType}`
        );
        return true;
      }
      return false;
    }

    // Fallback to name-based heuristics for edge cases
    return this.isKnownDataflowOperator(operatorName);
  }

  /**
   * Get the current operator configuration from VS Code settings
   *
   * Reads operator lists from hydroIde.operators.* settings.
   * Defaults are defined in package.json and applied by VS Code.
   * In test environments without VS Code, returns package.json defaults.
   */
  private getOperatorConfig() {
    try {
      const config = vscode.workspace.getConfiguration('hydroIde.operators');
      return {
        networkingOperators: config.get<string[]>('networkingOperators', []),
        coreDataflowOperators: config.get<string[]>('coreDataflowOperators', []),
        sinkOperators: config.get<string[]>('sinkOperators', []),
        collectionTypes: config.get<string[]>('collectionTypes', []),
      };
    } catch {
      // Fallback for unit test environment (package.json defaults)
      return {
        networkingOperators: [
          'send_bincode',
          'recv_bincode',
          'broadcast_bincode',
          'demux_bincode',
          'round_robin_bincode',
          'send_bincode_external',
          'recv_bincode_external',
          'send_bytes',
          'recv_bytes',
          'broadcast_bytes',
          'demux_bytes',
          'send_bytes_external',
          'recv_bytes_external',
          'connect',
          'disconnect',
        ],
        coreDataflowOperators: [
          'map',
          'flat_map',
          'filter',
          'filter_map',
          'scan',
          'enumerate',
          'inspect',
          'unique',
          'sort',
          'fold',
          'reduce',
          'fold_keyed',
          'reduce_keyed',
          'reduce_watermark_commutative',
          'fold_commutative',
          'reduce_commutative',
          'fold_early_stop',
          'into_singleton',
          'into_stream',
          'into_keyed',
          'keys',
          'values',
          'entries',
          'collect_vec',
          'collect_ready',
          'all_ticks',
          'all_ticks_atomic',
          'join',
          'cross_product',
          'cross_singleton',
          'difference',
          'anti_join',
          'chain',
          'chain_first',
          'union',
          'concat',
          'zip',
          'defer_tick',
          'persist',
          'snapshot',
          'snapshot_atomic',
          'sample_every',
          'sample_eager',
          'timeout',
          'batch',
          'yield_concat',
          'source_iter',
          'source_stream',
          'source_stdin',
          'for_each',
          'dest_sink',
          'assert',
          'assert_eq',
          'dest_file',
          'tee',
          'clone',
          'unwrap',
          'unwrap_or',
          'filter_if_some',
          'filter_if_none',
          'resolve_futures',
          'resolve_futures_ordered',
          'tick',
          'atomic',
          'complete',
          'complete_next_tick',
          'first',
          'last',
        ],
        sinkOperators: ['for_each', 'dest_sink', 'assert', 'assert_eq', 'dest_file'],
        collectionTypes: ['Stream<', 'Singleton<', 'Optional<', 'KeyedStream<', 'KeyedSingleton<'],
      };
    }
  }

  /**
   * Check if an operator is a networking operator
   *
   * Networking operators are essential parts of Hydro distributed dataflow pipelines
   * that handle communication between different locations (processes, clusters).
   */
  private isNetworkingOperator(operatorName: string): boolean {
    const config = this.getOperatorConfig();
    return config.networkingOperators.includes(operatorName);
  }

  /**
   * Check if an operator is a known dataflow operator based on its name
   *
   * This is based on the canonical HydroNode IR definitions and actual operator
   * implementations in the Hydro codebase. Includes both core dataflow operators
   * and networking operators that are essential parts of distributed pipelines.
   */
  private isKnownDataflowOperator(operatorName: string): boolean {
    // Check networking operators first
    if (this.isNetworkingOperator(operatorName)) {
      return true;
    }

    // Check core dataflow operators from configuration
    const config = this.getOperatorConfig();
    return config.coreDataflowOperators.includes(operatorName);
  }

  /**
   * Check if an operator is a sink operator that consumes live collections
   *
   * Sink operators are identified by their signature:
   * - Return unit type ()
   * - Take a live collection as self parameter
   *
   * This method uses the configuration to identify known sink operators.
   */
  private isSinkOperator(operatorName: string): boolean {
    const config = this.getOperatorConfig();
    return config.sinkOperators.includes(operatorName);
  }

  /**
   * Extract location type from location kind string
   *
   * @param locationKind The location kind (e.g., "Process<Leader>", "Tick<Cluster<Worker>>")
   * @returns Location type string or null
   */
  private getLocationType(locationKind: string): string | null {
    // Strip Tick wrappers to get the base location type
    let unwrapped = locationKind;
    while (unwrapped.startsWith('Tick<') && unwrapped.endsWith('>')) {
      unwrapped = unwrapped.substring(5, unwrapped.length - 1);
    }

    // Extract the base location type (Process, Cluster, External)
    const match = unwrapped.match(/^(Process|Cluster|External)</);
    if (match) {
      return match[1];
    }

    return null;
  }

  /**
   * Assemble Hydroscope JSON from extracted components
   *
   * Combines nodes, edges, and hierarchy data into a single Hydroscope JSON
   * structure conforming to the specification. Adds configuration for edge
   * styling, node types, and legend.
   *
   * This method implements the final assembly step of the LSP-based graph
   * extraction pipeline, producing output that is compatible with the
   * Hydroscope visualizer and matches the format of cargo-based extraction.
   *
   * Requirements addressed:
   * - 1.4: Generates valid Hydroscope JSON that can be rendered by Hydroscope
   *
   * @param nodes Array of extracted nodes
   * @param edges Array of extracted edges
   * @param hierarchyData Hierarchy structure with node assignments
   * @returns Complete Hydroscope JSON object
   */
  private analyzeNetworkEdges(edges: Edge[], nodes: Node[]): Edge[] {
    // Create a map for quick node lookup
    const nodeMap = new Map<string, Node>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    let networkEdgeCount = 0;

    const analyzedEdges = edges.map((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode || !targetNode) {
        return edge; // Skip if nodes not found
      }

      const sourceIsNetwork = this.isNetworkingOperator(sourceNode.shortLabel);
      const targetIsNetwork = this.isNetworkingOperator(targetNode.shortLabel);

      if (sourceIsNetwork || targetIsNetwork) {
        // This is a network edge
        networkEdgeCount++;
        const networkTags = ['network'];

        if (sourceIsNetwork && targetIsNetwork) {
          // Both sides are network operators (rare case)
          networkTags.push('network-to-network');
          this.log(
            `Network edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel} (both network ops)`
          );
        } else if (sourceIsNetwork) {
          // Source is network operator (sender side)
          networkTags.push('network-source', 'remote-sender');
          this.log(
            `Network edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel} (network source)`
          );
        } else {
          // Target is network operator (receiver side)
          networkTags.push('network-target', 'remote-receiver');
          this.log(
            `Network edge: ${sourceNode.shortLabel} -> ${targetNode.shortLabel} (network target)`
          );
        }

        return {
          ...edge,
          semanticTags: [...edge.semanticTags, ...networkTags],
        };
      }

      return edge; // Not a network edge
    });

    this.log(`Analyzed ${edges.length} edges, found ${networkEdgeCount} network edges`);
    return analyzedEdges;
  }

  /**
   * Analyze and mark network edges, then assemble final Hydroscope JSON object
   *
   * A network edge is one where either the source or target node is a networking operator.
   * We mark the networking operator side as the "remote" side for visualization purposes.
   *
   * Requirements addressed:
   * - 1.4: Generates valid Hydroscope JSON that can be rendered by Hydroscope
   *
   * @param nodes Array of extracted nodes
   * @param edges Array of extracted edges
   * @param hierarchyData Hierarchy structure with node assignments
   * @returns Complete Hydroscope JSON object
   */
  private assembleHydroscopeJson(
    nodes: Node[],
    edges: Edge[],
    hierarchyData: HierarchyData
  ): HydroscopeJson {
    // Validate inputs (basic sanity checks)
    if (!Array.isArray(nodes)) {
      this.log('WARNING: nodes is not an array, using empty array');
      nodes = [];
    }
    if (!Array.isArray(edges)) {
      this.log('WARNING: edges is not an array, using empty array');
      edges = [];
    }

    // Analyze and mark network edges
    const analyzedEdges = this.analyzeNetworkEdges(edges, nodes);

    // Log assembly statistics
    this.log(`Assembling Hydroscope JSON: ${nodes.length} nodes, ${analyzedEdges.length} edges`);

    // Combine all components into Hydroscope JSON structure
    const json: HydroscopeJson = {
      // Core graph structure
      nodes,
      edges: analyzedEdges,

      // Hierarchy configuration
      hierarchyChoices: hierarchyData.hierarchyChoices,
      nodeAssignments: hierarchyData.nodeAssignments,
      selectedHierarchy: hierarchyData.selectedHierarchy,

      // Styling and configuration
      edgeStyleConfig: this.getEdgeStyleConfig(),
      nodeTypeConfig: this.getNodeTypeConfig(),
      legend: this.getLegend(),
    };

    // Validate output against Hydroscope JSON specification
    this.validateHydroscopeJson(json);

    this.log('Successfully assembled Hydroscope JSON');
    return json;
  }

  /**
   * Validate Hydroscope JSON against specification
   *
   * Performs basic validation to ensure the generated JSON conforms to
   * the Hydroscope specification. Logs warnings for any issues found.
   *
   * @param json The Hydroscope JSON to validate
   */
  private validateHydroscopeJson(json: HydroscopeJson): void {
    const issues: string[] = [];

    // Validate required fields
    if (!json.nodes || !Array.isArray(json.nodes)) {
      issues.push('Missing or invalid nodes array');
    }
    if (!json.edges || !Array.isArray(json.edges)) {
      issues.push('Missing or invalid edges array');
    }

    // Validate node structure
    for (const node of json.nodes || []) {
      if (!node.id) {
        issues.push(`Node missing id: ${JSON.stringify(node)}`);
      }
      if (!node.nodeType) {
        issues.push(`Node ${node.id} missing nodeType`);
      }
      if (!node.shortLabel) {
        issues.push(`Node ${node.id} missing shortLabel`);
      }
    }

    // Validate edge structure
    for (const edge of json.edges || []) {
      if (!edge.id) {
        issues.push(`Edge missing id: ${JSON.stringify(edge)}`);
      }
      if (!edge.source) {
        issues.push(`Edge ${edge.id} missing source`);
      }
      if (!edge.target) {
        issues.push(`Edge ${edge.id} missing target`);
      }

      // Validate edge references valid nodes
      const sourceExists = json.nodes.some((n) => n.id === edge.source);
      const targetExists = json.nodes.some((n) => n.id === edge.target);
      if (!sourceExists) {
        issues.push(`Edge ${edge.id} references non-existent source node: ${edge.source}`);
      }
      if (!targetExists) {
        issues.push(`Edge ${edge.id} references non-existent target node: ${edge.target}`);
      }
    }

    // Validate hierarchy structure
    if (json.hierarchyChoices && Array.isArray(json.hierarchyChoices)) {
      for (const hierarchy of json.hierarchyChoices) {
        if (!hierarchy.id) {
          issues.push('Hierarchy missing id');
        }
        if (!hierarchy.name) {
          issues.push(`Hierarchy ${hierarchy.id} missing name`);
        }
      }
    }

    // Validate node assignments
    if (json.nodeAssignments && json.selectedHierarchy) {
      const assignments = json.nodeAssignments[json.selectedHierarchy];
      if (assignments) {
        for (const nodeId of Object.keys(assignments)) {
          const nodeExists = json.nodes.some((n) => n.id === nodeId);
          if (!nodeExists) {
            issues.push(`Node assignment references non-existent node: ${nodeId}`);
          }
        }
      }
    }

    // Log validation results
    if (issues.length > 0) {
      this.log(`WARNING: Hydroscope JSON validation found ${issues.length} issues:`);
      for (const issue of issues) {
        this.log(`  - ${issue}`);
      }
    } else {
      this.log('Hydroscope JSON validation passed');
    }
  }

  /**
   * Get edge style configuration for Hydroscope
   *
   * Returns edge styling rules based on semantic tags. This configuration
   * defines how different semantic properties (boundedness, ordering, keyedness,
   * network/local, collection type) are visually represented in the graph.
   *
   * The configuration follows the Hydroscope JSON specification and matches
   * the format used by cargo-based visualization for consistency.
   *
   * @returns Edge style configuration object with semantic mappings
   */
  private getEdgeStyleConfig(): EdgeStyleConfig {
    return {
      note: 'Edge styles are now computed per-edge using the unified edge style system. This config is provided for reference and compatibility.',
      semanticMappings: {
        // Boundedness: Visual indicator for bounded vs unbounded streams
        BoundednessGroup: {
          Bounded: {
            halo: 'none',
          },
          Unbounded: {
            halo: 'light-blue',
          },
        },
        // Collection type: Different colors and arrowheads for Stream/Singleton/Optional
        CollectionGroup: {
          Stream: {
            arrowhead: 'triangle-filled',
            'color-token': 'highlight-1', // Semantic token for blue
          },
          Singleton: {
            arrowhead: 'circle-filled',
            'color-token': 'default', // Semantic token for default
          },
          Optional: {
            arrowhead: 'diamond-open',
            'color-token': 'muted', // Semantic token for gray/muted
          },
        },
        // Keyedness: Visual indicator for keyed vs not-keyed streams
        KeyednessGroup: {
          NotKeyed: {
            'line-style': 'single',
          },
          Keyed: {
            'line-style': 'hash-marks',
          },
        },
        // Network vs Local: Dashed animated lines for network edges
        NetworkGroup: {
          Local: {
            'line-pattern': 'solid',
            animation: 'static',
          },
          Network: {
            'line-pattern': 'dashed',
            animation: 'animated',
          },
        },
        // Ordering: Wavy lines for unordered streams
        OrderingGroup: {
          TotalOrder: {
            // Use "none" to indicate straight (non-wavy) lines per spec
            waviness: 'none',
          },
          NoOrder: {
            waviness: 'wavy',
          },
        },
      },
      // Priority order for semantic tags (used for conflict resolution)
      semanticPriorities: [
        ['Unbounded', 'Bounded'],
        ['NoOrder', 'TotalOrder'],
        ['Keyed', 'NotKeyed'],
        ['Network', 'Local'],
      ],
    };
  }

  /**
   * Get node type configuration for Hydroscope
   *
   * Returns node type definitions and styling. This configuration defines
   * the available node types (Source, Transform, Sink, Join, Network, Tee,
   * Aggregation) and their visual representation (color indices).
   *
   * The configuration follows the Hydroscope JSON specification and matches
   * the format used by cargo-based visualization for consistency.
   *
   * @returns Node type configuration object with type definitions
   */
  private getNodeTypeConfig(): NodeTypeConfig {
    return {
      defaultType: 'Transform',
      types: [
        {
          id: 'Aggregation',
          label: 'Aggregation',
          colorIndex: 0,
        },
        {
          id: 'Join',
          label: 'Join',
          colorIndex: 1,
        },
        {
          id: 'Network',
          label: 'Network',
          colorIndex: 2,
        },
        {
          id: 'Sink',
          label: 'Sink',
          colorIndex: 3,
        },
        {
          id: 'Source',
          label: 'Source',
          colorIndex: 4,
        },
        {
          id: 'Tee',
          label: 'Tee',
          colorIndex: 5,
        },
        {
          id: 'Transform',
          label: 'Transform',
          colorIndex: 6,
        },
      ],
    };
  }

  /**
   * Get legend configuration for Hydroscope
   *
   * Returns legend configuration for the visualization. The legend displays
   * all available node types with their visual styling, helping users
   * understand the graph visualization.
   *
   * The configuration follows the Hydroscope JSON specification and matches
   * the format used by cargo-based visualization for consistency.
   *
   * @returns Legend configuration object
   */
  private getLegend(): Legend {
    return {
      title: 'Node Types',
      items: [
        {
          type: 'Aggregation',
          label: 'Aggregation',
        },
        {
          type: 'Join',
          label: 'Join',
        },
        {
          type: 'Network',
          label: 'Network',
        },
        {
          type: 'Sink',
          label: 'Sink',
        },
        {
          type: 'Source',
          label: 'Source',
        },
        {
          type: 'Tee',
          label: 'Tee',
        },
        {
          type: 'Transform',
          label: 'Transform',
        },
      ],
    };
  }
}
