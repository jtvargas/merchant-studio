import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TestDescriptor } from '../lib/schema';
import { REGIONS } from '../lib/schema';
import { loadAll, saveTests } from '../lib/store';
import { Pipeline } from '../lib/pipeline';

type Docs = import('../lib/store').AllDocs;

export default function TestsEditor() {
  const [docs, setDocs] = useState<Docs | null>(null);
  const [rows, setRows] = useState<TestDescriptor[]>([]);
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, boolean> | null>(null);
  const [draft, setDraft] = useState<TestDescriptor>({
    rawDescription: '', region: 'US', expected: { merchantId: null, category: null },
  });

  useEffect(() => {
    loadAll().then(({ docs }) => {
      setDocs(docs);
      setRows(docs.tests.descriptors);
    });
  }, []);

  const categories = useMemo(
    () => (docs ? docs.mcc.categoryTaxonomy.map((t) => t.id).concat(['income', 'fees_charges', 'refunds']) : []),
    [docs],
  );

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return rows.filter((t) => !needle || t.rawDescription.toLowerCase().includes(needle) || t.region.toLowerCase() === needle);
  }, [rows, q]);

  const runAll = () => {
    if (!docs) return;
    const pipeline = new Pipeline(docs.merchants, docs.rules, docs.noise);
    const map = new Map<string, boolean>();
    let hits = 0;
    for (const t of rows) {
      const r = pipeline.match(t.rawDescription);
      const ok = t.expected.merchantId
        ? r.merchantId === t.expected.merchantId || (!!r.category && r.category === t.expected.category)
        : !!r.category && r.category === t.expected.category;
      map.set(t.rawDescription, ok);
      if (ok) hits += 1;
    }
    setResults(map);
    setFlash(`${hits}/${rows.length} recognized (${((hits / Math.max(rows.length, 1)) * 100).toFixed(1)}%)`);
  };

  const save = async () => {
    const mode = await saveTests(rows);
    setDirty(false);
    setFlash(mode === 'local'
      ? 'Saved to data/sample_test_descriptors.json — remember to commit'
      : 'Saved as browser draft — use Export to download the updated files');
  };

  const addRow = () => {
    if (!draft.rawDescription.trim()) return;
    if (rows.some((t) => t.rawDescription === draft.rawDescription)) {
      setFlash('A descriptor with that exact text already exists');
      return;
    }
    setRows([{ ...draft }, ...rows]);
    setDraft({ rawDescription: '', region: draft.region, expected: { merchantId: null, category: null } });
    setDirty(true);
  };

  if (!docs) return <p class="text-zinc-500">Loading test set…</p>;

  return (
    <div class="space-y-4">
      <div class="card space-y-3">
        <h3 class="text-sm font-semibold text-zinc-300">Add a labeled descriptor</h3>
        <div class="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input class="input font-mono" placeholder="RAW DESCRIPTOR AS ON THE STATEMENT"
            value={draft.rawDescription}
            onInput={(e) => setDraft({ ...draft, rawDescription: (e.target as HTMLInputElement).value })} />
          <select class="input w-auto" value={draft.region}
            onInput={(e) => setDraft({ ...draft, region: (e.target as HTMLSelectElement).value })}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input class="input font-mono" placeholder="expected merchantId (blank = rule-only)" list="merchant-ids"
            value={draft.expected.merchantId ?? ''}
            onInput={(e) => setDraft({ ...draft, expected: { ...draft.expected, merchantId: (e.target as HTMLInputElement).value || null } })} />
          <select class="input" value={draft.expected.category ?? ''}
            onInput={(e) => setDraft({ ...draft, expected: { ...draft.expected, category: (e.target as HTMLSelectElement).value || null } })}>
            <option value="">expected category…</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button class="btn btn-primary" onClick={addRow}>Add</button>
        </div>
        <datalist id="merchant-ids">
          {docs.merchants.merchants.map((m) => <option key={m.id} value={m.id} />)}
        </datalist>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input class="input flex-1 min-w-48" placeholder={`Filter ${rows.length} descriptors…`} value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button class="btn" onClick={runAll}>▶ Run all</button>
        <button class="btn btn-primary" disabled={!dirty} onClick={save}>Save test set</button>
      </div>
      {flash && <p class="rounded-lg border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-300">{flash}</p>}

      <div class="overflow-x-auto rounded-xl border border-zinc-800">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th class="px-3 py-2 w-8"></th>
              <th class="px-3 py-2">descriptor</th>
              <th class="px-3 py-2">region</th>
              <th class="px-3 py-2">expected merchant</th>
              <th class="px-3 py-2">expected category</th>
              <th class="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.rawDescription} class="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900">
                <td class="px-3 py-1.5">
                  {results?.has(t.rawDescription) && (results.get(t.rawDescription)
                    ? <span class="text-emerald-400">✓</span>
                    : <span class="text-red-400">✗</span>)}
                </td>
                <td class="px-3 py-1.5 font-mono text-xs">{t.rawDescription}</td>
                <td class="px-3 py-1.5">{t.region}</td>
                <td class="px-3 py-1.5 font-mono text-xs">{t.expected.merchantId ?? <span class="text-zinc-600">rule-only</span>}</td>
                <td class="px-3 py-1.5 text-zinc-400">{t.expected.category ?? '—'}</td>
                <td class="px-3 py-1.5">
                  <button class="text-zinc-600 hover:text-red-400"
                    onClick={() => { setRows(rows.filter((x) => x.rawDescription !== t.rawDescription)); setDirty(true); }}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
