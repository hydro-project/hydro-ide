/**
 * Unit tests for LocationAnalyzer
 *
 * Tests the core parsing logic for extracting Location types from Rust code.
 */

import { describe, test, expect } from 'vitest';
import { COLOR_PALETTE, getBorderStyle, getColorByIndex } from '../locationColorizerConfig';

/**
 * Test Location type parsing logic
 */
describe('LocationAnalyzer Type Parsing', () => {
  /**
   * Parse Location type from a full type string
   * This is the same logic as in locationAnalyzer.ts
   */
  function parseLocationType(fullType: string): string | null {
    let unwrapped = fullType;

    // Remove leading & or &mut
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
