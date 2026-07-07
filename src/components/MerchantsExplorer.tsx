import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Merchant, MccDoc } from '../lib/schema';
import { unaccent } from '../lib/schema';
import { loadAll, deleteMerchant, withBase, type Mode } from '../lib/store';
import MerchantForm from './MerchantForm';

const PAGE = 100;

export default function MerchantsExplorer() {
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [mcc, setMcc] = useState<MccDoc | null>(null);
  const [mode, setMode] = useState<Mode>('static');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [country, setCountry] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = () =>
    loadAll().then(({ docs, mode }) => {
      setMerchants(docs.merchants.merchants);
      setMcc(docs.mcc);
      setMode(mode);
    });

  useEffect(() => {
    reload();
    const id = new URLSearchParams(location.search).get('id');
    if (id) setSelected(id);
  }, []);

  const filtered = useMemo(() => {
    if (!merchants) return [];
    const needle = unaccent(q).toLowerCase().trim();
    return merchants.filter((m) => {
      if (category && m.category !== category) return false;
      if (country && !m.countryHints.includes(country)) return false;
      if (!needle) return true;
      return (
        m.id.includes(needle) ||
        unaccent(m.canonicalName).toLowerCase().includes(needle) ||
        m.aliases.some((a) => a.includes(needle))
      );
    });
  }, [merchants, q, category, country]);

  const categories = useMemo(
    () => [...new Set((merchants ?? []).map((m) => m.category))].sort(),
    [merchants],
  );
  const countries = useMemo(
    () => [...new Set((merchants ?? []).flatMap((m) => m.countryHints))].sort(),
    [merchants],
  );

  const sel = merchants?.find((m) => m.id === selected) ?? null;

  const select = (id: string | null) => {
    setSelected(id);
    setEditing(false);
    const url = new URL(location.href);
    if (id) url.searchParams.set('id', id);
    else url.searchParams.delete('id');
    history.replaceState(null, '', url);
  };

  if (!merchants || !mcc) return <p class="text-zinc-500">Loading {merchants ? '' : 'merchants'}…</p>;

  return (
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <div class="mb-3 flex flex-wrap gap-2">
          <input
            class="input flex-1 min-w-48"
            placeholder={`Search ${merchants.length} merchants by name, id, or alias…`}
            value={q}
            onInput={(e) => { setQ((e.target as HTMLInputElement).value); setLimit(PAGE); }}
          />
          <select class="input w-auto" value={category} onInput={(e) => setCategory((e.target as HTMLSelectElement).value)}>
            <option value="">all categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select class="input w-auto" value={country} onInput={(e) => setCountry((e.target as HTMLSelectElement).value)}>
            <option value="">all countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <p class="mb-2 text-xs text-zinc-500">{filtered.length} match{filtered.length === 1 ? '' : 'es'}</p>
        <div class="overflow-hidden rounded-xl border border-zinc-800">
          {filtered.slice(0, limit).map((m) => (
            <button
              key={m.id}
              class={`flex w-full items-center gap-3 border-b border-zinc-800/60 px-3 py-2 text-left last:border-0 hover:bg-zinc-800/60 ${m.id === selected ? 'bg-emerald-900/20' : ''}`}
              onClick={() => select(m.id)}
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-zinc-100">{m.canonicalName}</p>
                <p class="truncate text-xs text-zinc-500">
                  <span class="font-mono">{m.id}</span> · {m.category}/{m.subcategory}
                </p>
              </div>
              <span class="text-xs text-zinc-500">{m.countryHints.join(' ')}</span>
              <span class="chip">{m.aliases.length} alias{m.aliases.length === 1 ? '' : 'es'}</span>
            </button>
          ))}
          {filtered.length === 0 && <p class="p-4 text-sm text-zinc-500">No merchants match.</p>}
        </div>
        {filtered.length > limit && (
          <button class="btn mt-3" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, filtered.length - limit)} more
          </button>
        )}
      </div>

      <div>
        {flash && <p class="mb-3 rounded-lg border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-300">{flash}</p>}
        {!sel && <div class="card text-sm text-zinc-500">Select a merchant to inspect it.</div>}
        {sel && !editing && (
          <div class="card space-y-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-xl font-bold text-white">{sel.canonicalName}</h2>
                <p class="text-sm text-zinc-400">
                  <span class="font-mono">{sel.id}</span> · {sel.category}/{sel.subcategory} · conf {sel.defaultConfidence}
                </p>
              </div>
              <div class="flex shrink-0 gap-2">
                <button class="btn" onClick={() => setEditing(true)}>Edit</button>
                <a class="btn" href={withBase(`/add?from=${sel.id}`)}>Duplicate</a>
                <button
                  class="btn btn-danger"
                  onClick={async () => {
                    if (!confirm(`Delete "${sel.id}"?`)) return;
                    await deleteMerchant(sel.id);
                    setFlash(mode === 'local' ? `Deleted ${sel.id} from data/merchant_aliases.json` : `Deleted ${sel.id} (draft — export to persist)`);
                    select(null);
                    reload();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><dt class="label">Display name</dt><dd>{sel.displayName}</dd></div>
              <div><dt class="label">Website</dt><dd>{sel.website ?? '—'}</dd></div>
              <div><dt class="label">Countries</dt><dd>{sel.countryHints.join(', ') || '—'}</dd></div>
              <div>
                <dt class="label">MCC hints</dt>
                <dd class="space-y-0.5">
                  {sel.mccHints.length === 0 && '—'}
                  {sel.mccHints.map((h) => (
                    <p key={h}><span class="font-mono text-emerald-400">{h}</span> <span class="text-zinc-400">{mcc.mcc[h]?.description ?? 'unknown'}</span></p>
                  ))}
                </dd>
              </div>
            </dl>
            <div>
              <p class="label">Aliases ({sel.aliases.length})</p>
              <div class="flex flex-wrap gap-1.5">{sel.aliases.map((a) => <span key={a} class="chip font-mono">{a}</span>)}</div>
            </div>
            {sel.negativeAliases.length > 0 && (
              <div>
                <p class="label">Negative aliases</p>
                <div class="flex flex-wrap gap-1.5">{sel.negativeAliases.map((a) => <span key={a} class="chip border-red-900 text-red-300 font-mono">{a}</span>)}</div>
              </div>
            )}
            {sel.notes && <p class="text-sm text-amber-300/80">⚠ {sel.notes}</p>}
            <details class="text-xs">
              <summary class="cursor-pointer text-zinc-500">Raw JSON</summary>
              <pre class="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-zinc-300">{JSON.stringify(sel, null, 2)}</pre>
            </details>
          </div>
        )}
        {sel && editing && (
          <div class="card">
            <h2 class="mb-4 text-lg font-bold text-white">Edit {sel.id}</h2>
            <MerchantForm
              initial={sel}
              isNew={false}
              all={merchants}
              mcc={mcc}
              onCancel={() => setEditing(false)}
              onSaved={(m, savedMode) => {
                setEditing(false);
                setFlash(savedMode === 'local'
                  ? `Saved ${m.id} to data/merchant_aliases.json — remember to commit`
                  : `Saved ${m.id} as a browser draft — use Export to download the updated files`);
                reload();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
