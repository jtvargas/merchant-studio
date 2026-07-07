import type { APIRoute } from 'astro';
import type { MerchantsDoc, MccDoc, RulesDoc, NoiseDoc, TestsDoc } from '../../lib/schema';
import { readJson } from '../../lib/server/files';
import { recomputeCounts } from '../../lib/manifest';
import { dataChangedVsOrigin, summarizeDataChanges, buildPrBody, createDataPr } from '../../lib/server/git';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  let title = 'Update enrichment data';
  try {
    const body = (await request.json()) as { title?: string };
    if (body.title?.trim()) title = body.title.trim();
  } catch { /* empty body is fine */ }

  try {
    if (!dataChangedVsOrigin()) {
      return json({ error: 'data/ matches origin/main — nothing to propose. Save some changes first.' }, 400);
    }
    const docs = {
      merchants: readJson<MerchantsDoc>('merchant_aliases.json'),
      mcc: readJson<MccDoc>('mcc_categories.json'),
      rules: readJson<RulesDoc>('category_rules.json'),
      noise: readJson<NoiseDoc>('descriptor_noise_terms.json'),
      tests: readJson<TestsDoc>('sample_test_descriptors.json'),
    };
    const summary = summarizeDataChanges(docs.merchants.merchants, recomputeCounts(docs));
    const url = createDataPr(title, buildPrBody(summary));
    return json({ ok: true, url, summary });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const detail = (err.stderr || err.message || String(e)).slice(0, 600);
    return json({ error: `PR creation failed: ${detail}` }, 500);
  }
};
