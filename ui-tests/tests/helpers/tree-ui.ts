import { type Page } from '@playwright/test';
import { itemByPath } from './selectors';

export async function isRowVisibleInContainer(
  page: Page,
  path: string,
  contentSelector = '.jp-DirListing-content'
): Promise<boolean> {
  const rowSelector = itemByPath(path);
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

export async function materializeRow(
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
    const row = page.locator(itemByPath(path)).first();
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

export async function ensureFolderExpanded(
  page: Page,
  folderPath: string,
  expectedChildPath: string,
  options?: { materializeFolder?: boolean }
): Promise<void> {
  if (options?.materializeFolder ?? true) {
    await materializeRow(page, folderPath, {
      resetToTop: true,
      maxScrollSteps: 120
    });
  }

  const child = page.locator(itemByPath(expectedChildPath)).first();
  if ((await child.count()) > 0 && (await child.isVisible().catch(() => false))) {
    return;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.click(itemByPath(folderPath));
    try {
      await child.waitFor({ state: 'visible', timeout: 8_000 });
      return;
    } catch {
      // Retry by toggling once more if virtualization delayed rendering.
    }
  }

  throw new Error(
    `Could not expand folder "${folderPath}" to show "${expectedChildPath}"`
  );
}

export async function scrollUntilPathVisible(
  page: Page,
  targetPath: string,
  options: {
    anchorPath: string;
    maxSteps?: number;
    scrollDelta?: number;
    contentClassSelector?: string;
    onProgress?: (state: {
      step: number;
      maxObservedIndex: number;
      nextTop: number;
      maxTop: number;
    }) => void;
  }
): Promise<number> {
  const maxSteps = options.maxSteps ?? 140;
  const scrollDelta = options.scrollDelta ?? 420;
  const contentClassSelector = options.contentClassSelector ?? '.jp-DirListing-content';

  const contentDataAttr = `data-unfold-scroll-target-${Math.random()
    .toString(16)
    .slice(2)}`;
  const contentSelector = `${contentClassSelector}[${contentDataAttr}="1"]`;

  const anchorRow = page.locator(itemByPath(options.anchorPath)).first();
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
      anchorSelector: itemByPath(options.anchorPath),
      contentAttr: contentDataAttr,
      contentClassSelector
    }
  );

  const listing = page.locator(contentSelector).first();
  await listing.waitFor({ state: 'visible', timeout: 30_000 });

  const cleanupContentMarker = async (): Promise<void> => {
    await page.evaluate(
      ({ selector, attrName }) => {
        const content = document.querySelector(selector) as HTMLElement | null;
        if (content) {
          content.removeAttribute(attrName);
        }
      },
      { selector: contentSelector, attrName: contentDataAttr }
    );
  };

  let maxObservedIndex = -1;
  const targetIndexMatch = targetPath.match(/item-(\d+)\.txt$/);
  const targetIndex = targetIndexMatch
    ? Number.parseInt(targetIndexMatch[1], 10)
    : null;

  try {
    await page.waitForTimeout(10);

    for (let step = 0; step < maxSteps; step += 1) {
      const candidate = page.locator(itemByPath(targetPath)).first();
      if ((await candidate.count()) > 0) {
        await page.waitForTimeout(10);
        if (await isRowVisibleInContainer(page, targetPath, contentSelector)) {
          await page.waitForTimeout(10);
          if (await isRowVisibleInContainer(page, targetPath, contentSelector)) {
            await candidate.scrollIntoViewIfNeeded();
            await page.waitForTimeout(10);
            if (await isRowVisibleInContainer(page, targetPath, contentSelector)) {
              return maxObservedIndex;
            }
          }
        }
      }

      maxObservedIndex = Math.max(
        maxObservedIndex,
        await page.evaluate(selector => {
          const rows = Array.from(document.querySelectorAll<HTMLElement>(selector));
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
        return maxObservedIndex;
      }

      const scrollState = await page.evaluate(
        ({ contentSelector, delta }) => {
          const content = document.querySelector(contentSelector) as HTMLElement | null;
          if (!content) {
            return { previousTop: 0, nextTop: 0, maxTop: 0 };
          }
          const previousTop = content.scrollTop;
          const maxTop = Math.max(0, content.scrollHeight - content.clientHeight);
          content.scrollTop = Math.min(maxTop, previousTop + delta);
          return { previousTop, nextTop: content.scrollTop, maxTop };
        },
        { delta: scrollDelta, contentSelector }
      );

      options.onProgress?.({
        step,
        maxObservedIndex,
        nextTop: scrollState.nextTop,
        maxTop: scrollState.maxTop
      });
      await page.waitForTimeout(10);
    }

    throw new Error(
      `Could not materialize "${targetPath}" after rapid scrolling; max observed index=${maxObservedIndex}`
    );
  } finally {
    await cleanupContentMarker();
  }
}
