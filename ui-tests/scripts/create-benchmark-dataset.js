const fs = require('fs');
const path = require('path');
const {
  recreateBenchmarkTreeInDirectory
} = require('./benchmark-tree-common');

const ROOT_DIR = path.resolve(__dirname, '..', 'scratch', 'generated_fixtures');

fs.mkdirSync(ROOT_DIR, { recursive: true });
recreateBenchmarkTreeInDirectory(ROOT_DIR);
