/**
 * Shared graph types for Hydroscope visualization.
 *
 * Centralizes Node/Edge and related JSON schema to avoid drift across services.
 * Services can import these types directly, or narrow them with Pick<> as needed.
 */

export type NodeType =
  | 'Source'
  | 'Transform'
  | 'Sink'
  | 'Join'
  | 'Network'
  | 'Tee'
  | 'Aggregation';

export interface GraphNode {
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

export interface GraphEdge {
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

export interface EdgeStyleConfig {
  [key: string]: unknown;
}

export interface NodeTypeConfig {
  [key: string]: unknown;
}

export interface Legend {
  [key: string]: unknown;
}

export interface HydroscopeJson {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hierarchyChoices: Hierarchy[];
  nodeAssignments: Record<string, Record<string, string>>;
  selectedHierarchy?: string;
  edgeStyleConfig: EdgeStyleConfig;
  nodeTypeConfig: NodeTypeConfig;
  legend: Legend;
}
