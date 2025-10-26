# Contributing to Hydro IDE

Thank you for your interest in contributing to the Hydro IDE extension! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- Node.js 18.0 or higher
- npm (comes with Node.js)
- VSCode or Kiro IDE for testing
- Rust toolchain with Cargo (for testing with Hydro projects)
- Git

### Setting Up Development Environment

1. Clone the repository:

   ```bash
   git clone https://github.com/hydro-project/hydro.git
   cd hydro/hydroscope-ide
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the extension:

   ```bash
   npm run build
   ```

4. Open in VSCode:
   ```bash
   code .
   ```

### Running in Development Mode

1. Open the `hydroscope-ide` folder in VSCode
2. Press `F5` to launch the Extension Development Host
3. A new VSCode window will open with the extension loaded
4. Open a Hydro project in the new window to test

### Project Structure

```
hydroscope-ide/
├── src/                    # Extension source code (Node.js)
│   ├── extension.ts        # Main extension entry point
│   ├── hydroIDE.ts  # Main orchestration class
│   ├── scopeAnalyzer.ts    # Hydro code detection
│   ├── cargoOrchestrator.ts # Cargo build integration
│   ├── webviewManager.ts   # Webview lifecycle management
│   ├── errorHandler.ts     # Error handling and reporting
│   ├── config.ts           # Configuration management
│   ├── logger.ts           # Logging utilities
│   └── types.ts            # TypeScript type definitions
├── webview/                # Webview source code (React)
│   ├── index.tsx           # React app entry point
│   └── styles.css          # Webview styles
├── dist/                   # Compiled output
├── package.json            # Extension manifest
├── tsconfig.json           # TypeScript configuration
└── webpack.config.js       # Build configuration
```

## Development Workflow

### Making Changes

1. Create a new branch:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the appropriate files

3. Test your changes:
   - Press `F5` to launch Extension Development Host
   - Test all affected functionality
   - Check for errors in the Debug Console

4. Run linting and formatting:

   ```bash
   npm run lint
   npm run format
   npm run typecheck
   ```

5. Commit your changes:
   ```bash
   git add .
   git commit -m "Description of your changes"
   ```

### Code Style

- Follow TypeScript best practices
- Use ESLint and Prettier configurations provided
- Write clear, descriptive variable and function names
- Add comments for complex logic
- Keep functions focused and single-purpose

### Testing

#### Manual Testing Checklist

- [ ] Test function-level visualization
- [ ] Test file-level visualization
- [ ] Test workspace-level visualization
- [ ] Test auto-refresh functionality
- [ ] Test export to JSON
- [ ] Test export to PNG
- [ ] Test error handling (invalid code, compilation errors)
- [ ] Test with different VSCode themes
- [ ] Test configuration changes
- [ ] Test in both VSCode and Kiro IDE (if possible)

#### Testing with Sample Projects

Use the Hydro examples in `hydro/dfir_rs/examples/` for testing:

- Simple examples: `chat`, `echo_server`
- Complex examples: `kvs_replicated`, `two_pc_hf`

### Debugging

#### Extension Host Debugging

1. Set breakpoints in `src/` files
2. Press `F5` to start debugging
3. Breakpoints will be hit in the Extension Development Host

#### Webview Debugging

1. Open Extension Development Host
2. Open a visualization
3. Right-click in the webview → "Inspect"
4. Use browser DevTools to debug React code

#### Logging

Use the Logger class for debugging:

```typescript
import { Logger } from './logger';

const logger = Logger.getInstance();
logger.info('Debug message');
logger.error('Error message', error);
```

View logs in: View → Output → Hydro IDE

## Contribution Guidelines

### What to Contribute

We welcome contributions in these areas:

- **Bug fixes**: Fix issues reported in GitHub Issues
- **Features**: Implement features from the roadmap or propose new ones
- **Documentation**: Improve README, add examples, fix typos
- **Testing**: Add test cases, improve test coverage
- **Performance**: Optimize build times, webview performance
- **Compatibility**: Test and fix issues in different environments

### Before Submitting

1. Ensure your code follows the style guidelines
2. Run all linting and type checking
3. Test thoroughly in both VSCode and Kiro IDE (if possible)
4. Update documentation if needed
5. Add entry to CHANGELOG.md under [Unreleased]

### Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Push to your fork
5. Open a Pull Request with:
   - Clear description of changes
   - Reference to related issues
   - Screenshots/GIFs for UI changes
   - Testing notes

### Commit Message Guidelines

Use clear, descriptive commit messages:

```
feat: Add support for custom keyboard shortcuts
fix: Resolve webview rendering issue on Windows
docs: Update troubleshooting section
refactor: Simplify scope detection logic
test: Add tests for error handling
```

Prefixes:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Architecture Overview

### Extension Host (Node.js)

The extension runs in Node.js and has access to:

- VSCode APIs
- File system
- Child processes (for Cargo)
- Extension configuration

Key components:

- **HydroIDE**: Main orchestration class
- **ScopeAnalyzer**: Detects Hydro code in Rust files
- **CargoOrchestrator**: Manages Cargo builds
- **WebviewManager**: Manages webview lifecycle
- **ErrorHandler**: Handles and reports errors

### Webview (Browser Context)

The webview runs in a browser context and has access to:

- DOM APIs
- React
- Hydroscope library
- Message passing to Extension Host

Key components:

- **React App**: Main webview application
- **Hydroscope Integration**: Graph rendering
- **Message Handler**: Communication with extension

### Communication Flow

```
User Command → Extension Host → Scope Analyzer → Cargo Orchestrator
                                                        ↓
                                                   Build & Extract JSON
                                                        ↓
Extension Host ← JSON ← Cargo Output
     ↓
Webview Manager → Webview (React + Hydroscope)
     ↓
Display Graph
```

## Common Tasks

### Adding a New Command

1. Add command to `package.json`:

   ```json
   {
     "command": "hydro-ide.myCommand",
     "title": "Hydro: My Command"
   }
   ```

2. Register in `extension.ts`:

   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand('hydro-ide.myCommand', () => ide.myCommand())
   );
   ```

3. Implement in `hydroIDE.ts`:
   ```typescript
   async myCommand(): Promise<void> {
     // Implementation
   }
   ```

### Adding a Configuration Option

1. Add to `package.json` configuration:

   ```json
   "hydroIDE.myOption": {
     "type": "boolean",
     "default": true,
     "description": "My option description"
   }
   ```

2. Read in code:
   ```typescript
   const config = vscode.workspace.getConfiguration('hydroIDE');
   const myOption = config.get<boolean>('myOption');
   ```

### Modifying the Webview

1. Edit `webview/index.tsx` for React components
2. Edit `webview/styles.css` for styling
3. Rebuild: `npm run build`
4. Reload Extension Development Host

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [VSCode Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Hydroscope Documentation](../hydroscope/README.md)
- [Hydro Framework](../hydro/README.md)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

## Getting Help

- Open an issue on GitHub
- Check existing issues and discussions
- Review the troubleshooting section in README.md
- Ask in the Hydro community channels

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.

Thank you for contributing to Hydro IDE! 🚀
