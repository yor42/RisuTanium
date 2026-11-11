// Serves the patched Svelte client runtime files kept beside this file (proxy.js and index.js) in place of the
// installed originals, for builds, tests and the dev server alike. It throws unless the installed Svelte is exactly
// the version, and the originals are exactly the bytes, the patch was made from, so a Svelte upgrade can never run
// against a stale patch. Paths are relative to this file, so it works from any checkout. It lives in `patches/`
// because the Docker build context keeps that folder (see .dockerignore).
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PATCH_DIR = fileURLToPath(new URL('.', import.meta.url))
const PINNED_VERSION = '5.57.3'
const ORIGINAL_SHA256 = {
  proxy: 'ce6032b1b6bbed3241ad25bb05ba3bf37750eb2edbcd61ba0d9ce2d15e216bfa',
  index: '5b16e981b8093b9c49512fc642c1b8364e8b1f4a3e3a4731446cc70032c523a9',
}

const withoutQuery = (id) => id.replace(/\\/g, '/').split('?')[0]

export function svelteProxyPatch() {
  return {
    name: 'risu-svelte-proxy-patch',
    enforce: 'pre',
    load(id) {
      const path = withoutQuery(id)
      const match = /^(.*\/svelte)\/src\/internal\/client\/(proxy|index)\.js$/.exec(path)
      if (match === null) return null
      const [, packageDir, file] = match
      const version = JSON.parse(readFileSync(packageDir + '/package.json', 'utf8')).version
      if (version !== PINNED_VERSION) {
        throw new Error(`risu-svelte-proxy-patch: installed svelte ${version} at ${packageDir}, the patch was made for ${PINNED_VERSION}`)
      }
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
      if (hash !== ORIGINAL_SHA256[file]) {
        throw new Error(`risu-svelte-proxy-patch: installed ${file}.js differs from the ${PINNED_VERSION} original the patch was made from`)
      }
      return readFileSync(PATCH_DIR + file + '.js', 'utf8')
    },
  }
}
