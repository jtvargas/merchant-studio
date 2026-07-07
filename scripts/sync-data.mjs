// Copy canonical data/ into public/data/ so the static (GitHub Pages) build can
// fetch the JSON as assets. public/data is gitignored; data/ is the source of truth.
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(`${root}public/data`, { recursive: true });
cpSync(`${root}data`, `${root}public/data`, { recursive: true });
console.log('synced data/ -> public/data/');
