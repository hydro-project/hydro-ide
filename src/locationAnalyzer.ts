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
}

/**
 * Parse type parameters from a comma-separated list, respecting nested angle brackets and parentheses
 * Example: "T, Process<'a, Leader>, Unbounded" -> ["T", "Process<'a, Leader>", "Unbounded"]
 * Example: "(String, i32), Process<'a, Leader>" -> ["(String, i32)", "Process<'a, Leader>"]
 */
function parseTypeParameters(params: string): string[] {
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
    } else if (char === '(') {
      parenDepth++;
      current += char;
    } else if (char === ')') {
      parenDepth--;
      current += char;
    } else if (char === ',' && angleDepth === 0 && parenDepth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

/**
 * Query rust-analyzer for type information at a specific position
 * For methods, also tries to extract the receiver (Self) type from the signature
 */
async function getTypeAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  isMethod: boolean = false
): Promise<string | null> {
  try {
    // Validate position is within document bounds
    if (position.line >= document.lineCount) {
      log(
        `  ERROR: Position line ${position.line} exceeds document line count ${document.lineCount}`
      );
      return null;
    }

    const line = document.lineAt(position.line);
    if (position.character >= line.text.length) {
      log(`  ERROR: Position char ${position.character} exceeds line length ${line.text.length}`);
      return null;
    }

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
          if (isMethod) {
            // For methods, find the code block with the function signature and extract return type
            const codeBlocks = contentStr.matchAll(/```rust\n([^`]+)\n```/g);
            for (const match of codeBlocks) {
              const blockText = match[1].trim();
              // Look for "pub fn method_name(...) -> ReturnType"
              const returnTypeMatch = blockText.match(/->\s*([^\n{]+?)(?:\s*where|\s*$)/s);
              if (returnTypeMatch) {
                let returnType = returnTypeMatch[1].replace(/\s+/g, ' ').trim();
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
              const fullDecl = typeMatch[1].trim();
              log(`  Variable/parameter declaration: ${fullDecl}`);

              // Extract just the type part after the colon
              const colonMatch = fullDecl.match(/:\s*(.+)$/);
              if (colonMatch) {
                const varType = colonMatch[1].trim();
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
    log(`ERROR querying hover: ${error}`);
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
 * Analyze a document to find all identifiers with Location types
 */
export async function analyzeDocument(document: vscode.TextDocument): Promise<LocationInfo[]> {
  log(`Analyzing ${document.fileName}...`);
  log(`Document has ${document.lineCount} lines`);
  const startTime = Date.now();

  // Get semantic tokens to find all identifiers
  const tokens = await getSemanticTokens(document);
  if (!tokens) {
    log('ERROR: No semantic tokens available. rust-analyzer may not be ready.');
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

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    const length = data[i + 2];
    const tokenType = data[i + 3];

    // Update position
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;

    // Skip tokens beyond document bounds (stale semantic tokens)
    if (line >= document.lineCount) {
      continue;
    }

    // We're interested in: 8=variable (includes methods), 12=parameter, 17=local variable/binding
    // Note: rust-analyzer uses type 12 for function parameters, not 7
    const isRelevant = tokenType === 8 || tokenType === 12 || tokenType === 17;
    if (!isRelevant) {
      continue;
    }

    const position = new vscode.Position(line, char);
    const range = new vscode.Range(line, char, line, char + length);
    const name = document.getText(range);

    candidateCount++;

    // Skip macros
    if (name === '!' || name.endsWith('!')) {
      continue;
    }

    // Skip if we've already checked this position
    const posKey = `${line}:${char}`;
    if (seenPositions.has(posKey)) {
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
    const typeInfo = await getTypeAtPosition(document, position, isMethodCall);

    if (!typeInfo) {
      continue;
    }

    // Check if it contains a Location type
    const locationKind = parseLocationType(typeInfo);
    if (locationKind && !locationKind.includes('…')) {
      foundLocationCount++;
      locationInfos.push({
        locationType: typeInfo,
        locationKind,
        range,
        operatorName: name,
      });
    }
  }

  log(
    `Processed ${candidateCount} candidates, queried ${queriedCount}, found ${foundLocationCount} with Location types`
  );

  // Find struct definitions for the Location type parameters
  const structNames = new Set<string>();
  locationInfos.forEach((info) => {
    const match = info.locationKind.match(/<([^>]+)>$/);
    if (match) {
      structNames.add(match[1].trim());
    }
  });

  // Search for struct definitions in the file
  for (const structName of structNames) {
    const pattern = new RegExp(`\\bstruct\\s+${structName}\\b`);

    for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
      const line = document.lineAt(lineNum);
      const match = pattern.exec(line.text);

      if (match) {
        const structKeywordMatch = line.text.match(/\bstruct\s+/);
        if (structKeywordMatch) {
          const structNameStart = structKeywordMatch.index! + structKeywordMatch[0].length;
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
            });
          }
        }
        break;
      }
    }
  }

  const elapsedMs = Date.now() - startTime;
  log(`Found ${locationInfos.length} location-typed identifiers in ${elapsedMs}ms`);

  return locationInfos;
}

/**
 * Get cache statistics (no-op in simple version)
 */
export function getCacheStats() {
  return {
    numFiles: 0,
    totalEntries: 0,
    estimatedMemoryMB: 0,
    fileStats: [],
  };
}

/**
 * Clear cache (no-op in simple version)
 */
export function clearCache(_fileUri?: string): void {
  // No cache in simple version
}
