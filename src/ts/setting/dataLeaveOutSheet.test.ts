/**
 * S2-U2: the leave-out sheet names every kind on screen. Post-fix guard (new module): `VISIBLE_CONSEQUENCES` is the
 * number of consequences the pattern shows before its disclosure, and the builder must never exceed it.
 */
import { describe, expect, test } from 'vitest'
import { language } from '../../lang'
import { VISIBLE_CONSEQUENCES } from '../../lib/Nexus/pattern/patternWarning'
import type { BinLeaveOutEntry } from '../drive/binLeaveOut'
import { assertAllConsequencesShown, leaveOutSheetDef, leftOutKindLabels } from './dataLeaveOutSheet'

const ALTERNATIVES: BinLeaveOutEntry = {
    kind: 'alternatives',
    count: 3,
    branchChats: 2,
    labels: [{ key: 'a', text: 'Alice / One', kinds: ['alternatives'], branches: { chats: 2, omitted: 0, bytes: 100 } }],
}
const FORK_CHAT: BinLeaveOutEntry = {
    kind: 'forkChatData',
    count: 4,
    kinds: ['interruptedNote', 'hideNames'],
    labels: [{ key: 'b', text: 'Bob / Two', kinds: ['interruptedNote', 'hideNames'] }],
}
const PRESETS: BinLeaveOutEntry = { kind: 'taskPresets', count: 2, names: ['Summarize', 'Translate'] }
const PACKS: BinLeaveOutEntry = { kind: 'themePacks', count: 5, names: ['Navy'] }
const USAGE: BinLeaveOutEntry = { kind: 'usageStats', count: 1 }
const ALL = [ALTERNATIVES, FORK_CHAT, PRESETS, PACKS, USAGE]

/** The count text each entry must put on a shown line. */
function countText(entry: BinLeaveOutEntry): string {
    switch (entry.kind) {
        case 'alternatives': return language.settingsShellDataLeaveOutAlternatives(entry.count, entry.branchChats)
        case 'forkChatData': return language.settingsShellDataLeaveOutForkChat(entry.count, entry.kinds.map((kind) => language.backupForkChatDataKind(kind)).join(', '))
        case 'taskPresets': return language.settingsShellDataLeaveOutTaskPresets(entry.count)
        case 'themePacks': return language.settingsShellDataLeaveOutThemePacks(entry.count)
        case 'usageStats': return language.settingsShellDataLeaveOutUsage
    }
}

function subsets(): BinLeaveOutEntry[][] {
    const out: BinLeaveOutEntry[][] = []
    for (let mask = 1; mask < 1 << ALL.length; mask++) {
        out.push(ALL.filter((_, index) => (mask & (1 << index)) !== 0))
    }
    return out
}

describe('leaveOutSheetDef', () => {
    test('there are 31 non-empty combinations of the five kinds', () => {
        expect(subsets()).toHaveLength(31)
    })

    test('for every combination at most VISIBLE_CONSEQUENCES lines, and every present kind is named on one of them', () => {
        for (const summary of subsets()) {
            const def = leaveOutSheetDef(summary)
            const lines = def.consequences ?? []
            expect(lines.length).toBeLessThanOrEqual(VISIBLE_CONSEQUENCES)
            for (const entry of summary) {
                const text = countText(entry)
                expect(lines.some((line) => line.includes(text)), `${entry.kind} in ${summary.map((e) => e.kind).join('+')}`).toBe(true)
            }
        }
    })

    test('the sheet is a caution with Cancel, a secondary .rtb action and a primary .bin action', () => {
        const def = leaveOutSheetDef(ALL)
        expect(def.severity).toBe('caution')
        expect(def.headline).toBe(language.settingsShellDataLeaveOutTitle)
        expect(def.actions).toEqual({
            cancel: language.cancel,
            secondary: language.settingsShellDataLeaveOutRtb,
            primary: language.settingsShellDataLeaveOutContinue,
        })
    })

    test('the detail starts with "stays in this app, nothing written" and names the items behind the disclosure', () => {
        const detail = leaveOutSheetDef(ALL).detail ?? []
        expect(detail[0]).toBe(language.settingsShellDataLeaveOutStays)
        expect(detail.some((line) => line.includes('Summarize') && line.includes('Translate'))).toBe(true)
        expect(detail.some((line) => line.includes('Navy'))).toBe(true)
        expect(detail.some((line) => line.includes('Alice / One'))).toBe(true)
        expect(detail.some((line) => line.includes('Bob / Two'))).toBe(true)
    })

    test('names beyond what the per-kind prompts show are counted as "more"', () => {
        const names = Array.from({ length: 25 }, (_, index) => `Preset ${index}`)
        const detail = leaveOutSheetDef([{ kind: 'taskPresets', count: 25, names }]).detail ?? []
        expect(detail.some((line) => line.includes(language.settingsShellDataLeaveOutNamed(language.settingsShellDataKindTaskPresets, names.slice(0, 20), 5)))).toBe(true)
    })

    test('the combined app-data line lists the present items in order', () => {
        const lines = leaveOutSheetDef([PRESETS, PACKS, USAGE]).consequences ?? []
        expect(lines).toEqual([
            language.settingsShellDataLeaveOutAppData([
                language.settingsShellDataLeaveOutTaskPresets(2),
                language.settingsShellDataLeaveOutThemePacks(5),
                language.settingsShellDataLeaveOutUsage,
            ].join(', ')),
        ])
    })
})

describe('assertAllConsequencesShown', () => {
    test('a fourth group throws instead of folding a kind out of view', () => {
        expect(() => assertAllConsequencesShown(['a', 'b', 'c'])).not.toThrow()
        expect(() => assertAllConsequencesShown(['a', 'b', 'c', 'd'])).toThrow()
    })
})

describe('leftOutKindLabels', () => {
    test('one label per entry, in order', () => {
        expect(leftOutKindLabels(ALL)).toEqual([
            language.settingsShellDataKindAlternatives,
            language.settingsShellDataKindForkChat,
            language.settingsShellDataKindTaskPresets,
            language.settingsShellDataKindThemePacks,
            language.settingsShellDataKindUsage,
        ])
    })
})
