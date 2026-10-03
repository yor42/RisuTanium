/**
 * The voice-mode rules of `./ttsModes` and the parse options of
 * `./displayParseOptions`.
 *
 * Invariants pinned here:
 *  - a mode produces speech when it is set and is neither `'none'` nor
 *    `'normal'`; plugin-defined mode strings qualify;
 *  - a chat owner can speak when it is a character with such a mode, or a
 *    group with at least one member that has one;
 *  - the display parse options carry every input explicitly, never write
 *    chat variables (`rmVar`) and carry a run's `subject` only when given.
 */

import { describe, expect, test } from 'vitest'
import { canChatSpeak, isTTSVoiceMode } from './ttsModes'
import { buildDisplayParseOptions } from './displayParseOptions'
import type { character, groupChat } from '../storage/database.svelte'
import type { RunSubject } from './chatOrigin'

describe('isTTSVoiceMode', () => {
    test.each([
        'webspeech', 'elevenlab', 'VOICEVOX', 'openai', 'novelai', 'huggingface', 'vits', 'gptsovits', 'fishspeech', 'my-plugin-voice',
    ])('new behaviour: %s produces speech', (mode) => {
        expect(isTTSVoiceMode(mode)).toBe(true)
    })

    test.each([
        ['an empty string', ''],
        ['none', 'none'],
        ['normal', 'normal'],
        ['undefined', undefined],
        ['null', null],
    ])('new behaviour: %s does not produce speech', (_label, mode) => {
        expect(isTTSVoiceMode(mode)).toBe(false)
    })
})

describe('canChatSpeak', () => {
    const character = (ttsMode: string) => ({ type: 'character', ttsMode }) as unknown as character
    const group = (members: string[]) => ({ type: 'group', characters: members, ttsMode: 'none' }) as unknown as groupChat
    const voices: Record<string, string> = { a: 'none', b: 'normal', c: 'openai', d: '' }
    const findMember = (id: string) => (id in voices ? { ttsMode: voices[id] } : null)

    test('new behaviour: a character speaks by its own mode', () => {
        expect(canChatSpeak(character('openai'), findMember)).toBe(true)
        expect(canChatSpeak(character('normal'), findMember)).toBe(false)
        expect(canChatSpeak(character(''), findMember)).toBe(false)
    })

    test('new behaviour: a group speaks when one member has a voice mode, whatever the group own mode is', () => {
        expect(canChatSpeak(group(['a', 'c']), findMember)).toBe(true)
    })

    test('new behaviour: a group of members without a voice mode, with a missing member or with no members does not speak', () => {
        expect(canChatSpeak(group(['a', 'b', 'd']), findMember)).toBe(false)
        expect(canChatSpeak(group(['missing']), findMember)).toBe(false)
        expect(canChatSpeak(group([]), findMember)).toBe(false)
    })

    test('new behaviour: no chat owner does not speak', () => {
        expect(canChatSpeak(undefined, findMember)).toBe(false)
        expect(canChatSpeak(null, findMember)).toBe(false)
    })
})

describe('buildDisplayParseOptions', () => {
    test('new behaviour: every input is carried, variables are not written and no subject is set when none is given', () => {
        const options = buildDisplayParseOptions({ chara: 'Ann', chatID: 4, firstmsg: false, chatRole: 'char' })

        expect(options).toEqual({
            chara: 'Ann',
            chatID: 4,
            rmVar: true,
            visualize: true,
            cbsConditions: { firstmsg: false, chatRole: 'char' },
        })
        expect('subject' in options).toBe(false)
    })

    test('new behaviour: a run subject is carried unchanged', () => {
        const subject = { resolve: () => null } as unknown as RunSubject

        const options = buildDisplayParseOptions({ chara: 'Ann', chatID: 0, firstmsg: true, chatRole: null, subject })

        expect(options.subject).toBe(subject)
        expect(options.cbsConditions).toEqual({ firstmsg: true, chatRole: null })
    })
})
