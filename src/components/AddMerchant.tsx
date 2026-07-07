import { useEffect, useState } from 'preact/hooks';
import type { Merchant, MccDoc } from '../lib/schema';
import { loadAll, withBase } from '../lib/store';
import MerchantForm, { EMPTY_MERCHANT } from './MerchantForm';

export default function AddMerchant() {
  const [all, setAll] = useState<Merchant[] | null>(null);
  const [mcc, setMcc] = useState<MccDoc | null>(null);
  const [initial, setInitial] = useState<Merchant>(EMPTY_MERCHANT);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    loadAll().then(({ docs }) => {
      setAll(docs.merchants.merchants);
      setMcc(docs.mcc);
      const from = new URLSearchParams(location.search).get('from');
      if (from) {
        const src = docs.merchants.merchants.find((m) => m.id === from);
        if (src) {
          setInitial({ ...src, id: `${src.id}_copy`, canonicalName: `${src.canonicalName} (copy)` });
          setFormKey((k) => k + 1);
        }
      }
    });
  }, []);

  if (!all || !mcc) return <p class="text-zinc-500">Loading…</p>;

  return (
    <div class="max-w-3xl space-y-4">
      {savedMsg && (
        <p class="rounded-lg border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-300">
          {savedMsg}
        </p>
      )}
      <div class="card">
        <MerchantForm
          key={formKey}
          initial={initial}
          isNew
          all={all}
          mcc={mcc}
          onSaved={(m, mode) => {
            setSavedMsg(
              mode === 'local'
                ? `✓ ${m.id} added to data/merchant_aliases.json — remember to commit. `
                : `✓ ${m.id} saved as a browser draft — use Export to download the updated files. `,
            );
            setAll((prev) => (prev ? [...prev.filter((x) => x.id !== m.id), m] : prev));
            setInitial(EMPTY_MERCHANT);
            setFormKey((k) => k + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>
      {savedMsg && (
        <p class="text-sm text-zinc-400">
          <a class="text-emerald-400 underline" href={withBase('/merchants')}>Browse merchants</a> or add another one above.
        </p>
      )}
    </div>
  );
}
