import { build } from 'esbuild'
import { readdirSync, readFileSync } from 'node:fs'

const migrations = readdirSync('migrations')
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ id: name.replace(/\.sql$/, ''), sql: readFileSync(`migrations/${name}`, 'utf8') }))

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/worker.js',
  define: {
    __MIGRATIONS__: JSON.stringify(migrations),
  },
  banner: {
    js: '/* Meridian desk worker. One bundled ESM module for the Cloudflare API upload. */',
  },
})

console.log('wrote dist/worker.js')
