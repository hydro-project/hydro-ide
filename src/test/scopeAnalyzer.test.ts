/**
 * Unit tests for ScopeAnalyzer
 * 
 * Tests function detection with various Hydro patterns, file-level analysis,
 * and edge cases like no Hydro code and malformed syntax.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { ScopeAnalyzer } from '../analysis/scopeAnalyzer';
import {
  ScopeDetectionError,
  ScopeErrorCategory,
} from '../core/types';

/**
 * Mock output channel for testing
 */
class MockOutputChannel implements vscode.OutputChannel {
  name = 'Test Output';
  private lines: string[] = [];

  append(value: string): void {
    this.lines.push(value);
  }

  appendLine(value: string): void {
    this.lines.push(value + '\n');
  }

  clear(): void {
    this.lines = [];
  }

  show(): void {}
  hide(): void {}
  dispose(): void {}

  getLines(): string[] {
    return this.lines;
  }

  replace(_value: string): void {}
}

suite('ScopeAnalyzer Test Suite', () => {
  let outputChannel: MockOutputChannel;
  let analyzer: ScopeAnalyzer;

  setup(() => {
    outputChannel = new MockOutputChannel();
    analyzer = new ScopeAnalyzer(outputChannel);
  });

  suite('Function Detection - Hydro Attributes', () => {
    test('Should detect function with #[hydro::flow] attribute', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      // Position cursor in hello_world_flow function (around line 10)
      const position = new vscode.Position(10, 0);
      editor.selection = new vscode.Selection(position, position);

      const result = await analyzer.analyzeScope(editor, 'function');

      assert.strictEqual(result.type, 'function');
      assert.strictEqual(result.functions.length, 1);
      assert.strictEqual(result.functions[0].name, 'hello_world_flow');
      assert.ok(result.workspaceRoot);
    });

    test('Should detect function with dfir_syntax! macro', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      // Position cursor in filter_and_count_flow function
      const position = new vscode.Position(20, 0);
      editor.selection = new vscode.Selection(position, position);

      const result = await analyzer.analyzeScope(editor, 'function');

      assert.strictEqual(result.type, 'function');
      assert.strictEqual(result.functions.length, 1);
      assert.strictEqual(result.functions[0].name, 'filter_and_count_flow');
    });

    test('Should detect function returning Dfir type', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      // Position cursor in branching_flow function
      const position = new vscode.Position(35, 0);
      editor.selection = new vscode.Selection(position, position);

      const result = await analyzer.analyzeScope(editor, 'function');

      assert.strictEqual(result.type, 'function');
      assert.strictEqual(result.functions.length, 1);
      assert.strictEqual(result.functions[0].name, 'branching_flow');
    });
  });

  suite('File-Level Analysis', () => {
    test('Should find all Hydro functions in simple_flows.rs', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      const result = await analyzer.analyzeScope(editor, 'file');

      assert.strictEqual(result.type, 'file');
      assert.ok(result.functions.length >= 5, 'Should find at least 5 functions');

      // Check that expected functions are present
      const functionNames = result.functions.map((f) => f.name);
      assert.ok(functionNames.includes('hello_world_flow'));
      assert.ok(functionNames.includes('filter_and_count_flow'));
      assert.ok(functionNames.includes('branching_flow'));
      assert.ok(functionNames.includes('union_flow'));
      assert.ok(functionNames.includes('join_flow'));
    });

    test('Should find all Hydro functions in complex_flows.rs', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/complex_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      const result = await analyzer.analyzeScope(editor, 'file');

      assert.strictEqual(result.type, 'file');
      assert.ok(result.functions.length >= 6, 'Should find at least 6 functions');

      // Check that expected functions are present
      const functionNames = result.functions.map((f) => f.name);
      assert.ok(functionNames.includes('stateful_flow'));
      assert.ok(functionNames.includes('multi_join_flow'));
      assert.ok(functionNames.includes('cross_product_flow'));
    });

    test('Should find all Hydro functions in multi_process.rs', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/multi_process.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      const result = await analyzer.analyzeScope(editor, 'file');

      assert.strictEqual(result.type, 'file');
      assert.ok(result.functions.length >= 5, 'Should find at least 5 functions');

      // Check that expected functions are present
      const functionNames = result.functions.map((f) => f.name);
      assert.ok(functionNames.includes('echo_server_flow'));
      assert.ok(functionNames.includes('multi_process_coordination_flow'));
      assert.ok(functionNames.includes('broadcast_flow'));
    });

    test('Should extract correct module paths', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      const result = await analyzer.analyzeScope(editor, 'file');

      // All functions should have module path set
      result.functions.forEach((func) => {
        assert.ok(func.modulePath, `Function ${func.name} should have module path`);
        assert.ok(
          func.modulePath.includes('simple_flows'),
          `Module path should include file name: ${func.modulePath}`
        );
      });
    });

    test('Should extract correct line numbers', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      const result = await analyzer.analyzeScope(editor, 'file');

      // All functions should have valid line numbers
      result.functions.forEach((func) => {
        assert.ok(
          func.startLine >= 0,
          `Function ${func.name} should have valid start line`
        );
        assert.ok(
          func.endLine >= func.startLine,
          `Function ${func.name} end line should be >= start line`
        );
      });
    });
  });

  suite('Edge Cases - No Hydro Code', () => {
    test('Should throw error when no Hydro function at cursor', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      // Position cursor in test module (not a Hydro function)
      const position = new vscode.Position(100, 0);
      editor.selection = new vscode.Selection(position, position);

      try {
        await analyzer.analyzeScope(editor, 'function');
        assert.fail('Should have thrown ScopeDetectionError');
      } catch (error) {
        assert.ok(error instanceof ScopeDetectionError);
        assert.strictEqual(
          (error as ScopeDetectionError).category,
          ScopeErrorCategory.NO_HYDRO_CODE
        );
      }
    });

    test('Should throw error when file has no Hydro functions', async () => {
      // Create a temporary file with no Hydro code
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder, 'Workspace folder should exist');

      const tempFilePath = path.join(
        workspaceFolder.uri.fsPath,
        'temp_no_hydro.rs'
      );

      const nonHydroCode = `
// Regular Rust code without Hydro
pub fn regular_function() -> i32 {
    42
}

pub fn another_function(x: i32) -> i32 {
    x * 2
}
`;

      const fsPromises = await import('fs/promises');
      await fsPromises.writeFile(tempFilePath, nonHydroCode);

      try {
        const document = await vscode.workspace.openTextDocument(tempFilePath);
        const editor = await vscode.window.showTextDocument(document);

        try {
          await analyzer.analyzeScope(editor, 'file');
          assert.fail('Should have thrown ScopeDetectionError');
        } catch (error) {
          assert.ok(error instanceof ScopeDetectionError);
          assert.strictEqual(
            (error as ScopeDetectionError).category,
            ScopeErrorCategory.NO_HYDRO_CODE
          );
        }
      } finally {
        // Clean up temp file
        try {
          await fsPromises.unlink(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  suite('Edge Cases - Malformed Syntax', () => {
    test('Should handle file with syntax errors gracefully', async () => {
      // Create a temporary file with syntax errors but valid structure
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder, 'Workspace folder should exist');

      const tempFilePath = path.join(
        workspaceFolder.uri.fsPath,
        'temp_malformed.rs'
      );

      // Code with semantic errors but valid structure for parsing
      const malformedCode = `
use dfir_rs::dfir_syntax;
use dfir_rs::scheduled::graph::Dfir;

// Function with invalid syntax inside but valid structure
pub fn function_with_errors() -> Dfir<'static> {
    dfir_syntax! {
        source_iter([1, 2, 3])
            -> map(|x| x.invalid_method())  // Invalid method call
            -> for_each(|x| println!("{}", x));
    }
}

// Valid function that should be detected
pub fn valid_function() -> Dfir<'static> {
    dfir_syntax! {
        source_iter([4, 5, 6])
            -> for_each(|x| println!("{}", x));
    }
}
`;

      await fsPromises.writeFile(tempFilePath, malformedCode);

      try {
        const document = await vscode.workspace.openTextDocument(tempFilePath);
        const editor = await vscode.window.showTextDocument(document);

        // Should not throw and should find both functions
        const result = await analyzer.analyzeScope(editor, 'file');

        // Should find both functions despite semantic errors
        assert.ok(
          result.functions.length >= 2,
          `Should find at least 2 functions, found ${result.functions.length}`
        );
        
        const functionNames = result.functions.map((f) => f.name);
        assert.ok(
          functionNames.includes('valid_function'),
          'Should find valid_function'
        );
      } finally {
        // Clean up temp file
        try {
          await fsPromises.unlink(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    test('Should handle nested functions', async () => {
      // Create a temporary file with nested functions
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder, 'Workspace folder should exist');

      const tempFilePath = path.join(
        workspaceFolder.uri.fsPath,
        'temp_nested.rs'
      );

      const nestedCode = `
use dfir_rs::dfir_syntax;
use dfir_rs::scheduled::graph::Dfir;

pub fn outer_function() -> Dfir<'static> {
    // Inner closure (not a Hydro function)
    let mapper = |x: i32| {
        x * 2
    };

    dfir_syntax! {
        source_iter([1, 2, 3])
            -> map(mapper)
            -> for_each(|x| println!("{}", x));
    }
}
`;

      await fsPromises.writeFile(tempFilePath, nestedCode);

      try {
        const document = await vscode.workspace.openTextDocument(tempFilePath);
        const editor = await vscode.window.showTextDocument(document);

        const result = await analyzer.analyzeScope(editor, 'file');

        // Should find the outer function
        assert.strictEqual(result.functions.length, 1);
        assert.strictEqual(result.functions[0].name, 'outer_function');
      } finally {
        // Clean up temp file
        try {
          await fsPromises.unlink(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  suite('Function Metadata Extraction', () => {
    test('Should detect public functions', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      const result = await analyzer.analyzeScope(editor, 'file');

      // All test functions should be public
      result.functions.forEach((func) => {
        assert.ok(
          func.filePath.includes('simple_flows.rs'),
          `Function ${func.name} should have correct file path`
        );
      });
    });

    test('Should extract function attributes', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);
      const editor = await vscode.window.showTextDocument(document);

      const result = await analyzer.analyzeScope(editor, 'file');

      // Functions should have attributes array (may be empty)
      result.functions.forEach((func) => {
        assert.ok(
          Array.isArray(func.attributes),
          `Function ${func.name} should have attributes array`
        );
      });
    });
  });

  suite('Workspace-Level Analysis', () => {
    test('Should find Cargo.toml in workspace', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder, 'Workspace folder should exist');

      // This test assumes we're in the sample-hydro-project workspace
      const result = await analyzer.analyzeScope(
        await vscode.window.activeTextEditor!,
        'workspace'
      );

      assert.strictEqual(result.type, 'workspace');
      assert.ok(result.workspaceRoot);
      assert.ok(result.functions.length > 0, 'Should find functions in workspace');
    });

    test('Should find all Rust files in workspace', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder, 'Workspace folder should exist');

      const result = await analyzer.analyzeScope(
        await vscode.window.activeTextEditor!,
        'workspace'
      );

      // Should find functions from multiple files
      const uniqueFiles = new Set(result.functions.map((f) => f.filePath));
      assert.ok(
        uniqueFiles.size >= 3,
        'Should find functions from at least 3 files'
      );
    });

    test('Should aggregate functions from all files', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder, 'Workspace folder should exist');

      const result = await analyzer.analyzeScope(
        await vscode.window.activeTextEditor!,
        'workspace'
      );

      // Should find a significant number of functions across all files
      assert.ok(
        result.functions.length >= 15,
        `Should find at least 15 functions, found ${result.functions.length}`
      );
    });
  });

  suite('Hydro Pattern Detection', () => {
    test('Should detect dfir_syntax! macro', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);

      const isLikely = await analyzer.isLikelyHydroFile(document);
      assert.strictEqual(isLikely, true, 'Should detect dfir_syntax! macro');
    });

    test('Should detect Hydro imports', async () => {
      const testFilePath = path.join(
        __dirname,
        '../../test-fixtures/sample-hydro-project/src/simple_flows.rs'
      );

      const document = await vscode.workspace.openTextDocument(testFilePath);

      const isLikely = await analyzer.isLikelyHydroFile(document);
      assert.strictEqual(isLikely, true, 'Should detect Hydro imports');
    });

    test('Should not detect Hydro in non-Hydro files', async () => {
      // Create a temporary file with no Hydro code
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder, 'Workspace folder should exist');

      const tempFilePath = path.join(
        workspaceFolder.uri.fsPath,
        'temp_regular.rs'
      );

      const regularCode = `
pub fn regular_function() -> i32 {
    42
}
`;

      await fsPromises.writeFile(tempFilePath, regularCode);

      try {
        const document = await vscode.workspace.openTextDocument(tempFilePath);

        const isLikely = await analyzer.isLikelyHydroFile(document);
        assert.strictEqual(isLikely, false, 'Should not detect Hydro in regular file');
      } finally {
        // Clean up temp file
        try {
          await fsPromises.unlink(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });
});
