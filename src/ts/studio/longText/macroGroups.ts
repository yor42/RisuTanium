/**
 * The macro table of the long-text editor: 66 rows in seven registry groups (MC-1756), each pinned to the CBS
 * registry and the block checker by `macroGroups.registry.test.ts`. Labels live in the locale table under
 * `ltMacroRows`; nothing here reads a locale.
 */
import type { languageEnglish } from '../../../lang/en'
import type { BlockKeyword } from './cbsBlocks'

export type MacroGroupId = 'char' | 'var' | 'time' | 'text' | 'logic' | 'display' | 'block'
export type MacroRowId = keyof (typeof languageEnglish)['ltMacroRows']

export type MacroRow =
    | { id: MacroRowId; group: MacroGroupId; kind: 'plain' | 'args'; name: string }
    // `head` is what follows `{{` (`#if `, `#pure`); a head that ends with a space is followed by a condition.
    | { id: MacroRowId; group: 'block'; kind: 'block'; keyword: BlockKeyword; head: string; closer: string }
    | { id: 'else' | 'comment'; group: MacroGroupId; kind: 'else' | 'comment'; raw: ':else' | '//' }

/** The groups in sheet order. */
export const MACRO_GROUPS: readonly MacroGroupId[] = ['char', 'var', 'time', 'text', 'logic', 'display', 'block']

function plain(group: MacroGroupId, id: MacroRowId, name: string = id): MacroRow {
    return { id, group, kind: 'plain', name }
}

function args(group: MacroGroupId, id: MacroRowId, name: string = id): MacroRow {
    return { id, group, kind: 'args', name }
}

function blockRow(id: MacroRowId, keyword: BlockKeyword, head: string, closerName: string): MacroRow {
    return { id, group: 'block', kind: 'block', keyword, head, closer: `{{/${closerName}}}` }
}

export const MACRO_ROWS: readonly MacroRow[] = [
    plain('char', 'user'), plain('char', 'char'), plain('char', 'persona'), plain('char', 'description'),
    plain('char', 'personality'), plain('char', 'scenario'), plain('char', 'lastmessage'), plain('char', 'lastusermessage'),
    plain('char', 'lastcharmessage'), plain('char', 'previouscharchat'), plain('char', 'previoususerchat'), plain('char', 'chatindex'),
    args('var', 'getvar'), args('var', 'setvar'), args('var', 'addvar'), args('var', 'setdefaultvar'),
    args('var', 'getglobalvar'), args('var', 'tempvar'), args('var', 'settempvar'),
    plain('time', 'time'), plain('time', 'date'), plain('time', 'isotime'), plain('time', 'isodate'), plain('time', 'unixtime'),
    plain('time', 'idle_duration'), plain('time', 'random'), args('time', 'pick'),
    args('time', 'roll'), args('time', 'dice'), args('time', 'randint'),
    args('text', 'trim'), args('text', 'upper'), args('text', 'lower'), args('text', 'capitalize'), args('text', 'length'),
    args('text', 'replace'), args('text', 'split'), args('text', 'join'), plain('text', 'br'),
    args('logic', 'calc'), args('logic', 'round'), args('logic', 'floor'), args('logic', 'abs'), args('logic', 'equal'), args('logic', 'notequal'),
    args('logic', 'greater'), args('logic', 'less'), args('logic', 'and'), args('logic', 'or'), args('logic', 'not'), args('logic', 'contains'),
    args('display', 'raw'), args('display', 'img'), args('display', 'audio'), args('display', 'bg'),
    args('display', 'emotion'), plain('display', 'slot'), { id: 'comment', group: 'display', kind: 'comment', raw: '//' },
    blockRow('when', 'when', '#when ', 'when'), blockRow('if', 'if', '#if ', 'if'), blockRow('if_pure', 'if_pure', '#if_pure ', 'if_pure'),
    blockRow('each', 'each', '#each ', 'each'), blockRow('func', 'func', '#func ', 'func'), blockRow('pure', 'pure', '#pure', 'pure'),
    blockRow('pure_display', 'puredisplay', '#pure_display', 'pure_display'),
    { id: 'else', group: 'block', kind: 'else', raw: ':else' },
]
