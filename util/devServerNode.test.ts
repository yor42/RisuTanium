/**
 * `pnpm dev:server`: the Vite dev server must present the page in Node-server mode
 * (the `__NODE__` flag ahead of the app's module script) and forward exactly the
 * routes server/node/server.cjs answers; the launcher must keep the Node server on
 * the loopback address with its data where the caller asked.
 * Labels: regression reproducers for the new mode (they fail before this change,
 * where neither the plugin nor the launcher exists). The launcher's process
 * handling and the vite.config.ts wiring have no automated test.
 */
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { devServerPlan, NODE_FLAG_SOURCE, NODE_ROUTE_PATTERN, nodeDevPlugin, nodeRouteProxy } from './devServerNode.mjs'

const root = path.resolve('/repo')

describe('nodeDevPlugin', () => {
    test('prepends the Node flag to the head, matching what server.cjs injects', () => {
        const plugin = nodeDevPlugin('http://127.0.0.1:6001')
        expect(plugin.apply).toBe('serve')
        expect(plugin.transformIndexHtml()).toEqual([
            { tag: 'script', children: 'globalThis.__NODE__ = true', injectTo: 'head-prepend' },
        ])
        // The flag text is the one platform.ts reads.
        const flagged: { __NODE__?: boolean } = {}
        new Function('globalThis', NODE_FLAG_SOURCE)(flagged)
        expect(flagged.__NODE__).toBe(true)
    })

    test('adds the Node route proxy, with WebSocket upgrades, to the dev server config', () => {
        const plugin = nodeDevPlugin('http://127.0.0.1:7001')
        expect(plugin.config()).toEqual({
            server: { proxy: { [NODE_ROUTE_PATTERN]: { target: 'http://127.0.0.1:7001', ws: true, secure: false } } },
        })
        expect(nodeRouteProxy('http://x')[NODE_ROUTE_PATTERN].ws).toBe(true)
    })
})

describe('NODE_ROUTE_PATTERN', () => {
    const route = new RegExp(NODE_ROUTE_PATTERN)
    test.each([
        '/api/read?path=x',
        '/api/asset/0a1b',
        '/api/test_auth',
        '/proxy',
        '/proxy?url=x',
        '/proxy2',
        '/hub-proxy/realm/list',
        '/proxy-stream-jobs',
        '/proxy-stream-jobs/abc/ws?ticket=t',
    ])('forwards %s to the Node server', (url) => {
        expect(route.test(url)).toBe(true)
    })

    test.each([
        '/',
        '/index.html',
        '/src/main.ts',
        '/@vite/client',
        '/apikeys.json',
        '/proxyless/x',
        '/proxy3',
        '/node_modules/.vite/deps/x.js',
    ])('leaves %s to Vite', (url) => {
        expect(route.test(url)).toBe(false)
    })
})

describe('devServerPlan', () => {
    const base = { root, argv: [], execPath: '/node', exists: () => false }

    test('defaults: port 6001 on loopback, data under the repository root, Vite pointed at it', () => {
        const plan = devServerPlan({ ...base, env: { KEEP: '1', HOST: '0.0.0.0', PORT: '9999' } })
        expect(plan.serverDir).toBe(root)
        expect(plan.target).toBe('http://127.0.0.1:6001')
        expect(plan.node.args).toEqual([path.join(root, 'server', 'node', 'server.cjs')])
        expect(plan.node.cwd).toBe(root)
        // The caller's HOST and PORT never reach the Node server; the dev ones do.
        expect(plan.node.env).toMatchObject({ KEEP: '1', HOST: '127.0.0.1', PORT: '6001' })
        expect(plan.vite.cwd).toBe(root)
        expect(plan.vite.args).toEqual([path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')])
        expect(plan.vite.env).toMatchObject({ KEEP: '1', RISU_DEV_NODE_TARGET: 'http://127.0.0.1:6001' })
        expect(plan.node.env.RISU_DEV_NODE_TARGET).toBeUndefined()
    })

    test('overrides: data folder, port, host and Vite arguments', () => {
        const plan = devServerPlan({
            ...base,
            argv: ['--port', '5300'],
            env: { RISU_DEV_SERVER_DIR: 'scratch/run1', RISU_DEV_NODE_PORT: '6301', RISU_DEV_NODE_HOST: '::1' },
        })
        expect(plan.serverDir).toBe(path.resolve('scratch/run1'))
        expect(plan.node.cwd).toBe(path.resolve('scratch/run1'))
        expect(plan.node.env).toMatchObject({ PORT: '6301', HOST: '::1' })
        expect(plan.target).toBe('http://[::1]:6301')
        expect(plan.vite.args.slice(1)).toEqual(['--port', '5300'])
    })

    test.each(['0.0.0.0', '::'])('binds %s but proxies to the loopback address', (host) => {
        const plan = devServerPlan({ ...base, env: { RISU_DEV_NODE_HOST: host } })
        expect(plan.node.env.HOST).toBe(host)
        expect(plan.target).toBe(host === '::' ? 'http://[::1]:6001' : 'http://127.0.0.1:6001')
    })

    test('targets HTTPS when the server folder holds the key and certificate server.cjs looks for', () => {
        const sslPath = path.join(root, 'server', 'node', 'ssl', 'certificate')
        const present = new Set([path.join(sslPath, 'server.key'), path.join(sslPath, 'server.crt')])
        expect(devServerPlan({ ...base, env: {}, exists: (p: string) => present.has(p) }).target).toBe('https://127.0.0.1:6001')
        // One of the two is not enough: server.cjs falls back to HTTP.
        const keyOnly = (p: string) => p === path.join(sslPath, 'server.key')
        expect(devServerPlan({ ...base, env: {}, exists: keyOnly }).target).toBe('http://127.0.0.1:6001')
    })

    test.each(['0', '65536', 'abc', '6001x', '60.5', ' 6001'])('refuses RISU_DEV_NODE_PORT=%j', (port) => {
        expect(() => devServerPlan({ ...base, env: { RISU_DEV_NODE_PORT: port } })).toThrow(/RISU_DEV_NODE_PORT/)
    })
})
