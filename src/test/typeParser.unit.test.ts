/**
 * Unit tests for typeParser
 */

import { describe, it, expect } from 'vitest';
import {
  parseHydroTypeParameters,
  extractBoundedness,
  extractOrdering,
} from '../analysis/typeParser';

describe('Type Parser Utilities', () => {
  describe('parseHydroTypeParameters', () => {
    it('should parse simple type parameters', () => {
      expect(parseHydroTypeParameters('Stream<i32, Process, Bounded>')).toEqual([
        'i32',
        'Process',
        'Bounded',
      ]);
    });

    it('should handle nested generics', () => {
      expect(parseHydroTypeParameters("Stream<T, Process<'a>, Bounded>")).toEqual([
        'T',
        "Process<'a>",
        'Bounded',
      ]);
    });

    it('should handle deeply nested generics', () => {
      expect(parseHydroTypeParameters("Stream<T, Tick<Process<'a>>, Bounded>")).toEqual([
        'T',
        "Tick<Process<'a>>",
        'Bounded',
      ]);
    });

    it('should handle tuple types with parentheses', () => {
      expect(parseHydroTypeParameters("Stream<(String, u32), Process<'a>, Bounded>")).toEqual([
        '(String, u32)',
        "Process<'a>",
        'Bounded',
      ]);
    });

    it('should handle complex nested tuples', () => {
      expect(
        parseHydroTypeParameters("KeyedStream<K, (V, (i32, String)), Process<'a>, Bounded>")
      ).toEqual(['K', '(V, (i32, String))', "Process<'a>", 'Bounded']);
    });

    it('should return empty array for non-generic types', () => {
      expect(parseHydroTypeParameters('i32')).toEqual([]);
      expect(parseHydroTypeParameters('String')).toEqual([]);
    });

    it('should return empty array for malformed types', () => {
      expect(parseHydroTypeParameters('Stream<')).toEqual([]);
      expect(parseHydroTypeParameters('Stream>')).toEqual([]);
    });

    it('should handle types with many parameters', () => {
      expect(parseHydroTypeParameters('Stream<T, L, B, O, R>')).toEqual(['T', 'L', 'B', 'O', 'R']);
    });

    it('should trim whitespace', () => {
      expect(parseHydroTypeParameters('Stream< T , L , B >')).toEqual(['T', 'L', 'B']);
    });
  });

  describe('extractBoundedness', () => {
    it('should extract Bounded', () => {
      expect(extractBoundedness(['T', 'Process', 'Bounded', 'TotalOrder'])).toBe('Bounded');
    });

    it('should extract Unbounded', () => {
      expect(extractBoundedness(['T', 'Process', 'Unbounded', 'NoOrder'])).toBe('Unbounded');
    });

    it('should handle qualified Bounded paths', () => {
      expect(extractBoundedness(['T', 'L', 'Bounded::UnderlyingBound'])).toBe('Bounded');
    });

    it('should handle qualified Unbounded paths', () => {
      expect(extractBoundedness(['T', 'L', 'Unbounded::UnderlyingBound'])).toBe('Unbounded');
    });

    it('should default generic B parameter to Unbounded', () => {
      expect(extractBoundedness(['T', 'L', 'B', 'O'])).toBe('Unbounded');
    });

    it('should return null if no boundedness found', () => {
      expect(extractBoundedness(['T', 'Process', 'TotalOrder'])).toBeNull();
    });

    it('should return null for empty array', () => {
      expect(extractBoundedness([])).toBeNull();
    });

    it('should find first matching boundedness', () => {
      // Should return first match (Bounded), not process subsequent ones
      expect(extractBoundedness(['T', 'Bounded', 'Unbounded'])).toBe('Bounded');
    });
  });

  describe('extractOrdering', () => {
    it('should extract TotalOrder', () => {
      expect(extractOrdering(['T', 'Process', 'Bounded', 'TotalOrder'])).toBe('TotalOrder');
    });

    it('should extract NoOrder', () => {
      expect(extractOrdering(['T', 'Process', 'Unbounded', 'NoOrder'])).toBe('NoOrder');
    });

    it('should extract TotalOrder from string containing it', () => {
      expect(extractOrdering(['T', 'L', '<Stream as Trait<TotalOrder>>::Order'])).toBe(
        'TotalOrder'
      );
    });

    it('should extract NoOrder from string containing it', () => {
      expect(extractOrdering(['T', 'L', '<Stream as Trait<NoOrder>>::Order'])).toBe('NoOrder');
    });

    it('should default generic O parameter to NoOrder', () => {
      expect(extractOrdering(['T', 'L', 'B', 'O'])).toBe('NoOrder');
    });

    it('should return null if no ordering found', () => {
      expect(extractOrdering(['T', 'Process', 'Bounded'])).toBeNull();
    });

    it('should return null for empty array', () => {
      expect(extractOrdering([])).toBeNull();
    });

    it('should find first matching ordering', () => {
      // Should return first match (TotalOrder)
      expect(extractOrdering(['T', 'TotalOrder', 'NoOrder'])).toBe('TotalOrder');
    });

    it('should handle complex associated type patterns', () => {
      expect(
        extractOrdering([
          'T',
          'L',
          '<KeyedStream<K, V, L, B> as Trait<TotalOrder>>::OrderType',
        ])
      ).toBe('TotalOrder');
    });
  });

  describe('Integration: Full type parsing workflow', () => {
    it('should parse Stream type and extract boundedness and ordering', () => {
      const typeString = "Stream<i32, Process<'a>, Unbounded, TotalOrder, ExactlyOnce>";
      const params = parseHydroTypeParameters(typeString);
      
      expect(params).toHaveLength(5);
      expect(extractBoundedness(params)).toBe('Unbounded');
      expect(extractOrdering(params)).toBe('TotalOrder');
    });

    it('should parse KeyedStream with generic parameters', () => {
      const typeString = 'KeyedStream<K, V, L, B, O, R>';
      const params = parseHydroTypeParameters(typeString);
      
      expect(params).toEqual(['K', 'V', 'L', 'B', 'O', 'R']);
      expect(extractBoundedness(params)).toBe('Unbounded'); // B defaults to Unbounded
      expect(extractOrdering(params)).toBe('NoOrder'); // O defaults to NoOrder
    });

    it('should handle Singleton types', () => {
      const typeString = "Singleton<String, Process<'a>, Bounded>";
      const params = parseHydroTypeParameters(typeString);
      
      expect(params).toEqual(['String', "Process<'a>", 'Bounded']);
      expect(extractBoundedness(params)).toBe('Bounded');
      expect(extractOrdering(params)).toBeNull(); // No ordering specified
    });

    it('should handle complex nested types', () => {
      const typeString = "Stream<(K, V), Tick<Process<'a>>, Bounded, TotalOrder>";
      const params = parseHydroTypeParameters(typeString);
      
      expect(params).toHaveLength(4);
      expect(params[0]).toBe('(K, V)');
      expect(params[1]).toBe("Tick<Process<'a>>");
      expect(extractBoundedness(params)).toBe('Bounded');
      expect(extractOrdering(params)).toBe('TotalOrder');
    });
  });
});
