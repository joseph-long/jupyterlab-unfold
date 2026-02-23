import { test, expect, type Page } from '@playwright/test';
import {
  cleanupIsolatedFixtureRoot,
  createIsolatedFixtureRoot,
  prefixPath
} from './helpers/fixture';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:10888';
const TREE_LOCATOR = '.jp-DirListing-content';
const VERBOSE = process.env.VERBOSE === '1';

function buildLabUrl(rawTarget: string): string {
  const parsed = new URL(rawTarget);
  const token = parsed.searchParams.get('token');

  const normalized = new URL(parsed.origin);
  normalized.pathname = parsed.pathname.includes('/lab')
    ? parsed.pathname
    : `${parsed.pathname.replace(/\/$/, '')}/lab`;

  if (token) {
    normalized.searchParams.set('token', token);
  }

  return normalized.toString();
}

function pathItem(itemPath: string): string {
  return `.jp-DirListing-item[data-path="${itemPath}"]`;
}

function logVerbose(message: string): void {
  if (!VERBOSE) {
    return;
  }
  const timestamp = new Date().toISOString();
  console.info(`[unfold ${timestamp}] ${message}`);
}

async function ensureFolderExpanded(
  page: Page,
  folderPath: string,
  expectedChildPath: string
): Promise<void> {
  const child = page.locator(pathItem(expectedChildPath)).first();
  if ((await child.count()) > 0 && (await child.isVisible().catch(() => false))) {
    return;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.click(pathItem(folderPath));
    try {
      await child.waitFor({ state: 'visible', timeout: 8_000 });
      return;
    } catch {
      // Retry by toggling once more if the first click did not unfold.
    }
  }
  throw new Error(
    `Could not expand folder "${folderPath}" to show "${expectedChildPath}"`
  );
}

async function scrollUntilPathVisible(
  page: Page,
  targetPath: string,
  options?: { maxSteps?: number; scrollDelta?: number; anchorPath: string }
): Promise<number> {
  const maxSteps = options?.maxSteps ?? 140;
  const scrollDelta = options?.scrollDelta ?? 420;
  const anchorPath = options?.anchorPath;
  if (!anchorPath) {
    throw new Error('scrollUntilPathVisible requires options.anchorPath');
  }
  const contentDataAttr = `data-unfold-scroll-target-${Math.random()
    .toString(16)
    .slice(2)}`;
  const contentSelector = `.jp-DirListing-content[${contentDataAttr}="1"]`;

  const anchorRow = page.locator(pathItem(anchorPath)).first();
  await anchorRow.waitFor({ state: 'visible', timeout: 30_000 });
  await page.evaluate(
    ({ anchorSelector, contentAttr, contentClassSelector }) => {
      const anchor = document.querySelector(anchorSelector) as HTMLElement | null;
      const content = anchor?.closest(contentClassSelector) as HTMLElement | null;
      if (!content) {
        throw new Error('Could not resolve listing content from anchor row');
      }
      content.setAttribute(contentAttr, '1');
      content.scrollTop = 0;
    },
    {
      anchorSelector: pathItem(anchorPath),
      contentAttr: contentDataAttr,
      contentClassSelector: TREE_LOCATOR
    }
  );

  const listing = page.locator(contentSelector).first();
  await listing.waitFor({ state: 'visible', timeout: 30_000 });
  let maxObservedIndex = -1;
  const targetIndexMatch = targetPath.match(/item-(\d+)\.txt$/);
  const targetIndex = targetIndexMatch
    ? Number.parseInt(targetIndexMatch[1], 10)
    : null;
  const cleanupContentMarker = async (): Promise<void> => {
    await page.evaluate(({ selector, attrName }) => {
      const content = document.querySelector(selector) as HTMLElement | null;
      if (content) {
        content.removeAttribute(attrName);
      }
    }, { selector: contentSelector, attrName: contentDataAttr });
  };

  const isRowVisibleInContainer = async (): Promise<boolean> =>
    page.evaluate(
      ({ rowSelector, contentSelector }) => {
        const row = document.querySelector(rowSelector) as HTMLElement | null;
        const content = document.querySelector(contentSelector) as HTMLElement | null;
        if (!row || !content) {
          return false;
        }
        const rowRect = row.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const verticalOverlap =
          Math.min(rowRect.bottom, contentRect.bottom) -
          Math.max(rowRect.top, contentRect.top);
        const hasHorizontalOverlap =
          rowRect.right > contentRect.left && rowRect.left < contentRect.right;
        return (
          verticalOverlap >= Math.min(16, rowRect.height * 0.5) &&
          hasHorizontalOverlap
        );
      },
      {
        rowSelector: pathItem(targetPath),
        contentSelector
      }
    );
  await page.waitForTimeout(10);

  for (let step = 0; step < maxSteps; step += 1) {
    const candidate = page.locator(pathItem(targetPath)).first();
    if ((await candidate.count()) > 0) {
      await page.waitForTimeout(10);
      if (await isRowVisibleInContainer()) {
        await page.waitForTimeout(10);
        if (await isRowVisibleInContainer()) {
          await candidate.scrollIntoViewIfNeeded();
          await page.waitForTimeout(10);
          if (await isRowVisibleInContainer()) {
            await cleanupContentMarker();
            return maxObservedIndex;
          }
        }
      }
    }

    maxObservedIndex = Math.max(
      maxObservedIndex,
      await page.evaluate(selector => {
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(selector)
        );
        let maxIndex = -1;
        for (const row of rows) {
          const rowPath = row.getAttribute('data-path') ?? '';
          const match = rowPath.match(/item-(\d+)\.txt$/);
          if (!match) {
            continue;
          }
          const index = Number.parseInt(match[1], 10);
          if (!Number.isNaN(index)) {
            maxIndex = Math.max(maxIndex, index);
          }
        }
        return maxIndex;
      }, '.jp-DirListing-item[data-path]')
    );
    if (targetIndex !== null && maxObservedIndex >= targetIndex) {
      await cleanupContentMarker();
      return maxObservedIndex;
    }

    const scrollState = await page.evaluate(
      ({ contentSelector, delta }) => {
        const content = document.querySelector(contentSelector) as HTMLElement | null;
        if (!content) {
          return {
            previousTop: 0,
            nextTop: 0,
            maxTop: 0
          };
        }
        const previousTop = content.scrollTop;
        const maxTop = Math.max(0, content.scrollHeight - content.clientHeight);
        content.scrollTop = Math.min(maxTop, previousTop + delta);
        return {
          previousTop,
          nextTop: content.scrollTop,
          maxTop
        };
      },
      {
        delta: scrollDelta,
        contentSelector
      }
    );
    if (
      VERBOSE &&
      (step < 5 || step % 20 === 0 || scrollState.nextTop === scrollState.maxTop)
    ) {
      logVerbose(
        `scroll step=${step} top=${scrollState.nextTop.toFixed(0)}/${scrollState.maxTop.toFixed(
          0
        )} maxObservedIndex=${maxObservedIndex}`
      );
    }
    await page.waitForTimeout(10);
  }

  await cleanupContentMarker();
  throw new Error(
    `Could not materialize "${targetPath}" after rapid scrolling; max observed index=${maxObservedIndex}`
  );
}

let fixtureRoot = '';

test.describe.serial('jupyterlab-unfold', () => {
  test.beforeEach(() => {
    fixtureRoot = createIsolatedFixtureRoot();
  });

  test.afterEach(() => {
    cleanupIsolatedFixtureRoot(fixtureRoot);
  });

  test('should unfold', async ({ page }) => {
    await page.goto(buildLabUrl(TARGET_URL));
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await page.waitForSelector('div[role="main"] >> text=Launcher');

    await page.hover(pathItem(fixtureRoot));
    await ensureFolderExpanded(page, fixtureRoot, prefixPath(fixtureRoot, 'dir1'));
    await expect(page.locator(TREE_LOCATOR)).toContainText('dir1');

    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir1'),
      prefixPath(fixtureRoot, 'dir2')
    );
    await expect(page.locator(pathItem(prefixPath(fixtureRoot, 'dir2')))).toBeVisible();

    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir2'),
      prefixPath(fixtureRoot, 'dir2/dir3')
    );
    await expect(
      page.locator(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')))
    ).toBeVisible();

    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir2/dir3'),
      prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')
    );
    await expect(
      page.locator(pathItem(prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')))
    ).toBeVisible();

    await page.click(pathItem(prefixPath(fixtureRoot, 'dir2')));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')), {
      state: 'detached'
    });
    await expect(
      page.locator(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')))
    ).toHaveCount(0);
  });

  test('should open file', async ({ page }) => {
    let workspace = {
      data: {
        'file-browser-filebrowser:openState': {
          openState: { '.': true, dir1: true, dir2: true, 'dir2/dir3': true }
        }
      },
      metadata: { id: 'default' }
    };
    await page.route(/.*\/api\/workspaces.*/, (route, request) => {
      if (request.method() === 'GET') {
        route.fulfill({
          status: 200,
          body: JSON.stringify(workspace)
        });
      } else if (request.method() === 'PUT') {
        workspace = request.postDataJSON();
        route.fulfill({ status: 204 });
      } else {
        route.continue();
      }
    });

    await page.goto(buildLabUrl(TARGET_URL));
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await page.waitForSelector('div[role="main"] >> text=Launcher');
    await page.hover(pathItem(fixtureRoot));
    await ensureFolderExpanded(page, fixtureRoot, prefixPath(fixtureRoot, 'dir2'));
    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir2'),
      prefixPath(fixtureRoot, 'dir2/dir3')
    );
    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir2/dir3'),
      prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')
    );

    await page.dblclick(pathItem(prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')));
    await page.waitForSelector('[role="main"] >> text=file211.txt');
    await expect(page.locator('.lm-DockPanel-tabBar')).toContainText('file211.txt');
  });

  test('keeps materializing new rows during rapid virtualized scrolling', async ({
    page
  }) => {
    test.setTimeout(120_000);
    if (VERBOSE) {
      page.on('response', response => {
        const url = response.url();
        if (!url.includes('/jupyterlab-unfold/tree')) {
          return;
        }
        const headers = response.headers();
        logVerbose(
          `tree response status=${response.status()} itemCount=${
            headers['x-jupyterlab-unfold-item-count'] ?? 'n/a'
          } treeMs=${headers['x-jupyterlab-unfold-tree-ms'] ?? 'n/a'}`
        );
      });
    }

    let workspace = { data: {}, metadata: { id: 'default' } };
    await page.route(/.*\/api\/workspaces.*/, (route, request) => {
      if (request.method() === 'GET') {
        route.fulfill({
          status: 200,
          body: JSON.stringify(workspace)
        });
      } else if (request.method() === 'PUT') {
        workspace = request.postDataJSON();
        route.fulfill({ status: 204 });
      } else {
        route.continue();
      }
    });

    await page.goto(buildLabUrl(TARGET_URL));
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await page.waitForSelector('div[role="main"] >> text=Launcher');
    await page.click(pathItem(fixtureRoot));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'benchmark-tree')), {
      state: 'visible'
    });

    const largeFolder = prefixPath(fixtureRoot, 'benchmark-tree/folder_10000');
    await page.click(pathItem(prefixPath(fixtureRoot, 'benchmark-tree')));
    await page.waitForSelector(pathItem(largeFolder), { state: 'visible' });
    await page.click(pathItem(largeFolder));
    await page.waitForSelector(pathItem(`${largeFolder}/f10000-item-00000.txt`), {
      state: 'visible'
    });
    const farTarget = `${largeFolder}/f10000-item-04000.txt`;
    await expect(page.locator(pathItem(farTarget))).toHaveCount(0);
    logVerbose(`scrolling toward ${farTarget}`);
    const maxObservedIndex = await scrollUntilPathVisible(page, farTarget, {
      maxSteps: 220,
      anchorPath: largeFolder
    });
    expect(maxObservedIndex).toBeGreaterThanOrEqual(4000);
  });
});
