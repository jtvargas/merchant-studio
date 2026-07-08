import { useEffect, useState } from 'preact/hooks';
import type { MccDoc, Manifest } from '../lib/schema';
import { loadAll } from '../lib/store';
import { buildIntegrationPrompt, INTEGRATION_STACKS } from '../lib/integrate';
import { copyToClipboard } from '../lib/clipboard';

export default function IntegrateCard() {
  const [mcc, setMcc] = useState<MccDoc | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [stack, setStack] = useState('swift');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll().then(({ docs }) => {
      setMcc(docs.mcc);
      setManifest(docs.manifest);
    });
  }, []);

  const copy = async () => {
    if (!mcc || !manifest) return;
    const ok = await copyToClipboard(buildIntegrationPrompt(stack, mcc, manifest));
    if (ok) {
      setCopied(true);
      setError(null);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError('Could not access the clipboard — allow clipboard permission and try again.');
    }
  };

  return (
    <div class="space-y-3">
      <div>
        <p class="label">1 · Pick your stack</p>
        <div class="flex flex-wrap gap-1.5">
          {INTEGRATION_STACKS.map((s) => (
            <button
              key={s.id}
              type="button"
              class={`chip cursor-pointer transition-colors ${
                s.id === stack
                  ? 'border-emerald-600 bg-emerald-900/30 text-emerald-300'
                  : 'hover:border-zinc-600 hover:text-zinc-200'
              }`}
              onClick={() => setStack(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p class="label">2 · Copy the implementation prompt</p>
        <button
          type="button"
          class={`btn ${copied ? 'border-emerald-600 text-emerald-300' : ''}`}
          disabled={!mcc || !manifest}
          onClick={copy}
        >
          {copied ? '✓ Copied' : mcc ? '📋 Copy LLM prompt' : 'Loading dataset…'}
        </button>
        <p class="mt-1 text-xs text-zinc-500">
          Paste it into ChatGPT / Claude / Gemini — it contains the endpoints, the update contract, all six data
          models, the exact matching algorithm, stack-specific deliverables, and acceptance tests (score against
          the {manifest?.fileCounts.testDescriptors ?? 285} labeled descriptors).
        </p>
      </div>
      <p class="text-xs text-zinc-500">
        3 · Prefer reading it yourself? The same content lives in the{' '}
        <a
          class="text-emerald-400 hover:underline"
          href="https://github.com/jtvargas/merchant-studio/blob/main/docs/CLIENT_INTEGRATION.md"
          target="_blank"
          rel="noreferrer"
        >
          client integration guide
        </a>
        .
      </p>
      {error && <p class="rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
