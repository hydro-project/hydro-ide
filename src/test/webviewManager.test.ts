/**
 * Tests for WebviewManager
 * Verifies graph data communication between extension and webview
 * 
 * NOTE: These tests produce "DisposableStore already disposed" errors in the console.
 * These are harmless warnings from VS Code's internal webview disposal system during testing.
 * They occur because the test environment disposes resources aggressively between tests,
 * and webview event listeners try to register with already-disposed stores.
 * The tests still pass correctly - these errors don't affect functionality.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { WebviewManager, ViewState } from '../webviewManager';

suite('WebviewManager - Graph Data Communication', () => {
  let outputChannel: vscode.OutputChannel;
  let context: vscode.ExtensionContext;
  let manager: WebviewManager | undefined;

  setup(() => {
    outputChannel = vscode.window.createOutputChannel('Test');
    // Create a minimal mock context
    context = {
      extensionUri: vscode.Uri.file('/test/extension'),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
  });

  teardown(() => {
    // Dispose manager before disposing output channel to prevent disposal errors
    if (manager) {
      manager.dispose();
      manager = undefined;
    }
    outputChannel.dispose();
  });

  test('should create WebviewManager instance', () => {
    manager = new WebviewManager(context, outputChannel);
    assert.ok(manager);
    assert.strictEqual(manager.hasActiveVisualization(), false);
  });

  test('should track active visualization state', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    // Initially no active visualization
    assert.strictEqual(manager.hasActiveVisualization(), false);
    
    // After showing visualization, should have active state
    const graphJson = JSON.stringify({ nodes: [], edges: [] });
    await manager.showVisualization(graphJson);
    
    assert.strictEqual(manager.hasActiveVisualization(), true);
    
    // Should have current state
    const state = manager.getCurrentState();
    assert.ok(state);
    assert.strictEqual(state.graphJson, graphJson);
  });

  test('should validate graph JSON before showing', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    // Invalid JSON should throw
    await assert.rejects(
      async () => {
        await manager!.showVisualization('invalid json');
      },
      /Invalid graph JSON/
    );
  });

  test('should preserve view state across updates', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    const graphJson1 = JSON.stringify({ nodes: [{ id: '1' }], edges: [] });
    const graphJson2 = JSON.stringify({ nodes: [{ id: '1' }, { id: '2' }], edges: [] });
    
    // Show initial visualization
    await manager.showVisualization(graphJson1);
    
    // Simulate view state change from webview
    const viewState: ViewState = { x: 100, y: 200, zoom: 1.5 };
    const state = manager.getCurrentState();
    if (state) {
      state.viewState = viewState;
    }
    
    // Refresh with new graph
    await manager!.refresh(graphJson2);
    
    // View state should be preserved
    const updatedState = manager.getCurrentState();
    assert.ok(updatedState);
    assert.deepStrictEqual(updatedState.viewState, viewState);
  });

  test('should update scope information', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    const graphJson = JSON.stringify({ nodes: [], edges: [] });
    
    await manager.showVisualization(graphJson, {
      scopeType: 'function',
      targetName: 'my_function',
    });
    
    const state = manager.getCurrentState();
    assert.ok(state);
    assert.strictEqual(state.scopeType, 'function');
    assert.strictEqual(state.targetName, 'my_function');
  });

  test('should throw error when refreshing without active visualization', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    const graphJson = JSON.stringify({ nodes: [], edges: [] });
    
    await assert.rejects(
      async () => {
        await manager!.refresh(graphJson);
      },
      /No active visualization to refresh/
    );
  });

  test('should throw error when exporting without active visualization', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    await assert.rejects(
      async () => {
        await manager!.exportJson();
      },
      /No active visualization to export/
    );
    
    await assert.rejects(
      async () => {
        await manager!.exportPng();
      },
      /No active visualization to export/
    );
  });

  test('should validate JSON during refresh', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    const validJson = JSON.stringify({ nodes: [], edges: [] });
    await manager.showVisualization(validJson);
    
    // Invalid JSON should throw during refresh
    await assert.rejects(
      async () => {
        await manager!.refresh('invalid json');
      },
      /Invalid graph JSON/
    );
  });

  test('should handle graph configuration options', async () => {
    manager = new WebviewManager(context, outputChannel);
    
    const graphJson = JSON.stringify({ nodes: [], edges: [] });
    const graphConfig = {
      showMetadata: true,
      showLocationGroups: false,
      useShortLabels: true,
    };
    
    await manager.showVisualization(graphJson, {
      scopeType: 'file',
      targetName: 'test.rs',
      graphConfig,
    });
    
    // Should not throw and should store state
    const state = manager.getCurrentState();
    assert.ok(state);
    assert.strictEqual(state.scopeType, 'file');
  });

  test('should clean up on dispose', () => {
    manager = new WebviewManager(context, outputChannel);
    
    // Should not throw
    manager.dispose();
    
    // After dispose, should not have active visualization
    assert.strictEqual(manager.hasActiveVisualization(), false);
    
    // Clear manager reference since we already disposed it
    manager = undefined;
  });
});
