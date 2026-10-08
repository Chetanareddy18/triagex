import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.VITE_DEV_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/socket.io': { target: api, ws: true, changeOrigin: true },
    },
  },
  preview: {
    port: Number(process.env.PORT ?? 4173),
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/socket.io': { target: api, ws: true, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 600, // recharts is lazy-loaded with the dashboard
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;
          if (/recharts|d3-|victory/.test(id)) return 'charts';
          return 'vendor';
        },
      },
    },
  },
});
