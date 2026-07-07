// Shared types + constants for the transaction enrichment pack (schema 1.1.0)

export interface Merchant {
  id: string;
  canonicalName: string;
  displayName: string;
  category: string;
  subcategory: string;
  mccHints: string[];
  website: string | null;
  iconSlug: string | null;
  countryHints: string[];
  aliases: string[];
  negativeAliases: string[];
  defaultConfidence: number;
  notes: string | null;
}

export interface MerchantsDoc {
  schemaVersion: string;
  generatedAt: string;
  name: string;
  description: string;
  matchingGuidance: Record<string, unknown>;
  merchants: Merchant[];
}

export interface MccEntry {
  code: string;
  description: string;
  category: string;
  subcategory: string;
  group: string;
  defaultDirection: string;
  keywords: string[];
}

export interface MccDoc {
  schemaVersion: string;
  generatedAt: string;
  name: string;
  description: string;
  categoryTaxonomy: { id: string; displayName: string }[];
  mcc: Record<string, MccEntry>;
}

export interface RuleMatch {
  containsAny?: string[];
  containsAll?: string[];
  notContainsAny?: string[];
  regexAny?: string[];
  amountSign?: string;
}

export interface Rule {
  id: string;
  priority: number;
  name: string;
  match: RuleMatch;
  result: {
    merchantId?: string;
    displayName?: string;
    category?: string;
    subcategory?: string;
    processor?: string;
    tags?: string[];
  };
  confidence: number;
  notes: string | null;
}

export interface RulesDoc {
  schemaVersion: string;
  generatedAt: string;
  name: string;
  description: string;
  evaluationGuidance: Record<string, unknown>;
  rules: Rule[];
}

export interface RegexPattern {
  id: string;
  description: string;
  pattern: string;
  replacement: string;
}

export interface NoiseDoc {
  schemaVersion: string;
  preserveTerms: string[];
  removeWordsExact: string[];
  removePhrases: string[];
  processorTokens: string[];
  cardNetworkTokens: string[];
  paymentRailTokens: string[];
  channelTokens: string[];
  locationSuffixTokens: Record<string, string[]>;
  regexPatterns: RegexPattern[];
  cleaningGuidance: Record<string, unknown>;
  [k: string]: unknown;
}

export interface TestDescriptor {
  rawDescription: string;
  region: string;
  expected: { merchantId: string | null; category: string | null };
}

export interface TestsDoc {
  schemaVersion: string;
  generatedAt: string;
  name: string;
  description: string;
  descriptors: TestDescriptor[];
}

export interface Manifest {
  schemaVersion: string;
  generatedAt: string;
  fileCounts: Record<string, number>;
  files: string[];
  supportedRegions: string[];
  recommendedSwiftModelNames: string[];
}

export const DATA_FILES = [
  'merchant_aliases.json',
  'mcc_categories.json',
  'category_rules.json',
  'descriptor_noise_terms.json',
  'sample_test_descriptors.json',
  'manifest.json',
] as const;

export const COUNTRY_HINTS = ['US', 'DO', 'MX', 'BR', 'ES', 'LATAM'] as const;

export const REGIONS = ['US', 'FL', 'CA', 'DO', 'MX', 'BR', 'ES'] as const;

// Categories that rules may emit beyond the base taxonomy (documented in pack README)
export const RULE_ONLY_CATEGORIES = ['income', 'fees_charges', 'refunds'];

// Bare aliases that are dictionary words in EN/ES/PT — dangerous for contains matching
export const RISKY_GENERIC_WORDS = [
  'dia', 'oi', 'gol', 'azul', 'caixa', 'light', 'extra', 'lucky', 'lime',
  'bolt', 'orange', 'total', 'stone', 'rede', 'banca', 'pase', 'clip',
  'viva', 'ring', 'current', 'dave', 'ole', 'sat', 'ademi', 'vista',
  'academia', 'max', 'sears', 'giant', 'mango', 'affirm', 'discover',
  'carnival', 'pilot', 'academy',
];

// Canonical field order for merchant entries — keeps git diffs stable
export const MERCHANT_FIELD_ORDER: (keyof Merchant)[] = [
  'id', 'canonicalName', 'displayName', 'category', 'subcategory', 'mccHints',
  'website', 'iconSlug', 'countryHints', 'aliases', 'negativeAliases',
  'defaultConfidence', 'notes',
];

export function orderMerchant(m: Merchant): Merchant {
  const out = {} as Record<string, unknown>;
  for (const k of MERCHANT_FIELD_ORDER) out[k] = m[k] ?? null;
  return out as unknown as Merchant;
}

export function unaccent(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeAlias(s: string): string {
  return unaccent(s).toLowerCase().replace(/\s+/g, ' ').trim();
}
