/**
 * Type parsing utilities for Hydro type system analysis
 *
 * Provides utilities for:
 * - Parsing generic type parameters from Hydro types
 * - Extracting boundedness information (Bounded/Unbounded)
 * - Extracting ordering information (TotalOrder/NoOrder)
 */

/**
 * Parse generic type parameters from a Hydro type string
 *
 * Handles nested generics and correctly splits parameters at commas,
 * accounting for angle bracket depth and parenthesis depth.
 *
 * @param typeString The type string (e.g., "Stream<T, Process<'a>, Bounded, TotalOrder>")
 * @returns Array of type parameter strings
 *
 * @example
 * parseHydroTypeParameters("Stream<i32, Process<'a>, Bounded>")
 * // => ["i32", "Process<'a>", "Bounded"]
 *
 * parseHydroTypeParameters("KeyedStream<K, V, L, B>")
 * // => ["K", "V", "L", "B"]
 *
 * parseHydroTypeParameters("Singleton<(String, u32), Tick<Process<'a>>, Bounded>")
 * // => ["(String, u32)", "Tick<Process<'a>>", "Bounded"]
 */
export function parseHydroTypeParameters(typeString: string): string[] {
  try {
    // Find the main generic part: Type<...>
    const match = typeString.match(/^[^<]+<(.+)>$/);
    if (!match) {
      return [];
    }

    const params = match[1];
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

    return result;
  } catch (error) {
    // On error, return empty array
    return [];
  }
}

/**
 * Extract boundedness information from type parameters
 *
 * Handles:
 * - Simple forms: Bounded, Unbounded
 * - Qualified paths: Bounded::UnderlyingBound
 * - Generic type parameters: B (defaults to Unbounded)
 *
 * @param typeParams Array of type parameters from parseHydroTypeParameters
 * @returns Boundedness string or null if not found
 *
 * @example
 * extractBoundedness(["i32", "Process<'a>", "Bounded", "TotalOrder"])
 * // => "Bounded"
 *
 * extractBoundedness(["T", "L", "Unbounded", "NoOrder"])
 * // => "Unbounded"
 *
 * extractBoundedness(["T", "L", "B", "O"])  // Generic parameter B
 * // => "Unbounded"  // Default for generic B
 */
export function extractBoundedness(typeParams: string[]): string | null {
  for (const param of typeParams) {
    const trimmed = param.trim();

    if (trimmed.startsWith('Bounded')) {
      return 'Bounded';
    } else if (trimmed.startsWith('Unbounded')) {
      return 'Unbounded';
    }

    // Handle generic type parameters for boundedness
    // In Hydro, the boundedness parameter is typically named B
    if (trimmed === 'B' || trimmed.match(/^B\b/)) {
      // For generic B parameter, default to Unbounded (most common case)
      return 'Unbounded';
    }
  }
  return null;
}

/**
 * Extract ordering information from type parameters
 *
 * Handles:
 * - Simple forms: TotalOrder, NoOrder
 * - Complex associated types: <Type as Trait<TotalOrder>>::AssociatedType
 * - Generic type parameters: O (defaults to NoOrder)
 *
 * @param typeParams Array of type parameters from parseHydroTypeParameters
 * @returns Ordering string or null if not found
 *
 * @example
 * extractOrdering(["i32", "Process<'a>", "Bounded", "TotalOrder"])
 * // => "TotalOrder"
 *
 * extractOrdering(["T", "L", "B", "NoOrder"])
 * // => "NoOrder"
 *
 * extractOrdering(["T", "L", "B", "O"])  // Generic parameter O
 * // => "NoOrder"  // Default for generic O
 *
 * extractOrdering(["<Stream as Trait<TotalOrder>>::Order"])
 * // => "TotalOrder"  // Extracted from associated type
 */
export function extractOrdering(typeParams: string[]): string | null {
  for (const param of typeParams) {
    const trimmed = param.trim();

    // Check for TotalOrder variants (including associated types)
    if (trimmed === 'TotalOrder' || trimmed.includes('TotalOrder')) {
      return 'TotalOrder';
    }

    // Check for NoOrder variants (including associated types)
    if (trimmed === 'NoOrder' || trimmed.includes('NoOrder')) {
      return 'NoOrder';
    }

    // Handle generic type parameters for ordering
    // In Hydro, the ordering parameter is typically named O
    if (trimmed === 'O' || trimmed.match(/^O\b/)) {
      // For generic O parameter, default to NoOrder (most common case)
      return 'NoOrder';
    }

    // Handle associated types that resolve to ordering types
    // Pattern: <SomeType as SomeTrait<OrderingType>>::AssociatedType
    const associatedTypeMatch = trimmed.match(/<[^>]*as[^>]*<([^>]*)>[^>]*>::/);
    if (associatedTypeMatch) {
      const innerType = associatedTypeMatch[1];
      if (innerType.includes('TotalOrder')) {
        return 'TotalOrder';
      }
      if (innerType.includes('NoOrder')) {
        return 'NoOrder';
      }
    }
  }
  return null;
}
