// tsdown 构建配置（dsh 生态标准构建器）：src/host → lib（ESM + .d.ts）
// client 由 scripts/build-client.mjs（esbuild）产出 __ModuleLoader__ 格式。
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/host/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'lib',
  clean: true,
  sourcemap: true,
})