/**
 * Configuration for benchmark Playwright tests.
 */
const baseConfig = require('./playwright.config');
const hasExternalTarget = Boolean(process.env.TARGET_URL);

module.exports = {
  ...baseConfig,
  testMatch: ['tests/filebrowser-benchmark.spec.ts'],
  reporter: process.env.CI ? 'dot' : 'list',
  webServer: hasExternalTarget
    ? undefined
    : {
        command: 'jlpm start:bench',
        url: 'http://localhost:10888/lab',
        timeout: 120 * 1000,
        reuseExistingServer: false,
        gracefulShutdown: {
          signal: 'SIGINT',
          timeout: 15 * 1000
        }
      },
  workers: 1
};
