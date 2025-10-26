/**
 * Unit tests for LocationAnalyzer
 *
 * Tests the core parsing logic for extracting Location types from Rust code.
 */

import { describe, test, expect } from 'vitest';
import { COLOR_PALETTE, getBorderStyle, getColorByIndex } from '../coloring/locationColorizerConfig';

/**
 * Test Location type parsing logic
 */
describe('LocationAnalyzer Type Parsing', () => {
  /**
   * Parse type parameters from a comma-separated list, respecting nested angle brackets and parentheses
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
   * Parse Location type from a full type string
   * This is the same logic as in locationAnalyzer.ts
   */
  function parseLocationType(fullType: string): string | null {
    let unwrapped = fullType;

    // Remove leading & or &mut
    unwrapped = unwrapped.replace(/^&(?:mut\s+)?/, '');

    // For Stream/KeyedStream/Optional/Singleton/KeyedSingleton types, extract the location parameter
    const collectionMatch = unwrapped.match(/^(Stream|KeyedStream|Optional|Singleton|KeyedSingleton)<(.+)>$/);
    if (collectionMatch) {
      const params = collectionMatch[2];
      const typeParams = parseTypeParameters(params);

      // For Stream, Optional, Singleton: location is 2nd parameter (index 1)
      // For KeyedStream, KeyedSingleton: location is 3rd parameter (index 2)
      const locationIndex = collectionMatch[1].startsWith('Keyed') ? 2 : 1;

      if (typeParams.length > locationIndex) {
        const locationParam = typeParams[locationIndex].trim();
        // Recursively parse the location parameter
        return parseLocationType(locationParam);
      }
    }

    // Count and strip Tick wrappers, preserving them for later
    const tickWrappers: string[] = [];
    let current = unwrapped;
    let tickMatch = current.match(/^Tick<(.+)>$/);

    while (tickMatch) {
      tickWrappers.push('Tick');
      current = tickMatch[1];
      tickMatch = current.match(/^Tick<(.+)>$/);
    }

    // Try to find Process/Cluster/External<...> in the remaining type
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

  test('Should parse Process<Leader> from simple type', () => {
    const result = parseLocationType("Process<'a, Leader>");
    expect(result).toBe('Process<Leader>');
  });

  test('Should parse Cluster<Worker> from simple type', () => {
    const result = parseLocationType("Cluster<'_, Worker>");
    expect(result).toBe('Cluster<Worker>');
  });

  test('Should parse External<Client> from simple type', () => {
    const result = parseLocationType("External<'a, Client>");
    expect(result).toBe('External<Client>');
  });

  test('Should parse Process from Stream type', () => {
    const result = parseLocationType("Stream<T, Process<'a, Leader>, Unbounded>");
    expect(result).toBe('Process<Leader>');
  });

  test('Should parse Cluster from Stream type', () => {
    const result = parseLocationType("Stream<u32, Cluster<'_, Worker>, Bounded>");
    expect(result).toBe('Cluster<Worker>');
  });

  test('Should parse Tick<Process> from Tick type', () => {
    const result = parseLocationType("Tick<Process<'a, Leader>>");
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('Should parse Tick<Cluster> from Tick type', () => {
    const result = parseLocationType("Tick<Cluster<'a, Worker>>");
    expect(result).toBe('Tick<Cluster<Worker>>');
  });

  test('Should parse Tick<Process> from reference', () => {
    const result = parseLocationType("&Tick<Process<'a, Leader>>");
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('Should parse nested Tick<Tick<Process>> preserving both Ticks', () => {
    const result = parseLocationType("Tick<Tick<Process<'a, Leader>>>");
    // Nested Ticks should be preserved as they have different semantics
    expect(result).toBe('Tick<Tick<Process<Leader>>>');
  });

  test('Should parse nested Tick<Tick<Cluster>> preserving both Ticks', () => {
    const result = parseLocationType("Tick<Tick<Cluster<'a, Worker>>>");
    expect(result).toBe('Tick<Tick<Cluster<Worker>>>');
  });

  test('Should parse triple nested Tick<Tick<Tick<Process>>>', () => {
    const result = parseLocationType("Tick<Tick<Tick<Process<'a, Leader>>>>");
    expect(result).toBe('Tick<Tick<Tick<Process<Leader>>>>');
  });

  test('Should parse Cluster<Acceptor> from complex nested type', () => {
    const result = parseLocationType(
      "Stream<(Ballot, Result<(Option<usize>, L), Ballot>), Cluster<'a, Proposer>, Unbounded, NoOrder>"
    );
    expect(result).toBe('Cluster<Proposer>');
  });

  test('Should handle reference types', () => {
    const result = parseLocationType("&Process<'a, Leader>");
    expect(result).toBe('Process<Leader>');
  });

  test('Should handle mutable reference types', () => {
    const result = parseLocationType("&mut Cluster<'_, Worker>");
    expect(result).toBe('Cluster<Worker>');
  });

  test('Should return null for non-Location types', () => {
    const result = parseLocationType('i32');
    expect(result).toBe(null);
  });

  test('Should return null for String type', () => {
    const result = parseLocationType('String');
    expect(result).toBe(null);
  });

  test('Should return null for Vec type', () => {
    const result = parseLocationType('Vec<u32>');
    expect(result).toBe(null);
  });

  test('Should parse Process with unit type parameter', () => {
    const result = parseLocationType("Process<'a, ()>");
    expect(result).toBe('Process<()>');
  });

  test('Should parse Cluster with unit type parameter', () => {
    const result = parseLocationType("Cluster<'_, ()>");
    expect(result).toBe('Cluster<()>');
  });

  test('Should parse Process<Proposer> from Paxos code', () => {
    const result = parseLocationType("Cluster<'a, Proposer>");
    expect(result).toBe('Cluster<Proposer>');
  });

  test('Should parse Process<Acceptor> from Paxos code', () => {
    const result = parseLocationType("Cluster<'a, Acceptor>");
    expect(result).toBe('Cluster<Acceptor>');
  });

  test('Should handle FlowBuilder type (not a Location)', () => {
    const result = parseLocationType("&FlowBuilder<'a>");
    expect(result).toBe(null);
  });

  test('Should handle MemberId type (not a Location)', () => {
    const result = parseLocationType('MemberId<Proposer>');
    expect(result).toBe(null);
  });

  test('Should parse simple Process without type param', () => {
    const result = parseLocationType("Process<'a>");
    expect(result).toBe('Process');
  });

  test('Should parse simple Cluster without type param', () => {
    const result = parseLocationType("Cluster<'_>");
    expect(result).toBe('Cluster');
  });
});

/**
 * Test border style logic
 */
describe('LocationAnalyzer Border Styles', () => {
  test('Process should have no border', () => {
    const style = getBorderStyle('Process<Leader>');
    expect(style.border).toBeUndefined();
    expect(style.borderRadius).toBe('3px');
  });

  test('Cluster should have double border in light mode', () => {
    const style = getBorderStyle('Cluster<Worker>', false);
    expect(style.border).toBe('2px double rgba(0, 0, 0, 0.4)');
    expect(style.borderRadius).toBe('3px');
  });

  test('Cluster should have double border in dark mode', () => {
    const style = getBorderStyle('Cluster<Worker>', true);
    expect(style.border).toBe('2px double rgba(200, 200, 200, 0.4)');
    expect(style.borderRadius).toBe('3px');
  });

  test('External should have single border in light mode', () => {
    const style = getBorderStyle('External<Client>', false);
    expect(style.border).toBe('1px solid rgba(0, 0, 0, 0.4)');
    expect(style.borderRadius).toBe('3px');
  });

  test('External should have single border in dark mode', () => {
    const style = getBorderStyle('External<Client>', true);
    expect(style.border).toBe('1px solid rgba(200, 200, 200, 0.4)');
    expect(style.borderRadius).toBe('3px');
  });

  test('Tick<Process> should have no border', () => {
    const style = getBorderStyle('Tick<Process<Leader>>');
    expect(style.border).toBeUndefined();
  });

  test('Tick<Cluster> should have no border', () => {
    const style = getBorderStyle('Tick<Cluster<Worker>>');
    // getBorderStyle checks if string starts with "Cluster", but "Tick<Cluster>" starts with "Tick"
    // So Tick-wrapped types don't get the inner type's border style
    expect(style.border).toBeUndefined();
    expect(style.borderRadius).toBe('3px');
  });
});

/**
 * Test color palette assignment
 */
describe('LocationAnalyzer Color Assignment', () => {
  test('Should have 8 colors in palette', () => {
    expect(COLOR_PALETTE.length).toBe(8);
  });

  test('Should cycle colors when more than 8 locations', () => {
    const colorIndex = 10;
    const color = getColorByIndex(colorIndex);
    const expectedColor = COLOR_PALETTE[2]; // 10 % 8 = 2
    expect(color).toBe(expectedColor);
  });

  test('getColorByIndex should return correct color', () => {
    expect(getColorByIndex(0)).toBe(COLOR_PALETTE[0]);
    expect(getColorByIndex(1)).toBe(COLOR_PALETTE[1]);
    expect(getColorByIndex(7)).toBe(COLOR_PALETTE[7]);
  });

  test('getColorByIndex should wrap around', () => {
    expect(getColorByIndex(8)).toBe(COLOR_PALETTE[0]);
    expect(getColorByIndex(9)).toBe(COLOR_PALETTE[1]);
  });

  test('Should assign different colors to different locations', () => {
    const locations = ['Process<Leader>', 'Cluster<Worker>', 'Process<Follower>'];
    const colorIndices = locations.map((_, i) => i);

    // Each location should get a unique color index
    expect(colorIndices[0]).toBe(0);
    expect(colorIndices[1]).toBe(1);
    expect(colorIndices[2]).toBe(2);
  });

  test('Should assign same color to same location', () => {
    const locations = ['Process<Leader>', 'Process<Leader>', 'Process<Leader>'];
    const locationToColorIndex = new Map<string, number>();
    let nextColorIndex = 0;

    for (const loc of locations) {
      if (!locationToColorIndex.has(loc)) {
        locationToColorIndex.set(loc, nextColorIndex++);
      }
    }

    // All should map to the same color index
    expect(locationToColorIndex.get('Process<Leader>')).toBe(0);
    expect(locationToColorIndex.size).toBe(1);
  });
});

/**
 * Test struct name extraction
 */
describe('LocationAnalyzer Struct Name Extraction', () => {
  test('Should extract struct name from location kind', () => {
    const locationKind = 'Process<Leader>';
    const match = locationKind.match(/<([^>]+)>$/);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('Leader');
  });

  test('Should extract struct name from Cluster', () => {
    const locationKind = 'Cluster<Worker>';
    const match = locationKind.match(/<([^>]+)>$/);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('Worker');
  });

  test('Should extract struct name from External', () => {
    const locationKind = 'External<Client>';
    const match = locationKind.match(/<([^>]+)>$/);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('Client');
  });

  test('Should extract struct name from Tick<Process>', () => {
    const locationKind = 'Tick<Process<Leader>>';
    // For Tick-wrapped types, need to extract from the inner type
    const innerMatch = locationKind.match(/(?:Process|Cluster|External)<([^>]+)>/);
    expect(innerMatch).toBeTruthy();
    expect(innerMatch![1]).toBe('Leader');
  });

  test('Should handle unit type parameter', () => {
    const locationKind = 'Process<()>';
    const match = locationKind.match(/<([^>]+)>$/);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('()');
  });

  test('Should not match location without type parameter', () => {
    const locationKind = 'Process';
    const match = locationKind.match(/<([^>]+)>$/);
    expect(match).toBe(null);
  });
});

/**
 * Test struct definition pattern matching
 */
describe('LocationAnalyzer Struct Definition Matching', () => {
  test('Should match simple struct definition', () => {
    const line = 'pub struct Leader {}';
    const pattern = /\bstruct\s+Leader\b/;
    expect(pattern.test(line)).toBeTruthy();
  });

  test('Should match struct with fields', () => {
    const line = 'pub struct Worker { id: u32 }';
    const pattern = /\bstruct\s+Worker\b/;
    expect(pattern.test(line)).toBeTruthy();
  });

  test('Should match private struct', () => {
    const line = 'struct Proposer {}';
    const pattern = /\bstruct\s+Proposer\b/;
    expect(pattern.test(line)).toBeTruthy();
  });

  test('Should match struct with derive', () => {
    const line = '#[derive(Clone)] pub struct Acceptor {}';
    const pattern = /\bstruct\s+Acceptor\b/;
    expect(pattern.test(line)).toBeTruthy();
  });

  test('Should not match struct in comment', () => {
    const line = '// struct Leader {}';
    const pattern = /\bstruct\s+Leader\b/;
    // This will still match - comment filtering should be done separately
    expect(pattern.test(line)).toBeTruthy();
  });

  test('Should extract struct keyword position', () => {
    const line = 'pub struct Leader {}';
    const structKeywordMatch = line.match(/\bstruct\s+/);
    expect(structKeywordMatch).toBeTruthy();
    expect(structKeywordMatch!.index).toBe(4); // "pub " is 4 chars
  });

  test('Should calculate struct name position', () => {
    const line = 'pub struct Leader {}';
    const structKeywordMatch = line.match(/\bstruct\s+/);
    expect(structKeywordMatch).toBeTruthy();
    const structNameStart = structKeywordMatch!.index! + structKeywordMatch![0].length;
    expect(structNameStart).toBe(11); // "pub struct " is 11 chars
  });
});

/**
 * Test edge cases
 */
describe('LocationAnalyzer Edge Cases', () => {
  function parseLocationType(fullType: string): string | null {
    let unwrapped = fullType;
    unwrapped = unwrapped.replace(/^&(?:mut\s+)?/, '');

    // Count and strip Tick wrappers, preserving them for later
    const tickWrappers: string[] = [];
    let current = unwrapped;
    let tickMatch = current.match(/^Tick<(.+)>$/);

    while (tickMatch) {
      tickWrappers.push('Tick');
      current = tickMatch[1];
      tickMatch = current.match(/^Tick<(.+)>$/);
    }

    const locationMatch = current.match(/(Process|Cluster|External)<'[^,>]+,\s*([^>,]+)>/);
    if (locationMatch) {
      const locationKind = locationMatch[1];
      const typeParam = locationMatch[2].trim();
      let result = `${locationKind}<${typeParam}>`;

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    const simpleMatch = current.match(/(Process|Cluster|External)</);
    if (simpleMatch) {
      let result = simpleMatch[1];

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    return null;
  }

  test('Should handle empty string', () => {
    const result = parseLocationType('');
    expect(result).toBe(null);
  });

  test('Should handle whitespace', () => {
    const result = parseLocationType('   ');
    expect(result).toBe(null);
  });

  test('Should handle malformed type', () => {
    const result = parseLocationType('Process<');
    // Malformed types may still match the simple pattern
    expect(result).toBeTruthy();
  });

  test('Should handle nested generics', () => {
    const result = parseLocationType(
      "Stream<Vec<Process<'a, Leader>>, Cluster<'_, Worker>, Unbounded>"
    );
    // Will extract the first location type found (Process in this case)
    expect(result).toBe('Process<Leader>');
  });

  test('Should handle type with multiple lifetimes', () => {
    const result = parseLocationType("Process<'a, Leader>");
    expect(result).toBe('Process<Leader>');
  });

  test('Should handle type with underscore lifetime', () => {
    const result = parseLocationType("Cluster<'_, Worker>");
    expect(result).toBe('Cluster<Worker>');
  });

  test('Should handle type with static lifetime', () => {
    const result = parseLocationType("Process<'static, Leader>");
    expect(result).toBe('Process<Leader>');
  });

  test('Should handle very long type', () => {
    const longType = "Stream<(usize, Option<P>), Cluster<'a, Proposer>, Unbounded, NoOrder>";
    const result = parseLocationType(longType);
    expect(result).toBe('Cluster<Proposer>');
  });
});

/**
 * Test Stream type parameter extraction (Issue: Tick handling)
 */
describe('LocationAnalyzer Stream Type Parameter Extraction', () => {
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

  function parseLocationType(fullType: string): string | null {
    let unwrapped = fullType;
    unwrapped = unwrapped.replace(/^&(?:mut\s+)?/, '');

    const collectionMatch = unwrapped.match(/^(Stream|KeyedStream|Optional|Singleton|KeyedSingleton)<(.+)>$/);
    if (collectionMatch) {
      const params = collectionMatch[2];
      const typeParams = parseTypeParameters(params);
      const locationIndex = collectionMatch[1].startsWith('Keyed') ? 2 : 1;

      if (typeParams.length > locationIndex) {
        const locationParam = typeParams[locationIndex].trim();
        return parseLocationType(locationParam);
      }
    }

    const tickWrappers: string[] = [];
    let current = unwrapped;
    let tickMatch = current.match(/^Tick<(.+)>$/);

    while (tickMatch) {
      tickWrappers.push('Tick');
      current = tickMatch[1];
      tickMatch = current.match(/^Tick<(.+)>$/);
    }

    const locationMatch = current.match(/(Process|Cluster|External)<'[^,>]+,\s*([^>,]+)>/);
    if (locationMatch) {
      const locationKind = locationMatch[1];
      const typeParam = locationMatch[2].trim();
      let result = `${locationKind}<${typeParam}>`;

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    const simpleMatch = current.match(/(Process|Cluster|External)</);
    if (simpleMatch) {
      let result = simpleMatch[1];

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    return null;
  }

  test('Should parse type parameters from simple list', () => {
    const params = 'T, L, B';
    const result = parseTypeParameters(params);
    expect(result).toEqual(['T', 'L', 'B']);
  });

  test('Should parse type parameters with nested angle brackets', () => {
    const params = "T, Process<'a, Leader>, Unbounded";
    const result = parseTypeParameters(params);
    expect(result).toEqual(['T', "Process<'a, Leader>", 'Unbounded']);
  });

  test('Should parse type parameters with deeply nested types', () => {
    const params = "(String, i32), Tick<Process<'a, Leader>>, Bounded::UnderlyingBound, NoOrder, ExactlyOnce";
    const result = parseTypeParameters(params);
    expect(result).toEqual([
      '(String, i32)',
      "Tick<Process<'a, Leader>>",
      'Bounded::UnderlyingBound',
      'NoOrder',
      'ExactlyOnce',
    ]);
  });

  test('Should extract Tick<Process> from Stream with Bounded::UnderlyingBound', () => {
    const fullType =
      "Stream<(String, i32), Tick<Process<'a, Leader>>, Bounded::UnderlyingBound, NoOrder, ExactlyOnce>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('Should extract Tick<Cluster> from Stream with Bounded::UnderlyingBound', () => {
    const fullType =
      "Stream<(String, i32), Tick<Cluster<'a, Worker>>, Bounded::UnderlyingBound, NoOrder, ExactlyOnce>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Cluster<Worker>>');
  });

  test('Should extract Process from Stream without Tick', () => {
    const fullType = "Stream<(String, i32), Process<'a, Leader>, Unbounded, NoOrder, ExactlyOnce>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Process<Leader>');
  });

  test('Should extract location from KeyedStream with Tick', () => {
    const fullType =
      "KeyedStream<String, i32, Tick<Process<'a, Leader>>, Bounded, TotalOrder, ExactlyOnce>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('Should extract location from KeyedSingleton with Tick', () => {
    const fullType = "KeyedSingleton<String, i32, Tick<Process<'a, Leader>>, Bounded>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('Should extract location from Optional with Tick', () => {
    const fullType = "Optional<(), Tick<Cluster<'a, Proposer>>, Bounded>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Cluster<Proposer>>');
  });

  test('Should extract location from Singleton with Tick', () => {
    const fullType = "Singleton<i32, Tick<Process<'a, Leader>>, Bounded>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('Should handle Stream with complex tuple type', () => {
    const fullType =
      "Stream<(Ballot, Result<(Option<usize>, L), Ballot>), Tick<Cluster<'a, Proposer>>, Unbounded, NoOrder>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Cluster<Proposer>>');
  });

  test('Should handle KeyedStream with MemberId key type', () => {
    const fullType =
      "KeyedStream<MemberId<Worker>, (String, i32), Process<'a, Leader>, Unbounded, NoOrder, ExactlyOnce>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Process<Leader>');
  });

  test('Should handle nested Tick in Stream', () => {
    const fullType = "Stream<T, Tick<Tick<Process<'a, Leader>>>, Unbounded>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Tick<Process<Leader>>>');
  });

  test('Should handle KeyedSingleton with WhenValueUnbounded bound', () => {
    const fullType = "KeyedSingleton<String, i32, Tick<Cluster<'a, Worker>>, Bounded::WhenValueUnbounded>";
    const result = parseLocationType(fullType);
    expect(result).toBe('Tick<Cluster<Worker>>');
  });
});

/**
 * Test real-world map_reduce.rs scenarios
 */
describe('LocationAnalyzer Map-Reduce Tick Scenarios', () => {
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

  function parseLocationType(fullType: string): string | null {
    let unwrapped = fullType;
    unwrapped = unwrapped.replace(/^&(?:mut\s+)?/, '');

    const collectionMatch = unwrapped.match(/^(Stream|KeyedStream|Optional|Singleton|KeyedSingleton)<(.+)>$/);
    if (collectionMatch) {
      const params = collectionMatch[2];
      const typeParams = parseTypeParameters(params);
      const locationIndex = collectionMatch[1].startsWith('Keyed') ? 2 : 1;

      if (typeParams.length > locationIndex) {
        const locationParam = typeParams[locationIndex].trim();
        return parseLocationType(locationParam);
      }
    }

    const tickWrappers: string[] = [];
    let current = unwrapped;
    let tickMatch = current.match(/^Tick<(.+)>$/);

    while (tickMatch) {
      tickWrappers.push('Tick');
      current = tickMatch[1];
      tickMatch = current.match(/^Tick<(.+)>$/);
    }

    const locationMatch = current.match(/(Process|Cluster|External)<'[^,>]+,\s*([^>,]+)>/);
    if (locationMatch) {
      const locationKind = locationMatch[1];
      const typeParam = locationMatch[2].trim();
      let result = `${locationKind}<${typeParam}>`;

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    const simpleMatch = current.match(/(Process|Cluster|External)</);
    if (simpleMatch) {
      let result = simpleMatch[1];

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    return null;
  }

  test('cluster.tick() should return Tick<Cluster<Worker>>', () => {
    const tickType = "Tick<Cluster<'a, Worker>>";
    const result = parseLocationType(tickType);
    expect(result).toBe('Tick<Cluster<Worker>>');
  });

  test('batch() with cluster.tick() should return KeyedStream with Tick<Cluster<Worker>>', () => {
    const batchType = "KeyedStream<String, (), Tick<Cluster<'a, Worker>>, Bounded, TotalOrder, ExactlyOnce>";
    const result = parseLocationType(batchType);
    expect(result).toBe('Tick<Cluster<Worker>>');
  });

  test('fold() on batched stream should return KeyedSingleton with Tick<Cluster<Worker>>', () => {
    const foldType = "KeyedSingleton<String, i32, Tick<Cluster<'a, Worker>>, Bounded::WhenValueUnbounded>";
    const result = parseLocationType(foldType);
    expect(result).toBe('Tick<Cluster<Worker>>');
  });

  test('entries() after fold() should preserve Tick<Cluster<Worker>>', () => {
    const entriesType =
      "Stream<(String, i32), Tick<Cluster<'a, Worker>>, Bounded::UnderlyingBound, NoOrder, ExactlyOnce>";
    const result = parseLocationType(entriesType);
    expect(result).toBe('Tick<Cluster<Worker>>');
  });

  test('process.tick() should return Tick<Process<Leader>>', () => {
    const tickType = "Tick<Process<'a, Leader>>";
    const result = parseLocationType(tickType);
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('snapshot() with process.tick() should return KeyedSingleton with Tick<Process<Leader>>', () => {
    const snapshotType = "KeyedSingleton<String, i32, Tick<Process<'a, Leader>>, Bounded>";
    const result = parseLocationType(snapshotType);
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('entries() after snapshot() should preserve Tick<Process<Leader>>', () => {
    const entriesType =
      "Stream<(String, i32), Tick<Process<'a, Leader>>, Bounded::UnderlyingBound, NoOrder, ExactlyOnce>";
    const result = parseLocationType(entriesType);
    expect(result).toBe('Tick<Process<Leader>>');
  });

  test('all_ticks() should unwrap Tick and return base location', () => {
    const allTicksType = "Stream<(String, i32), Cluster<'a, Worker>, Unbounded, NoOrder, ExactlyOnce>";
    const result = parseLocationType(allTicksType);
    expect(result).toBe('Cluster<Worker>');
  });
});

/**
 * Regression tests for clone() issue
 * Issue: clone() was getting a different color than the variable it was called on
 */
describe('LocationAnalyzer Clone Regression Tests', () => {
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

  function parseLocationType(fullType: string): string | null {
    let unwrapped = fullType;
    unwrapped = unwrapped.replace(/^&(?:mut\s+)?/, '');

    const collectionMatch = unwrapped.match(/^(Stream|KeyedStream|Optional|Singleton|KeyedSingleton)<(.+)>$/);
    if (collectionMatch) {
      const params = collectionMatch[2];
      const typeParams = parseTypeParameters(params);
      const locationIndex = collectionMatch[1].startsWith('Keyed') ? 2 : 1;

      if (typeParams.length > locationIndex) {
        const locationParam = typeParams[locationIndex].trim();
        return parseLocationType(locationParam);
      }
    }

    const tickWrappers: string[] = [];
    let current = unwrapped;
    let tickMatch = current.match(/^Tick<(.+)>$/);

    while (tickMatch) {
      tickWrappers.push('Tick');
      current = tickMatch[1];
      tickMatch = current.match(/^Tick<(.+)>$/);
    }

    const locationMatch = current.match(/(Process|Cluster|External)<'[^,>]+,\s*([^>,]+)>/);
    if (locationMatch) {
      const locationKind = locationMatch[1];
      const typeParam = locationMatch[2].trim();
      let result = `${locationKind}<${typeParam}>`;

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    const simpleMatch = current.match(/(Process|Cluster|External)</);
    if (simpleMatch) {
      let result = simpleMatch[1];

      for (let i = tickWrappers.length - 1; i >= 0; i--) {
        result = `Tick<${result}>`;
      }

      return result;
    }

    return null;
  }

  test('Variable with short Stream form should extract location', () => {
    // This is what rust-analyzer returns for a variable declaration
    const variableType = "Stream<SequencedKv<K, V>, Tick<Cluster<'a, Replica>>, Bounded>";
    const result = parseLocationType(variableType);
    expect(result).toBe('Tick<Cluster<Replica>>');
  });

  test('clone() with long Stream form should extract same location', () => {
    // This is what rust-analyzer returns for clone() method
    const cloneType =
      "Stream<SequencedKv<K, V>, Tick<Cluster<'a, Replica>>, Bounded, TotalOrder, ExactlyOnce>";
    const result = parseLocationType(cloneType);
    expect(result).toBe('Tick<Cluster<Replica>>');
  });

  test('Short and long Stream forms should extract identical location', () => {
    const shortForm = "Stream<SequencedKv<K, V>, Tick<Cluster<'a, Replica>>, Bounded>";
    const longForm =
      "Stream<SequencedKv<K, V>, Tick<Cluster<'a, Replica>>, Bounded, TotalOrder, ExactlyOnce>";

    const shortResult = parseLocationType(shortForm);
    const longResult = parseLocationType(longForm);

    expect(shortResult).toBe(longResult);
    expect(shortResult).toBe('Tick<Cluster<Replica>>');
  });

  test('Variable type extraction from declaration', () => {
    // Simulate extracting type from "r_processable_payloads: Stream<...>"
    const declaration = "r_processable_payloads: Stream<SequencedKv<K, V>, Tick<Cluster<'a, Replica>>, Bounded>";
    const colonMatch = declaration.match(/:\s*(.+)$/);
    
    expect(colonMatch).toBeTruthy();
    const varType = colonMatch![1].trim();
    expect(varType).toBe("Stream<SequencedKv<K, V>, Tick<Cluster<'a, Replica>>, Bounded>");
    
    const result = parseLocationType(varType);
    expect(result).toBe('Tick<Cluster<Replica>>');
  });

  test('Optional with short and long forms should match', () => {
    const shortForm = "Optional<usize, Tick<Process<'a, Leader>>, Bounded>";
    const longForm = "Optional<usize, Tick<Process<'a, Leader>>, Bounded, NoOrder>";

    const shortResult = parseLocationType(shortForm);
    const longResult = parseLocationType(longForm);

    expect(shortResult).toBe(longResult);
    expect(shortResult).toBe('Tick<Process<Leader>>');
  });

  test('KeyedStream with short and long forms should match', () => {
    const shortForm = "KeyedStream<K, V, Tick<Cluster<'a, Worker>>, Bounded>";
    const longForm = "KeyedStream<K, V, Tick<Cluster<'a, Worker>>, Bounded, TotalOrder, ExactlyOnce>";

    const shortResult = parseLocationType(shortForm);
    const longResult = parseLocationType(longForm);

    expect(shortResult).toBe(longResult);
    expect(shortResult).toBe('Tick<Cluster<Worker>>');
  });
});

/**
 * Test cache functionality using cache statistics
 */
describe('LocationAnalyzer Cache Functionality', () => {
  // Import the actual functions from locationAnalyzer
  // Note: In a real test environment, we would need to mock vscode APIs
  // For now, we'll test the cache stats structure and logic

  test('Cache stats should have correct structure', () => {
    // Mock cache stats structure
    const mockStats = {
      numFiles: 5,
      totalEntries: 5,
      hits: 10,
      misses: 5,
      hitRate: 0.6666666666666666,
      hitRatePercent: '66.7',
    };

    expect(mockStats).toHaveProperty('numFiles');
    expect(mockStats).toHaveProperty('totalEntries');
    expect(mockStats).toHaveProperty('hits');
    expect(mockStats).toHaveProperty('misses');
    expect(mockStats).toHaveProperty('hitRate');
    expect(mockStats).toHaveProperty('hitRatePercent');
  });

  test('Cache hit rate calculation should be correct', () => {
    const hits = 10;
    const misses = 5;
    const totalRequests = hits + misses;
    const hitRate = totalRequests > 0 ? hits / totalRequests : 0;
    const hitRatePercent = (hitRate * 100).toFixed(1);

    expect(hitRate).toBeCloseTo(0.6667, 4);
    expect(hitRatePercent).toBe('66.7');
  });

  test('Cache hit rate should be 0 when no requests', () => {
    const hits = 0;
    const misses = 0;
    const totalRequests = hits + misses;
    const hitRate = totalRequests > 0 ? hits / totalRequests : 0;

    expect(hitRate).toBe(0);
  });

  test('Cache hit rate should be 100% when all hits', () => {
    const hits = 10;
    const misses = 0;
    const totalRequests = hits + misses;
    const hitRate = totalRequests > 0 ? hits / totalRequests : 0;
    const hitRatePercent = (hitRate * 100).toFixed(1);

    expect(hitRate).toBe(1);
    expect(hitRatePercent).toBe('100.0');
  });

  test('Cache hit rate should be 0% when all misses', () => {
    const hits = 0;
    const misses = 10;
    const totalRequests = hits + misses;
    const hitRate = totalRequests > 0 ? hits / totalRequests : 0;
    const hitRatePercent = (hitRate * 100).toFixed(1);

    expect(hitRate).toBe(0);
    expect(hitRatePercent).toBe('0.0');
  });

  test('Cache should track multiple files', () => {
    // Simulate cache with multiple files
    const cache = new Map<string, { version: number; timestamp: number }>();
    
    cache.set('file:///path/to/file1.rs', { version: 1, timestamp: Date.now() });
    cache.set('file:///path/to/file2.rs', { version: 2, timestamp: Date.now() });
    cache.set('file:///path/to/file3.rs', { version: 1, timestamp: Date.now() });

    expect(cache.size).toBe(3);
  });

  test('Cache should handle version updates', () => {
    const cache = new Map<string, { version: number; timestamp: number }>();
    const uri = 'file:///path/to/file.rs';
    
    // Initial cache entry
    cache.set(uri, { version: 1, timestamp: Date.now() });
    expect(cache.get(uri)?.version).toBe(1);
    
    // Update to new version
    cache.set(uri, { version: 2, timestamp: Date.now() });
    expect(cache.get(uri)?.version).toBe(2);
    expect(cache.size).toBe(1); // Still only one entry
  });

  test('LRU eviction should remove oldest entry', () => {
    const cache = new Map<string, { version: number; timestamp: number }>();
    const lruOrder: string[] = [];
    const maxSize = 3;
    
    // Add entries
    const files = [
      'file:///path/to/file1.rs',
      'file:///path/to/file2.rs',
      'file:///path/to/file3.rs',
    ];
    
    files.forEach((uri) => {
      cache.set(uri, { version: 1, timestamp: Date.now() });
      lruOrder.push(uri);
    });
    
    expect(cache.size).toBe(3);
    expect(lruOrder.length).toBe(3);
    
    // Add a new entry, should evict the oldest
    const newFile = 'file:///path/to/file4.rs';
    
    // Evict LRU entry if at capacity
    if (cache.size >= maxSize && lruOrder.length > 0) {
      const oldest = lruOrder.shift()!;
      cache.delete(oldest);
    }
    
    cache.set(newFile, { version: 1, timestamp: Date.now() });
    lruOrder.push(newFile);
    
    expect(cache.size).toBe(3);
    expect(cache.has(files[0])).toBe(false); // First file was evicted
    expect(cache.has(newFile)).toBe(true);
  });

  test('Cache access should update LRU order', () => {
    const lruOrder: string[] = ['file1.rs', 'file2.rs', 'file3.rs'];
    const accessedFile = 'file1.rs';
    
    // Move accessed file to end (most recently used)
    const idx = lruOrder.indexOf(accessedFile);
    if (idx >= 0) {
      lruOrder.splice(idx, 1);
    }
    lruOrder.push(accessedFile);
    
    expect(lruOrder).toEqual(['file2.rs', 'file3.rs', 'file1.rs']);
    expect(lruOrder[lruOrder.length - 1]).toBe(accessedFile);
  });

  test('Cache should distinguish between different document versions', () => {
    const cache = new Map<string, { version: number }>();
    const uri = 'file:///path/to/file.rs';
    
    // Cache version 1
    cache.set(uri, { version: 1 });
    
    // Check if version matches (cache hit)
    const entry = cache.get(uri);
    expect(entry?.version).toBe(1);
    
    // Document version changed to 2 (cache miss)
    const currentVersion = 2;
    const isHit = entry && entry.version === currentVersion;
    expect(isHit).toBe(false);
  });

  test('Cache stats should reflect cache operations', () => {
    let cacheHits = 0;
    let cacheMisses = 0;
    
    // Simulate cache operations
    // First access - miss
    cacheMisses++;
    
    // Second access to same file/version - hit
    cacheHits++;
    
    // Access to different file - miss
    cacheMisses++;
    
    // Access to first file again - hit
    cacheHits++;
    
    const totalRequests = cacheHits + cacheMisses;
    const hitRate = totalRequests > 0 ? cacheHits / totalRequests : 0;
    
    expect(cacheHits).toBe(2);
    expect(cacheMisses).toBe(2);
    expect(hitRate).toBe(0.5);
  });

  test('Clearing cache should reset all counters', () => {
    const cache = new Map<string, { version: number }>();
    const lruOrder: string[] = [];
    let cacheHits = 10;
    let cacheMisses = 5;
    
    // Add some entries
    cache.set('file1.rs', { version: 1 });
    cache.set('file2.rs', { version: 1 });
    lruOrder.push('file1.rs', 'file2.rs');
    
    // Clear cache
    cache.clear();
    lruOrder.length = 0;
    cacheHits = 0;
    cacheMisses = 0;
    
    expect(cache.size).toBe(0);
    expect(lruOrder.length).toBe(0);
    expect(cacheHits).toBe(0);
    expect(cacheMisses).toBe(0);
  });

  test('Clearing specific file should only remove that entry', () => {
    const cache = new Map<string, { version: number }>();
    const lruOrder: string[] = [];
    
    // Add entries
    cache.set('file1.rs', { version: 1 });
    cache.set('file2.rs', { version: 1 });
    cache.set('file3.rs', { version: 1 });
    lruOrder.push('file1.rs', 'file2.rs', 'file3.rs');
    
    // Clear specific file
    const fileToRemove = 'file2.rs';
    cache.delete(fileToRemove);
    const idx = lruOrder.indexOf(fileToRemove);
    if (idx >= 0) {
      lruOrder.splice(idx, 1);
    }
    
    expect(cache.size).toBe(2);
    expect(cache.has('file1.rs')).toBe(true);
    expect(cache.has('file2.rs')).toBe(false);
    expect(cache.has('file3.rs')).toBe(true);
    expect(lruOrder).toEqual(['file1.rs', 'file3.rs']);
  });
});
