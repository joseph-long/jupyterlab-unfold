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
import {
  cleanupIsolatedFixtureRoot,
  createIsolatedFixtureRoot,
  prefixPath
} from './helpers/fixture';
import { parseNumberHeader } from './helpers/metrics';
import { itemByPath } from './helpers/selectors';
import { isRowVisibleInContainer, materializeRow } from './helpers/tree-ui';
import { buildLabUrl, buildTreeEndpointUrl } from './helpers/urls';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:10888';
const SAMPLE_COUNT = Number(process.env.BENCHMARK_SAMPLE_COUNT ?? '3');
const PARALLEL_USERS = Number(process.env.BENCHMARK_PARALLEL_USERS ?? '2');
const VERBOSE = process.env.VERBOSE === '1';

interface IScenario {
  key: '10' | '1000' | '10000';
  folderName: string;
  firstItemName: string;
  folderPath: string;
  firstItemPath: string;
}

interface IRunTiming {
  firstFileBrowserDisplay: number;
  unfold: Record<IScenario['key'], number>;
  fold: Record<IScenario['key'], number>;
  reShow: Record<IScenario['key'], number>;
  backend: {
    unfold: Record<IScenario['key'], IBackendStepTiming>;
    fold: Record<IScenario['key'], IBackendStepTiming>;
    reShow: Record<IScenario['key'], IBackendStepTiming>;
  };
}

interface IBenchmarkSummary {
  mean: number;
  min: number;
  max: number;
}

interface IBackendStepTiming {
  status: number;
  treeMs: number | null;
  encodeMs: number | null;
  totalMs: number | null;
  itemCount: number | null;
  listedDirs: number | null;
  path: string | null;
  updatePath: string | null;
  openPathsCount: number | null;
  clientRequestMs: number | null;
  clientJsonMs: number | null;
  clientFetchTotalMs: number | null;
  clientOpenStateUpdateMs: number | null;
  clientModelTotalMs: number | null;
  uiElapsedMs: number;
  uiClickToResponseMs: number;
  uiResponseToVisibleMs: number;
}

interface ITransitionMeasurement {
  elapsedMs: number;
  backend: IBackendStepTiming;
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
  summaryBreakdownMs: {
    unfold: Record<IScenario['key'], IStageSummary>;
    fold: Record<IScenario['key'], IStageSummary>;
    reShow: Record<IScenario['key'], IStageSummary>;
  };
}

interface IStageSummary {
  treeMs: IBenchmarkSummary | null;
  encodeMs: IBenchmarkSummary | null;
  totalMs: IBenchmarkSummary | null;
  clientRequestMs: IBenchmarkSummary | null;
  clientJsonMs: IBenchmarkSummary | null;
  clientFetchTotalMs: IBenchmarkSummary | null;
  clientOpenStateUpdateMs: IBenchmarkSummary | null;
  clientModelTotalMs: IBenchmarkSummary | null;
  uiElapsedMs: IBenchmarkSummary | null;
  uiClickToResponseMs: IBenchmarkSummary | null;
  uiResponseToVisibleMs: IBenchmarkSummary | null;
}

interface IClientBenchmarkEvent {
  type: 'tree-fetch';
  requestId: number;
  path: string;
  updatePath: string | null;
  expandedPathsCount: number;
  itemCount: number;
  clientRequestMs: number;
  clientJsonMs: number;
  clientFetchTotalMs: number;
  openStateUpdateMs: number;
  modelTotalMs: number;
  serverTreeMs: number | null;
  serverEncodeMs: number | null;
  serverTotalMs: number | null;
  serverItemCount: number | null;
  serverListedDirs: number | null;
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


const SCENARIOS: IScenario[] = [
  {
    key: '10',
    folderName: 'folder_00010',
    firstItemName: 'f10-item-00000.txt',
    folderPath: 'benchmark-tree/folder_00010',
    firstItemPath: 'benchmark-tree/folder_00010/f10-item-00000.txt'
  },
  {
    key: '1000',
    folderName: 'folder_01000',
    firstItemName: 'f1000-item-00000.txt',
    folderPath: 'benchmark-tree/folder_01000',
    firstItemPath: 'benchmark-tree/folder_01000/f1000-item-00000.txt'
  },
  {
    key: '10000',
    folderName: 'folder_10000',
    firstItemName: 'f10000-item-00000.txt',
    folderPath: 'benchmark-tree/folder_10000',
    firstItemPath: 'benchmark-tree/folder_10000/f10000-item-00000.txt'
  }
];

function scopedScenarios(rootPath: string): IScenario[] {
  return SCENARIOS.map(scenario => ({
    ...scenario,
    folderPath: prefixPath(rootPath, scenario.folderPath),
    firstItemPath: prefixPath(rootPath, scenario.firstItemPath)
  }));
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

function emptyBackendStepTiming(): IBackendStepTiming {
  return {
    status: 0,
    treeMs: null,
    encodeMs: null,
    totalMs: null,
    itemCount: null,
    listedDirs: null,
    path: null,
    updatePath: null,
    openPathsCount: null,
    clientRequestMs: null,
    clientJsonMs: null,
    clientFetchTotalMs: null,
    clientOpenStateUpdateMs: null,
    clientModelTotalMs: null,
    uiElapsedMs: 0,
    uiClickToResponseMs: 0,
    uiResponseToVisibleMs: 0
  };
}

function summarizeNullable(values: Array<number | null>): IBenchmarkSummary | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return summarize(present);
}

function summarizeBackend(
  runs: IRunTiming[],
  phase: keyof IRunTiming['backend'],
  scenario: IScenario['key']
): IStageSummary {
  const metrics = runs.map(run => run.backend[phase][scenario]);
  return {
    treeMs: summarizeNullable(metrics.map(value => value.treeMs)),
    encodeMs: summarizeNullable(metrics.map(value => value.encodeMs)),
    totalMs: summarizeNullable(metrics.map(value => value.totalMs)),
    clientRequestMs: summarizeNullable(metrics.map(value => value.clientRequestMs)),
    clientJsonMs: summarizeNullable(metrics.map(value => value.clientJsonMs)),
    clientFetchTotalMs: summarizeNullable(
      metrics.map(value => value.clientFetchTotalMs)
    ),
    clientOpenStateUpdateMs: summarizeNullable(
      metrics.map(value => value.clientOpenStateUpdateMs)
    ),
    clientModelTotalMs: summarizeNullable(
      metrics.map(value => value.clientModelTotalMs)
    ),
    uiElapsedMs: summarizeNullable(metrics.map(value => value.uiElapsedMs)),
    uiClickToResponseMs: summarizeNullable(
      metrics.map(value => value.uiClickToResponseMs)
    ),
    uiResponseToVisibleMs: summarizeNullable(
      metrics.map(value => value.uiResponseToVisibleMs)
    )
  };
}

async function waitForBenchmarkEvent(
  page: Page,
  requestId: number
): Promise<IClientBenchmarkEvent | null> {
  const timeoutAt = Date.now() + 5000;
  while (Date.now() < timeoutAt) {
    const event = await page.evaluate(id => {
      const benchmarkWindow = window as unknown as {
        __JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__?: IClientBenchmarkEvent[];
      };
      const queue = benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__;
      if (!Array.isArray(queue)) {
        return null;
      }
      const index = queue.findIndex(item => item.requestId === id);
      if (index === -1) {
        return null;
      }
      const [found] = queue.splice(index, 1);
      return found ?? null;
    }, requestId);

    if (event) {
      return event;
    }
    await page.waitForTimeout(20);
  }
  return null;
}

async function measureVisibilityTransition(
  page: Page,
  userId: string,
  stepLabel: string,
  folderPath: string,
  itemPath: string,
  targetState: 'visible' | 'hidden'
): Promise<ITransitionMeasurement> {
  const contentSelector = '.jp-DirListing-content';
  const waitForMaterializedVisibleRow = async (
    path: string,
    maxScrollSteps = 80
  ) => {
    await materializeRow(page, path, {
      resetToTop: true,
      maxScrollSteps,
      stepPx: 120
    });
    const rowLocator = page.locator(itemByPath(path)).first();
    await page.waitForTimeout(10);
    if (!(await isRowVisibleInContainer(page, path, contentSelector))) {
      throw new Error(
        `${stepLabel} failed: row materialized but not visible for path "${path}"`
      );
    }
    return rowLocator;
  };

  await waitForMaterializedVisibleRow(folderPath);

  let treeResponse:
    | Awaited<ReturnType<Page['waitForResponse']>>
    | undefined = undefined;
  let startTime = 0;
  let clickAttempts = 0;
  const maxClickAttempts = 3;
  while (!treeResponse && clickAttempts < maxClickAttempts) {
    clickAttempts += 1;
    const folderLocator = await waitForMaterializedVisibleRow(folderPath);

    const treeResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/jupyterlab-unfold/tree') &&
        response.request().method() === 'POST',
      { timeout: 5_000 }
    );
    startTime = performance.now();
    await folderLocator.click({ timeout: 5_000 });
    try {
      treeResponse = await treeResponsePromise;
    } catch {
      if (VERBOSE) {
        logVerbose(
          `[user:${userId}] ${stepLabel} click attempt ${clickAttempts}/${maxClickAttempts} did not trigger tree request; retrying`
        );
      }
    }
  }

  if (!treeResponse) {
    throw new Error(
      `${stepLabel} failed: click did not trigger /jupyterlab-unfold/tree after ${maxClickAttempts} attempts`
    );
  }

  const responseTime = performance.now();
  await page.waitForSelector(itemByPath(itemPath), { state: targetState });
  const endTime = performance.now();
  const elapsedMs = endTime - startTime;
  const clickToResponseMs = responseTime - startTime;
  const responseToVisibleMs = endTime - responseTime;

  const headers = treeResponse.headers();
  const postData = (() => {
    try {
      return treeResponse.request().postDataJSON() as {
        path?: string;
        update_path?: string;
        open_paths?: unknown[];
        client_request_id?: number;
      };
    } catch {
      return undefined;
    }
  })();
  const backend: IBackendStepTiming = {
    status: treeResponse.status(),
    treeMs: parseNumberHeader(headers, 'x-jupyterlab-unfold-tree-ms'),
    encodeMs: parseNumberHeader(headers, 'x-jupyterlab-unfold-encode-ms'),
    totalMs: parseNumberHeader(headers, 'x-jupyterlab-unfold-total-ms'),
    itemCount: parseNumberHeader(headers, 'x-jupyterlab-unfold-item-count'),
    listedDirs: parseNumberHeader(headers, 'x-jupyterlab-unfold-listed-dirs'),
    path: postData?.path ?? null,
    updatePath: postData?.update_path ?? null,
    openPathsCount: Array.isArray(postData?.open_paths)
      ? postData.open_paths.length
      : null,
    clientRequestMs: null,
    clientJsonMs: null,
    clientFetchTotalMs: null,
    clientOpenStateUpdateMs: null,
    clientModelTotalMs: null,
    uiElapsedMs: elapsedMs,
    uiClickToResponseMs: clickToResponseMs,
    uiResponseToVisibleMs: responseToVisibleMs
  };

  const requestId =
    typeof postData?.client_request_id === 'number'
      ? postData.client_request_id
      : null;
  if (requestId !== null) {
    const clientEvent = await waitForBenchmarkEvent(page, requestId);
    if (clientEvent) {
      backend.clientRequestMs = clientEvent.clientRequestMs;
      backend.clientJsonMs = clientEvent.clientJsonMs;
      backend.clientFetchTotalMs = clientEvent.clientFetchTotalMs;
      backend.clientOpenStateUpdateMs = clientEvent.openStateUpdateMs;
      backend.clientModelTotalMs = clientEvent.modelTotalMs;
    }
  }

  if (VERBOSE) {
    const requestContext = ` path=${backend.path ?? ''} update_path=${
      backend.updatePath ?? ''
    } open_paths=${backend.openPathsCount ?? 'n/a'}`;
    logProbeTimings(userId, headers);
    logVerbose(
      `[user:${userId}] ${stepLabel} response status=${backend.status} ui_ms=${elapsedMs.toFixed(
        2
      )} click_to_response_ms=${clickToResponseMs.toFixed(
        2
      )} response_to_visible_ms=${responseToVisibleMs.toFixed(
        2
      )} client_fetch_ms=${backend.clientFetchTotalMs?.toFixed(2) ?? 'n/a'} client_model_ms=${backend.clientModelTotalMs?.toFixed(2) ?? 'n/a'}${requestContext}`
    );
  }

  return {
    elapsedMs,
    backend
  };
}

function reportPath(browserName: string): string {
  return path.resolve(
    __dirname,
    '..',
    'benchmark-results',
    `filebrowser.${browserName}.json`
  );
}

async function writeReport(
  report: IBenchmarkReport,
  testInfo: TestInfo,
  browserName: string
): Promise<void> {
  const outputPath = reportPath(browserName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  await testInfo.attach('filebrowser-benchmark', {
    path: outputPath,
    contentType: 'application/json'
  });
}

async function runSingleBenchmark(
  context: BrowserContext,
  fixtureRoot: string
): Promise<IRunTiming> {
  const page = await context.newPage();
  const userId = Math.random().toString(16).slice(2, 8);
  const workspaceId = `unfold-bench-${userId}`;
  const scenarios = scopedScenarios(fixtureRoot);
  try {
    await page.addInitScript(() => {
      const benchmarkWindow = window as unknown as {
        __JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__?: unknown[];
        __JUPYTERLAB_UNFOLD_BENCHMARK_HOOK__?: (event: unknown) => void;
      };
      benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__ = [];
      benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_HOOK__ = event => {
        benchmarkWindow.__JUPYTERLAB_UNFOLD_BENCHMARK_EVENTS__?.push(event);
      };
    });

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
    await page.waitForSelector(itemByPath(fixtureRoot), {
      state: 'visible',
      timeout: 30_000
    });
    const firstFileBrowserDisplay = performance.now() - navigationStart;
    logVerbose(
      `[user:${userId}] first file browser display ${firstFileBrowserDisplay.toFixed(2)}ms`
    );

    logVerbose(`[user:${userId}] expanding ${fixtureRoot}`);
    await page.click(itemByPath(fixtureRoot));
    try {
      await page.waitForSelector(itemByPath(prefixPath(fixtureRoot, 'benchmark-tree')), {
        state: 'visible',
        timeout: 30_000
      });
      await page.click(itemByPath(prefixPath(fixtureRoot, 'benchmark-tree')));
      await page.waitForSelector(itemByPath(scenarios[0].folderPath), {
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
    logVerbose(`[user:${userId}] benchmark-tree expanded under ${fixtureRoot}`);

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
    const backend: IRunTiming['backend'] = {
      unfold: {
        '10': emptyBackendStepTiming(),
        '1000': emptyBackendStepTiming(),
        '10000': emptyBackendStepTiming()
      },
      fold: {
        '10': emptyBackendStepTiming(),
        '1000': emptyBackendStepTiming(),
        '10000': emptyBackendStepTiming()
      },
      reShow: {
        '10': emptyBackendStepTiming(),
        '1000': emptyBackendStepTiming(),
        '10000': emptyBackendStepTiming()
      }
    };

    for (const scenario of scenarios) {
      logVerbose(`[user:${userId}] unfold start folder_${scenario.key}`);
      const unfoldMeasurement = await measureVisibilityTransition(
        page,
        userId,
        `unfold folder_${scenario.key}`,
        scenario.folderPath,
        scenario.firstItemPath,
        'visible'
      );
      unfold[scenario.key] = unfoldMeasurement.elapsedMs;
      backend.unfold[scenario.key] = unfoldMeasurement.backend;
      logVerbose(
        `[user:${userId}] unfold done folder_${scenario.key} ${unfold[
          scenario.key
        ].toFixed(2)}ms`
      );
      logVerbose(`[user:${userId}] fold start folder_${scenario.key}`);
      const foldMeasurement = await measureVisibilityTransition(
        page,
        userId,
        `fold folder_${scenario.key}`,
        scenario.folderPath,
        scenario.firstItemPath,
        'hidden'
      );
      fold[scenario.key] = foldMeasurement.elapsedMs;
      backend.fold[scenario.key] = foldMeasurement.backend;
      logVerbose(
        `[user:${userId}] fold done folder_${scenario.key} ${fold[
          scenario.key
        ].toFixed(2)}ms`
      );
      logVerbose(`[user:${userId}] re-show start folder_${scenario.key}`);
      const reShowMeasurement = await measureVisibilityTransition(
        page,
        userId,
        `re-show folder_${scenario.key}`,
        scenario.folderPath,
        scenario.firstItemPath,
        'visible'
      );
      reShow[scenario.key] = reShowMeasurement.elapsedMs;
      backend.reShow[scenario.key] = reShowMeasurement.backend;
      logVerbose(
        `[user:${userId}] re-show done folder_${scenario.key} ${reShow[
          scenario.key
        ].toFixed(2)}ms`
      );
      logVerbose(`[user:${userId}] cleanup fold start folder_${scenario.key}`);
      await measureVisibilityTransition(
        page,
        userId,
        `cleanup fold folder_${scenario.key}`,
        scenario.folderPath,
        scenario.firstItemPath,
        'hidden'
      );
      logVerbose(`[user:${userId}] cleanup fold done folder_${scenario.key}`);
    }

    logVerbose(`[user:${userId}] benchmark run complete`);
    return {
      firstFileBrowserDisplay,
      unfold,
      fold,
      reShow,
      backend
    };
  } finally {
    await page.close();
  }
}

async function runParallelSample(
  browser: Browser,
  fixtureRoot: string
): Promise<IRunTiming[]> {
  const contexts = await Promise.all(
    Array.from({ length: PARALLEL_USERS }).map(() => browser.newContext())
  );
  try {
    return await Promise.all(
      contexts.map(context => runSingleBenchmark(context, fixtureRoot))
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
    const fixtureRoot = createIsolatedFixtureRoot();
    logVerbose(
      `benchmark start sampleCount=${SAMPLE_COUNT} parallelUsers=${PARALLEL_USERS} target=${TARGET_URL}`
    );

    const runs: IRunTiming[] = [];
    try {
      for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
        logVerbose(`starting sample ${sampleIndex + 1}/${SAMPLE_COUNT}`);
        const sampleRuns = await runParallelSample(browser, fixtureRoot);
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
        },
        summaryBreakdownMs: {
          unfold: {
            '10': summarizeBackend(runs, 'unfold', '10'),
            '1000': summarizeBackend(runs, 'unfold', '1000'),
            '10000': summarizeBackend(runs, 'unfold', '10000')
          },
          fold: {
            '10': summarizeBackend(runs, 'fold', '10'),
            '1000': summarizeBackend(runs, 'fold', '1000'),
            '10000': summarizeBackend(runs, 'fold', '10000')
          },
          reShow: {
            '10': summarizeBackend(runs, 'reShow', '10'),
            '1000': summarizeBackend(runs, 'reShow', '1000'),
            '10000': summarizeBackend(runs, 'reShow', '10000')
          }
        }
      };

      const browserName = testInfo.project.use.browserName ?? 'unknown';
      await writeReport(report, testInfo, browserName);
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
    } finally {
      cleanupIsolatedFixtureRoot(fixtureRoot);
    }
  });
});
