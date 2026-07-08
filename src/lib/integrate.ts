// Builds the "implement this client in <stack>" LLM prompt for the Data API page.
// Same pattern as buildLlmPrompt in llm.ts: pure function over the loaded docs
// returning one prompt string with #-heading sections.
import type { MccDoc, Manifest } from './schema';
import { RULE_ONLY_CATEGORIES } from './schema';

export const DATA_INDEX_URL = 'https://jtvargas.github.io/merchant-studio/data/index.json';

export interface IntegrationStack {
  id: string;
  label: string;
  deliverables: string;
}

export const INTEGRATION_STACKS: IntegrationStack[] = [
  {
    id: 'swift',
    label: 'Swift / iOS',
    deliverables: `1. Codable models for all six files (nullable fields as optionals; every key inside Rule.match and Rule.result is optional).
2. An \`EnrichmentDataStore\` actor: loads a bundled seed copy on first launch, refreshes from index.json in the background, verifies sha256 with CryptoKit, atomically swaps files in Application Support, persists packHash + per-file hashes.
3. A \`TransactionEnricher\` that builds the alias/rule indexes once per dataset load (cache them) and exposes \`func enrich(_ rawDescriptor: String) -> MatchResult\`.
4. Unicode/regex details: NFKD unaccent via \`decomposedStringWithCanonicalMapping\` + strip combining marks (or \`folding(options: .diacriticInsensitive)\`); NSRegularExpression/Swift Regex with case-insensitive options.
5. An XCTest suite that runs sample_test_descriptors.json (bundle it as a fixture) and asserts the score.`,
  },
  {
    id: 'kotlin',
    label: 'Kotlin / Android',
    deliverables: `1. kotlinx.serialization data classes for all six files (nullable fields as nullable types; every key inside Rule.match and Rule.result nullable).
2. A repository that loads a bundled seed from assets on first launch, refreshes from index.json on a coroutine, verifies sha256 with java.security.MessageDigest, atomically swaps files in filesDir, persists packHash + per-file hashes (DataStore).
3. A \`TransactionEnricher\` building the alias/rule indexes once per dataset load, exposing \`fun enrich(rawDescriptor: String): MatchResult\`.
4. Unicode/regex details: java.text.Normalizer.Form.NFKD + strip combining marks for unaccent; Pattern.CASE_INSENSITIVE for rule/noise regexes.
5. A JUnit test that runs sample_test_descriptors.json (test resource) and asserts the score.`,
  },
  {
    id: 'react-native',
    label: 'React Native',
    deliverables: `1. TypeScript interfaces for all six files (nullable fields as \`| null\`; every key inside Rule.match and Rule.result optional).
2. A data store module: bundles a seed copy of the JSONs, refreshes from index.json in the background, computes sha256 with react-native-quick-crypto or expo-crypto (crypto.subtle is NOT available in Hermes), caches files with expo-file-system (or react-native-fs) and hashes in MMKV/AsyncStorage.
3. A \`createEnricher(docs)\` factory that builds the alias/rule indexes once (module singleton, not per-render) and returns \`enrich(rawDescriptor: string): MatchResult\`.
4. Unicode note: \`String.prototype.normalize('NFKD')\` works in Hermes — use it + strip \\u0300-\\u036f for unaccent.
5. A Jest test that loads the JSON files as fixtures, runs sample_test_descriptors.json, and asserts the score.`,
  },
  {
    id: 'javascript',
    label: 'JavaScript / TS',
    deliverables: `1. TypeScript interfaces for all six files (nullable fields as \`| null\`; every key inside Rule.match and Rule.result optional).
2. A loader module: fetches index.json, computes sha256 with crypto.subtle (browser) or node:crypto (Node), caches files + hashes in IndexedDB/localStorage (browser) or on disk (Node), and only re-downloads changed files.
3. An ESM module exporting \`createEnricher(docs)\` that builds the alias/rule indexes once and returns \`enrich(rawDescriptor: string): MatchResult\`.
4. Unicode: \`normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')\` for unaccent; \`new RegExp(pattern, 'gi')\` for noise/rule regexes.
5. A vitest/jest test that runs sample_test_descriptors.json and asserts the score.`,
  },
  {
    id: 'flutter',
    label: 'Flutter / Dart',
    deliverables: `1. Dart model classes with fromJson for all six files (nullable fields as nullable types; every key inside Rule.match and Rule.result nullable).
2. A data store: bundles a seed copy as assets, refreshes from index.json in the background, verifies sha256 with package:crypto, caches files via path_provider, persists packHash + per-file hashes.
3. A \`TransactionEnricher\` building the alias/rule indexes once per dataset load, exposing \`MatchResult enrich(String rawDescriptor)\` (build indexes off the UI thread if needed).
4. Unicode note: Dart has no built-in NFKD — use package:unorm_dart for the unaccent step (do not skip it; aliases are stored unaccented).
5. A flutter_test that runs sample_test_descriptors.json as a fixture and asserts the score.`,
  },
  {
    id: 'generic',
    label: 'Other / any language',
    deliverables: `1. Typed models for all six files (respect nullable fields; every key inside Rule.match and Rule.result is optional).
2. A data store: seed copy shipped with the app, background refresh from index.json, sha256 verification before swapping files, packHash + per-file hashes persisted locally.
3. An enricher that builds the alias/rule indexes once per dataset load and exposes enrich(rawDescriptor) -> MatchResult.
4. Correct Unicode NFKD unaccenting and case-insensitive regex support (aliases are stored lowercase + unaccented).
5. A test runner that scores your pipeline against sample_test_descriptors.json.`,
  },
];

export function buildIntegrationPrompt(stackId: string, mcc: MccDoc, manifest: Manifest): string {
  const stack = INTEGRATION_STACKS.find((s) => s.id === stackId) ?? INTEGRATION_STACKS[INTEGRATION_STACKS.length - 1];
  const taxonomy = mcc.categoryTaxonomy.map((t) => t.id).join(', ');
  const c = manifest.fileCounts;

  return `# ROLE & GOAL
You are a senior ${stack.label} engineer. Implement a **transaction-enrichment client** that turns raw bank
statement descriptors (e.g. "SQ *BLUE BOTTLE COFF SAN FRANC") into a clean merchant + spending category
(Blue Bottle Coffee / food_dining). The dataset lives at a public URL and your implementation's accuracy is
machine-verifiable against a labeled test set, so port the data models and the matching algorithm EXACTLY.

# DATA SOURCE (fetch at runtime — do NOT hardcode the data)
Discovery index: ${DATA_INDEX_URL}
It lists all 6 data files as { name, path, url, bytes, sha256, description, counts } plus top-level
schemaVersion and packHash (sha256 of the per-file sha256s, in order). CORS is open; responses are plain JSON.

Update contract (implement exactly):
1. Fetch index.json. If packHash equals the stored one, the dataset is current — download nothing.
2. Otherwise download only the files whose sha256 differs from your stored copy, resolving \`path\` against the index URL.
3. Verify each download's sha256 against its index entry BEFORE swapping it in (the CDN caches ~10 min, so index
   and files can briefly disagree after a deploy). On mismatch keep the previous copy and retry later.
4. Ship a seed copy of all 6 files inside the app so first launch and offline work; refresh in the background.

# DATA MODELS (schema ${manifest.schemaVersion})
Live counts: ${c.merchants} merchants · ${c.mccCodes} MCC codes · ${c.categoryRules} rules · ${c.testDescriptors} labeled test descriptors.

merchant_aliases.json → { schemaVersion, generatedAt, name, description, matchingGuidance, merchants: Merchant[] }
  Merchant: { id: string, canonicalName: string, displayName: string, category: string, subcategory: string,
    mccHints: string[], website: string|null, iconSlug: string|null, countryHints: string[],
    aliases: string[], negativeAliases: string[], defaultConfidence: number, notes: string|null }
  Aliases are stored lowercase + unaccented, as they appear on statements. Example entry:
  { "id": "amazon", "category": "shopping", "subcategory": "online_marketplace",
    "aliases": ["amazon mktpl", "amzn mktp", "amzn.com/bill", "amazon", ...],
    "negativeAliases": ["amazon web services", "aws marketplace", "audible", ...], "defaultConfidence": 0.92 }

mcc_categories.json → { categoryTaxonomy: {id, displayName}[], mcc: { [code]: MccEntry } }
  MccEntry: { code, description, category, subcategory, group, defaultDirection, keywords: string[] }
  The ${mcc.categoryTaxonomy.length} category ids: ${taxonomy}
  Rules may additionally emit: ${RULE_ONLY_CATEGORIES.join(', ')} — a category enum needs taxonomy + these ${RULE_ONLY_CATEGORIES.length}.

category_rules.json → { evaluationGuidance, rules: Rule[] }
  Rule: { id: string, priority: number, name: string,
    match: { containsAny?: string[], containsAll?: string[], notContainsAny?: string[], regexAny?: string[], amountSign?: string },
    result: { merchantId?: string, displayName?: string, category?: string, subcategory?: string, processor?: string, tags?: string[] },
    confidence: number, notes: string|null }
  Tag-only rules have NO result.category (e.g. result: { "tags": ["installment"] } for Brazilian "PARC 03/10"
  markers) — they annotate the transaction and the pipeline keeps going.

descriptor_noise_terms.json → cleaning config:
  { preserveTerms: string[], removeWordsExact: string[], removePhrases: string[], processorTokens: string[],
    cardNetworkTokens: string[], paymentRailTokens: string[], channelTokens: string[],
    locationSuffixTokens: { [group]: string[] }, regexPatterns: { id, description, pattern, replacement }[] }
  regexPatterns are JS-flavored; apply case-insensitively. preserveTerms are short tokens that look like noise
  but are real merchants (BP, GAP, FPL...) — never remove them.

sample_test_descriptors.json → { descriptors: { rawDescription: string, region: string,
  expected: { merchantId: string|null, category: string|null } }[] }

manifest.json → { schemaVersion, generatedAt, fileCounts, files, supportedRegions }

# MATCHING ALGORITHM (port exactly — ordering matters)
Setup, once per dataset load:
- unaccent(s): Unicode NFKD normalize, then strip combining marks (U+0300–U+036F).
- rawNormalize(s): unaccent → lowercase → apostrophes (' ’) become spaces → collapse whitespace → trim.
- Compile noise.regexPatterns with case-insensitive+global flags; skip invalid patterns silently.
- Sort removePhrases LONGEST-FIRST. removeWords = set(removeWordsExact) MINUS preserveTerms.
- Alias index: an exact map alias→merchant (first writer wins) AND a contains list of (alias, merchant)
  for aliases of length ≥ 3, sorted LONGEST-alias-first.
- Processor-prefix regex from processorTokens: regex-escape each token, make '*' and spaces match optional
  whitespace, then anchor: ^\\s*(?:tok1|tok2|...)\\s*  (case-insensitive).
- Sort rules by priority DESCENDING; lowercase+unaccent every match array; split into categoryRules
  (result.category present) and tagRules (no result.category).

Per descriptor:
1. rawnorm = rawNormalize(raw); light = rawnorm with regexPatterns applied, then each removePhrase removed
   (longest first), whitespace collapsed; full = light tokenized on /[a-z0-9&+.'/*#-]+/g with removeWords
   dropped (preserveTerms kept), rejoined with spaces.
2. remainder = stripPrefix(light) or stripPrefix(rawnorm) — valid only if non-empty and shorter than the input.
3. Tag rules: every tagRule matching light OR rawnorm appends its result.tags (always collected, regardless
   of what matches later).
4. If a remainder exists: alias-match the remainder; if no merchant, rule-match the remainder.
5. Otherwise/still nothing: alias-match rawnorm, then light, then full — first hit wins.
6. Still nothing: rule-match light, then full.
7. Assemble the result: merchant fields beat rule fields (merchantId, displayName, category, subcategory);
   confidence = merchant.defaultConfidence or rule.confidence; include the collected tags.

Alias matching: exact-map hit wins; otherwise scan the contains list (longest first) with substring containment;
skip a merchant when any of its negativeAliases is also contained in the text.
Rule matching (priority desc, first hit wins): skip the rule if any notContainsAny term is present;
hit = (some containsAny term present) OR (some regexAny matches); if containsAll is present, ALSO require all.

Invariants your port MUST preserve: exact beats contains · longest alias wins · merchant aliases beat rules ·
negativeAliases veto contains-matches · aliases shorter than 3 chars never contains-match · tag-only rules
annotate without stopping the pipeline · rules evaluate in descending priority.

MatchResult should expose at least: merchantId, displayName, category, subcategory, confidence, tags,
matchedAlias/rule id and method (e.g. "exact:raw", "contains:light", "rule") for debugging.

# DELIVERABLES (${stack.label})
${stack.deliverables}

# ACCEPTANCE CRITERIA
1. Run every entry of sample_test_descriptors.json (${c.testDescriptors} descriptors) through your pipeline. A test
   passes when each non-null expected field (merchantId, category) equals your output. The reference
   implementation scores ${c.testDescriptors}/${c.testDescriptors} — treat anything below 99% as a porting bug (usual culprits:
   stage order, phrase sort order, the negative-alias veto, or skipping the unaccent step).
2. Update-contract tests: unchanged packHash → zero downloads; one changed file → only that file re-downloaded;
   corrupted download (hash mismatch) → previous copy kept.
3. No network on the enrichment hot path — matching runs entirely on the locally cached dataset.

# SELF-CHECK BEFORE REPLYING
- [ ] All 6 files modeled, nullable fields included (website, iconSlug, notes, expected.merchantId/category)
- [ ] Every key inside Rule.match and Rule.result treated as optional
- [ ] Algorithm steps in the exact order above; all invariants honored
- [ ] sha256 verified before swapping any file; seed + background refresh included
- [ ] Test runner reports passed/${c.testDescriptors} against the labeled set`;
}
