# Installation Guide

This guide covers how to install and test the Hydro IDE extension in both VSCode and Kiro IDE.

## Building the Extension

### Prerequisites

- Node.js 18.0 or higher
- npm (comes with Node.js)

### Build Steps

1. Navigate to the extension directory:
   ```bash
   cd hydroscope-ide
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Package the extension:
   ```bash
   npm run package
   ```

   This creates a `.vsix` file: `hydro-ide-0.1.0.vsix`

## Installing in VSCode

### Method 1: Command Line

```bash
code --install-extension hydro-ide-0.1.0.vsix
```

### Method 2: VSCode UI

1. Open VSCode
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
3. Type "Extensions: Install from VSIX"
4. Select the command
5. Browse to and select `hydro-ide-0.1.0.vsix`
6. Reload VSCode when prompted

### Method 3: Extensions View

1. Open Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Click the "..." menu (top right)
3. Select "Install from VSIX..."
4. Browse to and select `hydro-ide-0.1.0.vsix`
5. Reload VSCode when prompted

## Installing in Kiro IDE

### Method 1: Kiro UI

1. Open Kiro IDE
2. Open Extensions view
3. Click the "..." menu
4. Select "Install from VSIX..."
5. Browse to and select `hydro-ide-0.1.0.vsix`
6. Reload Kiro IDE when prompted

### Method 2: Command Line (if supported)

```bash
kiro --install-extension hydro-ide-0.1.0.vsix
```

## Verifying Installation

### Check Extension is Installed

1. Open Extensions view
2. Search for "Hydro IDE"
3. Verify it appears in the list
4. Check that it's enabled

### Check Commands are Available

1. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Type "Hydro"
3. Verify these commands appear:
   - Hydro: Visualize Function
   - Hydro: Visualize File
   - Hydro: Visualize Workspace
   - Hydro: Refresh Visualization
   - Hydro: Export as JSON
   - Hydro: Export as PNG

### Check Context Menu

1. Open a Rust file (`.rs`)
2. Right-click in the editor
3. Verify these options appear:
   - Visualize Hydro Function
   - Visualize Hydro File

## Testing the Extension

### Quick Test

1. Clone the Hydro repository (if not already):
   ```bash
   git clone https://github.com/hydro-project/hydro.git
   ```

2. Open a Hydro example:
   ```bash
   cd hydro/dfir_rs/examples/chat
   code .  # or open in Kiro IDE
   ```

3. Open a Rust file with Hydro code

4. Run "Hydro: Visualize Function" command

5. Verify the visualization appears

### Comprehensive Testing

Follow the detailed testing checklist in [TESTING.md](TESTING.md).

## Troubleshooting Installation

### Extension Not Activating

**Symptoms**: Commands don't appear, extension shows as disabled

**Solutions**:
- Check VSCode/Kiro version is 1.80.0 or higher
- Reload the window: Developer: Reload Window
- Check for errors in Help → Toggle Developer Tools → Console
- Try uninstalling and reinstalling

### Installation Fails

**Symptoms**: Error during VSIX installation

**Solutions**:
- Verify the `.vsix` file is not corrupted
- Check you have write permissions
- Try closing and reopening VSCode/Kiro
- Check disk space is available

### Commands Not Appearing

**Symptoms**: Extension installed but commands missing

**Solutions**:
- Open a Rust file to trigger activation
- Check extension is enabled in Extensions view
- Reload the window
- Check activation events in Output → Log (Extension Host)

## Uninstalling

### VSCode

1. Open Extensions view
2. Find "Hydro IDE"
3. Click the gear icon
4. Select "Uninstall"
5. Reload VSCode

### Kiro IDE

1. Open Extensions view
2. Find "Hydro IDE"
3. Click uninstall
4. Reload Kiro IDE

### Command Line

```bash
code --uninstall-extension hydro-project.hydro-ide
```

## Development Installation

For development and testing:

1. Open the `hydroscope-ide` folder in VSCode
2. Press `F5` to launch Extension Development Host
3. A new VSCode window opens with the extension loaded
4. Make changes and reload the Extension Development Host

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## Publishing (Future)

When ready to publish to the marketplace:

1. Create a publisher account on Visual Studio Marketplace
2. Get a Personal Access Token (PAT)
3. Login with vsce:
   ```bash
   npx vsce login hydro-project
   ```
4. Publish:
   ```bash
   npx vsce publish
   ```

## Support

If you encounter issues:

- Check [TROUBLESHOOTING](README.md#troubleshooting) in README
- Review [TESTING.md](TESTING.md) for known issues
- Check [GitHub Issues](https://github.com/hydro-project/hydro/issues)
- Create a new issue with:
  - VSCode/Kiro version
  - Extension version
  - Steps to reproduce
  - Error messages/logs

## Next Steps

After installation:

- Read the [Quick Start Guide](QUICKSTART.md)
- Review [Configuration Options](README.md#configuration)
- Try the example projects
- Explore all features

Happy visualizing! 🎉
