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
const VERBOSE = process.env.VERBOSE === '1';

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

function logVerbose(message: string): void {
  if (!VERBOSE) {
    return;
  }
  const timestamp = new Date().toISOString();
  console.info(`[benchmark ${timestamp}] ${message}`);
}

function logProbeTimings(
  userId: string,
  headers: Record<string, string>,
  bodyTimings?: unknown
): void {
  const treeMs = headers['x-jupyterlab-unfold-tree-ms'];
  const encodeMs = headers['x-jupyterlab-unfold-encode-ms'];
  const totalMs = headers['x-jupyterlab-unfold-total-ms'];
  const itemCount = headers['x-jupyterlab-unfold-item-count'];
  const listedDirs = headers['x-jupyterlab-unfold-listed-dirs'];

  if (treeMs || encodeMs || totalMs || itemCount || listedDirs) {
    logVerbose(
      `[user:${userId}] probe timings headers tree_ms=${treeMs ?? 'n/a'} encode_ms=${encodeMs ?? 'n/a'} total_ms=${totalMs ?? 'n/a'} item_count=${itemCount ?? 'n/a'} listed_dirs=${listedDirs ?? 'n/a'}`
    );
  }

  if (bodyTimings !== undefined) {
    logVerbose(
      `[user:${userId}] probe timings body=${JSON.stringify(bodyTimings)}`
    );
  }
}

function normalizeLabUrl(rawTarget: string): URL {
  const parsed = new URL(rawTarget);
  const token = parsed.searchParams.get('token');

  const normalized = new URL(parsed.origin);
  normalized.pathname = parsed.pathname.includes('/lab')
    ? parsed.pathname
    : `${parsed.pathname.replace(/\/$/, '')}/lab`;

  if (token) {
    normalized.searchParams.set('token', token);
  }

  return normalized;
}

function buildLabUrl(
  rawTarget: string,
  options?: { reset?: boolean; workspace?: string }
): string {
  const labUrl = normalizeLabUrl(rawTarget);
  if (options?.workspace) {
    labUrl.pathname = labUrl.pathname.replace(
      /\/lab\/?$/,
      `/lab/workspaces/${encodeURIComponent(options.workspace)}`
    );
  }
  if (options?.reset) {
    labUrl.searchParams.set('reset', '');
  }
  return labUrl.toString();
}

function buildTreeEndpointUrl(rawTarget: string): string {
  const labUrl = normalizeLabUrl(rawTarget);
  const basePath = labUrl.pathname.endsWith('/lab')
    ? labUrl.pathname.slice(0, -4)
    : labUrl.pathname;
  const endpoint = new URL(labUrl.origin);
  endpoint.pathname = `${basePath.replace(/\/$/, '')}/jupyterlab-unfold/tree`;
  if (labUrl.searchParams.has('token')) {
    endpoint.searchParams.set('token', labUrl.searchParams.get('token') ?? '');
  }
  return endpoint.toString();
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
  const userId = Math.random().toString(16).slice(2, 8);
  const workspaceId = `unfold-bench-${userId}`;
  try {
    logVerbose(`[user:${userId}] starting benchmark run`);
    logVerbose(`[user:${userId}] probing ${buildTreeEndpointUrl(TARGET_URL)}`);
    const treeProbe = await page.request.post(buildTreeEndpointUrl(TARGET_URL), {
      data: {
        path: '',
        include_timings: VERBOSE
      }
    });
    logVerbose(
      `[user:${userId}] server probe status=${treeProbe.status()} ok=${treeProbe.ok()}`
    );
    if (VERBOSE) {
      let bodyTimings: unknown;
      try {
        const body = (await treeProbe.json()) as { timings?: unknown };
        bodyTimings = body.timings;
      } catch {
        bodyTimings = undefined;
      }
      logProbeTimings(userId, treeProbe.headers(), bodyTimings);
    }
    if (treeProbe.status() === 404) {
      throw new Error(
        `Server endpoint ${buildTreeEndpointUrl(
          TARGET_URL
        )} returned 404. Enable the server extension in the target environment: ` +
          '`jupyter server extension enable jupyterlab_unfold --sys-prefix`.'
      );
    }
    if (!treeProbe.ok()) {
      throw new Error(
        `Server endpoint ${buildTreeEndpointUrl(TARGET_URL)} check failed with HTTP ${treeProbe.status()}.`
      );
    }

    const navigationStart = performance.now();
    const navUrl = buildLabUrl(TARGET_URL, {
      reset: true,
      workspace: workspaceId
    });
    logVerbose(`[user:${userId}] navigating to ${navUrl}`);
    await page.goto(navUrl);
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await page.waitForSelector(itemSelector('benchmark-tree'), {
      state: 'visible',
      timeout: 30_000
    });
    const firstFileBrowserDisplay = performance.now() - navigationStart;
    logVerbose(
      `[user:${userId}] first file browser display ${firstFileBrowserDisplay.toFixed(2)}ms`
    );

    logVerbose(`[user:${userId}] expanding benchmark-tree`);
    await page.click(itemSelector('benchmark-tree'));
    try {
      await page.waitForSelector(itemSelector(SCENARIOS[0].folderName), {
        state: 'visible',
        timeout: 30_000
      });
    } catch (error) {
      const visibleTitles = await page.$$eval('.jp-DirListing-item', nodes =>
        nodes
          .slice(0, 20)
          .map(node => node.getAttribute('title') ?? '<no-title>')
      );
      logVerbose(
        `[user:${userId}] failed waiting for first benchmark folder; first visible entries=${JSON.stringify(
          visibleTitles
        )}`
      );
      throw error;
    }
    logVerbose(`[user:${userId}] benchmark-tree expanded`);

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
      logVerbose(`[user:${userId}] unfold start folder_${scenario.key}`);
      unfold[scenario.key] = await measureVisibilityTransition(
        page,
        scenario.folderName,
        scenario.firstItemName,
        'visible'
      );
      logVerbose(
        `[user:${userId}] unfold done folder_${scenario.key} ${unfold[
          scenario.key
        ].toFixed(2)}ms`
      );
      logVerbose(`[user:${userId}] fold start folder_${scenario.key}`);
      fold[scenario.key] = await measureVisibilityTransition(
        page,
        scenario.folderName,
        scenario.firstItemName,
        'hidden'
      );
      logVerbose(
        `[user:${userId}] fold done folder_${scenario.key} ${fold[
          scenario.key
        ].toFixed(2)}ms`
      );
      logVerbose(`[user:${userId}] re-show start folder_${scenario.key}`);
      reShow[scenario.key] = await measureVisibilityTransition(
        page,
        scenario.folderName,
        scenario.firstItemName,
        'visible'
      );
      logVerbose(
        `[user:${userId}] re-show done folder_${scenario.key} ${reShow[
          scenario.key
        ].toFixed(2)}ms`
      );
    }

    logVerbose(`[user:${userId}] benchmark run complete`);
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
    logVerbose(
      `benchmark start sampleCount=${SAMPLE_COUNT} parallelUsers=${PARALLEL_USERS} target=${TARGET_URL}`
    );

    const runs: IRunTiming[] = [];
    for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
      logVerbose(`starting sample ${sampleIndex + 1}/${SAMPLE_COUNT}`);
      const sampleRuns = await runParallelSample(browser);
      runs.push(...sampleRuns);
      logVerbose(
        `completed sample ${sampleIndex + 1}/${SAMPLE_COUNT}; accumulatedRuns=${runs.length}`
      );
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
    logVerbose(
      `benchmark report written firstDisplayMean=${report.summaryMs.firstFileBrowserDisplay.mean.toFixed(
        2
      )}ms`
    );

    expect(runs.length).toBe(SAMPLE_COUNT * PARALLEL_USERS);
    expect(report.summaryMs.firstFileBrowserDisplay.mean).toBeGreaterThan(0);
    expect(report.summaryMs.unfold['10'].mean).toBeGreaterThan(0);
    expect(report.summaryMs.unfold['1000'].mean).toBeGreaterThan(0);
    expect(report.summaryMs.unfold['10000'].mean).toBeGreaterThan(0);
    expect(report.summaryMs.reShow['10000'].mean).toBeGreaterThan(0);
  });
});
