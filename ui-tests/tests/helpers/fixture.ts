import fs from 'fs';
import path from 'path';
import { createBenchmarkTreeInDirectory } from '../../scripts/benchmark-tree-common';

const SCRATCH_ROOT = path.resolve(__dirname, '..', '..', 'scratch');
const GENERATED_FIXTURE_ROOT = path.join(SCRATCH_ROOT, 'generated_fixtures');
const TEMP_PREFIX = 'unfold-e2e-';

const cleanupTargets = new Set<string>();
let cleanupHooksInstalled = false;
let prunedStaleRoots = false;

function cleanupAllSync(): void {
  for (const target of cleanupTargets) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // Best effort cleanup during shutdown.
    }
    cleanupTargets.delete(target);
  }
}

function installCleanupHooks(): void {
  if (cleanupHooksInstalled) {
    return;
  }
  cleanupHooksInstalled = true;
  process.on('exit', cleanupAllSync);
  process.on('SIGINT', () => {
    cleanupAllSync();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanupAllSync();
    process.exit(143);
  });
}

function touchFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.closeSync(fs.openSync(filePath, 'w'));
}

function ensureBaseStructureExists(): void {
  if (
    fs.existsSync(path.join(GENERATED_FIXTURE_ROOT, 'dir2', 'dir3', 'file211.txt'))
  ) {
    return;
  }

  fs.mkdirSync(GENERATED_FIXTURE_ROOT, { recursive: true });
  fs.mkdirSync(path.join(GENERATED_FIXTURE_ROOT, 'dir1'), { recursive: true });
  fs.mkdirSync(path.join(GENERATED_FIXTURE_ROOT, 'dir2', 'dir3'), {
    recursive: true
  });
  touchFile(path.join(GENERATED_FIXTURE_ROOT, 'dir2', 'dir3', 'file211.txt'));
  createBenchmarkTreeInDirectory(GENERATED_FIXTURE_ROOT);
}

function pruneStaleFixtureRoots(): void {
  if (prunedStaleRoots || !fs.existsSync(SCRATCH_ROOT)) {
    return;
  }
  prunedStaleRoots = true;
  const staleBefore = Date.now() - 10 * 60 * 1000;
  const entries = fs.readdirSync(SCRATCH_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) {
      continue;
    }
    const fullPath = path.join(SCRATCH_ROOT, entry.name);
    try {
      const stats = fs.statSync(fullPath);
      if (stats.mtimeMs < staleBefore) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore stale cleanup failures.
    }
  }
}

function copyStructureInto(targetDir: string): void {
  ensureBaseStructureExists();
  const entries = fs.readdirSync(GENERATED_FIXTURE_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(TEMP_PREFIX)) {
      continue;
    }
    const src = path.join(GENERATED_FIXTURE_ROOT, entry.name);
    const dest = path.join(targetDir, entry.name);
    fs.cpSync(src, dest, { recursive: true, force: true });
  }
}

export function prefixPath(rootPath: string, relativePath: string): string {
  return relativePath ? `${rootPath}/${relativePath}` : rootPath;
}

export function createIsolatedFixtureRoot(): string {
  installCleanupHooks();
  pruneStaleFixtureRoots();
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rootName = `${TEMP_PREFIX}${id}`;
  const rootDir = path.join(SCRATCH_ROOT, rootName);
  fs.mkdirSync(rootDir, { recursive: true });
  copyStructureInto(rootDir);
  cleanupTargets.add(rootDir);
  return rootName;
}

export function cleanupIsolatedFixtureRoot(rootName: string): void {
  const rootDir = path.join(SCRATCH_ROOT, rootName);
  cleanupTargets.delete(rootDir);
  fs.rmSync(rootDir, { recursive: true, force: true });
}
