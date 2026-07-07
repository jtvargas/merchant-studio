import { useEffect, useState } from 'preact/hooks';
import type { Merchant, MccDoc } from '../lib/schema';
import { loadAll, withBase } from '../lib/store';
import { buildLlmPrompt, parseLlmJson } from '../lib/llm';
import MerchantForm, { EMPTY_MERCHANT } from './MerchantForm';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function AiAssist({ mcc, onImport }: { mcc: MccDoc; onImport: (m: Merchant, warnings: string[]) => void }) {
  const [descriptor, setDescriptor] = useState('');
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const copyPrompt = async () => {
    const ok = await copyToClipboard(buildLlmPrompt(descriptor, mcc));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setStatus({ kind: 'ok', text: 'Prompt copied — paste it into ChatGPT / Claude / Gemini. The AI is instructed to research and verify (using web search or subagents when it has them) and answer with confidence ≥ 0.83.' });
    } else {
      setStatus({ kind: 'err', text: 'Could not access the clipboard — allow clipboard permission and try again.' });
    }
  };

  const importJson = () => {
    const result = parseLlmJson(pasted, mcc);
    if ('error' in result) {
      setStatus({ kind: 'err', text: result.error });
      return;
    }
    onImport(result.entry, result.warnings);
    setPasted('');
    setStatus({
      kind: 'ok',
      text: `Form filled with "${result.entry.canonicalName || result.entry.id}" — step 3: review the fields and warnings below, then save.`,
    });
  };

  return (
    <details class="card" open>
      <summary class="cursor-pointer text-sm font-semibold text-zinc-200">
        ✨ Fill with an LLM <span class="ml-1 font-normal text-zinc-500">copy a prompt → paste the JSON reply → review &amp; save</span>
      </summary>
      <div class="mt-4 space-y-4">
        <div>
          <label class="label">1 · Copy the prompt (with your descriptor baked in)</label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input
              class="input font-mono"
              placeholder="e.g. PANADERIA LA ESPIGA SANTO DOMINGO  (optional — the prompt has a placeholder)"
              value={descriptor}
              onInput={(e) => setDescriptor((e.target as HTMLInputElement).value)}
            />
            <button type="button" class={`btn shrink-0 ${copied ? 'border-emerald-600 text-emerald-300' : ''}`} onClick={copyPrompt}>
              {copied ? '✓ Copied' : '📋 Copy LLM prompt'}
            </button>
          </div>
          <p class="mt-1 text-xs text-zinc-500">
            The prompt makes the AI research each field (web search/subagents when available), forbids guessing and filler notes, and requires confidence ≥ 0.83.
          </p>
        </div>
        <div>
          <label class="label">2 · Paste the AI's JSON reply</label>
          <textarea
            class="input h-28 font-mono text-xs"
            placeholder={'{ "id": "panaderia_la_espiga", "canonicalName": "Panadería La Espiga", ... }\nMarkdown fences and surrounding text are OK — they get stripped.'}
            value={pasted}
            onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)}
          />
          <button type="button" class="btn btn-primary mt-2" disabled={!pasted.trim()} onClick={importJson}>
            ⤵ Fill form from JSON
          </button>
        </div>
        <p class="text-xs text-zinc-600">3 · Review the pre-filled form below (collisions and invalid values are flagged live), then save.</p>
        {status && (
          <p class={`rounded-lg border px-3 py-2 text-sm ${status.kind === 'ok'
            ? 'border-emerald-700 bg-emerald-900/30 text-emerald-300'
            : 'border-red-800 bg-red-900/30 text-red-300'}`}>
            {status.text}
          </p>
        )}
      </div>
    </details>
  );
}

export default function AddMerchant() {
  const [all, setAll] = useState<Merchant[] | null>(null);
  const [mcc, setMcc] = useState<MccDoc | null>(null);
  const [initial, setInitial] = useState<Merchant>(EMPTY_MERCHANT);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
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
      <AiAssist
        mcc={mcc}
        onImport={(entry, warnings) => {
          setInitial(entry);
          setImportWarnings(warnings);
          setSavedMsg(null);
          setFormKey((k) => k + 1);
        }}
      />
      {importWarnings.length > 0 && (
        <div class="card space-y-1 text-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-zinc-400">Import adjustments</p>
          {importWarnings.map((w, i) => <p key={i} class="tag-warning">⚠ {w}</p>)}
        </div>
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
            setImportWarnings([]);
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
