import type { MerchantsDoc, MccDoc, RulesDoc, NoiseDoc, TestsDoc, Manifest } from './schema';

export function recomputeCounts(docs: {
  merchants: MerchantsDoc; mcc: MccDoc; rules: RulesDoc; noise: NoiseDoc; tests: TestsDoc;
}): Record<string, number> {
  return {
    merchants: docs.merchants.merchants.length,
    mccCodes: Object.keys(docs.mcc.mcc).length,
    categoryRules: docs.rules.rules.length,
    noiseExactWords: docs.noise.removeWordsExact.length,
    noisePhrases: docs.noise.removePhrases.length,
    regexPatterns: docs.noise.regexPatterns.length,
    testDescriptors: docs.tests.descriptors.length,
  };
}

// schemaVersion semantics: MAJOR.MINOR describe the file *structure* (what
// consumers guard on); PATCH is the data revision, bumped on every published
// data update so a merged PR always ships a new version.
export function bumpPatchVersion(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return version;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export function refreshManifest(
  manifest: Manifest,
  docs: Parameters<typeof recomputeCounts>[0],
  opts: { bumpPatch?: boolean } = {},
): Manifest {
  return {
    ...manifest,
    schemaVersion: opts.bumpPatch ? bumpPatchVersion(manifest.schemaVersion) : manifest.schemaVersion,
    generatedAt: new Date().toISOString().slice(0, 10),
    fileCounts: recomputeCounts(docs),
  };
}
