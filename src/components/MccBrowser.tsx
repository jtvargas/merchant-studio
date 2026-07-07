import { useEffect, useMemo, useState } from 'preact/hooks';
import type { MccEntry } from '../lib/schema';
import { loadAll } from '../lib/store';

export default function MccBrowser() {
  const [entries, setEntries] = useState<MccEntry[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    loadAll().then(({ docs }) => setEntries(Object.values(docs.mcc.mcc).sort((a, b) => a.code.localeCompare(b.code))));
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const needle = q.toLowerCase().trim();
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        e.code.startsWith(needle) ||
        e.description.toLowerCase().includes(needle) ||
        e.category.includes(needle) ||
        e.keywords.some((k) => k.includes(needle)),
    );
  }, [entries, q]);

  if (!entries) return <p class="text-zinc-500">Loading MCC codes…</p>;

  return (
    <div class="space-y-3">
      <input class="input" placeholder={`Search ${entries.length} MCC codes by code, description, category, or keyword…`}
        value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <div class="overflow-x-auto rounded-xl border border-zinc-800">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th class="px-3 py-2">code</th>
              <th class="px-3 py-2">description</th>
              <th class="px-3 py-2">category</th>
              <th class="px-3 py-2">keywords</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.code} class="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900">
                <td class="px-3 py-1.5 font-mono text-emerald-400">{e.code}</td>
                <td class="px-3 py-1.5">{e.description}</td>
                <td class="px-3 py-1.5 text-zinc-400">{e.category}/{e.subcategory}</td>
                <td class="px-3 py-1.5 text-xs text-zinc-500">{e.keywords.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
