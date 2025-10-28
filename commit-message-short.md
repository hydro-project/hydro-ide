feat: implement multi-source location extraction for enhanced node coloring

## Problem
- 68% of nodes appeared gray due to insufficient location information
- LSP semantic analysis only covered ~30 nodes out of 94 total

## Solution
- **Hybrid architecture**: Tree-sitter for structure + multi-source LSP enhancement
- **Three-tier location extraction**:
  1. Primary LSP semantic tokens (~30 locations)
  2. Hover-based analysis at operator positions (~20-40 additional)
  3. Default assignments for remaining nodes (100% coverage)

## Key Changes
- `lspGraphExtractor.ts`: Replaced LSP-first with hybrid tree-sitter + LSP approach
- `locationAnalyzer.ts`: Added hover-first strategy with fallback coordination
- `lspAnalyzer.ts`: Added `analyzePositions()` method for hover-based type extraction
- `package.json`: Moved operator config from hardcoded to VS Code settings
- `updateOperators.js`: Utility script to scan Hydro codebase for operators

## Technical Improvements
- Hover text parsing with regex patterns for location types
- Smart deduplication between LSP sources
- Default location assignment (networking→Cluster, sources→Process, etc.)
- Enhanced tree-sitter variable binding and chain parsing
- Dual hierarchy system (Location + Code structure)

## Impact
- Expected: 53-74% node coloring (up from 32%)
- Guaranteed: 100% nodes get location assignment
- Better network edge visualization with semantic tagging