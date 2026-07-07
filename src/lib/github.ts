/**
 * ──────────────────────────────────────────────────────────────────────────
 *  WHAT YOUR GITHUB TOKEN IS USED FOR — full transparency
 * ──────────────────────────────────────────────────────────────────────────
 *  This file is the ONLY place in Merchant Studio that touches your token.
 *
 *  • It is used exclusively to open a pull request that updates the JSON
 *    files under data/ in jtvargas/merchant-studio (or your fork of it).
 *  • Every request goes directly from YOUR browser to https://api.github.com
 *    — there is no backend, proxy, or analytics; nothing else ever sees it.
 *  • It is stored only in this browser's localStorage
 *    (key "merchant-studio.gh-token.v1") and you can remove it any time with
 *    the "Sign out" button, or revoke it at https://github.com/settings/tokens.
 *  • Recommended token: a fine-grained PAT scoped to ONE repository with
 *    Contents (read/write) + Pull requests (read/write). A classic token with
 *    the "public_repo" scope also works.
 *
 *  API calls made (in order): GET /user · GET /repos/... (permission check) ·
 *  [fork flow if you can't push: POST /forks, POST /merge-upstream] ·
 *  GET git/ref + git/trees · POST git/blobs · POST git/trees ·
 *  POST git/commits · POST git/refs · POST /pulls
 * ──────────────────────────────────────────────────────────────────────────
 */

export const OWNER = 'jtvargas';
export const REPO = 'merchant-studio';
export const BASE_BRANCH = 'main';
const API = 'https://api.github.com';

const TOKEN_KEY = 'merchant-studio.gh-token.v1';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t.trim());
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export class GhAuthError extends Error {}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (r.status === 401 || r.status === 403) {
    const detail = await r.json().catch(() => ({} as { message?: string }));
    throw new GhAuthError(`GitHub rejected the token (${r.status}): ${(detail as { message?: string }).message ?? 'unauthorized'}`);
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`GitHub API ${path} failed (${r.status}): ${detail.slice(0, 300)}`);
  }
  return (await r.json()) as T;
}

export interface Identity {
  login: string;
  canPush: boolean;
}

export async function whoAmI(token: string): Promise<Identity> {
  const user = await gh<{ login: string }>(token, '/user');
  let canPush = false;
  try {
    const repo = await gh<{ permissions?: { push?: boolean } }>(token, `/repos/${OWNER}/${REPO}`);
    canPush = repo.permissions?.push === true;
  } catch { /* fine-grained tokens without repo access still work via fork */ }
  return { login: user.login, canPush };
}

// git blob sha1: sha1("blob <len>\0<content>") — used to skip unchanged files
async function gitBlobSha(content: string): Promise<string> {
  const enc = new TextEncoder();
  const body = enc.encode(content);
  const header = enc.encode(`blob ${body.length}\0`);
  const all = new Uint8Array(header.length + body.length);
  all.set(header);
  all.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CreatePrResult {
  url: string;
  changedFiles: string[];
  branch: string;
}

export async function createDataPr(
  files: Record<string, string>,
  title: string,
  body: string,
  token: string,
  onProgress: (step: string) => void = () => {},
): Promise<CreatePrResult> {
  onProgress('Checking who you are…');
  const me = await whoAmI(token);

  // Where do we push the branch? Base repo for collaborators, else a fork.
  let workOwner = OWNER;
  if (!me.canPush) {
    onProgress('You cannot push to the repo — creating/updating your fork…');
    await gh(token, `/repos/${OWNER}/${REPO}/forks`, { method: 'POST', body: '{}' });
    workOwner = me.login;
    // wait for the fork to be ready, then sync it with upstream main
    for (let i = 0; i < 10; i++) {
      try {
        await gh(token, `/repos/${workOwner}/${REPO}`);
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    try {
      await gh(token, `/repos/${workOwner}/${REPO}/merge-upstream`, {
        method: 'POST',
        body: JSON.stringify({ branch: BASE_BRANCH }),
      });
    } catch { /* new forks are already up to date */ }
  }

  onProgress('Reading the current data files…');
  const ref = await gh<{ object: { sha: string } }>(token, `/repos/${workOwner}/${REPO}/git/ref/heads/${BASE_BRANCH}`);
  const baseSha = ref.object.sha;
  const commit = await gh<{ tree: { sha: string } }>(token, `/repos/${workOwner}/${REPO}/git/commits/${baseSha}`);
  const tree = await gh<{ tree: { path: string; sha: string }[] }>(
    token, `/repos/${workOwner}/${REPO}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  const existing = new Map(tree.tree.filter((t) => t.path.startsWith('data/')).map((t) => [t.path, t.sha]));

  onProgress('Comparing your changes…');
  const changed: { path: string; content: string }[] = [];
  for (const [name, content] of Object.entries(files)) {
    if (name === 'manifest.json') continue; // include only when something else changed (added below)
    const sha = await gitBlobSha(content);
    if (existing.get(`data/${name}`) !== sha) changed.push({ path: `data/${name}`, content });
  }
  if (changed.length === 0) throw new Error('No changes vs the repo — nothing to propose.');
  changed.push({ path: 'data/manifest.json', content: files['manifest.json'] });

  onProgress(`Uploading ${changed.length} file(s)…`);
  const treeEntries = [];
  for (const f of changed) {
    const blob = await gh<{ sha: string }>(token, `/repos/${workOwner}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
    });
    treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await gh<{ sha: string }>(token, `/repos/${workOwner}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeEntries }),
  });
  const newCommit = await gh<{ sha: string }>(token, `/repos/${workOwner}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: title, tree: newTree.sha, parents: [baseSha] }),
  });

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const branch = `data-update-${stamp}`;
  onProgress('Creating the branch…');
  await gh(token, `/repos/${workOwner}/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha }),
  });

  onProgress('Opening the pull request…');
  const pr = await gh<{ html_url: string }>(token, `/repos/${OWNER}/${REPO}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      body,
      base: BASE_BRANCH,
      head: workOwner === OWNER ? branch : `${workOwner}:${branch}`,
      maintainer_can_modify: true,
    }),
  });
  return { url: pr.html_url, changedFiles: changed.map((c) => c.path), branch };
}
