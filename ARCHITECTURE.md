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

**Uses:**

- `TreeSitterRustParser` — Parse Rust AST to find operator positions
- `LSPAnalyzer` — Query LSP hover for concrete type information

---

### How it Works

**Simple, direct approach:**

```
1. TreeSitterRustParser finds all operator positions
2. LSPAnalyzer queries hover at each position → concrete types
3. Colorize operators and variables based on types
```

**Why this works:**

- 🎯 **Concrete types** — hover returns instantiated types (e.g., `Process<Leader>`), not generics
- ⚡ **Simple** — Direct tree-sitter → hover pipeline, no intermediate layers
- ✅ **Reliable** — hover is fast and well-supported by rust-analyzer

---

## Key Classes Summary

### Visualization

| Class               | Purpose                | Output                       | Speed     |
| ------------------- | ---------------------- | ---------------------------- | --------- |
| `LSPGraphExtractor` | Fast visualization     | Hydroscope JSON              | ⚡ 1-2s   |
| `CargoOrchestrator` | Complete visualization | Hydroscope JSON + backtraces | 🐢 10-60s |

### Services (used by LSPGraphExtractor)

| Service                | Responsibility                       | Lines | Tests |
| ---------------------- | ------------------------------------ | ----- | ----- |
| `TreeSitterRustParser` | Parse Rust AST, find operator chains | ~576  | 23    |
| `GraphBuilder`         | Create nodes/edges from operators    | ~513  | 20    |
| `EdgeAnalyzer`         | Add network semantic tags            | ~155  | 10    |
| `HierarchyBuilder`     | Build location + code hierarchies    | ~523  | 12    |
| `OperatorRegistry`     | Classify operators by type           | ~360  | 48    |

### Location Colorization

| Class                  | Purpose                        | Lines | Role                               |
| ---------------------- | ------------------------------ | ----- | ---------------------------------- |
| `locationAnalyzer`     | Coordinate colorization        | ~140  | Orchestrates tree-sitter + LSP     |
| `LSPAnalyzer`          | LSP hover queries              | ~1590 | Concrete type extraction           |
| `TreeSitterRustParser` | Parse Rust AST, find operators | ~576  | Shared AST parsing (both features) |

---

## Configuration Reference

### Visualization

- **No direct config** — user chooses command (Quick vs Full)
- LSP always tried first for Quick commands
- Cargo fallback offered if LSP fails

### Location Colorization

```jsonc
{
  // Enable location colorization
  "hydroIde.locationColoring.enabled": true,

  // Analysis performance
  "hydroIde.analysis.maxFileSize": 10000,
  "hydroIde.performance.queryTimeout": 5000,
  "hydroIde.performance.cacheSize": 50,
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

1. ✅ **Tree-sitter consolidation (COMPLETED):**
   - Eliminated `TreeSitterAnalyzer` wrapper
   - `GraphExtractor` now uses `TreeSitterRustParser` directly
   - Single AST parsing implementation shared across features

2. **Simplify colorization:**
   - Consider removing GraphExtractor-first strategy (if unused)
   - Hover-first is superior for accuracy

3. ✅ **Shared type system (COMPLETED):**
   - All graph types now in `core/graphTypes.ts`
   - Single source of truth achieved

### Performance opportunities:

1. **Incremental updates:** Only re-analyze changed portions
2. **Smarter caching:** Cache across related files
3. **Parallel LSP queries:** Query multiple positions concurrently
