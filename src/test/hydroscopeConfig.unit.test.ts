/**
 * Unit tests for HydroscopeConfig
 *
 * Tests static configuration methods for Hydroscope visualization.
 */

import { describe, it, expect } from 'vitest';
import { HydroscopeConfig } from '../analysis/hydroscopeConfig';

describe('HydroscopeConfig', () => {
  describe('getEdgeStyleConfig', () => {
    it('returns edge style configuration with semantic mappings', () => {
      const config = HydroscopeConfig.getEdgeStyleConfig();

      expect(config).toBeDefined();
      expect(config.note).toBeTruthy();
      expect(config.semanticMappings).toBeDefined();
      expect(config.semanticPriorities).toBeDefined();
    });

    it('includes boundedness group mappings', () => {
      const config = HydroscopeConfig.getEdgeStyleConfig();
      const boundedness = config.semanticMappings.BoundednessGroup;

      expect(boundedness.Bounded).toEqual({ halo: 'none' });
      expect(boundedness.Unbounded).toEqual({ halo: 'light-blue' });
    });

    it('includes collection group mappings', () => {
      const config = HydroscopeConfig.getEdgeStyleConfig();
      const collection = config.semanticMappings.CollectionGroup;

      expect(collection.Stream).toEqual({
        arrowhead: 'triangle-filled',
        'color-token': 'highlight-1',
      });
      expect(collection.Singleton).toEqual({
        arrowhead: 'circle-filled',
        'color-token': 'default',
      });
      expect(collection.Optional).toEqual({
        arrowhead: 'diamond-open',
        'color-token': 'muted',
      });
    });

    it('includes keyedness group mappings', () => {
      const config = HydroscopeConfig.getEdgeStyleConfig();
      const keyedness = config.semanticMappings.KeyednessGroup;

      expect(keyedness.NotKeyed).toEqual({ 'line-style': 'single' });
      expect(keyedness.Keyed).toEqual({ 'line-style': 'hash-marks' });
    });

    it('includes network group mappings', () => {
      const config = HydroscopeConfig.getEdgeStyleConfig();
      const network = config.semanticMappings.NetworkGroup;

      expect(network.Local).toEqual({
        'line-pattern': 'solid',
        animation: 'static',
      });
      expect(network.Network).toEqual({
        'line-pattern': 'dashed',
        animation: 'animated',
      });
    });

    it('includes ordering group mappings', () => {
      const config = HydroscopeConfig.getEdgeStyleConfig();
      const ordering = config.semanticMappings.OrderingGroup;

      expect(ordering.TotalOrder).toEqual({ waviness: 'none' });
      expect(ordering.NoOrder).toEqual({ waviness: 'wavy' });
    });

    it('includes semantic priorities for conflict resolution', () => {
      const config = HydroscopeConfig.getEdgeStyleConfig();
      const priorities = config.semanticPriorities;

      expect(priorities).toHaveLength(4);
      expect(priorities).toContainEqual(['Unbounded', 'Bounded']);
      expect(priorities).toContainEqual(['NoOrder', 'TotalOrder']);
      expect(priorities).toContainEqual(['Keyed', 'NotKeyed']);
      expect(priorities).toContainEqual(['Network', 'Local']);
    });

    it('returns same configuration on multiple calls (pure function)', () => {
      const config1 = HydroscopeConfig.getEdgeStyleConfig();
      const config2 = HydroscopeConfig.getEdgeStyleConfig();

      expect(config1).toEqual(config2);
    });
  });

  describe('getNodeTypeConfig', () => {
    it('returns node type configuration with default and types', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();

      expect(config).toBeDefined();
      expect(config.defaultType).toBe('Transform');
      expect(config.types).toBeDefined();
      expect(config.types).toHaveLength(7);
    });

    it('includes Aggregation node type', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const aggregation = config.types.find((t) => t.id === 'Aggregation');

      expect(aggregation).toBeDefined();
      expect(aggregation?.label).toBe('Aggregation');
      expect(aggregation?.colorIndex).toBe(0);
    });

    it('includes Join node type', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const join = config.types.find((t) => t.id === 'Join');

      expect(join).toBeDefined();
      expect(join?.label).toBe('Join');
      expect(join?.colorIndex).toBe(1);
    });

    it('includes Network node type', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const network = config.types.find((t) => t.id === 'Network');

      expect(network).toBeDefined();
      expect(network?.label).toBe('Network');
      expect(network?.colorIndex).toBe(2);
    });

    it('includes Sink node type', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const sink = config.types.find((t) => t.id === 'Sink');

      expect(sink).toBeDefined();
      expect(sink?.label).toBe('Sink');
      expect(sink?.colorIndex).toBe(3);
    });

    it('includes Source node type', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const source = config.types.find((t) => t.id === 'Source');

      expect(source).toBeDefined();
      expect(source?.label).toBe('Source');
      expect(source?.colorIndex).toBe(4);
    });

    it('includes Tee node type', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const tee = config.types.find((t) => t.id === 'Tee');

      expect(tee).toBeDefined();
      expect(tee?.label).toBe('Tee');
      expect(tee?.colorIndex).toBe(5);
    });

    it('includes Transform node type', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const transform = config.types.find((t) => t.id === 'Transform');

      expect(transform).toBeDefined();
      expect(transform?.label).toBe('Transform');
      expect(transform?.colorIndex).toBe(6);
    });

    it('has unique color indices for all node types', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const colorIndices = config.types.map((t) => t.colorIndex);
      const uniqueIndices = new Set(colorIndices);

      expect(uniqueIndices.size).toBe(colorIndices.length);
    });

    it('has unique IDs for all node types', () => {
      const config = HydroscopeConfig.getNodeTypeConfig();
      const ids = config.types.map((t) => t.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('returns same configuration on multiple calls (pure function)', () => {
      const config1 = HydroscopeConfig.getNodeTypeConfig();
      const config2 = HydroscopeConfig.getNodeTypeConfig();

      expect(config1).toEqual(config2);
    });
  });

  describe('getLegend', () => {
    it('returns legend configuration with title and items', () => {
      const legend = HydroscopeConfig.getLegend();

      expect(legend).toBeDefined();
      expect(legend.title).toBe('Node Types');
      expect(legend.items).toBeDefined();
      expect(legend.items).toHaveLength(7);
    });

    it('includes all node types in legend items', () => {
      const legend = HydroscopeConfig.getLegend();
      const itemTypes = legend.items.map((item) => item.type);

      expect(itemTypes).toContain('Aggregation');
      expect(itemTypes).toContain('Join');
      expect(itemTypes).toContain('Network');
      expect(itemTypes).toContain('Sink');
      expect(itemTypes).toContain('Source');
      expect(itemTypes).toContain('Tee');
      expect(itemTypes).toContain('Transform');
    });

    it('legend items match node type config', () => {
      const legend = HydroscopeConfig.getLegend();
      const nodeConfig = HydroscopeConfig.getNodeTypeConfig();

      // Check that all legend items correspond to node types
      for (const item of legend.items) {
        const nodeType = nodeConfig.types.find((t) => t.id === item.type);
        expect(nodeType).toBeDefined();
        expect(nodeType?.label).toBe(item.label);
      }
    });

    it('returns same configuration on multiple calls (pure function)', () => {
      const legend1 = HydroscopeConfig.getLegend();
      const legend2 = HydroscopeConfig.getLegend();

      expect(legend1).toEqual(legend2);
    });
  });

  describe('getAllConfig', () => {
    it('returns all configuration components', () => {
      const allConfig = HydroscopeConfig.getAllConfig();

      expect(allConfig).toBeDefined();
      expect(allConfig.edgeStyleConfig).toBeDefined();
      expect(allConfig.nodeTypeConfig).toBeDefined();
      expect(allConfig.legend).toBeDefined();
    });

    it('returned components match individual getters', () => {
      const allConfig = HydroscopeConfig.getAllConfig();

      expect(allConfig.edgeStyleConfig).toEqual(HydroscopeConfig.getEdgeStyleConfig());
      expect(allConfig.nodeTypeConfig).toEqual(HydroscopeConfig.getNodeTypeConfig());
      expect(allConfig.legend).toEqual(HydroscopeConfig.getLegend());
    });
  });

  describe('getNodeTypeById', () => {
    it('returns node type for valid ID', () => {
      const aggregation = HydroscopeConfig.getNodeTypeById('Aggregation');

      expect(aggregation).toBeDefined();
      expect(aggregation?.id).toBe('Aggregation');
      expect(aggregation?.label).toBe('Aggregation');
      expect(aggregation?.colorIndex).toBe(0);
    });

    it('returns node type for all valid IDs', () => {
      const ids = ['Aggregation', 'Join', 'Network', 'Sink', 'Source', 'Tee', 'Transform'];

      for (const id of ids) {
        const nodeType = HydroscopeConfig.getNodeTypeById(id);
        expect(nodeType).toBeDefined();
        expect(nodeType?.id).toBe(id);
      }
    });

    it('returns null for invalid ID', () => {
      const invalid = HydroscopeConfig.getNodeTypeById('InvalidType');
      expect(invalid).toBeNull();
    });

    it('returns null for empty string', () => {
      const invalid = HydroscopeConfig.getNodeTypeById('');
      expect(invalid).toBeNull();
    });
  });

  describe('getDefaultNodeType', () => {
    it('returns Transform as default node type', () => {
      const defaultType = HydroscopeConfig.getDefaultNodeType();
      expect(defaultType).toBe('Transform');
    });

    it('default type exists in node type config', () => {
      const defaultType = HydroscopeConfig.getDefaultNodeType();
      const nodeType = HydroscopeConfig.getNodeTypeById(defaultType);

      expect(nodeType).toBeDefined();
    });
  });

  describe('getAllNodeTypeIds', () => {
    it('returns array of all node type IDs', () => {
      const ids = HydroscopeConfig.getAllNodeTypeIds();

      expect(ids).toBeDefined();
      expect(ids).toHaveLength(7);
    });

    it('includes all expected node type IDs', () => {
      const ids = HydroscopeConfig.getAllNodeTypeIds();

      expect(ids).toContain('Aggregation');
      expect(ids).toContain('Join');
      expect(ids).toContain('Network');
      expect(ids).toContain('Sink');
      expect(ids).toContain('Source');
      expect(ids).toContain('Tee');
      expect(ids).toContain('Transform');
    });

    it('returns IDs in same order as types array', () => {
      const ids = HydroscopeConfig.getAllNodeTypeIds();
      const config = HydroscopeConfig.getNodeTypeConfig();
      const expectedIds = config.types.map((t) => t.id);

      expect(ids).toEqual(expectedIds);
    });
  });

  describe('Configuration Consistency', () => {
    it('legend items match node type config exactly', () => {
      const legend = HydroscopeConfig.getLegend();
      const nodeConfig = HydroscopeConfig.getNodeTypeConfig();

      expect(legend.items.length).toBe(nodeConfig.types.length);

      for (let i = 0; i < legend.items.length; i++) {
        expect(legend.items[i].type).toBe(nodeConfig.types[i].id);
        expect(legend.items[i].label).toBe(nodeConfig.types[i].label);
      }
    });

    it('default node type is included in node types', () => {
      const defaultType = HydroscopeConfig.getDefaultNodeType();
      const ids = HydroscopeConfig.getAllNodeTypeIds();

      expect(ids).toContain(defaultType);
    });

    it('all node type IDs can be looked up', () => {
      const ids = HydroscopeConfig.getAllNodeTypeIds();

      for (const id of ids) {
        const nodeType = HydroscopeConfig.getNodeTypeById(id);
        expect(nodeType).toBeDefined();
        expect(nodeType?.id).toBe(id);
      }
    });
  });
});
