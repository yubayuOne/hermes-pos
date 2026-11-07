import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { securityHeaders } from '../../security-headers';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Precompressed .gz and .br copies of the built assets: the server sends them as they are (no compression work per request).
  plugins: [
    tanstackStart(),
    nitro({ compressPublicAssets: { gzip: true, brotli: true }, routeRules: { '/**': { headers: securityHeaders } } }),
    viteReact(),
    tailwindcss(),
  ],
});
