/**
 * Unit tests for CacheManager
 *
 * Tests LRU cache implementation with statistics tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CacheManager, createGraphCacheKey, parseGraphCacheKey } from '../analysis/cacheManager';

describe('CacheManager', () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager<string>(3); // Small cache for testing
  });

  describe('Basic Operations', () => {
    it('stores and retrieves values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('returns null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('overwrites existing values', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
    });

    it('handles multiple entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });

    it('checks key existence with has()', () => {
      cache.set('key1', 'value1');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });

    it('returns correct size', () => {
      expect(cache.size()).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
    });
  });

  describe('LRU Eviction', () => {
    it('evicts least recently used entry when at capacity', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Cache is full (3 entries), add a 4th
      cache.set('key4', 'value4');

      // key1 should be evicted (oldest)
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('updates LRU order on get()', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it most recently used
      cache.get('key1');

      // Add key4 - should evict key2 (now oldest)
      cache.set('key4', 'value4');

      expect(cache.get('key1')).toBe('value1'); // Still present
      expect(cache.get('key2')).toBeNull(); // Evicted
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('updates LRU order on set() to existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update key1 (makes it most recently used)
      cache.set('key1', 'value1-updated');

      // Add key4 - should evict key2 (now oldest)
      cache.set('key4', 'value4');

      expect(cache.get('key1')).toBe('value1-updated');
      expect(cache.get('key2')).toBeNull(); // Evicted
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('maintains correct size after evictions', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(3);

      cache.set('key4', 'value4');
      expect(cache.size()).toBe(3); // Still at max

      cache.set('key5', 'value5');
      expect(cache.size()).toBe(3);
    });
  });

  describe('Statistics', () => {
    it('tracks cache hits', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(0);
    });

    it('tracks cache misses', () => {
      cache.get('key1');
      cache.get('key2');

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
    });

    it('calculates hit rate correctly', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // Hit
      cache.get('key2'); // Miss
      cache.get('key1'); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.hitRatePercent).toBe('66.7');
    });

    it('handles zero requests gracefully', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.hitRatePercent).toBe('0.0');
    });

    it('includes cache size in stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.numEntries).toBe(2);
      expect(stats.maxSize).toBe(3);
    });

    it('resets statistics with resetStats()', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key2');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.numEntries).toBe(1); // Entries remain
    });
  });

  describe('Clear Operations', () => {
    beforeEach(() => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
    });

    it('clears specific entry', () => {
      cache.clear('key2');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBe('value3');
      expect(cache.size()).toBe(2);
    });

    it('clears entire cache', () => {
      cache.clear();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBeNull();
      expect(cache.size()).toBe(0);
    });

    it('resets statistics when clearing entire cache', () => {
      cache.get('key1');
      cache.get('nonexistent');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('does not reset statistics when clearing specific entry', () => {
      cache.get('key1');
      cache.get('nonexistent');

      cache.clear('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('Size Management', () => {
    it('respects initial max size', () => {
      expect(cache.getMaxSize()).toBe(3);
    });

    it('updates max size', () => {
      cache.setMaxSize(5);
      expect(cache.getMaxSize()).toBe(5);
    });

    it('evicts entries when reducing max size', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.setMaxSize(2);

      expect(cache.size()).toBe(2);
      expect(cache.get('key1')).toBeNull(); // Evicted (oldest)
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });

    it('allows cache to grow when increasing max size', () => {
      cache.setMaxSize(5);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4');
      cache.set('key5', 'value5');

      expect(cache.size()).toBe(5);
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key5')).toBe('value5');
    });
  });

  describe('Metadata', () => {
    it('stores and retrieves metadata', () => {
      cache.set('key1', 'value1', { version: 5, size: 1024 });

      const metadata = cache.getMetadata('key1');
      expect(metadata).toEqual({ version: 5, size: 1024 });
    });

    it('returns undefined for missing metadata', () => {
      cache.set('key1', 'value1');

      const metadata = cache.getMetadata('key1');
      expect(metadata).toBeUndefined();
    });

    it('returns undefined for nonexistent keys', () => {
      const metadata = cache.getMetadata('nonexistent');
      expect(metadata).toBeUndefined();
    });

    it('stores timestamp automatically', () => {
      const before = Date.now();
      cache.set('key1', 'value1');
      const after = Date.now();

      const timestamp = cache.getTimestamp('key1');
      expect(timestamp).toBeDefined();
      expect(timestamp!).toBeGreaterThanOrEqual(before);
      expect(timestamp!).toBeLessThanOrEqual(after);
    });

    it('returns undefined timestamp for nonexistent keys', () => {
      const timestamp = cache.getTimestamp('nonexistent');
      expect(timestamp).toBeUndefined();
    });
  });

  describe('Key Operations', () => {
    it('returns all keys in LRU order', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const keys = cache.keys();
      expect(keys).toEqual(['key1', 'key2', 'key3']);
    });

    it('updates key order after get()', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.get('key1'); // Move to end

      const keys = cache.keys();
      expect(keys).toEqual(['key2', 'key3', 'key1']);
    });

    it('returns empty array for empty cache', () => {
      const keys = cache.keys();
      expect(keys).toEqual([]);
    });
  });

  describe('Generic Type Support', () => {
    it('works with number values', () => {
      const numCache = new CacheManager<number>();
      numCache.set('key1', 42);
      expect(numCache.get('key1')).toBe(42);
    });

    it('works with object values', () => {
      interface TestData {
        name: string;
        count: number;
      }

      const objCache = new CacheManager<TestData>();
      const data = { name: 'test', count: 5 };
      objCache.set('key1', data);

      expect(objCache.get('key1')).toEqual(data);
    });

    it('works with array values', () => {
      const arrCache = new CacheManager<string[]>();
      arrCache.set('key1', ['a', 'b', 'c']);
      expect(arrCache.get('key1')).toEqual(['a', 'b', 'c']);
    });
  });
});

describe('createGraphCacheKey', () => {
  it('creates cache key with all components', () => {
    const key = createGraphCacheKey('file:///test.rs', 5, 'function', '/path/to/file.rs');
    expect(key).toBe('file:///test.rs::v5::function::/path/to/file.rs');
  });

  it('creates cache key without optional file path', () => {
    const key = createGraphCacheKey('file:///test.rs', 5, 'workspace');
    expect(key).toBe('file:///test.rs::v5::workspace');
  });

  it('handles different scope types', () => {
    const funcKey = createGraphCacheKey('file:///test.rs', 1, 'function');
    const fileKey = createGraphCacheKey('file:///test.rs', 1, 'file');
    const workspaceKey = createGraphCacheKey('file:///test.rs', 1, 'workspace');

    expect(funcKey).toContain('::function');
    expect(fileKey).toContain('::file');
    expect(workspaceKey).toContain('::workspace');
  });

  it('includes version in key', () => {
    const key1 = createGraphCacheKey('file:///test.rs', 1, 'file');
    const key2 = createGraphCacheKey('file:///test.rs', 2, 'file');

    expect(key1).toContain('::v1::');
    expect(key2).toContain('::v2::');
    expect(key1).not.toBe(key2);
  });
});

describe('parseGraphCacheKey', () => {
  it('parses valid cache key with all components', () => {
    const key = 'file:///test.rs::v5::function::/path/to/file.rs';
    const parsed = parseGraphCacheKey(key);

    expect(parsed).toEqual({
      documentUri: 'file:///test.rs',
      documentVersion: 5,
      scopeType: 'function',
      activeFilePath: '/path/to/file.rs',
    });
  });

  it('parses valid cache key without file path', () => {
    const key = 'file:///test.rs::v5::workspace';
    const parsed = parseGraphCacheKey(key);

    expect(parsed).toEqual({
      documentUri: 'file:///test.rs',
      documentVersion: 5,
      scopeType: 'workspace',
      activeFilePath: undefined,
    });
  });

  it('returns null for invalid format (too few parts)', () => {
    const key = 'file:///test.rs::v5';
    const parsed = parseGraphCacheKey(key);

    expect(parsed).toBeNull();
  });

  it('returns null for invalid version format', () => {
    const key = 'file:///test.rs::invalid::workspace';
    const parsed = parseGraphCacheKey(key);

    expect(parsed).toBeNull();
  });

  it('parses keys created by createGraphCacheKey', () => {
    const original = {
      uri: 'file:///test.rs',
      version: 42,
      scope: 'function',
      path: '/some/path.rs',
    };

    const key = createGraphCacheKey(original.uri, original.version, original.scope, original.path);
    const parsed = parseGraphCacheKey(key);

    expect(parsed).toEqual({
      documentUri: original.uri,
      documentVersion: original.version,
      scopeType: original.scope,
      activeFilePath: original.path,
    });
  });
});
