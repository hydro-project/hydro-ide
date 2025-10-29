# Tick Variable Scoping Test

This documents the fix for tick variable scoping across different Rust function scopes.

## Problem

Previously, if two different functions used tick variables with the same name:

```rust
fn foo() {
    let ticker = process.tick();
    ops.batch(ticker, ...)
}

fn bar() {
    let ticker = process.tick();  // Different variable, same name!
    other_ops.batch(ticker, ...)
}
```

Both `batch` operations would be incorrectly grouped together because they both had `tickVariable: "ticker"`.

## Solution

Now tick variables are **scoped by their enclosing function**:
- `foo()`'s ticker becomes: `tickVariable: "foo::ticker"`
- `bar()`'s ticker becomes: `tickVariable: "bar::ticker"`

These are distinct identifiers, so the operations are correctly grouped separately.

## Display

In the UI, the function scope prefix is stripped for readability:
- Container name shows: `"ticker"` (not `"foo::ticker"`)
- But internally they're distinguished by the full scoped identifier

## Benefits

1. **Correctness**: Variables in different scopes are no longer confused
2. **No false grouping**: Operations using different tick instances stay separate
3. **Readable UI**: Users still see clean tick variable names without internal scope prefixes
