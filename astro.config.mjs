// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

const isPages = process.env.PAGES === '1';

// Static-first app. API routes (src/pages/api/*) opt out with `prerender = false`
// and are served by the dev server in local mode; the GitHub Pages deploy ships
// only dist/client, so the site runs there in read-only/draft mode.
export default defineConfig({
  output: 'static',
  site: 'https://jtvargas.github.io',
  base: isPages ? '/merchant-studio' : '/',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
  vite: {
    plugins: [tailwindcss()],
  },
});
