# Quick Start Guide

Get started with Hydro IDE in 5 minutes!

## Installation

### Option 1: From VSIX (Development)

1. Download the `.vsix` file
2. Open VSCode or Kiro IDE
3. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
4. Type "Install from VSIX" and select it
5. Choose the downloaded `.vsix` file

### Option 2: From Marketplace (Coming Soon)

1. Open Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search for "Hydro IDE"
3. Click Install

## First Visualization

### Step 1: Open a Hydro Project

Open a Rust project that uses the Hydro framework. If you don't have one, you can use the examples from the Hydro repository:

```bash
git clone https://github.com/hydro-project/hydro.git
cd hydro/dfir_rs/examples/chat
code .
```

### Step 2: Open a Hydro File

Open a file containing Hydro code. For example, `examples/chat/client.rs` or any file with functions marked with `#[hydro::flow]`.

### Step 3: Visualize

**Method 1: Command Palette**
1. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Type "Hydro: Visualize Function"
3. Press Enter

**Method 2: Context Menu**
1. Right-click in the editor
2. Select "Visualize Hydro Function"

**Method 3: Keyboard Shortcut** (if configured)
- Press your custom shortcut

### Step 4: Explore the Graph

- **Zoom**: Mouse wheel or pinch gesture
- **Pan**: Click and drag
- **Select nodes**: Click on nodes to see details
- **Toggle hierarchies**: Use the controls in the visualization

## Common Workflows

### Visualizing Different Scopes

**Function Level** (Current function at cursor):
```
Command: Hydro: Visualize Function
```

**File Level** (All functions in file):
```
Command: Hydro: Visualize File
```

**Workspace Level** (All Hydro code):
```
Command: Hydro: Visualize Workspace
```

### Auto-Refresh While Coding

1. Open Settings (`Ctrl+,` / `Cmd+,`)
2. Search for "Hydro IDE"
3. Enable "Auto Refresh"
4. Now visualizations update automatically when you save files!

### Exporting Visualizations

**Export as JSON**:
1. Open a visualization
2. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
3. Type "Hydro: Export as JSON"
4. Choose save location

**Export as PNG**:
1. Open a visualization
2. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
3. Type "Hydro: Export as PNG"
4. Choose save location

## Configuration Tips

### Faster Builds

For faster visualization during development:

```json
{
  "hydroIDE.cargo.releaseMode": false,
  "hydroIDE.autoRefresh": false
}
```

### Production-Quality Graphs

For final documentation or presentations:

```json
{
  "hydroIDE.cargo.releaseMode": true,
  "hydroIDE.graph.showMetadata": true,
  "hydroIDE.graph.showLocationGroups": true
}
```

### Large Projects

For large codebases:

```json
{
  "hydroIDE.cargo.timeout": 300000,
  "hydroIDE.performance.largeGraphThreshold": 1000,
  "hydroIDE.performance.warnOnLargeGraphs": true
}
```

## Troubleshooting Quick Fixes

### "No Hydro code found"

✅ Make sure your cursor is inside a function with `#[hydro::flow]`

### Compilation errors

✅ Check that `cargo build` works in your terminal first

### Blank visualization

✅ Check View → Output → Hydro IDE for errors

### Slow performance

✅ Try visualizing at function level instead of workspace level

## Next Steps

- Read the full [README](README.md) for detailed documentation
- Check out [configuration options](README.md#configuration)
- Learn about [troubleshooting](README.md#troubleshooting)
- Explore [Hydro examples](https://github.com/hydro-project/hydro/tree/main/dfir_rs/examples)

## Example: Simple Pipeline

Here's a simple Hydro function you can visualize:

```rust
use hydro_lang::*;

#[hydro::flow]
pub fn simple_pipeline() -> impl Quoted<'static, Hydroflow<'static>> {
    q!(|_| {
        source_iter([1, 2, 3, 4, 5])
            -> map(|x| x * 2)
            -> filter(|x| x > 5)
            -> for_each(|x| println!("{}", x));
    })
}
```

1. Copy this code into a Rust file in your Hydro project
2. Place cursor inside the function
3. Run "Hydro: Visualize Function"
4. See the dataflow graph!

## Getting Help

- 📖 [Full Documentation](README.md)
- 🐛 [Report Issues](https://github.com/hydro-project/hydro/issues)
- 💬 [Hydro Community](https://github.com/hydro-project/hydro)

Happy visualizing! 🎉
