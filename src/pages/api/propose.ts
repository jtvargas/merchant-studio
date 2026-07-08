import type { APIRoute } from 'astro';
import type { MerchantsDoc, MccDoc, RulesDoc, NoiseDoc, TestsDoc, Manifest } from '../../lib/schema';
import { readJson, writeJson, syncPublic } from '../../lib/server/files';
import { recomputeCounts, bumpPatchVersion, compareVersions } from '../../lib/manifest';
import { dataChangedVsOrigin, summarizeDataChanges, buildPrBody, createDataPr, baseSchemaVersion } from '../../lib/server/git';

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
    // Publishing a new data revision: bump the schemaVersion PATCH relative to
    // origin/main so the merged PR always carries a new version. If the local
    // manifest is already ahead of origin (an earlier propose from this tree),
    // keep it — repeat publishes must not double-bump.
    const manifest = readJson<Manifest>('manifest.json');
    const base = baseSchemaVersion();
    if (!base || compareVersions(manifest.schemaVersion, base) <= 0) {
      manifest.schemaVersion = bumpPatchVersion(base ?? manifest.schemaVersion);
      writeJson('manifest.json', manifest);
      syncPublic();
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
    return json({ ok: true, url, summary, schemaVersion: manifest.schemaVersion });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const detail = (err.stderr || err.message || String(e)).slice(0, 600);
    return json({ error: `PR creation failed: ${detail}` }, 500);
  }
};
