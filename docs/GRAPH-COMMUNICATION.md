# Graph Data Communication Implementation

This document describes the implementation of graph data communication between the VSCode extension and the webview (Task 5.3).

## Overview

The graph data communication system enables bidirectional message passing between the extension host (Node.js) and the webview (browser context) to display and interact with Hydro dataflow graphs.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Extension Host (Node.js)               │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │          WebviewManager                          │  │
│  │                                                  │  │
│  │  • Manages webview panel lifecycle              │  │
│  │  • Sends graph JSON via postMessage              │  │
│  │  • Preserves view state across updates          │  │
│  │  • Handles export requests                      │  │
│  └──────────────────────────────────────────────────┘  │
│                         ↕                               │
│                   postMessage API                       │
│                         ↕                               │
└─────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────┐
│              Webview Panel (Browser Context)            │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │          React Application                       │  │
│  │                                                  │  │
│  │  • Receives graph JSON                           │  │
│  │  • Renders with Hydroscope component             │  │
│  │  • Sends view state changes                      │  │
│  │  • Handles export operations                     │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Message Types

### Extension → Webview

1. **updateGraph**: Send new graph data to display
   ```typescript
   {
     type: 'updateGraph',
     graphJson: string,
     viewState?: ViewState,
     graphConfig?: GraphConfig
   }
   ```

2. **exportPng**: Request PNG export from webview
   ```typescript
   { type: 'exportPng' }
   ```

3. **exportJson**: Request JSON export from webview
   ```typescript
   { type: 'exportJson' }
   ```

### Webview → Extension

1. **ready**: Webview initialization complete
   ```typescript
   { type: 'ready' }
   ```

2. **viewStateChanged**: User changed zoom/pan
   ```typescript
   {
     type: 'viewStateChanged',
     viewState: { x: number, y: number, zoom: number }
   }
   ```

3. **exportPngData**: PNG export data
   ```typescript
   {
     type: 'exportPngData',
     dataUrl: string
   }
   ```

4. **exportJsonData**: JSON export data
   ```typescript
   {
     type: 'exportJsonData',
     jsonData: string
   }
   ```

5. **error**: Error occurred in webview
   ```typescript
   {
     type: 'error',
     message: string,
     details?: string
   }
   ```

6. **nodeSelected**: User selected a node
   ```typescript
   {
     type: 'nodeSelected',
     nodeId: string,
     metadata: unknown
   }
   ```

## Key Features

### 1. Graph Data Transmission

**Implementation**: `WebviewManager.showVisualization()`

- Validates graph JSON before sending
- Sends graph data via `postMessage`
- Includes optional view state and configuration
- Updates panel title based on scope

**Code Location**: `src/webviewManager.ts:66-122`

### 2. View State Preservation

**Implementation**: `WebviewManager.refresh()`

- Stores current view state (zoom, pan position)
- Preserves state across graph updates
- Restores state when refreshing visualization

**Code Location**: `src/webviewManager.ts:124-165`

**View State Interface**:
```typescript
interface ViewState {
  x: number;      // Pan X position
  y: number;      // Pan Y position
  zoom: number;   // Zoom level
}
```

### 3. Refresh Functionality

**Implementation**: `WebviewManager.refresh()`

- Validates new graph JSON
- Sends updated graph with preserved view state
- Updates internal state
- Provides user feedback

**Code Location**: `src/webviewManager.ts:124-165`

### 4. Webview-to-Extension Messages

**Implementation**: `WebviewManager.handleWebviewMessage()`

Handles all messages from webview:
- **ready**: Logs webview initialization
- **viewStateChanged**: Updates stored view state
- **exportPngData**: Saves PNG to file
- **exportJsonData**: Saves JSON to file
- **nodeSelected**: Logs node selection (for future features)
- **error**: Displays error to user

**Code Location**: `src/webviewManager.ts:327-371`

### 5. Export Operations

**PNG Export**:
1. Extension calls `exportPng()`
2. Sends `exportPng` message to webview
3. Webview captures canvas with html2canvas
4. Webview sends `exportPngData` with data URL
5. Extension saves to file

**JSON Export**:
1. Extension calls `exportJson()`
2. Sends `exportJson` message to webview
3. Webview serializes current graph data
4. Webview sends `exportJsonData` with JSON string
5. Extension saves to file

**Code Locations**:
- Extension: `src/webviewManager.ts:167-207`, `373-437`
- Webview: `webview/index.tsx:95-145`

## Webview Implementation

### React Component Structure

```typescript
function App() {
  const [graphData, setGraphData] = useState<HydroscopeData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Message handler
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  
  // Render Hydroscope with graph data
  return <Hydroscope data={graphData} />;
}
```

### State Management

- **loading**: Initial load state
- **isUpdating**: Refresh in progress
- **error**: Error message to display
- **graphData**: Current graph data from extension

### Update Indicator

Shows a non-blocking indicator when refreshing:
```css
.update-indicator {
  position: absolute;
  top: 16px;
  right: 16px;
  /* Styled notification */
}
```

## Error Handling

### Extension Side

- Validates JSON before sending
- Catches postMessage failures
- Logs all operations to output channel
- Shows user-friendly error messages

### Webview Side

- Validates received JSON structure
- Catches parsing errors
- Sends error messages back to extension
- Shows error state in UI

## Testing

### Unit Tests

**File**: `src/test/webviewManager.test.ts`

Tests cover:
- ✅ WebviewManager instance creation
- ✅ Active visualization state tracking
- ✅ Graph JSON validation
- ✅ View state preservation across updates
- ✅ Scope information updates
- ✅ Error handling for missing visualization
- ✅ JSON validation during refresh
- ✅ Graph configuration options
- ✅ Resource cleanup on dispose

**Test Results**: 9/9 passing

### Integration Testing

The implementation integrates with:
- `HydroIDE` for orchestration
- `CargoOrchestrator` for graph generation
- `ScopeAnalyzer` for code detection
- `ErrorHandler` for user feedback

## Performance Considerations

### Message Passing

- Efficient JSON serialization
- Non-blocking postMessage API
- Debounced view state updates

### View State

- Minimal state storage (3 numbers)
- Preserved across updates
- No unnecessary re-renders

### Large Graphs

- Validation before display
- Warning for graphs > 500 nodes
- Leverages Hydroscope's built-in optimizations

## Security

### Content Security Policy

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  style-src ${webview.cspSource} 'unsafe-inline';
  script-src 'nonce-${nonce}';
  img-src ${webview.cspSource} data:;
  font-src ${webview.cspSource};
  connect-src ${webview.cspSource};
">
```

### Resource Loading

- Only loads from extension directory
- Uses `webview.asWebviewUri()` for all resources
- Validates all file paths

## Requirements Coverage

This implementation satisfies the following requirements:

✅ **Requirement 1.2**: Display graph in webview panel
✅ **Requirement 4.3**: Manual refresh command
✅ **Requirement 4.4**: Preserve view state across refreshes
✅ **Requirement 5.3**: Pass Graph JSON to Hydroscope
✅ **Requirement 9.1**: Support zoom, pan, node selection
✅ **Requirement 10.1-10.4**: Export JSON and PNG

## Future Enhancements

Potential improvements:
- Bidirectional code navigation (click node → jump to code)
- Real-time graph updates during debugging
- Collaborative viewing with shared view state
- Custom view state presets
- Graph diff visualization

## Related Files

- `src/webviewManager.ts` - Extension-side manager
- `webview/index.tsx` - Webview React application
- `webview/styles.css` - Webview styling
- `src/types.ts` - Type definitions
- `src/hydroIDE.ts` - Orchestration
- `src/test/webviewManager.test.ts` - Unit tests
