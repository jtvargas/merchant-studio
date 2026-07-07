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

export function refreshManifest(manifest: Manifest, docs: Parameters<typeof recomputeCounts>[0]): Manifest {
  return {
    ...manifest,
    generatedAt: new Date().toISOString().slice(0, 10),
    fileCounts: recomputeCounts(docs),
  };
}
