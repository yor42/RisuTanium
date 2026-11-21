import { describe, expect, it } from 'vitest'
import type { Connection } from '../connections'
import { connectionHasKey, connectionKey, connectionKeyForUi, setConnectionKey } from '../keyAccess'

const make = (key: string): Connection => ({ id: 'conn-1', name: 'n', provider: 'openai', key })

describe('key access seam', () => {
    it('reads the whole multi-line string and a reference verbatim', async () => {
        expect(await connectionKey(make('L1\nL2'))).toBe('L1\nL2')
        expect(await connectionKey(make('${OPENAI}'))).toBe('${OPENAI}')
        expect(connectionKeyForUi(make('L1\nL2'))).toBe('L1\nL2')
    })

    it('counts a blank key as no key', () => {
        expect(connectionHasKey(make(''))).toBe(false)
        expect(connectionHasKey(make('  \n '))).toBe(false)
        expect(connectionHasKey(make('sk-a'))).toBe(true)
    })

    it('sets the key synchronously and resolves', async () => {
        const conn = make('')
        const done = setConnectionKey(conn, 'sk-new')
        expect(conn.key).toBe('sk-new')
        await expect(done).resolves.toBeUndefined()
    })
})
