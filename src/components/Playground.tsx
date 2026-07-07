import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadAll, withBase, type AllDocs } from '../lib/store';
import { Pipeline, type MatchResult } from '../lib/pipeline';

const EXAMPLES = [
  'OXXO GAS RIO NILO GUADALAJARA JAL',
  'SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA',
  'PIX TRANSF JOAO M 12/05',
  'PURCHASE AUTHORIZED ON 05/12 WAL-MART #2334 MIAMI FL',
  'COMPRA POS FARMACIA CAROL RNC 101123456 STO DGO',
  'MAGAZINELUIZA PARC 03/10 SAO PAULO BRA',
  'COMPRA EN MERCADONA VALENCIA ES',
];

export default function Playground() {
  const [docs, setDocs] = useState<AllDocs | null>(null);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<MatchResult | null>(null);

  useEffect(() => {
    loadAll().then(({ docs }) => setDocs(docs));
  }, []);

  const pipeline = useMemo(
    () => (docs ? new Pipeline(docs.merchants, docs.rules, docs.noise) : null),
    [docs],
  );

  const run = (text: string) => {
    setInput(text);
    if (pipeline && text.trim()) setResult(pipeline.match(text));
    else setResult(null);
  };

  if (!docs || !pipeline) return <p class="text-zinc-500">Loading pipeline…</p>;

  return (
    <div class="space-y-4">
      <div class="card">
        <label class="label">Raw bank descriptor</label>
        <input
          class="input font-mono"
          value={input}
          placeholder="Paste a raw statement line, e.g. OXXO GAS RIO NILO GUADALAJARA JAL"
          onInput={(e) => run((e.target as HTMLInputElement).value)}
        />
        <div class="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} class="chip cursor-pointer hover:border-emerald-600" onClick={() => run(ex)}>
              {ex.length > 44 ? ex.slice(0, 44) + '…' : ex}
            </button>
          ))}
        </div>
      </div>

      {result && (
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div class="card space-y-2">
            <h3 class="text-sm font-semibold text-zinc-300">Result</h3>
            {result.merchant ? (
              <>
                <p class="text-2xl font-bold text-emerald-300">{result.merchant.displayName}</p>
                <p class="text-sm text-zinc-400">
                  merchant <a class="font-mono text-emerald-400 underline" href={withBase(`/merchants?id=${result.merchant.id}`)}>{result.merchant.id}</a>{' '}
                  · {result.merchant.category}/{result.merchant.subcategory}
                </p>
                <p class="text-sm text-zinc-400">
                  via alias <span class="chip font-mono">{result.matchedAlias}</span> ({result.method}) · confidence {result.confidence}
                </p>
              </>
            ) : result.rule ? (
              <>
                <p class="text-2xl font-bold text-sky-300">{result.rule.result.displayName ?? result.category}</p>
                <p class="text-sm text-zinc-400">
                  rule <span class="font-mono text-sky-400">{result.rule.id}</span> (priority {result.rule.priority}) → {result.category}
                  {result.rule.result.subcategory ? `/${result.rule.result.subcategory}` : ''} · confidence {result.confidence}
                </p>
              </>
            ) : (
              <p class="text-xl font-bold text-zinc-500">No match — candidate for a new merchant or rule</p>
            )}
            {result.tags.length > 0 && (
              <p class="text-sm text-amber-300">tags: {result.tags.join(', ')}</p>
            )}
            {result.negativeSkips.length > 0 && (
              <div class="text-xs text-zinc-500">
                {result.negativeSkips.map((s, i) => (
                  <p key={i}>skipped <span class="font-mono">{s.merchantId}</span> (alias "{s.alias}") — negative alias "{s.negative}"</p>
                ))}
              </div>
            )}
          </div>
          <div class="card space-y-2 text-sm">
            <h3 class="text-sm font-semibold text-zinc-300">Cleaning stages</h3>
            <div><p class="label">raw-normalized</p><p class="font-mono text-zinc-300">{result.stages.rawnorm || '∅'}</p></div>
            <div><p class="label">light (regex + phrases)</p><p class="font-mono text-zinc-300">{result.stages.light || '∅'}</p></div>
            <div><p class="label">full (noise words removed)</p><p class="font-mono text-zinc-300">{result.stages.full || '∅'}</p></div>
            {result.stages.prefixRemainder && (
              <div><p class="label">processor prefix detected → remainder</p><p class="font-mono text-amber-300">{result.stages.prefixRemainder}</p></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
