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
   *
   * NOTE: This method is primarily used by the legacy GraphExtractor-first strategy.
   * The modern hover-first approach uses analyzePositions() instead, which provides
   * better accuracy for instantiated generic types.
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
        this.log(
          `INFO: Skipping analysis - file too large (${document.lineCount} lines > ${maxFileSize} max)`
        );
        return [];
      }

      // Check cache first
      const uri = document.uri.toString();
      const cached = this.getCached(uri, document.version);
      if (cached) {
        this.log(
          `Cache hit for ${document.fileName} v${document.version} (${cached.length} locations)`
        );
        return cached;
      }

      this.log(`Cache miss for ${document.fileName} v${document.version}, analyzing...`);
      const startTime = Date.now();

      // Get semantic tokens and analyze
      const queryTimeout = config.get<number>('performance.queryTimeout', 5000);
      const tokens = await this.getSemanticTokens(document, queryTimeout);

      if (!tokens || !tokens.data || tokens.data.length === 0) {
        this.log(
          'WARNING: No semantic tokens available. rust-analyzer may not be ready or file may not be valid Rust code.'
        );
        return [];
      }

      this.log(`Got ${tokens.data.length / 5} semantic tokens`);

      const locationInfos = await this.analyzeSemanticTokens(document, tokens, queryTimeout);

      const duration = Date.now() - startTime;
      // Optionally augment with struct definitions for location type parameters (for colorization UX)
      try {
        const augmented = this.addStructDefinitions(document, locationInfos);
        this.log(
          `Found ${augmented.length} location-typed identifiers (incl. struct defs) in ${duration}ms`
        );
        // Cache results
        this.setCached(uri, document.version, augmented);
        return augmented;
      } catch (e) {
        this.log(`WARNING: Failed to augment struct definitions: ${e}`);
      }

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
   * Check if an operator name is a valid Hydro operator based on configuration
   */
  private isValidHydroOperator(operatorName: string): boolean {
    try {
      const config = vscode.workspace.getConfiguration('hydroIde.operators');
      const networkingOps = config.get<string[]>('networkingOperators', []);
      const coreOps = config.get<string[]>('coreDataflowOperators', []);
      const sinkOps = config.get<string[]>('sinkOperators', []);

      const allOperators = [...networkingOps, ...coreOps, ...sinkOps];
      return allOperators.includes(operatorName);
    } catch (error) {
      // If config access fails, allow the operator (conservative approach)
      return true;
    }
  }

  /**
   * Analyze specific positions in a document to find Location types
   *
   * This is the primary analysis method used by the hover-first strategy. It queries
   * LSP hover information at operator positions to obtain concrete instantiated types.
   *
   * This method ONLY uses hover information, skipping type definitions and definitions,
   * because those return generic signatures while hover shows concrete instantiated types.
   *
   * Includes chain propagation logic: operators returning Self or missing hover info
   * inherit the location type from the previous operator in a dot-chained sequence.
   *
   * @param document The document to analyze
   * @param positions Array of positions to check (typically operator call sites)
   * @returns LocationInfo for any positions that have Location types
   */
  public async analyzePositions(
    document: vscode.TextDocument,
    positions: Array<{ position: vscode.Position; operatorName: string }>,
    timeout: number = 5000
  ): Promise<LocationInfo[]> {
    const results: LocationInfo[] = [];

    this.log(`Analyzing ${positions.length} specific positions via hover...`);

    // Sort positions in source order to enable simple chain propagation heuristics
    const sorted = [...positions].sort(
      (a, b) => a.position.line - b.position.line || a.position.character - b.position.character
    );

    // Track last seen location kind within a dot-chained sequence
    let lastChainLocationKind: string | null = null;
    let inDotChain = false;

    for (const { position, operatorName } of sorted) {
      try {
        // Determine if this line is part of a dot-chained sequence (e.g., ".map(...)")
        const lineText = document.lineAt(position.line).text;
        const isDotChainLine = lineText.trimStart().startsWith('.');

        // Helper to add an inherited location result
        const addInheritedLocation = (reason: string) => {
          if (isDotChainLine && lastChainLocationKind && this.isValidHydroOperator(operatorName)) {
            const range = document.getWordRangeAtPosition(position);
            if (range) {
              results.push({
                locationType: '()', // For sink operators or Self returns
                locationKind: lastChainLocationKind,
                range,
                operatorName,
                fullReturnType: '()',
              });
              this.log(
                `  ✓ Inherited location type '${lastChainLocationKind}' for '${operatorName}' (${reason})`
              );
              return true;
            }
          }
          return false;
        };

        // Use ONLY hover for concrete types (skip type definitions which return generics)
        const typeString = await this.getTypeFromHover(document, position, true, timeout);

        if (!typeString) {
          // No hover info - might be a sink operator like for_each
          if (addInheritedLocation('no hover info, likely sink operator')) {
            continue;
          }

          this.log(
            `  No hover info for '${operatorName}' at ${position.line}:${position.character}`
          );
          continue;
        }

        this.log(`  Got hover type for '${operatorName}': "${typeString}"`);

        // Check if this looks like a generic type parameter that wasn't substituted
        if (/^(Process|Cluster|External)<'[^,>]+,\s*[A-Z]>$/.test(typeString)) {
          this.log(`  WARNING: Hover returned unsubstituted generic: "${typeString}"`);
          this.log(
            `    This suggests the where clause wasn't parsed or concrete type info is missing`
          );
        }

        // Reset chain tracking when we leave a chained line
        if (!isDotChainLine && inDotChain) {
          inDotChain = false;
          lastChainLocationKind = null;
        }

        // Parse location type if present
        const locationKind = this.parseLocationType(typeString);

        // Special-case: Some methods like `inspect` return Self; inherit prior chain kind
        if (!locationKind && /^&?Self\b/.test(typeString)) {
          if (addInheritedLocation('Self return type')) {
            continue;
          }
        }
        if (locationKind) {
          // Skip generic type parameters (single uppercase letters like P, C, L, etc.)
          // These appear in generic function signatures but aren't concrete location types
          if (/^(Process|Cluster|External)<[A-Z]>$/.test(locationKind)) {
            this.log(`  Skipping generic location type '${locationKind}' for '${operatorName}'`);
            continue;
          }

          // Get the range for this identifier
          const range = document.getWordRangeAtPosition(position);
          if (range) {
            results.push({
              locationType: typeString,
              locationKind,
              range,
              operatorName,
              fullReturnType: typeString,
            });
            this.log(`  ✓ Found location type '${locationKind}' for '${operatorName}'`);

            // Update chain tracking when in a dot-chain
            if (isDotChainLine) {
              inDotChain = true;
              lastChainLocationKind = locationKind;
            } else {
              // Not a chain line; reset propagation state
              inDotChain = false;
              lastChainLocationKind = null;
            }
          }
        } else {
          this.log(`  No location type found in: "${typeString}"`);
        }
      } catch (error) {
        this.log(`  Error analyzing position ${position.line}:${position.character}: ${error}`);
      }
    }

    this.log(`Hover analysis found ${results.length} location types`);
    return results;
  }

  /**
   * Find and add struct definition identifiers that correspond to location type parameters
   * This mirrors older behavior that highlighted the struct name used in Process<Struct>
   */
  private addStructDefinitions(
    document: vscode.TextDocument,
    locationInfos: LocationInfo[]
  ): LocationInfo[] {
    try {
      if (!locationInfos || locationInfos.length === 0) return locationInfos;

      const results = [...locationInfos];
      const seenKeys = new Set<string>();

      // Build set of struct names from location kinds like "Process<Leader>" -> Leader
      const structNames = new Set<string>();
      for (const info of locationInfos) {
        const match = info.locationKind?.match(/<([^>]+)>$/);
        if (match) {
          const structName = match[1].trim();
          if (structName && !structName.includes('…')) {
            structNames.add(structName);
          }
        }
      }

      if (structNames.size === 0) return results;

      // Scan document lines to find struct definitions and add entries
      for (const structName of structNames) {
        const pattern = new RegExp(`\\bstruct\\s+${structName}\\b`);
        for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
          const line = document.lineAt(lineNum);
          const match = pattern.exec(line.text);
          if (!match) continue;

          // Position struct name token range (after "struct ")
          const structKeywordMatch = line.text.match(/\bstruct\s+/);
          if (!structKeywordMatch) continue;
          const startCol = structKeywordMatch.index! + structKeywordMatch[0].length;
          const range = new vscode.Range(lineNum, startCol, lineNum, startCol + structName.length);

          const key = `${lineNum}:${startCol}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          // Deduce the corresponding locationKind that includes this struct name
          const lk =
            locationInfos.find((li) => li.locationKind?.includes(`<${structName}>`))
              ?.locationKind || `Process<${structName}>`;

          results.push({
            locationType: lk,
            locationKind: lk,
            range,
            operatorName: structName,
            fullReturnType: lk,
          });

          break; // Only first definition occurrence
        }
      }

      return results;
    } catch (error) {
      this.log(`WARNING: Error adding struct definitions: ${error}`);
      return locationInfos;
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
          this.log(
            `WARNING: Invalid token data at index ${i}: deltaLine=${deltaLine}, deltaChar=${deltaChar}, length=${length}`
          );
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
          // Prioritize method calls over variable references
          // For variables, only include if they have a return type that suggests they're operators
          const isLikelyOperator =
            isMethodCall ||
            typeInfo.includes('Stream<') ||
            typeInfo.includes('Singleton<') ||
            typeInfo.includes('Optional<') ||
            typeInfo.includes('KeyedStream<') ||
            typeInfo.includes('KeyedSingleton<') ||
            isSink;

          if (isLikelyOperator) {
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
          } else {
            if (foundLocationCount <= 10) {
              this.log(`  Skipped variable '${name}' (not an operator): ${typeInfo}`);
            }
          }
        }
      } catch (error) {
        this.log(`WARNING: Error processing token at index ${i}: ${error}`);
        continue;
      }
    }

    this.log(
      `Processed ${candidateCount} candidates, queried ${queriedCount}, found ${foundLocationCount} with Location types`
    );
    this.log(
      `  Method calls: ${locationInfos.filter((loc) => loc.operatorName && document.lineAt(loc.range.start.line).text[loc.range.start.character - 1] === '.').length}`
    );
    this.log(
      `  Variables: ${locationInfos.filter((loc) => loc.operatorName && document.lineAt(loc.range.start.line).text[loc.range.start.character - 1] !== '.').length}`
    );
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
        ),
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
   *
   * Used by the legacy GraphExtractor-first strategy. Tries multiple LSP queries
   * in order of preference:
   * 1. Type definition provider (may return generic signatures)
   * 2. Inlay hints (if available)
   * 3. Hover information (most reliable for concrete types)
   *
   * Note: The modern hover-first strategy calls getTypeFromHover() directly to
   * avoid generic type issues.
   */
  public async getTypeAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    isMethod: boolean = false,
    timeout: number = 5000
  ): Promise<string | null> {
    // Strategy 1: Try type definition provider first (might give complete type info)
    try {
      const typeDefInfo = await this.getTypeFromTypeDefinition(document, position, timeout);
      if (typeDefInfo) {
        this.log(`SUCCESS: Got complete type from type definition: ${typeDefInfo}`);
        return typeDefInfo;
      } else {
        this.log(`Type definition provider returned no results`);
      }
    } catch (error) {
      this.log(`WARNING: Type definition provider failed: ${error}`);
    }

    // Strategy 1b: Try definition provider (might give us the variable/function definition with complete type)
    try {
      const defInfo = await this.getTypeFromDefinition(document, position, timeout);
      if (defInfo) {
        this.log(`SUCCESS: Got complete type from definition: ${defInfo}`);
        return defInfo;
      } else {
        this.log(`Definition provider returned no results`);
      }
    } catch (error) {
      this.log(`WARNING: Definition provider failed: ${error}`);
    }

    // Strategy 2: Try inlay hints (more reliable for complex generic types)
    try {
      const inlayTypeInfo = await this.getTypeFromInlayHints(document, position);
      if (inlayTypeInfo) {
        return inlayTypeInfo;
      }
    } catch (error) {
      this.log(`WARNING: Inlay hints failed: ${error}`);
    }

    // Strategy 3: Fall back to hover information
    return this.getTypeFromHover(document, position, isMethod, timeout);
  }

  /**
   * Get type information from type definition provider (most complete method)
   *
   * This uses textDocument/typeDefinition to go to the type's definition,
   * then extracts the complete type information from the source code.
   */
  private async getTypeFromTypeDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    timeout: number = 5000
  ): Promise<string | null> {
    try {
      const typeDefPromise = vscode.commands.executeCommand<
        vscode.LocationLink[] | vscode.Location[]
      >('vscode.executeTypeDefinitionProvider', document.uri, position);

      const typeDefs = await Promise.race([
        typeDefPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      if (!typeDefs || typeDefs.length === 0) {
        this.log(
          `Type definition provider returned no results for position ${position.line}:${position.character}`
        );
        return null;
      }

      this.log(`Type definition provider returned ${typeDefs.length} results`);

      // Get the first type definition
      const typeDef = typeDefs[0];
      let targetUri: vscode.Uri;
      let targetRange: vscode.Range;

      // Handle both LocationLink and Location formats
      if ('targetUri' in typeDef) {
        // LocationLink format
        targetUri = typeDef.targetUri;
        targetRange = typeDef.targetRange;
      } else {
        // Location format
        targetUri = typeDef.uri;
        targetRange = typeDef.range;
      }

      // Open the target document and extract type information
      const targetDoc = await vscode.workspace.openTextDocument(targetUri);
      const typeDefText = targetDoc.getText(targetRange);

      // Parse the type definition to extract the complete type
      const completeType = this.extractCompleteTypeFromDefinition(
        typeDefText,
        targetDoc,
        targetRange
      );

      if (completeType) {
        this.log(`Extracted complete type from definition: ${completeType}`);
        return completeType;
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        this.log(`WARNING: Type definition query timed out after ${timeout}ms`);
      } else {
        this.log(`WARNING: Error getting type from type definition: ${error}`);
      }
      return null;
    }
  }

  /**
   * Extract complete type information from a type definition
   */
  private extractCompleteTypeFromDefinition(
    typeDefText: string,
    document: vscode.TextDocument,
    range: vscode.Range
  ): string | null {
    try {
      // Look for type alias definitions: type TypeName = CompleteType;
      const typeAliasMatch = typeDefText.match(/type\s+\w+\s*=\s*([^;]+);/);
      if (typeAliasMatch) {
        const completeType = typeAliasMatch[1].trim();
        if (this.isHydroType(completeType)) {
          return completeType;
        }
      }

      // Look for struct/enum definitions with generic parameters
      const structMatch = typeDefText.match(/(?:struct|enum)\s+(\w+)(<[^>]+>)?/);
      if (structMatch) {
        const typeName = structMatch[1];
        const generics = structMatch[2] || '';

        // For Hydro types, we might need to look at the context to get the complete instantiated type
        // This is a simplified approach - we might need more sophisticated parsing
        if (this.isHydroTypeName(typeName)) {
          // Try to get more context from surrounding lines
          const contextLines = this.getContextLines(document, range, 5);
          const contextType = this.extractTypeFromContext(contextLines, typeName);
          if (contextType) {
            return contextType;
          }

          // Fallback: return the basic type name with generics
          return `${typeName}${generics}`;
        }
      }

      // Look for impl blocks that might give us type information
      const implMatch = typeDefText.match(/impl(?:<[^>]+>)?\s+([^{]+)/);
      if (implMatch) {
        const implType = implMatch[1].trim();
        if (this.isHydroType(implType)) {
          return implType;
        }
      }

      return null;
    } catch (error) {
      this.log(`WARNING: Error extracting type from definition: ${error}`);
      return null;
    }
  }

  /**
   * Check if a type name (without generics) is a Hydro type
   */
  private isHydroTypeName(typeName: string): boolean {
    return [
      'Stream',
      'Singleton',
      'Optional',
      'KeyedStream',
      'KeyedSingleton',
      'Process',
      'Cluster',
      'External',
      'Tick',
    ].includes(typeName);
  }

  /**
   * Get context lines around a range
   */
  private getContextLines(
    document: vscode.TextDocument,
    range: vscode.Range,
    contextSize: number
  ): string[] {
    const startLine = Math.max(0, range.start.line - contextSize);
    const endLine = Math.min(document.lineCount - 1, range.end.line + contextSize);

    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(document.lineAt(i).text);
    }
    return lines;
  }

  /**
   * Extract type information from context lines
   */
  private extractTypeFromContext(contextLines: string[], typeName: string): string | null {
    // Look for variable declarations or return types that might give us the complete type
    for (const line of contextLines) {
      // Look for patterns like: let var: CompleteType = ...
      const varDeclMatch = line.match(new RegExp(`let\\s+\\w+\\s*:\\s*([^=]+?)\\s*=`));
      if (varDeclMatch) {
        const declaredType = varDeclMatch[1].trim();
        if (declaredType.includes(typeName) && this.isHydroType(declaredType)) {
          return declaredType;
        }
      }

      // Look for function return types: fn name() -> CompleteType
      const fnReturnMatch = line.match(/fn\s+\w+[^)]*\)\s*->\s*([^{]+)/);
      if (fnReturnMatch) {
        const returnType = fnReturnMatch[1].trim();
        if (returnType.includes(typeName) && this.isHydroType(returnType)) {
          return returnType;
        }
      }
    }

    return null;
  }

  /**
   * Get type information from definition provider
   *
   * This uses textDocument/definition to go to the symbol's definition,
   * then extracts type information from variable declarations or function signatures.
   */
  private async getTypeFromDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    timeout: number = 5000
  ): Promise<string | null> {
    try {
      const defPromise = vscode.commands.executeCommand<vscode.LocationLink[] | vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        position
      );

      const definitions = await Promise.race([
        defPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      if (!definitions || definitions.length === 0) {
        this.log(
          `Definition provider returned no results for position ${position.line}:${position.character}`
        );
        return null;
      }

      this.log(`Definition provider returned ${definitions.length} results`);

      // Get the first definition
      const definition = definitions[0];
      let targetUri: vscode.Uri;
      let targetRange: vscode.Range;

      // Handle both LocationLink and Location formats
      if ('targetUri' in definition) {
        // LocationLink format
        targetUri = definition.targetUri;
        targetRange = definition.targetRange;
      } else {
        // Location format
        targetUri = definition.uri;
        targetRange = definition.range;
      }

      // Open the target document and extract type information
      const targetDoc = await vscode.workspace.openTextDocument(targetUri);

      // Get a larger context around the definition to capture complete type information
      const contextRange = new vscode.Range(
        Math.max(0, targetRange.start.line - 2),
        0,
        Math.min(targetDoc.lineCount - 1, targetRange.end.line + 2),
        1000
      );

      const contextText = targetDoc.getText(contextRange);

      // Extract type information from the definition context
      const completeType = this.extractTypeFromDefinitionContext(contextText, targetRange);

      if (completeType) {
        this.log(`Extracted complete type from definition context: ${completeType}`);
        return completeType;
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        this.log(`WARNING: Definition query timed out after ${timeout}ms`);
      } else {
        this.log(`WARNING: Error getting type from definition: ${error}`);
      }
      return null;
    }
  }

  /**
   * Extract type information from definition context
   */
  private extractTypeFromDefinitionContext(
    contextText: string,
    _targetRange: vscode.Range
  ): string | null {
    try {
      const lines = contextText.split('\n');

      // Look for variable declarations with explicit types
      for (const line of lines) {
        // Pattern: let variable_name: CompleteType = ...
        const letMatch = line.match(/let\s+\w+\s*:\s*([^=]+?)\s*=/);
        if (letMatch) {
          const declaredType = letMatch[1].trim();
          if (this.isHydroType(declaredType)) {
            return declaredType;
          }
        }

        // Pattern: fn function_name(...) -> CompleteType
        const fnMatch = line.match(/fn\s+\w+[^)]*\)\s*->\s*([^{;]+)/);
        if (fnMatch) {
          const returnType = fnMatch[1].trim();
          if (this.isHydroType(returnType)) {
            return returnType;
          }
        }

        // Pattern: field: CompleteType (in struct definitions)
        const fieldMatch = line.match(/^\s*\w+\s*:\s*([^,}]+)/);
        if (fieldMatch) {
          const fieldType = fieldMatch[1].trim();
          if (this.isHydroType(fieldType)) {
            return fieldType;
          }
        }

        // Pattern: const CONSTANT: CompleteType = ...
        const constMatch = line.match(/const\s+\w+\s*:\s*([^=]+?)\s*=/);
        if (constMatch) {
          const constType = constMatch[1].trim();
          if (this.isHydroType(constType)) {
            return constType;
          }
        }
      }

      return null;
    } catch (error) {
      this.log(`WARNING: Error extracting type from definition context: ${error}`);
      return null;
    }
  }

  /**
   * Get type information from inlay hints
   *
   * Inlay hints may provide type information when other LSP queries don't.
   * Used by getTypeAtPosition() as an intermediate strategy.
   */
  private async getTypeFromInlayHints(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string | null> {
    try {
      // Get inlay hints for a small range around the position
      const range = new vscode.Range(
        Math.max(0, position.line - 1),
        0,
        Math.min(document.lineCount - 1, position.line + 1),
        1000
      );

      const inlayHints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        document.uri,
        range
      );

      if (!inlayHints || inlayHints.length === 0) {
        return null;
      }

      // Find the inlay hint that corresponds to our position
      // Look for hints that are at or near our target position
      for (const hint of inlayHints) {
        const hintLine = hint.position.line;
        const hintChar = hint.position.character;

        // Check if this hint is close to our target position
        if (Math.abs(hintLine - position.line) <= 1) {
          const hintText =
            typeof hint.label === 'string'
              ? hint.label
              : hint.label.map((p) => (typeof p === 'string' ? p : p.value)).join('');

          // Check if this looks like a Hydro type
          if (this.isHydroType(hintText)) {
            // Verify this hint is for the identifier we're looking for
            const lineText = document.lineAt(position.line).text;
            const identifierAtPos = this.getIdentifierAtPosition(lineText, position.character);

            if (identifierAtPos) {
              // Check if the hint position makes sense for this identifier
              const identifierEnd = position.character + identifierAtPos.length;
              if (hintChar >= identifierEnd - 5 && hintChar <= identifierEnd + 10) {
                return hintText;
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      this.log(`WARNING: Error getting type from inlay hints: ${error}`);
      return null;
    }
  }

  /**
   * Check if a type string looks like a Hydro type
   */
  private isHydroType(typeString: string): boolean {
    return (
      typeString.includes('Stream<') ||
      typeString.includes('Singleton<') ||
      typeString.includes('Optional<') ||
      typeString.includes('KeyedStream<') ||
      typeString.includes('KeyedSingleton<') ||
      typeString.includes('Process<') ||
      typeString.includes('Cluster<') ||
      typeString.includes('External<') ||
      typeString.includes('Tick<')
    );
  }

  /**
   * Get the identifier at a specific character position in a line
   */
  private getIdentifierAtPosition(lineText: string, character: number): string | null {
    // Find word boundaries around the character position
    let start = character;
    let end = character;

    // Move start backwards to find the beginning of the identifier
    while (start > 0 && /\w/.test(lineText[start - 1])) {
      start--;
    }

    // Move end forwards to find the end of the identifier
    while (end < lineText.length && /\w/.test(lineText[end])) {
      end++;
    }

    if (start < end) {
      return lineText.substring(start, end);
    }

    return null;
  }

  /**
   * Get type information from hover
   *
   * Hover information typically provides the most accurate concrete types for
   * instantiated generics (e.g., Process<Leader> instead of Process<P>).
   * This is the primary query method used by analyzePositions().
   *
   * Also used as the final strategy in getTypeAtPosition() when other methods fail.
   */
  private async getTypeFromHover(
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
        ),
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

          // DEBUG: Log first 500 chars of hover content to see if where clause is present
          if (contentStr.length > 100) {
            this.log(
              `    [DEBUG] Hover content (first 500 chars): ${contentStr.substring(0, 500)}`
            );
          }

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
                        returnType = returnType.replace(
                          new RegExp(`\\b${param}\\b`, 'g'),
                          concreteType
                        );
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
  public parseLocationType(fullType: string): string | null {
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
        this.log(
          `WARNING: Unclosed angle brackets in type parameters: ${params} (depth: ${angleDepth})`
        );
      }
      if (parenDepth !== 0) {
        this.log(
          `WARNING: Unclosed parentheses in type parameters: ${params} (depth: ${parenDepth})`
        );
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
  public async isSinkOperator(
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
