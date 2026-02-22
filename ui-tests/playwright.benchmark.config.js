/**
 * Configuration for benchmark Playwright tests.
 */
const baseConfig = require('./playwright.config');

module.exports = {
  ...baseConfig,
  testMatch: ['tests/filebrowser-benchmark.spec.ts'],
  reporter: process.env.CI ? 'dot' : 'list',
  webServer: {
    command: 'jlpm start:bench',
    url: 'http://localhost:8888/lab',
    timeout: 120 * 1000,
    reuseExistingServer: false
  },
  workers: 1
};
