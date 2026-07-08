// Copy canonical data/ into public/data/ so the static (GitHub Pages) build can
// fetch the JSON as assets, and generate public/data/index.json — the discovery
// document external apps use to find and change-detect every data file.
// public/data is gitignored; data/ is the source of truth.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Canonical public home of the dataset — mirrors `site` + Pages base in
// astro.config.mjs. Emitted verbatim in every build (local ones too) so the
// index is deterministic; same-origin consumers should resolve `path` against
// the index's own URL instead.
const DATA_URL = 'https://jtvargas.github.io/merchant-studio/data/';

// Order mirrors DATA_FILES in src/lib/schema.ts; countKeys slice manifest.fileCounts.
const FILE_META = {
  'merchant_aliases.json': {
    description:
      'Merchant entries: ids, names, category/subcategory, aliases (lowercase, unaccented, as seen on statements), negative aliases, MCC + country hints, confidence',
    countKeys: ['merchants'],
  },
  'mcc_categories.json': {
    description: 'MCC → category mapping, the 28-category taxonomy, and EN/ES/PT category keywords',
    countKeys: ['mccCodes'],
  },
  'category_rules.json': {
    description:
      'Priority-ordered categorization rules: brand disambiguation, payment rails, installment tags, processor prefixes, keyword fallbacks',
    countKeys: ['categoryRules'],
  },
  'descriptor_noise_terms.json': {
    description:
      'Descriptor-cleaning config: noise words/phrases (EN/ES/PT), preserve list, processor tokens, regex patterns',
    countKeys: ['noiseExactWords', 'noisePhrases', 'regexPatterns'],
  },
  'sample_test_descriptors.json': {
    description: 'Labeled raw descriptors with the expected merchant/category (the recognition benchmark)',
    countKeys: ['testDescriptors'],
  },
  'manifest.json': {
    description: 'Pack manifest: schema version, per-entity counts, supported regions',
    countKeys: [],
  },
};

mkdirSync(`${root}public/data`, { recursive: true });
cpSync(`${root}data`, `${root}public/data`, { recursive: true });

const manifest = JSON.parse(readFileSync(`${root}data/manifest.json`, 'utf8'));

// Monotonic data revision derived from git history (count of commits touching
// data/). A safety net for consumers: it advances on EVERY merged data change,
// even if a hand-edited PR forgot to bump manifest.schemaVersion. Needs full
// history — deploy.yml checks out with fetch-depth: 0. Null when git or
// history is unavailable (e.g. tarball builds).
let dataRevision = null;
try {
  const count = execFileSync('git', ['rev-list', '--count', 'HEAD', '--', 'data'], {
    cwd: root, encoding: 'utf8',
  }).trim();
  const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: root, encoding: 'utf8',
  }).trim();
  if (shallow !== 'true' && /^\d+$/.test(count)) dataRevision = Number(count);
} catch { /* not a git checkout — leave null */ }
const files = Object.entries(FILE_META).map(([name, meta]) => {
  const buf = readFileSync(`${root}data/${name}`);
  return {
    name,
    path: name, // relative to index.json's own location — resolves on any host
    url: DATA_URL + name,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    description: meta.description,
    counts: meta.countKeys.length
      ? Object.fromEntries(meta.countKeys.map((k) => [k, manifest.fileCounts[k]]))
      : null,
  };
});

const index = {
  name: 'transaction-enrichment-pack',
  indexVersion: 1,
  schemaVersion: manifest.schemaVersion,
  dataRevision,
  version: dataRevision === null ? manifest.schemaVersion : `${manifest.schemaVersion}+r${dataRevision}`,
  generatedAt: new Date().toISOString(),
  baseUrl: DATA_URL,
  // Single "did anything change?" signal: sha256 of the per-file hashes in order.
  // generatedAt churns every build, so hashes are the authoritative change signal.
  packHash: createHash('sha256').update(files.map((f) => f.sha256).join('')).digest('hex'),
  files,
};
writeFileSync(`${root}public/data/index.json`, JSON.stringify(index, null, 2) + '\n');
console.log(`synced data/ -> public/data/ + index.json (${files.length} files, ${index.version}, pack ${index.packHash.slice(0, 12)})`);
