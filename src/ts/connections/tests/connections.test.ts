import { describe, expect, it } from 'vitest'
import {
    cloneConnection, customModelReferrers, isMalformedStore, nextConnectionId, ownedConnection, presetProxyRef,
    proxyName, slotConnection, uniqueName, type Connection, type ConnectionHolder,
} from '../connections'

function conn(id: string, provider: Connection['provider'], key = 'k', extra: Partial<Connection> = {}): Connection {
    return { id, name: id, provider, key, ...extra }
}

describe('slotConnection', () => {
    it('resolves a global slot to the first connection of its provider', () => {
        const db: ConnectionHolder = { connections: [conn('conn-1', 'openai', 'first'), conn('conn-2', 'openai', 'second')] }
        expect(slotConnection(db, 'openAIKey')?.key).toBe('first')
        expect(slotConnection(db, 'claudeAPIKey')).toBeUndefined()
        expect(slotConnection(db, 'vertexPrivateKey')).toBeUndefined()
    })

    it('resolves proxyKey only to a reverse_proxy connection', () => {
        const proxy = conn('conn-1', 'reverse_proxy', 'pk', { url: 'https://p.invalid' })
        const foreign = conn('conn-2', 'anthropic', 'sk-ant-X')
        expect(slotConnection({ connections: [proxy, foreign], proxyConnectionId: 'conn-1' }, 'proxyKey')).toBe(proxy)
        expect(slotConnection({ connections: [proxy, foreign], proxyConnectionId: 'conn-2' }, 'proxyKey')).toBeUndefined()
        expect(slotConnection({ connections: [proxy], proxyConnectionId: '' }, 'proxyKey')).toBeUndefined()
        expect(slotConnection({ connections: [proxy], proxyConnectionId: 'conn-9' }, 'proxyKey')).toBeUndefined()
        expect(slotConnection({ connections: [proxy] }, 'proxyKey')).toBeUndefined()
    })

    it('resolves a custom slot through the first model with that id, only to a custom connection', () => {
        const custom = conn('conn-1', 'custom', 'ck', { url: 'https://c.invalid' })
        const foreign = conn('conn-2', 'anthropic', 'sk-ant-X')
        const db: ConnectionHolder = {
            connections: [custom, foreign],
            customModels: [
                { id: 'ma', connectionId: 'conn-1' },
                { id: 'ma', connectionId: 'conn-2' },
                { id: 'mb', connectionId: 'conn-2' },
                { id: 'mc' },
            ],
        }
        expect(slotConnection(db, 'customModels:ma')).toBe(custom)
        expect(slotConnection(db, 'customModels:mb')).toBeUndefined()
        expect(slotConnection(db, 'customModels:mc')).toBeUndefined()
        expect(slotConnection(db, 'customModels:none')).toBeUndefined()
        expect(ownedConnection(db, { modelIndex: 1 })).toBeUndefined()
        expect(ownedConnection(db, { modelIndex: 0 })).toBe(custom)
    })

    it('resolves an OaiComp slot by its kid', () => {
        const db: ConnectionHolder = { connections: [conn('conn-1', 'oaicomp:deepseek', 'dk'), conn('conn-2', 'oaicomp:deepinfra', 'di')] }
        expect(slotConnection(db, 'OaiCompAPIKeys:deepinfra')?.key).toBe('di')
        expect(slotConnection(db, 'OaiCompAPIKeys:other')).toBeUndefined()
    })

    it('returns only well-formed connections and none for a store that is not an array', () => {
        const bad = { id: 1, provider: 'openai', key: 'x' } as unknown as Connection
        expect(slotConnection({ connections: [bad, conn('conn-2', 'openai', 'ok')] }, 'openAIKey')?.key).toBe('ok')
        expect(slotConnection({ connections: 'garbage' as unknown as Connection[] }, 'openAIKey')).toBeUndefined()
    })
})

describe('store checks', () => {
    it('flags a present store that is not an array of well-formed connections', () => {
        expect(isMalformedStore({})).toBe(false)
        expect(isMalformedStore({ connections: [] })).toBe(false)
        expect(isMalformedStore({ connections: [conn('conn-1', 'openai')] })).toBe(false)
        expect(isMalformedStore({ connections: 'x' as unknown as Connection[] })).toBe(true)
        expect(isMalformedStore({ connections: null as unknown as Connection[] })).toBe(true)
        expect(isMalformedStore({ connections: [{ id: 'a' } as unknown as Connection] })).toBe(true)
    })

    it('counts the custom models that name a connection', () => {
        const db: ConnectionHolder = { customModels: [{ id: 'a', connectionId: 'conn-1' }, { id: 'b', connectionId: 'conn-1' }, { id: 'c' }] }
        expect(customModelReferrers(db, 'conn-1')).toBe(2)
        expect(customModelReferrers(db, 'conn-2')).toBe(0)
    })
})

describe('presetProxyRef', () => {
    it('prefers the preset reference, wipes on an empty legacy pair, and otherwise has no opinion', () => {
        expect(presetProxyRef({ proxyConnectionId: 'conn-3', proxyKey: 'k' })).toBe('conn-3')
        expect(presetProxyRef({ proxyConnectionId: '' })).toBe('')
        expect(presetProxyRef({ proxyKey: '', forceReplaceUrl: '' })).toBe('')
        expect(presetProxyRef({ proxyKey: '' })).toBe('')
        expect(presetProxyRef({ proxyKey: 'k', forceReplaceUrl: '' })).toBeUndefined()
        expect(presetProxyRef({})).toBeUndefined()
    })
})

describe('ids and names', () => {
    it('allocates one more than the largest conn-n and never reuses a gap', () => {
        expect(nextConnectionId([])).toBe('conn-1')
        expect(nextConnectionId([conn('conn-1', 'openai'), conn('conn-4', 'openai'), conn('other', 'openai')])).toBe('conn-5')
    })

    it('suffixes a taken name in order', () => {
        const list = [conn('conn-1', 'openai', 'k', { name: 'p.invalid' }), conn('conn-2', 'openai', 'k', { name: 'p.invalid 2' })]
        expect(uniqueName('p.invalid', list)).toBe('p.invalid 3')
        expect(uniqueName('other', list)).toBe('other')
    })

    it('names a proxy after its host and falls back when the URL does not parse', () => {
        expect(proxyName('https://p.invalid/v1')).toBe('p.invalid')
        expect(proxyName('not a url')).toBe('Reverse proxy')
        expect(proxyName('')).toBe('Reverse proxy')
    })
})

describe('cloneConnection', () => {
    it('keeps unknown fields, copies options and applies overrides', () => {
        const source = { ...conn('conn-1', 'custom', 'k', { options: { a: 1 } }), keyWrapped: 'w' } as Connection
        const copy = cloneConnection(source, { id: 'conn-2' }) as Connection & { keyWrapped?: string }
        expect(copy.id).toBe('conn-2')
        expect(copy.keyWrapped).toBe('w')
        copy.options!.a = 2
        expect(source.options!.a).toBe(1)
        expect(source.id).toBe('conn-1')
    })
})
