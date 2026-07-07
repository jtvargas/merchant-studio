import type { APIRoute } from 'astro';
import type { TestsDoc, TestDescriptor } from '../../lib/schema';
import { readJson, writeJson, refreshManifestFile } from '../../lib/server/files';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = () => json(readJson<TestsDoc>('sample_test_descriptors.json'));

// Full-set replacement: the editor island manages the list client-side.
export const PUT: APIRoute = async ({ request }) => {
  const body = (await request.json()) as { descriptors: TestDescriptor[] };
  if (!Array.isArray(body.descriptors)) {
    return json({ ok: false, errors: [{ message: 'descriptors must be an array' }] }, 422);
  }
  for (const t of body.descriptors) {
    if (!t.rawDescription?.trim() || !t.expected) {
      return json({ ok: false, errors: [{ message: 'every descriptor needs rawDescription and expected' }] }, 422);
    }
  }
  const doc = readJson<TestsDoc>('sample_test_descriptors.json');
  doc.descriptors = body.descriptors;
  writeJson('sample_test_descriptors.json', doc);
  refreshManifestFile();
  return json({ ok: true, count: body.descriptors.length });
};
