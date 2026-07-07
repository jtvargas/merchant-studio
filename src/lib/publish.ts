// Token-less publish helpers for static (GitHub Pages) mode:
//  - delta payload from browser drafts (small — only what changed)
//  - prefilled GitHub suggestion-issue URL (no automation runs on it)
//  - the GitHub web-upload page URL (GitHub's own UI creates the branch + PR)
import type { Merchant, TestDescriptor } from './schema';
import type { Drafts, AllDocs } from './store';

export const REPO_URL = 'https://github.com/jtvargas/merchant-studio';
export const UPLOAD_URL = `${REPO_URL}/upload/main/data`;

export interface DeltaPayload {
  merchants: Merchant[];
  deleteMerchants: string[];
  replaceTests?: boolean;
  testDescriptors?: TestDescriptor[];
}

export function buildDeltaPayload(drafts: Drafts): DeltaPayload {
  const merchants: Merchant[] = [];
  const deleteMerchants: string[] = [];
  for (const [id, entry] of Object.entries(drafts.merchants)) {
    if (entry === null) deleteMerchants.push(id);
    else merchants.push(entry);
  }
  const payload: DeltaPayload = { merchants, deleteMerchants };
  if (drafts.testsReplace) {
    payload.replaceTests = true;
    payload.testDescriptors = drafts.testsReplace;
  }
  return payload;
}

export function summaryOfDrafts(drafts: Drafts, docs?: AllDocs): string[] {
  const lines: string[] = [];
  const baseIds = new Set(docs?.merchants.merchants.map((m) => m.id) ?? []);
  for (const [id, entry] of Object.entries(drafts.merchants)) {
    if (entry === null) lines.push(`delete merchant ${id}`);
    else if (docs && !baseIds.has(id)) lines.push(`add merchant ${id} (${entry.category})`);
    else lines.push(`add/update merchant ${id} (${entry.category})`);
  }
  if (drafts.testsReplace) lines.push(`replace test set (${drafts.testsReplace.length} descriptors)`);
  return lines;
}

// Practical limit for prefilled-issue URLs before browsers/GitHub choke.
const MAX_URL = 6500;

export function buildSuggestionIssueUrl(
  payload: DeltaPayload,
  summaryLines: string[],
): { url: string; tooLarge: boolean; payloadText: string } {
  const payloadText = JSON.stringify(payload, null, 2);
  const title = `Data update: ${summaryLines[0] ?? 'new merchants'}${summaryLines.length > 1 ? ` (+${summaryLines.length - 1} more)` : ''}`;
  const body = [
    '## Proposed data update',
    '',
    ...summaryLines.map((l) => `- ${l}`),
    '',
    'Payload (apply with `node scripts/apply-update.mjs payload.json`):',
    '',
    '```json',
    payloadText,
    '```',
    '',
    '_Submitted from the Merchant Studio UI. The maintainer reviews and applies this — no automation runs on issue content._',
  ].join('\n');
  const url = `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  if (url.length > MAX_URL) {
    // fall back to the blank issue form; caller copies payloadText to clipboard
    return { url: `${REPO_URL}/issues/new?template=data-update.yml&title=${encodeURIComponent(title)}`, tooLarge: true, payloadText };
  }
  return { url, tooLarge: false, payloadText };
}
