import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo
} from '@playwright/test';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:8888';
const SAMPLE_COUNT = Number(process.env.BENCHMARK_SAMPLE_COUNT ?? '3');
const PARALLEL_USERS = Number(process.env.BENCHMARK_PARALLEL_USERS ?? '2');

interface IScenario {
  key: '10' | '1000' | '10000';
  folderName: string;
  firstItemName: string;
}

interface IRunTiming {
  firstFileBrowserDisplay: number;
  unfold: Record<IScenario['key'], number>;
  fold: Record<IScenario['key'], number>;
  reShow: Record<IScenario['key'], number>;
}

interface IBenchmarkSummary {
  mean: number;
  min: number;
  max: number;
}

interface IBenchmarkReport {
  measuredAt: string;
  sampleCount: number;
  parallelUsers: number;
  runs: IRunTiming[];
  summaryMs: {
    firstFileBrowserDisplay: IBenchmarkSummary;
    unfold: Record<IScenario['key'], IBenchmarkSummary>;
    fold: Record<IScenario['key'], IBenchmarkSummary>;
    reShow: Record<IScenario['key'], IBenchmarkSummary>;
  };
}

const SCENARIOS: IScenario[] = [
  {
    key: '10',
    folderName: 'folder_00010',
    firstItemName: 'f10-item-00000.txt'
  },
  {
    key: '1000',
    folderName: 'folder_01000',
    firstItemName: 'f1000-item-00000.txt'
  },
  {
    key: '10000',
    folderName: 'folder_10000',
    firstItemName: 'f10000-item-00000.txt'
  }
];

function itemSelector(name: string): string {
  return `.jp-DirListing-item[title^="Name: ${name}"]`;
}

function summarize(values: number[]): IBenchmarkSummary {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    mean: total / values.length,
    min,
    max
  };
}

async function measureVisibilityTransition(
  page: Page,
  folderName: string,
  itemName: string,
  targetState: 'visible' | 'hidden'
): Promise<number> {
  const startTime = performance.now();
  await page.click(itemSelector(folderName));
  await page.waitForSelector(itemSelector(itemName), { state: targetState });
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

async function runSingleBenchmark(context: BrowserContext): Promise<IRunTiming> {
  const page = await context.newPage();
  try {
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

    const unfold: IRunTiming['unfold'] = {
      '10': 0,
      '1000': 0,
      '10000': 0
    };
    const fold: IRunTiming['fold'] = {
      '10': 0,
      '1000': 0,
      '10000': 0
    };
    const reShow: IRunTiming['reShow'] = {
      '10': 0,
      '1000': 0,
      '10000': 0
    };

    for (const scenario of SCENARIOS) {
      unfold[scenario.key] = await measureVisibilityTransition(
        page,
        scenario.folderName,
        scenario.firstItemName,
        'visible'
      );
      fold[scenario.key] = await measureVisibilityTransition(
        page,
        scenario.folderName,
        scenario.firstItemName,
        'hidden'
      );
      reShow[scenario.key] = await measureVisibilityTransition(
        page,
        scenario.folderName,
        scenario.firstItemName,
        'visible'
      );
    }

    return {
      firstFileBrowserDisplay,
      unfold,
      fold,
      reShow
    };
  } finally {
    await page.close();
  }
}

async function runParallelSample(browser: Browser): Promise<IRunTiming[]> {
  const contexts = await Promise.all(
    Array.from({ length: PARALLEL_USERS }).map(() => browser.newContext())
  );
  try {
    return await Promise.all(
      contexts.map(context => runSingleBenchmark(context))
    );
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}

test.describe.serial('file browser benchmark', () => {
  test('measures cold and warm file browser timings', async (
    { browser },
    testInfo
  ) => {
    test.setTimeout(10 * 60 * 1000);

    const runs: IRunTiming[] = [];
    for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
      const sampleRuns = await runParallelSample(browser);
      runs.push(...sampleRuns);
    }

    const report: IBenchmarkReport = {
      measuredAt: new Date().toISOString(),
      sampleCount: SAMPLE_COUNT,
      parallelUsers: PARALLEL_USERS,
      runs,
      summaryMs: {
        firstFileBrowserDisplay: summarize(
          runs.map(run => run.firstFileBrowserDisplay)
        ),
        unfold: {
          '10': summarize(runs.map(run => run.unfold['10'])),
          '1000': summarize(runs.map(run => run.unfold['1000'])),
          '10000': summarize(runs.map(run => run.unfold['10000']))
        },
        fold: {
          '10': summarize(runs.map(run => run.fold['10'])),
          '1000': summarize(runs.map(run => run.fold['1000'])),
          '10000': summarize(runs.map(run => run.fold['10000']))
        },
        reShow: {
          '10': summarize(runs.map(run => run.reShow['10'])),
          '1000': summarize(runs.map(run => run.reShow['1000'])),
          '10000': summarize(runs.map(run => run.reShow['10000']))
        }
      }
    };

    await writeReport(report, testInfo);

    expect(runs.length).toBe(SAMPLE_COUNT * PARALLEL_USERS);
    expect(report.summaryMs.firstFileBrowserDisplay.mean).toBeGreaterThan(0);
    expect(report.summaryMs.unfold['10'].mean).toBeGreaterThan(0);
    expect(report.summaryMs.unfold['1000'].mean).toBeGreaterThan(0);
    expect(report.summaryMs.unfold['10000'].mean).toBeGreaterThan(0);
    expect(report.summaryMs.reShow['10000'].mean).toBeGreaterThan(0);
  });
});
