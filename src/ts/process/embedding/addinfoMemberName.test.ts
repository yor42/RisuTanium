/**
 * The query the REAL `additionalInformations` (`./addinfo`) builds from the first messages of a group
 * chat: each message is prefixed with its speaker's name, which is the live member's name, else the
 * group's join record, else "Unknown Character" (never the raw member id). A message with no saying
 * keeps its role-based name.
 *
 * MOCKED: the embedding processor (it only records the query it is asked to search), the database
 * accessor and `getUserName`. `groupMembers` is the real module.
 *
 * Classes: `regression reproducer:` fails on the code before the member record existed (the query began
 * with the raw chaId); `guard:` passes before and after.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { characters: [] as unknown[] },
    queries: [] as string[],
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => h.db,
}))
vi.mock('src/ts/util', () => ({
    getUserName: () => 'User',
}))
vi.mock('../memory/hypamemory', () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch(query: string) {
            h.queries.push(query)
            return ['found']
        }
    },
}))

import { additionalInformations } from './addinfo'

type Members = Record<string, unknown> | undefined

const bot = { type: 'character', name: 'Bot', chaId: 'bot-id', additionalText: 'one\n\ntwo' }

// `members` is the group's risutanium_members exactly as joinRecord writes it ({name, slot 0..7}).
function group(members: Members) {
    return {
        type: 'group', name: 'Group', chaId: 'g0', chatPage: 0, characters: ['m-1'],
        chats: [], ...(members === undefined ? {} : { risutanium_members: members }),
    }
}

const chat = {
    message: [
        { role: 'user', data: 'hello' },
        { role: 'char', data: 'spoken', saying: 'm-1' },
        { role: 'char', data: 'plain' },
    ],
}

async function queryFor(members: Members, live: { chaId: string, name: string }[]) {
    const owner = group(members)
    h.db.characters = [owner, ...live.map((c) => ({ ...c, type: 'character' }))]
    await additionalInformations(bot as never, chat as never, undefined, owner as never)
    return h.queries.at(-1)
}

beforeEach(() => {
    h.queries.length = 0
    h.db.characters = []
})

describe('additional information query: speaker names of a group chat', () => {
    test('regression reproducer: a deleted member is named by the record, not by its id', async () => {
        expect(await queryFor({ 'm-1': { name: 'Alice', slot: 0 } }, [])).toBe('User: hello\n\nAlice: spoken\n\nBot: plain')
    })

    test('regression reproducer: a live member is named by its own name, not by its id', async () => {
        expect(await queryFor({ 'm-1': { name: 'Alice', slot: 0 } }, [{ chaId: 'm-1', name: 'Alicia' }]))
            .toBe('User: hello\n\nAlicia: spoken\n\nBot: plain')
    })

    test('regression reproducer: a deleted member with no record is Unknown Character, never the raw id', async () => {
        const query = await queryFor(undefined, [])
        expect(query).toBe('User: hello\n\nUnknown Character: spoken\n\nBot: plain')
        expect(query).not.toContain('m-1')
    })
})
