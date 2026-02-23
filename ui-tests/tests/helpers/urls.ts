export function normalizeLabUrl(rawTarget: string): URL {
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

export function buildLabUrl(
  rawTarget: string,
  options?: { reset?: boolean; workspace?: string }
): string {
  const labUrl = normalizeLabUrl(rawTarget);
  if (options?.workspace) {
    labUrl.pathname = labUrl.pathname.replace(
      /\/lab\/?$/,
      `/lab/workspaces/${encodeURIComponent(options.workspace)}`
    );
  }
  if (options?.reset) {
    labUrl.searchParams.set('reset', '');
  }
  return labUrl.toString();
}

export function buildContentsApiUrl(rawTarget: string, contentPath: string): string {
  const labUrl = normalizeLabUrl(rawTarget);
  const apiUrl = new URL(labUrl.origin);
  const encodedPath = contentPath
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

export function buildTreeEndpointUrl(rawTarget: string): string {
  const labUrl = normalizeLabUrl(rawTarget);
  const basePath = labUrl.pathname.endsWith('/lab')
    ? labUrl.pathname.slice(0, -4)
    : labUrl.pathname;
  const endpoint = new URL(labUrl.origin);
  endpoint.pathname = `${basePath.replace(/\/$/, '')}/jupyterlab-unfold/tree`;
  if (labUrl.searchParams.has('token')) {
    endpoint.searchParams.set('token', labUrl.searchParams.get('token') ?? '');
  }
  return endpoint.toString();
}
