import fs from 'fs';
import path from 'path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:8888';

interface IScenario {
  folderName: string;
  firstItemName: string;
}

interface IBenchmarkReport {
  measuredAt: string;
  timingsMs: {
    firstFileBrowserDisplay: number;
    unfoldFolder10: number;
    unfoldFolder1000: number;
    unfoldFolder10000: number;
  };
}

const SCENARIOS: IScenario[] = [
  { folderName: 'folder_00010', firstItemName: 'f10-item-00000.txt' },
  { folderName: 'folder_01000', firstItemName: 'f1000-item-00000.txt' },
  { folderName: 'folder_10000', firstItemName: 'f10000-item-00000.txt' }
];

function itemSelector(name: string): string {
  return `.jp-DirListing-item[title^="Name: ${name}"]`;
}

async function measureFolderUnfold(
  page: Page,
  folderName: string,
  firstItemName: string
): Promise<number> {
  const startTime = performance.now();
  await page.click(itemSelector(folderName));
  await page.waitForSelector(itemSelector(firstItemName), { state: 'visible' });
  return performance.now() - startTime;
}

function reportPath(): string {
  return path.resolve(__dirname, '..', 'benchmark-results', 'filebrowser.json');
}

async function writeReport(
  report: IBenchmarkReport,
  testInfo: TestInfo
): Promise<void> {
  const outputPath = reportPath();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  await testInfo.attach('filebrowser-benchmark', {
    path: outputPath,
    contentType: 'application/json'
  });
}

test.describe.serial('file browser benchmark', () => {
  test('measures first render and unfold timings', async ({ page }, testInfo) => {
    const navigationStart = performance.now();
    await page.goto(`${TARGET_URL}/lab?reset`);
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await page.waitForSelector(itemSelector('benchmark-tree'), {
      state: 'visible'
    });
    const firstFileBrowserDisplay = performance.now() - navigationStart;

    await page.click(itemSelector('benchmark-tree'));
    await page.waitForSelector(itemSelector(SCENARIOS[0].folderName), {
      state: 'visible'
    });

    const unfoldFolder10 = await measureFolderUnfold(
      page,
      SCENARIOS[0].folderName,
      SCENARIOS[0].firstItemName
    );
    const unfoldFolder1000 = await measureFolderUnfold(
      page,
      SCENARIOS[1].folderName,
      SCENARIOS[1].firstItemName
    );
    const unfoldFolder10000 = await measureFolderUnfold(
      page,
      SCENARIOS[2].folderName,
      SCENARIOS[2].firstItemName
    );

    const report: IBenchmarkReport = {
      measuredAt: new Date().toISOString(),
      timingsMs: {
        firstFileBrowserDisplay,
        unfoldFolder10,
        unfoldFolder1000,
        unfoldFolder10000
      }
    };

    await writeReport(report, testInfo);

    expect(report.timingsMs.firstFileBrowserDisplay).toBeGreaterThan(0);
    expect(report.timingsMs.unfoldFolder10).toBeGreaterThan(0);
    expect(report.timingsMs.unfoldFolder1000).toBeGreaterThan(0);
    expect(report.timingsMs.unfoldFolder10000).toBeGreaterThan(0);
  });
});
