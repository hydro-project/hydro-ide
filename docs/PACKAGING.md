# Packaging Guide

This guide explains how to package the Hydro IDE extension for distribution.

## Prerequisites

- Node.js >= 18.0
- npm
- All dependencies installed (`npm ci`)

## Build for Production

The extension uses webpack to bundle both the extension host code and the webview code.

```bash
# Build production bundle (optimized and minified)
npm run build:production

# Or use the standard build command for development
npm run build
```

The production build:
- Minifies JavaScript code
- Removes source maps
- Optimizes bundle size
- Sets NODE_ENV=production

## Package as VSIX

### Standard Release

```bash
# Run pre-packaging checks (lint, typecheck, build)
npm run prepackage

# Create VSIX package
npm run package
```

This creates a `.vsix` file in the root directory: `hydro-ide-{version}.vsix`

### Pre-release Version

```bash
# Create pre-release VSIX
npm run package:pre-release
```

## Package Configuration

### .vscodeignore

The `.vscodeignore` file controls which files are excluded from the VSIX package:

- Source files (`src/`, `webview/`)
- Development configuration files
- Test files
- node_modules (dependencies are bundled by webpack)
- Documentation for contributors

Only the following are included:
- `dist/` - Bundled extension and webview code
- `package.json` - Extension manifest
- `README.md` - User documentation
- `LICENSE` - License file
- `CHANGELOG.md` - Version history
- `INSTALL.md` - Installation instructions
- `QUICKSTART.md` - Quick start guide
- Icon files

### Bundle Size Optimization

The webpack configuration optimizes bundle size:

1. **Tree shaking**: Removes unused code
2. **Minification**: Compresses JavaScript (production only)
3. **No source maps**: Excludes source maps in production
4. **Single bundle**: No code splitting for webview

Current bundle sizes (approximate):
- Extension host: ~50KB
- Webview: ~2-3MB (includes Hydroscope, React, ReactFlow, ELK)

## Verification

After packaging, verify the VSIX contents:

```bash
# Run verification script
npm run verify-vsix

# Or manually inspect
unzip -l hydro-ide-*.vsix

# Check bundle sizes
ls -lh dist/
```

Expected files in VSIX:
```
extension/
├── dist/
│   ├── extension.js
│   └── webview.js
├── package.json
├── README.md
├── LICENSE
├── CHANGELOG.md
├── INSTALL.md
├── QUICKSTART.md
└── test-fixtures/
    └── sample-hydro-project/
```

## Installation Testing

Test the packaged extension:

```bash
# Install in VSCode
code --install-extension hydro-ide-*.vsix

# Or install in Kiro IDE
kiro --install-extension hydro-ide-*.vsix
```

For comprehensive testing instructions, see [VSIX-TESTING.md](./VSIX-TESTING.md).

## Publishing

### VSCode Marketplace

```bash
# Login to publisher account
vsce login hydro-project

# Publish (automatically packages and uploads)
vsce publish

# Or publish specific version
vsce publish minor
vsce publish 0.2.0
```

### Open VSX (for Kiro IDE)

```bash
# Install ovsx CLI
npm install -g ovsx

# Login
ovsx login

# Publish
ovsx publish hydro-ide-*.vsix
```

## Troubleshooting

### Large Bundle Size

If the webview bundle is too large:

1. Check webpack bundle analyzer:
   ```bash
   npm install --save-dev webpack-bundle-analyzer
   # Add to webpack config and run build
   ```

2. Consider lazy loading heavy dependencies
3. Verify tree shaking is working

### Missing Dependencies

If the extension fails to load:

1. Check that all runtime dependencies are bundled
2. Verify webpack externals configuration
3. Test in clean VSCode instance

### Version Conflicts

If there are React version conflicts:

1. Check webpack alias configuration
2. Verify only one React instance is bundled
3. Use `npm ls react` to check dependency tree

## CI/CD Integration

For automated packaging in CI/CD:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: npm ci

- name: Build and package
  run: |
    npm run prepackage
    npm run package

- name: Upload VSIX
  uses: actions/upload-artifact@v3
  with:
    name: vsix-package
    path: '*.vsix'
```

## Best Practices

1. **Always run prepackage**: Ensures code quality before packaging
2. **Test VSIX locally**: Install and test before publishing
3. **Update CHANGELOG**: Document changes in each version
4. **Semantic versioning**: Follow semver for version numbers
5. **Clean builds**: Delete `dist/` before building for release
