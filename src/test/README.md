# ScopeAnalyzer Tests

This directory contains unit tests for the ScopeAnalyzer component of the Hydro IDE extension.

## Test Files

### scopeAnalyzer.test.ts
Full integration tests that require a VSCode instance. These tests:
- Test function detection with various Hydro patterns (#[hydro::flow], return types)
- Test file-level analysis with multiple functions
- Test workspace-level analysis
- Test edge cases (no Hydro code, malformed syntax, nested functions)
- Test metadata extraction (module paths, line numbers, attributes)

**Note:** These tests require the VSCode test runner and will open a VSCode instance with the test workspace.

### scopeAnalyzer.unit.test.ts
Simplified unit tests that can run without a full VSCode instance. These tests:
- Test Hydro pattern detection regexes
- Test module path extraction logic
- Test function parsing logic
- Test file content analysis
- Test edge cases (empty files, comments, nested braces)
- Test real file parsing from test fixtures

**Note:** These tests are faster and can run in isolation, but don't test the full VSCode integration.

## Running Tests

### Run all tests (requires VSCode)
```bash
npm test
```

### Run unit tests only
```bash
npm run test:unit
```

### Compile tests
```bash
npm run compile
```

## Test Fixtures

The tests use sample Hydro projects located in `test-fixtures/sample-hydro-project/`:
- `src/simple_flows.rs` - Simple Hydro flows for basic testing
- `src/complex_flows.rs` - Complex flows with joins, aggregations, etc.
- `src/multi_process.rs` - Multi-process flows for distributed testing

## Test Coverage

The tests cover the following requirements from the spec:

**Requirement 3.3 - Scope Detection:**
- ✅ Function detection with various Hydro patterns
- ✅ File-level analysis with multiple functions
- ✅ Edge cases (no Hydro code, malformed syntax)

**Specific Test Cases:**

1. **Function Detection with Hydro Attributes**
   - Detects `#[hydro::flow]` attribute
   - Detects `#[hydro_lang::flow]` attribute
   - Detects `#[hydro::main]` attribute

2. **Function Detection with Macros**
   - Detects `hydro_lang::flow!` macro
   - Detects `hydro::flow!` macro

3. **Function Detection with Return Types**
   - Detects functions returning `Dfir<'static>`
   - Detects functions returning `HydroFlow`

4. **File-Level Analysis**
   - Finds all Hydro functions in a file
   - Extracts correct module paths
   - Extracts correct line numbers
   - Handles multiple functions in one file

5. **Edge Cases**
   - Handles files with no Hydro code
   - Handles files with syntax errors
   - Handles nested functions
   - Handles empty files
   - Handles files with only comments
   - Handles multiline function signatures

6. **Pattern Detection**
   - Detects Hydro imports
   - Detects Hydro attributes
   - Detects Hydro macros
   - Does not false-positive on regular Rust code

## Adding New Tests

To add new tests:

1. Add test cases to `scopeAnalyzer.test.ts` for full integration tests
2. Add test cases to `scopeAnalyzer.unit.test.ts` for unit tests
3. Use the `suite()` and `test()` functions from Mocha
4. Follow the existing test structure and naming conventions
5. Run `npm run compile` to check for TypeScript errors
6. Run `npm test` to verify tests pass

## Test Structure

Tests are organized into suites:
- **Function Detection** - Tests for detecting Hydro functions
- **File-Level Analysis** - Tests for analyzing entire files
- **Edge Cases** - Tests for error conditions and edge cases
- **Pattern Detection** - Tests for regex patterns
- **Module Path Extraction** - Tests for extracting module paths
- **Function Parsing** - Tests for parsing function definitions
- **Real File Tests** - Tests using actual test fixture files

Each suite contains multiple test cases that verify specific functionality.
