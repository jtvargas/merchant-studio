import { useState } from 'preact/hooks';
import { loadAll, loadDrafts, clearDrafts, draftCount, withBase, type Mode } from '../lib/store';
import { buildFiles } from '../lib/export';
import { buildDeltaPayload, buildSuggestionIssueUrl, buildPrBodyFromSummary, summaryOfDrafts, REPO_URL } from '../lib/publish';
import { whoAmI, createDataPr, GhAuthError, OWNER, REPO } from '../lib/github';

const TOKEN_CODE_URL = `${REPO_URL}/blob/main/src/lib/github.ts`;
const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

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

function TokenSetup({ onReady }: { onReady: (token: string, login: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const t = value.trim();
      const me = await whoAmI(t);
      setValue('');
      onReady(t, me.login);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-2">
      <p class="text-xs text-zinc-300">
        Paste a GitHub token to create the pull request straight from this page:
      </p>
      <div class="flex gap-2">
        <input
          class="input font-mono"
          type="password"
          placeholder="github_pat_… or ghp_…"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        />
        <button class="btn btn-primary shrink-0" disabled={busy || !value.trim()} onClick={save}>
          {busy ? 'Checking…' : 'Save'}
        </button>
      </div>
      {err && <p class="rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-xs text-red-300">{err}</p>}
      <ul class="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-400">
        <li>🔒 Used <strong>only</strong> to open the data pull request — nothing else.</li>
        <li>🔒 Sent from your browser <strong>directly to api.github.com</strong>; this site has no server and nothing else ever sees it.</li>
        <li>🧠 Held <strong>in memory only</strong> while this tab is open — never saved to localStorage, sessionStorage, or cookies, so no other page on this origin could ever read it.</li>
        <li>🗑️ Discarded <strong>automatically right after your PR is created</strong> (and on reload). You paste it fresh each time.</li>
        <li>
          👀 Don’t trust, verify — <a class="underline text-emerald-400" href={TOKEN_CODE_URL} target="_blank" rel="noopener">read the exact code that uses it (src/lib/github.ts)</a>: it contains no storage calls at all.
        </li>
        <li>
          🎫 <a class="underline text-emerald-400" href={NEW_TOKEN_URL} target="_blank" rel="noopener">Create a fine-grained token</a>:
          Repository access → <em>Only select repositories</em> → <code>{OWNER}/{REPO}</code> (or your fork) · Permissions →
          <em> Contents: Read and write</em> + <em>Pull requests: Read and write</em> · <strong>Expiration: 7 days max</strong>.
          Avoid classic tokens — they grant access to <em>all</em> your public repos.
        </li>
        <li>🍴 Not a collaborator? No problem — the PR is opened from an automatic fork of the repo under your account.</li>
      </ul>
    </div>
  );
}

export default function PublishPanel({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [title, setTitle] = useState(`Data update (${new Date().toISOString().slice(0, 10)})`);
  const [progress, setProgress] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; url?: string } | null>(null);

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
      if (r.ok && body.url) setStatus({ kind: 'ok', text: 'Pull request created:', url: body.url });
      else setStatus({ kind: 'err', text: body.error ?? `Failed (${r.status})` });
    } catch (e) {
      setStatus({ kind: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const createTokenPr = async () => {
    if (!token) return;
    setBusy(true);
    setStatus(null);
    try {
      const { docs, drafts: d } = await loadAll();
      const payload = buildDeltaPayload(d);
      // classify added vs updated against the BASE data (without drafts merged)
      let baseIds = new Set<string>();
      let baseCount = 0;
      try {
        const base = await fetch(withBase('/data/merchant_aliases.json')).then((r) => r.json());
        baseIds = new Set((base.merchants as { id: string }[]).map((m) => m.id));
        baseCount = baseIds.size;
      } catch { /* summary stays approximate */ }
      const body = buildPrBodyFromSummary({
        added: payload.merchants.filter((m) => !baseIds.has(m.id)).map((m) => m.id),
        updated: payload.merchants.filter((m) => baseIds.has(m.id)).map((m) => m.id),
        deleted: payload.deleteMerchants,
        countDeltas: baseCount ? [`merchants: ${baseCount} → ${docs.merchants.merchants.length}`] : [],
        testsNote: payload.replaceTests ? `replaced (${payload.testDescriptors?.length ?? 0})` : undefined,
        via: 'Merchant Studio **⇪ Publish data** button (hosted, GitHub token)',
      });
      const result = await createDataPr(buildFiles(docs), title, body, token, setProgress);
      setTokenState(null);
      setLogin(null);
      setStatus({ kind: 'ok', text: `Pull request created (${result.changedFiles.length} files) — your token was discarded from memory:`, url: result.url });
    } catch (e) {
      if (e instanceof GhAuthError) {
        setTokenState(null);
        setLogin(null);
        setStatus({ kind: 'err', text: `${e.message} — the token was discarded; paste a new one.` });
      } else {
        setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setProgress(null);
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
          ? 'Payload copied to your clipboard — paste it into the issue form that just opened.'
          : 'Payload too large for a prefilled link and clipboard was blocked — use Export instead.',
      });
    } else {
      setStatus({ kind: 'info', text: 'Review the prefilled issue on GitHub and press "Submit new issue".' });
    }
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div class="relative">
      <button class="btn" onClick={() => setOpen(!open)} title="Open a pull request that updates data/">
        ⇪ Publish data
      </button>
      {open && (
        <div class="absolute right-0 top-full z-20 mt-2 w-[28rem] max-w-[92vw] rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-zinc-100">Publish to data/ via pull request</h3>
            <button class="text-zinc-500 hover:text-zinc-200" onClick={() => setOpen(false)}>✕</button>
          </div>

          {mode === 'local' ? (
            <div class="space-y-3">
              <p class="text-xs text-zinc-400">
                Creates a branch from <code>origin/main</code> with your current <code>data/*.json</code> using your own
                git/gh credentials (no token needed locally). Your working tree is not touched.
              </p>
              <input class="input" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
              <button class="btn btn-primary w-full justify-center" disabled={busy} onClick={createLocalPr}>
                {busy ? 'Creating PR…' : 'Create PR now'}
              </button>
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

              {!login ? (
                <TokenSetup onReady={(t, l) => { setTokenState(t); setLogin(l); setStatus({ kind: 'ok', text: `Authenticated as ${l} — token held in memory only.` }); }} />
              ) : (
                <div class="space-y-2">
                  <div class="flex items-center justify-between text-xs">
                    <span class="chip border-emerald-700 text-emerald-300">✓ {login}</span>
                    <button
                      class="text-zinc-500 underline hover:text-zinc-300"
                      onClick={() => { setTokenState(null); setLogin(null); }}
                    >
                      Forget token now
                    </button>
                  </div>
                  <input class="input" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
                  <button class="btn btn-primary w-full justify-center" disabled={busy || nDrafts === 0} onClick={createTokenPr}>
                    {busy ? (progress ?? 'Working…') : 'Create PR with my changes'}
                  </button>
                </div>
              )}

              <button class="btn w-full justify-center text-xs" disabled={nDrafts === 0} onClick={suggestViaIssue}>
                💬 No token? Suggest via GitHub issue instead
              </button>

              {nDrafts > 0 && status?.kind === 'ok' && status.url && (
                <button
                  class="btn w-full justify-center text-xs"
                  onClick={() => {
                    if (confirm(`Clear ${nDrafts} draft change(s) from this browser? (They are captured in the PR.)`)) {
                      clearDrafts();
                      location.reload();
                    }
                  }}
                >
                  🧹 Clear drafts (they're in the PR now)
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
            Only authorized collaborators can merge into <code>main</code> — every PR waits for review. Repo:{' '}
            <a class="underline" href={REPO_URL} target="_blank" rel="noopener">{OWNER}/{REPO}</a>
          </p>
        </div>
      )}
    </div>
  );
}
