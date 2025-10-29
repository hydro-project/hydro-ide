/**
 * OperatorRegistry - Centralized operator classification and metadata service
 *
 * This service provides a single source of truth for Hydro operator metadata,
 * including classification, type inference, and validation logic. It replaces
 * scattered operator knowledge throughout the codebase with a centralized registry.
 *
 * Key responsibilities:
 * - Classify operators by category (networking, source, sink, etc.)
 * - Infer node types for graph visualization
 * - Validate operators against return types
 * - Provide location type utilities
 *
 * Design decisions:
 * - Singleton pattern for global access
 * - Configuration-driven (reads from VS Code settings)
 * - Fallback defaults for test environments
 * - Pure functions for easy testing
 */

/**
 * Node type for graph visualization
 * Maps to visual appearance in Hydroscope
 */
export type NodeType =
  | 'Source'
  | 'Sink'
  | 'Transform'
  | 'Join'
  | 'Network'
  | 'Aggregation'
  | 'Tee';

/**
 * Operator configuration structure
 * Loaded from VS Code settings or defaults
 */
export interface OperatorConfig {
  /** Operators that handle network communication between locations */
  networkingOperators: string[];
  /** Core dataflow transformation and collection operators */
  coreDataflowOperators: string[];
  /** Operators that consume live collections (return unit type) */
  sinkOperators: string[];
  /** Hydro collection type prefixes (Stream<, Singleton<, etc.) */
  collectionTypes: string[];
}

/**
 * OperatorRegistry - Centralized operator classification and metadata
 *
 * Singleton service that provides operator classification, type inference,
 * and validation for Hydro dataflow operators.
 *
 * Usage:
 * ```typescript
 * const registry = OperatorRegistry.getInstance();
 * if (registry.isNetworkingOperator('send_bincode')) {
 *   const nodeType = registry.inferNodeType('send_bincode'); // 'Network'
 * }
 * ```
 */
export class OperatorRegistry {
  private static instance: OperatorRegistry | null = null;
  private config: OperatorConfig;

  /**
   * Private constructor - use getInstance() to access
   */
  private constructor(config?: OperatorConfig) {
    this.config = config || this.loadDefaultConfig();
  }

  /**
   * Get singleton instance of OperatorRegistry
   *
   * @param config Optional config override (useful for testing)
   * @returns Singleton instance
   */
  public static getInstance(config?: OperatorConfig): OperatorRegistry {
    if (!OperatorRegistry.instance) {
      OperatorRegistry.instance = new OperatorRegistry(config);
    } else if (config) {
      // Allow config override for testing
      OperatorRegistry.instance.config = config;
    }
    return OperatorRegistry.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  public static resetInstance(): void {
    OperatorRegistry.instance = null;
  }

  /**
   * Load operator configuration from VS Code settings
   *
   * Reads from hydroIde.operators.* settings with fallback to defaults.
   * In test environments without VS Code, returns package.json defaults.
   *
   * @returns Operator configuration
   */
  private loadDefaultConfig(): OperatorConfig {
    try {
      // Try to dynamically import vscode (only available in extension context)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscode = require('vscode');
      const config = vscode.workspace.getConfiguration('hydroIde.operators');
      return {
        networkingOperators: (config.get('networkingOperators') as string[]) || [],
        coreDataflowOperators: (config.get('coreDataflowOperators') as string[]) || [],
        sinkOperators: (config.get('sinkOperators') as string[]) || [],
        collectionTypes: (config.get('collectionTypes') as string[]) || [],
      };
    } catch {
      // Fallback for unit test environment (package.json defaults)
      return this.getPackageJsonDefaults();
    }
  }

  /**
   * Get default operator configuration from package.json
   *
   * This is the canonical source of truth for operator definitions,
   * matching the defaults in package.json contributes section.
   *
   * @returns Default operator configuration
   */
  private getPackageJsonDefaults(): OperatorConfig {
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

  /**
   * Check if an operator is a networking operator
   *
   * Networking operators are essential parts of Hydro distributed dataflow pipelines
   * that handle communication between different locations (processes, clusters).
   *
   * @param operatorName Name of the operator (e.g., 'send_bincode')
   * @returns true if operator handles network communication
   */
  public isNetworkingOperator(operatorName: string): boolean {
    return this.config.networkingOperators.includes(operatorName);
  }

  /**
   * Check if an operator is a known dataflow operator based on its name
   *
   * This is based on the canonical HydroNode IR definitions and actual operator
   * implementations in the Hydro codebase. Includes both core dataflow operators
   * and networking operators that are essential parts of distributed pipelines.
   *
   * @param operatorName Name of the operator
   * @returns true if operator is known dataflow operator
   */
  public isKnownDataflowOperator(operatorName: string): boolean {
    // Check networking operators first
    if (this.isNetworkingOperator(operatorName)) {
      return true;
    }

    // Check core dataflow operators from configuration
    return this.config.coreDataflowOperators.includes(operatorName);
  }

  /**
   * Check if an operator is a sink operator that consumes live collections
   *
   * Sink operators are identified by their signature:
   * - Return unit type ()
   * - Take a live collection as self parameter
   *
   * This method uses the configuration to identify known sink operators.
   *
   * @param operatorName Name of the operator
   * @returns true if operator is a sink
   */
  public isSinkOperator(operatorName: string): boolean {
    return this.config.sinkOperators.includes(operatorName);
  }

  /**
   * Validate if an operator is a valid dataflow operator given its return type
   *
   * Performs semantic validation based on operator name and return type:
   * - Accepts operators returning live collection types (Stream<, Singleton<, etc.)
   * - Accepts sink operators returning unit type ()
   * - Accepts networking operators even with incomplete type info
   * - Rejects pure infrastructure operators (only location types)
   *
   * @param operatorName Name of the operator
   * @param returnType Return type from LSP (may be null)
   * @returns true if operator is valid dataflow operator
   */
  public isValidDataflowOperator(operatorName: string, returnType: string | null): boolean {
    // If no return type available, use name-based heuristics for known dataflow operators
    if (!returnType) {
      return this.isKnownDataflowOperator(operatorName);
    }

    // Accept operators that return live collection types (canonical Hydro collections)
    // This includes networking operators like broadcast_bincode that return Stream<T, Cluster<...>, ...>
    if (this.config.collectionTypes.some((collectionType: string) => returnType.includes(collectionType))) {
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
      this.config.collectionTypes.some((collectionType: string) =>
        returnType.includes(collectionType.replace('<', ''))
      )
    ) {
      return true;
    }

    // Special case: Accept networking operators even if LSP returns incomplete type info
    // These are crucial parts of Hydro distributed dataflow pipelines
    if (this.isNetworkingOperator(operatorName)) {
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
        return true;
      }
      return false;
    }

    // Fallback to name-based heuristics for edge cases
    return this.isKnownDataflowOperator(operatorName);
  }

  /**
   * Infer node type for graph visualization based on operator name
   *
   * Categorizes operators into visual node types for Hydroscope rendering:
   * - Source: produces data (source_iter, recv_stream, etc.)
   * - Sink: consumes data (for_each, dest_sink, etc.)
   * - Join: combines streams (join, cross_product, etc.)
   * - Network: network communication (send_bincode, broadcast_bincode, etc.)
   * - Aggregation: reduce operations (fold, reduce, etc.)
   * - Tee: splits/persists streams (tee, persist, clone)
   * - Transform: default for other operators (map, filter, etc.)
   *
   * @param operatorName Name of the operator
   * @returns Node type for visualization
   */
  public inferNodeType(operatorName: string): NodeType {
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
   * Extract location type from location kind string
   *
   * Strips Tick<> wrappers and extracts the base location type (Process, Cluster, External).
   *
   * Examples:
   * - "Process<Leader>" -> "Process"
   * - "Tick<Cluster<Worker>>" -> "Cluster"
   * - "Tick<Tick<Process<Node>>>" -> "Process"
   *
   * @param locationKind The location kind string
   * @returns Location type string or null if not recognized
   */
  public getLocationType(locationKind: string): string | null {
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
   * Infer default location based on operator name
   *
   * Some operators have implicit location semantics that can be inferred
   * from their names. This is a heuristic for cases where LSP doesn't
   * provide complete type information.
   *
   * @param operatorName Name of the operator
   * @returns Default location string or null
   */
  public inferDefaultLocation(operatorName: string): string | null {
    // Networking operators might have implicit locations
    if (this.isNetworkingOperator(operatorName)) {
      // Most networking operators don't have a single default location
      // as they operate across locations
      return null;
    }

    // Source/sink operators are typically local to a single process
    if (
      /^(source_iter|source_stream|source_stdin|dest_sink|for_each|dest_file)$/.test(operatorName)
    ) {
      return 'Process'; // Generic process location
    }

    return null;
  }

  /**
   * Get current operator configuration
   *
   * Useful for debugging and inspection.
   *
   * @returns Current operator configuration
   */
  public getConfig(): OperatorConfig {
    return { ...this.config }; // Return copy to prevent mutation
  }

  /**
   * Update operator configuration
   *
   * Allows runtime configuration updates (useful for testing or dynamic config).
   *
   * @param config New operator configuration
   */
  public updateConfig(config: Partial<OperatorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }
}
