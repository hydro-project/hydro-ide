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
    backtrace: [];
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
    this.log(`Extracting graph for ${document.fileName} (scope: ${scopeTarget.type})`);

    // Check cache first
    const cacheKey = this.getCacheKey(document, scopeTarget);
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // Extract location information using LocationAnalyzer
    const locations = await locationAnalyzer.analyzeDocument(document);
    this.log(`Found ${locations.length} location-typed operators`);

    // Extract nodes from operators
    const nodes = await this.extractNodes(document, locations, scopeTarget);
    this.log(`Extracted ${nodes.length} nodes`);

    // Extract edges by analyzing dataflow chains
    const edges = await this.extractEdges(document, nodes, locations);
    this.log(`Extracted ${edges.length} edges`);

    // Build location hierarchy
    const hierarchyData = this.buildLocationHierarchy(nodes);

    // Assemble final JSON
    const json = this.assembleHydroscopeJson(nodes, edges, hierarchyData);

    // Debug: Save JSON to disk for inspection
    await this.saveDebugJson(json, document, scopeTarget);

    // Cache result
    this.setCached(cacheKey, json);

    return json;
  }

  /**
   * Extract nodes from Hydro operators
   *
   * Uses LocationAnalyzer results to find operators and queries rust-analyzer
   * for full type information at each operator position.
   *
   * Implements degraded mode operation:
   * - Handles null/undefined responses gracefully
   * - Uses default node type (Transform) when inference fails
   * - Creates nodes even with incomplete location info
   * - Logs warnings for degraded mode operation
   *
   * Requirements addressed:
   * - 6.2: Handle null/undefined responses from rust-analyzer gracefully
   * - 6.3: Use default node type (Transform) when inference fails
   * - 6.4: Create basic hierarchy even with incomplete location info
   * - 6.5: Log warnings for degraded mode operation
   *
   * @param document The document being analyzed
   * @param locations Location information from LocationAnalyzer
   * @param scopeTarget The scope target for filtering
   * @returns Promise resolving to array of nodes
   */
  private async extractNodes(
    document: vscode.TextDocument,
    locations: LocationInfo[],
    scopeTarget: ScopeTarget
  ): Promise<Node[]> {
    const nodes: Node[] = [];
    let nodeIdCounter = 0;
    let degradedModeCount = 0;

    // Check if degraded mode is enabled
    const config = vscode.workspace.getConfiguration('hydro-ide');
    const enableDegradedMode = config.get<boolean>('lsp.enableDegradedMode', true);

    // Filter locations to scope boundaries
    const scopedLocations = this.filterToScope(locations, scopeTarget, document);
    this.log(`Filtered to ${scopedLocations.length} identifiers in scope`);

    // Filter to only operators (method calls), not variables
    const operatorLocations = scopedLocations.filter((loc) => this.isOperatorCall(document, loc));
    this.log(`Filtered to ${operatorLocations.length} operators (excluding variables)`);

    for (const location of operatorLocations) {
      try {
        // Extract operator details
        const operatorName = location.operatorName || 'unknown';

        // Infer node type - use Transform as default if inference fails
        let nodeType: NodeType;
        try {
          nodeType = this.inferNodeType(operatorName);
        } catch (error) {
          if (enableDegradedMode) {
            nodeType = 'Transform'; // Default fallback
            degradedModeCount++;
            this.log(
              `WARNING: Node type inference failed for '${operatorName}', using default 'Transform'`
            );
          } else {
            throw error;
          }
        }

        const shortLabel = operatorName;

        // Extract full label - use short label as fallback
        let fullLabel: string;
        try {
          fullLabel = this.extractFullLabel(document, location.range);
        } catch (error) {
          if (enableDegradedMode) {
            fullLabel = shortLabel;
            degradedModeCount++;
            this.log(
              `WARNING: Full label extraction failed for '${operatorName}', using short label`
            );
          } else {
            throw error;
          }
        }

        // Extract location information - use null as fallback
        let locationId: number | null;
        let locationType: string | null;
        try {
          locationId = this.getLocationId(location.locationKind);
          locationType = this.getLocationType(location.locationKind);
        } catch (error) {
          if (enableDegradedMode) {
            locationId = null;
            locationType = null;
            degradedModeCount++;
            this.log(
              `WARNING: Location info extraction failed for '${operatorName}', using null values`
            );
          } else {
            throw error;
          }
        }

        nodes.push({
          id: String(nodeIdCounter++),
          nodeType,
          shortLabel,
          fullLabel,
          label: shortLabel, // Default to short
          data: {
            locationId,
            locationType,
            locationKind: location.locationKind || undefined, // Store original for hierarchy labels
            backtrace: [], // Empty for LSP path
          },
        });
      } catch (error) {
        // Log error but continue processing other operators if degraded mode is enabled
        if (error instanceof Error) {
          this.log(
            `WARNING: Error extracting node for operator '${location.operatorName}': ${error.message}`
          );
        } else {
          this.log(`WARNING: Unknown error extracting node: ${String(error)}`);
        }

        if (!enableDegradedMode) {
          throw error;
        }
        // In degraded mode, skip this node and continue
        continue;
      }
    }

    // Log degraded mode summary
    if (degradedModeCount > 0) {
      this.log(
        `DEGRADED MODE: Extracted ${nodes.length} nodes with ${degradedModeCount} fallback values`
      );
    }

    return nodes;
  }

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
  private async extractEdges(
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
      const lineText = document.lineAt(loc.range.start.line).text;
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
        // Look backwards from the operator position to find the variable
        // Check current line first
        const beforeOperator = lineText.substring(0, loc.range.start.character);

        // Check each known variable name
        for (const varName of varNames) {
          // Pattern: varname.operator or varname .operator (with whitespace)
          const pattern = new RegExp(`\\b${varName}\\s*\\.\\s*$`);
          if (pattern.test(beforeOperator)) {
            consumedVariable = varName;
            break;
          }
        }

        // If not found on current line, check if previous line ends with a variable name
        // This handles multi-line chains like:
        //   let x = varname
        //       .operator()
        if (!consumedVariable && loc.range.start.line > 0) {
          const prevLineText = document.lineAt(loc.range.start.line - 1).text.trim();

          for (const varName of varNames) {
            // Check if previous line is just the variable name or ends with variable name
            if (
              prevLineText === varName ||
              prevLineText.endsWith(` ${varName}`) ||
              prevLineText.endsWith(`=${varName}`)
            ) {
              consumedVariable = varName;
              break;
            }
          }
        }
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
    // Match by line and operator name
    for (const loc of locations) {
      if (loc.range.start.line === tsOp.line && loc.operatorName === tsOp.name) {
        const key = `${loc.range.start.line}:${loc.range.start.character}`;
        const node = locationToNode.get(key);

        if (!node) {
          this.log(
            `[findOperatorInfo] No node found for key ${key} (${tsOp.name} at line ${tsOp.line})`
          );
          continue;
        }

        const returnType = loc.fullReturnType || null;

        // Skip location constructors (they don't produce dataflow)
        // Only include Hydro dataflow operators
        if (returnType && !this.isValidDataflowOperator(tsOp.name, returnType)) {
          this.log(
            `[findOperatorInfo] Filtered out ${tsOp.name} at line ${tsOp.line} - non-dataflow type: ${returnType}`
          );
          continue;
        }
        
        // If no return type is available, log it but allow the operator through
        if (!returnType) {
          this.log(
            `[findOperatorInfo] WARNING: ${tsOp.name} at line ${tsOp.line} has no return type information - including anyway`
          );
        }

        return {
          name: loc.operatorName,
          range: loc.range,
          returnType,
          locationInfo: loc,
          nodeId: node.id,
        };
      }
    }

    this.log(`[findOperatorInfo] No matching location found for ${tsOp.name} at line ${tsOp.line}`);
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
            this.log(`[buildOperatorChains] Filtered out ${loc.operatorName} - not a dataflow operator (return type: ${returnType})`);
            continue;
          }
          
          // If no return type is available, log it but allow the operator through
          // This handles cases where LSP isn't ready yet or type info is unavailable
          if (!returnType) {
            this.log(`[buildOperatorChains] WARNING: ${loc.operatorName} has no return type information - including anyway`);
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
      // Collection type (Stream, Singleton, Optional)
      if (returnType.includes('Stream<')) {
        tags.push('Stream');
      } else if (returnType.includes('Singleton<')) {
        tags.push('Singleton');
      } else if (returnType.includes('Optional<')) {
        tags.push('Optional');
      } else {
        // Default to Stream if not specified
        tags.push('Stream');
        usedDefaults = true;
      }

      // Boundedness (Bounded, Unbounded)
      if (returnType.includes('Bounded')) {
        tags.push('Bounded');
      } else if (returnType.includes('Unbounded')) {
        tags.push('Unbounded');
      } else {
        // Default to Unbounded
        tags.push('Unbounded');
        usedDefaults = true;
      }

      // Ordering (TotalOrder, NoOrder)
      if (returnType.includes('TotalOrder')) {
        tags.push('TotalOrder');
      } else if (returnType.includes('NoOrder')) {
        tags.push('NoOrder');
      } else {
        // Default to NoOrder
        tags.push('NoOrder');
        usedDefaults = true;
      }

      // Keyedness (Keyed, NotKeyed)
      if (returnType.includes('Keyed')) {
        tags.push('Keyed');
      } else {
        // Default to NotKeyed
        tags.push('NotKeyed');
        usedDefaults = true;
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
  private buildLocationHierarchy(nodes: Node[]): HierarchyData {
    // Group nodes by their location
    // We use locationId as the grouping key since it's derived from locationKind
    // which includes the type parameter (e.g., "Process<Leader>" vs "Process<Follower>")
    const locationGroups = new Map<string, { nodes: Node[]; locationKind: string | null }>();
    let nodesWithoutLocation = 0;

    for (const node of nodes) {
      try {
        // Create a unique key for this location
        // Format: "locationType_locationId" (e.g., "Process_12345", "Cluster_67890")
        const locationType = node.data.locationType || 'Unknown';
        const locationId = node.data.locationId !== null ? node.data.locationId : -1;
        const locationKey = `${locationType}_${locationId}`;

        // Track nodes without proper location info
        if (locationType === 'Unknown' || locationId === -1) {
          nodesWithoutLocation++;
        }

        if (!locationGroups.has(locationKey)) {
          locationGroups.set(locationKey, {
            nodes: [],
            locationKind: node.data.locationKind || null,
          });
        }
        locationGroups.get(locationKey)!.nodes.push(node);
      } catch (error) {
        // Handle errors gracefully in degraded mode
        this.log(
          `WARNING: Error grouping node ${node.id}, will assign to default container (degraded mode)`
        );
        nodesWithoutLocation++;

        // Add to a special error group
        const errorKey = 'Unknown_-1';
        if (!locationGroups.has(errorKey)) {
          locationGroups.set(errorKey, {
            nodes: [],
            locationKind: null,
          });
        }
        locationGroups.get(errorKey)!.nodes.push(node);
      }
    }

    this.log(`Grouped nodes into ${locationGroups.size} location containers`);
    if (nodesWithoutLocation > 0) {
      this.log(
        `WARNING: ${nodesWithoutLocation} nodes without complete location information (degraded mode)`
      );
    }

    // Build hierarchy containers
    const children: HierarchyContainer[] = [];
    const nodeAssignments: Record<string, string> = {};
    let containerIdCounter = 0;

    for (const [_locationKey, group] of locationGroups) {
      try {
        // Generate unique container ID (loc_0, loc_1, etc.)
        const containerId = `loc_${containerIdCounter++}`;

        // Extract location label from locationKind
        // This extracts type parameter names (e.g., "Leader", "Worker", "Proposer")
        const containerName = this.extractLocationLabel(group.locationKind);

        // Create hierarchy container with flat structure (no nested children)
        children.push({
          id: containerId,
          name: containerName,
          children: [], // Flat hierarchy - no nested containers
        });

        // Assign all nodes in this location to the container
        for (const node of group.nodes) {
          nodeAssignments[node.id] = containerId;
        }

        this.log(
          `Created container '${containerId}' (${containerName}) with ${group.nodes.length} nodes`
        );
      } catch (error) {
        // Log error but continue with other containers
        this.log(`WARNING: Error creating container for location group (degraded mode)`);
      }
    }

    // Handle nodes without location information (assign to default container)
    // This addresses requirement 3.5 and degraded mode requirement 6.4
    const unassignedNodes = nodes.filter((node) => !(node.id in nodeAssignments));
    if (unassignedNodes.length > 0) {
      const defaultContainerId = `loc_${containerIdCounter++}`;
      children.push({
        id: defaultContainerId,
        name: '(unknown location)',
        children: [],
      });

      for (const node of unassignedNodes) {
        nodeAssignments[node.id] = defaultContainerId;
      }

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
    const hierarchyChoices: Hierarchy[] = [
      {
        id: 'location',
        name: 'Location',
        children,
      },
    ];

    return {
      hierarchyChoices,
      nodeAssignments: {
        location: nodeAssignments,
      },
      selectedHierarchy: 'location',
    };
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
      /^(send_bincode|broadcast_bincode|send_bytes|broadcast_bytes|network)$/.test(operatorName)
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
   *
   * This is the authoritative filtering based on actual return types from LSP.
   */
  private isValidDataflowOperator(operatorName: string, returnType: string): boolean {
    // Accept operators that return live collection types
    if (
      returnType.includes('Stream') ||
      returnType.includes('Singleton') ||
      returnType.includes('Optional') ||
      returnType.includes('KeyedStream') ||
      returnType.includes('KeyedSingleton')
    ) {
      return true;
    }

    // Accept sink operators that return unit type ()
    if (returnType.includes('()') && this.isSinkOperator(operatorName)) {
      return true;
    }

    return false;
  }

  /**
   * Check if an operator is a sink operator that consumes live collections
   * 
   * Sink operators are identified by their signature:
   * - Return unit type ()
   * - Take a live collection as self parameter
   * 
   * This method works with return types from LSP, which should have already
   * been validated by the LocationAnalyzer using full signature analysis.
   */
  private isSinkOperator(_operatorName: string): boolean {
    // In the LSP integration context, we rely on the LocationAnalyzer
    // to have already done the signature-based filtering. If an operator
    // with return type () made it this far, it's likely a valid sink operator.
    // 
    // We could add additional validation here, but the LocationAnalyzer
    // should have already done the heavy lifting of signature analysis.
    return true; // Trust the LocationAnalyzer's signature-based filtering
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

    // Log assembly statistics
    this.log(`Assembling Hydroscope JSON: ${nodes.length} nodes, ${edges.length} edges`);

    // Combine all components into Hydroscope JSON structure
    const json: HydroscopeJson = {
      // Core graph structure
      nodes,
      edges,

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

  /**
   * Check if a LocationInfo represents an operator call (method call) vs a variable
   *
   * Operators are method calls like `.map(...)` or `.filter(...)`
   * Variables are bindings like `let words = ...` or `let process = ...`
   *
   * We check if the identifier is preceded by a dot (method call) or followed by `(`
   *
   * NOTE: This is ONLY used by LSPGraphExtractor for filtering nodes.
   * The colorizer should still color ALL identifiers (variables and operators).
   *
   * @param document The document
   * @param location The location info to check
   * @returns True if this is an operator call
   */
  private isOperatorCall(document: vscode.TextDocument, location: LocationInfo): boolean {
    const line = document.lineAt(location.range.start.line);
    const text = line.text;
    const startChar = location.range.start.character;
    const endChar = location.range.end.character;

    // Debug logging for problematic cases
    const identifier = text.substring(startChar, endChar);
    if (identifier === 'process' || identifier === 'cluster') {
      this.log(
        `[isOperatorCall] Checking '${identifier}' at line ${location.range.start.line + 1}, chars ${startChar}-${endChar}`
      );
      this.log(`[isOperatorCall] Line text: "${text}"`);
      this.log(`[isOperatorCall] Char before: "${startChar > 0 ? text[startChar - 1] : 'N/A'}"`);
      this.log(`[isOperatorCall] Char after: "${endChar < text.length ? text[endChar] : 'N/A'}"`);
    }

    // Check if preceded by a dot (method call like `.map`)
    if (startChar > 0 && text[startChar - 1] === '.') {
      if (identifier === 'process' || identifier === 'cluster') {
        this.log(`[isOperatorCall] '${identifier}' preceded by dot - OPERATOR`);
      }
      return true;
    }

    // Check if followed by `(` (function call like `source_iter(`)
    if (endChar < text.length && text[endChar] === '(') {
      if (identifier === 'process' || identifier === 'cluster') {
        this.log(`[isOperatorCall] '${identifier}' followed by ( - OPERATOR`);
      }
      return true;
    }

    // Otherwise it's likely a variable binding
    if (identifier === 'process' || identifier === 'cluster') {
      this.log(`[isOperatorCall] '${identifier}' is variable - NOT OPERATOR`);
    }
    return false;
  }
}
