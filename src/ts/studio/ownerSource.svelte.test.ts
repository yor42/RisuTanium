/**
 * The reactive owner source over a `$state` database: the snapshot must re-derive when the context chat moves,
 * when a module slot is replaced and when only the GUI reload pointer moves, and `readTextSources` must answer
 * only for the bound, readable character. The stores and the module lister are replaced; the source and the
 * owner model are real.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    makeCharacter,
    makeChat,
    makeInput,
    residentModule,
    stubModule,
    studioDbOf,
} from './studioFixtures.test-helpers'

const db = $state({ db: {} as ReturnType<typeof studioDbOf> })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
}))
vi.mock('../process/moduleRefList', () => ({
    moduleListOf: (ids: string[]) => listerOver(db.db.modules)(ids),
}))

import { createOwnerSource, readTextSources, type OwnerSnapshot } from './ownerSource.svelte'

function fixtureDb() {
    return studioDbOf(makeInput({
        character: makeCharacter({
            modules: ['stub'],
            chatPage: 0,
            chats: [makeChat({ id: 'chat-1', name: 'First chat' }), makeChat({ id: 'chat-2', name: 'Second chat' })],
        }),
        modules: [stubModule('stub')],
    }))
}

let stop: (() => void) | null = null

/** Mounts a source under an effect that reads it, as a component would, and records every snapshot it sees. */
function observe(chaId = 'cha-1'): OwnerSnapshot[] {
    const seen: OwnerSnapshot[] = []
    stop = $effect.root(() => {
        const source = createOwnerSource(() => chaId)
        $effect(() => { seen.push(source.current) })
    })
    flushSync()
    return seen
}

beforeEach(() => {
    db.db = fixtureDb()
    selection.selId = 0
    ReloadGUIPointer.set(0)
})

afterEach(() => {
    stop?.()
    stop = null
})

describe('createOwnerSource reactivity', () => {
    test('a change of the character chat page re-derives and the model follows the new chat', () => {
        const seen = observe()
        expect(seen.length).toBe(1)
        expect(seen[0].model?.chat?.key).toContain('chat-1')
        db.db.characters[0].chatPage = 1
        flushSync()
        expect(seen.length).toBe(2)
        expect(seen[1].version).toBeGreaterThan(seen[0].version)
        expect(seen[1].model?.chat?.key).toContain('chat-2')
    })

    test('replacing a module slot re-derives and the owner takes the new slot tags', () => {
        const seen = observe()
        const stubOwner = seen[0].model?.ownerByKey(seen[0].model.modules[0].key)
        expect(stubOwner?.tags).toContain('notLoaded')
        db.db.modules = [residentModule('stub', { customModuleToggle: '' })]
        flushSync()
        expect(seen.length).toBe(2)
        const resident = seen[1].model?.modules[0]
        expect(resident?.tags).not.toContain('notLoaded')
    })

    test('moving only the GUI reload pointer re-derives over unchanged data', () => {
        const seen = observe()
        expect(seen.length).toBe(1)
        ReloadGUIPointer.update((value) => value + 1)
        flushSync()
        expect(seen.length).toBe(2)
        expect(seen[1].version).toBeGreaterThan(seen[0].version)
        expect(seen[1].model?.chat?.key).toBe(seen[0].model?.chat?.key)
    })

    test('a selection that moves to another character gives a null model', () => {
        const seen = observe()
        expect(seen[0].model).not.toBeNull()
        selection.selId = 5
        flushSync()
        expect(seen[seen.length - 1].model).toBeNull()
    })
})

describe('readTextSources', () => {
    test('answers for the bound, readable character with its modules and the working presets', () => {
        const sources = readTextSources('cha-1')
        expect(sources?.character).toBe(db.db.characters[0])
        expect(sources?.modules.length).toBe(1)
        expect(Array.isArray(sources?.presets)).toBe(true)
    })

    test('answers null for another chaId, a group and a cold-stored character', () => {
        expect(readTextSources('other')).toBeNull()
        db.db.characters[0].type = 'group'
        expect(readTextSources('cha-1')).toBeNull()
        db.db.characters[0].type = 'character'
        expect(readTextSources('cha-1')).not.toBeNull()
        ;(db.db.characters[0] as { coldstorage?: boolean }).coldstorage = true
        expect(readTextSources('cha-1')).toBeNull()
    })
})
