// Form-level and pack-level integrity checks (mirrors the Python merge/validate tooling)
import type { Merchant, MerchantsDoc, MccDoc, RulesDoc, NoiseDoc, TestsDoc, Manifest } from './schema';
import { isValidCountryHint, RISKY_GENERIC_WORDS, RULE_ONLY_CATEGORIES, normalizeAlias } from './schema';
import { recomputeCounts } from './manifest';

export interface FieldIssue {
  field: string;
  level: 'error' | 'warning';
  message: string;
}

export function validateMerchant(
  entry: Merchant,
  all: Merchant[],
  mccCodes: Set<string>,
  taxonomy: Set<string>,
  editingId?: string,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const others = all.filter((m) => m.id !== editingId);

  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(entry.id)) {
    issues.push({ field: 'id', level: 'error', message: 'id must be snake_case (lowercase letters/digits and underscores)' });
  }
  if (others.some((m) => m.id === entry.id)) {
    issues.push({ field: 'id', level: 'error', message: `id "${entry.id}" already exists` });
  }
  if (!entry.canonicalName.trim()) issues.push({ field: 'canonicalName', level: 'error', message: 'canonical name is required' });
  if (!entry.displayName.trim()) issues.push({ field: 'displayName', level: 'error', message: 'display name is required' });
  if (!taxonomy.has(entry.category)) {
    issues.push({ field: 'category', level: 'error', message: `category must be one of the taxonomy ids` });
  }
  if (!entry.subcategory.trim()) issues.push({ field: 'subcategory', level: 'warning', message: 'subcategory is empty' });

  for (const h of entry.mccHints) {
    if (!mccCodes.has(h)) issues.push({ field: 'mccHints', level: 'error', message: `unknown MCC code ${h}` });
  }
  if (!entry.countryHints.length) {
    issues.push({ field: 'countryHints', level: 'warning', message: 'no country hints set' });
  }
  for (const c of entry.countryHints) {
    if (!isValidCountryHint(c)) {
      issues.push({ field: 'countryHints', level: 'error', message: `invalid country hint "${c}" — use an ISO 3166-1 alpha-2 code (HK, JP, …) or LATAM/EU/APAC/GLOBAL` });
    }
  }

  if (!entry.aliases.length) {
    issues.push({ field: 'aliases', level: 'error', message: 'at least one alias is required' });
  }
  const aliasOwner = new Map<string, string>();
  for (const m of others) for (const a of m.aliases) if (!aliasOwner.has(a)) aliasOwner.set(a, m.id);
  const seen = new Set<string>();
  for (const a of entry.aliases) {
    if (a !== normalizeAlias(a)) {
      issues.push({ field: 'aliases', level: 'error', message: `alias "${a}" must be lowercase, unaccented, single-spaced` });
    }
    if (seen.has(a)) issues.push({ field: 'aliases', level: 'warning', message: `duplicate alias "${a}" in this entry` });
    seen.add(a);
    const owner = aliasOwner.get(a);
    if (owner) issues.push({ field: 'aliases', level: 'error', message: `alias "${a}" already belongs to "${owner}"` });
    if (RISKY_GENERIC_WORDS.includes(a)) {
      issues.push({ field: 'aliases', level: 'warning', message: `"${a}" is a bare generic word — prefer a phrase alias (and confidence 0.80–0.86)` });
    }
  }
  if (entry.defaultConfidence < 0.5 || entry.defaultConfidence > 0.99) {
    issues.push({ field: 'defaultConfidence', level: 'error', message: 'confidence must be between 0.50 and 0.99' });
  }

  // fuzzy duplicate-brand guard on canonical name
  const canon = normalizeAlias(entry.canonicalName);
  if (canon) {
    for (const m of others) {
      const other = normalizeAlias(m.canonicalName);
      if (other === canon || (canon.length >= 5 && (other.includes(canon) || canon.includes(other)))) {
        issues.push({ field: 'canonicalName', level: 'warning', message: `similar existing merchant: "${m.canonicalName}" (${m.id})` });
        break;
      }
    }
  }
  return issues;
}

export interface IntegrityIssue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

export function checkIntegrity(docs: {
  merchants: MerchantsDoc; mcc: MccDoc; rules: RulesDoc; noise: NoiseDoc; tests: TestsDoc; manifest: Manifest;
}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const { merchants, mcc, rules, noise, tests, manifest } = docs;
  const taxonomy = new Set(mcc.categoryTaxonomy.map((t) => t.id));
  const codes = new Set(Object.keys(mcc.mcc));

  const ids = new Set<string>();
  const aliasOwner = new Map<string, Merchant>();
  for (const m of merchants.merchants) {
    if (ids.has(m.id)) issues.push({ level: 'error', where: m.id, message: 'duplicate merchant id' });
    ids.add(m.id);
    if (!taxonomy.has(m.category)) issues.push({ level: 'error', where: m.id, message: `invalid category "${m.category}"` });
    for (const h of m.mccHints) if (!codes.has(h)) issues.push({ level: 'error', where: m.id, message: `unknown mccHint ${h}` });
    for (const a of m.aliases) {
      if (a !== normalizeAlias(a)) issues.push({ level: 'error', where: m.id, message: `alias not normalized: "${a}"` });
      const owner = aliasOwner.get(a);
      if (owner && owner.id !== m.id) {
        const negOk = (m.negativeAliases ?? []).includes(a) || (owner.negativeAliases ?? []).includes(a);
        if (!negOk) issues.push({ level: 'error', where: m.id, message: `alias "${a}" also owned by ${owner.id}` });
      } else {
        aliasOwner.set(a, m);
      }
    }
  }

  const ruleIds = new Set<string>();
  for (const r of rules.rules) {
    if (ruleIds.has(r.id)) issues.push({ level: 'error', where: r.id, message: 'duplicate rule id' });
    ruleIds.add(r.id);
    const cat = r.result.category;
    if (cat && !taxonomy.has(cat) && !RULE_ONLY_CATEGORIES.includes(cat)) {
      issues.push({ level: 'error', where: r.id, message: `invalid rule category "${cat}"` });
    }
    for (const rx of r.match.regexAny ?? []) {
      try { new RegExp(rx, 'i'); } catch (e) { issues.push({ level: 'error', where: r.id, message: `bad regex: ${rx}` }); }
    }
    if (r.result.merchantId && !ids.has(r.result.merchantId)) {
      issues.push({ level: 'warning', where: r.id, message: `rule points to unknown merchantId "${r.result.merchantId}"` });
    }
  }

  for (const p of noise.regexPatterns) {
    try { new RegExp(p.pattern, 'gi'); } catch { issues.push({ level: 'error', where: p.id, message: 'noise regex does not compile in JS' }); }
  }

  for (const t of tests.descriptors) {
    if (t.expected.merchantId && !ids.has(t.expected.merchantId)) {
      issues.push({ level: 'warning', where: t.rawDescription.slice(0, 40), message: `test expects unknown merchantId "${t.expected.merchantId}"` });
    }
  }

  const real = recomputeCounts(docs);
  for (const [k, v] of Object.entries(real)) {
    if (manifest.fileCounts[k] !== v) {
      issues.push({ level: 'warning', where: 'manifest.json', message: `fileCounts.${k}=${manifest.fileCounts[k]} but actual is ${v} (recomputed on next save/export)` });
    }
  }
  return issues;
}
