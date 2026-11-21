import { get, writable } from 'svelte/store'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The selection is a `$state` mirror of the selected character id and the database a `$state` object, like production:
// a plain object would give the deriveds no dependencies, so they would never recompute.
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} })
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    // Like production, the getters follow the selectedCharID store, which is not a signal.
    const characterAt = () => stores.DBState.db.characters?.[get(stores.selectedCharID)]
    return {
        appVer: '1234.5.67',
        getDatabase: () => stores.DBState.db,
        getCurrentCharacter: () => characterAt(),
        getCurrentChat: () => {
            const owner = characterAt()
            return owner?.chats?.[owner.chatPage]
        },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))

import * as util from 'src/ts/util'
import * as moduleRefList from 'src/ts/process/moduleRefList'
import type { RunSubject } from 'src/ts/process/chatOrigin'
import type { Database } from 'src/ts/storage/database.svelte'
import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { engineToggleDefault, toggleDefaultsFor } from '../toggleDefaultsLive.svelte'

const listSpy = vi.spyOn(moduleRefList, 'moduleListOf')
const parseSpy = vi.spyOn(util, 'parseToggleSyntax')
const listCalls = () => listSpy.mock.calls.length
const parseCalls = () => parseSpy.mock.calls.length

const MODULES = 120
const ENABLED = 15

function promptText(): string {
    const lines: string[] = []
    for (let i = 0; i < 150; i++) {
        if (i === 10) {
            lines.push('t10=T10===1')
        } else if (i === 20) {
            lines.push('t20=T20')
        } else if (i === 30) {
            lines.push('mood=Mood=select=calm,angry=angry')
        } else {
            lines.push(`t${i}=T${i}`)
        }
    }
    return lines.join('\n')
}

function buildDatabase(): Database {
    const modules: { id: string, name: string, namespace?: string, customModuleToggle: string }[] = []
    for (let i = 0; i < MODULES - 2; i++) {
        modules.push({
            id: `m${i}`,
            name: `Module ${i}`,
            namespace: i === 5 ? 'nsx' : undefined,
            customModuleToggle: i === 2 ? 'ma=MA===1' : '',
        })
    }
    modules.push({ id: 'z', name: 'Unreferenced', customModuleToggle: 'z=Z===1' })
    modules.push({ id: 'gmod', name: 'Chat module', customModuleToggle: 'k=K===1' })
    const enabledModules: string[] = []
    for (let i = 0; i < ENABLED; i++) {
        enabledModules.push(i === 5 ? 'nsx' : `m${i}`)
    }
    return {
        customPromptTemplateToggle: promptText(),
        modules,
        enabledModules,
        moduleIntergration: '',
        personas: [],
        characters: [
            {
                type: 'character',
                chaId: 'cha-a',
                chatPage: 0,
                modules: [],
                customModuleToggle: '',
                chats: [{ modules: [], message: [] }, { modules: ['gmod'], message: [] }],
            },
            {
                type: 'character',
                chaId: 'cha-b',
                chatPage: 0,
                modules: [],
                customModuleToggle: 'own=Own===1',
                chats: [{ modules: [], message: [] }, { modules: ['gmod'], message: [] }],
            },
        ],
    } as unknown as Database
}

function subjectFor(characterIndex: number, chatIndex: number): RunSubject {
    // Resolves the live slot on every call, like a real subject, so a held proxy never goes stale.
    return {
        resolve: () => {
            const owner = DBState.db.characters[characterIndex]
            return { owner, chat: owner.chats[chatIndex] }
        },
    } as unknown as RunSubject
}

// The store is set first, then its subscriber's `$state` mirror, as in production.
function selectCharacter(index: number): void {
    selectedCharID.set(index)
    selIdState.selId = index
}

function setOwnerToggle(index: number, text: string): void {
    const owner = DBState.db.characters[index]
    if (owner.type === 'character') {
        owner.customModuleToggle = text
    }
}

let editCount = 0
// Adds a toggle line without a default to the prompt: the defaults stay equal, the definition text changes.
function equalDefaultsEdit(): void {
    DBState.db.customPromptTemplateToggle += `\nextra${editCount++}=Extra`
}

function readUnset(times: number, key = 'toggle_t10', subject?: RunSubject): string | undefined {
    let value: string | undefined
    for (let i = 0; i < times; i++) {
        value = engineToggleDefault(key, subject)
    }
    return value
}

const disposers: (() => void)[] = []

function mountReaders(count: number, read: () => void): { runs: () => number } {
    let runs = 0
    const dispose = $effect.root(() => {
        for (let i = 0; i < count; i++) {
            $effect.pre(() => {
                runs++
                read()
            })
        }
    })
    disposers.push(dispose)
    flushSync()
    return { runs: () => runs }
}

beforeEach(async () => {
    editCount = 0
    selectCharacter(0)
    DBState.db = buildDatabase()
    await Promise.resolve()
    // Warm every layer before counting.
    readUnset(1)
    readUnset(1, 'toggle_own', subjectFor(1, 0))
    await Promise.resolve()
    listSpy.mockClear()
    parseSpy.mockClear()
})

afterEach(() => {
    while (disposers.length > 0) {
        disposers.pop()?.()
    }
})

describe('T2.12 budget gate (Stage 2a)', () => {
    test('(a) unset reads on the selection after a warm read neither gather nor parse', () => {
        expect(readUnset(1000)).toBe('1')
        expect(readUnset(1, 'toggle_mood')).toBe('1')
        expect(readUnset(1, 'toggle_ma')).toBe('1')
        expect(readUnset(1, 'toggle_z')).toBeUndefined()
        expect(listCalls()).toBe(0)
        expect(parseCalls()).toBe(0)
    })

    test('(b) a subject resolving to the selected owner and chat takes the same path', () => {
        const subject = subjectFor(0, 0)
        expect(readUnset(1000, 'toggle_t10', subject)).toBe('1')
        expect(listCalls()).toBe(0)
        expect(parseCalls()).toBe(0)
    })

    test('(c) a non-selected chat read untracked gathers at most once per stretch and follows an edit', async () => {
        // Pre-(c): leave the selection deriveds in their post-edit state and read nothing from the selection.
        equalDefaultsEdit()
        const subject = subjectFor(1, 0)
        expect(readUnset(1000, 'toggle_own', subject)).toBe('1')
        expect(listCalls()).toBeLessThanOrEqual(1)
        await Promise.resolve()
        setOwnerToggle(1, 'own=Own===1\nq=Q===1')
        expect(engineToggleDefault('toggle_q', subject)).toBe('1')
    })

    test('(c) the stretch cache does not survive a microtask checkpoint', async () => {
        const subject = subjectFor(1, 0)
        expect(engineToggleDefault('toggle_q', subject)).toBeUndefined()
        setOwnerToggle(1, 'own=Own===1\nq=Q===1')
        expect(engineToggleDefault('toggle_q', subject)).toBeUndefined()
        await Promise.resolve()
        expect(engineToggleDefault('toggle_q', subject)).toBe('1')
    })

    const KEYS = ['toggle_t10', 'toggle_mood', 'toggle_ma', 'toggle_t20', 'toggle_t1', 'toggle_t2', 'toggle_t3', 'toggle_t4', 'toggle_t5', 'toggle_t6']

    describe('(d) tracked readers on the selection', () => {
        test('re-run only on a real change of the defaults', () => {
            let t20: string | undefined
            const readers = mountReaders(100, () => {
                for (const key of KEYS) {
                    const value = engineToggleDefault(key)
                    if (key === 'toggle_t20') {
                        t20 = value
                    }
                }
            })
            expect(readers.runs()).toBe(100)
            expect(t20).toBeUndefined()
            listSpy.mockClear()

            DBState.db.modules[3].name = 'renamed'
            flushSync()
            expect(readers.runs()).toBe(100)
            expect(listCalls()).toBe(0)

            const unreferenced = DBState.db.modules.findIndex((m) => m.id === 'z')
            DBState.db.modules[unreferenced] = { ...$state.snapshot(DBState.db.modules[unreferenced]) }
            flushSync()
            expect(readers.runs()).toBe(100)

            // The prompt already decides t3, so a module redefining it changes nothing.
            DBState.db.modules[0].customModuleToggle = 't3=T3===1'
            flushSync()
            expect(readers.runs()).toBe(100)

            listSpy.mockClear()
            DBState.db.customPromptTemplateToggle = DBState.db.customPromptTemplateToggle.replace('t20=T20', 't20=T20===1')
            flushSync()
            expect(listCalls()).toBe(1)
            expect(readers.runs()).toBe(200)
            expect(t20).toBe('1')
        })
    })

    test('(f) two tracked readers of a non-selected chat both follow a definition edit', () => {
        const subject = subjectFor(1, 0)
        const seen: (string | undefined)[] = []
        const first = mountReaders(1, () => { seen[0] = engineToggleDefault('toggle_q', subject) })
        const second = mountReaders(1, () => { seen[1] = engineToggleDefault('toggle_q', subject) })
        expect(seen).toEqual([undefined, undefined])
        setOwnerToggle(1, 'own=Own===1\nq=Q===1')
        flushSync()
        expect(first.runs()).toBe(2)
        expect(second.runs()).toBe(2)
        expect(seen).toEqual(['1', '1'])
    })

    test('(f) tracked readers of a non-selected chat stay flat across selection switches', () => {
        const subject = subjectFor(1, 0)
        const readers = mountReaders(2, () => { engineToggleDefault('toggle_own', subject) })
        expect(readers.runs()).toBe(2)
        // Moves the selection between two owners, neither of them the reader's.
        selectCharacter(5)
        flushSync()
        selectCharacter(0)
        flushSync()
        DBState.db.characters[0].chatPage = 1
        flushSync()
        DBState.db.characters[0].chatPage = 0
        flushSync()
        expect(readers.runs()).toBe(2)
    })

    test('(f) two chats of one non-selected owner read untracked in one stretch give their own answers', () => {
        // Both reads share a synchronous stretch, so the second would be served from the first's cache entry if the
        // cache ignored the chat.
        expect(engineToggleDefault('toggle_k', subjectFor(1, 0))).toBeUndefined()
        expect(engineToggleDefault('toggle_k', subjectFor(1, 1))).toBe('1')
        expect(engineToggleDefault('toggle_k', subjectFor(1, 0))).toBeUndefined()
    })

    test('(g) a subject for the selected owner\'s other chat reads that chat\'s modules', () => {
        expect(readUnset(1, 'toggle_k', subjectFor(0, 1))).toBe('1')
        expect(readUnset(1, 'toggle_k', subjectFor(0, 0))).toBeUndefined()
        expect(readUnset(1, 'toggle_k')).toBeUndefined()
    })

    test('(h) after a selection switch, reads over three stretches gather at most once', async () => {
        selectCharacter(1)
        for (let stretch = 0; stretch < 3; stretch++) {
            expect(readUnset(333, 'toggle_own')).toBe('1')
            await Promise.resolve()
        }
        expect(listCalls()).toBeLessThanOrEqual(1)
        // The prompt's own defaults still apply to every owner.
        expect(readUnset(1, 'toggle_t10')).toBe('1')
    })

    describe('disconnected equal-defaults edits, no tracked reader alive', () => {
        test('(i) a toggle line without a default appended to the prompt', async () => {
            equalDefaultsEdit()
            expect(readUnset(1000)).toBe('1')
            expect(listCalls()).toBeLessThanOrEqual(1)
            await Promise.resolve()
            listSpy.mockClear()
            expect(readUnset(1000)).toBe('1')
            expect(listCalls()).toBe(0)
        })

        test('(ii) enabling a module with no toggle text', () => {
            DBState.db.enabledModules.push('m100')
            expect(readUnset(1000)).toBe('1')
            expect(listCalls()).toBeLessThanOrEqual(1)
        })

        test('(iii) edits after a tracked reader was destroyed', () => {
            let disposeReader = () => {}
            let runs = 0
            disposeReader = $effect.root(() => {
                $effect.pre(() => {
                    runs++
                    engineToggleDefault('toggle_t10')
                })
            })
            flushSync()
            expect(runs).toBe(1)
            equalDefaultsEdit()
            flushSync()
            expect(runs).toBe(1)
            disposeReader()
            equalDefaultsEdit()
            listSpy.mockClear()
            expect(readUnset(1000)).toBe('1')
            expect(listCalls()).toBeLessThanOrEqual(1)
        })

        test('(iv) replacing an unreferenced module slot with an equal-text copy', () => {
            const unreferenced = DBState.db.modules.findIndex((m) => m.id === 'z')
            DBState.db.modules[unreferenced] = { ...$state.snapshot(DBState.db.modules[unreferenced]) }
            expect(readUnset(1000)).toBe('1')
            expect(listCalls()).toBeLessThanOrEqual(1)
        })
    })

    test('a real default change is seen by a disconnected read', () => {
        expect(readUnset(1, 'toggle_t20')).toBeUndefined()
        DBState.db.customPromptTemplateToggle = DBState.db.customPromptTemplateToggle.replace('t20=T20', 't20=T20===1')
        expect(readUnset(1, 'toggle_t20')).toBe('1')
        expect(toggleDefaultsFor(DBState.db.characters[0], DBState.db.characters[0].chats[0]).get('toggle_t20')).toBe('1')
    })
})
