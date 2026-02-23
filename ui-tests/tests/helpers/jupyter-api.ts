import { type Page } from '@playwright/test';
import { buildContentsApiUrl } from './urls';

export interface IWorkspaceDocument {
  data: Record<string, unknown>;
  metadata: { id: string };
}

export async function installWorkspaceRouteMock(
  page: Page,
  initialState?: IWorkspaceDocument
): Promise<void> {
  let workspace: IWorkspaceDocument =
    initialState ?? { data: {}, metadata: { id: 'default' } };

  await page.route(/.*\/api\/workspaces.*/, (route, request) => {
    if (request.method() === 'GET') {
      route.fulfill({
        status: 200,
        body: JSON.stringify(workspace)
      });
      return;
    }

    if (request.method() === 'PUT') {
      workspace = request.postDataJSON() as IWorkspaceDocument;
      route.fulfill({ status: 204 });
      return;
    }

    route.continue();
  });
}

export async function putDirectory(
  page: Page,
  targetUrl: string,
  contentPath: string
): Promise<void> {
  const response = await page.request.put(buildContentsApiUrl(targetUrl, contentPath), {
    data: { type: 'directory' }
  });
  if (response.status() !== 201 && response.status() !== 200) {
    throw new Error(
      `Failed to create directory ${contentPath}: HTTP ${response.status()}`
    );
  }
}

export async function putFile(
  page: Page,
  targetUrl: string,
  contentPath: string,
  content: string
): Promise<void> {
  const response = await page.request.put(buildContentsApiUrl(targetUrl, contentPath), {
    data: { type: 'file', format: 'text', content }
  });
  if (response.status() !== 201 && response.status() !== 200) {
    throw new Error(`Failed to create file ${contentPath}: HTTP ${response.status()}`);
  }
}

export async function deletePath(
  page: Page,
  targetUrl: string,
  contentPath: string
): Promise<void> {
  const response = await page.request.delete(
    buildContentsApiUrl(targetUrl, contentPath)
  );
  if (response.status() !== 204 && response.status() !== 404) {
    throw new Error(`Failed to delete ${contentPath}: HTTP ${response.status()}`);
  }
}

export async function pathExists(
  page: Page,
  targetUrl: string,
  contentPath: string
): Promise<boolean> {
  const response = await page.request.get(buildContentsApiUrl(targetUrl, contentPath));
  return response.status() === 200;
}
