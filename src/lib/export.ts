// Client-side export: builds the 6 pack files from the currently loaded docs
// (drafts already merged in static mode), recomputes the manifest, downloads
// individual files or one zip.
import { zipSync, strToU8 } from 'fflate';
import type { AllDocs } from './store';
import { refreshManifest } from './manifest';

function stringify(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

// bumpPatch: pass true when the files are being *published* as a new data
// revision (PR flows) — plain zip/file downloads keep the current version.
export function buildFiles(docs: AllDocs, opts: { bumpPatch?: boolean } = {}): Record<string, string> {
  const manifest = refreshManifest(docs.manifest, docs, opts);
  return {
    'merchant_aliases.json': stringify(docs.merchants),
    'mcc_categories.json': stringify(docs.mcc),
    'category_rules.json': stringify(docs.rules),
    'descriptor_noise_terms.json': stringify(docs.noise),
    'sample_test_descriptors.json': stringify(docs.tests),
    'manifest.json': stringify(manifest),
  };
}

function download(name: string, data: Uint8Array | string, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadFile(docs: AllDocs, name: string): void {
  const files = buildFiles(docs);
  download(name, files[name], 'application/json');
}

export function downloadZip(docs: AllDocs): void {
  const files = buildFiles(docs);
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content);
  const zipped = zipSync(entries, { level: 6 });
  const stamp = new Date().toISOString().slice(0, 10);
  download(`transaction-enrichment-pack-${stamp}.zip`, zipped, 'application/zip');
}
