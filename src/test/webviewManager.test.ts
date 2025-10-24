/**
 * Tests for WebviewManager
 * Verifies graph data communication between extension and webview
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { WebviewManager, ViewState } from '../webviewManager';

suite('WebviewManager - Graph Data Communication', () => {
  let outputChannel: vscode.OutputChannel;
  let context: vscode.ExtensionContext;

  setup(() => {
    outputChannel = vscode.window.createOutputChannel('Test');
    // Create a minimal mock context
    context = {
      extensionUri: vscode.Uri.file('/test/extension'),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
  });

  teardown(() => {
    outputChannel.dispose();
  });

  test('should create WebviewManager instance', () => {
    const manager = new WebviewManager(context, outputChannel);
    assert.ok(manager);
    assert.strictEqual(manager.hasActiveVisualization(), false);
  });

  test('should track active visualization state', async () => {
    const manager = new WebviewManager(context, outputChannel);
    
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
    const manager = new WebviewManager(context, outputChannel);
    
    // Invalid JSON should throw
    await assert.rejects(
      async () => {
        await manager.showVisualization('invalid json');
      },
      /Invalid graph JSON/
    );
  });

  test('should preserve view state across updates', async () => {
    const manager = new WebviewManager(context, outputChannel);
    
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
    await manager.refresh(graphJson2);
    
    // View state should be preserved
    const updatedState = manager.getCurrentState();
    assert.ok(updatedState);
    assert.deepStrictEqual(updatedState.viewState, viewState);
  });

  test('should update scope information', async () => {
    const manager = new WebviewManager(context, outputChannel);
    
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
    const manager = new WebviewManager(context, outputChannel);
    
    const graphJson = JSON.stringify({ nodes: [], edges: [] });
    
    await assert.rejects(
      async () => {
        await manager.refresh(graphJson);
      },
      /No active visualization to refresh/
    );
  });

  test('should throw error when exporting without active visualization', async () => {
    const manager = new WebviewManager(context, outputChannel);
    
    await assert.rejects(
      async () => {
        await manager.exportJson();
      },
      /No active visualization to export/
    );
    
    await assert.rejects(
      async () => {
        await manager.exportPng();
      },
      /No active visualization to export/
    );
  });

  test('should validate JSON during refresh', async () => {
    const manager = new WebviewManager(context, outputChannel);
    
    const validJson = JSON.stringify({ nodes: [], edges: [] });
    await manager.showVisualization(validJson);
    
    // Invalid JSON should throw during refresh
    await assert.rejects(
      async () => {
        await manager.refresh('invalid json');
      },
      /Invalid graph JSON/
    );
  });

  test('should handle graph configuration options', async () => {
    const manager = new WebviewManager(context, outputChannel);
    
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
    const manager = new WebviewManager(context, outputChannel);
    
    // Should not throw
    manager.dispose();
    
    // After dispose, should not have active visualization
    assert.strictEqual(manager.hasActiveVisualization(), false);
  });
});
