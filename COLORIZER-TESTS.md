# Location Colorizer Tests

This document describes the test suite for the Hydro IDE location colorizer feature.

## Test Structure

### 1. Unit Tests (`src/test/locationAnalyzer.unit.test.ts`)

Pure logic tests that don't require VSCode. These test the core parsing and colorization logic.

**Test Suites:**

- **LocationAnalyzer Type Parsing** - Tests parsing of Location types from Rust type strings
  - Simple types: `Process<'a, Leader>` → `Process<Leader>`
  - Stream types: `Stream<T, Process<'a, Leader>, Unbounded>` → `Process<Leader>`
  - Tick types: `Tick<Process<'a, Leader>>` → `Tick<Process<Leader>>`
  - Nested Ticks: `Tick<Tick<Process<'a, Leader>>>` → `Tick<Tick<Process<Leader>>>`
  - Reference types: `&Process<'a, Leader>` → `Process<Leader>`
  - Complex nested types with multiple generics

- **LocationAnalyzer Border Styles** - Tests border style assignment
  - Process: no border (background only)
  - Cluster: double border
  - External: single border
  - Tick wrappers preserve base location style

- **LocationAnalyzer Color Assignment** - Tests color palette logic
  - 8 colors in palette
  - Color cycling for >8 locations
  - Unique colors for different location kinds
  - Same color for same location kind

- **LocationAnalyzer Struct Name Extraction** - Tests extracting struct names from location kinds
  - `Process<Leader>` → `Leader`
  - `Cluster<Worker>` → `Worker`
  - Unit types: `Process<()>` → `()`

- **LocationAnalyzer Struct Definition Matching** - Tests finding struct definitions in code
  - Simple structs: `pub struct Leader {}`
  - Private structs: `struct Proposer {}`
  - Structs with derives

- **LocationAnalyzer Edge Cases** - Tests edge cases and error handling
  - Empty strings
  - Malformed types
  - Nested generics
  - Very long types

### 2. Integration Tests (`src/test/locationColorizer.integration.test.ts`)

Tests that require a full VSCode instance with rust-analyzer. These test the end-to-end colorization feature.

**Test Suites:**

- **LocationColorizer Integration Tests**
  - Parse `simple_cluster.rs` and find Location types
  - Parse `paxos.rs` and find Proposer/Acceptor types
  - Extract struct names from location kinds
  - Assign unique colors to different location kinds
  - Handle color palette wrapping
  - Apply correct border styles
  - Group ranges by location kind
  - Handle empty location info arrays
  - Handle duplicate ranges

### 3. Test Data Files (`test-fixtures/sample-hydro-project/src/`)

Real Rust code samples from the Hydro test suite, integrated into a proper Cargo project:

- **`paxos.rs`** - Complex Paxos implementation with Proposer and Acceptor clusters
- **`simple_cluster.rs`** - Simple cluster examples with Process and Cluster types

These files are part of `sample-hydro-project` which has proper Cargo.toml dependencies, allowing rust-analyzer to resolve types correctly.

## Shared Configuration

### `src/locationColorizerConfig.ts`

Shared constants used by both implementation and tests:

- **`COLOR_PALETTE`** - 8 colors from ColorBrewer Set2 palette
- **`getBorderStyle()`** - Returns border style based on location kind
- **`getColorByIndex()`** - Gets color from palette with wrapping

This ensures tests don't break when colors or styles are modified.

## Running Tests

### Unit Tests Only (Fast)
```bash
npm run compile
npm test -- --grep "unit"
```

### Integration Tests (Requires VSCode)
```bash
npm test
```

The integration tests:
1. Open a VSCode test instance
2. Load the extension
3. Wait for rust-analyzer to be ready
4. Analyze test files
5. Verify colorization results

## Test Coverage

### What's Tested

✅ Location type parsing from all Rust type formats
✅ Nested Tick handling (preserves semantic differences)
✅ Color assignment and palette wrapping
✅ Border style assignment (Process/Cluster/External)
✅ Struct name extraction
✅ Struct definition finding
✅ Edge cases and error handling
✅ Integration with rust-analyzer
✅ Real-world Hydro code samples

### What's Not Tested

- VSCode decoration API (mocked in integration tests)
- User interaction (manual testing required)
- Performance with very large files
- Concurrent colorization requests

## Key Design Decisions

### Nested Ticks

`Tick<Tick<Process<Leader>>>` ≠ `Tick<Process<Leader>>`

The parser preserves all Tick wrappers because they have different semantic meanings in Hydro. Each Tick represents a different time step.

### Color Assignment

Colors are assigned deterministically based on the order location kinds are encountered. Same location kind always gets the same color within a file.

### Border Styles

- **Process**: Background color only (no border)
- **Cluster**: Double border (more prominent)
- **External**: Single border (distinct from Process)

This visual hierarchy helps distinguish location types at a glance.

## Adding New Tests

### Unit Test
```typescript
test('Should parse new pattern', () => {
  const result = parseLocationType("NewPattern<'a, Type>");
  assert.strictEqual(result, 'NewPattern<Type>');
});
```

### Integration Test
```typescript
test('Should handle new feature', async function() {
  this.timeout(30000);
  const document = await openTestFile('test.rs');
  const isReady = await waitForRustAnalyzer(document);
  if (!isReady) {
    this.skip();
    return;
  }
  const locationInfos = await locationAnalyzer.analyzeDocument(document);
  // assertions...
});
```

## Troubleshooting

### Integration Tests Fail

- Ensure rust-analyzer extension is installed
- Check that test data files are valid Rust
- Increase timeout if rust-analyzer is slow
- Check VSCode test instance logs

### Unit Tests Fail

- Verify shared config is imported correctly
- Check that parsing logic matches test expectations
- Ensure test data matches actual Hydro patterns
