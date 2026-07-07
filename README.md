# 🏪 Merchant Studio

A small, fast [Astro](https://astro.build) app to **inspect, add, and export merchants** for a
transaction-enrichment dataset (the kind that turns `SQ *BLUE BOTTLE COFF SAN FRANC` into
*Blue Bottle Coffee · food_dining*).

The dataset itself lives in this repo under [`data/`](data/) — 6 JSON files covering
**1,000+ merchants**, 370+ MCC codes, 130 matching rules, multilingual descriptor-cleaning
config (EN/ES/PT), and a labeled test set to measure recognition. Regions covered: USA
(national + Florida + California), Dominican Republic, Mexico, Brazil, Spain.

## What you can do

| Page | Purpose |
|---|---|
| **Dashboard** | Counts by country/category, integrity summary |
| **Merchants** | Search 1,000+ merchants by name/id/alias, filter by country & category, inspect every field, edit, duplicate, delete |
| **Add merchant** | Guided form with live validation: alias auto-normalization (lowercase, accents stripped), collision detection against every existing alias, risky-generic-word warnings, MCC autocomplete, duplicate-brand guard |
| **AI-assisted entry** | On the Add page: **Copy LLM prompt** builds a complete prompt (schema, category taxonomy, alias conventions, MCC cheat-sheet, JSON-only output contract) with your transaction descriptor baked in — paste it into ChatGPT/Claude/Gemini. Then **Fill form from JSON** imports the reply: fences stripped, aliases normalized, invalid MCCs/countries dropped with warnings, and the regular validation still applies before saving |
| **Playground** | Paste any raw bank descriptor and watch the cleaning stages + which merchant/rule matches |
| **Test set** | Add labeled descriptors and run the whole set to get your recognition % |
| **Validate** | One-click integrity check: duplicate ids, alias collisions, invalid categories, unknown MCC hints, manifest drift |
| **Rules / MCC** | Read-only searchable reference of the rule set and MCC table |
| **Export pack** | Download all 6 files (manifest recomputed) as a zip — ready to drop into your app |

## Two ways to use it

### 1. Locally (full editing — writes to `data/`)

```bash
git clone https://github.com/jtvargas/merchant-studio
cd merchant-studio
npm install
npm run dev          # http://localhost:4321
```

In local mode every save writes straight to `data/*.json` (pretty-printed, stable field
order, manifest counts auto-recomputed) — so your git diff is exactly what changed:

```bash
git add data && git commit -m "Add <merchant>" && git push   # Pages site updates automatically
```

### 2. On GitHub Pages (browse anywhere, edit as drafts)

The site deploys automatically to **https://jtvargas.github.io/merchant-studio/** on every
push to `main`. Static hosting can't write files, so there the app runs in **draft mode**:
edits are stored in your browser (localStorage) and merged into everything you see. When
you're done, press **Export pack**, drop the downloaded JSON files into `data/`, and push.

## The data contract (`data/`)

| File | Contents |
|---|---|
| `merchant_aliases.json` | Merchant entries: id, names, category/subcategory, `aliases` (lowercase, unaccented, as they appear on statements), `negativeAliases`, MCC hints, country hints, confidence |
| `mcc_categories.json` | MCC → category mapping + the 28-category taxonomy + EN/ES/PT keywords |
| `category_rules.json` | Priority-ordered rules: brand disambiguation, payment rails (PIX/SPEI/Bizum), installment tags, processor prefixes, ES/PT keyword fallbacks |
| `descriptor_noise_terms.json` | Cleaning config: noise words/phrases (EN/ES/PT), preserve-list, processor tokens, regex patterns |
| `sample_test_descriptors.json` | Labeled raw descriptors → expected merchant/category (the recognition benchmark) |
| `manifest.json` | Counts + supported regions (recomputed on every save/export) |

### Matching pipeline (implemented in `src/lib/pipeline.ts`, mirrored by consuming apps)

1. Normalize: lowercase, strip diacritics, apostrophes → spaces.
2. If the text starts with a processor token (`SQ *`, `TST*`, `MP*`, `CLIP MX*`, …), resolve the **remainder** first.
3. Match aliases (exact, then longest-contains with negative-alias checks) against three stages: raw-normalized → regex/phrase-cleaned → noise-words-removed.
4. Fall back to category rules by descending priority (tag-only rules annotate, e.g. Brazilian `PARC 03/10` installments).

## Development

```bash
npm run dev            # local editing mode
npm run build          # production build (dist/)
PAGES=1 npm run build  # GitHub Pages build (sets /merchant-studio base path)
```

Stack: Astro 5 · Preact islands · Tailwind 4 · fflate (zip export). No database — the JSON
files are the source of truth, versioned by git.
