import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import * as path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    // e2e-тесты поднимают приложение и ходят в БД — стандартных 5 секунд
    // не хватает на инициализацию Prisma и Redis.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Изоляция по файлам: тесты трогают общую БД, и параллельный прогон
    // в одном процессе даёт гонки на данных, которые ищутся часами.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      exclude: ['**/*.module.ts', '**/main.ts', 'prisma/**', 'test/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@common': path.resolve(__dirname, 'src/common'),
      '@modules': path.resolve(__dirname, 'src/modules'),
    },
  },
  plugins: [
    // Vitest через esbuild не эмитит метаданные декораторов, и DI в NestJS
    // ломается на этапе создания тестового модуля. SWC их эмитит.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
