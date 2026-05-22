import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = String(process.env.VOICE_STREAM_NEXT_API_PORT ?? process.env.PORT ?? '3299').trim();

export default defineConfig({
  plugins: [react()],
  root: 'web',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});

