import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Hydroscope, type HydroscopeData, type RenderConfig } from 'hydroscope';
import 'hydroscope/style.css';
import './styles.css';

// VSCode API available in webview context
interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare const acquireVsCodeApi: () => VsCodeApi;

// Initialize VSCode API
const vscode = acquireVsCodeApi();

// Message types from extension to webview
interface UpdateGraphMessage {
  type: 'updateGraph';
  graphJson: string;
  viewState?: ViewState;
}

type ExtensionMessage = UpdateGraphMessage;

// Message types from webview to extension
interface ViewStateChangedMessage {
  type: 'viewStateChanged';
  viewState: ViewState;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

interface ReadyMessage {
  type: 'ready';
}

type WebviewMessage = 
  | ViewStateChangedMessage 
  | ErrorMessage 
  | ReadyMessage;

// View state interface - matches ReactFlow's Viewport
interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Hydroscope viewer component
 * Renders the graph visualization with export buttons
 */
function HydroscopeViewer({
  graphData,
  onConfigChange,
  isUpdating
}: {
  graphData: HydroscopeData;
  onConfigChange: (config: RenderConfig) => void;
  isUpdating: boolean;
}) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {isUpdating && (
        <div className="update-indicator">
          <div className="update-spinner"></div>
          <span>Updating graph...</span>
        </div>
      )}
      <Hydroscope
        data={graphData}
        showFileUpload={false}
        showInfoPanel={true}
        showStylePanel={true}
        responsive={true}
        uiScale={0.8}
        onConfigChange={onConfigChange}
      />
    </div>
  );
}



/**
 * Main webview application component
 * Integrates Hydroscope with VSCode extension communication
 */
function App() {
  const [graphData, setGraphData] = useState<HydroscopeData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Handle graph update from extension
   */
  const handleUpdateGraph = useCallback((message: UpdateGraphMessage) => {
    try {
      // Show update indicator if graph already exists
      if (graphData) {
        setIsUpdating(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const data = JSON.parse(message.graphJson) as HydroscopeData;
      
      // Validate basic structure
      if (!data.nodes || !Array.isArray(data.nodes)) {
        throw new Error('Invalid graph data: missing or invalid nodes array');
      }

      setGraphData(data);
      setLoading(false);
      setIsUpdating(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to parse graph JSON';
      setError(errorMsg);
      setLoading(false);
      setIsUpdating(false);
      postMessage({
        type: 'error',
        message: errorMsg
      });
    }
  }, [graphData]);





  /**
   * Handle configuration changes from Hydroscope StyleTuner
   */
  const handleConfigChange = useCallback((_config: RenderConfig) => {
    // Configuration is managed internally by Hydroscope
    // This callback is here for potential future use
  }, []);

  // Handle messages from extension
  useEffect(() => {
    const messageHandler = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;

      switch (message.type) {
        case 'updateGraph':
          handleUpdateGraph(message);
          break;
      }
    };

    window.addEventListener('message', messageHandler);

    // Notify extension that webview is ready
    postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [handleUpdateGraph]);

  /**
   * Post message to extension
   */
  const postMessage = useCallback((message: WebviewMessage) => {
    vscode.postMessage(message);
  }, []);

  // Render loading state
  if (loading && !graphData) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading graph visualization...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h2>Error Loading Graph</h2>
          <p>{error}</p>
          <p className="error-hint">
            Check the Output panel (Hydro IDE) for more details.
          </p>
        </div>
      </div>
    );
  }

  // Render empty state
  if (!graphData) {
    return (
      <div className="container">
        <div className="empty-state">
          <h2>No Graph Data</h2>
          <p>Run a Hydro visualization command to display a graph.</p>
        </div>
      </div>
    );
  }

  // Render Hydroscope visualization
  return (
    <div className="container">
      <HydroscopeViewer
        graphData={graphData}
        onConfigChange={handleConfigChange}
        isUpdating={isUpdating}
      />
    </div>
  );
}

// Initialize React app
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
} else {
  console.error('Root element not found');
}
