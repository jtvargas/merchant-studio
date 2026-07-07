// Server-side (local mode only) file access for the canonical data/ folder.
import { readFileSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MerchantsDoc, MccDoc, RulesDoc, NoiseDoc, TestsDoc, Manifest } from '../schema';
import { recomputeCounts } from '../manifest';

const DATA_DIR = join(process.cwd(), 'data');

export function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T;
}

export function writeJson(name: string, doc: unknown): void {
  writeFileSync(join(DATA_DIR, name), JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

// After any write, keep manifest counts truthful (and the public/data copy fresh
// so static fetches in the same dev session don't go stale).
export function refreshManifestFile(): void {
  const docs = {
    merchants: readJson<MerchantsDoc>('merchant_aliases.json'),
    mcc: readJson<MccDoc>('mcc_categories.json'),
    rules: readJson<RulesDoc>('category_rules.json'),
    noise: readJson<NoiseDoc>('descriptor_noise_terms.json'),
    tests: readJson<TestsDoc>('sample_test_descriptors.json'),
  };
  const manifest = readJson<Manifest>('manifest.json');
  manifest.fileCounts = recomputeCounts(docs);
  manifest.generatedAt = new Date().toISOString().slice(0, 10);
  writeJson('manifest.json', manifest);
  syncPublic();
}

export function syncPublic(): void {
  try {
    mkdirSync(join(process.cwd(), 'public', 'data'), { recursive: true });
    cpSync(DATA_DIR, join(process.cwd(), 'public', 'data'), { recursive: true });
  } catch { /* best effort */ }
}
