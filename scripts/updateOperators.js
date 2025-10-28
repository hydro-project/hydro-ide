#!/usr/bin/env node

/**
 * Utility script to help maintain the Hydro operators configuration
 * by scanning the Hydro codebase for operator definitions.
 *
 * Usage: node scripts/updateOperators.js <hydro-repo-path>
 * Example: node scripts/updateOperators.js /path/to/hydro
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('❌ Error: Please provide the path to the Hydro repository');
  console.error('Usage: node scripts/updateOperators.js <hydro-repo-path>');
  console.error('Example: node scripts/updateOperators.js /path/to/hydro');
  process.exit(1);
}

const HYDRO_ROOT = path.resolve(args[0]);
const CONFIG_PATH = path.join(__dirname, '../src/analysis/hydroOperators.json');

// Validate that the provided path exists and looks like a Hydro repo
if (!fs.existsSync(HYDRO_ROOT)) {
  console.error(`❌ Error: Directory does not exist: ${HYDRO_ROOT}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(HYDRO_ROOT, 'hydro_lang'))) {
  console.error(
    `❌ Error: Directory does not appear to be a Hydro repository (missing hydro_lang): ${HYDRO_ROOT}`
  );
  console.error('Expected structure: <hydro-repo>/hydro_lang/');
  process.exit(1);
}

console.log(`🔍 Scanning Hydro codebase for operators...`);
console.log(`📁 Hydro repository: ${HYDRO_ROOT}`);

// Function to run grep and extract operator names
function findOperators(pattern, description) {
  console.log(`\n📋 Finding ${description}...`);

  try {
    const result = execSync(`grep -r "${pattern}" ${HYDRO_ROOT} --include="*.rs" | head -100`, {
      encoding: 'utf8',
    });

    const matches = result
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        // Extract function names from patterns like "pub fn operator_name"
        const match = line.match(/pub fn (\w+)/);
        return match ? match[1] : null;
      })
      .filter((name) => name && !name.startsWith('_'))
      .filter((name, index, arr) => arr.indexOf(name) === index) // dedupe
      .sort();

    console.log(
      `Found ${matches.length} operators:`,
      matches.slice(0, 10).join(', '),
      matches.length > 10 ? '...' : ''
    );
    return matches;
  } catch (error) {
    console.log(`No matches found for ${description}`);
    return [];
  }
}

// Function to find operators in the Hydro language API files
function findHydroAPIOperators() {
  console.log('\n🔍 Finding Hydro API operators in live_collections...');

  const apiPaths = [
    'hydro_lang/src/live_collections/stream/mod.rs',
    'hydro_lang/src/live_collections/stream/networking.rs',
    'hydro_lang/src/live_collections/singleton.rs',
    'hydro_lang/src/live_collections/optional.rs',
    'hydro_lang/src/live_collections/keyed_singleton.rs',
  ];

  const allOperators = new Set();
  const categories = {
    transform: new Set(),
    aggregation: new Set(),
    collection: new Set(),
    join: new Set(),
    time: new Set(),
    source: new Set(),
    sink: new Set(),
    networking: new Set(),
    utility: new Set(),
  };

  for (const apiPath of apiPaths) {
    const fullPath = path.join(HYDRO_ROOT, apiPath);

    try {
      console.log(`  📄 Scanning ${apiPath}...`);

      const result = execSync(`grep -n "pub fn " "${fullPath}" | grep -v "test" | head -50`, {
        encoding: 'utf8',
      });

      const functions = result
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const match = line.match(/pub fn (\w+)/);
          return match ? match[1] : null;
        })
        .filter((name) => name && !name.startsWith('_') && !name.startsWith('new'));

      console.log(
        `    Found ${functions.length} operators: ${functions.slice(0, 5).join(', ')}${functions.length > 5 ? '...' : ''}`
      );

      // Categorize the operators
      functions.forEach((name) => {
        allOperators.add(name);

        // Transform operators
        if (
          [
            'map',
            'filter',
            'flat_map',
            'scan',
            'enumerate',
            'inspect',
            'unique',
            'sort',
            'filter_map',
          ].includes(name)
        ) {
          categories.transform.add(name);
        }
        // Aggregation operators
        else if (
          ['fold', 'reduce', 'count', 'sum', 'min', 'max'].includes(name) ||
          name.includes('fold') ||
          name.includes('reduce')
        ) {
          categories.aggregation.add(name);
        }
        // Collection operators
        else if (
          ['keys', 'values', 'entries', 'all_ticks', 'collect_vec', 'collect_ready'].includes(
            name
          ) ||
          name.startsWith('into_') ||
          name.startsWith('collect') ||
          name.includes('ticks')
        ) {
          categories.collection.add(name);
        }
        // Join operators
        else if (
          [
            'join',
            'cross_product',
            'cross_singleton',
            'difference',
            'anti_join',
            'union',
            'concat',
            'zip',
            'chain',
          ].includes(name)
        ) {
          categories.join.add(name);
        }
        // Time operators
        else if (
          [
            'defer_tick',
            'persist',
            'snapshot',
            'sample_every',
            'sample_eager',
            'timeout',
            'batch',
          ].includes(name) ||
          name.includes('snapshot') ||
          name.includes('sample') ||
          name.includes('timeout')
        ) {
          categories.time.add(name);
        }
        // Source operators
        else if (name.startsWith('source_')) {
          categories.source.add(name);
        }
        // Sink operators
        else if (
          ['for_each', 'dest_sink', 'assert', 'assert_eq', 'dest_file'].includes(name) ||
          name.startsWith('dest_') ||
          name === 'for_each'
        ) {
          categories.sink.add(name);
        }
        // Networking operators
        else if (
          name.includes('bincode') ||
          name.includes('bytes') ||
          [
            'send_bincode',
            'recv_bincode',
            'broadcast_bincode',
            'demux_bincode',
            'connect',
            'disconnect',
          ].includes(name)
        ) {
          categories.networking.add(name);
        }
        // Utility operators
        else if (
          [
            'tee',
            'clone',
            'unwrap',
            'unwrap_or',
            'first',
            'last',
            'complete',
            'filter_if_some',
            'filter_if_none',
          ].includes(name)
        ) {
          categories.utility.add(name);
        }
      });
    } catch (error) {
      console.log(`    ⚠️  Could not scan ${apiPath}: ${error.message}`);
    }
  }

  // Convert Sets back to Arrays and sort
  const result = {};
  Object.entries(categories).forEach(([key, set]) => {
    result[key] = Array.from(set).sort();
  });

  console.log(
    `\n📊 Found ${allOperators.size} total API operators across ${apiPaths.length} files`
  );

  Object.entries(result).forEach(([category, operators]) => {
    if (operators.length > 0) {
      console.log(`  ${category}: ${operators.length} operators`);
      console.log(`    ${operators.slice(0, 8).join(', ')}${operators.length > 8 ? '...' : ''}`);
    }
  });

  return result;
}

// Function to find networking operators
function findNetworkingOperators() {
  console.log('\n🌐 Finding networking operators...');

  const patterns = [
    'send_bincode',
    'recv_bincode',
    'broadcast_bincode',
    'demux_bincode',
    'send_bytes',
    'recv_bytes',
    'broadcast_bytes',
    'demux_bytes',
  ];

  const found = [];

  for (const pattern of patterns) {
    try {
      const result = execSync(`grep -r "pub fn ${pattern}" ${HYDRO_ROOT} --include="*.rs"`, {
        encoding: 'utf8',
      });

      if (result.trim()) {
        found.push(pattern);
        console.log(`✓ Found ${pattern}`);
      }
    } catch (error) {
      console.log(`✗ Not found: ${pattern}`);
    }
  }

  return found;
}

// Main execution
async function main() {
  // Load current configuration
  let currentConfig = {};
  try {
    const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    currentConfig = JSON.parse(configContent);
    console.log('📄 Loaded current configuration');
  } catch (error) {
    console.log('⚠️  Could not load current configuration, starting fresh');
  }

  // Find operators from Hydro API files
  const categories = findHydroAPIOperators();

  // Also try the specific networking operator search
  const specificNetworking = findNetworkingOperators();

  // Combine and deduplicate networking operators
  const allNetworking = [
    ...new Set([...(categories.networking || []), ...specificNetworking]),
  ].sort();

  // Combine core dataflow operators from multiple categories
  const allCoreOperators = [
    ...new Set([
      ...(categories.transform || []),
      ...(categories.aggregation || []),
      ...(categories.collection || []),
      ...(categories.join || []),
      ...(categories.time || []),
      ...(categories.utility || []),
    ]),
  ].sort();

  // Suggest updates
  console.log('\n📊 Analysis complete!');
  console.log('\n🔧 Comprehensive operator analysis:');

  if (allNetworking.length > 0) {
    console.log(`\n🌐 Networking operators (${allNetworking.length} found):`);
    allNetworking.forEach((op) => console.log(`  - ${op}`));
  }

  if (categories.source && categories.source.length > 0) {
    console.log(`\n📥 Source operators (${categories.source.length} found):`);
    categories.source.forEach((op) => console.log(`  - ${op}`));
  }

  // Manually add known sink operators that might not be categorized correctly
  const knownSinks = ['for_each', 'dest_sink'];
  const foundSinks = [...new Set([...(categories.sink || []), ...knownSinks])];

  if (foundSinks.length > 0) {
    console.log(`\n📤 Sink operators (${foundSinks.length} found):`);
    foundSinks.forEach((op) => console.log(`  - ${op}`));
  }

  if (allCoreOperators.length > 0) {
    console.log(
      `\n⚙️  Core dataflow operators (${allCoreOperators.length} found, showing first 20):`
    );
    allCoreOperators.slice(0, 20).forEach((op) => console.log(`  - ${op}`));
    if (allCoreOperators.length > 20) {
      console.log(`  ... and ${allCoreOperators.length - 20} more`);
    }
  }

  console.log('\n💡 To update the VS Code settings:');
  console.log('1. Review the operators found above');
  console.log(
    '2. Update VS Code settings (File > Preferences > Settings > Extensions > Hydro IDE > Operators)'
  );
  console.log('3. Or add to your workspace/user settings.json:');
  console.log('');

  // Generate comprehensive settings JSON
  const sampleSettings = {
    'hydroIde.operators.networkingOperators':
      allNetworking.length > 0
        ? allNetworking
        : ['send_bincode', 'broadcast_bincode', 'demux_bincode'],
    'hydroIde.operators.coreDataflowOperators': allCoreOperators.slice(0, 30), // Show first 30
    'hydroIde.operators.sinkOperators':
      foundSinks.length > 0 ? foundSinks : ['for_each', 'dest_sink'],
    'hydroIde.operators.collectionTypes': [
      'Stream<',
      'Singleton<',
      'Optional<',
      'KeyedStream<',
      'KeyedSingleton<',
    ],
  };

  console.log('   {');
  Object.entries(sampleSettings).forEach(([key, value], index, arr) => {
    const isLast = index === arr.length - 1;
    console.log(
      `     "${key}": ${JSON.stringify(value, null, 2).replace(/\n/g, '').replace(/  /g, '')}${isLast ? '' : ','}`
    );
  });
  console.log('   }');
  console.log('');
  console.log('4. Test the changes with the IDE (settings are hot-reloadable)');

  console.log('\n✅ Comprehensive scan complete!');
}

main().catch(console.error);
