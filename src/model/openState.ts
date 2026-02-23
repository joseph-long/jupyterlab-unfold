import { Contents } from '@jupyterlab/services';

export type OpenStateMap = Record<string, boolean>;

export function normalizePath(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }
  return path.replace(/^\//, '');
}

export function buildExpandedPaths(
  openState: OpenStateMap,
  rootPath: string,
  pathToUpdate?: string
): string[] {
  const expanded = new Set<string>();
  expanded.add(rootPath);

  Object.entries(openState).forEach(([openPath, isOpen]) => {
    if (isOpen) {
      expanded.add(openPath);
    }
  });

  const normalizedUpdatePath = normalizePath(pathToUpdate);
  if (normalizedUpdatePath) {
    const parts = normalizedUpdatePath.split('/');
    let partialPath = '';
    parts.forEach(part => {
      partialPath = partialPath ? `${partialPath}/${part}` : part;
      expanded.add(partialPath);
    });
  }

  return Array.from(expanded).filter(Boolean);
}

export function reconcileOpenStateFromItems(
  openState: OpenStateMap,
  items: Contents.IModel[],
  expandedPaths: string[],
  rootPath: string
): number {
  const openStateStart = performance.now();
  const expandedPathSet = new Set(expandedPaths);

  openState[rootPath] = true;
  for (const entry of items) {
    if (entry.type === 'directory' && !expandedPathSet.has(entry.path)) {
      openState[entry.path] = false;
    }
  }

  return performance.now() - openStateStart;
}

export function shouldDirectoryBeOpen(
  openState: OpenStateMap,
  entryPath: string,
  pathToUpdate?: string
): boolean {
  return (
    !!(pathToUpdate && pathToUpdate.startsWith('/' + entryPath)) ||
    !!openState[entryPath]
  );
}
