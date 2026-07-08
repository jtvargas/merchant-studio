// Builds the "integrate this dataset as your transaction-enrichment data source
// in <stack>" LLM prompt for the Data API page. Same pattern as buildLlmPrompt
// in llm.ts: pure function over the loaded docs returning one prompt string
// with #-heading sections (role → context → objective → contracts → requirements
// → output format → self-check).
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
    deliverables: `1. Codable models for all six files (nullable fields as optionals; every key inside Rule.match and Rule.result optional).
2. \`EnrichmentDataSource\`: URLSession fetcher implementing the data contract — index check, per-file downloads, CryptoKit SHA256 verification, atomic file swaps in Application Support, packHash/per-file hashes persisted, bundled seed fallback.
3. \`EnrichmentRepository\` (an actor): owns the current immutable \`DatasetSnapshot\` (parsed docs + prebuilt indexes), swaps it atomically after a successful refresh, never blocks readers.
4. \`TransactionEnricher\`: enrich / enrichBatch / explain / diagnostics over the snapshot. Unicode: NFKD via \`decomposedStringWithCanonicalMapping\` + strip combining marks (or \`folding(options: .diacriticInsensitive)\`); NSRegularExpression or Swift Regex, case-insensitive.
5. XCTest suite: the labeled acceptance test (fixture), the update-contract tests, and a concurrency test (enrich while refreshing).`,
  },
  {
    id: 'kotlin',
    label: 'Kotlin / Android',
    deliverables: `1. kotlinx.serialization data classes for all six files (nullable fields as nullable types; every key inside Rule.match and Rule.result nullable).
2. \`EnrichmentDataSource\`: OkHttp/Ktor fetcher implementing the data contract — index check, per-file downloads, MessageDigest SHA-256 verification, atomic file swaps in filesDir, packHash/per-file hashes in DataStore, seed in assets.
3. \`EnrichmentRepository\`: holds the current immutable dataset snapshot (parsed docs + prebuilt indexes) behind a thread-safe reference (e.g. AtomicReference/StateFlow), swapped only after a successful refresh on a coroutine.
4. \`TransactionEnricher\`: enrich / enrichBatch / explain / diagnostics. Unicode: java.text.Normalizer NFKD + strip combining marks; Pattern.CASE_INSENSITIVE for regexes.
5. JUnit tests: the labeled acceptance test (test resource), the update-contract tests, and a concurrency test (enrich while refreshing).`,
  },
  {
    id: 'react-native',
    label: 'React Native',
    deliverables: `1. TypeScript interfaces for all six files (nullable fields as \`| null\`; every key inside Rule.match and Rule.result optional).
2. \`enrichmentDataSource\`: fetch-based module implementing the data contract — sha256 via react-native-quick-crypto or expo-crypto (crypto.subtle is NOT available in Hermes), files cached with expo-file-system/react-native-fs, packHash/per-file hashes in MMKV or AsyncStorage, bundled seed JSONs for first launch.
3. \`enrichmentRepository\`: a module-level singleton holding the current immutable snapshot (parsed docs + prebuilt indexes) — rebuilt off the render path and swapped atomically after a successful refresh (never rebuild per render/call).
4. \`createEnricher(snapshot)\`: enrich / enrichBatch / explain / diagnostics. Unicode: \`normalize('NFKD')\` works in Hermes — strip \\u0300-\\u036f after it.
5. Jest tests: the labeled acceptance test (JSON fixtures), the update-contract tests, and a refresh-during-enrich consistency test.`,
  },
  {
    id: 'javascript',
    label: 'JavaScript / TS',
    deliverables: `1. TypeScript interfaces for all six files (nullable fields as \`| null\`; every key inside Rule.match and Rule.result optional).
2. \`enrichmentDataSource\`: fetch-based loader implementing the data contract — sha256 via crypto.subtle (browser) or node:crypto (Node), files + hashes cached in IndexedDB (browser) or on disk (Node), optional seed bundle for first paint/offline.
3. \`enrichmentRepository\`: holds the current immutable snapshot (parsed docs + prebuilt indexes); refresh builds a new snapshot and swaps the reference atomically — readers never see a half-built dataset.
4. \`createEnricher(snapshot)\` (ESM): enrich / enrichBatch / explain / diagnostics. Unicode: \`normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')\`; \`new RegExp(pattern, 'gi')\`.
5. vitest/jest tests: the labeled acceptance test, the update-contract tests, and a refresh-during-enrich consistency test.`,
  },
  {
    id: 'flutter',
    label: 'Flutter / Dart',
    deliverables: `1. Dart model classes with fromJson for all six files (nullable fields as nullable types; every key inside Rule.match and Rule.result nullable).
2. \`EnrichmentDataSource\`: http/dio fetcher implementing the data contract — sha256 via package:crypto, files cached via path_provider, packHash/per-file hashes persisted, seed copies shipped as assets.
3. \`EnrichmentRepository\`: owns the current immutable snapshot (parsed docs + prebuilt indexes), built off the UI thread (isolate if needed) and swapped atomically after a successful refresh.
4. \`TransactionEnricher\`: enrich / enrichBatch / explain / diagnostics. Unicode: Dart has no built-in NFKD — use package:unorm_dart for the unaccent step (do not skip it; aliases are stored unaccented).
5. flutter_test suite: the labeled acceptance test (fixture), the update-contract tests, and a refresh-during-enrich consistency test.`,
  },
  {
    id: 'generic',
    label: 'Other / any language',
    deliverables: `1. Typed models for all six files (respect nullable fields; every key inside Rule.match and Rule.result is optional).
2. A DataSource implementing the data contract: index check, per-file downloads, sha256 verification before swapping, atomic file replacement, packHash/per-file hashes persisted, seed copy shipped with the app.
3. A Repository owning the current immutable dataset snapshot (parsed docs + prebuilt indexes), swapped atomically after a successful refresh so readers never see partial state.
4. An Enricher exposing enrich / enrichBatch / explain / diagnostics, with correct Unicode NFKD unaccenting and case-insensitive regex support (aliases are stored lowercase + unaccented).
5. Tests: the labeled acceptance test, the update-contract tests, and a refresh-during-enrich consistency test.`,
  },
];

export function buildIntegrationPrompt(stackId: string, mcc: MccDoc, manifest: Manifest): string {
  const stack = INTEGRATION_STACKS.find((s) => s.id === stackId) ?? INTEGRATION_STACKS[INTEGRATION_STACKS.length - 1];
  const taxonomy = mcc.categoryTaxonomy.map((t) => t.id).join(', ');
  const c = manifest.fileCounts;

  return `# ROLE
You are a senior ${stack.label} engineer. Integrate a remote, versioned dataset as this app's
**transaction-enrichment data source**: raw bank-statement descriptors (e.g. "SQ *BLUE BOTTLE COFF SAN FRANC")
go in, clean merchant + spending category come out (Blue Bottle Coffee / food_dining), fully on-device.
This is production code: it must be reliable (bad network or a bad download must never break enrichment),
scalable (enrichment is called for every transaction in a feed), and debuggable (a wrong category must be
explainable). Work autonomously — where something is ambiguous, pick the sensible production default and note
it in one line; do not ask questions.

# CONTEXT
The dataset is 6 public JSON files (schema ${manifest.schemaVersion}): ${c.merchants} merchants with statement aliases,
${c.mccCodes} MCC codes + a category taxonomy, ${c.categoryRules} matching rules, descriptor-cleaning config, ${c.testDescriptors} labeled
test descriptors, and a manifest. It is updated every few days; the app must pick up changes automatically,
keep working offline, and never hit the network while enriching.

# OBJECTIVE — definition of done
Four layers, cleanly separated:
1. **DataSource** — implements the data contract below (download, verify, cache, refresh, failure handling).
2. **Repository** — owns an immutable dataset snapshot (parsed docs + prebuilt matching indexes) and swaps it
   atomically when a refresh succeeds.
3. **Enricher** — the matching pipeline over the snapshot, exposed as enrich / enrichBatch / explain / diagnostics.
4. **Tests** — the labeled acceptance suite plus contract and concurrency tests (see ACCEPTANCE CRITERIA).

# DATA CONTRACT (implement exactly)
Discovery index: ${DATA_INDEX_URL}
It lists all 6 files as { name, path, url, bytes, sha256, description, counts } plus top-level schemaVersion
and packHash (sha256 of the per-file sha256s, in order). CORS is open; responses are plain JSON; the CDN
caches ~10 minutes. Hashes are the change signal — generatedAt churns on every deploy.

Refresh protocol:
1. Fetch index.json. If packHash equals the stored one → dataset is current, download nothing.
2. Otherwise download ONLY the files whose sha256 differs, resolving \`path\` against the index URL.
3. Verify each download's sha256 against its index entry BEFORE swapping it in.
4. Only after all changed files verify: persist them atomically, store the new packHash + per-file hashes,
   build a new snapshot, and swap it in.

Failure handling (never crash, never serve partial data):
- Network error / timeout → keep serving the current snapshot; log; retry with exponential backoff.
- Hash mismatch on a download → discard it, keep the previous copy, retry later (post-deploy CDN skew is normal).
- Corrupted local cache (rehash files on load) → fall back to the bundled seed copy and force a refresh.
- index schemaVersion with a newer MAJOR than ${manifest.schemaVersion.split('.')[0]}.x → keep the last compatible dataset and surface a diagnostic.
- First launch / offline → load the seed copy bundled with the app; refresh in the background when possible.

# DATA MODELS (schema ${manifest.schemaVersion})
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
Snapshot build, once per dataset load:
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

# RELIABILITY & PERFORMANCE REQUIREMENTS
1. The snapshot is IMMUTABLE and replaced atomically — enrichment never blocks on a refresh, never sees a
   half-built dataset, and is safe to call from any thread.
2. Indexes and regexes are compiled once per snapshot — never per enrich() call.
3. enrich() is pure and synchronous over the snapshot: no I/O, no network, no disk on the hot path.
4. Provide enrichBatch(descriptors) for feeds/backfills (single snapshot read, results in input order).
5. Refresh policy: on app start and on foregrounding, but at most once per a few hours; always in the
   background; failures degrade gracefully per the failure-handling table.
6. Tag every enrichment result (or the batch) with the snapshot's packHash and expose the active packHash —
   so the app can re-enrich stored transactions when the dataset changes.

# DEBUGGING & OBSERVABILITY
1. MatchResult carries: merchantId, displayName, category, subcategory, confidence, tags, PLUS debug fields:
   method ("exact:raw" | "contains:light" | "rule" | null), matchedAlias, ruleId, the cleaning stages
   { rawnorm, light, full, prefixRemainder }, and negativeSkips (merchants vetoed by a negative alias).
2. explain(descriptor): returns a human-readable trace — each cleaning stage, which index/rule was consulted,
   why candidates were skipped, and the final decision. This is the first tool for "why is this categorized wrong?".
3. Injectable logger hooks (no hard dependency on a logging framework): refresh started / succeeded (files
   updated, new packHash) / failed (reason), cache corruption detected, seed fallback used.
4. diagnostics(): counters since launch — enrich calls, match-method distribution, unmatched rate, last
   refresh time + outcome, active packHash + schemaVersion.

# DELIVERABLES (${stack.label})
${stack.deliverables}

# ACCEPTANCE CRITERIA
1. Labeled test set: run every entry of sample_test_descriptors.json (${c.testDescriptors} descriptors). A test passes when
   each non-null expected field (merchantId, category) equals your output. The reference implementation scores
   ${c.testDescriptors}/${c.testDescriptors} — treat anything below 99% as a porting bug (usual culprits: stage order, phrase sort order,
   the negative-alias veto, or a skipped unaccent).
2. Update contract: unchanged packHash → zero file downloads; one changed file → exactly that file
   re-downloaded; corrupted download (hash mismatch) → previous copy kept and enrichment unaffected.
3. Concurrency: enriching while a refresh swaps the snapshot returns consistent results (each call sees
   exactly one snapshot).
4. No network or disk I/O on the enrichment hot path (verifiable in the tests).

# OUTPUT FORMAT
Reply in this order, no placeholders, no TODOs, no "left as an exercise" — every file complete and compilable:
1. Architecture summary (max 10 lines): the layers, where state lives, how the snapshot swap works.
2. The code, file by file, each preceded by its filename.
3. The tests, file by file.
4. A short usage example: app startup wiring + enriching a list of transactions + printing explain() for one.

# SELF-CHECK BEFORE REPLYING
- [ ] All 6 files modeled; nullable fields included (website, iconSlug, notes, expected.merchantId/category)
- [ ] Every key inside Rule.match and Rule.result treated as optional
- [ ] Algorithm steps in the exact order above; all invariants honored; unaccent not skipped
- [ ] sha256 verified before any swap; snapshot replaced atomically; seed + backoff + corruption fallback in place
- [ ] enrich() does no I/O; indexes built once per snapshot; enrichBatch / explain / diagnostics implemented
- [ ] Tests report passed/${c.testDescriptors} against the labeled set and cover the update contract + concurrency`;
}
