# Hydro IDE Source Code Organization

This directory contains the source code for the Hydro IDE VSCode extension, organized into logical modules for better maintainability and separation of concerns.

## Directory Structure

### `/coloring/` - Code Coloring Module
Handles syntax highlighting and location-based coloring for Hydro code.

- `locationColorizer.ts` - Main colorization logic using VSCode decorations
- `locationColorizer_inlay.ts` - Alternative implementation using inlay hints
- `locationColorizerConfig.ts` - Color palettes and styling configuration
- `index.ts` - Module exports

### `/visualization/` - Graph Visualization Module
Manages dataflow graph visualization and webview components.

- `webviewManager.ts` - Webview panel lifecycle and communication
- `graphValidator.ts` - Graph data validation and error checking
- `cargoOrchestrator.ts` - Cargo build orchestration and metadata extraction
- `CARGO_ORCHESTRATOR.md` - Documentation for Cargo integration
- `index.ts` - Module exports

### `/analysis/` - LSP Analysis Module
Provides LSP-based analysis, parsing, and location detection.

- `lspGraphExtractor.ts` - Extract graph data from rust-analyzer LSP
- `locationAnalyzer.ts` - Analyze and cache location type information
- `treeSitterParser.ts` - Tree-sitter based Rust code parsing
- `rustParser.ts` - Rust AST parsing utilities
- `scopeAnalyzer.ts` - Detect Hydro code at different scopes
- `locationAnalyzer.backup.ts` - Backup implementation
- `SCOPE_ANALYZER.md` - Documentation for scope analysis
- `index.ts` - Module exports

### `/core/` - Shared Utilities Module
Contains shared utilities, types, configuration, and error handling.

- `types.ts` - TypeScript type definitions
- `logger.ts` - Logging utilities
- `config.ts` - Configuration management
- `errorHandler.ts` - Error handling and user feedback
- `progressReporter.ts` - Progress reporting for long operations
- `index.ts` - Module exports

### Root Files
- `extension.ts` - Main extension entry point and command registration
- `hydroIDE.ts` - Main orchestration class coordinating all modules
- `index.ts` - Extension exports

## Import Patterns

The new structure uses relative imports to maintain clear module boundaries:

```typescript
// From extension.ts
import * as locationColorizer from './coloring/locationColorizer';
import * as locationAnalyzer from './analysis/locationAnalyzer';

// From coloring module
import * as locationAnalyzer from '../analysis/locationAnalyzer';
import { showStatus } from '../extension';

// From analysis module  
import { ScopeTarget } from '../core/types';

// From visualization module
import { Logger } from '../core/logger';
```

## Module Dependencies

```
extension.ts
├── hydroIDE.ts
│   ├── analysis/ (scopeAnalyzer, lspGraphExtractor)
│   ├── visualization/ (webviewManager, cargoOrchestrator, graphValidator)
│   └── core/ (types, logger, config, errorHandler, progressReporter)
├── coloring/ (locationColorizer, locationColorizerConfig)
│   └── analysis/ (locationAnalyzer)
└── core/ (types, logger, config, errorHandler)
```

## Benefits of This Organization

1. **Separation of Concerns**: Each module has a clear, focused responsibility
2. **Better Maintainability**: Related functionality is grouped together
3. **Clearer Dependencies**: Import paths make module relationships explicit
4. **Easier Testing**: Modules can be tested in isolation
5. **Future Extensibility**: New features can be added as separate modules

## Migration Notes

All import paths have been updated to reflect the new structure. The functionality remains identical - this is purely an organizational change to improve code maintainability.