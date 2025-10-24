/**
 * Type definitions for Hydro IDE extension
 */

/**
 * Scope type for visualization
 */
export type ScopeType = 'function' | 'file' | 'workspace';

/**
 * Metadata about a Hydro function detected in source code
 */
export interface HydroFunction {
  /** Function name */
  name: string;
  
  /** Module path (e.g., "my_crate::module::submodule") */
  modulePath: string;
  
  /** Absolute file path */
  filePath: string;
  
  /** Starting line number (0-indexed) */
  startLine: number;
  
  /** Ending line number (0-indexed) */
  endLine: number;
  
  /** Rust attributes on the function (e.g., ["hydro::flow"]) */
  attributes: string[];
  
  /** Whether this function uses a macro invocation (e.g., hydro_lang::flow!) */
  usesMacro: boolean;
}

/**
 * Target specification for visualization
 */
export interface ScopeTarget {
  /** Type of scope being visualized */
  type: ScopeType;
  
  /** List of Hydro functions to visualize */
  functions: HydroFunction[];
  
  /** Absolute path to workspace root */
  workspaceRoot: string;
  
  /** Optional: Active file path for function/file scope */
  activeFilePath?: string;
  
  /** Path to Cargo.toml for building */
  cargoTomlPath?: string;
}

/**
 * Error categories for scope detection
 */
export enum ScopeErrorCategory {
  /** No Hydro code found at requested scope */
  NO_HYDRO_CODE = 'no_hydro_code',
  
  /** Invalid cursor position or file state */
  INVALID_POSITION = 'invalid_position',
  
  /** File is not part of a Cargo workspace */
  NOT_IN_WORKSPACE = 'not_in_workspace',
  
  /** Ambiguous function boundaries or parsing issues */
  PARSE_ERROR = 'parse_error',
  
  /** File system or I/O errors */
  IO_ERROR = 'io_error',
}

/**
 * Error thrown during scope detection
 */
export class ScopeDetectionError extends Error {
  constructor(
    public readonly category: ScopeErrorCategory,
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'ScopeDetectionError';
  }
}

/**
 * Configuration for scope analysis
 */
export interface ScopeAnalyzerConfig {
  /** Whether to include functions without explicit Hydro markers */
  includeImplicitFunctions: boolean;
  
  /** Maximum file size to analyze (in bytes) */
  maxFileSize: number;
  
  /** Timeout for workspace scanning (in milliseconds) */
  workspaceScanTimeout: number;
}

/**
 * Configuration for Cargo builds
 */
export interface CargoConfig {
  /** Path to Cargo.toml */
  manifestPath: string;
  
  /** Target triple (optional) */
  target?: string;
  
  /** Additional features to enable */
  features: string[];
  
  /** Build in release mode */
  releaseMode: boolean;
  
  /** Build timeout in milliseconds */
  timeout: number;
}

/**
 * Result of a Cargo build operation
 */
export interface BuildResult {
  /** Whether the build succeeded */
  success: boolean;
  
  /** Extracted graph JSON (if successful) */
  graphJson?: string;
  
  /** Compilation errors */
  errors: string[];
  
  /** Compilation warnings */
  warnings: string[];
  
  /** Full stdout output */
  stdout: string;
  
  /** Full stderr output */
  stderr: string;
  
  /** Exit code */
  exitCode: number;
}
