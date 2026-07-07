// AI-assist helpers for the Add Merchant form:
//  - buildLlmPrompt(): a copy-paste prompt for any LLM chat that yields a
//    merchant JSON entry following the pack's conventions
//  - parseLlmJson(): tolerant parser/normalizer for whatever the LLM replies
import type { Merchant, MccDoc } from './schema';
import { COUNTRY_HINTS, EMPTY_MERCHANT, RISKY_GENERIC_WORDS, normalizeAlias, orderMerchant } from './schema';

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

  return `You are helping me fill ONE entry of a merchant database used for bank-transaction enrichment (turning raw card descriptors into clean merchant names and spending categories). I will give you a raw transaction descriptor or a merchant name; research what you know about that merchant and reply with a single JSON object in EXACTLY this shape:

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

Field rules (follow them strictly — the entry is machine-validated):
- id: snake_case, lowercase letters/digits/underscores only, short and stable (e.g. "pollo_tropical").
- canonicalName: the merchant's proper brand name. displayName: what a user should see on the transaction (usually the same).
- category: EXACTLY one of: ${taxonomy}
- subcategory: short snake_case, e.g. supermarket, fast_casual, pharmacy, gas, tolls, streaming_video, bank, rideshare, clothing.
- mccHints: 1-3 four-digit MCC code strings that card networks would use for this merchant. Common codes:
${cheatsheet}
Any other valid ISO 18245 MCC is acceptable if you are confident; if unsure use an empty array.
- website: bare domain like "example.com" or null. iconSlug: lowercase brand slug without spaces, or null.
- countryHints: where this merchant operates, from: ${COUNTRY_HINTS.join(', ')} (LATAM = multi-country Latin America). Multiple allowed.
- aliases: 3-8 strings showing how this merchant ACTUALLY appears on bank statements: truncated forms, domain forms, processor-prefixed forms, common misspacings. All lowercase, ASCII only — strip every accent (ñ→n, é→e, ã→a). NEVER use a bare common dictionary word as an alias (bad: ${RISKY_GENERIC_WORDS.slice(0, 10).join(', ')}); use a distinguishing phrase instead ("gol linhas aereas", not "gol").
- negativeAliases: phrases that indicate a DIFFERENT merchant despite overlapping text (e.g. "oxxo gas" on the OXXO store entry). Usually [].
- defaultConfidence: 0.92 normally; 0.80-0.86 if the aliases are short/generic/risky.
- notes: null, or one short warning about collision risks.

Reply with ONLY the JSON object. No markdown fences, no explanations, no extra keys.

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
    if ((COUNTRY_HINTS as readonly string[]).includes(up)) {
      if (!countries.includes(up)) countries.push(up);
    } else {
      warnings.push(`Dropped invalid country hint "${c}".`);
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
  entry.defaultConfidence = Number.isFinite(conf) ? Math.min(0.99, Math.max(0.5, Math.round(conf * 100) / 100)) : 0.92;
  entry.notes = str(raw.notes) || null;

  return { entry: orderMerchant(entry), warnings };
}
