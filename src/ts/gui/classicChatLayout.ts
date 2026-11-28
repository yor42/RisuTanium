import classicSheet from './classicChatLayout.css?raw'
import { adoptSheet } from './adoptSheet'

// The rules reach the document with the first module that uses them, before the classic chat paints.
adoptSheet('classic-chat-layout', classicSheet)

/** True while the root input attribute reads touch; the same attribute the sheet's touch rules are keyed on. */
export function touchInput(doc: Document = document): boolean {
    return doc.documentElement.dataset.input === 'touch'
}
