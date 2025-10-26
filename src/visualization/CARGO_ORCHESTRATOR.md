# Cargo Orchestrator Implementation

## Overview

The `CargoOrchestrator` class manages the integration between the VSCode extension and Cargo builds for Hydro visualization. It handles building Rust code with visualization features enabled, extracting JSON output, and providing detailed error reporting.

## Key Features

### 1. Build Command Construction (Task 4.1)

The orchestrator constructs Cargo commands with:
- Manifest path specification
- Feature flags (automatically includes 'viz' feature)
- Release mode support
- Custom target support
- Test-specific arguments for function/file scope

**Example:**
```typescript
const args = ['test', '--no-run', '--manifest-path', '/path/to/Cargo.toml', '--features', 'viz'];
```

### 2. Visualization Test Generation (Task 4.2)

For function and file-level visualization, the orchestrator:
- Creates a temporary test file in `tests/hydro_viz_temp.rs`
- Generates Rust code that imports target functions
- Adds JSON output markers for extraction
- Cleans up the test file after build completion

**Generated Test Structure:**
```rust
use module::path::function_name;

#[test]
fn visualize_hydro_flows() {
    println!("__HYDRO_VIZ_JSON_START_0__");
    // JSON output here
    println!("__HYDRO_VIZ_JSON_END_0__");
}
```

### 3. JSON Extraction (Task 4.3)

The orchestrator extracts graph JSON from Cargo output:
- Searches for marker-delimited JSON blocks
- Validates JSON structure
- Combines multiple function graphs when needed
- Provides validation against Hydroscope specification

**Validation checks:**
- Required properties (nodes, edges)
- Array types
- Node/edge structure (id, source, target)

### 4. Error Handling (Task 4.4)

Comprehensive error handling includes:
- Parsing Cargo error messages with context
- Extracting file locations and line numbers
- Formatting errors for user display
- Providing actionable suggestions based on error patterns

**Error Categories Detected:**
- Missing dependencies
- Feature configuration issues
- Macro/import problems
- Type errors

## Usage Example

```typescript
const orchestrator = new CargoOrchestrator(outputChannel);

const config: CargoConfig = {
  manifestPath: '/path/to/Cargo.toml',
  features: ['custom-feature'],
  releaseMode: false,
  timeout: 120000,
};

const result = await orchestrator.buildWithVisualization(scopeTarget, config);

if (result.success && result.graphJson) {
  // Pass JSON to webview
  console.log('Graph JSON:', result.graphJson);
} else {
  // Handle errors
  const details = orchestrator.extractErrorDetails(result);
  console.error(details.summary);
  console.log('Suggestions:', details.suggestions);
}
```

## Process Management

The orchestrator provides:
- **Timeout support**: Automatically cancels builds that exceed the configured timeout
- **Cancellation**: Allows manual cancellation of in-progress builds
- **Resource cleanup**: Properly disposes of child processes and temporary files

## Integration Points

The CargoOrchestrator integrates with:
1. **ScopeAnalyzer**: Receives scope targets with function metadata
2. **Extension**: Gets configuration from VSCode settings
3. **WebviewManager** (future): Will pass extracted JSON for visualization

## Configuration

Reads from VSCode settings:
- `hydroIDE.cargo.releaseMode`: Build in release mode
- `hydroIDE.cargo.features`: Additional features to enable
- `hydroIDE.cargo.timeout`: Build timeout in milliseconds

## Error Types

### CargoError
Thrown when Cargo operations fail:
- `message`: Human-readable error description
- `exitCode`: Process exit code (if available)
- `stderr`: Full stderr output
- `buildResult`: Complete build result for detailed analysis

## Future Enhancements

Potential improvements for future tasks:
1. Incremental build support using Cargo's cache
2. Parallel builds for workspace-level visualization
3. Custom visualization API integration (beyond test generation)
4. Build artifact caching to avoid redundant compilations
5. Support for custom Cargo commands and profiles
