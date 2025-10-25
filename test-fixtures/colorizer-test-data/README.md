# Location Colorizer Test Data

This directory contains Rust test files copied from `hydro/hydro_test/src/cluster` for testing the location colorizer feature.

## Test Files

### paxos.rs
A complex Paxos implementation with multiple location types:
- `Cluster<Proposer>` - Proposer cluster nodes
- `Cluster<Acceptor>` - Acceptor cluster nodes
- Various Hydro operators and method chains

This file is useful for testing:
- Complex type inference
- Multiple distinct location types in one file
- Struct definitions for location type parameters

### simple_cluster.rs
Simpler cluster examples with:
- `Process<()>` - Simple process locations
- `Cluster<()>` - Simple cluster locations
- FlowBuilder patterns
- Basic Hydro operators

This file is useful for testing:
- Basic location type detection
- FlowBuilder parameter recognition
- Simple method chains

## Usage

These files are used by:
- `hydro-ide/src/test/locationColorizer.integration.test.ts` - Integration tests that analyze these files with rust-analyzer
- Manual testing of the colorizer feature

## Notes

- These files are snapshots and may not compile standalone (they reference other modules)
- They are used purely for testing the location analyzer's ability to extract type information
- rust-analyzer must be active for integration tests to work properly
