/**
 * Unit tests for stringUtils
 */

import { describe, it, expect } from 'vitest';
import {
  countTickDepth,
  buildTickLabel,
  extractLocationLabel,
  normalizeLocationKind,
  getLocationId,
} from '../analysis/stringUtils';

describe('String Utilities', () => {
  describe('countTickDepth', () => {
    it('should return 0 for non-Tick types', () => {
      expect(countTickDepth('Process<Leader>')).toBe(0);
      expect(countTickDepth('Cluster<Worker>')).toBe(0);
      expect(countTickDepth('External')).toBe(0);
    });

    it('should count single Tick wrapper', () => {
      expect(countTickDepth('Tick<Process<Leader>>')).toBe(1);
      expect(countTickDepth('Tick<Cluster<Worker>>')).toBe(1);
    });

    it('should count multiple Tick wrappers', () => {
      expect(countTickDepth('Tick<Tick<Process<Leader>>>')).toBe(2);
      expect(countTickDepth('Tick<Tick<Tick<Process<Leader>>>>')).toBe(3);
    });

    it('should handle whitespace', () => {
      expect(countTickDepth('  Tick<Process>  ')).toBe(1);
    });
  });

  describe('buildTickLabel', () => {
    it('should return base label for depth 0', () => {
      expect(buildTickLabel('Worker', 0)).toBe('Worker');
      expect(buildTickLabel('Leader', 0)).toBe('Leader');
    });

    it('should wrap with single Tick', () => {
      expect(buildTickLabel('Worker', 1)).toBe('Tick<Worker>');
    });

    it('should wrap with multiple Ticks', () => {
      expect(buildTickLabel('Worker', 2)).toBe('Tick<Tick<Worker>>');
      expect(buildTickLabel('Leader', 3)).toBe('Tick<Tick<Tick<Leader>>>');
    });

    it('should handle negative depth as 0', () => {
      expect(buildTickLabel('Worker', -1)).toBe('Worker');
    });
  });

  describe('extractLocationLabel', () => {
    it('should extract type parameter from Process', () => {
      expect(extractLocationLabel('Process<Leader>')).toBe('Leader');
      expect(extractLocationLabel('Process<Worker>')).toBe('Worker');
    });

    it('should extract type parameter from Cluster', () => {
      expect(extractLocationLabel('Cluster<Worker>')).toBe('Worker');
    });

    it('should extract type parameter from External', () => {
      expect(extractLocationLabel('External<Client>')).toBe('Client');
    });

    it('should strip Tick wrappers before extracting', () => {
      expect(extractLocationLabel('Tick<Process<Leader>>')).toBe('Leader');
      expect(extractLocationLabel('Tick<Tick<Process<Worker>>>')).toBe('Worker');
    });

    it('should return base type if no type parameter', () => {
      expect(extractLocationLabel('Process')).toBe('Process');
      expect(extractLocationLabel('Cluster')).toBe('Cluster');
    });

    it('should handle lifetime parameters', () => {
      expect(extractLocationLabel("Process<'a, Leader>")).toBe('Leader');
    });

    it('should return unknown for null', () => {
      expect(extractLocationLabel(null)).toBe('(unknown location)');
    });

    it('should return original for unrecognized patterns', () => {
      expect(extractLocationLabel('UnknownType<Something>')).toBe('UnknownType<Something>');
    });
  });

  describe('normalizeLocationKind', () => {
    it('should return unchanged for non-Tick types', () => {
      expect(normalizeLocationKind('Process<Leader>')).toBe('Process<Leader>');
      expect(normalizeLocationKind('Cluster<Worker>')).toBe('Cluster<Worker>');
    });

    it('should strip single Tick wrapper', () => {
      expect(normalizeLocationKind('Tick<Process<Leader>>')).toBe('Process<Leader>');
    });

    it('should strip multiple Tick wrappers', () => {
      expect(normalizeLocationKind('Tick<Tick<Process<Leader>>>')).toBe('Process<Leader>');
      expect(normalizeLocationKind('Tick<Tick<Tick<Cluster<Worker>>>>')).toBe('Cluster<Worker>');
    });
  });

  describe('getLocationId', () => {
    it('should return same ID for equivalent locations', () => {
      const id1 = getLocationId('Process<Leader>');
      const id2 = getLocationId('Process<Leader>');
      expect(id1).toBe(id2);
    });

    it('should return same ID for Tick-wrapped and unwrapped locations', () => {
      const id1 = getLocationId('Process<Leader>');
      const id2 = getLocationId('Tick<Process<Leader>>');
      const id3 = getLocationId('Tick<Tick<Process<Leader>>>');
      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it('should return different IDs for different locations', () => {
      const id1 = getLocationId('Process<Leader>');
      const id2 = getLocationId('Process<Worker>');
      expect(id1).not.toBe(id2);
    });

    it('should return positive integers', () => {
      const id = getLocationId('Process<Leader>');
      expect(id).toBeGreaterThan(0);
      expect(Number.isInteger(id)).toBe(true);
    });
  });
});
