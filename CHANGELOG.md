# Changelog

All notable changes to the Hydro IDE extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-01-XX

### Added

- Initial release of Hydro IDE extension
- **Location type colorization**: Automatic color-coding of Hydro location types (Process, Cluster, External, Tick-wrapped)
  - Each unique location gets a distinct color from an 8-color palette
  - Visual borders distinguish location types: Process (no border), Cluster (double border), External (single border)
  - Theme-aware color palettes for light and dark modes
  - Real-time analysis powered by rust-analyzer
  - Smart caching with LRU eviction for performance
  - Configurable analysis timing and behavior
- Function-level visualization: Visualize individual Hydro functions at cursor position
- File-level visualization: Visualize all Hydro functions in current file
- Workspace-level visualization: Visualize all Hydro code in workspace
- Interactive graph exploration with Hydroscope integration
- Auto-refresh on file save (configurable)
- Export visualizations as JSON or PNG
- Context menu integration for Rust files
- Comprehensive configuration options for Cargo builds and graph display
- Performance warnings for large graphs
- Detailed error handling and logging
- Full compatibility with VSCode and Kiro IDE

### Features

#### Location Type Colorization

- Automatic analysis of Hydro location types in Rust code
- Parses complex nested types (e.g., `Stream<T, Tick<Process<'a, Leader>>, Bounded>`)
- Handles all location types: Process, Cluster, External, and Tick-wrapped variants
- 8-color palette with automatic cycling for unique locations
- Border styles for visual distinction: Process (no border), Cluster (double border), External (single border)
- Separate palettes for light and dark themes
- Performance-optimized with version-aware caching (LRU eviction, configurable cache size)
- Debounced analysis on typing (configurable delay)
- Immediate analysis on save
- Manual commands: Colorize Locations, Clear Colorizations, Clear Cache, Show Cache Statistics
- Configurable file size limits to skip analysis on very large files
- Detailed logging with configurable verbosity levels

#### Visualization Scopes

- Automatic detection of Hydro functions using attributes and macros
- Support for `#[hydro::flow]` attribute detection
- Support for `hydro_lang::flow!` macro detection
- Intelligent scope analysis for function, file, and workspace levels

#### Build Integration

- Cargo orchestration with configurable features
- Release mode support
- Configurable build timeouts
- Incremental build support
- Detailed compilation error reporting

#### Interactive Features

- Zoom and pan controls
- Node selection and metadata display
- Hierarchy toggle support
- ELK automatic layout
- View state preservation across refreshes

#### Configuration

- Location analysis settings:
  - Enable/disable analysis and colorization
  - Debounce delay for typing analysis (0-5000ms)
  - Analyze on type and/or save
  - Maximum file size for analysis (100-100,000 lines)
  - Cache size (1-500 entries)
  - Query timeout for rust-analyzer (100-30,000ms)
- Logging settings:
  - Log level (error, warn, info, debug)
  - Show timing information
- Auto-refresh on save for visualizations
- Cargo build settings (release mode, features, timeout)
- Graph display options (metadata, location groups, label verbosity)
- Performance settings (large graph threshold, warnings)

#### Export

- JSON export with complete Hydroscope format
- PNG export with current view state capture

### Technical Details

- Built with TypeScript and React
- Location colorization powered by rust-analyzer LSP integration
- Advanced type parsing for nested Hydro location types
- Version-aware caching with LRU eviction algorithm
- Debounced analysis to minimize performance impact
- Uses Hydroscope for graph rendering
- Webview-based visualization panel
- Standard VSCode Extension APIs for maximum compatibility
- Comprehensive error handling with categorized error types
- Output channel logging for debugging with configurable verbosity

### Compatibility

- VSCode 1.80.0 or higher
- Kiro IDE (all versions supporting VSCode extensions)
- Rust toolchain with Cargo
- rust-analyzer extension (required for location colorization)
- Hydro framework projects with valid Cargo.toml

## [Unreleased]

### Planned Features

- Interactive debugging: Click nodes to set breakpoints
- Live updates: Show graph changes as program runs
- Diff view: Compare graphs before/after code changes
- Code navigation: Click nodes to jump to source code
- Custom layouts: Save and restore layout preferences
- Collaboration: Share visualizations with team members
- Performance optimizations for very large graphs
- Additional export formats (SVG, PDF)

---

For more information, see the [README](README.md) or visit the [Hydro Project](https://github.com/hydro-project/hydro).
