// Local-mode git/gh helpers for the "Publish data" flow.
// Uses the developer's own git identity and authenticated gh CLI — no tokens
// are stored or shipped anywhere.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrBodyFromSummary } from '../publish';

const CWD = process.cwd();

export function run(cmd: string, args: string[], cwd = CWD): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function dataChangedVsOrigin(): boolean {
  run('git', ['fetch', 'origin', 'main']);
  try {
    run('git', ['diff', '--quiet', 'origin/main', '--', 'data/']);
    return false;
  } catch {
    return true;
  }
}

export interface DataSummary {
  added: string[];
  updated: string[];
  deleted: string[];
  countDeltas: string[];
}

interface MerchantLite { id: string; [k: string]: unknown }

export function summarizeDataChanges(
  diskMerchants: MerchantLite[],
  diskCounts: Record<string, number>,
): DataSummary {
  const baseDoc = JSON.parse(run('git', ['show', 'origin/main:data/merchant_aliases.json']));
  const baseManifest = JSON.parse(run('git', ['show', 'origin/main:data/manifest.json']));
  const base = new Map<string, string>(
    baseDoc.merchants.map((m: MerchantLite) => [m.id, JSON.stringify(m)]),
  );
  const disk = new Map<string, string>(diskMerchants.map((m) => [m.id, JSON.stringify(m)]));

  const added = [...disk.keys()].filter((id) => !base.has(id));
  const deleted = [...base.keys()].filter((id) => !disk.has(id));
  const updated = [...disk.keys()].filter((id) => base.has(id) && base.get(id) !== disk.get(id));

  const countDeltas: string[] = [];
  for (const [k, v] of Object.entries(diskCounts)) {
    const prev = baseManifest.fileCounts?.[k];
    if (prev !== v) countDeltas.push(`${k}: ${prev ?? 0} → ${v}`);
  }
  return { added, updated, deleted, countDeltas };
}

export function buildPrBody(s: DataSummary): string {
  return buildPrBodyFromSummary({ ...s, via: 'Merchant Studio **⇪ Publish data** button (local mode)' });
}

export function createDataPr(title: string, body: string): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const branch = `data-update-${stamp}`;
  const scratch = mkdtempSync(join(tmpdir(), 'ms-pr-'));
  const wt = join(scratch, 'wt');
  try {
    run('git', ['worktree', 'add', wt, '-b', branch, 'origin/main']);
    cpSync(join(CWD, 'data'), join(wt, 'data'), { recursive: true });
    run('git', ['add', 'data'], wt);
    run('git', ['commit', '-m', title], wt);
    run('git', ['push', '-u', 'origin', branch], wt);
    return run('gh', ['pr', 'create', '--title', title, '--body', body, '--head', branch, '--base', 'main'], wt);
  } finally {
    try { run('git', ['worktree', 'remove', '--force', wt]); } catch { /* already gone */ }
    try { run('git', ['branch', '-D', branch]); } catch { /* keep remote branch; local copy only */ }
    rmSync(scratch, { recursive: true, force: true });
  }
}
