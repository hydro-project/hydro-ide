/**
 * Main exports for Hydro IDE extension
 */

export { ScopeAnalyzer } from './analysis/scopeAnalyzer';
export { CargoOrchestrator, CargoError } from './visualization/cargoOrchestrator';
export {
  ScopeType,
  ScopeTarget,
  HydroFunction,
  ScopeDetectionError,
  ScopeErrorCategory,
  ScopeAnalyzerConfig,
  CargoConfig,
  BuildResult,
} from './core/types';
