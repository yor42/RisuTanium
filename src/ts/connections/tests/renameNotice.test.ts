// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../connections'
import { dismissNotice, isDefaultNamed, readNoticeDismissed, renameNoticeList } from '../renameNotice'

const conn = (name: string, provider: Connection['provider'], url?: string): Connection =>
    url === undefined ? { id: 'c', name, provider, key: '' } : { id: 'c', name, provider, key: '', url }

describe('isDefaultNamed', () => {
    it('T13: matches the label with an optional numeric suffix and nothing else', () => {
        expect(isDefaultNamed(conn('OpenAI', 'openai'))).toBe(true)
        expect(isDefaultNamed(conn('OpenAI 2', 'openai'))).toBe(true)
        expect(isDefaultNamed(conn('OpenAI 12', 'openai'))).toBe(true)
        expect(isDefaultNamed(conn('OpenAI work', 'openai'))).toBe(false)
        expect(isDefaultNamed(conn('My OpenAI', 'openai'))).toBe(false)
        expect(isDefaultNamed(conn('deepseek', 'oaicomp:deepseek'))).toBe(true)
    })

    it('T13: a proxy is default-named by its host, a custom connection never', () => {
        expect(isDefaultNamed(conn('p.invalid', 'reverse_proxy', 'https://p.invalid/v1'))).toBe(true)
        expect(isDefaultNamed(conn('p.invalid 3', 'reverse_proxy', 'https://p.invalid/v1'))).toBe(true)
        expect(isDefaultNamed(conn('Reverse proxy', 'reverse_proxy', ''))).toBe(true)
        expect(isDefaultNamed(conn('home', 'reverse_proxy', 'https://p.invalid/v1'))).toBe(false)
        expect(isDefaultNamed(conn('Custom model', 'custom'))).toBe(false)
    })

    it('T13: a label with regex characters is matched literally', () => {
        expect(isDefaultNamed(conn('p.invalid', 'reverse_proxy', 'https://p.invalid'))).toBe(true)
        expect(isDefaultNamed(conn('pXinvalid', 'reverse_proxy', 'https://p.invalid'))).toBe(false)
    })
})

describe('renameNoticeList', () => {
    it('T13: lists only default-named connections', () => {
        const db = {
            connections: [conn('OpenAI', 'openai'), conn('Renamed', 'anthropic'), conn('Custom model', 'custom')],
        }
        expect(renameNoticeList(db).map((c) => c.name)).toEqual(['OpenAI'])
    })
})

describe('dismissal', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => vi.unstubAllGlobals())

    it('T13: persists across reads', () => {
        expect(readNoticeDismissed()).toBe(false)
        dismissNotice()
        expect(readNoticeDismissed()).toBe(true)
        expect(localStorage.getItem('risuConnections.renameNoticeDismissed')).not.toBeNull()
    })

    it('T13: an unreadable or unwritable store reads as not dismissed and never throws', () => {
        vi.stubGlobal('localStorage', {
            getItem() { throw new Error('denied') },
            setItem() { throw new Error('denied') },
        })
        expect(() => dismissNotice()).not.toThrow()
        expect(readNoticeDismissed()).toBe(false)
    })
})
