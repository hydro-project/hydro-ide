/**
 * Unit tests for OperatorRegistry
 *
 * Tests operator classification, type inference, and validation logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OperatorRegistry, type OperatorConfig } from '../analysis/operatorRegistry';

describe('OperatorRegistry', () => {
  // Reset singleton between tests
  beforeEach(() => {
    OperatorRegistry.resetInstance();
  });

  afterEach(() => {
    OperatorRegistry.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = OperatorRegistry.getInstance();
      const instance2 = OperatorRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('allows config override on getInstance', () => {
      const customConfig: OperatorConfig = {
        networkingOperators: ['custom_send'],
        coreDataflowOperators: ['custom_map'],
        sinkOperators: ['custom_sink'],
        collectionTypes: ['CustomStream<'],
      };

      const registry = OperatorRegistry.getInstance(customConfig);
      expect(registry.isNetworkingOperator('custom_send')).toBe(true);
      expect(registry.isNetworkingOperator('send_bincode')).toBe(false);
    });

    it('resets instance correctly', () => {
      const instance1 = OperatorRegistry.getInstance();
      OperatorRegistry.resetInstance();
      const instance2 = OperatorRegistry.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('isNetworkingOperator', () => {
    it('identifies standard networking operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isNetworkingOperator('send_bincode')).toBe(true);
      expect(registry.isNetworkingOperator('recv_bincode')).toBe(true);
      expect(registry.isNetworkingOperator('broadcast_bincode')).toBe(true);
      expect(registry.isNetworkingOperator('demux_bincode')).toBe(true);
      expect(registry.isNetworkingOperator('round_robin_bincode')).toBe(true);
    });

    it('identifies external networking operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isNetworkingOperator('send_bincode_external')).toBe(true);
      expect(registry.isNetworkingOperator('recv_bincode_external')).toBe(true);
    });

    it('identifies bytes-based networking operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isNetworkingOperator('send_bytes')).toBe(true);
      expect(registry.isNetworkingOperator('recv_bytes')).toBe(true);
      expect(registry.isNetworkingOperator('broadcast_bytes')).toBe(true);
      expect(registry.isNetworkingOperator('demux_bytes')).toBe(true);
    });

    it('identifies connection operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isNetworkingOperator('connect')).toBe(true);
      expect(registry.isNetworkingOperator('disconnect')).toBe(true);
    });

    it('rejects non-networking operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isNetworkingOperator('map')).toBe(false);
      expect(registry.isNetworkingOperator('filter')).toBe(false);
      expect(registry.isNetworkingOperator('fold')).toBe(false);
      expect(registry.isNetworkingOperator('for_each')).toBe(false);
    });
  });

  describe('isKnownDataflowOperator', () => {
    it('identifies core transformation operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isKnownDataflowOperator('map')).toBe(true);
      expect(registry.isKnownDataflowOperator('flat_map')).toBe(true);
      expect(registry.isKnownDataflowOperator('filter')).toBe(true);
      expect(registry.isKnownDataflowOperator('filter_map')).toBe(true);
    });

    it('identifies aggregation operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isKnownDataflowOperator('fold')).toBe(true);
      expect(registry.isKnownDataflowOperator('reduce')).toBe(true);
      expect(registry.isKnownDataflowOperator('fold_keyed')).toBe(true);
      expect(registry.isKnownDataflowOperator('reduce_keyed')).toBe(true);
    });

    it('identifies join operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isKnownDataflowOperator('join')).toBe(true);
      expect(registry.isKnownDataflowOperator('cross_product')).toBe(true);
      expect(registry.isKnownDataflowOperator('anti_join')).toBe(true);
      expect(registry.isKnownDataflowOperator('difference')).toBe(true);
    });

    it('identifies source operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isKnownDataflowOperator('source_iter')).toBe(true);
      expect(registry.isKnownDataflowOperator('source_stream')).toBe(true);
      expect(registry.isKnownDataflowOperator('source_stdin')).toBe(true);
    });

    it('identifies sink operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isKnownDataflowOperator('for_each')).toBe(true);
      expect(registry.isKnownDataflowOperator('dest_sink')).toBe(true);
      expect(registry.isKnownDataflowOperator('assert')).toBe(true);
      expect(registry.isKnownDataflowOperator('dest_file')).toBe(true);
    });

    it('includes networking operators as dataflow operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isKnownDataflowOperator('send_bincode')).toBe(true);
      expect(registry.isKnownDataflowOperator('broadcast_bincode')).toBe(true);
    });

    it('rejects unknown operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isKnownDataflowOperator('unknown_operator')).toBe(false);
      expect(registry.isKnownDataflowOperator('foo_bar_baz')).toBe(false);
    });
  });

  describe('isSinkOperator', () => {
    it('identifies standard sink operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isSinkOperator('for_each')).toBe(true);
      expect(registry.isSinkOperator('dest_sink')).toBe(true);
      expect(registry.isSinkOperator('assert')).toBe(true);
      expect(registry.isSinkOperator('assert_eq')).toBe(true);
      expect(registry.isSinkOperator('dest_file')).toBe(true);
    });

    it('rejects non-sink operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isSinkOperator('map')).toBe(false);
      expect(registry.isSinkOperator('filter')).toBe(false);
      expect(registry.isSinkOperator('send_bincode')).toBe(false);
      expect(registry.isSinkOperator('fold')).toBe(false);
    });
  });

  describe('isValidDataflowOperator', () => {
    it('accepts operators with null return type if they are known', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('map', null)).toBe(true);
      expect(registry.isValidDataflowOperator('send_bincode', null)).toBe(true);
      expect(registry.isValidDataflowOperator('unknown_op', null)).toBe(false);
    });

    it('accepts operators returning Stream<>', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('map', 'Stream<i32, Process<Leader>, Unbounded>')).toBe(true);
      expect(registry.isValidDataflowOperator('filter', 'Stream<String, Cluster<Worker>>')).toBe(true);
    });

    it('accepts operators returning Singleton<>', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('fold', 'Singleton<i32, Process<Leader>>')).toBe(true);
    });

    it('accepts operators returning Optional<>', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('first', 'Optional<String, Process<Node>>')).toBe(true);
    });

    it('accepts operators returning KeyedStream<>', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('into_keyed', 'KeyedStream<String, i32, Process<Leader>>')).toBe(true);
    });

    it('accepts operators returning unit type ()', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('for_each', '()')).toBe(true);
      expect(registry.isValidDataflowOperator('dest_sink', '()')).toBe(true);
      expect(registry.isValidDataflowOperator('collect_vec', '()')).toBe(true);
    });

    it('accepts sink operators with () in return type', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('for_each', 'impl Future<Output = ()>')).toBe(true);
      expect(registry.isValidDataflowOperator('dest_sink', 'Result<(), Error>')).toBe(true);
    });

    it('accepts operators with impl Into<Collection>', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('map', 'impl Into<Stream>')).toBe(true);
      expect(registry.isValidDataflowOperator('filter', 'impl Into<Singleton>')).toBe(true);
    });

    it('accepts networking operators even with incomplete type info', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('send_bincode', 'Process<Leader>')).toBe(true);
      expect(registry.isValidDataflowOperator('broadcast_bincode', 'Cluster<Worker>')).toBe(true);
      expect(registry.isValidDataflowOperator('demux_bincode', 'Tick<Process<Node>>')).toBe(true);
    });

    it('rejects pure infrastructure operators without collections', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('unknown_op', 'Process<Leader>')).toBe(false);
      expect(registry.isValidDataflowOperator('unknown_op', 'Cluster<Worker>')).toBe(false);
      expect(registry.isValidDataflowOperator('unknown_op', 'Tick<Process<Node>>')).toBe(false);
      expect(registry.isValidDataflowOperator('unknown_op', 'Atomic<i32>')).toBe(false);
    });

    it('rejects unknown operators with non-collection types', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isValidDataflowOperator('unknown_op', 'i32')).toBe(false);
      expect(registry.isValidDataflowOperator('unknown_op', 'String')).toBe(false);
      expect(registry.isValidDataflowOperator('unknown_op', 'Vec<i32>')).toBe(false);
    });
  });

  describe('inferNodeType', () => {
    it('infers Source type for source operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferNodeType('source_iter')).toBe('Source');
      expect(registry.inferNodeType('source_stream')).toBe('Source');
      expect(registry.inferNodeType('source_stdin')).toBe('Source');
      expect(registry.inferNodeType('recv_stream')).toBe('Source');
      expect(registry.inferNodeType('recv_bincode')).toBe('Source');
      expect(registry.inferNodeType('recv_bytes')).toBe('Source');
    });

    it('infers Sink type for sink operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferNodeType('dest_sink')).toBe('Sink');
      expect(registry.inferNodeType('for_each')).toBe('Sink');
      expect(registry.inferNodeType('inspect')).toBe('Sink');
      expect(registry.inferNodeType('dest_file')).toBe('Sink');
      expect(registry.inferNodeType('assert')).toBe('Sink');
      expect(registry.inferNodeType('assert_eq')).toBe('Sink');
    });

    it('infers Join type for join operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferNodeType('join')).toBe('Join');
      expect(registry.inferNodeType('cross_product')).toBe('Join');
      expect(registry.inferNodeType('anti_join')).toBe('Join');
      expect(registry.inferNodeType('difference')).toBe('Join');
    });

    it('infers Network type for networking operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferNodeType('send_bincode')).toBe('Network');
      expect(registry.inferNodeType('broadcast_bincode')).toBe('Network');
      expect(registry.inferNodeType('demux_bincode')).toBe('Network');
      expect(registry.inferNodeType('round_robin_bincode')).toBe('Network');
      expect(registry.inferNodeType('send_bytes')).toBe('Network');
      expect(registry.inferNodeType('broadcast_bytes')).toBe('Network');
      expect(registry.inferNodeType('demux_bytes')).toBe('Network');
    });

    it('infers Aggregation type for aggregation operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferNodeType('fold')).toBe('Aggregation');
      expect(registry.inferNodeType('reduce')).toBe('Aggregation');
      expect(registry.inferNodeType('fold_keyed')).toBe('Aggregation');
      expect(registry.inferNodeType('reduce_keyed')).toBe('Aggregation');
      expect(registry.inferNodeType('sort')).toBe('Aggregation');
    });

    it('infers Tee type for tee operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferNodeType('tee')).toBe('Tee');
      expect(registry.inferNodeType('persist')).toBe('Tee');
      expect(registry.inferNodeType('clone')).toBe('Tee');
    });

    it('infers Transform type for other operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferNodeType('map')).toBe('Transform');
      expect(registry.inferNodeType('filter')).toBe('Transform');
      expect(registry.inferNodeType('flat_map')).toBe('Transform');
      expect(registry.inferNodeType('filter_map')).toBe('Transform');
      expect(registry.inferNodeType('unknown_operator')).toBe('Transform');
    });
  });

  describe('getLocationType', () => {
    it('extracts Process location type', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.getLocationType('Process<Leader>')).toBe('Process');
      expect(registry.getLocationType('Process<Worker>')).toBe('Process');
      expect(registry.getLocationType('Process<Node>')).toBe('Process');
    });

    it('extracts Cluster location type', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.getLocationType('Cluster<Leader>')).toBe('Cluster');
      expect(registry.getLocationType('Cluster<Worker>')).toBe('Cluster');
    });

    it('extracts External location type', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.getLocationType('External<Client>')).toBe('External');
    });

    it('strips Tick<> wrappers before extraction', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.getLocationType('Tick<Process<Leader>>')).toBe('Process');
      expect(registry.getLocationType('Tick<Cluster<Worker>>')).toBe('Cluster');
      expect(registry.getLocationType('Tick<External<Client>>')).toBe('External');
    });

    it('strips multiple nested Tick<> wrappers', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.getLocationType('Tick<Tick<Process<Leader>>>')).toBe('Process');
      expect(registry.getLocationType('Tick<Tick<Tick<Cluster<Worker>>>>')).toBe('Cluster');
    });

    it('returns null for unrecognized location types', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.getLocationType('Unknown<Type>')).toBe(null);
      expect(registry.getLocationType('i32')).toBe(null);
      expect(registry.getLocationType('')).toBe(null);
    });
  });

  describe('inferDefaultLocation', () => {
    it('returns null for networking operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferDefaultLocation('send_bincode')).toBe(null);
      expect(registry.inferDefaultLocation('broadcast_bincode')).toBe(null);
    });

    it('returns Process for source operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferDefaultLocation('source_iter')).toBe('Process');
      expect(registry.inferDefaultLocation('source_stream')).toBe('Process');
      expect(registry.inferDefaultLocation('source_stdin')).toBe('Process');
    });

    it('returns Process for sink operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferDefaultLocation('for_each')).toBe('Process');
      expect(registry.inferDefaultLocation('dest_sink')).toBe('Process');
      expect(registry.inferDefaultLocation('dest_file')).toBe('Process');
    });

    it('returns null for transformation operators', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.inferDefaultLocation('map')).toBe(null);
      expect(registry.inferDefaultLocation('filter')).toBe(null);
      expect(registry.inferDefaultLocation('fold')).toBe(null);
    });
  });

  describe('getConfig and updateConfig', () => {
    it('returns copy of current config', () => {
      const registry = OperatorRegistry.getInstance();
      const config1 = registry.getConfig();
      const config2 = registry.getConfig();
      
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });

    it('allows config updates', () => {
      const registry = OperatorRegistry.getInstance();
      
      expect(registry.isNetworkingOperator('custom_send')).toBe(false);
      
      registry.updateConfig({
        networkingOperators: ['custom_send'],
      });
      
      expect(registry.isNetworkingOperator('custom_send')).toBe(true);
    });

    it('merges partial config updates', () => {
      const registry = OperatorRegistry.getInstance();
      
      const originalConfig = registry.getConfig();
      const originalCoreOps = originalConfig.coreDataflowOperators;
      
      registry.updateConfig({
        networkingOperators: ['custom_send'],
      });
      
      const updatedConfig = registry.getConfig();
      expect(updatedConfig.networkingOperators).toEqual(['custom_send']);
      expect(updatedConfig.coreDataflowOperators).toEqual(originalCoreOps); // Unchanged
    });
  });
});
