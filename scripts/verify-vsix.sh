#!/bin/bash
# Script to verify VSIX package contents

set -e

VSIX_FILE="hydro-ide-0.1.0.vsix"

if [ ! -f "$VSIX_FILE" ]; then
    echo "Error: VSIX file not found: $VSIX_FILE"
    echo "Run 'npm run package' first"
    exit 1
fi

echo "=== VSIX Package Verification ==="
echo ""

# Check file size
SIZE=$(ls -lh "$VSIX_FILE" | awk '{print $5}')
echo "✓ Package size: $SIZE"

# List contents
echo ""
echo "=== Package Contents ==="
unzip -l "$VSIX_FILE" | grep -E "extension/(dist|package.json|README|LICENSE|CHANGELOG|INSTALL|QUICKSTART|test-fixtures)" | head -30

echo ""
echo "=== Verification Checks ==="

# Check for required files
TEMP_DIR=$(mktemp -d)
unzip -q "$VSIX_FILE" -d "$TEMP_DIR"

check_file() {
    if [ -f "$TEMP_DIR/extension/$1" ]; then
        echo "✓ $1 exists"
    else
        echo "✗ $1 missing"
        exit 1
    fi
}

check_file "package.json"
check_file "README.md"
check_file "LICENSE.txt"
check_file "CHANGELOG.md"
check_file "dist/extension.js"
check_file "dist/webview.js"

# Check that source files are NOT included
if [ -d "$TEMP_DIR/extension/src" ]; then
    echo "✗ Source files should not be included"
    exit 1
else
    echo "✓ Source files excluded"
fi

if [ -d "$TEMP_DIR/extension/node_modules" ]; then
    echo "✗ node_modules should not be included"
    exit 1
else
    echo "✓ node_modules excluded"
fi

# Check that test fixture target is NOT included
if [ -d "$TEMP_DIR/extension/test-fixtures/sample-hydro-project/target" ]; then
    echo "✗ Test fixture target directory should not be included"
    exit 1
else
    echo "✓ Test fixture target excluded"
fi

# Check that test fixture source IS included
if [ -f "$TEMP_DIR/extension/test-fixtures/sample-hydro-project/src/simple_flows.rs" ]; then
    echo "✓ Test fixture source included"
else
    echo "✗ Test fixture source missing"
    exit 1
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== All Checks Passed! ==="
echo ""
echo "The VSIX package is ready for distribution."
echo ""
echo "To install locally:"
echo "  code --install-extension $VSIX_FILE"
echo ""
echo "To test in a clean VSCode instance:"
echo "  code --extensionDevelopmentPath=\$(pwd) --disable-extensions"
