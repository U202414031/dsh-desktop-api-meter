import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'dsh-desktop-api-meter'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-sidebar/client',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-slots',
]

export default defineConfig([
  {
    name: `${PACKAGE_NAME}/host`,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: ['@deepseek-ai/cordis', 'node:*'],
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: CLIENT_EXTERNALS,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
