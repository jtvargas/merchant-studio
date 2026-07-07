import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Rule } from '../lib/schema';
import { loadAll } from '../lib/store';

export default function RulesBrowser() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    loadAll().then(({ docs }) => setRules([...docs.rules.rules].sort((a, b) => b.priority - a.priority)));
  }, []);

  const filtered = useMemo(() => {
    if (!rules) return [];
    const needle = q.toLowerCase().trim();
    if (!needle) return rules;
    return rules.filter(
      (r) =>
        r.id.includes(needle) ||
        r.name.toLowerCase().includes(needle) ||
        (r.result.category ?? '').includes(needle) ||
        JSON.stringify(r.match).toLowerCase().includes(needle),
    );
  }, [rules, q]);

  if (!rules) return <p class="text-zinc-500">Loading rules…</p>;

  return (
    <div class="space-y-3">
      <input class="input" placeholder={`Search ${rules.length} rules by id, keyword, or category…`} value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <div class="space-y-2">
        {filtered.map((r) => (
          <details key={r.id} class="card">
            <summary class="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <span class="chip font-mono">{r.priority}</span>
              <span class="font-semibold text-zinc-100">{r.id}</span>
              <span class="text-zinc-400">{r.name}</span>
              <span class="ml-auto text-xs text-zinc-500">
                → {r.result.category ?? (r.result.tags ? `tags: ${r.result.tags.join(',')}` : '—')}
                {r.result.subcategory ? `/${r.result.subcategory}` : ''} · conf {r.confidence}
              </span>
            </summary>
            <pre class="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">{JSON.stringify({ match: r.match, result: r.result, notes: r.notes }, null, 2)}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}
