/**
 * Alternative implementation using inlay hints (more efficient)
 * 
 * This approach follows ChatGPT's suggestion:
 * 1. Get semantic tokens to find candidates (variables, methods)
 * 2. Get inlay hints to batch-get type information
 * 3. Only query hover/typeDefinition for remaining items
 */

import * as vscode from 'vscode';

/**
 * Output channel for logging
 */
const outputChannel: vscode.OutputChannel | null = null;


/**
 * Scan using inlay hints for better performance
 */
export async function scanForLocationTypesWithInlayHints(
  document: vscode.TextDocument,
  range: vscode.Range
): Promise<Array<{ name: string; locationType: string; locationKind: string; range: vscode.Range }>> {
  const results: Array<{ name: string; locationType: string; locationKind: string; range: vscode.Range }> = [];

  // Step 1: Get inlay hints (rust-analyzer has already computed these)
  const inlayHints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
    'vscode.executeInlayHintProvider',
    document.uri,
    range
  );

  if (!inlayHints) {
    return results;
  }

  outputChannel?.appendLine(`Got ${inlayHints.length} inlay hints from rust-analyzer`);

  // Step 2: Parse inlay hints for Location types
  for (const hint of inlayHints) {
    const hintText = typeof hint.label === 'string' 
      ? hint.label 
      : hint.label.map(p => typeof p === 'string' ? p : p.value).join('');

    // Look for Process<>, Cluster<>, External<> in the hint
    const locationMatch = hintText.match(/(Process|Cluster|External)<[^>]*>/);
    if (locationMatch) {
      const locationKind = locationMatch[1];
      
      // The hint position tells us where the variable/expression is
      const position = hint.position;
      
      // Find the identifier at or before this position
      const line = document.lineAt(position.line);
      const beforeText = line.text.substring(0, position.character);
      const identMatch = beforeText.match(/(\w+)\s*$/);
      
      if (identMatch) {
        const name = identMatch[1];
        const nameStart = position.character - identMatch[0].length;
        const nameRange = new vscode.Range(
          position.line,
          nameStart,
          position.line,
          nameStart + name.length
        );

        results.push({
          name,
          locationType: hintText,
          locationKind,
          range: nameRange,
        });
      }
    }
  }

  return results;
}
