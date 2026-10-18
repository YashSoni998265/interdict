/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// VITE_API_MODE=mock (default) serves the recorded engine fixtures in the browser.
// VITE_API_MODE=http talks to the real API at VITE_API_BASE ('' = same origin, as in production,
// where the API serves the built app). The dev server proxies /api to a local API
// (VITE_DEV_API_PROXY, default http://127.0.0.1:8000), so cookies stay same-origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8000';

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: proxyTarget, changeOrigin: true } },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      // elkjs (graph layout) is one ~1.4 MB module. It is loaded lazily, only when a workbench
      // graph is first laid out, so it never blocks the first page.
      chunkSizeWarningLimit: 1600,
      // Fonts stay separate files: the production CSP (deploy/Caddyfile) allows fonts only from
      // 'self', so a small font inlined as a data: URI would be blocked.
      assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
      rollupOptions: {
        output: {
          // Stable vendor chunks: they change less often than app code, so they cache well.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return 'react';
            if (id.includes('@tanstack')) return 'query';
            if (id.includes('@radix-ui')) return 'radix';
            if (id.includes('@xyflow') || id.includes('d3-')) return 'flow';
            return undefined;
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
      testTimeout: 15000,
    },
  };
});
