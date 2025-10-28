# Hydro Operator Configuration

This directory contains the analysis engine for Hydro operator recognition in the IDE.

## Files

- `lspGraphExtractor.ts` - Main analysis engine that uses operator configuration from VS Code settings
- `hydroOperators.json` - Legacy configuration file (now replaced by VS Code settings)

## Operator Categories

### Networking Operators
Essential operators for distributed communication between Hydro locations (processes, clusters):
- `send_bincode`, `recv_bincode`, `broadcast_bincode`, `demux_bincode`
- `send_bytes`, `recv_bytes`, `broadcast_bytes`, `demux_bytes`
- External communication: `send_bincode_external`, `recv_bincode_external`

### Core Dataflow Operators
Standard operators for transforming and processing data streams:
- **Transform**: `map`, `filter`, `flat_map`, `scan`, `enumerate`
- **Aggregate**: `fold`, `reduce`, `fold_keyed`, `reduce_keyed`
- **Join**: `join`, `cross_product`, `difference`, `anti_join`
- **Time**: `defer_tick`, `persist`, `snapshot`, `timeout`
- **Sources**: `source_iter`, `source_stream`, `source_stdin`
- **Sinks**: `for_each`, `dest_sink`, `assert`

### Collection Types
Valid Hydro collection return types:
- `Stream<`, `Singleton<`, `Optional<`
- `KeyedStream<`, `KeyedSingleton<`

## Updating the Configuration

### Manual Updates
Update the operator lists in VS Code settings:
1. Go to File > Preferences > Settings
2. Search for "Hydro IDE"
3. Expand the "Operators" section
4. Modify the operator lists as needed

Or edit your `settings.json` directly:
```json
{
  "hydroIde.operators.networkingOperators": ["send_bincode", "broadcast_bincode", ...],
  "hydroIde.operators.coreDataflowOperators": ["map", "filter", "fold", ...]
}
```

### Automated Scanning
Use the utility script to scan the Hydro codebase for operators:

```bash
node scripts/updateOperators.js /path/to/hydro/repo
```

This will scan the Hydro source code and suggest updates to the VS Code settings.

## How It Works

The LSP graph extractor loads operator configuration from VS Code settings and uses it for:

1. **Type-based filtering**: Accept operators that return known collection types
2. **Name-based filtering**: Accept operators that match known operator names (fallback when type info is incomplete)
3. **Special handling**: Networking operators are always accepted, even with incomplete type information

This hybrid approach ensures that essential Hydro operators are recognized even when LSP provides incomplete type information, while still filtering out non-dataflow infrastructure code.

### Hot-Swappable Configuration
The configuration is loaded from VS Code settings, making it hot-swappable in the field:
- Changes take effect immediately without restarting VS Code
- Users can customize operator lists for their specific Hydro version
- Teams can share workspace settings with project-specific operator configurations

## Testing

After updating the configuration, test the changes by:

1. Testing with actual Hydro code in the IDE (changes are applied immediately)
2. Checking the output logs for proper operator recognition
3. Using the "Hydro: Clear Analysis Cache" command to force re-analysis

## Troubleshooting

If operators are being incorrectly filtered:

1. Check if they're in the appropriate category in VS Code settings (Hydro IDE > Operators)
2. Verify the return type patterns in `collectionTypes` setting
3. Add debug logging to see what LSP is returning for the operator
4. Consider if the operator should be in `networkingOperators` for special handling
5. Use "Hydro: Clear Analysis Cache" to force re-analysis with new settings