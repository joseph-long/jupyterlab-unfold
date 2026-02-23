import { test, expect } from '@playwright/test';
import {
  cleanupIsolatedFixtureRoot,
  createIsolatedFixtureRoot,
  prefixPath
} from './helpers/fixture';
import { installWorkspaceRouteMock } from './helpers/jupyter-api';
import { itemByPath } from './helpers/selectors';
import { ensureFolderExpanded, scrollUntilPathVisible } from './helpers/tree-ui';
import { buildLabUrl } from './helpers/urls';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:10888';
const TREE_LOCATOR = '.jp-DirListing-content';
const VERBOSE = process.env.VERBOSE === '1';

function logVerbose(message: string): void {
  if (!VERBOSE) {
    return;
  }
  const timestamp = new Date().toISOString();
  console.info(`[unfold ${timestamp}] ${message}`);
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

    await page.hover(itemByPath(fixtureRoot));
    await ensureFolderExpanded(page, fixtureRoot, prefixPath(fixtureRoot, 'dir1'));
    await expect(page.locator(TREE_LOCATOR)).toContainText('dir1');

    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir1'),
      prefixPath(fixtureRoot, 'dir2')
    );
    await expect(page.locator(itemByPath(prefixPath(fixtureRoot, 'dir2')))).toBeVisible();

    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir2'),
      prefixPath(fixtureRoot, 'dir2/dir3')
    );
    await expect(
      page.locator(itemByPath(prefixPath(fixtureRoot, 'dir2/dir3')))
    ).toBeVisible();

    await ensureFolderExpanded(
      page,
      prefixPath(fixtureRoot, 'dir2/dir3'),
      prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')
    );
    await expect(
      page.locator(itemByPath(prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')))
    ).toBeVisible();

    await page.click(itemByPath(prefixPath(fixtureRoot, 'dir2')));
    await page.waitForSelector(itemByPath(prefixPath(fixtureRoot, 'dir2/dir3')), {
      state: 'detached'
    });
    await expect(
      page.locator(itemByPath(prefixPath(fixtureRoot, 'dir2/dir3')))
    ).toHaveCount(0);
  });

  test('should open file', async ({ page }) => {
    await installWorkspaceRouteMock(page, {
      data: {
        'file-browser-filebrowser:openState': {
          openState: { '.': true, dir1: true, dir2: true, 'dir2/dir3': true }
        }
      },
      metadata: { id: 'default' }
    });

    await page.goto(buildLabUrl(TARGET_URL));
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await page.waitForSelector('div[role="main"] >> text=Launcher');
    await page.hover(itemByPath(fixtureRoot));
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

    await page.dblclick(itemByPath(prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')));
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

    await installWorkspaceRouteMock(page);

    await page.goto(buildLabUrl(TARGET_URL));
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached' });
    await page.waitForSelector('div[role="main"] >> text=Launcher');
    await page.click(itemByPath(fixtureRoot));
    await page.waitForSelector(itemByPath(prefixPath(fixtureRoot, 'benchmark-tree')), {
      state: 'visible'
    });

    const largeFolder = prefixPath(fixtureRoot, 'benchmark-tree/folder_10000');
    await page.click(itemByPath(prefixPath(fixtureRoot, 'benchmark-tree')));
    await page.waitForSelector(itemByPath(largeFolder), { state: 'visible' });
    await page.click(itemByPath(largeFolder));
    await page.waitForSelector(itemByPath(`${largeFolder}/f10000-item-00000.txt`), {
      state: 'visible'
    });
    const farTarget = `${largeFolder}/f10000-item-04000.txt`;
    await expect(page.locator(itemByPath(farTarget))).toHaveCount(0);
    logVerbose(`scrolling toward ${farTarget}`);
    const maxObservedIndex = await scrollUntilPathVisible(page, farTarget, {
      maxSteps: 220,
      anchorPath: largeFolder,
      onProgress: ({ step, maxObservedIndex, nextTop, maxTop }) => {
        if (VERBOSE && (step < 5 || step % 20 === 0 || nextTop === maxTop)) {
          logVerbose(
            `scroll step=${step} top=${nextTop.toFixed(0)}/${maxTop.toFixed(
              0
            )} maxObservedIndex=${maxObservedIndex}`
          );
        }
      }
    });
    expect(maxObservedIndex).toBeGreaterThanOrEqual(4000);
  });
});
