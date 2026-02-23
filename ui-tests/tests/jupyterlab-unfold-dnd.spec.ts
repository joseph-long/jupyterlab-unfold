import { expect, test, type Page } from '@playwright/test';
import {
  cleanupIsolatedFixtureRoot,
  createIsolatedFixtureRoot,
  prefixPath
} from './helpers/fixture';
import {
  deletePath,
  installWorkspaceRouteMock,
  pathExists,
  putFile
} from './helpers/jupyter-api';
import { itemByPath } from './helpers/selectors';
import { ensureFolderExpanded, materializeRow } from './helpers/tree-ui';
import { buildLabUrl } from './helpers/urls';

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

async function dragBetween(page: Page, sourcePath: string, targetPath: string): Promise<void> {
  logVerbose(`drag start ${sourcePath} -> ${targetPath}`);
  const source = page.locator(itemByPath(sourcePath)).first();
  const target = page.locator(itemByPath(targetPath)).first();
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
  await page.hover(itemByPath(fixtureRoot));
  await ensureFolderExpanded(page, fixtureRoot, prefixPath(fixtureRoot, 'dir1'));
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
    await installWorkspaceRouteMock(page);
    await deletePath(page, TARGET_URL, movedPath);
    await deletePath(page, TARGET_URL, sourcePath);
    await putFile(page, TARGET_URL, sourcePath, 'drag basic source');

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await materializeRow(page, sourcePath, { resetToTop: true, maxScrollSteps: 180 });

    await dragBetween(page, sourcePath, prefixPath(fixtureRoot, 'dir2'));

    await expect.poll(() => pathExists(page, TARGET_URL, movedPath)).toBeTruthy();
    await expect.poll(() => pathExists(page, TARGET_URL, sourcePath)).toBeFalsy();
    logVerbose('asserted basic move');

    await deletePath(page, TARGET_URL, movedPath);
  });

  test('spring-loads a folder while dragging and drops into child folder', async ({
    page
  }) => {
    logVerbose('test begin: spring-loads a folder while dragging and drops into child folder');
    const sourcePath = prefixPath(fixtureRoot, 'drag-spring-source.txt');
    const movedPath = prefixPath(fixtureRoot, 'dir2/dir3/drag-spring-source.txt');
    await installWorkspaceRouteMock(page);
    await deletePath(page, TARGET_URL, movedPath);
    await deletePath(page, TARGET_URL, sourcePath);
    await putFile(page, TARGET_URL, sourcePath, 'drag spring source');

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await materializeRow(page, sourcePath, { resetToTop: true, maxScrollSteps: 180 });
    await materializeRow(page, prefixPath(fixtureRoot, 'dir2'), {
      maxScrollSteps: 180
    });

    const source = page.locator(itemByPath(sourcePath)).first();
    const dir2 = page.locator(itemByPath(prefixPath(fixtureRoot, 'dir2'))).first();
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
    await page.waitForSelector(itemByPath(prefixPath(fixtureRoot, 'dir2/dir3')), {
      state: 'visible'
    });
    logVerbose(`spring-load opened ${prefixPath(fixtureRoot, 'dir2/dir3')}`);

    const dir3 = page.locator(itemByPath(prefixPath(fixtureRoot, 'dir2/dir3'))).first();
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

    await expect.poll(() => pathExists(page, TARGET_URL, movedPath)).toBeTruthy();
    await expect.poll(() => pathExists(page, TARGET_URL, sourcePath)).toBeFalsy();
    logVerbose('asserted spring-load move');

    await deletePath(page, TARGET_URL, movedPath);
  });

  test('supports copy modifier while dragging', async ({ page }) => {
    logVerbose('test begin: supports copy modifier while dragging');
    const sourcePath = prefixPath(fixtureRoot, 'drag-copy-source.txt');
    const copiedPath = prefixPath(fixtureRoot, 'dir2/drag-copy-source.txt');
    await installWorkspaceRouteMock(page);
    await deletePath(page, TARGET_URL, copiedPath);
    await deletePath(page, TARGET_URL, sourcePath);
    await putFile(page, TARGET_URL, sourcePath, 'drag copy source');

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await materializeRow(page, sourcePath, { resetToTop: true, maxScrollSteps: 180 });
    await materializeRow(page, prefixPath(fixtureRoot, 'dir2'), {
      maxScrollSteps: 180
    });

    const source = page.locator(itemByPath(sourcePath)).first();
    const dir2 = page.locator(itemByPath(prefixPath(fixtureRoot, 'dir2'))).first();
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

    await expect.poll(() => pathExists(page, TARGET_URL, copiedPath)).toBeTruthy();
    await expect.poll(() => pathExists(page, TARGET_URL, sourcePath)).toBeTruthy();
    logVerbose('asserted copy behavior');

    await deletePath(page, TARGET_URL, copiedPath);
    await deletePath(page, TARGET_URL, sourcePath);
  });

  test('auto-scrolls virtualized lists while dragging to an offscreen target', async ({
    page
  }) => {
    logVerbose('test begin: auto-scrolls virtualized lists while dragging to an offscreen target');
    const largeFolder = prefixPath(fixtureRoot, 'benchmark-tree/folder_10000');
    const sourcePath = `${largeFolder}/f10000-item-00001.txt`;

    await installWorkspaceRouteMock(page);

    await page.goto(buildLabUrl(TARGET_URL));
    logVerbose('navigated to lab');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await openFixtureRoot(page);
    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'benchmark-tree'),
      largeFolder
    );
    await ensureFolderExpanded(page, largeFolder, sourcePath);
    logVerbose('expanded benchmark-tree/folder_10000');

    const content = page.locator('.jp-DirListing-content').first();
    const source = page.locator(itemByPath(sourcePath)).first();
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

    const target = page.locator(itemByPath(targetPath)).first();
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
