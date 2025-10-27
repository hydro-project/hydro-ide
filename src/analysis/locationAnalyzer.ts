/**
 * Location Analyzer (Simple Version)
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
 * Check if an operator is a sink operator by analyzing its method signature
 *
 * Sink operators are identified by:
 * 1. Return type is unit type ()
 * 2. Take a live collection as self (Stream, Singleton, Optional, etc.)
 * 3. Are method calls (not standalone functions)
 *
 * This avoids hardcoding operator names and uses the actual type signature.
 */
async function isSinkOperatorBySignature(
  document: vscode.TextDocument,
  position: vscode.Position,
  operatorName: string,
  returnType: string,
  timeout: number
): Promise<boolean> {
  // Must return unit type to be a sink operator
  if (returnType !== '()') {
    return false;
  }

  // Must be a method call (preceded by '.')
  const lineText = document.lineAt(position.line).text;
  const charBefore = position.character > 0 ? lineText[position.character - 1] : '';
  if (charBefore !== '.') {
    return false;
  }

  // Get the full method signature to analyze the self parameter
  try {
    const hoverPromise = vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      position
    );

    const hovers = await Promise.race([
      hoverPromise,
      createTimeout(timeout, 'isSinkOperatorBySignature'),
    ]);

    if (!hovers || hovers.length === 0) {
      return false;
    }

    // Extract method signature from hover content
    for (const hover of hovers) {
      if (!hover || !hover.contents) {
        continue;
      }

      for (const content of hover.contents) {
        const contentStr = typeof content === 'string' ? content : content.value;
        if (!contentStr) {
          continue;
        }

        // Look for Rust code blocks containing the method signature
        const codeBlocks = contentStr.matchAll(/```rust\n([^`]+)\n```/g);
        for (const match of codeBlocks) {
          const blockText = match[1].trim();

          // Check if this method takes a live collection as self
          if (takesSelfAsLiveCollection(blockText)) {
            log(`  DEBUG: Identified '${operatorName}' as sink operator by signature analysis`);
            return true;
          }
        }
      }
    }
  } catch (error) {
    log(`  WARNING: Error analyzing signature for '${operatorName}': ${error}`);
  }

  return false;
}

/**
 * Check if a method signature takes a live collection as self parameter
 *
 * Analyzes the method signature to see if self is a live collection type.
 */
function takesSelfAsLiveCollection(methodSignature: string): boolean {
  // Look for method signatures like:
  // pub fn for_each<F>(self, f: F) -> ()
  // where self is consumed (not &self or &mut self)

  // Match method signatures that consume self (not borrow it)
  const selfConsumingMatch = methodSignature.match(/pub\s+fn\s+\w+[^(]*\(\s*self\s*[,)]/);
  if (!selfConsumingMatch) {
    return false;
  }

  // Look for where clause or impl block that indicates self is a live collection
  // Pattern: impl<...> Stream<...> or impl<...> Singleton<...> etc.
  const implMatch = methodSignature.match(
    /impl[^{]*\b(Stream|Singleton|Optional|KeyedStream|KeyedSingleton)\b/
  );
  if (implMatch) {
    return true;
  }

  // Alternative: look for where Self: LiveCollection or similar bounds
  const whereMatch = methodSignature.match(
    /where[^{]*Self[^{]*:\s*[^{]*\b(Stream|Singleton|Optional|KeyedStream|KeyedSingleton)\b/
  );
  if (whereMatch) {
    return true;
  }

  return false;
}

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
  /** Full return type of the operator (e.g., "Stream<T, Process<Leader>, Unbounded, TotalOrder>") - optional, for LSP graph extraction */
  fullReturnType?: string;
}

/**
 * Cache entry for storing analysis results
 *
 * Each entry stores the complete analysis results for a document at a specific version.
 * The version number is critical for cache invalidation - when a document is edited,
 * its version increments, causing cache misses until re-analysis completes.
 */
interface CacheEntry {
  /** Analysis results for the document */
  locations: LocationInfo[];
  /** Document version when analysis was performed */
  version: number;
  /** Timestamp when the entry was created (for debugging and future TTL support) */
  timestamp: number;
}

/**
 * Module-level cache for analysis results
 *
 * CACHE IMPLEMENTATION:
 * - Uses a Map for O(1) lookup by document URI
 * - Key: document URI string (e.g., "file:///path/to/file.rs")
 * - Value: CacheEntry with locations, version, and timestamp
 * - Cache is version-aware: entries are only valid if document version matches
 * - Cache is bounded by size limit (default 50 entries) with LRU eviction
 *
 * CACHE INVALIDATION:
 * - Automatic: When document version changes (on edit), getCached() returns null
 * - Manual: clearCache() can clear specific file or entire cache
 * - Timed: Entries for closed documents are cleared after 60 seconds (in extension.ts)
 */
const cache = new Map<string, CacheEntry>();

/**
 * LRU (Least Recently Used) order tracking array
 *
 * LRU EVICTION ALGORITHM:
 * - Array maintains document URIs in order of access (oldest first, newest last)
 * - On cache hit: URI is moved to end of array (most recently used)
 * - On cache set: URI is added to end of array
 * - On eviction: First URI in array is removed (least recently used)
 * - This ensures frequently accessed files stay in cache while old files are evicted
 *
 * COMPLEXITY:
 * - Access: O(n) for finding URI in array, but n is small (max 50-500 entries)
 * - Eviction: O(1) for removing first element
 * - This simple approach is sufficient for the expected cache sizes
 */
const lruOrder: string[] = [];

/**
 * Cache statistics counters
 *
 * Used for monitoring cache effectiveness:
 * - cacheHits: Number of times cached results were used (avoided re-analysis)
 * - cacheMisses: Number of times analysis was required (no valid cache entry)
 * - Hit rate = hits / (hits + misses) indicates cache effectiveness
 * - Target hit rate: >50% for typical editing workflows
 */
let cacheHits = 0;
let cacheMisses = 0;

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
 * Parse Location type from a full type string
 * Examples:
 * - "Stream<T, Process<'a, Leader>, Unbounded>" -> "Process<Leader>"
 * - "Process<'_, Leader>" -> "Process<Leader>"
 * - "Tick<Cluster<'a, Worker>>" -> "Tick<Cluster<Worker>>"
 * - "&Tick<Process<'a, Leader>>" -> "Tick<Process<Leader>>"
 * - "Optional<(), Tick<Cluster<'_, Proposer>>, Bounded>" -> "Tick<Cluster<Proposer>>"
 * - "Tick<Tick<Process<'a, Leader>>>" -> "Tick<Tick<Process<Leader>>>"
 * - "Stream<(String, i32), Tick<Process<'a, Leader>>, Bounded::UnderlyingBound, ...>" -> "Tick<Process<Leader>>"
 */
function parseLocationType(fullType: string): string | null {
  try {
    // Validate input is not null/undefined/empty
    if (!fullType || typeof fullType !== 'string' || fullType.length === 0) {
      return null;
    }

    let unwrapped = fullType;

    // Remove leading & or &mut
    unwrapped = unwrapped.replace(/^&(?:mut\s+)?/, '');

    // For Stream/KeyedStream/Optional/Singleton/KeyedSingleton types, extract the location parameter
    // These types have the location as the second or third type parameter
    // Stream<T, L, ...> or KeyedStream<K, V, L, ...> or Optional<T, L, ...> etc.
    const collectionMatch = unwrapped.match(
      /^(Stream|KeyedStream|Optional|Singleton|KeyedSingleton)<(.+)>$/
    );
    if (collectionMatch) {
      const params = collectionMatch[2];
      // Parse type parameters carefully, respecting nested angle brackets
      const typeParams = parseTypeParameters(params);

      // For Stream, Optional, Singleton: location is 2nd parameter (index 1)
      // For KeyedStream, KeyedSingleton: location is 3rd parameter (index 2)
      const locationIndex = collectionMatch[1].startsWith('Keyed') ? 2 : 1;

      if (typeParams.length > locationIndex) {
        const locationParam = typeParams[locationIndex].trim();
        // Recursively parse the location parameter (it might be Tick<Process<...>>)
        return parseLocationType(locationParam);
      }
    }

    // Count and strip Tick wrappers from the beginning, preserving them for later
    const tickWrappers: string[] = [];
    let current = unwrapped;
    let tickMatch = current.match(/^Tick<(.+)>$/);

    while (tickMatch) {
      tickWrappers.push('Tick');
      current = tickMatch[1];
      tickMatch = current.match(/^Tick<(.+)>$/);
    }

    // Match Process<'a, X> or Cluster<'_, X> or External<'a, X>
    const locationMatch = current.match(/(Process|Cluster|External)<'[^,>]+,\s*([^>,]+)>/);
    if (locationMatch) {
      const locationKind = locationMatch[1];
      const typeParam = locationMatch[2].trim();
      let result = `${locationKind}<${typeParam}>`;

      // Re-wrap with all the Tick wrappers we found
      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    // Fallback: just the location kind without type parameter
    const simpleMatch = current.match(/(Process|Cluster|External)</);
    if (simpleMatch) {
      let result = simpleMatch[1];

      // Re-wrap with all the Tick wrappers we found
      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    return null;
  } catch (error) {
    // Handle malformed type strings gracefully
    if (error instanceof Error) {
      log(`WARNING: Error parsing location type from '${fullType}': ${error.message}`);
    } else {
      log(`WARNING: Unknown error parsing location type: ${String(error)}`);
    }
    return null;
  }
}

/**
 * Parse type parameters from a comma-separated list, respecting nested angle brackets and parentheses
 * Example: "T, Process<'a, Leader>, Unbounded" -> ["T", "Process<'a, Leader>", "Unbounded"]
 * Example: "(String, i32), Process<'a, Leader>" -> ["(String, i32)", "Process<'a, Leader>"]
 */
function parseTypeParameters(params: string): string[] {
  try {
    // Validate input
    if (!params || typeof params !== 'string') {
      return [];
    }

    const result: string[] = [];
    let current = '';
    let angleDepth = 0;
    let parenDepth = 0;

    for (let i = 0; i < params.length; i++) {
      const char = params[i];

      if (char === '<') {
        angleDepth++;
        current += char;
      } else if (char === '>') {
        angleDepth--;
        current += char;

        // Validate bracket matching
        if (angleDepth < 0) {
          log(`WARNING: Mismatched angle brackets in type parameters: ${params}`);
          angleDepth = 0; // Reset to prevent further issues
        }
      } else if (char === '(') {
        parenDepth++;
        current += char;
      } else if (char === ')') {
        parenDepth--;
        current += char;

        // Validate parenthesis matching
        if (parenDepth < 0) {
          log(`WARNING: Mismatched parentheses in type parameters: ${params}`);
          parenDepth = 0; // Reset to prevent further issues
        }
      } else if (char === ',' && angleDepth === 0 && parenDepth === 0) {
        const trimmed = current.trim();
        if (trimmed) {
          result.push(trimmed);
        }
        current = '';
      } else {
        current += char;
      }
    }

    const trimmed = current.trim();
    if (trimmed) {
      result.push(trimmed);
    }

    // Warn about unclosed brackets/parentheses
    if (angleDepth !== 0) {
      log(`WARNING: Unclosed angle brackets in type parameters: ${params} (depth: ${angleDepth})`);
    }
    if (parenDepth !== 0) {
      log(`WARNING: Unclosed parentheses in type parameters: ${params} (depth: ${parenDepth})`);
    }

    return result;
  } catch (error) {
    if (error instanceof Error) {
      log(`WARNING: Error parsing type parameters from '${params}': ${error.message}`);
    } else {
      log(`WARNING: Unknown error parsing type parameters: ${String(error)}`);
    }
    return [];
  }
}

/**
 * Query rust-analyzer for type information at a specific position
 * For methods, also tries to extract the receiver (Self) type from the signature
 */
async function getTypeAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  isMethod: boolean = false,
  timeout: number = 5000
): Promise<string | null> {
  try {
    // Validate document is not null/undefined
    if (!document) {
      log('  ERROR: Document is null or undefined');
      return null;
    }

    // Validate position is not null/undefined
    if (!position) {
      log('  ERROR: Position is null or undefined');
      return null;
    }

    // Validate position is within document bounds
    if (position.line < 0 || position.line >= document.lineCount) {
      log(
        `  WARNING: Position line ${position.line} is out of bounds (document has ${document.lineCount} lines)`
      );
      return null;
    }

    const line = document.lineAt(position.line);
    if (position.character < 0 || position.character > line.text.length) {
      log(
        `  WARNING: Position char ${position.character} is out of bounds (line length: ${line.text.length})`
      );
      return null;
    }

    const hoverPromise = vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      position
    );

    const hovers = await Promise.race([hoverPromise, createTimeout(timeout, 'getTypeAtPosition')]);

    // Check for null/undefined hover response
    if (!hovers || hovers.length === 0) {
      return null;
    }

    // Extract type information from hover content
    for (const hover of hovers) {
      // Validate hover has contents
      if (!hover || !hover.contents) {
        continue;
      }

      for (const content of hover.contents) {
        // Validate content is not null/undefined
        if (!content) {
          continue;
        }

        const contentStr = typeof content === 'string' ? content : content.value;
        if (contentStr) {
          if (isMethod) {
            // For methods, find the code block with the function signature and extract return type
            const codeBlocks = contentStr.matchAll(/```rust\n([^`]+)\n```/g);
            for (const match of codeBlocks) {
              const blockText = match[1].trim();
              // Look for "pub fn method_name(...) -> ReturnType"
              const returnTypeMatch = blockText.match(/->\s*([^\n{]+?)(?:\s*where|\s*$)/s);
              if (returnTypeMatch) {
                let returnType = returnTypeMatch[1]?.replace(/\s+/g, ' ').trim();

                // Validate return type is not empty or malformed
                if (!returnType || returnType.length === 0) {
                  log('  WARNING: Empty return type extracted from hover');
                  continue;
                }

                log(`  Initial return type: ${returnType}`);

                // Extract where clause once for reuse
                const whereClause = blockText.match(/where([^]*?)(?:\/\/|$)/s);

                // Handle qualified associated types like "<Self as ZipResult<'a, O>>::Out"
                // Look for "Location = L" in where clause to find the location type
                if (returnType.includes('<Self as ') && returnType.includes('>::')) {
                  if (whereClause) {
                    const locationMatch = whereClause[1].match(/Location\s*=\s*([A-Z]\w*)/);
                    if (locationMatch) {
                      const locationParam = locationMatch[1];
                      // Substitute the location parameter with its concrete type
                      const paramMatch = contentStr.match(
                        new RegExp(`\`${locationParam}\`\\s*=\\s*\`([^\`]+)\``)
                      );
                      if (paramMatch) {
                        returnType = paramMatch[1];
                      }
                    }
                  }
                }

                // Handle Self - if it's just "Self", reconstruct the type from impl block
                if (returnType === 'Self') {
                  // Look for impl block to find the type being implemented
                  // Pattern: "impl<...> Trait for TypeName<...>" or "impl<...> TypeName<...>"
                  const implForMatch = blockText.match(/impl<[^>]+>\s+\w+\s+for\s+(\w+)<([^>]+)>/);
                  const implDirectMatch = blockText.match(/impl<[^>]+>\s+(\w+)<([^>]+)>/);

                  const implMatch = implForMatch || implDirectMatch;

                  if (implMatch) {
                    const typeName = implMatch[1];
                    const typeParams = implMatch[2];

                    // Parse the type parameters from the impl (e.g., "T, L, B, O, R")
                    const paramNames = typeParams.split(',').map((p) => p.trim());

                    // Build a map of parameter names to concrete types from metadata
                    // The metadata has lines like "T = SequencedKv<K, V> , L = Tick<Cluster<'a, Replica>> , ..."
                    const concreteTypeMap = new Map<string, string>();
                    const metadataMatches = contentStr.matchAll(
                      /\b([A-Z][A-Za-z0-9]*)\s*=\s*([^,}]+)/g
                    );
                    for (const match of metadataMatches) {
                      concreteTypeMap.set(match[1], match[2].trim());
                    }

                    // Substitute each parameter with its concrete type
                    const concreteParams = paramNames.map(
                      (paramName) => concreteTypeMap.get(paramName) || paramName
                    );

                    // Reconstruct the full type
                    returnType = `${typeName}<${concreteParams.join(', ')}>`;
                    log(`  Self resolved to: ${returnType}`);
                  } else {
                    // Fallback: try to find Self = ... in metadata
                    const selfMatch = contentStr.match(/`Self`\s*=\s*`([^`]+)`/);
                    if (selfMatch) {
                      returnType = selfMatch[1];
                      log(`  Self found in metadata: ${returnType}`);
                    }
                  }
                } else if (returnType.includes('Self')) {
                  // Handle Self in complex types
                  const selfMatch = contentStr.match(/`Self`\s*=\s*`([^`]+)`/);
                  if (selfMatch) {
                    const selfType = selfMatch[1];
                    returnType = returnType.replace(/\bSelf\b/g, selfType);
                  }
                }

                // Always substitute all generic type parameters found in metadata
                // Pattern 1: `TypeParam` = `ConcreteType` (backtick-wrapped)
                const typeParamMatches = contentStr.matchAll(
                  /`([A-Z][A-Za-z0-9]*)`\s*=\s*`([^`]+)`/g
                );
                for (const match of typeParamMatches) {
                  const param = match[1];
                  const paramType = match[2];
                  // Use word boundary to avoid replacing param in other identifiers
                  // Only create RegExp if the param appears in returnType
                  if (returnType.includes(param)) {
                    returnType = returnType.replace(new RegExp(`\\b${param}\\b`, 'g'), paramType);
                  }
                }

                // Pattern 2: TypeParam: Location<'a> (from where clause in hover)
                // This handles cases like "L: Location<'a>," followed by concrete type info
                // Look for single-letter type params that appear in the return type
                if (whereClause) {
                  log(`  Found where clause: ${whereClause[1].substring(0, 100)}...`);
                  // Find type parameters in where clause (e.g., "L: Location<'a>")
                  const locationParamMatches =
                    whereClause[1].matchAll(/\b([A-Z])\s*:\s*Location</g);
                  for (const match of locationParamMatches) {
                    const param = match[1];
                    log(`  Found location param in where clause: ${param}`);
                    // Check if this param appears in the return type
                    if (returnType.includes(param)) {
                      // Look for the concrete type in the hover metadata
                      // Format: "K = String , V = i32 , L = Tick<Process<'a, Leader>>"
                      // Create regex patterns once
                      const searchPattern = new RegExp(`\\b${param}\\s*=\\s*([^,}]+)`);
                      const replacePattern = new RegExp(`\\b${param}\\b`, 'g');

                      const concreteTypeMatch = contentStr.match(searchPattern);
                      if (concreteTypeMatch) {
                        const concreteType = concreteTypeMatch[1].trim();
                        returnType = returnType.replace(replacePattern, concreteType);
                        log(`  Substituted location param ${param} -> ${concreteType}`);
                      } else {
                        log(`  Could not find concrete type for ${param} in hover content`);
                      }
                    }
                  }
                }

                log(`  Final return type after substitutions: ${returnType}`);

                return returnType;
              }
            }
            return null;
          } else {
            // For variables/parameters, extract type from first code block (e.g., "p1: &Process<'a, P1>")
            const typeMatch = contentStr.match(/```rust\n([^`]+)\n```/);
            if (typeMatch) {
              const fullDecl = typeMatch[1]?.trim();

              // Validate declaration is not empty
              if (!fullDecl || fullDecl.length === 0) {
                log('  WARNING: Empty declaration extracted from hover');
                continue;
              }

              log(`  Variable/parameter declaration: ${fullDecl}`);

              // Extract just the type part after the colon
              const colonMatch = fullDecl.match(/:\s*(.+)$/);
              if (colonMatch) {
                const varType = colonMatch[1]?.trim();

                // Validate type is not empty
                if (!varType || varType.length === 0) {
                  log('  WARNING: Empty variable type extracted');
                  return fullDecl;
                }

                log(`  Extracted variable type: ${varType}`);
                return varType;
              }

              return fullDecl;
            }
          }
        }
      }
    }

    return null;
  } catch (error) {
    // Classify and log errors with appropriate severity
    if (error instanceof Error) {
      if (error.message.includes('timed out')) {
        // Timeout is a transient error - log as warning
        log(`  WARNING: Hover query timed out after ${timeout}ms`);
      } else if (error.message.includes('not ready') || error.message.includes('not available')) {
        // rust-analyzer not ready - log as info
        log(`  INFO: rust-analyzer not ready for hover query`);
      } else {
        // Other errors - log as error with details
        log(`  ERROR querying hover: ${error.message}`);
        if (error.stack) {
          log(`  Stack trace: ${error.stack}`);
        }
      }
    } else {
      // Non-Error exceptions
      log(`  ERROR querying hover (unknown error type): ${String(error)}`);
    }
    return null;
  }
}

/**
 * Create a timeout promise that rejects after the specified duration
 */
function createTimeout(ms: number, operation: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms}ms`));
    }, ms);
  });
}

/**
 * Get semantic tokens from rust-analyzer with timeout
 */
async function getSemanticTokens(
  document: vscode.TextDocument,
  timeout: number
): Promise<vscode.SemanticTokens | null> {
  try {
    // Validate document is not null/undefined
    if (!document || !document.uri) {
      log('ERROR: Document or document URI is null or undefined');
      return null;
    }

    const tokensPromise = vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      document.uri
    );

    const tokens = await Promise.race([tokensPromise, createTimeout(timeout, 'getSemanticTokens')]);

    // Validate tokens structure
    if (!tokens) {
      return null;
    }

    // tokens.data is a Uint32Array, not a regular array
    if (!tokens.data || !(tokens.data instanceof Uint32Array) || tokens.data.length === 0) {
      log('WARNING: Semantic tokens returned but data is invalid or missing');
      return null;
    }

    return tokens;
  } catch (error) {
    // Classify and log errors with appropriate severity
    if (error instanceof Error) {
      if (error.message.includes('timed out')) {
        // Timeout is a transient error - log as warning
        log(`WARNING: Semantic tokens query timed out after ${timeout}ms`);
      } else if (error.message.includes('not ready') || error.message.includes('not available')) {
        // rust-analyzer not ready - log as info
        log(`INFO: rust-analyzer not ready for semantic tokens query`);
      } else if (error.message.includes('command') && error.message.includes('not found')) {
        // Command not found - rust-analyzer may not be installed
        log(
          `ERROR: Semantic tokens command not found. rust-analyzer may not be installed or enabled.`
        );
      } else {
        // Other errors - log as error with details
        log(`ERROR getting semantic tokens: ${error.message}`);
        if (error.stack) {
          log(`Stack trace: ${error.stack}`);
        }
      }
    } else {
      // Non-Error exceptions
      log(`ERROR getting semantic tokens (unknown error type): ${String(error)}`);
    }
    return null;
  }
}

/**
 * Analyze a document to find all identifiers with Location types
 */
export async function analyzeDocument(document: vscode.TextDocument): Promise<LocationInfo[]> {
  try {
    // Validate document is not null/undefined
    if (!document) {
      log('ERROR: Document is null or undefined');
      return [];
    }

    // Validate document has required properties
    if (!document.uri || !document.fileName) {
      log('ERROR: Document is missing required properties (uri or fileName)');
      return [];
    }

    log(`Analyzing ${document.fileName}...`);
    log(`Document has ${document.lineCount} lines, version ${document.version}`);

    // Read configuration
    const config = vscode.workspace.getConfiguration('hydro-ide');

    // Check if analysis is enabled
    const enabled = config.get<boolean>('analysis.enabled', true);
    if (!enabled) {
      log('INFO: Analysis is disabled in configuration');
      return [];
    }

    // Check file size limit
    const maxFileSize = config.get<number>('analysis.maxFileSize', 10000);
    if (document.lineCount > maxFileSize) {
      log(
        `INFO: Skipping analysis - file too large (${document.lineCount} lines > ${maxFileSize} max)`
      );
      return [];
    }

    // Check cache first
    const uri = document.uri.toString();
    const cached = getCached(uri, document.version);
    if (cached) {
      log(`Cache hit for ${document.fileName} v${document.version} (${cached.length} locations)`);
      // Debug: Write cache hit info
      import('fs').then(fs => {
        fs.writeFileSync('/tmp/locationAnalyzer-cache-hit.json', JSON.stringify({
          timestamp: new Date().toISOString(),
          fileName: document.fileName,
          uri: uri,
          version: document.version,
          cachedResultCount: cached.length
        }, null, 2));
      }).catch(() => {
        // Ignore fs errors in debug code
      });
      return cached;
    }

    log(`Cache miss for ${document.fileName} v${document.version}, analyzing...`);
    const startTime = Date.now();

    // Get query timeout from configuration
    const queryTimeout = config.get<number>('performance.queryTimeout', 5000);

    // Debug: fs will be imported dynamically for debugging

    // Get semantic tokens to find all identifiers
    const tokens = await getSemanticTokens(document, queryTimeout);
    const debugInfo = {
      timestamp: new Date().toISOString(),
      fileName: document.fileName,
      tokensReceived: !!tokens,
      tokensDataLength: tokens?.data?.length || 0,
      queryTimeout: queryTimeout
    };
    const debugLine = JSON.stringify(debugInfo) + '\n';
    import('fs').then(fs => {
      fs.appendFileSync('/tmp/locationAnalyzer-all-calls.log', debugLine);
    }).catch(() => {
      // Ignore fs errors in debug code
    });
    
    if (!tokens) {
      log(
        'WARNING: No semantic tokens available. rust-analyzer may not be ready or file may not be valid Rust code.'
      );
      return [];
    }

    // Validate tokens data
    if (!tokens.data || tokens.data.length === 0) {
      log('INFO: No semantic tokens data available for this document');
      return [];
    }

    log(`Got ${tokens.data.length / 5} semantic tokens`);

    const locationInfos: LocationInfo[] = [];
    const seenPositions = new Set<string>();

    // Parse semantic tokens
    const data = tokens.data;
    let line = 0;
    let char = 0;
    let candidateCount = 0;
    let queriedCount = 0;
    let foundLocationCount = 0;
    
    // Debug: Track candidates
    const debugCandidates: unknown[] = [];

    for (let i = 0; i < data.length; i += 5) {
      try {
        // Validate we have enough data for a complete token
        if (i + 4 >= data.length) {
          log(`WARNING: Incomplete token data at index ${i}`);
          break;
        }

        const deltaLine = data[i];
        const deltaChar = data[i + 1];
        const length = data[i + 2];
        const tokenType = data[i + 3];

        // Validate token data values
        if (deltaLine < 0 || deltaChar < 0 || length <= 0) {
          log(
            `WARNING: Invalid token data at index ${i}: deltaLine=${deltaLine}, deltaChar=${deltaChar}, length=${length}`
          );
          continue;
        }

        // Update position
        line += deltaLine;
        char = deltaLine === 0 ? char + deltaChar : deltaChar;

        // Skip tokens beyond document bounds (stale semantic tokens)
        if (line < 0 || line >= document.lineCount) {
          continue;
        }

        // We're interested in: 8=variable (includes methods), 12=parameter, 17=local variable/binding
        // Note: rust-analyzer uses type 12 for function parameters, not 7
        const isRelevant = tokenType === 8 || tokenType === 12 || tokenType === 17;
        
        // Debug: Log all token types to see what we're missing
        if (candidateCount < 20) { // Only log first 20 to avoid spam
          const lineText = document.lineAt(line).text;
          const tokenText = lineText.substring(char, char + length);
          log(`Token ${candidateCount}: type=${tokenType}, text="${tokenText}", line=${line}, char=${char}`);
        }
        
        if (!isRelevant) {
          continue;
        }

        const position = new vscode.Position(line, char);
        const range = new vscode.Range(line, char, line, char + length);

        // Validate range is within document bounds
        if (range.end.character > document.lineAt(line).text.length) {
          log(`WARNING: Token range extends beyond line length at line ${line}`);
          continue;
        }

        const name = document.getText(range);

        // Validate name is not empty
        if (!name || name.length === 0) {
          continue;
        }

        candidateCount++;

        // Debug: Track candidates
        if (candidateCount <= 20) {
          debugCandidates.push({
            name,
            line,
            char,
            tokenType,
            candidateNumber: candidateCount
          });
        }

        // Skip macros
        if (name === '!' || name.endsWith('!')) {
          if (candidateCount <= 10) {
            log(`    Skipping macro: "${name}"`);
          }
          continue;
        }

        // Skip if we've already checked this position
        const posKey = `${line}:${char}`;
        if (seenPositions.has(posKey)) {
          if (candidateCount <= 10) {
            log(`    Skipping duplicate position: ${posKey}`);
          }
          continue;
        }
        seenPositions.add(posKey);

        // Query the type at this position
        queriedCount++;

        // Check if this is a method call (preceded by '.')
        const lineText = document.lineAt(position.line).text;
        const charBefore = position.character > 0 ? lineText[position.character - 1] : '';
        const isMethodCall = charBefore === '.';

        // Hover on the method name itself to get the signature with return type
        const typeInfo = await getTypeAtPosition(document, position, isMethodCall, queryTimeout);

        if (!typeInfo) {
          continue;
        }

        // Check if it contains a Location type or is a sink operator
        const locationKind = parseLocationType(typeInfo);
        const isSinkOperator = await isSinkOperatorBySignature(
          document,
          position,
          name,
          typeInfo,
          queryTimeout
        );

        if ((locationKind && !locationKind.includes('…')) || isSinkOperator) {
          foundLocationCount++;

          // For sink operators, we need to infer the location from context
          // Since they don't have location in their return type, we'll use a placeholder
          const effectiveLocationKind = locationKind || 'Process<Leader>'; // Default for sink operators

          locationInfos.push({
            locationType: typeInfo,
            locationKind: effectiveLocationKind,
            range,
            operatorName: name,
            fullReturnType: typeInfo, // Store full return type for LSP graph extraction
          });
        }
      } catch (error) {
        // Log error but continue processing other tokens
        if (error instanceof Error) {
          log(`WARNING: Error processing token at index ${i}: ${error.message}`);
        } else {
          log(`WARNING: Unknown error processing token at index ${i}: ${String(error)}`);
        }
        continue;
      }
    }

    log(
      `Processed ${candidateCount} candidates, queried ${queriedCount}, found ${foundLocationCount} with Location types`
    );

    // Find struct definitions for the Location type parameters
    try {
      const structNames = new Set<string>();
      locationInfos.forEach((info) => {
        try {
          const match = info.locationKind.match(/<([^>]+)>$/);
          if (match && match[1]) {
            structNames.add(match[1].trim());
          }
        } catch (error) {
          log(`WARNING: Error extracting struct name from locationKind: ${info.locationKind}`);
        }
      });

      // Search for struct definitions in the file
      for (const structName of structNames) {
        try {
          // Validate struct name is not empty
          if (!structName || structName.length === 0) {
            continue;
          }

          const pattern = new RegExp(`\\bstruct\\s+${structName}\\b`);

          for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
            const line = document.lineAt(lineNum);
            const match = pattern.exec(line.text);

            if (match) {
              const structKeywordMatch = line.text.match(/\bstruct\s+/);
              if (structKeywordMatch && structKeywordMatch.index !== undefined) {
                const structNameStart = structKeywordMatch.index + structKeywordMatch[0].length;
                const structRange = new vscode.Range(
                  lineNum,
                  structNameStart,
                  lineNum,
                  structNameStart + structName.length
                );

                // Find which location kind this struct belongs to
                const locationKind = locationInfos.find((info) =>
                  info.locationKind.includes(`<${structName}>`)
                )?.locationKind;

                if (locationKind) {
                  locationInfos.push({
                    locationType: locationKind,
                    locationKind,
                    range: structRange,
                    operatorName: structName,
                    fullReturnType: locationKind, // Store full return type for LSP graph extraction
                  });
                }
              }
              break;
            }
          }
        } catch (error) {
          if (error instanceof Error) {
            log(`WARNING: Error searching for struct definition '${structName}': ${error.message}`);
          } else {
            log(`WARNING: Unknown error searching for struct '${structName}': ${String(error)}`);
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        log(`WARNING: Error finding struct definitions: ${error.message}`);
      } else {
        log(`WARNING: Unknown error finding struct definitions: ${String(error)}`);
      }
      // Continue with partial results
    }

    const elapsedMs = Date.now() - startTime;
    log(`Found ${locationInfos.length} location-typed identifiers in ${elapsedMs}ms`);

    // Store results in cache
    try {
      setCached(uri, document.version, locationInfos);
      log(`Cached results for ${document.fileName} v${document.version}`);
    } catch (error) {
      if (error instanceof Error) {
        log(`WARNING: Failed to cache results: ${error.message}`);
      } else {
        log(`WARNING: Failed to cache results: ${String(error)}`);
      }
      // Continue even if caching fails
    }

    // Debug: Write final results to file (append to see all calls)
    const finalDebugInfo = {
      timestamp: new Date().toISOString(),
      fileName: document.fileName,
      candidateCount,
      queriedCount,
      foundLocationCount,
      candidates: debugCandidates,
      results: locationInfos.map(loc => ({
        operatorName: loc.operatorName,
        locationType: loc.locationType,
        locationKind: loc.locationKind,
        line: loc.range.start.line,
        char: loc.range.start.character
      }))
    };
    const finalLine = JSON.stringify(finalDebugInfo) + '\n';
    import('fs').then(fs => {
      fs.appendFileSync('/tmp/locationAnalyzer-all-results.log', finalLine);
    }).catch(() => {
      // Ignore fs errors in debug code
    });

    return locationInfos;
  } catch (error) {
    // Top-level error handler for the entire analysis function
    if (error instanceof Error) {
      log(`ERROR: Analysis failed for ${document.fileName}: ${error.message}`);
      if (error.stack) {
        log(`Stack trace: ${error.stack}`);
      }
    } else {
      log(`ERROR: Analysis failed with unknown error type: ${String(error)}`);
    }
    // Return empty array on error rather than throwing
    return [];
  }
}

/**
 * Retrieve cached analysis results for a document
 *
 * CACHE LOOKUP LOGIC:
 * 1. Check if entry exists in cache Map (O(1) lookup)
 * 2. Verify document version matches cached version (version-based invalidation)
 * 3. On cache hit:
 *    - Update LRU order (move URI to end of array = most recently used)
 *    - Increment hit counter
 *    - Return cached locations (avoids expensive re-analysis)
 * 4. On cache miss:
 *    - Increment miss counter
 *    - Return null (caller will perform analysis and cache results)
 *
 * VERSION-BASED INVALIDATION:
 * - VSCode increments document.version on each edit
 * - If cached version != current version, cache is stale and miss is returned
 * - This ensures we never return outdated analysis results
 *
 * @param uri Document URI string (e.g., "file:///path/to/file.rs")
 * @param version Document version number (from document.version)
 * @returns Cached locations if found and version matches, null otherwise
 */
function getCached(uri: string, version: number): LocationInfo[] | null {
  const entry = cache.get(uri);
  if (entry && entry.version === version) {
    // CACHE HIT: Entry exists and version matches

    // Update LRU order: move this URI to end (most recently used)
    // This prevents frequently accessed files from being evicted
    const idx = lruOrder.indexOf(uri);
    if (idx >= 0) {
      lruOrder.splice(idx, 1); // Remove from current position
    }
    lruOrder.push(uri); // Add to end (most recently used)

    cacheHits++;
    return entry.locations;
  }

  // CACHE MISS: Entry doesn't exist or version doesn't match
  cacheMisses++;
  return null;
}

/**
 * Store analysis results in cache with LRU eviction
 *
 * CACHE STORAGE LOGIC:
 * 1. Read cache size limit from configuration (default: 50 entries)
 * 2. If cache is at capacity, evict least recently used entries
 * 3. Store new entry in cache Map
 * 4. Update LRU order array
 *
 * LRU EVICTION ALGORITHM:
 * - When cache.size >= maxSize, evict entries until there's room
 * - Eviction: Remove first URI from lruOrder array (least recently used)
 * - Delete corresponding entry from cache Map
 * - This ensures cache never exceeds configured size limit
 * - Frequently accessed files stay in cache, old files are evicted
 *
 * EXAMPLE:
 * - maxSize = 3, cache has [file1, file2, file3] (oldest to newest)
 * - User accesses file2 -> moves to end: [file1, file3, file2]
 * - User opens file4 -> evicts file1: [file3, file2, file4]
 * - file1 is evicted because it was least recently used
 *
 * @param uri Document URI string (e.g., "file:///path/to/file.rs")
 * @param version Document version number (from document.version)
 * @param locations Analysis results to cache
 */
function setCached(uri: string, version: number, locations: LocationInfo[]): void {
  // Read cache size limit from user configuration
  const config = vscode.workspace.getConfiguration('hydro-ide');
  const maxSize = config.get<number>('performance.cacheSize', 50);

  // LRU EVICTION: Remove oldest entries if cache is at capacity
  // Loop handles case where multiple entries need eviction (shouldn't happen normally)
  while (cache.size >= maxSize && lruOrder.length > 0) {
    // Remove first element from LRU array (least recently used)
    const oldest = lruOrder.shift()!;

    // Delete corresponding cache entry
    cache.delete(oldest);

    log(`Evicted cache entry for ${oldest} (LRU)`);
  }

  // Store new entry in cache
  cache.set(uri, { locations, version, timestamp: Date.now() });

  // Update LRU order: add URI to end (most recently used)
  // First remove if it already exists (handles re-caching same file)
  const idx = lruOrder.indexOf(uri);
  if (idx >= 0) {
    lruOrder.splice(idx, 1); // Remove from current position
  }
  lruOrder.push(uri); // Add to end (most recently used)
}

/**
 * Clear cache entries
 *
 * CACHE INVALIDATION:
 * - Selective: Clear specific file (used when file is closed or saved)
 * - Complete: Clear entire cache (used on configuration changes or manual clear)
 *
 * WHEN TO CLEAR CACHE:
 * - File closed: After 60 seconds (in extension.ts)
 * - File saved: Immediately (to get fresh types from rust-analyzer)
 * - Configuration changed: Colors or analysis settings changed
 * - Manual: User runs "Clear Analysis Cache" command
 * - Extension deactivation: Clean up all resources
 *
 * @param fileUri Optional specific file URI to clear. If not provided, clears entire cache
 */
export function clearCache(fileUri?: string): void {
  if (fileUri) {
    // SELECTIVE CLEAR: Remove specific file from cache
    cache.delete(fileUri);

    // Remove from LRU order array
    const idx = lruOrder.indexOf(fileUri);
    if (idx >= 0) {
      lruOrder.splice(idx, 1);
    }

    log(`Cleared cache for ${fileUri}`);
  } else {
    // COMPLETE CLEAR: Remove all entries and reset statistics
    cache.clear();
    lruOrder.length = 0; // Clear array efficiently
    cacheHits = 0;
    cacheMisses = 0;
    log('Cleared entire cache');
  }
}

/**
 * Get cache statistics for monitoring and debugging
 *
 * CACHE PERFORMANCE METRICS:
 * - numFiles: Current number of files in cache
 * - hits: Number of times cached results were used (avoided re-analysis)
 * - misses: Number of times analysis was required (no valid cache entry)
 * - hitRate: Ratio of hits to total requests (0.0 to 1.0)
 * - hitRatePercent: Hit rate as percentage string (e.g., "75.5")
 *
 * INTERPRETING RESULTS:
 * - High hit rate (>50%): Cache is effective, reducing analysis overhead
 * - Low hit rate (<30%): Consider increasing cache size or checking for issues
 * - Zero hits: Cache may be disabled or files are changing too frequently
 *
 * USAGE:
 * - Called by "Show Cache Statistics" command
 * - Displayed in output channel for debugging
 * - Helps tune cache size configuration
 *
 * @returns Object containing cache statistics
 */
export function getCacheStats() {
  const totalRequests = cacheHits + cacheMisses;
  const hitRate = totalRequests > 0 ? cacheHits / totalRequests : 0;

  return {
    numFiles: cache.size, // Current cache size
    totalEntries: cache.size, // Same as numFiles (for compatibility)
    hits: cacheHits, // Number of cache hits
    misses: cacheMisses, // Number of cache misses
    hitRate: hitRate, // Hit rate as decimal (0.0-1.0)
    hitRatePercent: (hitRate * 100).toFixed(1), // Hit rate as percentage string
  };
}
