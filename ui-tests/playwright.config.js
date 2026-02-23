/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');
const hasExternalTarget = Boolean(process.env.TARGET_URL);

const config = {
  ...baseConfig,
  webServer: hasExternalTarget
    ? undefined
    : {
        command: 'jlpm start',
        url: 'http://localhost:10888/lab',
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
        gracefulShutdown: {
          signal: 'SIGINT',
          timeout: 15 * 1000
        }
      }
};

module.exports = config;
