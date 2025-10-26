# ScopeAnalyzer Architecture

## Overview

The `ScopeAnalyzer` class is responsible for detecting and analyzing Hydro code in Rust source files at different granularities (function, file, workspace).

## Core Components

### Type Definitions (`types.ts`)

- **`ScopeType`**: Union type for scope levels (`'function' | 'file' | 'workspace'`)
- **`HydroFunction`**: Metadata about a detected Hydro function
  - `name`: Function name
  - `modulePath`: Rust module path
  - `filePath`: Absolute file path
  - `startLine`, `endLine`: Function boundaries
  - `attributes`: Rust attributes (e.g., `#[hydro::flow]`)
  - `usesMacro`: Whether function uses Hydro macros
- **`ScopeTarget`**: Complete scope analysis result
  - `type`: Scope type
  - `functions`: Array of detected Hydro functions
  - `workspaceRoot`: Workspace root path
  - `activeFilePath`: Optional active file path
- **`ScopeDetectionError`**: Categorized error for scope detection failures
- **`ScopeAnalyzerConfig`**: Configuration options

### ScopeAnalyzer Class (`scopeAnalyzer.ts`)

#### Public API

- **`analyzeScope(editor, scopeType)`**: Main entry point for scope analysis
  - Takes a VSCode editor and scope type
  - Returns a `ScopeTarget` with detected functions
  - Throws `ScopeDetectionError` on failure

- **`isLikelyHydroFile(document)`**: Quick check if file contains Hydro code
  - Checks for Hydro imports, attributes, and macros
  - Used for optimization and filtering

#### Private Methods (Placeholders for Future Tasks)

- **`analyzeFunctionScope(editor)`**: Task 3.2 - Find function at cursor
- **`analyzeFileScope(document)`**: Task 3.3 - Find all functions in file
- **`analyzeWorkspaceScope()`**: Task 3.4 - Find all functions in workspace
- **`findHydroFunctionAtPosition(document, position)`**: Task 3.2
- **`findAllHydroFunctionsInFile(document)`**: Task 3.3
- **`findCargoToml(workspaceRoot)`**: Task 3.4
- **`findRustFilesInWorkspace(workspaceRoot)`**: Task 3.4

#### Utility Methods

- **`readFileContent(filePath)`**: Read file with size validation
- **`hasHydroImports(text)`**: Check for Hydro imports
- **`hasHydroAttributes(text)`**: Check for Hydro attributes
- **`hasHydroMacros(text)`**: Check for Hydro macros

## Detection Patterns

The analyzer uses regex patterns to detect Hydro code:

1. **Attributes**: `#[hydro::flow]`, `#[hydro_lang::flow]`
2. **Macros**: `hydro_lang::flow!`, `hydro::flow!`
3. **Imports**: `use hydro::*`, `use hydro_lang::*`, `use dfir_rs::*`
4. **Function definitions**: `fn function_name`

## Error Handling

Errors are categorized using `ScopeErrorCategory`:

- `NO_HYDRO_CODE`: No Hydro functions found at requested scope
- `INVALID_POSITION`: Invalid cursor position or file state
- `NOT_IN_WORKSPACE`: File not part of a Cargo workspace
- `PARSE_ERROR`: Parsing or analysis errors
- `IO_ERROR`: File system errors

## Integration with Extension

The `ScopeAnalyzer` is initialized in `extension.ts` and used by visualization commands:

```typescript
// Initialize
scopeAnalyzer = new ScopeAnalyzer(outputChannel);

// Use in commands
const scopeTarget = await scopeAnalyzer.analyzeScope(editor, 'function');
```

## Next Steps

The following tasks will implement the placeholder methods:

- **Task 3.2**: Implement function-level detection
- **Task 3.3**: Implement file-level detection
- **Task 3.4**: Implement workspace-level detection

Each task will add Rust parsing logic to extract function metadata and detect Hydro-specific patterns.
