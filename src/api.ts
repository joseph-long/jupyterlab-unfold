import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { Contents } from '@jupyterlab/services';

export interface ITreeListingRequest {
  basePath: string;
  openPaths: string[];
  updatePath?: string;
  serverSettings: ServerConnection.ISettings;
}

interface ITreeListingResponse {
  items: Contents.IModel[];
  timings?: {
    tree_ms?: number;
    listed_dirs?: number;
    item_count?: number;
  };
}

export interface ITreeListingDiagnostics {
  requestId: number;
  requestMs: number;
  jsonMs: number;
  totalMs: number;
  serverTreeMs: number | null;
  serverEncodeMs: number | null;
  serverTotalMs: number | null;
  serverItemCount: number | null;
  serverListedDirs: number | null;
}

export interface ITreeListingResult {
  items: Contents.IModel[];
  diagnostics: ITreeListingDiagnostics;
}

let requestCounter = 0;

function parseNumberHeader(
  headers: Headers,
  key: string,
  fallback: number | undefined
): number | null {
  const raw = headers.get(key);
  if (raw !== null) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (fallback !== undefined && Number.isFinite(fallback)) {
    return fallback;
  }

  return null;
}

export async function fetchTreeListing(
  request: ITreeListingRequest
): Promise<ITreeListingResult> {
  const requestId = ++requestCounter;
  const url = URLExt.join(
    request.serverSettings.baseUrl,
    'jupyterlab-unfold',
    'tree'
  );
  const startTime = performance.now();
  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify({
      path: request.basePath,
      open_paths: request.openPaths,
      update_path: request.updatePath ?? '',
      client_request_id: requestId
    })
  };

  const response = await ServerConnection.makeRequest(
    url,
    init,
    request.serverSettings
  );

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response);
  }
  const requestEndTime = performance.now();

  const data = (await response.json()) as ITreeListingResponse;
  const jsonEndTime = performance.now();

  return {
    items: data.items,
    diagnostics: {
      requestId,
      requestMs: requestEndTime - startTime,
      jsonMs: jsonEndTime - requestEndTime,
      totalMs: jsonEndTime - startTime,
      serverTreeMs: parseNumberHeader(
        response.headers,
        'x-jupyterlab-unfold-tree-ms',
        data.timings?.tree_ms
      ),
      serverEncodeMs: parseNumberHeader(
        response.headers,
        'x-jupyterlab-unfold-encode-ms',
        undefined
      ),
      serverTotalMs: parseNumberHeader(
        response.headers,
        'x-jupyterlab-unfold-total-ms',
        undefined
      ),
      serverItemCount: parseNumberHeader(
        response.headers,
        'x-jupyterlab-unfold-item-count',
        data.timings?.item_count
      ),
      serverListedDirs: parseNumberHeader(
        response.headers,
        'x-jupyterlab-unfold-listed-dirs',
        data.timings?.listed_dirs
      )
    }
  };
}
