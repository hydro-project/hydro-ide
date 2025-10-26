# Release Checklist

Use this checklist before releasing a new version of the Hydro IDE extension.

## Pre-Release

### Code Quality

- [ ] All tests pass: `npm test`
- [ ] No linting errors: `npm run lint`
- [ ] No type errors: `npm run typecheck`
- [ ] Code is formatted: `npm run format:check`

### Documentation

- [ ] README.md is up to date
- [ ] CHANGELOG.md has entry for this version
- [ ] INSTALL.md has correct installation instructions
- [ ] QUICKSTART.md reflects current features
- [ ] All inline documentation is accurate

### Version Management

- [ ] Version number updated in `package.json`
- [ ] Version number matches in CHANGELOG.md
- [ ] Git tag created for version

## Build and Package

### Clean Build

```bash
npm run clean
npm run build:production
```

- [ ] Build completes without errors
- [ ] Bundle sizes are reasonable (extension < 100KB, webview < 5MB)
- [ ] No source maps in production build

### Package Creation

```bash
npm run package
```

- [ ] VSIX file created successfully
- [ ] Package size is reasonable (< 2MB without test fixtures)
- [ ] No warnings about missing files

### Package Verification

```bash
npm run verify-vsix
```

- [ ] All required files included
- [ ] Source files excluded
- [ ] node_modules excluded
- [ ] Test fixture target excluded
- [ ] Test fixture source included

## Testing

### Functional Testing

Follow [VSIX-TESTING.md](./VSIX-TESTING.md) and verify:

- [ ] Extension activates correctly
- [ ] Function-level visualization works
- [ ] File-level visualization works
- [ ] Workspace-level visualization works
- [ ] Context menu integration works
- [ ] All settings are functional
- [ ] Export to JSON works
- [ ] Export to PNG works
- [ ] Refresh functionality works
- [ ] Error handling is appropriate

### Sample Project Testing

Using `test-fixtures/sample-hydro-project`:

- [ ] Simple flows visualize correctly
- [ ] Complex flows visualize correctly
- [ ] Multi-process flows visualize correctly
- [ ] All test cases pass

### Platform Testing

- [ ] macOS
- [ ] Windows
- [ ] Linux

### IDE Testing

- [ ] VSCode
- [ ] Kiro IDE

## Publishing

### VSCode Marketplace

```bash
# Login (first time only)
vsce login hydro-project

# Publish
vsce publish
```

- [ ] Published to VSCode Marketplace
- [ ] Listing appears correctly
- [ ] Screenshots/images display properly
- [ ] Installation from marketplace works

### Open VSX (for Kiro IDE)

```bash
# Login (first time only)
npx ovsx login

# Publish
npx ovsx publish hydro-ide-*.vsix
```

- [ ] Published to Open VSX
- [ ] Listing appears correctly
- [ ] Installation from Open VSX works

### GitHub Release

- [ ] Git tag pushed
- [ ] GitHub release created
- [ ] VSIX file attached to release
- [ ] Release notes from CHANGELOG included

## Post-Release

### Verification

- [ ] Install from marketplace and verify functionality
- [ ] Check marketplace listing for accuracy
- [ ] Monitor for installation issues

### Communication

- [ ] Announce release (if applicable)
- [ ] Update project documentation
- [ ] Notify users of new features

### Monitoring

- [ ] Monitor error reports
- [ ] Check user feedback
- [ ] Track download statistics

## Rollback Plan

If critical issues are found:

1. Unpublish from marketplace (if necessary)
2. Fix issues
3. Increment patch version
4. Re-run checklist
5. Republish

## Version Numbering

Follow semantic versioning (semver):

- **Major** (x.0.0): Breaking changes
- **Minor** (0.x.0): New features, backward compatible
- **Patch** (0.0.x): Bug fixes, backward compatible

## Notes

- Always test in a clean environment before releasing
- Keep CHANGELOG.md updated with all changes
- Document any breaking changes clearly
- Consider pre-release versions for major changes
