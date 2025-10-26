/**
 * Test runner for VSCode extension tests
 * 
 * This file sets up the VSCode test environment and runs all tests.
 */

import * as path from 'path';
import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // The workspace to open for testing
    const testWorkspace = path.resolve(
      __dirname,
      '../../test-fixtures/sample-hydro-project'
    );

    // Download and install VSCode
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const [cliPath, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

    // Install rust-analyzer extension
    console.log('Installing rust-analyzer extension...');
    const { spawn } = require('child_process');
    await new Promise<void>((resolve, reject) => {
      const installProcess = spawn(cliPath, [...args, '--install-extension', 'rust-lang.rust-analyzer'], {
        stdio: 'inherit'
      });
      installProcess.on('close', (code: number) => {
        if (code === 0) {
          console.log('rust-analyzer extension installed successfully');
          resolve();
        } else {
          reject(new Error(`Failed to install rust-analyzer extension, exit code: ${code}`));
        }
      });
    });

    // Run the integration tests
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testWorkspace],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
