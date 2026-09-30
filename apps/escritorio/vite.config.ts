import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuración recomendada por Tauri: puerto fijo y sin limpiar la consola.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { target: 'es2022', sourcemap: true },
});
