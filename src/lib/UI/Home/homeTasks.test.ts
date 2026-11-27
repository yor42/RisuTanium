/**
 * `taskRows`: the Tasks dialog's row model. Names resolve through the characters and fall back to the
 * unnamed word, so an id never becomes visible text, and an empty target list never reads the characters.
 *
 * Diagnostic (new module): there is no earlier version to fail against.
 */

import { describe, expect, test } from 'vitest'
import { createTaskController, type TaskClock, type TaskLabels } from '../../Nexus/pattern/taskProgress'
import { jobProgressText, taskRows, type HomeTaskCharacter } from './homeTasks'

const UNNAMED = 'Unnamed'

const characters: HomeTaskCharacter[] = [
    { chaId: 'cha-x', name: 'Xena', chats: [{ id: 'chat-a', name: 'Alpha' }, { id: 'chat-b', name: 'Beta' }] },
    { chaId: 'grp-g', name: 'Guild', chats: [{ id: 'chat-g', name: 'Hall' }] },
]

describe('taskRows', () => {
    test('T-S6-20: no targets returns no rows and never reads the characters', () => {
        const throwing = new Proxy([] as HomeTaskCharacter[], {
            get() { throw new Error('characters were read') },
        })

        expect(taskRows([], throwing, UNNAMED)).toEqual([])
    })

    test('T-S6-21: resolves the character name and the chat name, and falls back for each missing one', () => {
        const rows = taskRows([
            { chaId: 'cha-x', chatId: 'chat-a' },
            { chaId: 'cha-x', chatId: 'chat-zz' },
            { chaId: 'cha-q', chatId: 'chat-q' },
        ], characters, UNNAMED)

        expect(rows.map((row) => [row.name, row.chatName])).toEqual([
            ['Xena', 'Alpha'],
            ['Xena', UNNAMED],
            [UNNAMED, UNNAMED],
        ])
        const empty = taskRows([{ chaId: 'cha-e', chatId: 'chat-e' }], [{ chaId: 'cha-e', name: '', chats: [{ id: 'chat-e', name: '' }] }], UNNAMED)
        expect([empty[0].name, empty[0].chatName]).toEqual([UNNAMED, UNNAMED])
    })

    test('T-S6-22: two targets under one chaId are two rows with distinct keys, in the targets\' order', () => {
        const rows = taskRows([{ chaId: 'cha-x', chatId: 'chat-b' }, { chaId: 'cha-x', chatId: 'chat-a' }], characters, UNNAMED)

        expect(rows.map((row) => row.chatName)).toEqual(['Beta', 'Alpha'])
        expect(new Set(rows.map((row) => row.key)).size).toBe(2)
    })

    test('T-S6-23: a group target is named after the group', () => {
        const rows = taskRows([{ chaId: 'grp-g', chatId: 'chat-g' }], characters, UNNAMED)

        expect([rows[0].name, rows[0].chatName]).toEqual(['Guild', 'Hall'])
    })

    test('T-S6-24: no id appears in the name or chat name on any fallback', () => {
        const rows = taskRows([
            { chaId: 'cha-q', chatId: 'chat-q' },
            { chaId: 'cha-x', chatId: 'chat-zz' },
        ], characters, UNNAMED)

        for (const row of rows) {
            for (const text of [row.name, row.chatName]) {
                for (const id of [row.chaId, row.chatId]) expect(text).not.toContain(id)
            }
        }
    })
})

describe('jobProgressText', () => {
    const labels: TaskLabels = {
        stepOf: (i, n) => `Step ${i} of ${n}`,
        fileOf: (i, n) => `File ${i} of ${n}`,
        count: (noun, d, t) => `${noun} ${d} / ${t}`,
        countFound: (noun, d, f) => `${noun} ${d} saved, ${f} found so far`,
        bytes: (d, t) => `${d} / ${t}`,
        cancelling: 'Wrapping up',
        cancelledHeadline: 'Cancelled',
        skippedTitle: (n) => `${n} skipped`,
    }

    /** A real controller on a clock that moves on every read, so each write publishes at once. */
    function controller() {
        let now = 0
        const clock: TaskClock = {
            now: () => (now += 1000),
            setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
            clearTimeout: () => { },
            hidden: () => false,
        }
        return createTaskController({
            title: 'Import',
            steps: [{ label: 'Read file', noun: 'Assets' }, { label: 'Add items' }],
            onCancel: () => { },
            background: true,
        }, clock)
    }

    test('T-613-09: step only, then file and step', () => {
        const task = controller()
        expect(jobProgressText(task.view, labels)).toBe('Step 1 of 2: Read file')

        task.setFile(1, 3)
        expect(jobProgressText(task.view, labels)).toBe('File 2 of 3: Step 1 of 2: Read file')
    })

    test('T-613-09: a closed count, an open count and MiB read as amounts, never a percentage', () => {
        const counted = controller()
        counted.setCount(3, 10)
        const opened = controller()
        opened.setFound(2, 5)
        const sized = controller()
        sized.setBytes(1024 * 1024, 3 * 1024 * 1024)

        expect(jobProgressText(counted.view, labels)).toBe('Step 1 of 2: Read file, Assets 3 / 10')
        expect(jobProgressText(opened.view, labels)).toBe('Step 1 of 2: Read file, Assets 2 saved, 5 found so far')
        expect(jobProgressText(sized.view, labels)).toBe('Step 1 of 2: Read file, 1.0 MiB / 3.0 MiB')
        for (const task of [counted, opened, sized]) expect(jobProgressText(task.view, labels)).not.toContain('%')
    })

    test('T-613-09: a cancelling task reads the cancelling word', () => {
        const task = controller()
        task.setCount(3, 10)
        expect(task.requestCancel()).toBe(true)

        expect(task.view.state).toBe('cancelling')
        expect(jobProgressText(task.view, labels)).toBe('Wrapping up')
    })
})
