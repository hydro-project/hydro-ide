# Analysis Module Refactoring Plan

**Date**: October 28, 2025  
**Goal**: Refactor the analysis module to extract utilities, reduce file sizes, and improve separation of concerns.

## Current State

### File Sizes (Before Refactoring)

```
lspGraphExtractor.ts:  3,326 lines (44 methods) - CRITICAL
lspAnalyzer.ts:        1,591 lines
scopeAnalyzer.ts:        800 lines (down from 947)
treeSitterParser.ts:     443 lines
rustParser.ts:           215 lines
```

### Problems Identified

1. **lspGraphExtractor.ts is a God Object** - 3,326 lines with 44 methods mixing:
   - Caching logic
   - Graph building
   - LSP enhancement
   - Edge extraction
   - Type parsing
   - String/label manipulation
   - Operator classification
   - Configuration management
   - JSON assembly

2. **Scattered Utilities** - Common utilities (path handling, string manipulation, type parsing) are embedded in business logic files instead of being in dedicated utility modules.

3. **Duplicate Code** - scopeAnalyzer has Cargo.toml finding logic that's now duplicated in utils.ts.

## Refactoring Strategy

We'll use an **incremental, test-driven approach**:

1. Extract utilities first (low risk, high value)
2. Create new focused classes
3. Gradually migrate lspGraphExtractor to use new classes
4. Run tests after each major change
5. Remove old code only after new code is proven working

## Phase 1: Extract Utilities (Low Risk)

### ✅ COMPLETED

- [x] Create `analysis/utils.ts` with path/file utilities
  - `extractModulePath()`, `findCargoToml()`, `findCargoTomlFromFile()`, `findRustFilesInWorkspace()`, `getFunctionAtPosition()`

### Step 1.1: Create String Utilities

**File**: `src/analysis/stringUtils.ts`

Extract from lspGraphExtractor.ts:

- `extractFullLabel(document, range)` - Extract code text from range
- `normalizeLocationKind(locationKind)` - Normalize location strings
- `countTickDepth(locationKind)` - Count tick() nesting
- `buildTickLabel(baseLabel, depth)` - Build label with tick info
- `extractLocationLabel(locationKind)` - Extract display label
- `getLocationId(locationKind)` - Parse location ID from string

**Impact**: Low risk, no dependencies, pure functions

### Step 1.2: Create Type Parser

**File**: `src/analysis/typeParser.ts`

Extract from lspGraphExtractor.ts:

- `parseHydroTypeParameters(typeString)` - Parse generic parameters
- `extractBoundedness(typeParams)` - Extract boundedness info
- `extractOrdering(typeParams)` - Extract ordering info

**Impact**: Low risk, pure functions, well-defined interface

### Step 1.3: Update scopeAnalyzer to use utils.ts

**File**: `src/analysis/scopeAnalyzer.ts`

Replace internal methods with utils:

- Remove `findCargoToml()`, `findCargoTomlFromFile()`
- Replace with `import { findCargoToml } from './utils'`
- Remove `findRustFilesInWorkspace()`
- Replace with `import { findRustFilesInWorkspace } from './utils'`

**Impact**: Medium risk - scopeAnalyzer is actively used, must verify tests pass

## Phase 2: Create Focused Service Classes (Medium Risk)

### Step 2.1: Create OperatorRegistry

**File**: `src/analysis/operatorRegistry.ts`

Extract from lspGraphExtractor.ts:

- `isNetworkingOperator(operatorName)` - Check if network operator
- `isKnownDataflowOperator(operatorName)` - Check if valid dataflow op
- `isSinkOperator(operatorName)` - Check if sink operator
- `isValidDataflowOperator(operatorName, returnType)` - Validate operator
- `inferNodeType(operatorName)` - Infer node type from name
- `getLocationType(locationKind)` - Get location type
- `inferDefaultLocation(operatorName)` - Infer default location
- Load and expose `hydroOperators.json` data

**Design**:

```typescript
export class OperatorRegistry {
  private operators: OperatorConfig[];

  constructor() {
    // Load hydroOperators.json
  }

  isNetworkingOperator(name: string): boolean;
  isKnownDataflowOperator(name: string): boolean;
  isSinkOperator(name: string): boolean;
  isValidDataflowOperator(name: string, returnType: string | null): boolean;
  inferNodeType(name: string): NodeType;
  getLocationType(locationKind: string): string | null;
  inferDefaultLocation(name: string): string | null;

  // Query methods for operator metadata
  getOperatorByName(name: string): OperatorConfig | null;
  getAllOperators(): OperatorConfig[];
}
```

**Impact**: Medium risk - changes behavior of core graph building

### Step 2.2: Create HydroscopeConfig

**File**: `src/analysis/hydroscopeConfig.ts`

Extract static configuration from lspGraphExtractor.ts:

- `getEdgeStyleConfig()` - Edge styling rules
- `getNodeTypeConfig()` - Node type configurations
- `getLegend()` - Graph legend data
- `getOperatorConfig()` - Operator metadata (may merge with OperatorRegistry)

**Design**:

```typescript
export class HydroscopeConfig {
  static getEdgeStyles(): EdgeStyleConfig { ... }
  static getNodeTypes(): NodeTypeConfig { ... }
  static getLegend(): Legend { ... }
}
```

**Impact**: Low risk - pure static data

### Step 2.3: Create CacheManager

**File**: `src/analysis/cacheManager.ts`

Extract caching logic from lspGraphExtractor.ts:

- `getCacheKey(document, scopeTarget)` - Generate cache key
- `getCached(cacheKey)` - Retrieve from cache
- `setCached(cacheKey, json)` - Store in cache
- `clearCache(cacheKey?)` - Clear cache entries
- `getCacheStats()` - Get cache statistics

**Design**:

```typescript
export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private maxAge: number;

  getCacheKey(document: vscode.TextDocument, scopeTarget: ScopeTarget): string;
  get(key: string): T | null;
  set(key: string, value: T): void;
  clear(key?: string): void;
  getStats(): CacheStats;

  // Auto-cleanup old entries
  private cleanup(): void;
}
```

**Impact**: Low risk - isolated concern, well-defined interface

## Phase 3: Refactor lspGraphExtractor (High Risk)

### Step 3.1: Create GraphBuilder

**File**: `src/analysis/graphBuilder.ts`

Extract graph construction from lspGraphExtractor.ts:

- `buildOperatorChainsFromTreeSitter()` - Main tree-sitter parsing
- `detectVariableReference()` - Detect variable colorization
- `scanVariableBindings()` - Scan for variable bindings
- `buildOperatorChains()` - Build chains from LSP
- `trackOperatorUsages()` - Track operator usage
- `findOperatorsInChain()` - Find operators in method chain

**Responsibilities**:

- Parse Rust code using tree-sitter
- Identify operator chains
- Track variable bindings
- Build initial node/edge structure

**Dependencies**:

- treeSitterAnalyzer
- rustParser
- OperatorRegistry (new)

### Step 3.2: Create LSPEnhancer

**File**: `src/analysis/lspEnhancer.ts`

Extract LSP interaction from lspGraphExtractor.ts:

- `enhanceNodesWithLSPInfo()` - Add semantic info to nodes
- `assignDefaultLocations()` - Assign default locations
- `extractSemanticTags()` - Extract semantic tags

**Responsibilities**:

- Query LSP for semantic information
- Enhance nodes with types and locations
- Resolve symbols and references

**Dependencies**:

- lspAnalyzer
- OperatorRegistry (new)
- stringUtils (new)

### Step 3.3: Create EdgeExtractor

**File**: `src/analysis/edgeExtractor.ts`

Extract edge logic from lspGraphExtractor.ts:

- `_extractEdges()` - Main edge extraction
- `analyzeNetworkEdges()` - Analyze network edges

**Responsibilities**:

- Extract edges from operator chains
- Determine edge types (channel, network, handoff)
- Analyze network communication patterns

**Dependencies**:

- OperatorRegistry (new)

### Step 3.4: Create HierarchyBuilder

**File**: `src/analysis/hierarchyBuilder.ts`

Extract hierarchy building from lspGraphExtractor.ts:

- `buildLocationAndCodeHierarchies()` - Build location/code hierarchies

**Responsibilities**:

- Group nodes by location
- Build parent-child relationships
- Create hierarchy metadata

**Dependencies**:

- stringUtils (new)

### Step 3.5: Refactor lspGraphExtractor (Main Orchestrator)

**File**: `src/analysis/lspGraphExtractor.ts` (reduce from 3,326 → ~500 lines)

Keep only orchestration logic:

- `extractGraph()` - Main entry point (orchestrates all steps)
- `filterToScope()` - Filter results to requested scope
- `assembleHydroscopeJson()` - Assemble final JSON
- `validateHydroscopeJson()` - Validate output
- Logging methods

**New Design**:

```typescript
export class LSPGraphExtractor {
  private graphBuilder: GraphBuilder;
  private lspEnhancer: LSPEnhancer;
  private edgeExtractor: EdgeExtractor;
  private hierarchyBuilder: HierarchyBuilder;
  private cacheManager: CacheManager<HydroscopeJson>;
  private config: HydroscopeConfig;

  async extractGraph(
    document: vscode.TextDocument,
    scopeTarget: ScopeTarget
  ): Promise<HydroscopeJson> {
    // 1. Check cache
    const cacheKey = this.cacheManager.getCacheKey(document, scopeTarget);
    const cached = this.cacheManager.get(cacheKey);
    if (cached) return cached;

    // 2. Build operator chains
    const { nodes, edges, variables } = await this.graphBuilder.buildOperatorChains(document);

    // 3. Enhance with LSP info
    await this.lspEnhancer.enhanceNodes(nodes, document);

    // 4. Extract edges
    const finalEdges = await this.edgeExtractor.extractEdges(nodes, edges, variables, document);

    // 5. Build hierarchies
    const hierarchies = this.hierarchyBuilder.buildHierarchies(nodes);

    // 6. Filter to scope
    const filtered = this.filterToScope({ nodes, edges: finalEdges }, scopeTarget);

    // 7. Assemble JSON
    const json = this.assembleHydroscopeJson(filtered.nodes, filtered.edges, hierarchies);

    // 8. Cache and return
    this.cacheManager.set(cacheKey, json);
    return json;
  }
}
```

**Impact**: HIGH RISK - This is the core of the extension, needs extensive testing

## Phase 4: Fix functionFinder (Optional Enhancement)

### Step 4.1: Fix Compile Errors

**File**: `src/analysis/functionFinder.ts`

Fix interface issues and verify it works as scopeAnalyzer replacement.

### Step 4.2: Decide on scopeAnalyzer Future

**Option A**: Keep scopeAnalyzer as-is

- It works fine, 800 lines is reasonable
- Hydro detection heuristics are legitimate business logic
- Just update it to use utils.ts

**Option B**: Gradually migrate to functionFinder

- functionFinder is simpler (100 lines)
- Returns ALL functions, let downstream decide what's Hydro
- More flexible for future changes

**Recommendation**: Option A for now - scopeAnalyzer is working well after cleanup

## Phase 5: Testing & Validation

### Test Strategy

After each phase:

1. **Run existing tests**: `npm test`
2. **Manual smoke test**: Open sample Hydro file, visualize function/file/workspace
3. **Check graph output**: Verify nodes, edges, hierarchies are correct
4. **Performance test**: Check that caching works, no regressions

### Critical Test Files

- `test/scopeAnalyzer.test.ts` - After Phase 1.3
- `test/lspGraphExtractor.test.ts` - After Phase 3
- Manual testing in real Hydro projects

### Rollback Plan

- Keep Git commits small and focused
- Each phase should be independently revertable
- Don't delete old code until new code is proven working

## Pre-Refactoring Cleanup

### ✅ COMPLETED: Remove Redundant Operator Configuration (2025-10-28)

- Deleted unused `hydroOperators.json` file (not imported anywhere)
- Deleted unreliable `scripts/updateOperators.js` (409 lines) - LLMs can regenerate operator lists more reliably
- Removed 117 lines of hardcoded fallback operators from `lspGraphExtractor.ts`
- Simplified `getOperatorConfig()` to only read from VS Code settings (package.json defaults)
- Updated documentation in `src/analysis/README.md`
- **Tests passing**: 27 passing, 8 pending ✓
- **Total removed**: 630 lines of redundant/unreliable code

**Decision**: Operator lists should ONLY be defined in package.json settings. No hardcoded fallbacks, no separate JSON files, no automated scanning scripts. When Hydro changes, use an LLM to identify new operators and update package.json manually.

## Implementation Order

### Week 1: Utilities (Low Risk, High Value)

1. ✅ Create `utils.ts` - DONE
2. Create `stringUtils.ts` - Extract label/string utilities
3. Create `typeParser.ts` - Extract type parsing
4. Update `scopeAnalyzer.ts` to use `utils.ts`
5. **RUN TESTS** ✓

### Week 2: Service Classes (Medium Risk)

6. Create `operatorRegistry.ts` - Operator classification
7. Create `hydroscopeConfig.ts` - Static configuration
8. Create `cacheManager.ts` - Caching logic
9. **RUN TESTS** ✓

### Week 3-4: Split lspGraphExtractor (High Risk)

10. Create `graphBuilder.ts` - Extract graph building
11. Create `lspEnhancer.ts` - Extract LSP enhancement
12. Create `edgeExtractor.ts` - Extract edge logic
13. Create `hierarchyBuilder.ts` - Extract hierarchy building
14. Refactor `lspGraphExtractor.ts` to orchestrator pattern
15. **RUN TESTS** ✓ **MANUAL TESTING** ✓

### Week 5: Cleanup

16. Update exports in `analysis/index.ts`
17. Update documentation
18. Remove deprecated code
19. **FINAL TESTING** ✓

## Success Metrics

### Quantitative

- ✅ lspGraphExtractor reduced from 3,326 → ~500 lines (85% reduction)
- ✅ At least 5 new utility modules created
- ✅ All existing tests pass
- ✅ No performance regressions

### Qualitative

- ✅ Each file has a single, clear responsibility
- ✅ Utilities are reusable across the codebase
- ✅ Code is easier to understand and maintain
- ✅ New features easier to add

## Risk Mitigation

### High Risk Areas

1. **lspGraphExtractor refactoring** - Core visualization logic
   - Mitigation: Keep old code until proven working, extensive testing
2. **Breaking changes to exported APIs** - Other code depends on analysis module
   - Mitigation: Check all imports before changing exports, maintain backward compatibility
3. **LSP interaction changes** - Complex async behavior
   - Mitigation: Extract without changing behavior first, optimize later

### Low Risk Areas

- Utility extraction (pure functions, no state)
- Static configuration extraction (just data)
- New optional classes (don't break existing code)

## Notes & Decisions

### Decision Log

**2025-10-28**: Created initial refactoring plan

- Chose incremental approach over big-bang rewrite
- Prioritized utility extraction for quick wins
- Identified lspGraphExtractor as critical path

### Open Questions

1. Should we also refactor lspAnalyzer.ts (1,591 lines)?
   - **Decision**: Defer to future, focus on lspGraphExtractor first
2. Should functionFinder replace scopeAnalyzer?
   - **Decision**: Keep scopeAnalyzer, it's working well. Hydro detection is legitimate business logic.
3. Should OperatorRegistry load hydroOperators.json or keep it separate?
   - **Decision**: TBD during implementation

### Lessons Learned

- Dead code removal (Phase 0) was valuable - removed 147 lines from scopeAnalyzer
- God object pattern (lspGraphExtractor) is the real problem, not individual file sizes
- Utilities scattered across files indicate missing abstractions

---

## Quick Reference: File Locations

### New Files to Create

```
src/analysis/
├── stringUtils.ts           (Step 1.1)
├── typeParser.ts            (Step 1.2)
├── operatorRegistry.ts      (Step 2.1)
├── hydroscopeConfig.ts      (Step 2.2)
├── cacheManager.ts          (Step 2.3)
├── graphBuilder.ts          (Step 3.1)
├── lspEnhancer.ts           (Step 3.2)
├── edgeExtractor.ts         (Step 3.3)
└── hierarchyBuilder.ts      (Step 3.4)
```

### Files to Modify

```
src/analysis/
├── lspGraphExtractor.ts     (Refactor in Step 3.5)
├── scopeAnalyzer.ts         (Update in Step 1.3)
└── index.ts                 (Update exports throughout)
```

### Files Already Created

```
src/analysis/
├── utils.ts                 (✅ DONE - Phase 1)
└── functionFinder.ts        (✅ DONE - needs fixes)
```

---

**Status**: Planning Complete - Ready to begin Week 1 implementation  
**Next Action**: Create `stringUtils.ts` (Step 1.1)
