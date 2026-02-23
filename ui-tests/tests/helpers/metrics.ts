export function parseNumberHeader(
  headers: Record<string, string>,
  key: string
): number | null {
  const raw = headers[key];
  if (raw === undefined) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
