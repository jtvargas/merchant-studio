import { useEffect, useState } from 'preact/hooks';
import { detectMode, draftCount, clearDrafts, loadAll, type Mode } from '../lib/store';
import { downloadZip } from '../lib/export';
import PublishPanel from './PublishPanel';

export default function ModeBadge() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [drafts, setDrafts] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    detectMode().then(setMode);
    setDrafts(draftCount());
    const t = setInterval(() => setDrafts(draftCount()), 2000);
    return () => clearInterval(t);
  }, []);

  const exportZip = async () => {
    setBusy(true);
    try {
      const { docs } = await loadAll();
      downloadZip(docs);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex items-center gap-2 text-xs">
      {mode === 'local' && (
        <span class="chip border-emerald-700 text-emerald-300" title="Running locally — saves write straight to data/*.json">
          ● local · writes to data/
        </span>
      )}
      {mode === 'static' && (
        <span class="chip border-sky-800 text-sky-300" title="Static hosting — edits are browser drafts until you export">
          ● read-only host · drafts in browser
        </span>
      )}
      {mode === 'static' && drafts > 0 && (
        <button
          class="chip border-amber-700 text-amber-300 cursor-pointer"
          title="Click to discard all local drafts"
          onClick={() => {
            if (confirm(`Discard ${drafts} draft change(s)?`)) {
              clearDrafts();
              setDrafts(0);
              location.reload();
            }
          }}
        >
          {drafts} draft{drafts === 1 ? '' : 's'} ✕
        </button>
      )}
      <button class="btn" disabled={busy} onClick={exportZip} title="Download the full pack (6 JSON files, manifest recomputed, drafts merged)">
        {busy ? 'Exporting…' : '⬇ Export pack'}
      </button>
      {mode && <PublishPanel mode={mode} />}
    </div>
  );
}
