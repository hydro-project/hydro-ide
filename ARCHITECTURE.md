# Hydro IDE Architecture

## Overview

Hydro IDE provides two main features:
1. **Dataflow Visualization** — Interactive graph visualization of Hydro programs
2. **Location Colorization** — Syntax highlighting of location types in the editor

These features use different code paths with different trade-offs.

---

## Visualization Architecture

### Two Visualization Paths

#### 1. LSPGraphExtractor (Fast Path) ⚡

**File:** `src/analysis/lspGraphExtractor.ts`

**Purpose:** Generate Hydroscope visualization JSON **without Cargo compilation**

**How it works:**
```
Document → TreeSitterParser → GraphBuilder → EdgeAnalyzer → HierarchyBuilder → JSON
             (operator chains)    (nodes/edges)  (semantics)   (hierarchies)
```

**Services:**
- `TreeSitterRustParser` — Parse Rust AST to find operator chains
- `GraphBuilder` — Create nodes and edges from operators
- `EdgeAnalyzer` — Add network semantic tags
- `HierarchyBuilder` — Build location + code hierarchies
- Optional: LSP enhancement for type information (best-effort)

**Advantages:**
- ⚡ **Fast** — 1-2 seconds, no compilation
- 🔄 **Instant feedback** — see changes immediately
- 💾 **Cached** — subsequent visualizations are instant

**Trade-offs:**
- No runtime backtraces (hierarchy based on types, not execution)
- LSP enhancement is optional/best-effort

**Used by:**
- Quick visualization commands (default)
- Primary visualization path
- `HydroIDE.visualizeScopeLSP()`

---

#### 2. CargoOrchestrator (Complete Path) 🔬

**File:** `src/visualization/cargoOrchestrator.ts`

**Purpose:** Generate Hydroscope visualization JSON **with Cargo compilation + runtime extraction**

**How it works:**
```
Document → Cargo build → Runtime extraction → JSON
           (compile)      (execution + backtraces)
```

**Advantages:**
- 📊 **Complete runtime context** — full execution backtraces
- 🎯 **Accurate hierarchy** — based on actual execution paths
- ✅ **Ground truth** — what actually runs

**Trade-offs:**
- ⏱️ **Slow** — 10-60 seconds (full compilation)
- 💻 **Resource intensive** — requires working Cargo setup

**Used by:**
- Full visualization commands (Cargo mode)
- Fallback when LSP fails
- `HydroIDE.visualizeScopeCargo()`

---

### Smart Routing

**Entry point:** `HydroIDE.visualizeScope(scopeType)`

```
User Command
    ↓
visualizeScope()
    ↓
    ├─→ visualizeScopeLSP() [Default, Fast]
    │   ├─ Success → Display ✓
    │   └─ Failure → Offer Cargo fallback
    │
    └─→ visualizeScopeCargo() [On-demand, Complete]
        └─ Cargo build + runtime extraction
```

**Configuration:**
- User chooses path via command palette:
  - "Hydro: Visualize Function (Quick)" → LSP
  - "Hydro: Visualize Function (Full - Cargo)" → Cargo

---

## Location Colorization Architecture

### Purpose

Syntax highlighting of Hydro location types in the editor:
- `Process<Leader>` → colored
- `Cluster<Worker>` → colored
- Variables assigned from location operators → colored

**File:** `src/analysis/locationAnalyzer.ts`

**Coordinates between:**
- `TreeSitterAnalyzer` — Find operator positions
- `LSPAnalyzer` — Get type information
- `GraphExtractor` — Coordinate tree-sitter + LSP (legacy strategy)

---

### Two Analysis Strategies

#### 1. Hover-First Strategy (Default, Recommended) ⭐

**Configuration:** `hydroIde.analysis.useHoverFirst = true` (default)

**How it works:**
```
1. Tree-sitter finds all operator positions
2. LSP hover queries at each position → concrete types
3. Colorize based on instantiated types (e.g., Process<Leader>)
```

**Advantages:**
- 🎯 **Concrete types** — hover returns instantiated types, not generics
- 📍 **Accurate** — hover provides exact type at cursor position
- ✅ **Reliable** — hover is fast and well-supported by rust-analyzer

**Uses:**
- `GraphExtractor` (for tree-sitter positioning only)
- `LSPAnalyzer.analyzePositions()` (hover queries)

---

#### 2. GraphExtractor-First Strategy (Legacy)

**Configuration:** `hydroIde.analysis.useHoverFirst = false`

**How it works:**
```
1. GraphExtractor queries LSP type definitions
2. May return generic types (e.g., Process<P>)
3. Hover used as fallback for unmatched operators
```

**Trade-offs:**
- ⚠️ **Generic types** — type definitions may return uninstantiated generics
- 🔧 **Legacy** — older approach, less accurate

**Uses:**
- `GraphExtractor.extractGraph()` (tree-sitter + LSP type definitions)
- `LSPAnalyzer.analyzePositions()` (fallback hover queries)

---

## Key Classes Summary

### Visualization

| Class | Purpose | Output | Speed |
|-------|---------|--------|-------|
| `LSPGraphExtractor` | Fast visualization | Hydroscope JSON | ⚡ 1-2s |
| `CargoOrchestrator` | Complete visualization | Hydroscope JSON + backtraces | 🐢 10-60s |

### Services (used by LSPGraphExtractor)

| Service | Responsibility | Lines | Tests |
|---------|----------------|-------|-------|
| `TreeSitterRustParser` | Parse Rust AST, find operator chains | ~576 | 23 |
| `GraphBuilder` | Create nodes/edges from operators | ~513 | 20 |
| `EdgeAnalyzer` | Add network semantic tags | ~155 | 10 |
| `HierarchyBuilder` | Build location + code hierarchies | ~523 | 12 |
| `OperatorRegistry` | Classify operators by type | ~360 | 48 |

### Location Colorization

| Class | Purpose | Strategy |
|-------|---------|----------|
| `locationAnalyzer` | Coordinate colorization | Router (hover-first vs GraphExtractor-first) |
| `GraphExtractor` | Tree-sitter + LSP coordination | Legacy strategy, tree-sitter positioning |
| `LSPAnalyzer` | LSP hover queries | Concrete type extraction |
| `TreeSitterAnalyzer` | Find operator positions | AST parsing |

---

## Configuration Reference

### Visualization

- **No direct config** — user chooses command (Quick vs Full)
- LSP always tried first for Quick commands
- Cargo fallback offered if LSP fails

### Location Colorization

```jsonc
{
  // Use hover-first strategy (recommended, default)
  "hydroIde.analysis.useHoverFirst": true,
  
  // Fallback to hover if GraphExtractor fails
  "hydroIde.analysis.fallbackToHoverAnalyzer": true,
  
  // Enable location colorization
  "hydroIde.locationColoring.enabled": true,
  
  // Analysis performance
  "hydroIde.analysis.maxFileSize": 10000,
  "hydroIde.performance.queryTimeout": 5000,
  "hydroIde.performance.cacheSize": 50
}
```

---

## Development Guidelines

### When to use each visualization path:

1. **During active coding:** LSPGraphExtractor (fast feedback loop)
2. **For debugging/verification:** CargoOrchestrator (complete context)
3. **When LSP fails:** Automatic fallback to Cargo

### When modifying code:

- **Visualization changes:** Likely affect `LSPGraphExtractor` or its services
- **Colorization changes:** Likely affect `locationAnalyzer`, `LSPAnalyzer`, or `GraphExtractor`
- **Both features:** May affect shared utilities (TreeSitterParser, OperatorRegistry, etc.)

### Testing strategy:

- **Unit tests:** Each service in isolation (GraphBuilder, EdgeAnalyzer, etc.)
- **Integration tests:** End-to-end visualization (`paxosGraph.unit.test.ts`)
- **Manual testing:** Both Quick and Cargo commands on real Hydro programs

---

## Historical Context

### Why three separate extractors?

1. **LSPGraphExtractor** — Created for fast visualization without compilation
2. **GraphExtractor** — Earlier attempt at LSP+tree-sitter coordination for colorization
3. **CargoOrchestrator** — Original complete path with runtime information

These evolved independently to solve different problems with different constraints.

### Evolution:

- **Phase 1:** Cargo-only (slow but complete)
- **Phase 2:** Added LSP-based quick visualization
- **Phase 3:** Refactored into services (GraphBuilder, EdgeAnalyzer, HierarchyBuilder)
- **Phase 4:** Cleaned up dead code, consolidated types

---

## Future Improvements

### Potential consolidations:

1. **Merge tree-sitter usage:**
   - `TreeSitterAnalyzer` (used by GraphExtractor)
   - `TreeSitterRustParser` (used by LSPGraphExtractor)
   - Could potentially share more code

2. **Simplify colorization:**
   - Consider removing GraphExtractor-first strategy (if unused)
   - Hover-first is superior for accuracy

3. **Shared type system:**
   - All graph types now in `core/graphTypes.ts`
   - Continue consolidating to single source of truth

### Performance opportunities:

1. **Incremental updates:** Only re-analyze changed portions
2. **Smarter caching:** Cache across related files
3. **Parallel LSP queries:** Query multiple positions concurrently
