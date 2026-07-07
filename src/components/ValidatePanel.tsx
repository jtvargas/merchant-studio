import { useEffect, useState } from 'preact/hooks';
import { loadAll, type AllDocs } from '../lib/store';
import { checkIntegrity, type IntegrityIssue } from '../lib/validation';
import { Pipeline } from '../lib/pipeline';

interface TestRun {
  hits: number;
  total: number;
  byRegion: Record<string, { hits: number; total: number }>;
  misses: { raw: string; region: string; expected: string; got: string }[];
}

export default function ValidatePanel() {
  const [docs, setDocs] = useState<AllDocs | null>(null);
  const [issues, setIssues] = useState<IntegrityIssue[] | null>(null);
  const [run, setRun] = useState<TestRun | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    loadAll().then(({ docs }) => {
      setDocs(docs);
      setIssues(checkIntegrity(docs));
    });
  }, []);

  const runTests = () => {
    if (!docs) return;
    setRunning(true);
    setTimeout(() => {
      const pipeline = new Pipeline(docs.merchants, docs.rules, docs.noise);
      const byRegion: TestRun['byRegion'] = {};
      const misses: TestRun['misses'] = [];
      let hits = 0;
      for (const t of docs.tests.descriptors) {
        const r = pipeline.match(t.rawDescription);
        const ok = t.expected.merchantId
          ? r.merchantId === t.expected.merchantId || (!!r.category && r.category === t.expected.category)
          : !!r.category && r.category === t.expected.category;
        const reg = (byRegion[t.region] ??= { hits: 0, total: 0 });
        reg.total += 1;
        if (ok) {
          hits += 1;
          reg.hits += 1;
        } else {
          misses.push({
            raw: t.rawDescription,
            region: t.region,
            expected: `${t.expected.merchantId ?? '·'} / ${t.expected.category ?? '·'}`,
            got: `${r.merchantId ?? '·'} / ${r.category ?? '·'}`,
          });
        }
      }
      setRun({ hits, total: docs.tests.descriptors.length, byRegion, misses });
      setRunning(false);
    }, 10);
  };

  if (!docs || !issues) return <p class="text-zinc-500">Loading…</p>;

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  return (
    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="card">
          <p class={`text-3xl font-bold ${errors.length ? 'text-red-400' : 'text-emerald-400'}`}>{errors.length}</p>
          <p class="text-sm text-zinc-400">integrity errors</p>
        </div>
        <div class="card">
          <p class={`text-3xl font-bold ${warnings.length ? 'text-amber-400' : 'text-emerald-400'}`}>{warnings.length}</p>
          <p class="text-sm text-zinc-400">warnings</p>
        </div>
        <div class="card">
          <p class="text-3xl font-bold text-white">
            {run ? `${((run.hits / Math.max(run.total, 1)) * 100).toFixed(1)}%` : '—'}
          </p>
          <p class="text-sm text-zinc-400">
            recognition on {docs.tests.descriptors.length} labeled descriptors{' '}
            <button class="btn ml-1 px-2 py-0.5 text-xs" disabled={running} onClick={runTests}>
              {running ? 'running…' : run ? 're-run' : 'run'}
            </button>
          </p>
        </div>
      </div>

      {run && (
        <div class="card">
          <h3 class="mb-2 text-sm font-semibold text-zinc-300">By region</h3>
          <div class="flex flex-wrap gap-2 text-sm">
            {Object.entries(run.byRegion).sort().map(([reg, s]) => (
              <span key={reg} class={`chip ${s.hits === s.total ? 'border-emerald-700 text-emerald-300' : 'border-amber-700 text-amber-300'}`}>
                {reg}: {s.hits}/{s.total}
              </span>
            ))}
          </div>
          {run.misses.length > 0 && (
            <div class="mt-3 overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead><tr class="text-zinc-500"><th class="py-1 pr-3">region</th><th class="py-1 pr-3">descriptor</th><th class="py-1 pr-3">expected (merchant/category)</th><th class="py-1">got</th></tr></thead>
                <tbody>
                  {run.misses.map((m, i) => (
                    <tr key={i} class="border-t border-zinc-800">
                      <td class="py-1 pr-3">{m.region}</td>
                      <td class="py-1 pr-3 font-mono">{m.raw}</td>
                      <td class="py-1 pr-3">{m.expected}</td>
                      <td class="py-1 text-red-300">{m.got}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <div class="card space-y-1 text-sm">
          {errors.map((i, idx) => (
            <p key={idx} class="tag-error">✗ <span class="font-mono">{i.where}</span> — {i.message}</p>
          ))}
          {warnings.map((i, idx) => (
            <p key={idx} class="tag-warning">⚠ <span class="font-mono">{i.where}</span> — {i.message}</p>
          ))}
        </div>
      )}
      {errors.length === 0 && warnings.length === 0 && (
        <div class="card text-sm text-emerald-300">✓ All integrity checks pass: unique ids, no alias collisions, valid categories, known MCC hints, manifest counts in sync.</div>
      )}
    </div>
  );
}
