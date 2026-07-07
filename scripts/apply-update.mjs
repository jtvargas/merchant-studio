#!/usr/bin/env node
// Apply a data-update payload (from a "Suggest a data update" issue or any
// hand-written delta) to data/*.json. Manual maintainer tool — intentionally
// NOT wired to any CI/workflow.
//
// Usage: node scripts/apply-update.mjs payload.json
//
// Payload shape:
// {
//   "merchants": [ <full merchant entries to add or update> ],
//   "deleteMerchants": [ "merchant_id", ... ],
//   "replaceTests": false,
//   "testDescriptors": [ <descriptors to append (or full set when replaceTests)> ]
// }
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');

const COUNTRY = new Set(['US', 'DO', 'MX', 'BR', 'ES', 'LATAM']);
const FIELD_ORDER = [
  'id', 'canonicalName', 'displayName', 'category', 'subcategory', 'mccHints',
  'website', 'iconSlug', 'countryHints', 'aliases', 'negativeAliases',
  'defaultConfidence', 'notes',
];

const readJson = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8'));
const writeJson = (name, doc) => writeFileSync(join(DATA, name), JSON.stringify(doc, null, 2) + '\n');
const unaccent = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const normAlias = (s) => unaccent(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();

function fail(errors) {
  console.error('INVALID PAYLOAD:');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error('usage: node scripts/apply-update.mjs payload.json');
  process.exit(1);
}
const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));

const merchantsDoc = readJson('merchant_aliases.json');
const mccDoc = readJson('mcc_categories.json');
const rulesDoc = readJson('category_rules.json');
const noiseDoc = readJson('descriptor_noise_terms.json');
const testsDoc = readJson('sample_test_descriptors.json');
const manifest = readJson('manifest.json');

const taxonomy = new Set(mccDoc.categoryTaxonomy.map((t) => t.id));
const mccCodes = new Set(Object.keys(mccDoc.mcc));

const upserts = Array.isArray(payload.merchants) ? payload.merchants : [];
const deletions = Array.isArray(payload.deleteMerchants) ? payload.deleteMerchants.map(String) : [];

const errors = [];
const existingById = new Map(merchantsDoc.merchants.map((m) => [m.id, m]));

// alias ownership excluding entries being replaced/deleted
const replacedIds = new Set([...upserts.map((m) => m?.id), ...deletions]);
const aliasOwner = new Map();
for (const m of merchantsDoc.merchants) {
  if (replacedIds.has(m.id)) continue;
  for (const a of m.aliases) if (!aliasOwner.has(a)) aliasOwner.set(a, m.id);
}

const normalized = [];
const seenIds = new Set();
for (const raw of upserts) {
  const id = String(raw?.id ?? '');
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(id)) { errors.push(`merchant id "${id}" is not snake_case`); continue; }
  if (seenIds.has(id)) { errors.push(`duplicate merchant id "${id}" in payload`); continue; }
  seenIds.add(id);
  const m = {
    id,
    canonicalName: String(raw.canonicalName ?? '').trim(),
    displayName: String(raw.displayName ?? raw.canonicalName ?? '').trim(),
    category: String(raw.category ?? ''),
    subcategory: String(raw.subcategory ?? ''),
    mccHints: (raw.mccHints ?? []).map(String),
    website: raw.website ? String(raw.website) : null,
    iconSlug: raw.iconSlug ? String(raw.iconSlug) : null,
    countryHints: (raw.countryHints ?? []).map((c) => String(c).toUpperCase()),
    aliases: [...new Set((raw.aliases ?? []).map(normAlias).filter(Boolean))],
    negativeAliases: [...new Set((raw.negativeAliases ?? []).map(normAlias).filter(Boolean))],
    defaultConfidence: Math.min(0.99, Math.max(0.5, Number(raw.defaultConfidence) || 0.92)),
    notes: raw.notes ? String(raw.notes) : null,
  };
  if (!m.canonicalName) errors.push(`${id}: canonicalName is required`);
  if (!taxonomy.has(m.category)) errors.push(`${id}: invalid category "${m.category}"`);
  if (!m.aliases.length) errors.push(`${id}: at least one alias is required`);
  for (const h of m.mccHints) if (!mccCodes.has(h)) errors.push(`${id}: unknown MCC hint ${h}`);
  for (const c of m.countryHints) if (!COUNTRY.has(c)) errors.push(`${id}: invalid country hint ${c}`);
  for (const a of m.aliases) {
    const owner = aliasOwner.get(a);
    if (owner) errors.push(`${id}: alias "${a}" already belongs to "${owner}"`);
  }
  for (const a of m.aliases) aliasOwner.set(a, id);
  const ordered = {};
  for (const k of FIELD_ORDER) ordered[k] = m[k] ?? null;
  normalized.push(ordered);
}

for (const id of deletions) {
  if (!existingById.has(id)) errors.push(`deleteMerchants: unknown merchant "${id}"`);
}

let newTests = testsDoc.descriptors;
if (payload.replaceTests && Array.isArray(payload.testDescriptors)) {
  newTests = payload.testDescriptors;
} else if (Array.isArray(payload.testDescriptors)) {
  const seen = new Set(testsDoc.descriptors.map((t) => t.rawDescription));
  newTests = [...testsDoc.descriptors, ...payload.testDescriptors.filter((t) => t?.rawDescription && !seen.has(t.rawDescription))];
}
for (const t of newTests) {
  if (!t?.rawDescription || !t?.expected) errors.push(`test descriptor missing rawDescription/expected: ${JSON.stringify(t).slice(0, 60)}`);
  if (t?.expected?.merchantId && !existingById.has(t.expected.merchantId) && !seenIds.has(t.expected.merchantId)) {
    errors.push(`test "${String(t.rawDescription).slice(0, 40)}" expects unknown merchantId "${t.expected.merchantId}"`);
  }
}

if (errors.length) fail(errors);
if (!normalized.length && !deletions.length && newTests === testsDoc.descriptors) fail(['payload contains no changes']);

// apply
const added = [];
const updated = [];
merchantsDoc.merchants = merchantsDoc.merchants.filter((m) => !deletions.includes(m.id));
for (const m of normalized) {
  const idx = merchantsDoc.merchants.findIndex((x) => x.id === m.id);
  if (idx === -1) { merchantsDoc.merchants.push(m); added.push(m.id); }
  else { merchantsDoc.merchants[idx] = m; updated.push(m.id); }
}
testsDoc.descriptors = newTests;

manifest.fileCounts = {
  merchants: merchantsDoc.merchants.length,
  mccCodes: Object.keys(mccDoc.mcc).length,
  categoryRules: rulesDoc.rules.length,
  noiseExactWords: noiseDoc.removeWordsExact.length,
  noisePhrases: noiseDoc.removePhrases.length,
  regexPatterns: noiseDoc.regexPatterns.length,
  testDescriptors: testsDoc.descriptors.length,
};
manifest.generatedAt = new Date().toISOString().slice(0, 10);

writeJson('merchant_aliases.json', merchantsDoc);
writeJson('sample_test_descriptors.json', testsDoc);
writeJson('manifest.json', manifest);

console.log('## Data update applied');
if (added.length) console.log(`### Added (${added.length})\n` + added.map((i) => `- \`${i}\``).join('\n'));
if (updated.length) console.log(`### Updated (${updated.length})\n` + updated.map((i) => `- \`${i}\``).join('\n'));
if (deletions.length) console.log(`### Deleted (${deletions.length})\n` + deletions.map((i) => `- \`${i}\``).join('\n'));
console.log(`\nmerchants: ${manifest.fileCounts.merchants} · testDescriptors: ${manifest.fileCounts.testDescriptors}`);
console.log('\nNow review the diff and publish it (git commit or the Publish button in npm run dev).');
