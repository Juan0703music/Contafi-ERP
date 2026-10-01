import { defineConfig } from 'vitest/config';

// Cada archivo crea su propia base PGlite y aplica todas las migraciones en beforeAll: con todo el
// monorepo probándose en paralelo eso supera los 10 s por defecto (fallaba de forma intermitente).
export default defineConfig({ test: { hookTimeout: 60_000, testTimeout: 30_000 } });
