import { test, expect } from '@playwright/test';
import {
  cleanupIsolatedFixtureRoot,
  createIsolatedFixtureRoot,
  prefixPath
} from './helpers/fixture';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:10888';
const TREE_LOCATOR = '.jp-DirListing-content';

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

let fixtureRoot = '';

test.describe.serial('jupyterlab-unfold', () => {
  test.beforeEach(() => {
    fixtureRoot = createIsolatedFixtureRoot();
  });

  test.afterEach(() => {
    cleanupIsolatedFixtureRoot(fixtureRoot);
  });

  test('should unfold', async ({ page }) => {
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

    await page.hover(pathItem(fixtureRoot));
    await page.click(pathItem(fixtureRoot));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir1')));
    await expect(page.locator(TREE_LOCATOR)).toContainText('dir1');

    await page.click(pathItem(prefixPath(fixtureRoot, 'dir1')));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir2')));
    await expect(page.locator(pathItem(prefixPath(fixtureRoot, 'dir2')))).toBeVisible();

    await page.click(pathItem(prefixPath(fixtureRoot, 'dir2')));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')));
    await expect(
      page.locator(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')))
    ).toBeVisible();

    await page.click(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')));
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
    await page.click(pathItem(fixtureRoot));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir2')), {
      state: 'visible'
    });
    await page.click(pathItem(prefixPath(fixtureRoot, 'dir2')));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')), {
      state: 'visible'
    });
    await page.click(pathItem(prefixPath(fixtureRoot, 'dir2/dir3')));
    await page.waitForSelector(pathItem(prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')), {
      state: 'visible'
    });

    await page.dblclick(pathItem(prefixPath(fixtureRoot, 'dir2/dir3/file211.txt')));
    await page.waitForSelector('[role="main"] >> text=file211.txt');
    await expect(page.locator('.lm-DockPanel-tabBar')).toContainText('file211.txt');
  });
});
