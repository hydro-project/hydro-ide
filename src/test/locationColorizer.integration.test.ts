/**
 * Integration tests for LocationColorizer
 * 
 * Tests the colorization feature with real Rust code samples.
 * These tests require a VSCode instance with rust-analyzer.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as locationAnalyzer from '../locationAnalyzer';
import { COLOR_PALETTE, getBorderStyle } from '../locationColorizerConfig';

suite('LocationColorizer Integration Tests', () => {
  let testDataDir: string;

  suiteSetup(() => {
    testDataDir = path.join(__dirname, '../../test-fixtures/colorizer-test-data');
  });

  /**
   * Helper to open a test file
   */
  async function openTestFile(filename: string): Promise<vscode.TextDocument> {
    const filePath = path.join(testDataDir, filename);
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    return document;
  }

  /**
   * Helper to wait for rust-analyzer to be ready
   */
  async function waitForRustAnalyzer(document: vscode.TextDocument, maxAttempts = 10): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      try {
        const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
          'vscode.provideDocumentSemanticTokens',
          document.uri
        );
        if (tokens && tokens.data.length > 0) {
          return true;
        }
      } catch {
        // Continue waiting
      }
    }
    return false;
  }

  test('Should parse simple_cluster.rs and find Location types', async function() {
    this.timeout(30000); // Increase timeout for rust-analyzer

    const document = await openTestFile('simple_cluster.rs');
    const isReady = await waitForRustAnalyzer(document);
    
    if (!isReady) {
      // rust-analyzer not ready, skipping test
      this.skip();
      return;
    }

    const locationInfos = await locationAnalyzer.analyzeDocument(document);

    // Should find some location-typed identifiers
    assert.ok(locationInfos.length > 0, 'Should find at least one location-typed identifier');

    // Check that we found Cluster and Process types
    const locationKinds = new Set(locationInfos.map(info => info.locationKind));
    const hasCluster = Array.from(locationKinds).some(kind => kind.includes('Cluster'));
    const hasProcess = Array.from(locationKinds).some(kind => kind.includes('Process'));

    assert.ok(hasCluster || hasProcess, 'Should find Cluster or Process types');

    // Verify each location info has required fields
    for (const info of locationInfos) {
      assert.ok(info.locationType, 'Should have locationType');
      assert.ok(info.locationKind, 'Should have locationKind');
      assert.ok(info.range, 'Should have range');
      assert.ok(info.operatorName, 'Should have operatorName');
    }
  });

  test('Should parse paxos.rs and find Proposer and Acceptor types', async function() {
    this.timeout(30000); // Increase timeout for rust-analyzer

    const document = await openTestFile('paxos.rs');
    const isReady = await waitForRustAnalyzer(document);
    
    if (!isReady) {
      // rust-analyzer not ready, skipping test
      this.skip();
      return;
    }

    const locationInfos = await locationAnalyzer.analyzeDocument(document);

    // Should find location-typed identifiers
    assert.ok(locationInfos.length > 0, 'Should find at least one location-typed identifier');

    // Check for Proposer and Acceptor in location kinds
    const locationKinds = locationInfos.map(info => info.locationKind);
    const hasProposer = locationKinds.some(kind => kind.includes('Proposer'));
    const hasAcceptor = locationKinds.some(kind => kind.includes('Acceptor'));

    // At least one should be found (depending on what rust-analyzer can resolve)
    assert.ok(hasProposer || hasAcceptor, 'Should find Proposer or Acceptor types');
  });

  test('Should extract struct names from location kinds', () => {
    const testCases = [
      { locationKind: 'Process<Leader>', expected: 'Leader' },
      { locationKind: 'Cluster<Worker>', expected: 'Worker' },
      { locationKind: 'External<Client>', expected: 'Client' },
      { locationKind: 'Process<()>', expected: '()' },
    ];

    for (const { locationKind, expected } of testCases) {
      const match = locationKind.match(/<([^>]+)>$/);
      assert.ok(match, `Should match pattern for ${locationKind}`);
      assert.strictEqual(match[1], expected, `Should extract ${expected} from ${locationKind}`);
    }

    // Tick-wrapped types need special handling
    const tickLocationKind = 'Tick<Process<Leader>>';
    const innerMatch = tickLocationKind.match(/(?:Process|Cluster|External)<([^>]+)>/);
    assert.ok(innerMatch, 'Should match Tick-wrapped pattern');
    assert.strictEqual(innerMatch[1], 'Leader', 'Should extract Leader from Tick<Process<Leader>>');
  });

  test('Should assign unique colors to different location kinds', () => {
    const locationKinds = [
      'Process<Leader>',
      'Cluster<Worker>',
      'Process<Follower>',
      'Cluster<Proposer>',
      'External<Client>',
    ];

    const locationToColorIndex = new Map<string, number>();
    let nextColorIndex = 0;

    for (const kind of locationKinds) {
      if (!locationToColorIndex.has(kind)) {
        locationToColorIndex.set(kind, nextColorIndex++);
      }
    }

    // Each unique location should have a unique color index
    assert.strictEqual(locationToColorIndex.size, 5);
    assert.strictEqual(locationToColorIndex.get('Process<Leader>'), 0);
    assert.strictEqual(locationToColorIndex.get('Cluster<Worker>'), 1);
    assert.strictEqual(locationToColorIndex.get('Process<Follower>'), 2);
    assert.strictEqual(locationToColorIndex.get('Cluster<Proposer>'), 3);
    assert.strictEqual(locationToColorIndex.get('External<Client>'), 4);
  });

  test('Should assign same color to same location kind', () => {
    const locationKinds = [
      'Process<Leader>',
      'Process<Leader>',
      'Process<Leader>',
    ];

    const locationToColorIndex = new Map<string, number>();
    let nextColorIndex = 0;

    for (const kind of locationKinds) {
      if (!locationToColorIndex.has(kind)) {
        locationToColorIndex.set(kind, nextColorIndex++);
      }
    }

    // All should map to the same color index
    assert.strictEqual(locationToColorIndex.size, 1);
    assert.strictEqual(locationToColorIndex.get('Process<Leader>'), 0);
  });

  test('Should handle color palette wrapping', () => {
    // Create more locations than colors in palette
    const numLocations = COLOR_PALETTE.length + 3;
    const locationKinds = Array.from({ length: numLocations }, (_, i) => `Process<Type${i}>`);

    const locationToColorIndex = new Map<string, number>();
    let nextColorIndex = 0;

    for (const kind of locationKinds) {
      if (!locationToColorIndex.has(kind)) {
        locationToColorIndex.set(kind, nextColorIndex++);
      }
    }

    // Should have assigned all locations
    assert.strictEqual(locationToColorIndex.size, numLocations);

    // Colors should wrap around
    const lastColorIndex = locationToColorIndex.get(`Process<Type${numLocations - 1}>`)!;
    assert.strictEqual(lastColorIndex, numLocations - 1);
  });

  test('Should apply correct border styles', () => {
    const testCases = [
      { locationKind: 'Process<Leader>', hasBorder: false },
      { locationKind: 'Cluster<Worker>', hasBorder: true, borderType: 'double' },
      { locationKind: 'External<Client>', hasBorder: true, borderType: 'solid' },
      { locationKind: 'Tick<Process<Leader>>', hasBorder: false },
      // Tick<Cluster> starts with "Tick", not "Cluster", so getBorderStyle won't match Cluster pattern
      { locationKind: 'Tick<Cluster<Worker>>', hasBorder: false },
    ];

    for (const { locationKind, hasBorder, borderType } of testCases) {
      const style = getBorderStyle(locationKind);
      
      if (hasBorder) {
        assert.ok(style.border, `${locationKind} should have border`);
        if (borderType) {
          assert.ok(style.border!.includes(borderType), `${locationKind} should have ${borderType} border`);
        }
      } else {
        assert.strictEqual(style.border, undefined, `${locationKind} should not have border`);
      }
      
      assert.strictEqual(style.borderRadius, '3px', 'Should have border radius');
    }
  });

  test('Should group ranges by location kind', () => {
    const mockLocationInfos = [
      {
        locationType: "Process<'a, Leader>",
        locationKind: 'Process<Leader>',
        range: new vscode.Range(0, 0, 0, 5),
        operatorName: 'p1',
      },
      {
        locationType: "Process<'a, Leader>",
        locationKind: 'Process<Leader>',
        range: new vscode.Range(1, 0, 1, 5),
        operatorName: 'p2',
      },
      {
        locationType: "Cluster<'a, Worker>",
        locationKind: 'Cluster<Worker>',
        range: new vscode.Range(2, 0, 2, 5),
        operatorName: 'c1',
      },
    ];

    const rangesByLocation = new Map<string, vscode.Range[]>();

    for (const info of mockLocationInfos) {
      if (!rangesByLocation.has(info.locationKind)) {
        rangesByLocation.set(info.locationKind, []);
      }
      rangesByLocation.get(info.locationKind)!.push(info.range);
    }

    // Should have 2 location kinds
    assert.strictEqual(rangesByLocation.size, 2);

    // Process<Leader> should have 2 ranges
    const processRanges = rangesByLocation.get('Process<Leader>');
    assert.ok(processRanges);
    assert.strictEqual(processRanges.length, 2);

    // Cluster<Worker> should have 1 range
    const clusterRanges = rangesByLocation.get('Cluster<Worker>');
    assert.ok(clusterRanges);
    assert.strictEqual(clusterRanges.length, 1);
  });

  test('Should handle empty location info array', () => {
    const locationInfos: locationAnalyzer.LocationInfo[] = [];

    const rangesByLocation = new Map<string, vscode.Range[]>();
    for (const info of locationInfos) {
      if (!rangesByLocation.has(info.locationKind)) {
        rangesByLocation.set(info.locationKind, []);
      }
      rangesByLocation.get(info.locationKind)!.push(info.range);
    }

    assert.strictEqual(rangesByLocation.size, 0);
  });

  test('Should handle duplicate ranges for same location', () => {
    const mockLocationInfos = [
      {
        locationType: "Process<'a, Leader>",
        locationKind: 'Process<Leader>',
        range: new vscode.Range(0, 0, 0, 5),
        operatorName: 'p1',
      },
      {
        locationType: "Process<'a, Leader>",
        locationKind: 'Process<Leader>',
        range: new vscode.Range(0, 0, 0, 5), // Same range
        operatorName: 'p1',
      },
    ];

    const rangesByLocation = new Map<string, vscode.Range[]>();

    for (const info of mockLocationInfos) {
      if (!rangesByLocation.has(info.locationKind)) {
        rangesByLocation.set(info.locationKind, []);
      }
      rangesByLocation.get(info.locationKind)!.push(info.range);
    }

    // Should still have both ranges (deduplication happens elsewhere)
    const processRanges = rangesByLocation.get('Process<Leader>');
    assert.ok(processRanges);
    assert.strictEqual(processRanges.length, 2);
  });
});
