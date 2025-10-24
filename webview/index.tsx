import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Hydroscope, type HydroscopeData, type RenderConfig } from 'hydroscope';
import html2canvas from 'html2canvas';
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

interface ExportPngMessage {
  type: 'exportPng';
}

interface ExportJsonMessage {
  type: 'exportJson';
}

type ExtensionMessage = UpdateGraphMessage | ExportPngMessage | ExportJsonMessage;

// Message types from webview to extension
interface ViewStateChangedMessage {
  type: 'viewStateChanged';
  viewState: ViewState;
}

interface ExportPngDataMessage {
  type: 'exportPngData';
  dataUrl: string;
}

interface ExportJsonDataMessage {
  type: 'exportJsonData';
  jsonData: string;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

interface ReadyMessage {
  type: 'ready';
}

interface ExportJsonRequestMessage {
  type: 'exportJson';
}

interface ExportPngRequestMessage {
  type: 'exportPng';
}

type WebviewMessage = 
  | ViewStateChangedMessage 
  | ExportPngDataMessage 
  | ExportJsonDataMessage 
  | ErrorMessage 
  | ReadyMessage
  | ExportJsonRequestMessage
  | ExportPngRequestMessage;

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
  hydroscopeRef,
  isUpdating
}: {
  graphData: HydroscopeData;
  onConfigChange: (config: RenderConfig) => void;
  hydroscopeRef: React.RefObject<HTMLDivElement>;
  isUpdating: boolean;
}) {
  return (
    <div ref={hydroscopeRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
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
        onConfigChange={onConfigChange}
      />
      <ExportButtons />
    </div>
  );
}

/**
 * Export buttons component
 * Provides UI for exporting graph as JSON or PNG
 */
function ExportButtons() {
  const handleExportJson = useCallback(() => {
    vscode.postMessage({ type: 'exportJson' });
  }, []);

  const handleExportPng = useCallback(() => {
    vscode.postMessage({ type: 'exportPng' });
  }, []);

  return (
    <div className="export-buttons">
      <button
        className="export-button"
        onClick={handleExportJson}
        title="Export as JSON"
        aria-label="Export as JSON"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.5 1h-11C1.67 1 1 1.67 1 2.5v11c0 .83.67 1.5 1.5 1.5h11c.83 0 1.5-.67 1.5-1.5v-11c0-.83-.67-1.5-1.5-1.5zm-1 11h-9V4h9v8z"/>
        </svg>
        JSON
      </button>
      <button
        className="export-button"
        onClick={handleExportPng}
        title="Export as PNG"
        aria-label="Export as PNG"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 5h-3V2H5v3H2v6h3v3h6v-3h3V5zm-2 5h-2v2H6v-2H4V6h2V4h4v2h2v4z"/>
        </svg>
        PNG
      </button>
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
  
  const hydroscopeRef = useRef<HTMLDivElement>(null);
  const isExportingRef = useRef<boolean>(false);

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
   * Handle PNG export request from extension
   */
  const handleExportPng = useCallback(async () => {
    if (!hydroscopeRef.current || isExportingRef.current || !graphData) {
      return;
    }

    try {
      isExportingRef.current = true;
      
      // Capture the Hydroscope container as PNG
      const canvas = await html2canvas(hydroscopeRef.current, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher quality
        logging: false,
        useCORS: true
      });

      const dataUrl = canvas.toDataURL('image/png');

      postMessage({
        type: 'exportPngData',
        dataUrl
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to capture PNG';
      postMessage({
        type: 'error',
        message: `PNG export failed: ${errorMsg}`
      });
    } finally {
      isExportingRef.current = false;
    }
  }, [graphData]);

  /**
   * Handle JSON export request from extension
   */
  const handleExportJson = useCallback(() => {
    if (!graphData) {
      return;
    }

    try {
      const jsonData = JSON.stringify(graphData, null, 2);
      
      postMessage({
        type: 'exportJsonData',
        jsonData
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to serialize JSON';
      postMessage({
        type: 'error',
        message: `JSON export failed: ${errorMsg}`
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
        case 'exportPng':
          handleExportPng();
          break;
        case 'exportJson':
          handleExportJson();
          break;
      }
    };

    window.addEventListener('message', messageHandler);

    // Notify extension that webview is ready
    postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [handleUpdateGraph, handleExportPng, handleExportJson]);

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
        hydroscopeRef={hydroscopeRef}
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
