import { useMemo, useState } from 'preact/hooks';
import type { Merchant, MccDoc } from '../lib/schema';
import { COUNTRY_HINTS, EMPTY_MERCHANT, isValidCountryHint, normalizeAlias } from '../lib/schema';
import { validateMerchant, type FieldIssue } from '../lib/validation';
import { saveMerchant } from '../lib/store';

export { EMPTY_MERCHANT };

export interface MerchantFormProps {
  initial: Merchant;
  isNew: boolean;
  all: Merchant[];
  mcc: MccDoc;
  onSaved: (m: Merchant, mode: string) => void;
  onCancel?: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h4 class="border-b border-zinc-800 pb-1 text-xs font-bold uppercase tracking-widest text-zinc-500">
      {children}
    </h4>
  );
}

function ChipListInput(props: {
  label: string;
  values: string[];
  placeholder: string;
  normalize?: boolean;
  onChange: (v: string[]) => void;
  hint?: string;
  hasError?: boolean;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const raw = text.trim();
    if (!raw) return;
    const items = raw.split(',').map((s) => (props.normalize ? normalizeAlias(s) : s.trim())).filter(Boolean);
    const next = [...props.values];
    for (const it of items) if (!next.includes(it)) next.push(it);
    props.onChange(next);
    setText('');
  };
  return (
    <div>
      <label class="label">{props.label}</label>
      <div class="flex gap-2">
        <input
          class={`input ${props.hasError ? 'border-red-700' : ''}`}
          value={text}
          placeholder={props.placeholder}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" class="btn" onClick={add}>Add</button>
      </div>
      {props.hint && <p class="mt-1 text-xs text-zinc-500">{props.hint}</p>}
      <div class="mt-2 flex flex-wrap gap-1.5">
        {props.values.map((v) => (
          <span class="chip" key={v}>
            {v}
            <button
              type="button"
              class="text-zinc-500 hover:text-red-400"
              onClick={() => props.onChange(props.values.filter((x) => x !== v))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MerchantForm({ initial, isNew, all, mcc, onSaved, onCancel }: MerchantFormProps) {
  const [m, setM] = useState<Merchant>({ ...initial });
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [mccQuery, setMccQuery] = useState('');
  const [countryCode, setCountryCode] = useState('');

  const taxonomy = useMemo(() => mcc.categoryTaxonomy.map((t) => t.id), [mcc]);
  const mccCodes = useMemo(() => new Set(Object.keys(mcc.mcc)), [mcc]);
  const subcategorySuggestions = useMemo(() => {
    const bag = new Set<string>();
    for (const x of all) if (x.category === m.category && x.subcategory) bag.add(x.subcategory);
    return [...bag].sort();
  }, [all, m.category]);

  const issues: FieldIssue[] = useMemo(
    () => validateMerchant(m, all, mccCodes, new Set(taxonomy), isNew ? undefined : initial.id),
    [m, all, mccCodes, taxonomy, isNew, initial.id],
  );
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const hasError = (f: string) => issues.some((i) => i.field === f && i.level === 'error');
  const errClass = (f: string) => (hasError(f) ? 'border-red-700' : '');

  const set = <K extends keyof Merchant>(k: K, v: Merchant[K]) => setM((prev) => ({ ...prev, [k]: v }));

  const mccMatches = useMemo(() => {
    const q = mccQuery.trim().toLowerCase();
    if (!q) return [];
    return Object.values(mcc.mcc)
      .filter((e) => e.code.startsWith(q) || e.description.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mccQuery, mcc]);

  const addCountryCode = () => {
    const code = countryCode.trim().toUpperCase();
    if (!code) return;
    if (!isValidCountryHint(code)) {
      setCountryCode('');
      set('countryHints', [...m.countryHints, code]); // shows the inline error so the user sees why
      return;
    }
    if (!m.countryHints.includes(code)) set('countryHints', [...m.countryHints, code]);
    setCountryCode('');
  };

  const extraCountries = m.countryHints.filter((c) => !(COUNTRY_HINTS as readonly string[]).includes(c));

  const confidenceLabel =
    m.defaultConfidence >= 0.95 ? 'exact / verified' :
    m.defaultConfidence >= 0.9 ? 'distinctive (default)' :
    m.defaultConfidence >= 0.83 ? 'short / risky aliases' : 'below LLM floor (manual only)';

  const submit = async (e: Event) => {
    e.preventDefault();
    if (errors.length) return;
    setSaving(true);
    setServerError(null);
    try {
      const mode = await saveMerchant(m, isNew, initial.id);
      onSaved(m, mode);
    } catch (err) {
      setServerError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} class="space-y-5">
      <SectionTitle>Identity — who is this merchant?</SectionTitle>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="label">id (snake_case)</label>
          <input
            class={`input font-mono ${errClass('id')}`}
            value={m.id}
            placeholder="pollo_tropical"
            disabled={!isNew}
            onInput={(e) => set('id', (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
          />
          <p class="mt-1 text-xs text-zinc-500">Permanent unique key — auto-filled from the name.</p>
        </div>
        <div>
          <label class="label">Canonical name</label>
          <input class={`input ${errClass('canonicalName')}`} value={m.canonicalName} placeholder="Pollo Tropical"
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setM((prev) => ({
                ...prev,
                canonicalName: v,
                displayName: prev.displayName === prev.canonicalName || !prev.displayName ? v : prev.displayName,
                id: isNew && (!prev.id || prev.id === normalizeAlias(prev.canonicalName).replace(/[^a-z0-9]+/g, '_'))
                  ? normalizeAlias(v).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                  : prev.id,
              }));
            }} />
          <p class="mt-1 text-xs text-zinc-500">The proper brand name.</p>
        </div>
        <div>
          <label class="label">Display name</label>
          <input class={`input ${errClass('displayName')}`} value={m.displayName} onInput={(e) => set('displayName', (e.target as HTMLInputElement).value)} />
          <p class="mt-1 text-xs text-zinc-500">What the user sees on the transaction.</p>
        </div>
        <div>
          <label class="label">Website</label>
          <input class="input" value={m.website ?? ''} placeholder="example.com"
            onInput={(e) => set('website', (e.target as HTMLInputElement).value || null)} />
        </div>
      </div>

      <SectionTitle>Classification — where does the spend belong?</SectionTitle>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="label">Category</label>
          <select class={`input ${errClass('category')}`} value={m.category} onInput={(e) => set('category', (e.target as HTMLSelectElement).value)}>
            {taxonomy.map((t) => <option value={t} key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label class="label">Subcategory</label>
          <input class="input" list="subcat-suggestions" value={m.subcategory}
            placeholder="fast_casual"
            onInput={(e) => set('subcategory', (e.target as HTMLInputElement).value.toLowerCase().replace(/\s+/g, '_'))} />
          <datalist id="subcat-suggestions">
            {subcategorySuggestions.map((s) => <option value={s} key={s} />)}
          </datalist>
          <p class="mt-1 text-xs text-zinc-500">Suggestions come from existing merchants in this category.</p>
        </div>
      </div>
      <div>
        <label class="label">MCC hints <span class="normal-case text-zinc-600">— card-network category codes; search by name (e.g. "pharmacy")</span></label>
        <div class="flex flex-wrap items-center gap-1.5">
          {m.mccHints.map((h) => (
            <span class="chip font-mono" key={h}>
              {h} <span class="text-zinc-500">{mcc.mcc[h]?.description ?? '??'}</span>
              <button type="button" class="text-zinc-500 hover:text-red-400"
                onClick={() => set('mccHints', m.mccHints.filter((x) => x !== h))}>✕</button>
            </span>
          ))}
        </div>
        <input class={`input mt-2 ${errClass('mccHints')}`} value={mccQuery} placeholder="Search MCC by code or description…"
          onInput={(e) => setMccQuery((e.target as HTMLInputElement).value)} />
        {mccMatches.length > 0 && (
          <div class="mt-1 overflow-hidden rounded-lg border border-zinc-700">
            {mccMatches.map((e) => (
              <button type="button" key={e.code}
                class="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-800"
                onClick={() => {
                  if (!m.mccHints.includes(e.code)) set('mccHints', [...m.mccHints, e.code]);
                  setMccQuery('');
                }}>
                <span class="font-mono text-emerald-400">{e.code}</span> {e.description}
                <span class="text-zinc-500"> · {e.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label class="label">Country hints <span class="normal-case text-zinc-600">— where this merchant operates</span></label>
        <div class="flex flex-wrap gap-2">
          {COUNTRY_HINTS.map((c) => (
            <label key={c} class={`chip cursor-pointer ${m.countryHints.includes(c) ? 'border-emerald-600 text-emerald-300' : ''}`}>
              <input type="checkbox" class="hidden" checked={m.countryHints.includes(c)}
                onChange={() => set('countryHints', m.countryHints.includes(c)
                  ? m.countryHints.filter((x) => x !== c)
                  : [...m.countryHints, c])} />
              {c}
            </label>
          ))}
        </div>
        {extraCountries.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-1.5">
            {extraCountries.map((c) => (
              <span key={c} class={`chip ${isValidCountryHint(c) ? 'border-emerald-600 text-emerald-300' : 'border-red-700 text-red-300'}`}>
                {c}
                <button type="button" class="text-zinc-500 hover:text-red-400"
                  onClick={() => set('countryHints', m.countryHints.filter((x) => x !== c))}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div class="mt-2 flex gap-2">
          <input
            class={`input w-40 font-mono uppercase ${errClass('countryHints')}`}
            value={countryCode}
            maxLength={6}
            placeholder="other: KR, TW…"
            onInput={(e) => setCountryCode((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCountryCode(); } }}
          />
          <button type="button" class="btn" onClick={addCountryCode}>Add code</button>
        </div>
        <p class="mt-1 text-xs text-zinc-500">Any ISO 3166-1 alpha-2 code works (HK, JP, KR…), plus LATAM / EU / APAC / GLOBAL.</p>
      </div>

      <SectionTitle>Matching — how do we recognize it on statements?</SectionTitle>
      <ChipListInput
        label="Aliases"
        values={m.aliases}
        placeholder="pollo tropical, pollo trop  (comma-separated, Enter to add)"
        normalize
        hasError={hasError('aliases')}
        hint={'Exactly how it appears on real statements — truncations ("pollo trop"), domains ("chewy.com"), processor forms. Auto-normalized to lowercase ASCII. Avoid bare dictionary words like "total" or "light".'}
        onChange={(v) => set('aliases', v)}
      />
      <ChipListInput
        label="Negative aliases"
        values={m.negativeAliases}
        placeholder="e.g. oxxo gas on the OXXO store entry"
        normalize
        hint="If any of these words appear in a descriptor, this merchant is SKIPPED — use them to separate sibling brands."
        onChange={(v) => set('negativeAliases', v)}
      />
      <div>
        <label class="label">
          Confidence: <span class="text-emerald-400">{m.defaultConfidence.toFixed(2)}</span>{' '}
          <span class="normal-case text-zinc-500">({confidenceLabel})</span>
        </label>
        <input type="range" min="0.5" max="0.99" step="0.01" class="w-full accent-emerald-500"
          value={m.defaultConfidence}
          onInput={(e) => set('defaultConfidence', parseFloat((e.target as HTMLInputElement).value))} />
        <div class="flex justify-between text-[10px] text-zinc-600">
          <span>0.50 manual only</span>
          <span>0.83 LLM floor / risky</span>
          <span>0.92 default</span>
          <span>0.99 exact</span>
        </div>
      </div>

      <SectionTitle>Metadata</SectionTitle>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="label">Icon slug</label>
          <input class="input font-mono" value={m.iconSlug ?? ''} placeholder="pollotropical"
            onInput={(e) => set('iconSlug', (e.target as HTMLInputElement).value || null)} />
        </div>
        <div>
          <label class="label">Notes</label>
          <input class="input" value={m.notes ?? ''} placeholder='useful reviewer note, e.g. "statements truncate to POLLO TROP"'
            onInput={(e) => set('notes', (e.target as HTMLInputElement).value || null)} />
          <p class="mt-1 text-xs text-zinc-500">Leave empty unless it genuinely helps — no filler.</p>
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0 || serverError) && (
        <div class="card space-y-1 text-sm">
          {serverError && <p class="tag-error">✗ {serverError}</p>}
          {errors.map((i, idx) => <p key={idx} class="tag-error">✗ [{i.field}] {i.message}</p>)}
          {warnings.map((i, idx) => <p key={idx} class="tag-warning">⚠ [{i.field}] {i.message}</p>)}
        </div>
      )}

      <div class="flex gap-2">
        <button type="submit" class="btn btn-primary" disabled={saving || errors.length > 0}>
          {saving ? 'Saving…' : isNew ? 'Add merchant' : 'Save changes'}
        </button>
        {onCancel && <button type="button" class="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
