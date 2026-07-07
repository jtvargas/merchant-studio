import type { APIRoute } from 'astro';
import type { Merchant, MerchantsDoc, MccDoc } from '../../lib/schema';
import { orderMerchant } from '../../lib/schema';
import { validateMerchant } from '../../lib/validation';
import { readJson, writeJson, refreshManifestFile } from '../../lib/server/files';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = () => json(readJson<MerchantsDoc>('merchant_aliases.json'));

export const POST: APIRoute = async ({ request }) => {
  const entry = (await request.json()) as Merchant;
  const doc = readJson<MerchantsDoc>('merchant_aliases.json');
  const mcc = readJson<MccDoc>('mcc_categories.json');
  const issues = validateMerchant(
    entry, doc.merchants, new Set(Object.keys(mcc.mcc)),
    new Set(mcc.categoryTaxonomy.map((t) => t.id)),
  );
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) return json({ ok: false, errors }, 422);
  doc.merchants.push(orderMerchant(entry));
  writeJson('merchant_aliases.json', doc);
  refreshManifestFile();
  return json({ ok: true, id: entry.id }, 201);
};
