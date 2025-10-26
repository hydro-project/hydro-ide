# Hydro IDE

IDE support for Hydro dataflow programming in VSCode and Kiro IDE, featuring intelligent location type colorization and dataflow graph visualization.

![Hydro IDE](https://img.shields.io/badge/version-0.1.0-blue) ![License](https://img.shields.io/badge/license-Apache--2.0-green)

## Overview

Hydro IDE enhances your Hydro development experience with intelligent code colorization that highlights location types throughout your code. Each unique location in space and time (like Process<Leader>, Cluster<Worker>, or Tick<Process<Leader>>) gets its own distinct color, making it easy to see at a glance the spatial and timing scope of your distributed systems code. The extension also integrates with [Hydroscope](https://github.com/hydro-project/hydroscope) to visualize complete dataflow graphs, helping you explore program structure and understand your distributed systems without leaving your development environment.

## Features

### Location Type Colorization

- **Automatic colorization**: Hydro location types are automatically highlighted as you type
- **Unique colors per location**: Each distinct location (Process<Leader>, Cluster<Worker>, Tick<Process<...>>, etc.) gets its own color from a palette
- **Handles all location types**: Process, Cluster, External, and Tick-wrapped locations are all colorized
- **Highlight border distinction**: Process location highlights have no border, Cluster locations have double borders, External locations have single borders
- **Theme-aware**: Separate color palettes for light and dark themes
- **Real-time analysis**: Powered by rust-analyzer for accurate type information
- **Performance optimized**: Smart caching and debouncing for smooth editing

### Dataflow Graph Visualization

- **Function-level visualization**: Visualize individual Hydro functions at your cursor position
- **File-level visualization**: Visualize all Hydro functions in the current file
- **Workspace-level visualization**: Visualize all Hydro code across your entire workspace
- **Interactive graph exploration**: Zoom, pan, and explore dataflow graphs with full Hydroscope features
- **Auto-refresh**: Optionally refresh visualizations automatically when you save files
- **Export capabilities**: Export visualizations as JSON or PNG images

### Developer Experience

- **Kiro IDE compatible**: Works seamlessly in both VSCode and Kiro IDE
- **Context menu integration**: Right-click in Rust files for quick access to commands
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

### Location Type Colorization

Location colorization works automatically once you open a Hydro Rust file:

1. **Automatic Mode** (default): Location types are highlighted as you type and save
   - Each unique location gets a distinct color from a palette (e.g., Process<Leader> vs Process<Follower>)
   - Colors cycle through an 8-color palette designed for readability
   - Tick-wrapped locations (like Tick<Process<...>>) are also colorized
   - Visual borders distinguish location categories: Process (no border), Cluster (double border), External (single border)

2. **Manual Commands** (Command Palette: Ctrl+Shift+P / Cmd+Shift+P):
   - `Hydro: Colorize Locations` - Manually trigger location analysis and colorization
   - `Hydro: Clear Colorizations` - Remove all location colorizations from the current file
   - `Hydro: Clear Analysis Cache` - Clear cached analysis results and re-analyze
   - `Hydro: Show Cache Statistics` - Display cache performance metrics in the output panel

3. **Customization**: Override colors for specific location types (Process/Cluster/External), configure analysis timing and behavior in settings (see Configuration section)

### Visualizing Hydro Code as Graphs

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
- See docs for [Hydroscope](https://github.com/hydro-project/hydroscope) for more details.

### Exporting Visualizations

- **Export as JSON**: `Hydro: Export as JSON` - Save the graph data
- **Export as PNG**: `Hydro: Export as PNG` - Save a screenshot of the current view

## Configuration

Configure the extension through VSCode settings (File → Preferences → Settings → Extensions → Hydro IDE):

### Location Analysis Settings

Control how the extension analyzes and colorizes Hydro location types in your code:

- `hydroIde.analysis.enabled`: Enable location analysis and colorization (default: `true`)
- `hydroIde.analysis.debounceDelay`: Delay in milliseconds before analyzing after typing stops (default: `500`, range: `0-5000`)
- `hydroIde.analysis.analyzeOnType`: Analyze document while typing with debounce (default: `true`)
- `hydroIde.analysis.analyzeOnSave`: Analyze document immediately on save (default: `true`)
- `hydroIde.analysis.maxFileSize`: Maximum file size in lines to analyze (default: `10000`, range: `100-100000`)

**Example Configuration:**

```json
{
  "hydroIde.analysis.enabled": true,
  "hydroIde.analysis.debounceDelay": 300,
  "hydroIde.analysis.analyzeOnType": true,
  "hydroIde.analysis.analyzeOnSave": true,
  "hydroIde.analysis.maxFileSize": 5000
}
```

### Location Coloring Settings

- `hydroIde.locationColoring.enabled`: Automatically colorize Hydro location types (default: `true`)

**How Colors Work:**

Each unique location gets a different color from an 8-color palette:

- Process<Leader> gets color 1, Process<Follower> gets color 2, Cluster<Worker> gets color 3, etc.
- Colors cycle through the palette (9th location uses color 1 again, etc.)
- Border styles distinguish location types: Process (no border), Cluster (double border), External (single border)
- Separate color palettes for light and dark themes ensure good visibility

### Auto-Refresh

- `hydroIde.autoRefresh`: Automatically refresh visualization when Rust files are saved (default: `false`)

### Cargo Build Settings

- `hydroIde.cargo.releaseMode`: Build in release mode (default: `false`)
- `hydroIde.cargo.features`: Additional Cargo features to enable (default: `[]`)
- `hydroIde.cargo.timeout`: Build timeout in milliseconds (default: `120000`)

### Graph Display Settings

- `hydroIde.graph.showMetadata`: Show node metadata (default: `true`)
- `hydroIde.graph.showLocationGroups`: Group nodes by location (default: `true`)
- `hydroIde.graph.useShortLabels`: Use shortened node labels (default: `false`)

### Performance Settings

- `hydroIde.performance.largeGraphThreshold`: Node count for large graph warning (default: `500`)
- `hydroIde.performance.warnOnLargeGraphs`: Show warning for large graphs (default: `true`)
- `hydroIde.performance.cacheSize`: Maximum number of cached analysis results (default: `50`, range: `1-500`)
- `hydroIde.performance.queryTimeout`: Timeout for LSP queries in milliseconds (default: `5000`, range: `100-30000`)

**Example Configuration:**

```json
{
  "hydroIde.performance.cacheSize": 100,
  "hydroIde.performance.queryTimeout": 10000
}
```

### Logging Settings

Control the verbosity and detail of extension logging:

- `hydroIde.logging.level`: Logging level for extension output (default: `info`, options: `error`, `warn`, `info`, `debug`)
- `hydroIde.logging.showTimings`: Show timing information in logs (default: `false`)

**Example Configuration:**

```json
{
  "hydroIde.logging.level": "debug",
  "hydroIde.logging.showTimings": true
}
```

## Troubleshooting

### Prerequisites

**Important**: Hydro IDE relies on rust-analyzer for location type analysis and colorization. For the extension to work properly:

- Your Rust code must be in a Cargo project with a `Cargo.toml` file
- rust-analyzer must be installed and active (check the status bar for "rust-analyzer")
- rust-analyzer needs to successfully analyze your code (no major compilation errors that prevent type analysis)
- Wait for rust-analyzer to finish initial indexing after opening a project

If rust-analyzer isn't working, location colorization won't work either.

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

### Location Colorization Issues

**Problem**: Location colors not appearing or incorrect.

**Solutions**:

- Ensure `hydroIde.locationColoring.enabled` is set to `true`
- Verify rust-analyzer is active and ready (check status bar)
- Try manually running `Hydro: Colorize Locations` command
- Check the Output panel (View → Output → Hydro IDE) for analysis errors
- Clear the cache with `Hydro: Clear Analysis Cache` command
- Colors are determined by an 8-color palette that cycles through unique locations

**Problem**: rust-analyzer timeout errors.

**Solutions**:

- Increase `hydroIde.performance.queryTimeout` (e.g., `10000` for 10 seconds)
- Wait for rust-analyzer to finish initial indexing (check status bar)
- Ensure rust-analyzer is not overloaded with other operations
- Check rust-analyzer logs for issues (Output → rust-analyzer)
- Try restarting rust-analyzer (Command: `rust-analyzer: Restart server`)

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


## Keyboard Shortcuts

You can configure custom keyboard shortcuts for quick access:

1. Open Keyboard Shortcuts (Ctrl+K Ctrl+S / Cmd+K Cmd+S)
2. Search for "Hydro"
3. Assign shortcuts to your preferred commands

Example shortcuts:

- `Ctrl+Alt+H C` - Colorize Locations
- `Ctrl+Alt+H X` - Clear Colorizations
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

### Testing

```bash
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests (may show harmless disposal warnings)
```

**Note**: Integration tests may display "DisposableStore already disposed" errors in the console. These are harmless warnings from VS Code's internal webview system during testing and don't affect test results or functionality.

## Contributing

Contributions are welcome! Please see the main Hydro project repository for contribution guidelines.

## License

Apache-2.0

## Documentation

- **[Installation Guide](INSTALL.md)** - Detailed installation instructions
- **[Quick Start Guide](QUICKSTART.md)** - Get started in 5 minutes
- **[Testing Guide](VSIX-TESTING.md)** - Comprehensive testing checklist
- **[Contributing Guide](CONTRIBUTING.md)** - Help improve the extension
- **[Changelog](CHANGELOG.md)** - Version history and updates

## Links

- [Hydro Project](https://github.com/hydro-project/hydro)
- [Hydroscope Documentation](https://github.com/hydro-project/hydro/tree/main/hydroscope)
- [Report Issues](https://github.com/hydro-project/hydro/issues)
- [VSCode Extension API](https://code.visualstudio.com/api)
