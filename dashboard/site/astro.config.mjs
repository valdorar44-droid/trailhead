import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoNodeModules = path.join(repoRoot, 'node_modules');

export default defineConfig({
  site: 'https://api.gettrailhead.app',
  output: 'static',
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: {
        allow: [repoRoot, repoNodeModules],
      },
    },
  },
});
