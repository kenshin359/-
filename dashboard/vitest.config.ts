import path from 'node:path';
import { defineConfig } from 'vitest/config';

// tsconfig の paths（@/* → src/*）を Vitest でも解決する
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // Prisma クライアントは生成時に接続文字列が必要（テストでは接続しない）
  test: { environment: 'node', env: { DATABASE_URL: 'file:./test-only.db' } },
});
