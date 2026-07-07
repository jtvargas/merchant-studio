import { useEffect, useState } from 'preact/hooks';
import { loadAll, withBase, type AllDocs, type Mode } from '../lib/store';
import { checkIntegrity } from '../lib/validation';

function Tile({ value, label, href }: { value: string | number; label: string; href?: string }) {
  const inner = (
    <div class="card hover:border-zinc-600 transition-colors">
      <p class="text-3xl font-bold text-white">{value}</p>
      <p class="mt-1 text-sm text-zinc-400">{label}</p>
    </div>
  );
  return href ? <a href={withBase(href)}>{inner}</a> : inner;
}

function BarList({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(...rows.map(([, n]) => n), 1);
  return (
    <div class="card">
      <h3 class="mb-3 text-sm font-semibold text-zinc-300">{title}</h3>
      <div class="space-y-1.5">
        {rows.map(([name, n]) => (
          <div key={name} class="flex items-center gap-2 text-xs">
            <span class="w-32 shrink-0 truncate text-zinc-400">{name}</span>
            <div class="h-3 flex-1 overflow-hidden rounded bg-zinc-800">
              <div class="h-full rounded bg-emerald-600/70" style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span class="w-10 shrink-0 text-right font-mono text-zinc-300">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [docs, setDocs] = useState<AllDocs | null>(null);
  const [mode, setMode] = useState<Mode>('static');
  const [issueCount, setIssueCount] = useState<{ errors: number; warnings: number } | null>(null);

  useEffect(() => {
    loadAll().then(({ docs, mode }) => {
      setDocs(docs);
      setMode(mode);
      const issues = checkIntegrity(docs);
      setIssueCount({
        errors: issues.filter((i) => i.level === 'error').length,
        warnings: issues.filter((i) => i.level === 'warning').length,
      });
    });
  }, []);

  if (!docs) return <p class="text-zinc-500">Loading…</p>;

  const ms = docs.merchants.merchants;
  const byCategory = new Map<string, number>();
  const byCountry = new Map<string, number>();
  for (const m of ms) {
    byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
    for (const c of m.countryHints) byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
  }
  const top = (map: Map<string, number>, n = 12): [string, number][] =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  return (
    <div class="space-y-6">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Tile value={ms.length} label="merchants" href="/merchants" />
        <Tile value={ms.reduce((s, m) => s + m.aliases.length, 0)} label="aliases" href="/merchants" />
        <Tile value={Object.keys(docs.mcc.mcc).length} label="MCC codes" href="/mcc" />
        <Tile value={docs.rules.rules.length} label="rules" href="/rules" />
        <Tile value={docs.tests.descriptors.length} label="test descriptors" href="/tests" />
        <Tile
          value={issueCount ? (issueCount.errors === 0 ? '✓' : issueCount.errors) : '…'}
          label={issueCount && issueCount.errors === 0 ? `integrity OK (${issueCount.warnings} warnings)` : 'integrity errors'}
          href="/validate"
        />
      </div>
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList title="Merchants by country hint" rows={top(byCountry, 8)} />
        <BarList title="Top categories" rows={top(byCategory)} />
      </div>
      <div class="card text-sm text-zinc-400">
        {mode === 'local' ? (
          <p>
            <span class="text-emerald-400 font-semibold">Local mode.</span> Saves write straight to{' '}
            <code class="text-zinc-300">data/*.json</code>. When you're done: <code class="text-zinc-300">git add data && git commit && git push</code> — the
            GitHub Pages site updates automatically.
          </p>
        ) : (
          <p>
            <span class="text-sky-400 font-semibold">Hosted (read-only) mode.</span> Edits are kept as drafts in this browser. Use{' '}
            <strong>Export pack</strong> to download the updated JSON, drop the files into <code class="text-zinc-300">data/</code> in the repo, and push.
          </p>
        )}
      </div>
    </div>
  );
}
