/**
 * HydroscopeConfig - Centralized static configuration for Hydroscope visualization
 *
 * This service provides configuration data for the Hydroscope graph visualizer,
 * including edge styling rules, node type definitions, and legend configuration.
 * All configuration is static and matches the Hydroscope JSON specification.
 *
 * Key responsibilities:
 * - Provide edge style configuration (semantic mappings, priorities)
 * - Define node type configurations (colors, labels)
 * - Supply legend configuration for visualization
 *
 * Design decisions:
 * - Pure static methods (no state, no singleton needed)
 * - Configuration follows Hydroscope JSON spec
 * - Matches cargo-based visualization format for consistency
 * - Single source of truth for visualization metadata
 */

/**
 * Edge style configuration structure
 * Maps semantic properties to visual styling attributes
 */
export interface EdgeStyleConfig {
  /** Note about edge style system */
  note: string;
  /** Semantic mappings for edge properties */
  semanticMappings: {
    /** Boundedness: Bounded vs Unbounded streams */
    BoundednessGroup: {
      Bounded: {
        halo: string;
      };
      Unbounded: {
        halo: string;
      };
    };
    /** Collection type: Stream, Singleton, Optional */
    CollectionGroup: {
      Stream: {
        arrowhead: string;
        'color-token': string;
      };
      Singleton: {
        arrowhead: string;
        'color-token': string;
      };
      Optional: {
        arrowhead: string;
        'color-token': string;
      };
    };
    /** Keyedness: Keyed vs NotKeyed streams */
    KeyednessGroup: {
      NotKeyed: {
        'line-style': string;
      };
      Keyed: {
        'line-style': string;
      };
    };
    /** Network vs Local: Network edges are dashed and animated */
    NetworkGroup: {
      Local: {
        'line-pattern': string;
        animation: string;
      };
      Network: {
        'line-pattern': string;
        animation: string;
      };
    };
    /** Ordering: TotalOrder vs NoOrder streams */
    OrderingGroup: {
      TotalOrder: {
        waviness: string;
      };
      NoOrder: {
        waviness: string;
      };
    };
  };
  /** Priority order for semantic tags (conflict resolution) */
  semanticPriorities: string[][];
}

/**
 * Node type definition
 */
export interface NodeTypeDef {
  /** Unique type identifier */
  id: string;
  /** Display label */
  label: string;
  /** Color index for visualization (0-6) */
  colorIndex: number;
}

/**
 * Node type configuration structure
 */
export interface NodeTypeConfig {
  /** Default node type when inference fails */
  defaultType: string;
  /** Available node types with styling */
  types: NodeTypeDef[];
}

/**
 * Legend item definition
 */
export interface LegendItem {
  /** Node type identifier */
  type: string;
  /** Display label */
  label: string;
}

/**
 * Legend configuration structure
 */
export interface Legend {
  /** Legend title */
  title: string;
  /** Legend items (node types) */
  items: LegendItem[];
}

/**
 * HydroscopeConfig - Static configuration provider for Hydroscope visualizer
 *
 * Provides all static configuration needed for Hydroscope graph visualization,
 * including edge styles, node types, and legend definitions.
 *
 * Usage:
 * ```typescript
 * const edgeStyles = HydroscopeConfig.getEdgeStyleConfig();
 * const nodeTypes = HydroscopeConfig.getNodeTypeConfig();
 * const legend = HydroscopeConfig.getLegend();
 * ```
 */
export class HydroscopeConfig {
  /**
   * Get edge style configuration for Hydroscope
   *
   * Returns semantic mappings for edge visual properties based on
   * stream characteristics (boundedness, collection type, keyedness,
   * network vs local, ordering).
   *
   * The configuration follows the unified edge style system where each
   * edge can have multiple semantic tags that map to visual attributes.
   * Conflicts are resolved using the semantic priorities array.
   *
   * Visual attributes:
   * - halo: Glow effect (none, light-blue)
   * - arrowhead: Arrow style (triangle-filled, circle-filled, diamond-open)
   * - color-token: Color semantic token (highlight-1, default, muted)
   * - line-style: Line pattern (single, hash-marks)
   * - line-pattern: Dash pattern (solid, dashed)
   * - animation: Animation style (static, animated)
   * - waviness: Line waviness (none, wavy)
   *
   * @returns Edge style configuration object
   */
  public static getEdgeStyleConfig(): EdgeStyleConfig {
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
   * Node types:
   * - Aggregation: Reduce/fold operations (colorIndex: 0)
   * - Join: Multi-stream combiners (colorIndex: 1)
   * - Network: Network communication (colorIndex: 2)
   * - Sink: Data consumers (colorIndex: 3)
   * - Source: Data producers (colorIndex: 4)
   * - Tee: Stream splitters/persisters (colorIndex: 5)
   * - Transform: Default transformations (colorIndex: 6)
   *
   * The configuration follows the Hydroscope JSON specification and matches
   * the format used by cargo-based visualization for consistency.
   *
   * @returns Node type configuration object with type definitions
   */
  public static getNodeTypeConfig(): NodeTypeConfig {
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
   * The legend items are ordered to match the node type configuration
   * for visual consistency in the Hydroscope viewer.
   *
   * The configuration follows the Hydroscope JSON specification and matches
   * the format used by cargo-based visualization for consistency.
   *
   * @returns Legend configuration object
   */
  public static getLegend(): Legend {
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
   * Get all Hydroscope configuration in a single object
   *
   * Convenience method that returns all configuration components
   * (edge styles, node types, legend) in a single object. Useful
   * for passing complete configuration to Hydroscope visualizer.
   *
   * @returns Object containing all Hydroscope configuration
   */
  public static getAllConfig() {
    return {
      edgeStyleConfig: this.getEdgeStyleConfig(),
      nodeTypeConfig: this.getNodeTypeConfig(),
      legend: this.getLegend(),
    };
  }

  /**
   * Get node type by ID
   *
   * Helper method to look up a specific node type definition by its ID.
   * Returns null if the type is not found.
   *
   * @param typeId Node type ID to look up
   * @returns Node type definition or null
   */
  public static getNodeTypeById(typeId: string): NodeTypeDef | null {
    const config = this.getNodeTypeConfig();
    return config.types.find((type) => type.id === typeId) || null;
  }

  /**
   * Get default node type
   *
   * Returns the ID of the default node type used when type inference fails.
   *
   * @returns Default node type ID
   */
  public static getDefaultNodeType(): string {
    return this.getNodeTypeConfig().defaultType;
  }

  /**
   * Get all node type IDs
   *
   * Returns an array of all available node type IDs. Useful for
   * validation and enumeration.
   *
   * @returns Array of node type IDs
   */
  public static getAllNodeTypeIds(): string[] {
    const config = this.getNodeTypeConfig();
    return config.types.map((type) => type.id);
  }
}
