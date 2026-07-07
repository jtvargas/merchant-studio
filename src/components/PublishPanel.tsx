import { useState } from 'preact/hooks';
import { loadAll, loadDrafts, clearDrafts, draftCount, withBase, type Mode } from '../lib/store';
import { downloadZip } from '../lib/export';
import { buildDeltaPayload, buildSuggestionIssueUrl, summaryOfDrafts, UPLOAD_URL, REPO_URL } from '../lib/publish';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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

export default function PublishPanel({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(`Update enrichment data (${new Date().toISOString().slice(0, 10)})`);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; url?: string } | null>(null);
  const [showUploadGuide, setShowUploadGuide] = useState(false);

  const drafts = loadDrafts();
  const nDrafts = draftCount(drafts);
  const lines = summaryOfDrafts(drafts);

  const createLocalPr = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(withBase('/api/propose'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const body = (await r.json()) as { url?: string; error?: string };
      if (r.ok && body.url) {
        setStatus({ kind: 'ok', text: 'Pull request created — review and merge it on GitHub:', url: body.url });
      } else {
        setStatus({ kind: 'err', text: body.error ?? `Failed (${r.status})` });
      }
    } catch (e) {
      setStatus({ kind: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const suggestViaIssue = async () => {
    const payload = buildDeltaPayload(drafts);
    const { url, tooLarge, payloadText } = buildSuggestionIssueUrl(payload, lines);
    if (tooLarge) {
      const copied = await copyText(payloadText);
      setStatus({
        kind: 'info',
        text: copied
          ? 'The payload is too big for a prefilled link, so it was COPIED to your clipboard — paste it into the issue form that just opened.'
          : 'Payload too large for a prefilled link and clipboard was blocked — use Export instead.',
      });
    } else {
      setStatus({ kind: 'info', text: 'Review the prefilled issue on GitHub and press "Submit new issue".' });
    }
    window.open(url, '_blank', 'noopener');
  };

  const startUploadFlow = async () => {
    setBusy(true);
    try {
      const { docs } = await loadAll();
      downloadZip(docs);
      setShowUploadGuide(true);
      window.open(UPLOAD_URL, '_blank', 'noopener');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="relative">
      <button class="btn" onClick={() => setOpen(!open)} title="Open a pull request that updates data/">
        ⇪ Publish data
      </button>
      {open && (
        <div class="absolute right-0 top-full z-20 mt-2 w-[26rem] max-w-[90vw] rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-zinc-100">Publish to data/ via pull request</h3>
            <button class="text-zinc-500 hover:text-zinc-200" onClick={() => setOpen(false)}>✕</button>
          </div>

          {mode === 'local' ? (
            <div class="space-y-3">
              <p class="text-xs text-zinc-400">
                Creates a branch from <code>origin/main</code> with your current <code>data/*.json</code>, pushes it with your
                own git/gh credentials, and opens the PR. Your working tree is not touched.
              </p>
              <input class="input" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
              <button class="btn btn-primary w-full justify-center" disabled={busy} onClick={createLocalPr}>
                {busy ? 'Creating PR…' : 'Create PR now'}
              </button>
              <p class="text-[11px] leading-relaxed text-zinc-500">
                Equivalent by hand: <code>git checkout -b data-update && git add data && git commit && git push && gh pr create</code>
              </p>
            </div>
          ) : (
            <div class="space-y-3">
              {lines.length > 0 ? (
                <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-300">
                  <p class="mb-1 font-semibold text-zinc-400">Draft changes in this browser:</p>
                  {lines.slice(0, 8).map((l, i) => <p key={i}>• {l}</p>)}
                  {lines.length > 8 && <p>… and {lines.length - 8} more</p>}
                </div>
              ) : (
                <p class="text-xs text-zinc-500">No draft changes yet — add or edit merchants first.</p>
              )}

              <button class="btn w-full justify-center" disabled={busy} onClick={startUploadFlow}>
                📤 Upload on GitHub → PR <span class="text-zinc-500">(for the repo owner)</span>
              </button>
              {showUploadGuide && (
                <ol class="list-decimal space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3 pl-7 text-xs text-zinc-300">
                  <li>Unzip the pack that just downloaded.</li>
                  <li>Drag the 6 JSON files onto the GitHub upload page that opened (<code>data/</code> folder).</li>
                  <li>Select <strong>"Create a new branch … and start a pull request"</strong>, then <strong>Propose changes</strong>.</li>
                </ol>
              )}

              <button class="btn w-full justify-center" disabled={nDrafts === 0} onClick={suggestViaIssue}>
                💬 Suggest via GitHub issue <span class="text-zinc-500">(anyone)</span>
              </button>
              <p class="text-[11px] leading-relaxed text-zinc-500">
                Opens a prefilled issue with only your changes. The maintainer reviews it and applies it with{' '}
                <code>scripts/apply-update.mjs</code> — no tokens, no bots run on issue content.
              </p>

              {nDrafts > 0 && (
                <button
                  class="btn w-full justify-center text-xs"
                  onClick={() => {
                    if (confirm(`Discard ${nDrafts} draft change(s) from this browser?`)) {
                      clearDrafts();
                      location.reload();
                    }
                  }}
                >
                  🧹 Clear drafts (after your PR/issue is in)
                </button>
              )}
            </div>
          )}

          {status && (
            <p
              class={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                status.kind === 'ok'
                  ? 'border-emerald-700 bg-emerald-900/30 text-emerald-300'
                  : status.kind === 'err'
                    ? 'border-red-800 bg-red-900/30 text-red-300'
                    : 'border-sky-800 bg-sky-900/30 text-sky-300'
              }`}
            >
              {status.text}{' '}
              {status.url && (
                <a class="font-semibold underline" href={status.url} target="_blank" rel="noopener">
                  {status.url.replace('https://github.com/', '')}
                </a>
              )}
            </p>
          )}
          <p class="mt-3 text-[11px] text-zinc-600">
            Repo: <a class="underline" href={REPO_URL} target="_blank" rel="noopener">jtvargas/merchant-studio</a>
          </p>
        </div>
      )}
    </div>
  );
}
