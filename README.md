# Hydro IDE

IDE support for Hydro dataflow programming in VSCode and Kiro IDE, featuring dataflow graph visualization powered by Hydroscope.

![Hydro IDE](https://img.shields.io/badge/version-0.1.0-blue) ![License](https://img.shields.io/badge/license-Apache--2.0-green)

## Overview

Hydro IDE brings powerful development tools for Hydro dataflow programming directly into your editor. Visualize dataflow graphs, explore program structure, and understand your distributed systems without leaving your development environment.

## Features

- **Function-level visualization**: Visualize individual Hydro functions at your cursor position
- **File-level visualization**: Visualize all Hydro functions in the current file
- **Workspace-level visualization**: Visualize all Hydro code across your entire workspace
- **Interactive graph exploration**: Zoom, pan, and explore dataflow graphs with full Hydroscope features
- **Auto-refresh**: Optionally refresh visualizations automatically when you save files
- **Export capabilities**: Export visualizations as JSON or PNG images
- **Kiro IDE compatible**: Works seamlessly in both VSCode and Kiro IDE
- **Context menu integration**: Right-click in Rust files for quick access to visualization commands
- **Configurable builds**: Control Cargo build settings, features, and timeouts
- **Performance warnings**: Get notified when visualizing large graphs

## Requirements

- VSCode 1.80.0 or higher (or Kiro IDE)
- Rust toolchain with Cargo
- A Hydro project using the Hydro framework

## Installation

### Quick Install

1. Download the `.vsix` file
2. Open VSCode/Kiro IDE
3. Go to Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
4. Click "..." menu → "Install from VSIX..."
5. Select the downloaded `.vsix` file

For detailed installation instructions, see [INSTALL.md](INSTALL.md).

### From Marketplace (Coming Soon)

Search for "Hydro IDE" in the VSCode Extensions Marketplace.

## Usage

### Visualizing Hydro Code

1. Open a Rust file containing Hydro code
2. Use one of these methods:
   - **Command Palette** (Ctrl+Shift+P / Cmd+Shift+P):
     - `Hydro: Visualize Function` - Visualize function at cursor
     - `Hydro: Visualize File` - Visualize all functions in file
     - `Hydro: Visualize Workspace` - Visualize entire workspace
   - **Context Menu**: Right-click in a Rust file and select visualization option
   - **Keyboard Shortcuts**: Configure custom shortcuts in VSCode settings

3. The visualization will appear in a new panel beside your editor

### Interacting with Visualizations

- **Zoom**: Use mouse wheel or pinch gesture
- **Pan**: Click and drag the canvas
- **Select nodes**: Click on nodes to view metadata
- **Toggle hierarchies**: Use controls to show/hide grouped nodes
- **Refresh**: Use `Hydro: Refresh Visualization` command or enable auto-refresh

### Exporting Visualizations

- **Export as JSON**: `Hydro: Export as JSON` - Save the graph data
- **Export as PNG**: `Hydro: Export as PNG` - Save a screenshot of the current view

## Configuration

Configure the extension through VSCode settings (File → Preferences → Settings → Extensions → Hydro IDE):

### Auto-Refresh

- `hydroIDE.autoRefresh`: Automatically refresh when Rust files are saved (default: `false`)

### Cargo Build Settings

- `hydroIDE.cargo.releaseMode`: Build in release mode (default: `false`)
- `hydroIDE.cargo.features`: Additional Cargo features to enable (default: `[]`)
- `hydroIDE.cargo.timeout`: Build timeout in milliseconds (default: `120000`)

### Graph Display Settings

- `hydroIDE.graph.showMetadata`: Show node metadata (default: `true`)
- `hydroIDE.graph.showLocationGroups`: Group nodes by location (default: `true`)
- `hydroIDE.graph.useShortLabels`: Use shortened node labels (default: `false`)

### Performance Settings

- `hydroIDE.performance.largeGraphThreshold`: Node count for large graph warning (default: `500`)
- `hydroIDE.performance.warnOnLargeGraphs`: Show warning for large graphs (default: `true`)

## How It Works

1. **Scope Detection**: The extension analyzes your Rust code to identify Hydro functions
2. **Compilation**: Cargo builds your code with visualization metadata enabled
3. **JSON Extraction**: Graph data is extracted from the build output
4. **Rendering**: Hydroscope renders the interactive graph in a webview panel

## Troubleshooting

### "No Hydro code found"

**Problem**: Extension reports it cannot find Hydro code at the requested scope.

**Solutions**:
- Ensure your cursor is inside a Hydro function (marked with `#[hydro::flow]` or using `hydro_lang::flow!`)
- Check that your file imports the Hydro framework
- Verify the function uses Hydro-specific constructs
- For file-level visualization, ensure the file contains at least one Hydro function
- For workspace-level visualization, ensure you're in a Cargo workspace with Hydro dependencies

### Compilation Errors

**Problem**: Cargo build fails when generating visualization.

**Solutions**:
- View detailed errors in the Output panel (View → Output → Hydro IDE)
- Ensure your project builds successfully with `cargo build` in the terminal
- Check that required Cargo features are enabled in settings
- Verify all dependencies are properly configured in `Cargo.toml`
- Try increasing the `hydroIDE.cargo.timeout` setting for large projects
- Check that you have the correct Rust toolchain installed

### Invalid or Missing Graph JSON

**Problem**: Build succeeds but visualization fails to display.

**Solutions**:
- Check the Output panel for JSON parsing errors
- Ensure your Hydro code properly generates visualization metadata
- Verify that the Hydro framework version supports visualization
- Try rebuilding with `cargo clean` first

### Large Graph Performance

**Problem**: Visualization is slow or unresponsive with large graphs.

**Solutions**:
- Consider visualizing at function or file level instead of workspace level
- Disable auto-refresh for better performance (`hydroIDE.autoRefresh: false`)
- Increase the warning threshold: `hydroIDE.performance.largeGraphThreshold`
- The extension will warn you when graphs exceed the configured threshold
- Close and reopen the visualization panel to reset the view state

### Webview Not Displaying

**Problem**: Visualization panel opens but shows blank or error.

**Solutions**:
- Check browser console in the webview (Help → Toggle Developer Tools)
- Ensure you have a stable internet connection (for loading external resources)
- Try closing and reopening the visualization panel
- Restart VSCode/Kiro IDE
- Check for conflicting extensions that might interfere with webviews

### Auto-Refresh Not Working

**Problem**: Visualization doesn't update when saving files.

**Solutions**:
- Verify `hydroIDE.autoRefresh` is set to `true`
- Ensure the visualization panel is visible (auto-refresh only works when panel is open)
- Check that you're saving a Rust file (`.rs` extension)
- Look for errors in the Output panel that might prevent refresh

### Extension Not Activating

**Problem**: Commands don't appear or extension doesn't load.

**Solutions**:
- Ensure you have VSCode 1.80.0 or higher
- Check that you've opened a folder/workspace (not just a single file)
- Verify the extension is enabled in the Extensions view
- Look for activation errors in Help → Toggle Developer Tools → Console
- Try reloading the window (Developer: Reload Window command)

### Kiro IDE Specific Issues

**Problem**: Extension behaves differently in Kiro IDE.

**Solutions**:
- Verify you're using a compatible Kiro IDE version
- Check Kiro IDE's extension compatibility documentation
- Report Kiro-specific issues with details about your Kiro version
- Most features should work identically; if not, this may be a bug

## Kiro IDE Compatibility

This extension is fully compatible with Kiro IDE and uses only standard VSCode Extension APIs. All features work identically in both environments.

### Installation in Kiro IDE

1. Open Kiro IDE
2. Navigate to Extensions view
3. Search for "Hydro IDE" or install from VSIX
4. Reload Kiro IDE if prompted

### Verified Compatibility

- ✅ All visualization commands (function, file, workspace)
- ✅ Context menu integration
- ✅ Webview rendering and interactions
- ✅ Configuration settings
- ✅ Auto-refresh functionality
- ✅ Export features (JSON and PNG)
- ✅ Error handling and logging

### Known Differences

There are no known functional differences between VSCode and Kiro IDE. If you encounter any Kiro-specific issues, please report them with:
- Kiro IDE version
- Extension version
- Steps to reproduce
- Expected vs. actual behavior

## Examples

### Visualizing a Simple Hydro Function

```rust
use hydro_lang::*;

#[hydro::flow]
pub fn simple_pipeline() -> impl Quoted<'static, Hydroflow<'static>> {
    let flow = q!(|_| {
        source_iter([1, 2, 3, 4, 5])
            -> map(|x| x * 2)
            -> filter(|x| x > 5)
            -> for_each(|x| println!("{}", x));
    });
    flow
}
```

1. Place cursor inside the `simple_pipeline` function
2. Run command: `Hydro: Visualize Function`
3. View the dataflow graph showing source → map → filter → for_each

### Visualizing Multiple Functions

```rust
#[hydro::flow]
pub fn producer() -> impl Quoted<'static, Hydroflow<'static>> {
    // ... producer logic
}

#[hydro::flow]
pub fn consumer() -> impl Quoted<'static, Hydroflow<'static>> {
    // ... consumer logic
}
```

1. Open the file containing both functions
2. Run command: `Hydro: Visualize File`
3. View all functions in a single visualization

## Keyboard Shortcuts

You can configure custom keyboard shortcuts for quick access:

1. Open Keyboard Shortcuts (Ctrl+K Ctrl+S / Cmd+K Cmd+S)
2. Search for "Hydro"
3. Assign shortcuts to your preferred commands

Example shortcuts:
- `Ctrl+Alt+H F` - Visualize Function
- `Ctrl+Alt+H L` - Visualize File
- `Ctrl+Alt+H R` - Refresh Visualization

## Development

### Building from Source

```bash
cd hydroscope-ide
npm install
npm run build
```

### Running in Development

1. Open the `hydroscope-ide` folder in VSCode
2. Press F5 to launch the Extension Development Host
3. Open a Hydro project in the new window

### Packaging

```bash
npm run package
```

This creates a `.vsix` file that can be installed in VSCode or Kiro IDE.

## Contributing

Contributions are welcome! Please see the main Hydro project repository for contribution guidelines.

## License

Apache-2.0

## Documentation

- **[Installation Guide](INSTALL.md)** - Detailed installation instructions
- **[Quick Start Guide](QUICKSTART.md)** - Get started in 5 minutes
- **[Testing Guide](TESTING.md)** - Comprehensive testing checklist
- **[Contributing Guide](CONTRIBUTING.md)** - Help improve the extension
- **[Changelog](CHANGELOG.md)** - Version history and updates

## Links

- [Hydro Project](https://github.com/hydro-project/hydro)
- [Hydroscope Documentation](https://github.com/hydro-project/hydro/tree/main/hydroscope)
- [Report Issues](https://github.com/hydro-project/hydro/issues)
- [VSCode Extension API](https://code.visualstudio.com/api)
