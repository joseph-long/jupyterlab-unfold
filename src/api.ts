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
}

export async function fetchTreeListing(
  request: ITreeListingRequest
): Promise<Contents.IModel[]> {
  const url = URLExt.join(
    request.serverSettings.baseUrl,
    'jupyterlab-unfold',
    'tree'
  );
  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify({
      path: request.basePath,
      open_paths: request.openPaths,
      update_path: request.updatePath ?? ''
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

  const data = (await response.json()) as ITreeListingResponse;
  return data.items;
}
