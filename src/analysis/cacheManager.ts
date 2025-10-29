/**
 * CacheManager - Generic LRU cache with statistics tracking
 *
 * This service provides a reusable LRU (Least Recently Used) cache implementation
 * with automatic eviction, statistics tracking, and flexible key generation.
 *
 * Key features:
 * - LRU eviction policy to limit memory usage
 * - Hit/miss statistics for performance monitoring
 * - Configurable cache size limits
 * - Selective or complete cache clearing
 * - Generic type support for any cached value
 *
 * Design decisions:
 * - Generic implementation (not specific to graph extraction)
 * - Configurable size via constructor or VS Code settings
 * - Statistics tracking for monitoring cache effectiveness
 * - LRU array for O(1) access order tracking
 */

/**
 * Cache entry structure
 * Stores cached value with metadata
 */
interface CacheEntry<T> {
  /** The cached value */
  value: T;
  /** Timestamp when entry was created */
  timestamp: number;
  /** Optional metadata (version, size, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Cache statistics structure
 */
export interface CacheStats {
  /** Number of entries currently in cache */
  numEntries: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Hit rate as percentage string */
  hitRatePercent: string;
  /** Maximum cache size */
  maxSize: number;
}

/**
 * CacheManager - Generic LRU cache with statistics
 *
 * Implements a Least Recently Used (LRU) cache with automatic eviction
 * when capacity is reached. Tracks hit/miss statistics for monitoring.
 *
 * Usage:
 * ```typescript
 * const cache = new CacheManager<HydroscopeJson>(50);
 * cache.set('key1', graphJson);
 * const result = cache.get('key1'); // Returns graphJson
 * const stats = cache.getStats(); // Get cache statistics
 * ```
 */
export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>>;
  private lruOrder: string[];
  private hits: number;
  private misses: number;
  private maxSize: number;

  /**
   * Create a new cache manager
   *
   * @param maxSize Maximum number of entries (default: 50)
   */
  constructor(maxSize: number = 50) {
    this.cache = new Map();
    this.lruOrder = [];
    this.hits = 0;
    this.misses = 0;
    this.maxSize = maxSize;
  }

  /**
   * Retrieve a value from cache
   *
   * On cache hit:
   * - Updates LRU order (moves to end)
   * - Increments hit counter
   * - Returns cached value
   *
   * On cache miss:
   * - Increments miss counter
   * - Returns null
   *
   * @param key Cache key to lookup
   * @returns Cached value if found, null otherwise
   */
  public get(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry) {
      // Cache hit - update LRU order
      this.updateLRU(key);
      this.hits++;
      return entry.value;
    }

    // Cache miss
    this.misses++;
    return null;
  }

  /**
   * Store a value in cache with LRU eviction
   *
   * If cache is at capacity:
   * - Evicts least recently used entry
   * - Makes room for new entry
   *
   * Updates LRU order after insertion.
   *
   * @param key Cache key to store under
   * @param value Value to cache
   * @param metadata Optional metadata to store with entry
   */
  public set(key: string, value: T, metadata?: Record<string, unknown>): void {
    // LRU eviction: Remove oldest entries if at capacity
    while (this.cache.size >= this.maxSize && this.lruOrder.length > 0) {
      const oldest = this.lruOrder.shift()!;
      this.cache.delete(oldest);
    }

    // Store new entry
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      metadata,
    });

    // Update LRU order
    this.updateLRU(key);
  }

  /**
   * Check if a key exists in cache
   *
   * Note: This does NOT update LRU order or statistics.
   * Use get() if you want LRU semantics.
   *
   * @param key Cache key to check
   * @returns true if key exists in cache
   */
  public has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Clear cache entries
   *
   * @param key Optional specific cache key to clear. If not provided, clears entire cache
   */
  public clear(key?: string): void {
    if (key) {
      // Selective clear
      this.cache.delete(key);
      const idx = this.lruOrder.indexOf(key);
      if (idx >= 0) {
        this.lruOrder.splice(idx, 1);
      }
    } else {
      // Complete clear
      this.cache.clear();
      this.lruOrder.length = 0;
      this.hits = 0;
      this.misses = 0;
    }
  }

  /**
   * Get cache statistics for monitoring and debugging
   *
   * Returns statistics including:
   * - Number of entries
   * - Hit/miss counts
   * - Hit rate (0-1 and percentage)
   * - Maximum size
   *
   * @returns Cache statistics object
   */
  public getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      numEntries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRate,
      hitRatePercent: (hitRate * 100).toFixed(1),
      maxSize: this.maxSize,
    };
  }

  /**
   * Update maximum cache size
   *
   * If new size is smaller than current cache size, evicts
   * oldest entries until cache fits within new limit.
   *
   * @param newMaxSize New maximum cache size
   */
  public setMaxSize(newMaxSize: number): void {
    this.maxSize = newMaxSize;

    // Evict entries if cache is now too large
    while (this.cache.size > this.maxSize && this.lruOrder.length > 0) {
      const oldest = this.lruOrder.shift()!;
      this.cache.delete(oldest);
    }
  }

  /**
   * Get maximum cache size
   *
   * @returns Maximum number of entries
   */
  public getMaxSize(): number {
    return this.maxSize;
  }

  /**
   * Get current cache size (number of entries)
   *
   * @returns Number of entries currently in cache
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * Get all cache keys
   *
   * Returns keys in LRU order (oldest first, newest last).
   *
   * @returns Array of cache keys
   */
  public keys(): string[] {
    return [...this.lruOrder];
  }

  /**
   * Get entry metadata
   *
   * Returns metadata associated with a cached entry, if any.
   *
   * @param key Cache key to lookup
   * @returns Metadata object or undefined
   */
  public getMetadata(key: string): Record<string, unknown> | undefined {
    const entry = this.cache.get(key);
    return entry?.metadata;
  }

  /**
   * Get entry timestamp
   *
   * Returns the timestamp when an entry was created/updated.
   *
   * @param key Cache key to lookup
   * @returns Timestamp in milliseconds or undefined
   */
  public getTimestamp(key: string): number | undefined {
    const entry = this.cache.get(key);
    return entry?.timestamp;
  }

  /**
   * Reset statistics counters
   *
   * Resets hit and miss counters to zero.
   * Does not affect cached entries.
   */
  public resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Update LRU order for a key
   *
   * Removes key from current position and moves to end (most recently used).
   * This is a private helper used by get() and set().
   *
   * @param key Cache key to update
   */
  private updateLRU(key: string): void {
    const idx = this.lruOrder.indexOf(key);
    if (idx >= 0) {
      this.lruOrder.splice(idx, 1);
    }
    this.lruOrder.push(key);
  }
}

/**
 * Create a cache key from document and scope target
 *
 * Helper function for LSP graph extraction cache keys.
 * Encodes:
 * - Document URI
 * - Document version
 * - Scope type (function/file/workspace)
 * - Active file path (for function/file scope)
 *
 * @param documentUri Document URI string
 * @param documentVersion Document version number
 * @param scopeType Scope type
 * @param activeFilePath Optional active file path
 * @returns Cache key string
 */
export function createGraphCacheKey(
  documentUri: string,
  documentVersion: number,
  scopeType: string,
  activeFilePath?: string
): string {
  const parts = [documentUri, `v${documentVersion}`, scopeType];

  if (activeFilePath) {
    parts.push(activeFilePath);
  }

  return parts.join('::');
}

/**
 * Parse a graph cache key into components
 *
 * Inverse of createGraphCacheKey(). Useful for debugging and inspection.
 *
 * @param cacheKey Cache key string
 * @returns Object with parsed components or null if invalid format
 */
export function parseGraphCacheKey(cacheKey: string): {
  documentUri: string;
  documentVersion: number;
  scopeType: string;
  activeFilePath?: string;
} | null {
  const parts = cacheKey.split('::');
  if (parts.length < 3) {
    return null;
  }

  const versionMatch = parts[1].match(/^v(\d+)$/);
  if (!versionMatch) {
    return null;
  }

  return {
    documentUri: parts[0],
    documentVersion: parseInt(versionMatch[1], 10),
    scopeType: parts[2],
    activeFilePath: parts[3],
  };
}
