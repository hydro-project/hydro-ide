# Cargo Visualization Path Improvements

## Problem

The cargo-based visualization path in hydro-ide was hardcoded to expect functions with a specific signature: `fn name(leader: &Process<'_>, workers: &Cluster<'_>)`. This caused the visualization to break for functions with different signatures.

## Solution

Modified `cargoOrchestrator.ts` to dynamically analyze function signatures using the existing `RustParser` (tree-sitter based) and generate appropriate test code based on the actual parameter types.

## Changes Made

### 1. Added RustParser Integration (`cargoOrchestrator.ts`)

- Imported `RustParser` and `RustParameter` from `../analysis/rustParser`
- Added `rustParser` instance to `CargoOrchestrator` class
- Initialized parser in constructor with fallback for when parser fails

### 2. Enhanced Test Code Generation

Modified `generateFunctionTestBody` to:

- Parse function signatures using tree-sitter
- Extract parameter names and types
- Generate appropriate parameter initialization based on types
- Handle functions with no parameters, different location types, etc.

### 3. Parameter Type Handling

Implemented `generateParameterForType` method that handles:

| Parameter Type     | Declaration                                                       | Call Argument |
| ------------------ | ----------------------------------------------------------------- | ------------- |
| `&FlowBuilder<'a>` | _(reuse existing)_                                                | `&flow`       |
| `&Process<'a, T>`  | `let name = flow.process();`                                      | `&name`       |
| `&Cluster<'a, T>`  | `let name = flow.cluster();`                                      | `&name`       |
| `&Tick<'a, L>`     | `let tick_loc = flow.process();`<br>`let name = tick_loc.tick();` | `&name`       |
| Unknown types      | `// Unknown type comment`                                         | `/* name */`  |

### 4. Fallback Behavior

When tree-sitter parsing fails or is unavailable:

- Falls back to default parameters: `&leader: &Process<'_>`, `&workers: &Cluster<'_>`
- Logs warnings for debugging
- Maintains backward compatibility

## Example Generated Code

### Before (Hardcoded)

```rust
let flow = hydro_lang::compile::builder::FlowBuilder::new();
let leader = flow.process();
let workers = flow.cluster();
simple_flow(&leader, &workers);  // Always this signature!
```

### After (Dynamic)

For `fn simple_flow(flow: &FlowBuilder<'a>)`:

```rust
let flow = hydro_lang::compile::builder::FlowBuilder::new();
simple_flow(&flow);  // Matches actual signature
```

For `fn partition(cluster1: Cluster<'a>, cluster2: Cluster<'a>)`:

```rust
let flow = hydro_lang::compile::builder::FlowBuilder::new();
let cluster1 = flow.cluster();
let cluster2 = flow.cluster();
partition(&cluster1, &cluster2);  // Matches actual signature
```

For `fn no_params()`:

```rust
let flow = hydro_lang::compile::builder::FlowBuilder::new();
no_params();  // No parameters
```

## Benefits

1. **Robustness**: Works with any Hydro function signature
2. **Flexibility**: Automatically adapts to different parameter patterns
3. **Maintainability**: Uses existing tree-sitter infrastructure
4. **Backward Compatible**: Falls back to old behavior if parsing fails
5. **Debugging**: Enhanced logging for troubleshooting

## Testing

- Created unit test file: `src/test/cargoOrchestrator.unit.test.ts`
- Compilation verified with `npm run compile`
- No TypeScript errors or lint warnings

## Files Modified

- `hydro-ide/src/visualization/cargoOrchestrator.ts`: Main implementation
- `hydro-ide/src/test/cargoOrchestrator.unit.test.ts`: Unit tests (new file)
