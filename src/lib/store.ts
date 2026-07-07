// Data access layer with two backends:
//  - Local mode (npm run dev): API routes write straight to data/*.json
//  - Pages mode (static hosting): JSON fetched as assets; edits are localStorage
//    drafts merged on read; Export downloads the merged files.
import type {
  Merchant, MerchantsDoc, MccDoc, RulesDoc, NoiseDoc, TestsDoc, TestDescriptor, Manifest,
} from './schema';
import { orderMerchant } from './schema';

export type Mode = 'local' | 'static';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const withBase = (p: string) => `${BASE}${p}`;

const DRAFT_KEY = 'merchant-studio.drafts.v1';

export interface Drafts {
  // id -> merchant (added/updated) or null (deleted)
  merchants: Record<string, Merchant | null>;
  // full replacement set for sample_test_descriptors.json, or null if untouched
  testsReplace: TestDescriptor[] | null;
}

export function loadDrafts(): Drafts {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw) as Drafts;
  } catch { /* corrupted -> reset */ }
  return { merchants: {}, testsReplace: null };
}

export function saveDrafts(d: Drafts): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
}

export function draftCount(d: Drafts = loadDrafts()): number {
  return Object.keys(d.merchants).length + (d.testsReplace ? 1 : 0);
}

export function clearDrafts(): void {
  localStorage.removeItem(DRAFT_KEY);
}

let modePromise: Promise<Mode> | null = null;
export function detectMode(): Promise<Mode> {
  if (!modePromise) {
    modePromise = fetch(withBase('/api/health'))
      .then((r) => (r.ok ? 'local' : 'static') as Mode)
      .catch(() => 'static' as Mode);
  }
  return modePromise;
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(withBase(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export interface AllDocs {
  merchants: MerchantsDoc; mcc: MccDoc; rules: RulesDoc; noise: NoiseDoc; tests: TestsDoc; manifest: Manifest;
}

function applyDrafts(docs: AllDocs, drafts: Drafts): AllDocs {
  const merchants = docs.merchants.merchants
    .filter((m) => drafts.merchants[m.id] !== null)
    .map((m) => drafts.merchants[m.id] ?? m);
  const newOnes = Object.entries(drafts.merchants)
    .filter(([id, v]) => v !== null && !docs.merchants.merchants.some((m) => m.id === id))
    .map(([, v]) => v as Merchant);
  const descriptors = drafts.testsReplace ?? docs.tests.descriptors;
  return {
    ...docs,
    merchants: { ...docs.merchants, merchants: [...merchants, ...newOnes.map(orderMerchant)] },
    tests: { ...docs.tests, descriptors },
  };
}

// Loads everything, with drafts merged in static mode.
export async function loadAll(): Promise<{ mode: Mode; docs: AllDocs; drafts: Drafts }> {
  const mode = await detectMode();
  const [merchants, mcc, rules, noise, tests, manifest] = await Promise.all([
    mode === 'local'
      ? fetchJson<MerchantsDoc>('/api/merchants')
      : fetchJson<MerchantsDoc>('/data/merchant_aliases.json'),
    fetchJson<MccDoc>('/data/mcc_categories.json'),
    fetchJson<RulesDoc>('/data/category_rules.json'),
    fetchJson<NoiseDoc>('/data/descriptor_noise_terms.json'),
    mode === 'local'
      ? fetchJson<TestsDoc>('/api/testdescriptors')
      : fetchJson<TestsDoc>('/data/sample_test_descriptors.json'),
    fetchJson<Manifest>('/data/manifest.json'),
  ]);
  let docs: AllDocs = { merchants, mcc, rules, noise, tests, manifest };
  const drafts = loadDrafts();
  if (mode === 'static') docs = applyDrafts(docs, drafts);
  return { mode, docs, drafts };
}

async function api(path: string, method: string, body?: unknown): Promise<void> {
  const r = await fetch(withBase(path), {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`${method} ${path} failed (${r.status}): ${detail.slice(0, 300)}`);
  }
}

export async function saveMerchant(entry: Merchant, isNew: boolean, originalId?: string): Promise<Mode> {
  const mode = await detectMode();
  const ordered = orderMerchant(entry);
  if (mode === 'local') {
    if (isNew) await api('/api/merchants', 'POST', ordered);
    else await api(`/api/merchants/${originalId ?? entry.id}`, 'PUT', ordered);
  } else {
    const d = loadDrafts();
    if (!isNew && originalId && originalId !== entry.id) d.merchants[originalId] = null;
    d.merchants[entry.id] = ordered;
    saveDrafts(d);
  }
  return mode;
}

export async function deleteMerchant(id: string): Promise<Mode> {
  const mode = await detectMode();
  if (mode === 'local') await api(`/api/merchants/${id}`, 'DELETE');
  else {
    const d = loadDrafts();
    d.merchants[id] = null;
    saveDrafts(d);
  }
  return mode;
}

export async function saveTests(descriptors: TestDescriptor[]): Promise<Mode> {
  const mode = await detectMode();
  if (mode === 'local') {
    await api('/api/testdescriptors', 'PUT', { descriptors });
  } else {
    const d = loadDrafts();
    d.testsReplace = descriptors;
    saveDrafts(d);
  }
  return mode;
}
