# Sample Hydro Project

This is a sample Hydro project for testing the Hydro IDE VSCode/Kiro extension.

## Purpose

This project contains various Hydro dataflow examples at different complexity levels to test all visualization features:

- **Function-level visualization**: Individual Hydro functions
- **File-level visualization**: Multiple functions in a single file
- **Workspace-level visualization**: All Hydro code in the project

## Project Structure

```
src/
├── lib.rs              # Main library file
├── simple_flows.rs     # Simple examples (hello world, filter, branch, union, join)
├── complex_flows.rs    # Complex examples (stateful, multi-join, grouping, routing)
└── multi_process.rs    # Distributed examples (echo, coordination, broadcast, aggregation)
```

## Examples

### Simple Flows (`simple_flows.rs`)

1. **hello_world_flow**: Basic string transformation and printing
2. **filter_and_count_flow**: Filtering, mapping, and aggregation
3. **branching_flow**: Data splitting with tee
4. **union_flow**: Merging multiple streams
5. **join_flow**: Joining two streams on a key

### Complex Flows (`complex_flows.rs`)

1. **stateful_flow**: Stateful operations with scan
2. **multi_join_flow**: Multiple join operations
3. **cross_product_flow**: Cross join for combinations
4. **group_and_aggregate_flow**: Grouping with reduce_keyed
5. **complex_routing_flow**: Multiple branches and merges
6. **persistent_state_flow**: State persistence across ticks

### Multi-Process Flows (`multi_process.rs`)

1. **echo_server_flow**: Simple echo pattern
2. **multi_process_coordination_flow**: Process coordination
3. **broadcast_flow**: One-to-many communication
4. **aggregation_flow**: Many-to-one aggregation
5. **request_response_flow**: Bidirectional communication

## Testing the Extension

### Function-Level Visualization

1. Open any `.rs` file in the `src/` directory
2. Place your cursor inside a function (e.g., `hello_world_flow`)
3. Run command: **Hydro: Visualize Function**
4. The extension will visualize just that function

### File-Level Visualization

1. Open any `.rs` file in the `src/` directory
2. Run command: **Hydro: Visualize File**
3. The extension will visualize all Hydro functions in that file

### Workspace-Level Visualization

1. Open the workspace in VSCode/Kiro
2. Run command: **Hydro: Visualize Workspace**
3. The extension will visualize all Hydro code in the project

## Building and Running

```bash
# Build the project
cargo build

# Run tests
cargo test

# Run a specific test
cargo test test_hello_world

# Build with visualization features
cargo build --features viz
```

## Expected Visualizations

Each flow should produce a graph showing:

- **Nodes**: Operators (source, map, filter, join, etc.)
- **Edges**: Data flow between operators
- **Hierarchies**: Grouped nodes (if applicable)
- **Metadata**: Operator details and configurations

### Simple Flows

- **hello_world_flow**: Linear pipeline (source → map → for_each)
- **branching_flow**: Tree structure with tee and multiple branches
- **union_flow**: Multiple sources merging into one
- **join_flow**: Two sources joining on a key

### Complex Flows

- **multi_join_flow**: Multiple join operations creating a complex graph
- **complex_routing_flow**: Multiple tees, branches, and unions
- **persistent_state_flow**: Feedback loops with persist

### Multi-Process Flows

- **broadcast_flow**: One source splitting to multiple receivers
- **aggregation_flow**: Multiple sources merging to one aggregator

## Troubleshooting

### Compilation Errors

If you get compilation errors, make sure:

1. The Hydro framework is properly installed
2. The path to `dfir_rs` in `Cargo.toml` is correct
3. You're using a compatible Rust version

### Visualization Not Working

If visualization doesn't work:

1. Check that the extension is installed and activated
2. Verify you're in a Rust file with Hydro code
3. Check the Output panel for error messages
4. Try the "Hydro: Refresh Visualization" command

### Large Graphs

Some flows (like `complex_routing_flow`) may produce large graphs. The extension will warn you if the graph is too large.

## Contributing

Feel free to add more examples to test additional Hydro features!
