import { expect, test, type Page } from '@playwright/test';
import {
  cleanupIsolatedFixtureRoot,
  createIsolatedFixtureRoot,
  prefixPath
} from './helpers/fixture';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:10888';
const VERBOSE = process.env.VERBOSE === '1';
let fixtureRoot = '';

function logVerbose(message: string): void {
  if (!VERBOSE) {
    return;
  }
  const timestamp = new Date().toISOString();
  console.info(`[dnd ${timestamp}] ${message}`);
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

function buildLabUrl(rawTarget: string): string {
  return normalizeLabUrl(rawTarget).toString();
}

function buildContentsApiUrl(rawTarget: string, path: string): string {
  const labUrl = normalizeLabUrl(rawTarget);
  const apiUrl = new URL(labUrl.origin);
  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
  apiUrl.pathname = `/api/contents/${encodedPath}`;
  if (labUrl.searchParams.has('token')) {
    apiUrl.searchParams.set('token', labUrl.searchParams.get('token') ?? '');
  }
  return apiUrl.toString();
}

function byPath(path: string): string {
  return `.jp-DirListing-item[data-path="${path}"]`;
}

async function isRowVisibleInContainer(
  page: Page,
  path: string,
  contentSelector = '.jp-DirListing-content'
): Promise<boolean> {
  const rowSelector = byPath(path);
  return page.evaluate(
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
    { rowSelector, contentSelector }
  );
}

async function materializeRow(
  page: Page,
  path: string,
  options?: { resetToTop?: boolean; maxScrollSteps?: number; stepPx?: number }
): Promise<void> {
  const contentSelector = '.jp-DirListing-content';
  const content = page.locator(contentSelector).first();
  await content.waitFor({ state: 'visible', timeout: 30_000 });

  if (options?.resetToTop ?? false) {
    await content.evaluate(node => {
      node.scrollTop = 0;
    });
    await page.waitForTimeout(10);
  }

  const maxScrollSteps = options?.maxScrollSteps ?? 80;
  const stepPx = options?.stepPx ?? 120;
  for (let step = 0; step < maxScrollSteps; step += 1) {
    const row = page.locator(byPath(path)).first();
    if ((await row.count()) > 0) {
      await page.waitForTimeout(10);
      if (await isRowVisibleInContainer(page, path, contentSelector)) {
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(10);
        if (await isRowVisibleInContainer(page, path, contentSelector)) {
          return;
        }
      }
    }

    const canScrollDown = await content.evaluate(
      node => node.scrollTop + node.clientHeight < node.scrollHeight - 1
    );
    if (!canScrollDown) {
      break;
    }
    await content.evaluate((node, delta) => {
      node.scrollTop = Math.min(
        node.scrollHeight,
        Math.max(0, node.scrollTop + delta)
      );
    }, stepPx);
    await page.waitForTimeout(10);
  }

  throw new Error(`Could not materialize row for path "${path}"`);
}

async function ensureWorkspaceMock(page: Page): Promise<void> {
  logVerbose('installing workspace API mock');
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
}

async function putDirectory(page: Page, path: string): Promise<void> {
  logVerbose(`creating directory ${path}`);
  const response = await page.request.put(buildContentsApiUrl(TARGET_URL, path), {
    data: { type: 'directory' }
  });
  if (response.status() !== 201 && response.status() !== 200) {
    throw new Error(
      `Failed to create directory ${path}: HTTP ${response.status()}`
    );
  }
}

async function putFile(page: Page, path: string, content: string): Promise<void> {
  logVerbose(`creating file ${path}`);
  const response = await page.request.put(buildContentsApiUrl(TARGET_URL, path), {
    data: { type: 'file', format: 'text', content }
  });
  if (response.status() !== 201 && response.status() !== 200) {
    throw new Error(`Failed to create file ${path}: HTTP ${response.status()}`);
  }
}

async function deletePath(page: Page, path: string): Promise<void> {
  logVerbose(`deleting path ${path}`);
  const response = await page.request.delete(buildContentsApiUrl(TARGET_URL, path));
  if (response.status() !== 204 && response.status() !== 404) {
    throw new Error(`Failed to delete ${path}: HTTP ${response.status()}`);
  }
}

async function pathExists(page: Page, path: string): Promise<boolean> {
  const response = await page.request.get(buildContentsApiUrl(TARGET_URL, path));
  return response.status() === 200;
}

async function dragBetween(page: Page, sourcePath: string, targetPath: string): Promise<void> {
  logVerbose(`drag start ${sourcePath} -> ${targetPath}`);
  const source = page.locator(byPath(sourcePath)).first();
  const target = page.locator(byPath(targetPath)).first();
  await source.waitFor({ state: 'visible', timeout: 30_000 });
  await target.waitFor({ state: 'visible', timeout: 30_000 });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Could not compute drag source/target bounding boxes');
  }
  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 10, sourceY + 10);
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
  logVerbose(`drag complete ${sourcePath} -> ${targetPath}`);
}

async function openFixtureRoot(page: Page): Promise<void> {
  await page.waitForSelector(byPath(fixtureRoot), { state: 'visible', timeout: 30_000 });
  await page.click(byPath(fixtureRoot));
}

test.describe.serial('jupyterlab-unfold drag and drop', () => {
  test.beforeEach(() => {
    fixtureRoot = createIsolatedFixtureRoot();
  });

  test.afterEach(() => {
    cleanupIsolatedFixtureRoot(fixtureRoot);
  });

  test('moves a file into a visible folder', async ({ page }) => {
    logVerbose('test begin: moves a file into a visible folder');
    const sourcePath = prefixPath(fixtureRoot, 'drag-basic-source.txt');
    const movedPath = prefixPath(fixtureRoot, 'dir2/drag-basic-source.txt');
    await ensureWorkspaceMock(page);
    await deletePath(page, movedPath);
    await deletePath(page, sourcePath);
    await putFile(page, sourcePath, 'drag basic source');

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await page.waitForSelector(byPath(sourcePath), { state: 'visible' });

    await dragBetween(page, sourcePath, prefixPath(fixtureRoot, 'dir2'));

    await expect.poll(() => pathExists(page, movedPath)).toBeTruthy();
    await expect.poll(() => pathExists(page, sourcePath)).toBeFalsy();
    logVerbose('asserted basic move');

    await deletePath(page, movedPath);
  });

  test('spring-loads a folder while dragging and drops into child folder', async ({
    page
  }) => {
    logVerbose('test begin: spring-loads a folder while dragging and drops into child folder');
    const sourcePath = prefixPath(fixtureRoot, 'drag-spring-source.txt');
    const movedPath = prefixPath(fixtureRoot, 'dir2/dir3/drag-spring-source.txt');
    await ensureWorkspaceMock(page);
    await deletePath(page, movedPath);
    await deletePath(page, sourcePath);
    await putFile(page, sourcePath, 'drag spring source');

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await page.waitForSelector(byPath(sourcePath), { state: 'visible' });

    const source = page.locator(byPath(sourcePath)).first();
    const dir2 = page.locator(byPath(prefixPath(fixtureRoot, 'dir2'))).first();
    await source.waitFor({ state: 'visible' });
    await dir2.waitFor({ state: 'visible' });
    const sourceBox = await source.boundingBox();
    const dir2Box = await dir2.boundingBox();
    if (!sourceBox || !dir2Box) {
      throw new Error('Could not compute drag source/target bounding boxes');
    }
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 10,
      sourceBox.y + sourceBox.height / 2 + 10
    );
    await page.mouse.move(
      dir2Box.x + dir2Box.width / 2,
      dir2Box.y + dir2Box.height / 2,
      { steps: 10 }
    );
    logVerbose('hovering on dir2 for spring-load');
    await page.waitForTimeout(700);
    await page.waitForSelector(byPath(prefixPath(fixtureRoot, 'dir2/dir3')), {
      state: 'visible'
    });
    logVerbose(`spring-load opened ${prefixPath(fixtureRoot, 'dir2/dir3')}`);

    const dir3 = page.locator(byPath(prefixPath(fixtureRoot, 'dir2/dir3'))).first();
    const dir3Box = await dir3.boundingBox();
    if (!dir3Box) {
      throw new Error('Could not compute spring-loaded child folder bounding box');
    }
    await page.mouse.move(
      dir3Box.x + dir3Box.width / 2,
      dir3Box.y + dir3Box.height / 2,
      { steps: 8 }
    );
    await page.mouse.up();
    logVerbose(`dropped into ${prefixPath(fixtureRoot, 'dir2/dir3')}`);

    await expect.poll(() => pathExists(page, movedPath)).toBeTruthy();
    await expect.poll(() => pathExists(page, sourcePath)).toBeFalsy();
    logVerbose('asserted spring-load move');

    await deletePath(page, movedPath);
  });

  test('supports copy modifier while dragging', async ({ page }) => {
    logVerbose('test begin: supports copy modifier while dragging');
    const sourcePath = prefixPath(fixtureRoot, 'drag-copy-source.txt');
    const copiedPath = prefixPath(fixtureRoot, 'dir2/drag-copy-source.txt');
    await ensureWorkspaceMock(page);
    await deletePath(page, copiedPath);
    await deletePath(page, sourcePath);
    await putFile(page, sourcePath, 'drag copy source');

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await page.waitForSelector(byPath(sourcePath), { state: 'visible' });

    const source = page.locator(byPath(sourcePath)).first();
    const dir2 = page.locator(byPath(prefixPath(fixtureRoot, 'dir2'))).first();
    const sourceBox = await source.boundingBox();
    const dir2Box = await dir2.boundingBox();
    if (!sourceBox || !dir2Box) {
      throw new Error('Could not compute drag source/target bounding boxes');
    }
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 10,
      sourceBox.y + sourceBox.height / 2 + 10
    );
    await page.keyboard.down('Control');
    logVerbose('copy modifier held');
    await page.mouse.move(dir2Box.x + dir2Box.width / 2, dir2Box.y + dir2Box.height / 2, {
      steps: 10
    });
    await page.mouse.up();
    await page.keyboard.up('Control');
    logVerbose('copy modifier released');

    await expect.poll(() => pathExists(page, copiedPath)).toBeTruthy();
    await expect.poll(() => pathExists(page, sourcePath)).toBeTruthy();
    logVerbose('asserted copy behavior');

    await deletePath(page, copiedPath);
    await deletePath(page, sourcePath);
  });

  test('auto-scrolls virtualized lists while dragging to an offscreen target', async ({
    page
  }) => {
    logVerbose('test begin: auto-scrolls virtualized lists while dragging to an offscreen target');
    const largeFolder = prefixPath(fixtureRoot, 'benchmark-tree/folder_10000');
    const sourcePath = `${largeFolder}/f10000-item-00001.txt`;

    await ensureWorkspaceMock(page);
    const hasLargeFolder = await pathExists(page, largeFolder);
    test.skip(!hasLargeFolder, 'benchmark-tree/folder_10000 is not available');
    logVerbose(`benchmark large folder present=${hasLargeFolder}`);

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await materializeRow(page, prefixPath(fixtureRoot, 'benchmark-tree'), {
      resetToTop: true
    });
    await page.click(byPath(prefixPath(fixtureRoot, 'benchmark-tree')));
    await materializeRow(page, largeFolder, { resetToTop: true });
    await page.click(byPath(largeFolder));
    await materializeRow(page, sourcePath, { resetToTop: true });
    logVerbose('expanded benchmark-tree/folder_10000');

    const content = page.locator('.jp-DirListing-content').first();
    const source = page.locator(byPath(sourcePath)).first();
    const sourceBox = await source.boundingBox();
    const contentBox = await content.boundingBox();
    if (!sourceBox || !contentBox) {
      throw new Error('Could not compute drag boxes for virtualized list test');
    }
    const visiblePathsBefore = await page.evaluate(prefix => {
      const content = document.querySelector(
        '.jp-DirListing-content'
      ) as HTMLElement | null;
      if (!content) {
        return [] as string[];
      }
      const contentRect = content.getBoundingClientRect();
      return Array.from(
        document.querySelectorAll('.jp-DirListing-item[data-path]')
      )
        .map(node => node as HTMLElement)
        .filter(node => {
          const path = node.getAttribute('data-path') ?? '';
          if (!path.startsWith(prefix + '/')) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.bottom > contentRect.top && rect.top < contentRect.bottom;
        })
        .map(node => node.getAttribute('data-path') ?? '');
    }, largeFolder);

    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 10,
      sourceBox.y + sourceBox.height / 2 + 10
    );

    const scrollBefore = await content.evaluate(node => node.scrollTop);
    await page.mouse.move(contentBox.x + contentBox.width / 2, contentBox.y + contentBox.height - 3);
    logVerbose('holding near bottom edge to trigger auto-scroll');
    for (let i = 0; i < 120; i += 1) {
      await page.waitForTimeout(25);
    }
    const scrollAfter = await content.evaluate(node => node.scrollTop);
    expect(scrollAfter).toBeGreaterThan(scrollBefore);
    logVerbose(`scroll increased from ${scrollBefore} to ${scrollAfter}`);

    const visiblePathsAfter = await page.evaluate(prefix => {
      const content = document.querySelector(
        '.jp-DirListing-content'
      ) as HTMLElement | null;
      if (!content) {
        return [] as string[];
      }
      const contentRect = content.getBoundingClientRect();
      return Array.from(
        document.querySelectorAll('.jp-DirListing-item[data-path]')
      )
        .map(node => node as HTMLElement)
        .filter(node => {
          const path = node.getAttribute('data-path') ?? '';
          if (!path.startsWith(prefix + '/')) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.bottom > contentRect.top && rect.top < contentRect.bottom;
        })
        .map(node => node.getAttribute('data-path') ?? '');
    }, largeFolder);

    const visibleBeforeSet = new Set(visiblePathsBefore);
    const targetPath = visiblePathsAfter.find(path => !visibleBeforeSet.has(path));
    if (!targetPath) {
      throw new Error(
        'Auto-scroll did not reveal any new visible row; refusing to target a row that was already visible'
      );
    }

    const target = page.locator(byPath(targetPath)).first();
    const targetBox = await target.boundingBox();
    if (!targetBox) {
      throw new Error('Could not compute offscreen target row bounding box');
    }
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 }
    );
    expect(visiblePathsAfter).toContain(targetPath);
    await page.mouse.up();
    logVerbose('dropped onto virtualized offscreen target');
    logVerbose('asserted virtualized auto-scroll target selection');
  });
});
