import { describe, expect, test } from 'vitest'
import { classifyImageSrc } from './chatCard'

const env = { origin: 'http://192.168.0.5:6001', isTauri: false }

describe('classifyImageSrc for the Node asset route', () => {
    test('keeps a relative asset route URL as a local image', () => {
        const src = '/api/asset/6173736574732f782e706e67?risu-auth=aaa.bbb.ccc'
        expect(classifyImageSrc(src, env)).toEqual({ kind: 'local', src })
    })

    test('keeps an absolute asset route URL on this origin as a local image', () => {
        const src = 'http://192.168.0.5:6001/api/asset/6173736574732f782e706e67?risu-auth=aaa.bbb.ccc'
        expect(classifyImageSrc(src, env)).toEqual({ kind: 'local', src })
    })

    test('guard: another path on this origin is still dropped', () => {
        expect(classifyImageSrc('/api/read', env)).toEqual({ kind: 'drop' })
        expect(classifyImageSrc('/api/assets-list', env)).toEqual({ kind: 'drop' })
    })

    test('guard: a service-worker image is still local', () => {
        expect(classifyImageSrc('/sw/img/6162', env)).toEqual({ kind: 'local', src: '/sw/img/6162' })
    })

    test('guard: an asset route path on another origin is treated as an outside address', () => {
        const src = 'https://elsewhere.invalid/api/asset/6162?risu-auth=t'
        expect(classifyImageSrc(src, env)).toEqual({ kind: 'outside', src })
    })
})
