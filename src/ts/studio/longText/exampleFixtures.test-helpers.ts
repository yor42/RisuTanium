import type { character } from 'src/ts/storage/database.svelte'
import type { ExampleText } from './exampleBlocks'

/**
 * Example texts shaped like the real producers, for the example-block tests.
 */

/** The byaf importer's `planExamples` expression (byafImport.ts): each non-blank text becomes `<START>\n` + text, joined by `\n`. */
export function byafExampleText(texts: readonly string[]): string {
    const parts: string[] = []
    for (const text of texts) {
        if (text.trim() !== '') {
            parts.push('<START>\n' + text)
        }
    }
    return parts.join('\n')
}

/** A V2 card's `mes_example` passes through verbatim; CRLF cards keep `\r\n` between lines. */
export const V2_CRLF_EXAMPLE = '<START>\r\n{{user}}: hello\r\n{{char}}: hi there\r\n<START>\r\n{{user}}: again\r\n{{char}}: yes\r\n'

/** Hand-made variants that stress the marker rule and the missing-terminator cases. */
export const HAND_MADE_EXAMPLES: readonly string[] = [
    '',
    '<START>',
    '<START>\n',
    'plain opening\n<START>\n{{user}}: a\n{{char}}: b',
    '  <Start>\r\n{{user}}: a\r\n',
    ' <start> \n{{user}}: nbsp\n',
    '　<START>　\n{{user}}: ideographic\n',
    '﻿<START>\n{{user}}: bom first line\n',
    '<START>\n<START>\n',
    '<START>{{user}}: glued\n',
    'x <START>\n',
    '{{user}}: a\r{{char}}: lone carriage return\r',
    'a\r\nb\nc\r\n<START>\nd\r\n',
]

/** The engine reads a character's example text through `exampleMessage`; only `name` and `exampleMessage` matter. */
export function characterWithExample(exampleMessage: string, name = 'bot'): character {
    return { name, exampleMessage } as unknown as character
}

/**
 * The text the engine sees for one part of a split text: one trailing `\n`
 * is dropped from every part another part follows (the engine splits on `\n`,
 * so that terminator only ends the part's last line); the last part is raw.
 */
export function engineTextOf(part: string, followedByAnotherPart: boolean): string {
    return followedByAnotherPart && part.endsWith('\n') ? part.slice(0, -1) : part
}

/** The parts of a split text whose engine output makes up the whole: the opening, then each block body. */
export function engineParts(t: ExampleText): string[] {
    const parts = [t.opening, ...t.blocks.map((block) => block.body)]
    return parts.map((part, index) => engineTextOf(part, index < parts.length - 1))
}
