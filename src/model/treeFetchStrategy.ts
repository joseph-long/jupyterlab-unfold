import { ServerConnection, Contents } from '@jupyterlab/services';
import {
  ITreeListingDiagnostics,
  fetchTreeListing
} from '../api';
import {
  buildExpandedPaths,
  normalizePath,
  OpenStateMap,
  reconcileOpenStateFromItems,
  shouldDirectoryBeOpen
} from './openState';

export interface ITreeFetchServerMetadata {
  normalizedUpdatePath: string | undefined;
  expandedPathsCount: number;
  openStateUpdateMs: number;
}

export interface ITreeFetchResult {
  items: Contents.IModel[];
  source: 'server' | 'contents';
  diagnostics?: ITreeListingDiagnostics;
  serverMetadata?: ITreeFetchServerMetadata;
}

export interface ITreeFetchArgs {
  path: string;
  pathToUpdate?: string;
  openState: OpenStateMap;
  serverSettings: ServerConnection.ISettings;
  getDirectoryContents: (path: string) => Promise<Contents.IModel[]>;
}

export async function fetchViaServer(
  args: ITreeFetchArgs
): Promise<ITreeFetchResult> {
  const expandedPaths = buildExpandedPaths(
    args.openState,
    args.path,
    args.pathToUpdate
  );
  const normalizedUpdatePath = normalizePath(args.pathToUpdate);
  const treeListing = await fetchTreeListing({
    basePath: args.path,
    openPaths: expandedPaths,
    updatePath: normalizedUpdatePath,
    serverSettings: args.serverSettings
  });

  const openStateUpdateMs = reconcileOpenStateFromItems(
    args.openState,
    treeListing.items,
    expandedPaths,
    args.path
  );

  return {
    items: treeListing.items,
    source: 'server',
    diagnostics: treeListing.diagnostics,
    serverMetadata: {
      normalizedUpdatePath,
      expandedPathsCount: expandedPaths.length,
      openStateUpdateMs
    }
  };
}

export async function fetchViaContents(
  args: ITreeFetchArgs
): Promise<ITreeFetchResult> {
  const items = await fetchViaContentsRecursive(
    args.path,
    args.pathToUpdate,
    args.openState,
    args.getDirectoryContents
  );
  return { items, source: 'contents' };
}

export async function fetchWithFallback(
  args: ITreeFetchArgs
): Promise<ITreeFetchResult> {
  try {
    return await fetchViaServer(args);
  } catch {
    console.warn(
      'jupyterlab-unfold server tree endpoint unavailable, using Contents API fallback'
    );
    return fetchViaContents(args);
  }
}

async function fetchViaContentsRecursive(
  path: string,
  pathToUpdate: string | undefined,
  openState: OpenStateMap,
  getDirectoryContents: (path: string) => Promise<Contents.IModel[]>
): Promise<Contents.IModel[]> {
  let items: Contents.IModel[] = [];
  const sortedContent = await getDirectoryContents(path);

  openState[path] = true;

  for (const entry of sortedContent) {
    items.push(entry);

    if (entry.type !== 'directory') {
      continue;
    }

    const isOpen = shouldDirectoryBeOpen(openState, entry.path, pathToUpdate);

    if (isOpen) {
      const subEntryContent = await fetchViaContentsRecursive(
        entry.path,
        pathToUpdate,
        openState,
        getDirectoryContents
      );

      items = items.concat(subEntryContent);
    } else {
      openState[entry.path] = false;
    }
  }

  return items;
}
