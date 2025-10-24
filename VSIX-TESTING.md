# VSIX Package Testing Guide

This guide explains how to test the packaged Hydro IDE extension.

## Prerequisites

- VSCode or Kiro IDE installed
- The VSIX package built (`npm run package`)
- Sample Hydro project for testing (included in `test-fixtures/`)

## Quick Verification

Run the verification script to check the package contents:

```bash
./scripts/verify-vsix.sh
```

This will verify:
- Package size is reasonable
- All required files are included
- Source files and node_modules are excluded
- Test fixtures are properly included

## Installation Testing

### Option 1: Install in Current VSCode

```bash
code --install-extension hydro-ide-0.1.0.vsix
```

Then restart VSCode and test the extension.

### Option 2: Test in Clean VSCode Instance

For more thorough testing, use a clean VSCode instance:

```bash
# Create a temporary user data directory
mkdir -p /tmp/vscode-test-user-data

# Launch VSCode with clean profile
code --user-data-dir=/tmp/vscode-test-user-data --install-extension hydro-ide-0.1.0.vsix

# Open the sample project
code --user-data-dir=/tmp/vscode-test-user-data test-fixtures/sample-hydro-project
```

### Option 3: Test in Kiro IDE

```bash
kiro --install-extension hydro-ide-0.1.0.vsix
```

## Functional Testing

Once installed, test all major features:

### 1. Extension Activation

1. Open the sample Hydro project: `test-fixtures/sample-hydro-project`
2. Open a Rust file: `src/simple_flows.rs`
3. Verify the extension activates (check status bar or output panel)

### 2. Function-Level Visualization

1. Open `src/simple_flows.rs`
2. Place cursor inside `hello_world_flow()` function
3. Run command: **Hydro: Visualize Function** (Cmd+Shift+P / Ctrl+Shift+P)
4. Verify:
   - Webview panel opens
   - Graph is displayed
   - Nodes and edges are visible
   - Layout is reasonable

### 3. File-Level Visualization

1. Open `src/simple_flows.rs`
2. Run command: **Hydro: Visualize File**
3. Verify:
   - All functions in the file are visualized
   - Multiple graphs or combined graph is shown
   - Navigation works

### 4. Workspace-Level Visualization

1. With the sample project open
2. Run command: **Hydro: Visualize Workspace**
3. Verify:
   - All Hydro code in the workspace is visualized
   - Large graph warning appears (if applicable)
   - Performance is acceptable

### 5. Context Menu Integration

1. Open `src/simple_flows.rs`
2. Right-click in the editor
3. Verify:
   - "Hydro: Visualize Function" appears in context menu
   - "Hydro: Visualize File" appears in context menu
   - Commands work when clicked

### 6. Configuration Settings

1. Open VSCode Settings (Cmd+, / Ctrl+,)
2. Search for "Hydro IDE"
3. Verify all settings are present:
   - Auto Refresh
   - Cargo Release Mode
   - Cargo Features
   - Cargo Timeout
   - Graph Show Metadata
   - Graph Show Location Groups
   - Graph Use Short Labels
   - Performance Large Graph Threshold
   - Performance Warn On Large Graphs
4. Change a setting and verify it takes effect

### 7. Export Functionality

1. Visualize a function
2. Run command: **Hydro: Export as JSON**
3. Verify JSON file is saved
4. Run command: **Hydro: Export as PNG**
5. Verify PNG file is saved

### 8. Refresh Functionality

1. Visualize a function
2. Modify the Rust code
3. Run command: **Hydro: Refresh Visualization**
4. Verify the graph updates

### 9. Error Handling

Test error scenarios:

1. **No Hydro code**: Open a non-Hydro Rust file, try to visualize
   - Should show appropriate error message

2. **Compilation error**: Introduce syntax error in Hydro code, try to visualize
   - Should show compilation error with details

3. **Large graph**: Try to visualize `complex_routing_flow`
   - Should show warning if graph is large

4. **Timeout**: Set very short timeout in settings, visualize complex code
   - Should handle timeout gracefully

### 10. Performance Testing

1. Visualize `src/complex_flows.rs` (file-level)
2. Verify:
   - Visualization completes in reasonable time
   - UI remains responsive
   - Memory usage is acceptable

## Test Matrix

| Feature | Simple Flow | Complex Flow | Multi-Process | Status |
|---------|-------------|--------------|---------------|--------|
| Function Viz | ✓ | ✓ | ✓ | |
| File Viz | ✓ | ✓ | ✓ | |
| Workspace Viz | ✓ | ✓ | ✓ | |
| Context Menu | ✓ | ✓ | ✓ | |
| Export JSON | ✓ | ✓ | ✓ | |
| Export PNG | ✓ | ✓ | ✓ | |
| Refresh | ✓ | ✓ | ✓ | |
| Settings | ✓ | ✓ | ✓ | |
| Error Handling | ✓ | ✓ | ✓ | |

## Platform Testing

Test on multiple platforms:

- [ ] macOS
- [ ] Windows
- [ ] Linux

## IDE Testing

Test in multiple IDEs:

- [ ] VSCode
- [ ] Kiro IDE

## Uninstallation Testing

1. Uninstall the extension:
   ```bash
   code --uninstall-extension hydro-project.hydro-ide
   ```

2. Verify:
   - Extension is removed
   - No leftover files
   - Settings are cleaned up

## Troubleshooting

### Extension Not Activating

- Check Output panel: View → Output → Select "Hydro IDE"
- Check Developer Tools: Help → Toggle Developer Tools
- Verify Rust and Cargo are installed

### Visualization Not Working

- Check that the file contains valid Hydro code
- Verify Cargo can build the project
- Check timeout settings
- Look for error messages in Output panel

### Performance Issues

- Check graph size (node count)
- Verify system resources
- Try disabling auto-refresh
- Use release mode for large projects

## Reporting Issues

When reporting issues, include:

1. VSCode/Kiro version
2. Extension version
3. Operating system
4. Steps to reproduce
5. Error messages from Output panel
6. Sample code (if possible)

## Automated Testing

For CI/CD integration:

```bash
# Install extension
code --install-extension hydro-ide-0.1.0.vsix

# Run extension tests (if available)
npm test

# Verify installation
code --list-extensions | grep hydro-ide
```

## Success Criteria

The VSIX package is ready for release when:

- ✓ All functional tests pass
- ✓ No errors in Output panel during normal use
- ✓ Performance is acceptable for typical projects
- ✓ Works on all target platforms
- ✓ Documentation is complete and accurate
- ✓ No critical bugs found
