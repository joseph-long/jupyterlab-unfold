const fs = require('fs');
const path = require('path');

const BENCHMARK_TREE_NAME = 'benchmark-tree';
const BENCHMARK_SCENARIOS = [
  { folderName: 'folder_00010', count: 10, prefix: 'f10' },
  { folderName: 'folder_01000', count: 1000, prefix: 'f1000' },
  { folderName: 'folder_10000', count: 10000, prefix: 'f10000' }
];
const NESTED_FOLDER_NAME = 'nested_00100';
const NESTED_DEPTH = 100;

function touchFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.closeSync(fs.openSync(filePath, 'w'));
}

function createBenchmarkTreeInDirectory(rootDir) {
  const benchmarkRoot = path.join(rootDir, BENCHMARK_TREE_NAME);
  fs.mkdirSync(benchmarkRoot, { recursive: true });

  for (const scenario of BENCHMARK_SCENARIOS) {
    const folderPath = path.join(benchmarkRoot, scenario.folderName);
    fs.mkdirSync(folderPath, { recursive: true });
    for (let index = 0; index < scenario.count; index += 1) {
      const fileName = `${scenario.prefix}-item-${String(index).padStart(5, '0')}.txt`;
      touchFile(path.join(folderPath, fileName));
    }
  }

  const nestedRoot = path.join(benchmarkRoot, NESTED_FOLDER_NAME);
  fs.mkdirSync(nestedRoot, { recursive: true });
  let currentPath = nestedRoot;
  for (let depth = 1; depth <= NESTED_DEPTH; depth += 1) {
    const levelName = `d${String(depth).padStart(3, '0')}`;
    currentPath = path.join(currentPath, levelName);
    fs.mkdirSync(currentPath, { recursive: true });
  }
  touchFile(path.join(currentPath, 'deep-file.txt'));
}

function recreateBenchmarkTreeInDirectory(rootDir) {
  const benchmarkRoot = path.join(rootDir, BENCHMARK_TREE_NAME);
  fs.rmSync(benchmarkRoot, { recursive: true, force: true });
  createBenchmarkTreeInDirectory(rootDir);
}

module.exports = {
  BENCHMARK_TREE_NAME,
  createBenchmarkTreeInDirectory,
  recreateBenchmarkTreeInDirectory
};
