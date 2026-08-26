// 构建 dsh 客户端模块：src/client → lib/client.js
// 输出为 dsh client-modules 要求的 __ModuleLoader__.load({id, factory}) 格式（CJS）。
import { build } from 'esbuild'

const ID = 'rulebase'

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: 'lib/client.js',
  jsx: 'automatic',
  // react 由 dsh 客户端 shell 的模块表提供（require("react")）
  external: ['react', 'react/jsx-runtime'],
  sourcemap: true,
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      `var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
    ].join('\n'),
  },
  footer: { js: '\nreturn module.exports; } });' },
})