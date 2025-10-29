/**
 * String utility functions for the Hydro IDE analysis module
 *
 * Provides utilities for:
 * - Location kind normalization and parsing
 * - Tick depth counting and label building
 * - Full label extraction from source code
 * - Location ID generation
 */

import * as vscode from 'vscode';

/**
 * Count the depth of Tick wrappers in a location kind
 *
 * @param locationKind The location kind string (e.g., "Tick<Tick<Process>>")
 * @returns The number of nested Tick< wrappers
 *
 * @example
 * countTickDepth("Process") // => 0
 * countTickDepth("Tick<Process>") // => 1
 * countTickDepth("Tick<Tick<Process>>") // => 2
 */
export function countTickDepth(locationKind: string): number {
  let depth = 0;
  let current = locationKind.trim();
  while (current.startsWith('Tick<') && current.endsWith('>')) {
    depth++;
    current = current.substring(5, current.length - 1).trim();
  }
  return depth;
}

/**
 * Build a nested Tick label for a given base label and depth
 *
 * @param baseLabel The base location label (e.g., "Worker")
 * @param depth The number of Tick wrappers to apply
 * @returns The nested Tick label
 *
 * @example
 * buildTickLabel("Worker", 0) // => "Worker"
 * buildTickLabel("Worker", 1) // => "Tick<Worker>"
 * buildTickLabel("Worker", 2) // => "Tick<Tick<Worker>>"
 */
export function buildTickLabel(baseLabel: string, depth: number): string {
  if (depth <= 0) return baseLabel;
  let label = baseLabel;
  for (let i = 0; i < depth; i++) {
    label = `Tick<${label}>`;
  }
  return label;
}

/**
 * Extract location label from locationKind string
 *
 * Extracts human-readable labels from location kind strings.
 * Attempts to extract type parameter names (e.g., "Leader", "Worker", "Proposer")
 * from patterns like "Process<Leader>", "Cluster<Worker>", etc.
 *
 * @param locationKind The location kind string (e.g., "Process<Leader>")
 * @returns Human-readable location label
 *
 * @example
 * extractLocationLabel("Process<Leader>") // => "Leader"
 * extractLocationLabel("Cluster<Worker>") // => "Worker"
 * extractLocationLabel("Tick<Process<Proposer>>") // => "Proposer"
 * extractLocationLabel("Process") // => "Process"
 * extractLocationLabel(null) // => "(unknown location)"
 */
export function extractLocationLabel(locationKind: string | null): string {
  if (!locationKind) {
    return '(unknown location)';
  }

  // Strip Tick wrappers to get the base location
  let unwrapped = locationKind;
  while (unwrapped.startsWith('Tick<') && unwrapped.endsWith('>')) {
    unwrapped = unwrapped.substring(5, unwrapped.length - 1);
  }

  // Try to extract type parameter name from patterns like "Process<Leader>"
  // Match: Type<Parameter> where Parameter is the type parameter name
  const paramMatch = unwrapped.match(/^(?:Process|Cluster|External)<([^>]+)>/);
  if (paramMatch) {
    // Extract the type parameter (e.g., "Leader", "Worker", "Proposer")
    const param = paramMatch[1].trim();

    // Handle lifetime parameters (e.g., "'a, Leader" -> "Leader")
    const cleanParam = param.replace(/^'[a-z]+,\s*/, '');

    return cleanParam;
  }

  // If no type parameter found, try to extract just the base type
  const baseMatch = unwrapped.match(/^(Process|Cluster|External)/);
  if (baseMatch) {
    return baseMatch[1];
  }

  // Fallback: return the original locationKind
  return locationKind;
}

/**
 * Extract full label from operator code context
 *
 * Reads the source code text from the operator range and extracts
 * the operator call with parameters (e.g., "map(|x| x + 1)").
 * Truncates long expressions for readability.
 *
 * @param document The document being analyzed
 * @param range The range of the operator in the document
 * @returns The full label string
 *
 * @example
 * extractFullLabel(doc, range) // => "map(|x| x + 1)"
 * extractFullLabel(doc, range) // => "filter(|x| x > 0)"
 * extractFullLabel(doc, range) // => "fold(|| 0, |acc, x| acc + x)"
 */
export function extractFullLabel(document: vscode.TextDocument, range: vscode.Range): string {
  try {
    // Get the line containing the operator
    const line = document.lineAt(range.start.line);
    const lineText = line.text;

    // Find the operator name in the line
    const operatorStart = range.start.character;
    const operatorEnd = range.end.character;
    const operatorName = lineText.substring(operatorStart, operatorEnd);

    // Look for opening parenthesis after the operator
    let searchStart = operatorEnd;
    while (searchStart < lineText.length && /\s/.test(lineText[searchStart])) {
      searchStart++;
    }

    if (searchStart >= lineText.length || lineText[searchStart] !== '(') {
      // No parameters, just return the operator name
      return operatorName;
    }

    // Find matching closing parenthesis
    let parenDepth = 0;
    let endPos = searchStart;
    let foundEnd = false;

    // Search within the current line first
    for (let i = searchStart; i < lineText.length; i++) {
      const char = lineText[i];
      if (char === '(') {
        parenDepth++;
      } else if (char === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          endPos = i + 1;
          foundEnd = true;
          break;
        }
      }
    }

    // If not found on same line, search subsequent lines (multi-line operator call)
    if (!foundEnd) {
      let currentLine = range.start.line + 1;
      const maxLinesToSearch = 10; // Limit search to avoid performance issues
      let linesSearched = 0;

      while (currentLine < document.lineCount && linesSearched < maxLinesToSearch) {
        const nextLine = document.lineAt(currentLine);
        const nextText = nextLine.text;

        for (let i = 0; i < nextText.length; i++) {
          const char = nextText[i];
          if (char === '(') {
            parenDepth++;
          } else if (char === ')') {
            parenDepth--;
            if (parenDepth === 0) {
              // Found the end on a different line
              // For multi-line, just use operator name with "..."
              return `${operatorName}(...)`;
            }
          }
        }

        currentLine++;
        linesSearched++;
      }

      // Couldn't find end within reasonable search
      return `${operatorName}(...)`;
    }

    // Extract the full operator call
    let fullCall = lineText.substring(operatorStart, endPos);

    // Truncate if too long (for readability)
    const maxLength = 80;
    if (fullCall.length > maxLength) {
      // Try to truncate at a reasonable point
      const truncated = fullCall.substring(0, maxLength - 3);
      // Find last complete token
      const lastSpace = truncated.lastIndexOf(' ');
      const lastComma = truncated.lastIndexOf(',');
      const lastPipe = truncated.lastIndexOf('|');
      const cutPoint = Math.max(lastSpace, lastComma, lastPipe);

      if (cutPoint > operatorName.length + 5) {
        fullCall = truncated.substring(0, cutPoint) + '...)';
      } else {
        fullCall = truncated + '...)';
      }
    }

    return fullCall;
  } catch (error) {
    // On error, return just the operator text from the range
    return document.getText(range);
  }
}

/**
 * Extract location ID from location kind string
 *
 * Normalizes location kinds to prevent duplicate containers for the same logical location.
 * For example, "Process<Leader>" and "Tick<Process<Leader>>" should map to the same container.
 *
 * @param locationKind The location kind (e.g., "Process<Leader>")
 * @returns Numeric location ID or null
 *
 * @example
 * getLocationId("Process<Leader>") // => 123456 (some hash)
 * getLocationId("Tick<Process<Leader>>") // => 123456 (same hash, Tick stripped)
 */
export function getLocationId(locationKind: string): number | null {
  // Normalize the location kind by removing Tick wrappers
  const normalized = normalizeLocationKind(locationKind);

  // Use a simple hash of the normalized location kind
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Normalize location kind string for consistent hierarchy grouping
 *
 * Removes Tick wrappers to get the base location type. This ensures
 * that "Process<Leader>" and "Tick<Process<Leader>>" are treated as
 * the same location for hierarchy purposes.
 *
 * @param locationKind The raw location kind
 * @returns Normalized location kind (Tick wrappers removed)
 *
 * @example
 * normalizeLocationKind("Process<Leader>") // => "Process<Leader>"
 * normalizeLocationKind("Tick<Process<Leader>>") // => "Process<Leader>"
 * normalizeLocationKind("Tick<Tick<Process<Leader>>>") // => "Process<Leader>"
 */
export function normalizeLocationKind(locationKind: string): string {
  // Strip Tick wrappers to get the base location
  let normalized = locationKind;
  while (normalized.startsWith('Tick<') && normalized.endsWith('>')) {
    normalized = normalized.substring(5, normalized.length - 1);
  }
  return normalized;
}
