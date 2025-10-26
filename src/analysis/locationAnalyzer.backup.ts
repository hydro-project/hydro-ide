/**
 * Location Analyzer
 *
 * Analyzes Rust source code to find identifiers with Hydro Location types.
 * Uses rust-analyzer LSP to query type information.
 */

import * as vscode from 'vscode';

/**
 * Output channel for logging
 */
let outputChannel: vscode.OutputChannel | null = null;

/**
 * Location information extracted from rust-analyzer
 */
export interface LocationInfo {
  /** The Location type (e.g., "Process<'a, P>", "Cluster<'a, C>") */
  locationType: string;
  /** Simplified location identifier (e.g., "Process<Leader>", "Cluster<Worker>") */
  locationKind: string;
  /** Range in the document where this operator appears */
  range: vscode.Range;
  /** The operator name (e.g., "map", "filter", "cross_product") */
  operatorName: string;
}

/**
 * Candidate position for type checking
 */
interface Candidate {
  name: string;
  position: vscode.Position;
  range: vscode.Range;
  isMethodCall: boolean;
}

/**
 * Type cache with memory-based LRU eviction policy
 */
interface CacheEntry {
  type: string | null;
  timestamp: number;
}

interface FileCache {
  entries: Map<string, CacheEntry>;
  lastAccessed: number;
}

const fileCaches = new Map<string, FileCache>();

// Memory-based eviction settings
const ESTIMATED_BYTES_PER_ENTRY = 200; // Rough estimate: key (~50) + type string (~100) + overhead (~50)
const MAX_CACHE_MEMORY_BYTES = 10 * 1024 * 1024; // 10 MB total cache size
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (longer since we're memory-based now)

/**
 * Initialize the analyzer with an output channel
 */
export function initialize(channel?: vscode.OutputChannel): void {
  if (channel) {
    outputChannel = channel;
  }
}

/**
 * Log message to output channel
 */
function log(message: string): void {
  if (outputChannel) {
    outputChannel.appendLine(`[LocationAnalyzer] ${message}`);
  }
}

/**
 * Parse Location type from a full type string, including the second type parameter
 * Examples:
 * - "Stream<T, Process<'a, Leader>, Unbounded>" -> "Process<Leader>"
 * - "KeyedStream<K, V, Cluster<'a, Workers>, Bounded>" -> "Cluster<Workers>"
 * - "Process<'a, Leader>" -> "Process<Leader>"
 */
function parseLocationType(fullType: string): string | null {
  // Match Process<'a, X> or Cluster<'_, X> or External<'a, X>
  // Capture the location kind and the second type parameter
  // The lifetime can be named ('a, 'b) or anonymous ('_)
  const locationMatch = fullType.match(/(Process|Cluster|External)<'[^,>]+,\s*([^>,]+)>/);
  if (locationMatch) {
    const locationKind = locationMatch[1];
    const typeParam = locationMatch[2].trim();
    const result = `${locationKind}<${typeParam}>`;
    log(`Parsed location: ${result} from ${fullType.substring(0, 100)}`);
    return result;
  }

  // Fallback: just the location kind without type parameter
  const simpleMatch = fullType.match(/(Process|Cluster|External)</);
  if (simpleMatch) {
    const result = simpleMatch[1];
    log(`Parsed simple location: ${result} from ${fullType.substring(0, 100)}`);
    return result;
  }

  return null;
}

/**
 * Query rust-analyzer for type information at a specific position
 */
async function getTypeAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string | null> {
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      position
    );

    if (!hovers || hovers.length === 0) {
      return null;
    }

    // Extract type information from hover content
    for (const hover of hovers) {
      for (const content of hover.contents) {
        const contentStr = typeof content === 'string' ? content : content.value;

        if (contentStr) {
          // Extract type from rust code block
          const typeMatch = contentStr.match(/```rust\n([^`]+)\n```/);
          if (typeMatch) {
            return typeMatch[1].trim();
          }
        }
      }
    }

    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`ERROR querying rust-analyzer at line ${position.line}: ${errorMsg}`);
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`);
    }
    return null;
  }
}

/**
 * Get semantic tokens from rust-analyzer
 */
async function getSemanticTokens(
  document: vscode.TextDocument
): Promise<vscode.SemanticTokens | null> {
  try {
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      document.uri
    );
    return tokens || null;
  } catch (error) {
    log(`ERROR getting semantic tokens: ${error}`);
    return null;
  }
}

/**
 * Extract candidates from semantic tokens (variables, parameters, and methods)
 */
function extractCandidatesFromTokens(
  document: vscode.TextDocument,
  tokens: vscode.SemanticTokens
): Candidate[] {
  const candidates: Candidate[] = [];

  // Semantic tokens are encoded as a flat array of integers
  // Each token is 5 integers: [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
  const data = tokens.data;
  let line = 0;
  let char = 0;

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    const length = data[i + 2];
    const tokenType = data[i + 3];

    // Update position
    line += deltaLine;
    if (deltaLine === 0) {
      char += deltaChar;
    } else {
      char = deltaChar;
    }

    // We're interested in variables, parameters, and methods
    // Token types: 7=parameter, 8=variable, 13=method
    const isParameter = tokenType === 7;
    const isVariable = tokenType === 8;
    const isMethod = tokenType === 13;

    if (isParameter || isVariable || isMethod) {
      const position = new vscode.Position(line, char);
      const range = new vscode.Range(line, char, line, char + length);
      const name = document.getText(range);

      // Skip macro invocations (!) and macro names
      if (name === '!' || name.endsWith('!')) {
        continue;
      }

      candidates.push({
        name,
        position,
        range,
        isMethodCall: isMethod,
      });
    }
  }

  return candidates;
}

/**
 * Get file URI from cache key
 */
function getFileUriFromKey(key: string): string {
  // Key format: "{uri}:{line}:{character}"
  const firstColon = key.indexOf(':');
  return firstColon !== -1 ? key.substring(0, firstColon) : key;
}

/**
 * Get position key from cache key (without URI)
 */
function getPositionKeyFromKey(key: string): string {
  // Key format: "{uri}:{line}:{character}"
  const firstColon = key.indexOf(':');
  return firstColon !== -1 ? key.substring(firstColon + 1) : key;
}

/**
 * Get cached type or null if not cached/expired
 */
function getCachedType(key: string): string | null {
  const fileUri = getFileUriFromKey(key);
  const posKey = getPositionKeyFromKey(key);

  const fileCache = fileCaches.get(fileUri);
  if (!fileCache) {
    return null;
  }

  const cached = fileCache.entries.get(posKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    // Update last accessed time for LRU
    fileCache.lastAccessed = Date.now();
    return cached.type;
  }

  // Remove expired entry
  if (cached) {
    fileCache.entries.delete(posKey);
  }

  return null;
}

/**
 * Calculate estimated memory usage of the cache in bytes
 */
function estimateCacheMemoryUsage(): number {
  let totalEntries = 0;
  for (const fileCache of fileCaches.values()) {
    totalEntries += fileCache.entries.size;
  }
  return totalEntries * ESTIMATED_BYTES_PER_ENTRY;
}

/**
 * Cache a type result with memory-based LRU eviction
 */
function cacheType(key: string, type: string | null): void {
  const fileUri = getFileUriFromKey(key);
  const posKey = getPositionKeyFromKey(key);

  // Get or create file cache
  let fileCache = fileCaches.get(fileUri);
  if (!fileCache) {
    fileCache = {
      entries: new Map(),
      lastAccessed: Date.now(),
    };
    fileCaches.set(fileUri, fileCache);
  } else {
    fileCache.lastAccessed = Date.now();
  }

  // Add entry to file cache
  fileCache.entries.set(posKey, { type, timestamp: Date.now() });

  // Check memory usage and evict LRU files if needed
  const memoryUsage = estimateCacheMemoryUsage();
  if (memoryUsage > MAX_CACHE_MEMORY_BYTES) {
    evictLRUFilesUntilUnderLimit();
  }
}

/**
 * Evict LRU files until memory usage is under the limit
 * Always evicts entire files, never partial entries
 */
function evictLRUFilesUntilUnderLimit(): void {
  const targetMemory = MAX_CACHE_MEMORY_BYTES * 0.8; // Evict down to 80% to avoid thrashing
  let currentMemory = estimateCacheMemoryUsage();

  if (currentMemory <= targetMemory) {
    return;
  }

  // Sort files by last accessed time (oldest first)
  const filesByAge = Array.from(fileCaches.entries()).sort(
    (a, b) => a[1].lastAccessed - b[1].lastAccessed
  );

  let evictedFiles = 0;
  let evictedEntries = 0;

  for (const [uri, cache] of filesByAge) {
    if (currentMemory <= targetMemory) {
      break;
    }

    const entriesInFile = cache.entries.size;
    fileCaches.delete(uri);
    evictedFiles++;
    evictedEntries += entriesInFile;
    currentMemory -= entriesInFile * ESTIMATED_BYTES_PER_ENTRY;

    log(`Evicted LRU file: ${uri} (${entriesInFile} entries)`);
  }

  const finalMemoryMB = (currentMemory / (1024 * 1024)).toFixed(2);
  log(
    `Memory-based eviction: removed ${evictedFiles} files (${evictedEntries} entries), now ${finalMemoryMB} MB`
  );
}

/**
 * Clear expired cache entries across all files
 * Removes entire files if all entries are expired
 */
function cleanCache(): void {
  const now = Date.now();
  const filesToRemove: string[] = [];
  let totalExpired = 0;

  for (const [uri, fileCache] of fileCaches.entries()) {
    let expiredInFile = 0;

    for (const [posKey, entry] of fileCache.entries.entries()) {
      if (now - entry.timestamp >= CACHE_TTL_MS) {
        fileCache.entries.delete(posKey);
        expiredInFile++;
      }
    }

    totalExpired += expiredInFile;

    // Mark empty file caches for removal
    if (fileCache.entries.size === 0) {
      filesToRemove.push(uri);
    }
  }

  // Remove empty file caches
  for (const uri of filesToRemove) {
    fileCaches.delete(uri);
  }

  if (totalExpired > 0) {
    log(
      `Cleaned ${totalExpired} expired entries from cache (removed ${filesToRemove.length} empty files)`
    );
  }
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): {
  numFiles: number;
  totalEntries: number;
  estimatedMemoryMB: number;
  fileStats: Array<{ uri: string; entries: number; lastAccessed: Date }>;
} {
  const fileStats = Array.from(fileCaches.entries()).map(([uri, cache]) => ({
    uri,
    entries: cache.entries.size,
    lastAccessed: new Date(cache.lastAccessed),
  }));

  const totalEntries = fileStats.reduce((sum, stat) => sum + stat.entries, 0);
  const estimatedMemoryMB = (estimateCacheMemoryUsage() / (1024 * 1024)).toFixed(2);

  return {
    numFiles: fileCaches.size,
    totalEntries,
    estimatedMemoryMB: parseFloat(estimatedMemoryMB),
    fileStats,
  };
}

/**
 * Clear the type cache
 * Optionally clear cache for a specific file only
 */
export function clearCache(fileUri?: string): void {
  if (fileUri) {
    const fileCache = fileCaches.get(fileUri);
    if (fileCache) {
      log(`Type cache cleared for file: ${fileUri} (${fileCache.entries.size} entries)`);
      fileCaches.delete(fileUri);
    }
  } else {
    const totalEntries = Array.from(fileCaches.values()).reduce(
      (sum, cache) => sum + cache.entries.size,
      0
    );
    log(`Type cache cleared (${fileCaches.size} files, ${totalEntries} total entries)`);
    fileCaches.clear();
  }
}

/**
 * Helper to add location info while avoiding duplicates
 */
function addLocationInfo(
  locationInfos: LocationInfo[],
  seenRanges: Set<string>,
  candidate: Candidate,
  typeInfo: string,
  locationKind: string
): void {
  const rangeKey = `${candidate.range.start.line}:${candidate.range.start.character}`;

  if (seenRanges.has(rangeKey)) {
    return;
  }
  seenRanges.add(rangeKey);

  locationInfos.push({
    locationType: typeInfo,
    locationKind,
    range: candidate.range,
    operatorName: candidate.name,
  });
}

/**
 * Analyze a document to find all identifiers with Location types
 */
export async function analyzeDocument(
  document: vscode.TextDocument
): Promise<LocationInfo[]> {
  const locationInfos: LocationInfo[] = [];
  const seenRanges = new Set<string>();

  cleanCache(); // Clean expired entries

  const cacheStats = getCacheStats();
  log(
    `Cache stats: ${cacheStats.numFiles} files, ${cacheStats.totalEntries} entries, ~${cacheStats.estimatedMemoryMB} MB (current file: ${fileCaches.get(document.uri.toString())?.entries.size || 0})`
  );
  log(`Starting analysis of ${document.lineCount} lines...`);
  const startTime = Date.now();

  // STEP A: Get candidates from semantic tokens
  log('Step A: Getting semantic tokens...');
  const tokens = await getSemanticTokens(document);
  if (!tokens) {
    log('ERROR: No semantic tokens available. rust-analyzer may not be ready yet.');
    log(
      'Please wait for rust-analyzer to finish analyzing, then run "Hydro: Colorize Location Types" manually.'
    );
    return [];
  }

  const candidates = extractCandidatesFromTokens(document, tokens);
  log(`Found ${candidates.length} candidates (parameters + variables + methods)`);

  // Log first few candidates for debugging
  if (candidates.length > 0) {
    const sampleCandidates = candidates
      .slice(0, 10)
      .map((c) => `${c.name}@${c.position.line}:${c.position.character}`)
      .join(', ');
    log(`  Sample candidates: ${sampleCandidates}${candidates.length > 10 ? '...' : ''}`);
  }

  // STEP B: Query hover for each candidate
  log('Step B: Querying types via hover...');

  let cacheHits = 0;
  const candidatesNeedingHover: Candidate[] = [];

  for (const candidate of candidates) {
    const cacheKey = `${document.uri.toString()}:${candidate.position.line}:${candidate.position.character}`;

    // Check cache first
    const cachedType = getCachedType(cacheKey);
    if (cachedType) {
      const locationKind = parseLocationType(cachedType);
      if (locationKind && !locationKind.includes('…')) {
        addLocationInfo(locationInfos, seenRanges, candidate, cachedType, locationKind);
        cacheHits++;
      }
      continue;
    }

    // Need hover query
    candidatesNeedingHover.push(candidate);
  }

  log(`${cacheHits} from cache, ${candidatesNeedingHover.length} need hover queries`);

  // STEP C: Query hover for all remaining candidates (batched)
  if (candidatesNeedingHover.length > 0) {
    log(`Querying hover for ${candidatesNeedingHover.length} candidates...`);

    // Batch hover requests to avoid overwhelming rust-analyzer
    const BATCH_SIZE = 50;
    let hoverMatches = 0;

    for (let i = 0; i < candidatesNeedingHover.length; i += BATCH_SIZE) {
      const batch = candidatesNeedingHover.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const hoverPromises = batch.map(async (candidate) => {
        const cacheKey = `${document.uri.toString()}:${candidate.position.line}:${candidate.position.character}`;

        // Always query at the identifier position
        // For variables/parameters, this gives us the type
        // For methods, this gives us the method signature (we'll parse the return type)
        const queryPos = candidate.position;

        const typeInfo = await getTypeAtPosition(document, queryPos);
        cacheType(cacheKey, typeInfo);

        if (typeInfo) {
          const locationKind = parseLocationType(typeInfo);
          if (locationKind && !locationKind.includes('…')) {
            addLocationInfo(locationInfos, seenRanges, candidate, typeInfo, locationKind);
            return true;
          }
        }
        return false;
      });

      const results = await Promise.all(hoverPromises);
      hoverMatches += results.filter((r) => r).length;

      // Log progress for large files
      if (candidatesNeedingHover.length > 100 && i % 100 === 0) {
        log(`Progress: ${i}/${candidatesNeedingHover.length} hover queries completed`);
      }
    }

    log(`Matched ${hoverMatches} candidates from hover queries`);
  }

  const elapsedMs = Date.now() - startTime;

  // Count unique location types for summary
  const locationCounts = new Map<string, number>();
  locationInfos.forEach((info) => {
    locationCounts.set(info.locationKind, (locationCounts.get(info.locationKind) || 0) + 1);
  });

  const summary = Array.from(locationCounts.entries())
    .map(([loc, count]) => `${loc}: ${count}`)
    .join(', ');

  log(`Analysis completed in ${elapsedMs}ms, found ${locationInfos.length} location-typed identifiers: ${summary}`);

  // STEP D: Find struct definitions for location type parameters
  const structNames = new Set<string>();
  locationInfos.forEach((info) => {
    const structMatch = info.locationKind.match(/<([^>]+)>$/);
    if (structMatch) {
      const structName = structMatch[1].trim();
      if (!structName.includes('…')) {
        structNames.add(structName);
      }
    }
  });

  if (structNames.size > 0) {
    log(`Step D: Finding definitions for struct types: ${Array.from(structNames).join(', ')}`);

    const foundStructs = new Set<string>();

    for (const structName of structNames) {
      // Skip if we already found this struct
      if (foundStructs.has(structName)) {
        continue;
      }

      // Search for the struct definition in the file
      const structDefPattern = new RegExp(`\\bstruct\\s+${structName}\\b`);

      for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
        const line = document.lineAt(lineNum);
        const match = structDefPattern.exec(line.text);

        if (match) {
          // Find the position of the struct name (after "struct ")
          const structKeywordMatch = line.text.match(/\bstruct\s+/);
          if (structKeywordMatch) {
            const structNameStart = structKeywordMatch.index! + structKeywordMatch[0].length;
            const rangeKey = `${lineNum}:${structNameStart}`;

            if (!seenRanges.has(rangeKey)) {
              seenRanges.add(rangeKey);

              const structRange = new vscode.Range(
                lineNum,
                structNameStart,
                lineNum,
                structNameStart + structName.length
              );

              // Find which location kind this struct belongs to
              let locationKind = '';
              for (const info of locationInfos) {
                if (info.locationKind.includes(`<${structName}>`)) {
                  locationKind = info.locationKind;
                  break;
                }
              }

              if (locationKind) {
                locationInfos.push({
                  locationType: locationKind,
                  locationKind,
                  range: structRange,
                  operatorName: structName,
                });
                foundStructs.add(structName);
                log(`  Found struct definition: ${structName} at line ${lineNum + 1}`);
              }
            }
          }
          break; // Only find first occurrence
        }
      }
    }
  }

  return locationInfos;
}
