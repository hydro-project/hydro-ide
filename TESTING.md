# Testing Checklist

This document provides comprehensive testing checklists for the Hydro IDE extension in both VSCode and Kiro IDE.

## Pre-Testing Setup

### Prerequisites

- [ ] VSCode 1.80.0 or higher installed
- [ ] Kiro IDE installed (for Kiro testing)
- [ ] Rust toolchain with Cargo installed
- [ ] Hydro project available for testing (e.g., `hydro/dfir_rs/examples/`)

### Build Extension

```bash
cd hydroscope-ide
npm install
npm run build
```

### Install Extension

**For VSCode:**
```bash
npm run package
code --install-extension hydro-ide-0.1.0.vsix
```

**For Kiro IDE:**
1. Open Kiro IDE
2. Extensions view → "..." menu → "Install from VSIX"
3. Select the `.vsix` file

## VSCode Testing Checklist

### Installation & Activation

- [ ] Extension installs without errors
- [ ] Extension activates when opening a Rust file
- [ ] Extension icon appears in Extensions view
- [ ] Extension commands appear in Command Palette
- [ ] No errors in Developer Tools Console (Help → Toggle Developer Tools)

### Command Functionality

#### Visualize Function
- [ ] Command appears in Command Palette
- [ ] Command works from Command Palette
- [ ] Command works from context menu (right-click)
- [ ] Detects function at cursor position correctly
- [ ] Shows error when cursor not in Hydro function
- [ ] Webview panel opens beside editor
- [ ] Graph renders correctly
- [ ] Loading indicator shows during build

#### Visualize File
- [ ] Command appears in Command Palette
- [ ] Command works from Command Palette
- [ ] Command works from context menu
- [ ] Detects all Hydro functions in file
- [ ] Shows error when no Hydro functions found
- [ ] Graph shows all functions
- [ ] Multiple functions are properly organized

#### Visualize Workspace
- [ ] Command appears in Command Palette
- [ ] Command works from Command Palette
- [ ] Detects all Hydro code in workspace
- [ ] Shows error when no Hydro code found
- [ ] Graph shows all workspace functions
- [ ] Large graph warning appears (if applicable)

### Webview Functionality

#### Rendering
- [ ] Graph renders without errors
- [ ] Nodes display correctly
- [ ] Edges display correctly
- [ ] Labels are readable
- [ ] Colors and styling are correct
- [ ] Layout is organized and clear

#### Interactions
- [ ] Zoom in/out with mouse wheel works
- [ ] Pan by dragging works
- [ ] Node selection works
- [ ] Node metadata displays on selection
- [ ] Hierarchy toggles work (if applicable)
- [ ] Controls are responsive

#### View State
- [ ] View state preserved when refreshing
- [ ] Zoom level maintained across refreshes
- [ ] Pan position maintained across refreshes

### Configuration

#### Settings Access
- [ ] Settings appear in VSCode Settings UI
- [ ] All settings have correct types
- [ ] Default values are correct
- [ ] Setting descriptions are clear

#### Auto-Refresh
- [ ] Setting can be enabled/disabled
- [ ] Auto-refresh works when enabled
- [ ] Auto-refresh doesn't trigger when disabled
- [ ] Debouncing works (rapid saves don't cause multiple builds)
- [ ] Only triggers for Rust files

#### Cargo Settings
- [ ] Release mode setting works
- [ ] Features array setting works
- [ ] Timeout setting works
- [ ] Settings are passed to Cargo correctly

#### Graph Settings
- [ ] Show metadata setting works
- [ ] Show location groups setting works
- [ ] Use short labels setting works
- [ ] Settings affect graph rendering

#### Performance Settings
- [ ] Large graph threshold setting works
- [ ] Warn on large graphs setting works
- [ ] Warning appears at correct threshold

### Export Functionality

#### Export JSON
- [ ] Command appears in Command Palette
- [ ] File save dialog opens
- [ ] JSON file is created
- [ ] JSON content is valid
- [ ] JSON matches Hydroscope format
- [ ] Success notification appears

#### Export PNG
- [ ] Command appears in Command Palette
- [ ] File save dialog opens
- [ ] PNG file is created
- [ ] PNG captures current view
- [ ] Image quality is acceptable
- [ ] Success notification appears

### Error Handling

#### Scope Detection Errors
- [ ] Clear error message when no Hydro code found
- [ ] Error message explains the issue
- [ ] "Learn More" action works (if applicable)

#### Compilation Errors
- [ ] Cargo errors are displayed
- [ ] Error message is readable
- [ ] "Show Output" action works
- [ ] Output channel shows detailed errors

#### JSON Errors
- [ ] Invalid JSON error is displayed
- [ ] Missing JSON error is displayed
- [ ] Error message is helpful

#### Webview Errors
- [ ] Rendering errors are caught
- [ ] Error message is displayed
- [ ] Extension doesn't crash

### Logging

- [ ] Output channel is created
- [ ] Log messages appear in output channel
- [ ] Log levels are appropriate (info, error)
- [ ] Timestamps are included
- [ ] Error details are logged

### Theme Compatibility

Test with different VSCode themes:

#### Light Themes
- [ ] Default Light+
- [ ] Solarized Light
- [ ] GitHub Light

#### Dark Themes
- [ ] Default Dark+
- [ ] Monokai
- [ ] Dracula

#### High Contrast
- [ ] High Contrast Light
- [ ] High Contrast Dark

For each theme:
- [ ] Webview is readable
- [ ] Colors are appropriate
- [ ] No contrast issues
- [ ] Icons are visible

### Performance

#### Small Graphs (< 50 nodes)
- [ ] Build completes quickly (< 10 seconds)
- [ ] Rendering is instant
- [ ] Interactions are smooth
- [ ] No lag or stuttering

#### Medium Graphs (50-500 nodes)
- [ ] Build completes reasonably (< 30 seconds)
- [ ] Rendering is fast (< 2 seconds)
- [ ] Interactions are responsive
- [ ] Minimal lag

#### Large Graphs (> 500 nodes)
- [ ] Warning appears before rendering
- [ ] User can cancel
- [ ] Build completes (may take time)
- [ ] Rendering works (may be slow)
- [ ] Interactions still functional

### Edge Cases

- [ ] Empty Rust file (no Hydro code)
- [ ] File with syntax errors
- [ ] File with compilation errors
- [ ] Very large workspace
- [ ] Nested Hydro functions
- [ ] Macro-generated Hydro code
- [ ] Multiple visualizations open simultaneously
- [ ] Closing visualization during build
- [ ] Switching files during build
- [ ] Saving file during build

### Stability

- [ ] No crashes during normal use
- [ ] No memory leaks (check Task Manager)
- [ ] Extension can be disabled/enabled
- [ ] Extension can be uninstalled cleanly
- [ ] Reloading window works correctly

## Kiro IDE Testing Checklist

### Installation & Activation

- [ ] Extension installs without errors in Kiro
- [ ] Extension activates when opening a Rust file
- [ ] Extension icon appears in Extensions view
- [ ] Extension commands appear in Command Palette
- [ ] No errors in Developer Tools Console

### Feature Parity with VSCode

Run all VSCode tests above and verify:

- [ ] All commands work identically
- [ ] All configuration options work identically
- [ ] Webview rendering is identical
- [ ] Export functionality works identically
- [ ] Error handling works identically
- [ ] Performance is comparable

### Kiro-Specific Testing

#### AI Integration
- [ ] Extension doesn't interfere with Kiro AI features
- [ ] Kiro AI can reference visualization panel
- [ ] No conflicts with Kiro's webview usage

#### Kiro UI
- [ ] Extension fits Kiro's UI design
- [ ] Icons are consistent with Kiro style
- [ ] Notifications match Kiro style
- [ ] Context menus work in Kiro

#### Kiro Features
- [ ] Works with Kiro's file management
- [ ] Works with Kiro's project structure
- [ ] Works with Kiro's terminal integration
- [ ] Works with Kiro's settings sync

### Known Differences

Document any differences between VSCode and Kiro:

- [ ] No functional differences found
- [ ] OR: List specific differences below

Differences:
```
(None expected - document if found)
```

## Test Projects

### Recommended Test Projects

1. **Simple Example**: `hydro/dfir_rs/examples/chat`
   - Small, easy to understand
   - Good for basic functionality testing

2. **Medium Example**: `hydro/dfir_rs/examples/kvs_replicated`
   - More complex dataflow
   - Good for testing graph rendering

3. **Complex Example**: `hydro/dfir_rs/examples/two_pc_hf`
   - Large, complex graph
   - Good for performance testing

### Creating Test Cases

For each test project:

1. Open project in VSCode/Kiro
2. Test function-level visualization
3. Test file-level visualization
4. Test workspace-level visualization
5. Test auto-refresh
6. Test export functionality
7. Test error handling (introduce errors)

## Regression Testing

Before each release, run through:

- [ ] All VSCode tests
- [ ] All Kiro IDE tests
- [ ] All test projects
- [ ] All themes
- [ ] All edge cases

## Bug Reporting

If you find issues during testing:

1. Note the exact steps to reproduce
2. Capture screenshots/videos
3. Check Developer Tools Console for errors
4. Check Output channel for logs
5. Note VSCode/Kiro version
6. Note extension version
7. Create GitHub issue with all details

## Performance Benchmarks

Record performance metrics:

### Build Times
- Small project: _____ seconds
- Medium project: _____ seconds
- Large project: _____ seconds

### Rendering Times
- Small graph: _____ ms
- Medium graph: _____ ms
- Large graph: _____ ms

### Memory Usage
- Idle: _____ MB
- With small graph: _____ MB
- With large graph: _____ MB

## Sign-Off

### VSCode Testing
- Tester: _______________
- Date: _______________
- Version: _______________
- Result: ☐ Pass ☐ Fail
- Notes: _______________

### Kiro IDE Testing
- Tester: _______________
- Date: _______________
- Version: _______________
- Result: ☐ Pass ☐ Fail
- Notes: _______________

## Automated Testing (Future)

Consider adding:
- [ ] Unit tests for extension code
- [ ] Integration tests for Cargo orchestration
- [ ] E2E tests with VSCode Test API
- [ ] CI/CD pipeline for automated testing
