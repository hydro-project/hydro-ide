# Location Colorizer Performance Optimization

## Problem
The original implementation used a "hover everywhere" approach, making one LSP hover request per identifier in the file. For large files like `paxos.rs` (~1000 lines), this resulted in hundreds or thousands of RPCs to rust-analyzer, causing:
- Slow performance
- High latency
- Potential timeouts
- No colorization results despite successful queries

## Solution
Implemented an efficient multi-stage pipeline based on LSP best practices:

### Stage A: Semantic Tokens (Candidate Discovery)
- Single LSP request: `textDocument/semanticTokens`
- Identifies all variables and methods in the file
- Filters candidates to only those that might have Location types
- **Benefit**: Reduces search space from all identifiers to just relevant ones

### Stage B: Inlay Hints (Batch Type Fetching)
- Single LSP request: `textDocument/inlayHint`
- Retrieves type information for let bindings, parameters, and expressions
- Matches hints to candidates by position
- **Benefit**: Gets many types in one batch request

### Stage C: Hover Fallback (Targeted Queries)
- Only for candidates not covered by inlay hints
- Batched in groups of 50 to avoid overwhelming rust-analyzer
- Parallel processing within each batch
- **Benefit**: Minimizes expensive hover requests

### Stage D: Struct Highlighting
- Regex-based search for struct names found in Location types
- No LSP queries needed
- **Benefit**: Extends colorization to type parameters

## Additional Optimizations

### Caching
- File-aware LRU cache with memory-based eviction policy
- No TTL - cache persists indefinitely until memory limit reached
- Cache key: `{uri}:{line}:{character}` (organized by file)
- Memory limit: 10 MB total cache size (~50,000 entries)
- Whole-file eviction: Always removes entire files (LRU), never partial entries
- File-specific cache clearing on save (preserves other files)
- **Benefit**: Eliminates redundant queries when re-colorizing, scales across multiple files, bounded memory usage

### Batching
- Hover requests processed in batches of 50
- Parallel processing within batches using `Promise.all`
- Progress logging for large files
- **Benefit**: Balances throughput with rust-analyzer load

### Smart Fallback
- Gracefully degrades to regex-based scanning if semantic tokens unavailable
- Still uses caching and batching in fallback mode
- **Benefit**: Works even when LSP features are limited

## Performance Comparison

### Before (Hover Everywhere)
- **paxos.rs (965 lines)**: ~500+ hover requests, often timed out
- **Latency**: 5-10+ seconds for medium files
- **Success rate**: Low for large files

### After (Efficient Pipeline)
- **paxos.rs (965 lines)**: 1 semantic tokens + 1 inlay hints + ~50-100 hover requests
- **Latency**: 1-2 seconds for large files
- **Success rate**: High, with progress feedback

## New Commands

1. **Hydro: Colorize Location Types** - Manual trigger for colorization
2. **Hydro: Clear Location Colorizations** - Remove all colorizations
3. **Hydro: Clear Type Cache** - Force fresh type queries

## Configuration

Location colorization is enabled by default and runs automatically when:
- Opening a Rust file
- Switching to a Rust file
- rust-analyzer finishes initial analysis

Disable with: `"hydroIde.locationColoring.enabled": false`

## Cache Architecture

The cache is organized by file with memory-based LRU eviction:

### Memory-Based Eviction
- Tracks total estimated memory usage across all cached files
- 10 MB memory limit (~50,000 entries at ~200 bytes each)
- When limit exceeded, evicts least recently used files until usage drops to 80%
- **Always evicts entire files**, never partial entries (avoids incomplete cache state)

### File-Level Organization
- Each file maintains its own cache entries and `lastAccessed` timestamp
- Accessing any entry in a file updates the file's recency
- Files are sorted by LRU for eviction decisions

### Cache Persistence
- No TTL - entries persist indefinitely
- Only evicted when memory limit exceeded or file saved
- Empty file caches cleaned up automatically

### Benefits
- **No partial file caching**: Either a file is fully cached or not at all
- **Memory-bounded**: Hard limit prevents unbounded growth
- **Efficient multi-file workflows**: Switching between files reuses cache
- **File-specific invalidation**: Saves only clear that file's cache
- **Automatic recency tracking**: Frequently accessed files stay cached longer

## Implementation Details

See `locationColorizer.ts` for the full implementation:
- `scanForLocationTypes()` - Main efficient pipeline
- `extractCandidatesFromTokens()` - Semantic token parsing
- `extractTypesFromInlayHints()` - Inlay hint processing
- `getTypeAtPosition()` - Hover fallback
- `cacheType()` / `getCachedType()` - File-aware LRU cache (no TTL)
- `estimateCacheMemoryUsage()` - Calculate total cache memory usage
- `evictLRUFilesUntilUnderLimit()` - Memory-based whole-file eviction
- `getCacheStats()` - Cache statistics including memory usage for debugging
