// Node-backed web development (`pnpm dev:server`): the Vite dev server serves the
// front end and forwards the Node server's own routes, so the page runs in the
// same mode as one served by server/node/server.cjs.
import { existsSync } from 'node:fs'
import path from 'node:path'

/** The flag server.cjs prepends to the page head; `isNodeServer` reads it. */
export const NODE_FLAG_SOURCE = 'globalThis.__NODE__ = true'

/**
 * Every path server.cjs answers besides the static build: the storage and
 * auth API, both provider proxies, the hub proxy and the stream-job routes,
 * whose `/ws` sockets are upgraded. Anchored so a source path that merely
 * starts with the same letters stays with Vite.
 */
export const NODE_ROUTE_PATTERN = '^/(api|proxy|proxy2|hub-proxy|proxy-stream-jobs)(/|\\?|$)'

/** Vite's `server.proxy` table that sends the Node routes to `target`. */
export function nodeRouteProxy(target) {
    return {
        [NODE_ROUTE_PATTERN]: {
            target,
            ws: true,
            // The server's own certificate is self-signed and is only reached on loopback.
            secure: false,
        },
    }
}

/**
 * Vite plugin for the dev server only: proxies the Node routes to `target` and
 * puts the Node flag first in the page head, ahead of any module script.
 */
export function nodeDevPlugin(target) {
    return {
        name: 'risu-node-dev',
        apply: 'serve',
        config() {
            return { server: { proxy: nodeRouteProxy(target) } }
        },
        transformIndexHtml() {
            return [{ tag: 'script', children: NODE_FLAG_SOURCE, injectTo: 'head-prepend' }]
        },
    }
}

function portFrom(env, name, fallback) {
    const raw = env[name]
    if (raw === undefined || raw === '') {
        return fallback
    }
    const port = Number(raw)
    if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== raw) {
        throw new Error(`${name} must be a port number from 1 to 65535, got "${raw}"`)
    }
    return String(port)
}

/**
 * True when server.cjs started in `serverDir` will serve HTTPS: it does so when
 * its key and certificate exist under the working folder.
 */
export function serverUsesHttps(serverDir, exists = existsSync) {
    const sslPath = path.join(serverDir, 'server', 'node', 'ssl', 'certificate')
    return exists(path.join(sslPath, 'server.key')) && exists(path.join(sslPath, 'server.crt'))
}

/**
 * The two processes `pnpm dev:server` starts. The Node server binds only the
 * loopback address (Vite is the one reachable page) and keeps its `save/`
 * folder under RISU_DEV_SERVER_DIR, the repository root when unset. Arguments
 * after the script name go to Vite.
 */
export function devServerPlan({ root, env, argv, execPath, exists = existsSync }) {
    const nodePort = portFrom(env, 'RISU_DEV_NODE_PORT', '6001')
    const nodeHost = env.RISU_DEV_NODE_HOST || '127.0.0.1'
    const serverDir = env.RISU_DEV_SERVER_DIR ? path.resolve(env.RISU_DEV_SERVER_DIR) : root
    const scheme = serverUsesHttps(serverDir, exists) ? 'https' : 'http'
    // A wildcard bind is not an address to connect to; Vite reaches it on loopback.
    const connectHost = nodeHost === '0.0.0.0' ? '127.0.0.1' : nodeHost === '::' ? '::1' : nodeHost
    const target = `${scheme}://${connectHost.includes(':') ? `[${connectHost}]` : connectHost}:${nodePort}`
    return {
        serverDir,
        target,
        node: {
            command: execPath,
            args: [path.join(root, 'server', 'node', 'server.cjs')],
            cwd: serverDir,
            env: { ...env, PORT: nodePort, HOST: nodeHost },
        },
        vite: {
            command: execPath,
            args: [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ...argv],
            cwd: root,
            env: { ...env, RISU_DEV_NODE_TARGET: target },
        },
    }
}
