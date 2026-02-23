const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', 'scratch', 'generated_fixtures');
const BENCHMARK_ROOT = path.join(ROOT_DIR, 'benchmark-tree');

const SCENARIOS = [
  { folderName: 'folder_00010', count: 10, prefix: 'f10' },
  { folderName: 'folder_01000', count: 1000, prefix: 'f1000' },
  { folderName: 'folder_10000', count: 10000, prefix: 'f10000' }
];
const NESTED_FOLDER_NAME = 'nested_00100';
const NESTED_DEPTH = 100;

function createFiles(directoryPath, count, prefix) {
  for (let index = 0; index < count; index += 1) {
    const fileName = `${prefix}-item-${String(index).padStart(5, '0')}.txt`;
    const filePath = path.join(directoryPath, fileName);
    fs.closeSync(fs.openSync(filePath, 'w'));
  }
}

function createBenchmarkTree() {
  fs.rmSync(BENCHMARK_ROOT, { recursive: true, force: true });
  fs.mkdirSync(BENCHMARK_ROOT, { recursive: true });

  for (const scenario of SCENARIOS) {
    const folderPath = path.join(BENCHMARK_ROOT, scenario.folderName);
    fs.mkdirSync(folderPath, { recursive: true });
    createFiles(folderPath, scenario.count, scenario.prefix);
  }

  const nestedRoot = path.join(BENCHMARK_ROOT, NESTED_FOLDER_NAME);
  fs.mkdirSync(nestedRoot, { recursive: true });
  let currentPath = nestedRoot;
  for (let depth = 1; depth <= NESTED_DEPTH; depth += 1) {
    const levelName = `d${String(depth).padStart(3, '0')}`;
    currentPath = path.join(currentPath, levelName);
    fs.mkdirSync(currentPath, { recursive: true });
  }
  fs.closeSync(fs.openSync(path.join(currentPath, 'deep-file.txt'), 'w'));
}

createBenchmarkTree();
