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
| **Add merchant** | Guided form (Identity → Classification → Matching → Metadata) with live validation: alias auto-normalization (lowercase, accents stripped), collision detection against every existing alias, risky-generic-word warnings, MCC autocomplete, duplicate-brand guard, inline error highlighting. Country hints accept **any ISO 3166-1 alpha-2 code** (US, DO, MX, BR, ES, HK, JP, …) plus LATAM/EU/APAC/GLOBAL |
| **AI-assisted entry** | On the Add page: **Copy LLM prompt** builds a research-driven prompt (the AI is told to verify each field with web search/subagents when available, never guess, write null-or-useful notes only, and answer with **confidence ≥ 0.83**) with your descriptor baked in — paste it into ChatGPT/Claude/Gemini. Then **Fill form from JSON** imports the reply: fences stripped, aliases normalized, invalid MCCs/countries dropped with warnings, confidence floored at 0.83, and the regular validation still applies before saving |
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
you're done, publish them with the **⇪ Publish data** button (below) or **Export pack**.

## Publishing data updates (the ⇪ Publish data button)

All flows end in a **pull request against `data/`** that waits for maintainer review:

| Where | Flow |
|---|---|
| **Local** (`npm run dev`) | **Create PR now** — the dev server branches from `origin/main` in a temporary git worktree, commits your current `data/*.json`, pushes with *your own* git/gh credentials, and opens the PR. No token needed; your working tree is never touched. |
| **Hosted (recommended)** | **Create PR with your GitHub token** — paste a token and the PR is created straight from your browser. Transparency: the token is used *only* to open the data PR, is sent *only* to `api.github.com` (this site has no server), is held **in memory only — never persisted** to localStorage/sessionStorage/cookies (shared-origin safe), and is **discarded automatically the moment the PR is created** (or on reload). The exact code that touches it is [`src/lib/github.ts`](src/lib/github.ts) — it contains no storage calls at all. Use a **fine-grained** PAT scoped to this repo (or your fork) with *Contents* + *Pull requests* read/write and **expiration of at most 7 days**; avoid classic tokens (they cover all your public repos). Not a collaborator? The flow automatically forks the repo under your account and opens a cross-fork PR. |
| **Hosted, no token** | **Suggest via GitHub issue** — opens a prefilled issue containing only the *delta* payload. The maintainer applies it with `node scripts/apply-update.mjs payload.json` (validates categories, MCCs, alias collisions; recomputes the manifest) and publishes via the local flow. |

## Repository safety

- `main` is protected by a branch **ruleset**: changes land only through pull requests, and
  force-pushes / branch deletion are blocked. Only the owner and explicitly authorized
  collaborators can merge; everyone else contributes by opening PRs for review.
- Every PR opens with an auto-filled [template](.github/pull_request_template.md) describing
  the merchants/data/features it adds — the Publish flows generate the same structure.
- Merged `data-update-*` branches are deleted automatically.
- No GitHub Action ever executes third-party input; the only workflow is the Pages deploy,
  triggered exclusively by pushes to `main`.

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
