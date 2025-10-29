/**
 * LSP Graph Extractor - Fast Hydroscope Visualization Generator
 *
 * **Purpose:** Generate complete Hydroscope JSON visualization without Cargo compilation.
 *
 * **Not related to location colorization:** This is separate from locationAnalyzer/GraphExtractor
 * (which colorize location types in the editor). This class generates full graph visualizations.
 *
 * **Architecture:**
 * This is the "fast path" for visualization — uses tree-sitter for operator structure
 * with optional LSP enhancement for type information. Produces the same Hydroscope JSON
 * format as the Cargo-based path, but without runtime backtraces.
 *
 * **Services used:**
 * - TreeSitterRustParser: Parse Rust AST, find operator chains
 * - GraphBuilder: Create nodes and edges from operators
 * - EdgeAnalyzer: Add network semantic tags to edges
 * - HierarchyBuilder: Build location + code hierarchies
 * - OperatorRegistry: Classify operators by type
 *
 * **Output:** Complete HydroscopeJson ready for rendering
 *
 * **Advantages:**
 * - ⚡ Fast (1-2 seconds, no compilation)
 * - 🔄 Instant feedback during development
 * - 💾 Cached for subsequent visualizations
 *
 * **Trade-offs:**
 * - No runtime backtraces (hierarchy based on types, not execution)
 * - LSP enhancement is best-effort (may not have complete type info)
 *
 * @see CargoOrchestrator for the complete visualization path (with runtime info)
 * @see locationAnalyzer.ts for location colorization (different feature)
 * @see ARCHITECTURE.md for complete system architecture
 */

import * as vscode from 'vscode';
import * as locationAnalyzer from './locationAnalyzer';
import { ScopeTarget } from '../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TreeSitterRustParser } from './treeSitterParser';
import { GraphBuilder } from './graphBuilder';
import { OperatorRegistry } from './operatorRegistry';
import { EdgeAnalyzer } from './edgeAnalyzer';
import { HierarchyBuilder } from './hierarchyBuilder';
import type {
  GraphNode,
  GraphEdge,
  HydroscopeJson as CoreHydroscopeJson,
  Hierarchy as CoreHierarchy,
  HierarchyContainer as CoreHierarchyContainer,
  NodeType,
  EdgeStyleConfig,
  NodeTypeConfig,
  Legend,
} from '../core/graphTypes';

// Re-export aliases to maintain existing public API for tests and other modules
export type Node = GraphNode;
export type Edge = GraphEdge;
export type HydroscopeJson = CoreHydroscopeJson;
export type Hierarchy = CoreHierarchy;
export type HierarchyContainer = CoreHierarchyContainer;
export type { NodeType, EdgeStyleConfig, NodeTypeConfig, Legend };

// Types are defined in src/core/graphTypes.ts and re-exported above to avoid drift.

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
  private graphBuilder: GraphBuilder;
  private operatorRegistry: OperatorRegistry;
  private edgeAnalyzer: EdgeAnalyzer;
  private hierarchyBuilder: HierarchyBuilder;

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

    // Initialize services
    this.operatorRegistry = OperatorRegistry.getInstance();
    this.graphBuilder = new GraphBuilder(
      this.treeSitterParser,
      this.operatorRegistry,
      outputChannel
    );
    this.edgeAnalyzer = EdgeAnalyzer.getInstance();
    this.edgeAnalyzer.setLogCallback((msg) => this.log(msg));
    this.hierarchyBuilder = new HierarchyBuilder(this.treeSitterParser);
    this.hierarchyBuilder.setLogCallback((msg) => this.log(msg));

    // Initialize the locationAnalyzer module with the output channel
    locationAnalyzer.initialize(outputChannel);

    this.log('LSPGraphExtractor initialized with tree-sitter parser and GraphBuilder');
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
      const { nodes, edges } = this.graphBuilder.buildFromTreeSitter(document, scopeTarget);
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
      this.graphBuilder.enhanceWithLSP(nodes, locations, document);

      // Step 4: Build hierarchies (Location + Code) using HierarchyBuilder service
      const hierarchyData = this.hierarchyBuilder.buildLocationAndCodeHierarchies(
        document,
        nodes,
        edges
      );

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
    // Create nodes from LSP locations first (these have rich type information)
    const lspNodeIds = new Set<string>();
    
    for (const location of scopedLocations) {
      const returnType = location.fullReturnType || location.locationType;
      
      // Check if this is a valid dataflow operator
      if (!this.operatorRegistry.isValidDataflowOperator(location.operatorName, returnType)) {
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
      if (!this.operatorRegistry.isKnownDataflowOperator(tsOp.name)) {
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
   * NOTE: buildOperatorChains method has been removed - edge creation is now handled by GraphBuilder service
   */

  /**

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
          if (
            returnType &&
            !this.operatorRegistry.isValidDataflowOperator(loc.operatorName, returnType)
          ) {
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

  /**
   * Extract location type from location kind string
   *
   * @param locationKind The location kind (e.g., "Process<Leader>", "Tick<Cluster<Worker>>")
   * @returns Location type string or null
   */

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
  /**
   * Assemble final Hydroscope JSON object
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

    // Analyze and mark network edges using EdgeAnalyzer service
    const analyzedEdges = this.edgeAnalyzer.analyzeNetworkEdges(edges, nodes);

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
