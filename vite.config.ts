import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  const disableHMR = process.env.DISABLE_HMR === 'true';

  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    server: {
      hmr: !disableHMR,
      watch: disableHMR ? null : {},
      cors: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },

    build: {
      sourcemap: isDev,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            audio: ['jszip'],
          },
        },
      },
    },

    optimizeDeps: {
      include: ['lucide-react', 'jszip', 'fast-xml-parser'],
    },
  };
});