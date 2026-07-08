# Client integration guide

How to use the transaction-enrichment dataset in your own app — mobile, web, or backend —
so `SQ *BLUE BOTTLE COFF SAN FRANC` becomes *Blue Bottle Coffee · food_dining* without
bundling the data files or calling any server at classification time.

> **Shortcut**: the [Data API page](https://jtvargas.github.io/merchant-studio/data) has a
> stack picker (Swift, Kotlin, React Native, JavaScript, Flutter…) with a **Copy LLM prompt**
> button that packs everything in this guide into one implementation brief for ChatGPT/Claude.
> This document is the same content for humans.

## License & attribution (required)

The dataset is licensed under **[CC BY 4.0](../data/LICENSE)** — free for any use, including
commercial, as long as you give attribution. Display this credit somewhere your app shows data
sources (About/Settings screen, footer, "powered by" line):

```
Enrichment from Merchant Studio by Jonathan Taveras
```

Link it to `https://github.com/jtvargas/merchant-studio` where your UI supports links. See
[`data/ATTRIBUTION.md`](../data/ATTRIBUTION.md) for a short-form alternative and the full rationale.

## The big picture

Your app keeps a local copy of 6 JSON files, refreshes them from a public URL when they change,
and runs a small deterministic matching pipeline on-device. Three pieces:

1. **Data store** — download, verify, cache, refresh (network only at refresh time)
2. **Models** — typed representations of the 6 files
3. **Enricher** — the matching pipeline (pure functions over the cached data)

---

## Step 1 · Fetch & cache the dataset

Everything hangs off the discovery index:

```
https://jtvargas.github.io/merchant-studio/data/index.json
```

It lists all 6 files with `{ name, path, url, bytes, sha256, description, counts }` plus a
top-level `schemaVersion` and `packHash` (sha256 of the per-file hashes). CORS is open,
responses are plain JSON, GitHub Pages caches ~10 minutes with ETags.

The update contract:

1. Fetch `index.json`. If `packHash` equals the one you stored → dataset is current, download nothing.
2. Otherwise download **only** the files whose `sha256` differs, resolving `path` against the index URL.
3. Verify each download's sha256 against its index entry **before** swapping it in — right after
   a deploy the CDN can briefly serve index and files from different builds. On mismatch keep
   your previous copy and retry later.
4. Ship a **seed copy** of all 6 files inside your app bundle so first launch and offline work,
   then refresh in the background.

Hashes are the change signal — `generatedAt` changes on every deploy even when data didn't.

## Step 2 · Model the 6 files

TypeScript notation (translate to Codable / kotlinx.serialization / Dart as needed — the
canonical definitions live in [`src/lib/schema.ts`](../src/lib/schema.ts)):

### `merchant_aliases.json` — the merchant database

```ts
{ schemaVersion, generatedAt, name, description, matchingGuidance, merchants: Merchant[] }

interface Merchant {
  id: string;                 // snake_case, e.g. "pollo_tropical"
  canonicalName: string;      // "Pollo Tropical"
  displayName: string;        // what to show on the transaction row
  category: string;           // one of the 28 taxonomy ids
  subcategory: string;
  mccHints: string[];         // MCC codes this merchant typically uses
  website: string | null;
  iconSlug: string | null;
  countryHints: string[];     // ISO alpha-2 and/or LATAM/EU/APAC/GLOBAL
  aliases: string[];          // lowercase + unaccented, as printed on statements
  negativeAliases: string[];  // if one of these is in the text, it's NOT this merchant
  defaultConfidence: number;  // 0.5–0.99
  notes: string | null;
}
```

```json
{ "id": "amazon", "category": "shopping", "subcategory": "online_marketplace",
  "aliases": ["amazon mktpl", "amzn mktp", "amzn.com/bill", "amazon"],
  "negativeAliases": ["amazon web services", "aws marketplace", "audible"],
  "defaultConfidence": 0.92 }
```

### `mcc_categories.json` — MCC table + taxonomy

```ts
{ categoryTaxonomy: { id: string; displayName: string }[],   // the 28 categories
  mcc: Record<string, MccEntry> }                            // keyed by 4-digit code

interface MccEntry { code; description; category; subcategory; group; defaultDirection; keywords: string[] }
```

The 28 category ids: `groceries, food_dining, shopping, home, auto_transport, travel,
bills_utilities, subscriptions, software, health, personal_care, insurance, financial,
transfers, cash_atm, investments, housing, education, entertainment, office, pets, shipping,
donations, taxes, government_taxes, business, professional_services, family`.

> Rules (below) may additionally emit `income`, `fees_charges`, `refunds` — so a category
> enum needs the 28 taxonomy ids **plus these 3**.

### `category_rules.json` — fallback & disambiguation rules

```ts
interface Rule {
  id: string;
  priority: number;           // evaluate in DESCENDING order, first hit wins
  name: string;
  match: {
    containsAny?: string[];   // hit if any is contained…
    containsAll?: string[];   // …AND all of these (when present)
    notContainsAny?: string[];// skip the rule if any of these is present
    regexAny?: string[];      // or if any regex matches (JS-flavored, case-insensitive)
    amountSign?: string;
  };
  result: { merchantId?; displayName?; category?; subcategory?; processor?; tags?: string[] };
  confidence: number;
  notes: string | null;
}
```

**Tag-only rules** have no `result.category` — they annotate and the pipeline keeps going:

```json
{ "id": "br_installment_tag", "priority": 946,
  "match": { "regexAny": ["\\bparc\\s*\\d{1,2}\\s*/\\s*\\d{1,2}\\b"] },
  "result": { "tags": ["installment"] }, "confidence": 0.9 }
```

### `descriptor_noise_terms.json` — cleaning config

```ts
{ preserveTerms: string[];        // short tokens that LOOK like noise but are real merchants (BP, GAP, FPL) — never remove
  removeWordsExact: string[];     // single noise words (visa, debit, compra…)
  removePhrases: string[];        // multi-word noise ("card purchase", "visa debit"…)
  processorTokens: string[];      // payment-processor prefixes ("sq *", "tst*", "mp*"…)
  cardNetworkTokens: string[]; paymentRailTokens: string[]; channelTokens: string[];
  locationSuffixTokens: Record<string, string[]>;   // usStates, commonCountries…
  regexPatterns: { id; description; pattern; replacement }[] }
```

### `sample_test_descriptors.json` — your acceptance test

```ts
{ descriptors: { rawDescription: string; region: string;
                 expected: { merchantId: string | null; category: string | null } }[] }
```

### `manifest.json`

```ts
{ schemaVersion, generatedAt, fileCounts: Record<string, number>, files, supportedRegions }
```

Version semantics: `schemaVersion` `MAJOR.MINOR` = file structure (guard your models on this),
`PATCH` = data revision, bumped on every published data update. The index additionally carries
`dataRevision` (monotonic count of data commits) and a combined `version` (e.g. `1.1.2+r58`).

## Step 3 · Port the matching pipeline

Reference implementation: [`src/lib/pipeline.ts`](../src/lib/pipeline.ts) (scores 285/285 on
the labeled set). Port it exactly — **ordering matters**.

### Setup (once per dataset load)

- `unaccent(s)`: Unicode **NFKD** normalize, strip combining marks (U+0300–U+036F).
- `rawNormalize(s)`: unaccent → lowercase → apostrophes (`'` `’`) become spaces → collapse whitespace → trim.
- Compile `noise.regexPatterns` case-insensitive + global; skip invalid patterns silently.
- Sort `removePhrases` **longest-first**. `removeWords = set(removeWordsExact) − preserveTerms`.
- Alias index: an **exact map** alias→merchant (first writer wins) and a **contains list** of
  (alias, merchant) for aliases of length ≥ 3, sorted **longest-alias-first**.
- Processor-prefix regex from `processorTokens`: regex-escape each token, make `*` and spaces
  match optional whitespace, anchor: `^\s*(?:tok1|tok2|…)\s*` (case-insensitive).
- Sort rules by `priority` **descending**; lowercase+unaccent every match array; split into
  **categoryRules** (`result.category` present) and **tagRules** (no category).

### Per descriptor

1. Compute three cleaning stages:
   - `rawnorm` = `rawNormalize(raw)`
   - `light` = `rawnorm` with regexPatterns applied, then each removePhrase removed (longest first), whitespace collapsed
   - `full` = `light` tokenized on `/[a-z0-9&+.'/*#-]+/g`, tokens in `removeWords` dropped (preserveTerms kept), rejoined
2. `remainder` = stripPrefix(`light`) or stripPrefix(`rawnorm`) — valid only if non-empty and shorter than the input.
3. **Tag rules**: every tagRule matching `light` OR `rawnorm` appends its `result.tags` (always collected).
4. If a remainder exists: alias-match the remainder; if no merchant, rule-match the remainder.
5. Otherwise: alias-match `rawnorm`, then `light`, then `full` — first hit wins.
6. Still nothing: rule-match `light`, then `full`.
7. Assemble: merchant fields beat rule fields; `confidence` = `merchant.defaultConfidence` or `rule.confidence`; include collected tags.

**Alias matching**: exact-map hit wins; otherwise scan the contains list (longest first) with
substring containment; skip a merchant when any of its `negativeAliases` is also contained.

**Rule matching** (priority desc, first hit wins): skip if any `notContainsAny` term is present;
hit = (some `containsAny` term present) OR (some `regexAny` matches); if `containsAll` is
present, additionally require all of them.

### Invariants (where ports usually break)

- exact beats contains · longest alias wins · merchant aliases beat rules
- `negativeAliases` veto contains-matches
- aliases shorter than 3 characters never contains-match
- tag-only rules annotate without stopping the pipeline
- rules evaluate in descending priority
- never skip the unaccent step — aliases are stored unaccented

## Step 4 · Validate your port

Run every entry of `sample_test_descriptors.json` through your pipeline. A test passes when each
**non-null** expected field equals your output:

```
passed = 0
for d in tests.descriptors:
    r = enrich(d.rawDescription)
    ok = (d.expected.merchantId == null or r.merchantId == d.expected.merchantId)
     and (d.expected.category  == null or r.category  == d.expected.category)
    if ok: passed += 1
print(passed, "/", len(tests.descriptors))
```

The reference scores **285/285**. Treat anything below 99% as a porting bug — the usual
culprits are stage order, phrase sort order, the negative-alias veto, or a missing unaccent.

## Step 5 · Stack quick starts

### Swift / iOS

```swift
struct Merchant: Codable {
    let id, canonicalName, displayName, category, subcategory: String
    let mccHints, countryHints, aliases, negativeAliases: [String]
    let website, iconSlug, notes: String?
    let defaultConfidence: Double
}
// unaccent: s.folding(options: .diacriticInsensitive, locale: nil)
// sha256:   CryptoKit → SHA256.hash(data:)
// store:    an actor that seeds from the bundle, refreshes in the background,
//           and atomically swaps files in Application Support
```

### Kotlin / Android

```kotlin
@Serializable data class Merchant(
    val id: String, val canonicalName: String, val displayName: String,
    val category: String, val subcategory: String,
    val mccHints: List<String>, val countryHints: List<String>,
    val aliases: List<String>, val negativeAliases: List<String>,
    val website: String?, val iconSlug: String?, val notes: String?,
    val defaultConfidence: Double,
)
// unaccent: Normalizer.normalize(s, Normalizer.Form.NFKD).replace(Regex("\\p{Mn}+"), "")
// sha256:   MessageDigest.getInstance("SHA-256")
```

### React Native

```ts
// crypto.subtle is NOT available in Hermes — use react-native-quick-crypto or expo-crypto
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
// unaccent works natively: s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
// cache files with expo-file-system, hashes in MMKV/AsyncStorage
// build the alias/rule indexes ONCE in a module singleton, not per render
```

### JavaScript / TypeScript (web or Node)

```ts
const digest = await crypto.subtle.digest('SHA-256', bytes); // node: crypto.createHash('sha256')
const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
// cache in IndexedDB (browser) or on disk (Node); indexes built once per dataset load
```

### Flutter / Dart

```dart
// Dart has no built-in NFKD — use package:unorm_dart for the unaccent step (don't skip it)
// sha256: package:crypto → sha256.convert(bytes)
// seed the 6 files as assets; cache via path_provider
```

## Step 6 · Or let an LLM implement it

Open the [Data API page](https://jtvargas.github.io/merchant-studio/data), pick your stack,
press **Copy LLM prompt**, and paste it into your AI assistant. The prompt is a production
integration brief: it asks for a layered implementation (DataSource → Repository with an
atomically-swapped immutable snapshot → Enricher with `enrich`/`enrichBatch`/`explain`/`diagnostics`)
of this dataset as your app's transaction-enrichment data source — with the full update
contract and failure handling, all models, the exact algorithm with its invariants, per-stack
deliverables, and the acceptance criteria above. Review what it writes and run the Step 4
test before shipping.
