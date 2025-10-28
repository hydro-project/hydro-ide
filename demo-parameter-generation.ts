/**
 * Demo script to show how CargoOrchestrator generates test code
 * for different function signatures
 */

import { CargoOrchestrator } from './src/visualization/cargoOrchestrator';
import { HydroFunction } from './src/core/types';
import * as vscode from 'vscode';

// Mock output channel
const mockChannel = {
  appendLine: (line: string) => console.log(line),
  append: () => {},
  clear: () => {},
  show: () => {},
  hide: () => {},
  dispose: () => {},
  replace: () => {},
  name: 'demo',
} as vscode.OutputChannel;

// Create orchestrator
const orchestrator = new CargoOrchestrator(mockChannel);

// Example functions with different signatures
const exampleFunctions: HydroFunction[] = [
  {
    name: 'simple_flow',
    modulePath: 'sample_project',
    filePath: './test-fixtures/sample-hydro-project/src/simple_flows.rs',
    startLine: 4,
    endLine: 13,
    attributes: ['hydro::flow'],
    usesMacro: false,
  },
  {
    name: 'partition',
    modulePath: 'sample_project',
    filePath: './test-fixtures/sample-hydro-project/src/simple_cluster.rs',
    startLine: 6,
    endLine: 23,
    attributes: [],
    usesMacro: false,
  },
];

// Generate test code for each function
async function demo() {
  console.log('=== CargoOrchestrator Test Code Generation Demo ===\n');

  for (let i = 0; i < exampleFunctions.length; i++) {
    const func = exampleFunctions[i];
    console.log(`\n--- Function: ${func.name} ---`);
    console.log(`File: ${func.filePath}`);
    console.log(`Lines: ${func.startLine}-${func.endLine}\n`);

    try {
      // Access the private method for demo purposes
      const testBody = await (orchestrator as any)['generateFunctionTestBody'](func, i);
      console.log('Generated test code:');
      console.log('```rust');
      console.log(testBody);
      console.log('```\n');
    } catch (error) {
      console.error(`Error generating test for ${func.name}:`, error);
    }
  }
}

// Run demo
demo().catch(console.error);
