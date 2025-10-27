/**
 * LSP-based semantic analyzer for Hydro code
 * 
 * Provides type and semantic analysis using rust-analyzer:
 * - Queries type information for identifiers
 * - Parses complex generic types and associated types
 * - Extracts location types from Hydro collections
 * - Handles semantic tokens and hover information
 */

import * as vscode from 'vscode';

/**
 * Location information for an identifier with a Hydro Location type
 */
export interface LocationInfo {
  /** The type of the location (e.g., "Stream<String, Process<'a, Leader>, Unbounded>") */
  locationType: string;
  /** The parsed location kind (e.g., "Process<Leader>") */
  locationKind: string;
  /** The range of the identifier in the document */
  range: vscode.Range;
  /** The operator/identifier name */
  operatorName: string;
  /** Full return type for graph extraction */
  fullReturnType?: string;
}

/**
 * Cache entry for location analysis results
 */
interface CacheEntry {
  version: number;
  results: LocationInfo[];
  timestamp: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  numFiles: number;
  hitRatePercent: number;
}

/**
 * LSP-based analyzer for type and semantic information
 */
export class LSPAnalyzer {
  private outputChannel: vscode.OutputChannel | null = null;
  private cache = new Map<string, CacheEntry>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(outputChannel?: vscode.OutputChannel) {
    this.outputChannel = outputChannel || null;
  }

  /**
   * Log message to output channel
   */
  private log(message: string): void {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[LSPAnalyzer] ${message}`);
    }
  }

  /**
   * Analyze a document to find all identifiers with Location types
   */
  public async analyzeDocument(document: vscode.TextDocument): Promise<LocationInfo[]> {
    try {
      if (!document) {
        this.log('ERROR: Document is null or undefined');
        return [];
      }

      this.log(`Analyzing ${document.fileName}...`);
      this.log(`Document has ${document.lineCount} lines, version ${document.version}`);

      // Check configuration
      const config = vscode.workspace.getConfiguration('hydro-ide');
      const enabled = config.get<boolean>('analysis.enabled', true);
      if (!enabled) {
        this.log('INFO: Analysis is disabled in configuration');
        return [];
      }

      const maxFileSize = config.get<number>('analysis.maxFileSize', 10000);
      if (document.lineCount > maxFileSize) {
        this.log(`INFO: Skipping analysis - file too large (${document.lineCount} lines > ${maxFileSize} max)`);
        return [];
      }

      // Check cache first
      const uri = document.uri.toString();
      const cached = this.getCached(uri, document.version);
      if (cached) {
        this.log(`Cache hit for ${document.fileName} v${document.version} (${cached.length} locations)`);
        return cached;
      }

      this.log(`Cache miss for ${document.fileName} v${document.version}, analyzing...`);
      const startTime = Date.now();

      // Get semantic tokens and analyze
      const queryTimeout = config.get<number>('performance.queryTimeout', 5000);
      const tokens = await this.getSemanticTokens(document, queryTimeout);
      
      if (!tokens || !tokens.data || tokens.data.length === 0) {
        this.log('WARNING: No semantic tokens available. rust-analyzer may not be ready or file may not be valid Rust code.');
        return [];
      }

      this.log(`Got ${tokens.data.length / 5} semantic tokens`);

      const locationInfos = await this.analyzeSemanticTokens(document, tokens, queryTimeout);
      
      const duration = Date.now() - startTime;
      this.log(`Found ${locationInfos.length} location-typed identifiers in ${duration}ms`);

      // Cache results
      this.setCached(uri, document.version, locationInfos);

      return locationInfos;
    } catch (error) {
      this.log(`ERROR in analyzeDocument: ${error}`);
      return [];
    }
  }

  /**
   * Analyze semantic tokens to find location types
   */
  private async analyzeSemanticTokens(
    document: vscode.TextDocument,
    tokens: vscode.SemanticTokens,
    timeout: number
  ): Promise<LocationInfo[]> {
    const locationInfos: LocationInfo[] = [];
    const seenPositions = new Set<string>();
    const data = tokens.data;
    
    let line = 0;
    let char = 0;
    let candidateCount = 0;
    let queriedCount = 0;
    let foundLocationCount = 0;

    for (let i = 0; i < data.length; i += 5) {
      try {
        if (i + 4 >= data.length) {
          this.log(`WARNING: Incomplete token data at index ${i}`);
          break;
        }

        const deltaLine = data[i];
        const deltaChar = data[i + 1];
        const length = data[i + 2];
        const tokenType = data[i + 3];

        if (deltaLine < 0 || deltaChar < 0 || length <= 0) {
          this.log(`WARNING: Invalid token data at index ${i}: deltaLine=${deltaLine}, deltaChar=${deltaChar}, length=${length}`);
          continue;
        }

        // Update position
        line += deltaLine;
        char = deltaLine === 0 ? char + deltaChar : deltaChar;

        // Skip tokens beyond document bounds
        if (line < 0 || line >= document.lineCount) {
          continue;
        }

        // We're interested in: 8=variable (includes methods), 12=parameter, 17=local variable/binding
        const isRelevant = tokenType === 8 || tokenType === 12 || tokenType === 17;
        
        if (!isRelevant) {
          continue;
        }

        const position = new vscode.Position(line, char);
        const range = new vscode.Range(line, char, line, char + length);

        // Validate range is within document bounds
        if (range.end.character > document.lineAt(line).text.length) {
          this.log(`WARNING: Token range extends beyond line length at line ${line}`);
          continue;
        }

        const name = document.getText(range);
        if (!name || name.length === 0) {
          continue;
        }

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

        const typeInfo = await this.getTypeAtPosition(document, position, isMethodCall, timeout);

        if (!typeInfo) {
          if (queriedCount <= 10) {
            this.log(`  No type info for '${name}' at ${line}:${char}`);
          }
          continue;
        }

        if (queriedCount <= 10) {
          this.log(`  Got type info for '${name}': "${typeInfo}"`);
        }

        // Check if it contains a Location type or is a sink operator
        const locationKind = this.parseLocationType(typeInfo);
        const isSink = await this.isSinkOperator(document, position, name, typeInfo, timeout);

        if (locationKind || isSink) {
          foundLocationCount++;
          
          const effectiveLocationKind = locationKind || 'Process<Leader>'; // Default for sink operators
          
          locationInfos.push({
            locationType: typeInfo,
            locationKind: effectiveLocationKind,
            range,
            operatorName: name,
            fullReturnType: typeInfo,
          });

          if (foundLocationCount <= 10) {
            this.log(`  Found location operator '${name}' with type: ${typeInfo}`);
          }
        }
      } catch (error) {
        this.log(`WARNING: Error processing token at index ${i}: ${error}`);
        continue;
      }
    }

    this.log(`Processed ${candidateCount} candidates, queried ${queriedCount}, found ${foundLocationCount} with Location types`);
    return locationInfos;
  }

  /**
   * Get semantic tokens from rust-analyzer
   */
  private async getSemanticTokens(
    document: vscode.TextDocument,
    timeout: number
  ): Promise<vscode.SemanticTokens | null> {
    try {
      if (!document || !document.uri) {
        this.log('ERROR: Document or document URI is null or undefined');
        return null;
      }

      const tokensPromise = vscode.commands.executeCommand<vscode.SemanticTokens>(
        'vscode.provideDocumentSemanticTokens',
        document.uri
      );

      const tokens = await Promise.race([
        tokensPromise,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        )
      ]);

      return tokens || null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        this.log(`WARNING: Semantic tokens query timed out after ${timeout}ms`);
      } else {
        this.log(`ERROR getting semantic tokens: ${error}`);
      }
      return null;
    }
  }

  /**
   * Query rust-analyzer for type information at a specific position
   */
  private async getTypeAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    isMethod: boolean = false,
    timeout: number = 5000
  ): Promise<string | null> {
    try {
      const hoverPromise = vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        position
      );

      const hovers = await Promise.race([
        hoverPromise,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        )
      ]);

      if (!hovers || hovers.length === 0) {
        return null;
      }

      // Extract type information from hover content
      for (const hover of hovers) {
        if (!hover || !hover.contents) continue;

        for (const content of hover.contents) {
          const contentStr = typeof content === 'string' ? content : content.value;
          if (!contentStr) continue;

          if (isMethod) {
            // For methods, find the code block with the function signature and extract return type
            const codeBlocks = contentStr.matchAll(/```rust\n([^`]+)\n```/g);
            for (const match of codeBlocks) {
              const blockText = match[1].trim();
              // Look for "pub fn method_name(...) -> ReturnType"
              const returnTypeMatch = blockText.match(/->\s*([^\n{]+?)(?:\s*where|\s*$)/s);
              if (returnTypeMatch) {
                let returnType = returnTypeMatch[1]?.replace(/\s+/g, ' ').trim();

                if (!returnType || returnType.length === 0) {
                  continue;
                }

                // Extract where clause once for reuse
                const whereClause = blockText.match(/where([^]*?)(?:\/\/|$)/s);

                // Handle qualified associated types like "<Self as ZipResult<'a, O>>::Out"
                if (returnType.includes('<Self as ') && returnType.includes('>::')) {
                  if (whereClause) {
                    const locationMatch = whereClause[1].match(/Location\s*=\s*([A-Z]\w*)/);
                    if (locationMatch) {
                      const locationParam = locationMatch[1];
                      const paramMatch = contentStr.match(
                        new RegExp(`\`${locationParam}\`\\s*=\\s*\`([^\`]+)\``)
                      );
                      if (paramMatch) {
                        returnType = paramMatch[1];
                      }
                    }
                  }
                }

                // Substitute generic type parameters with concrete types from where clause
                if (whereClause) {
                  const typeParams = returnType.match(/\b[A-Z]\w*\b/g);
                  if (typeParams) {
                    for (const param of typeParams) {
                      const concreteMatch = contentStr.match(
                        new RegExp(`\`${param}\`\\s*=\\s*\`([^\`]+)\``)
                      );
                      if (concreteMatch) {
                        const concreteType = concreteMatch[1];
                        returnType = returnType.replace(new RegExp(`\\b${param}\\b`, 'g'), concreteType);
                      }
                    }
                  }
                }

                return returnType;
              }
            }
            return null;
          } else {
            // For variables/parameters, extract type from first code block
            const typeMatch = contentStr.match(/```rust\n([^`]+)\n```/);
            if (typeMatch) {
              const fullDecl = typeMatch[1]?.trim();
              if (!fullDecl || fullDecl.length === 0) {
                continue;
              }

              // Extract just the type part after the colon
              const colonMatch = fullDecl.match(/:\s*(.+)$/);
              if (colonMatch) {
                const varType = colonMatch[1]?.trim();
                if (!varType || varType.length === 0) {
                  return fullDecl;
                }
                return varType;
              }

              return fullDecl;
            }
          }
        }
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        this.log(`WARNING: Type query timed out after ${timeout}ms`);
      } else {
        this.log(`ERROR querying type: ${error}`);
      }
      return null;
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
  private parseLocationType(fullType: string): string | null {
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
        const typeParams = this.parseTypeParameters(params);

        // For Stream, Optional, Singleton: location is 2nd parameter (index 1)
        // For KeyedStream, KeyedSingleton: location is 3rd parameter (index 2)
        const locationIndex = collectionMatch[1].startsWith('Keyed') ? 2 : 1;

        if (typeParams.length > locationIndex) {
          const locationParam = typeParams[locationIndex].trim();
          // Recursively parse the location parameter (it might be Tick<Process<...>>)
          return this.parseLocationType(locationParam);
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
        this.log(`WARNING: Error parsing location type from '${fullType}': ${error.message}`);
      } else {
        this.log(`WARNING: Unknown error parsing location type: ${String(error)}`);
      }
      return null;
    }
  }

  /**
   * Parse type parameters from a comma-separated list, respecting nested angle brackets and parentheses
   * Example: "T, Process<'a, Leader>, Unbounded" -> ["T", "Process<'a, Leader>", "Unbounded"]
   * Example: "(String, i32), Process<'a, Leader>" -> ["(String, i32)", "Process<'a, Leader>"]
   */
  private parseTypeParameters(params: string): string[] {
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
            this.log(`WARNING: Mismatched angle brackets in type parameters: ${params}`);
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
            this.log(`WARNING: Mismatched parentheses in type parameters: ${params}`);
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
        this.log(`WARNING: Unclosed angle brackets in type parameters: ${params} (depth: ${angleDepth})`);
      }
      if (parenDepth !== 0) {
        this.log(`WARNING: Unclosed parentheses in type parameters: ${params} (depth: ${parenDepth})`);
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        this.log(`WARNING: Error parsing type parameters from '${params}': ${error.message}`);
      } else {
        this.log(`WARNING: Unknown error parsing type parameters: ${String(error)}`);
      }
      return [];
    }
  }

  /**
   * Check if an operator is a sink operator by analyzing its signature
   */
  private async isSinkOperator(
    _document: vscode.TextDocument,
    _position: vscode.Position,
    _operatorName: string,
    returnType: string,
    _timeout: number
  ): Promise<boolean> {
    // Must return unit type to be a sink operator
    if (returnType !== '()') {
      return false;
    }

    // Additional signature analysis could be added here
    // For now, we trust that operators returning () are sinks
    return true;
  }

  /**
   * Cache management
   */
  private getCached(uri: string, version: number): LocationInfo[] | null {
    const entry = this.cache.get(uri);
    if (entry && entry.version === version) {
      this.cacheHits++;
      return entry.results;
    }
    this.cacheMisses++;
    return null;
  }

  private setCached(uri: string, version: number, results: LocationInfo[]): void {
    this.cache.set(uri, {
      version,
      results,
      timestamp: Date.now(),
    });
  }

  public clearCache(uri?: string): void {
    if (uri) {
      this.cache.delete(uri);
      this.log(`Cache cleared for ${uri}`);
    } else {
      this.cache.clear();
      this.log('Cache cleared');
    }
  }

  public getCacheStats(): CacheStats {
    const total = this.cacheHits + this.cacheMisses;
    const hitRatePercent = total > 0 ? Math.round((this.cacheHits / total) * 100) : 0;
    
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      numFiles: this.cache.size,
      hitRatePercent,
    };
  }
}