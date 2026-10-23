import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// The browser calls the API through the frontend origin (/api/...), so no CORS is needed.
// 127.0.0.1 rather than localhost: Node may resolve localhost to ::1 while the API listens on IPv4.
const apiTarget = process.env.FLOWTRACE_API_TARGET ?? 'http://127.0.0.1:3001';

const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api(?=\/|\?|$)/, '') || '/',
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    proxy: apiProxy,
  },
});
