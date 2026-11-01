import { describe, expect, test } from 'vitest'
import { assembleUtilityPrompt } from '../utilityPrompt'

describe('assembleUtilityPrompt', () => {
    test('the instructions are the system message and the turns follow in order', () => {
        const messages = assembleUtilityPrompt({ instructions: 'Fix the text.' }, [
            { role: 'user', content: 'one' },
            { role: 'assistant', content: 'two' },
            { role: 'user', content: 'three' },
        ])

        expect(messages).toEqual([
            { role: 'system', content: 'Fix the text.' },
            { role: 'user', content: 'one' },
            { role: 'assistant', content: 'two' },
            { role: 'user', content: 'three' },
        ])
    })

    test('blank instructions leave out the system message', () => {
        expect(assembleUtilityPrompt({ instructions: '' }, [{ role: 'user', content: 'a' }])).toEqual([{ role: 'user', content: 'a' }])
        expect(assembleUtilityPrompt({ instructions: ' \n\t' }, [{ role: 'user', content: 'a' }])).toEqual([{ role: 'user', content: 'a' }])
    })

    test('text is literal: macros and escapes are neither expanded nor changed', () => {
        const instructions = 'Hello {{char}} and {{user}} {{getvar::x}} <b>\\n'
        const messages = assembleUtilityPrompt({ instructions }, [{ role: 'user', content: '{{random::a,b}}' }])

        expect(messages[0].content).toBe(instructions)
        expect(messages[1].content).toBe('{{random::a,b}}')
    })

    test('the result does not alias the turns it was built from', () => {
        const turns = [{ role: 'user' as const, content: 'a' }]
        const messages = assembleUtilityPrompt({ instructions: 'x' }, turns)

        messages[1].content = 'changed'

        expect(turns[0].content).toBe('a')
    })
})
