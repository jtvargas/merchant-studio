// AI-assist helpers for the Add Merchant form:
//  - buildLlmPrompt(): a copy-paste prompt for any LLM chat that yields a
//    merchant JSON entry following the pack's conventions
//  - parseLlmJson(): tolerant parser/normalizer for whatever the LLM replies
import type { Merchant, MccDoc } from './schema';
import { EMPTY_MERCHANT, RISKY_GENERIC_WORDS, isValidCountryHint, normalizeAlias, orderMerchant } from './schema';

// LLM-produced entries must carry confidence strictly greater than 0.82
export const LLM_MIN_CONFIDENCE = 0.83;

// Common MCCs worth teaching the LLM (descriptions come from the loaded doc)
const CHEATSHEET_CODES = [
  '5411', '5462', '5499', '5812', '5813', '5814', '5912', '5921', '5311',
  '5310', '5399', '5651', '5661', '5691', '5712', '5722', '5732', '5734',
  '5941', '5942', '5945', '5977', '5995', '5999', '5541', '5542', '5552',
  '4111', '4112', '4121', '4131', '4511', '4722', '4784', '4814', '4899',
  '4900', '4215', '5211', '5251', '6011', '6012', '6300', '6513', '7011',
  '7230', '7523', '7538', '7832', '7997', '8011', '8062', '8071', '8211',
  '8220', '8398', '9311', '9399',
];

export function buildLlmPrompt(descriptor: string, mcc: MccDoc): string {
  const taxonomy = mcc.categoryTaxonomy.map((t) => t.id).join(', ');
  const cheatsheet = CHEATSHEET_CODES
    .filter((c) => mcc.mcc[c])
    .map((c) => `${c} = ${mcc.mcc[c].description}`)
    .join('\n');
  const target = descriptor.trim() || '<PASTE THE TRANSACTION DESCRIPTOR OR MERCHANT NAME HERE>';

  return `# ROLE & GOAL

You are filling ONE entry of a merchant database used for bank-transaction enrichment (turning raw card descriptors into clean merchant names and spending categories). The entry is machine-validated on import: any rule you break gets your answer rejected. ACCURACY BEATS COMPLETENESS — a verified half-filled entry is worth more than a guessed complete one.

# PROCESS (follow in order)

1. Identify the REAL merchant behind the descriptor below (brands are often truncated or prefixed by payment processors like SQ*, TST*, PAYPAL*).
2. If your assistant supports web search, tools, or subagents, USE THEM — verify each uncertain field independently (run parallel lookups/subagents per field when available):
   - how this merchant actually appears on real bank statements (search "<merchant> charge on statement"),
   - its typical MCC code,
   - the countries where it operates,
   - sibling brands that could collide with its name.
3. For every field: if you could not verify it and cannot state it with high confidence, use the SAFE DEFAULT (empty array [] or null) instead of guessing. Never invent statement formats, MCC codes, or domains.

# OUTPUT SHAPE (exactly these 13 keys, in this order)

{
  "id": "",
  "canonicalName": "",
  "displayName": "",
  "category": "",
  "subcategory": "",
  "mccHints": [],
  "website": null,
  "iconSlug": null,
  "countryHints": [],
  "aliases": [],
  "negativeAliases": [],
  "defaultConfidence": 0.92,
  "notes": null
}

# FIELD RULES (machine-validated — follow strictly)

- id: snake_case, lowercase letters/digits/underscores only, short and stable (e.g. "pollo_tropical").
- canonicalName: the merchant's proper brand name. displayName: what a user should see on the transaction (usually the same).
- category: EXACTLY one of: ${taxonomy}
  DO NOT invent categories. If two fit, pick the one matching where the MONEY goes (a gas-station convenience purchase is still auto_transport/gas only when fuel; food purchases at OXXO are groceries).
- subcategory: short snake_case, e.g. supermarket, fast_casual, pharmacy, gas, tolls, streaming_video, bank, rideshare, clothing.
- mccHints: 1-3 four-digit MCC code strings card networks use for this merchant. VERIFIED codes only — an empty array is better than a wrong code. Common codes:
${cheatsheet}
Any other valid ISO 18245 MCC is acceptable ONLY if you verified it.
- website: bare domain like "example.com" (no https://, no path) or null. iconSlug: lowercase brand slug without spaces, or null.
- countryHints: countries where this merchant actually operates. Use ISO 3166-1 alpha-2 codes (US, DO, MX, BR, ES, HK, CA, GB, FR, DE, JP, SG, …) and/or region tokens LATAM, EU, APAC, GLOBAL. Multiple allowed. DO NOT list countries you have not verified.
- aliases: 3-8 strings showing how this merchant ACTUALLY appears on statements: truncated forms ("pollo trop"), domain forms ("chewy.com"), processor-prefixed forms, common misspacings. All lowercase, ASCII only — strip every accent (ñ→n, é→e, ã→a). DO include the plain brand name when it is distinctive. DO NOT use a bare common dictionary word (bad: ${RISKY_GENERIC_WORDS.slice(0, 10).join(', ')}) — use a distinguishing phrase instead ("gol linhas aereas", never "gol"). DO NOT invent alias variants you have no evidence for; 3 real ones beat 8 fabricated ones.
- negativeAliases: phrases that indicate a DIFFERENT merchant despite overlapping text (e.g. "oxxo gas" on the OXXO store entry). Usually [].
- defaultConfidence: a number between 0.83 and 0.99 — NEVER 0.82 or below.
  · 0.92 = default when the aliases are verified and distinctive.
  · 0.95-0.99 = aliases verified against real statement samples and impossible to confuse.
  · 0.83-0.86 = aliases are short, generic-ish, or only partially verified.
- notes: null, OR one short note that genuinely helps a human reviewer.
  GOOD notes: "Statements often truncate to POLLO TROP", "Sibling brand of OXXO Gas — negativeAliases added", "Operates only in Hong Kong and Macau".
  BAD notes (use null instead): restating the category, "popular merchant", "added by AI", any filler that repeats other fields.

# SELF-CHECK BEFORE REPLYING

Verify every box, fix anything that fails, THEN reply:
[ ] Exactly one JSON object, all 13 keys, in the order shown, no extra keys.
[ ] No markdown fences, no commentary, no trailing commas.
[ ] id is snake_case; category is copied verbatim from the list.
[ ] Every alias is lowercase ASCII, accent-free, and not a bare dictionary word.
[ ] Every mccHint and countryHint was verified (or the array is empty).
[ ] defaultConfidence >= 0.83.
[ ] notes is null or genuinely useful (no filler).

Transaction descriptor / merchant: ${target}`;
}

export type ParseResult = { entry: Merchant; warnings: string[] } | { error: string };

function snakeCase(s: string): string {
  return normalizeAlias(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function parseLlmJson(text: string, mcc: MccDoc): ParseResult {
  let body = text.trim();
  if (!body) return { error: 'Nothing to import — paste the JSON reply first.' };

  // strip markdown fences and any prose around the JSON
  body = body.replace(/```[a-z]*\n?/gi, '');
  const firstObj = body.indexOf('{');
  const firstArr = body.indexOf('[');
  const start = firstArr !== -1 && (firstArr < firstObj || firstObj === -1) ? firstArr : firstObj;
  if (start === -1) return { error: 'No JSON object found in the pasted text.' };
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end <= start) return { error: 'The pasted text looks truncated — no closing brace found.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    return { error: `Could not parse JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  const warnings: string[] = [];
  let raw: Record<string, unknown>;
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { error: 'The JSON array is empty.' };
    if (parsed.length > 1) warnings.push(`Reply contained ${parsed.length} merchants — imported the first one only.`);
    raw = parsed[0] as Record<string, unknown>;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { merchants?: unknown[] }).merchants)) {
    const list = (parsed as { merchants: unknown[] }).merchants;
    if (list.length === 0) return { error: 'The "merchants" array is empty.' };
    if (list.length > 1) warnings.push(`Reply contained ${list.length} merchants — imported the first one only.`);
    raw = list[0] as Record<string, unknown>;
  } else if (parsed && typeof parsed === 'object') {
    raw = parsed as Record<string, unknown>;
  } else {
    return { error: 'The JSON is not an object.' };
  }

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? String(x) : str(x))).filter(Boolean) : [];

  const entry: Merchant = { ...EMPTY_MERCHANT };

  entry.canonicalName = str(raw.canonicalName) || str(raw.name);
  entry.displayName = str(raw.displayName) || entry.canonicalName;
  const rawId = str(raw.id) || entry.canonicalName;
  entry.id = snakeCase(rawId);
  if (entry.id !== str(raw.id) && str(raw.id)) warnings.push(`id normalized to "${entry.id}".`);

  const taxonomy = new Set(mcc.categoryTaxonomy.map((t) => t.id));
  const cat = str(raw.category).toLowerCase();
  if (taxonomy.has(cat)) {
    entry.category = cat;
  } else {
    entry.category = 'shopping';
    if (cat) warnings.push(`Category "${cat}" is not in the taxonomy — set to "shopping", please review.`);
    else warnings.push('No category provided — set to "shopping", please review.');
  }
  entry.subcategory = snakeCase(str(raw.subcategory));

  const hints: string[] = [];
  for (const h of strList(raw.mccHints)) {
    const code = h.replace(/\D/g, '').padStart(4, '0');
    if (mcc.mcc[code]) {
      if (!hints.includes(code)) hints.push(code);
    } else {
      warnings.push(`Dropped unknown MCC hint "${h}".`);
    }
  }
  entry.mccHints = hints;

  entry.website = str(raw.website).replace(/^https?:\/\//, '').replace(/\/$/, '') || null;
  entry.iconSlug = snakeCase(str(raw.iconSlug)).replace(/_/g, '') || null;

  const countries: string[] = [];
  for (const c of strList(raw.countryHints)) {
    const up = c.toUpperCase();
    if (isValidCountryHint(up)) {
      if (!countries.includes(up)) countries.push(up);
    } else {
      warnings.push(`Dropped invalid country hint "${c}" (expect ISO alpha-2 like HK, or LATAM/EU/APAC/GLOBAL).`);
    }
  }
  entry.countryHints = countries.length ? countries : ['US'];
  if (!countries.length) warnings.push('No valid country hints — defaulted to US.');

  const seen = new Set<string>();
  entry.aliases = strList(raw.aliases)
    .map((a) => normalizeAlias(a))
    .filter((a) => a && !seen.has(a) && (seen.add(a), true));
  const seenNeg = new Set<string>();
  entry.negativeAliases = strList(raw.negativeAliases)
    .map((a) => normalizeAlias(a))
    .filter((a) => a && !seenNeg.has(a) && (seenNeg.add(a), true));

  const conf = Number(raw.defaultConfidence);
  let confidence = Number.isFinite(conf) ? Math.min(0.99, Math.round(conf * 100) / 100) : 0.92;
  if (confidence < LLM_MIN_CONFIDENCE) {
    warnings.push(`Confidence ${confidence} raised to ${LLM_MIN_CONFIDENCE} (minimum for LLM imports) — review the aliases if the AI was unsure.`);
    confidence = LLM_MIN_CONFIDENCE;
  }
  entry.defaultConfidence = confidence;

  // notes: keep only genuinely useful text — drop empty filler
  const note = str(raw.notes);
  entry.notes = note.length >= 8 ? note : null;
  if (note && note.length < 8) warnings.push(`Dropped filler note "${note}".`);

  return { entry: orderMerchant(entry), warnings };
}
