// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    classifyBlockStart,
    elseCapable,
    purity,
    registryNameFor,
    type BlockKeyword,
    type EngineBlockType,
} from './cbsBlocks'

const types = (...list: EngineBlockType[]): ReadonlySet<EngineBlockType> => new Set(list)

const complete = (text: string) => classifyBlockStart(text, true)
const incomplete = (text: string) => classifyBlockStart(text, false)

function blockOf(text: string): { keyword: BlockKeyword; types: ReadonlySet<EngineBlockType> } {
    const result = complete(text)
    if(result.kind !== 'block'){
        throw new Error(`expected a block for ${JSON.stringify(text)}, got ${result.kind}`)
    }
    return { keyword: result.keyword, types: result.types }
}

describe('classifyBlockStart, complete text', () => {
    test.each<[string, BlockKeyword, EngineBlockType[]]>([
        ['#if 1', 'if', ['parse']],
        ['#if true', 'if', ['parse']],
        ['#if 0', 'if', ['ignore']],
        ['#if', 'if', ['ignore']],
        ['#if  1', 'if', ['ignore']],
        ['#iffy 1', 'if', ['parse']],
        ['#if_pure 1', 'if_pure', ['ifpure']],
        ['#if_pure true', 'if_pure', ['ifpure']],
        ['#if_pure 0', 'if_pure', ['ignore']],
        ['#if_pure', 'if_pure', ['ignore']],
        ['#when 1', 'when', ['newif']],
        ['#when true', 'when', ['newif']],
        ['#when 0', 'when', ['newif-falsy']],
        ['#when x', 'when', ['newif-falsy']],
        ['#when', 'when', ['newif-falsy']],
        ['#whenx', 'when', ['newif-falsy']],
        ['#when:1', 'when', ['newif-falsy']],
        ['#when::1', 'when', ['newif']],
        ['#when::true', 'when', ['newif']],
        ['#when::0', 'when', ['newif-falsy']],
        ['#when::', 'when', ['newif-falsy']],
        ['#pure', 'pure', ['pure']],
        ['#pure_display', 'puredisplay', ['pure-display']],
        ['#puredisplay', 'puredisplay', ['pure-display']],
        ['#code', 'code', ['normalize']],
        ['#escape', 'escape', ['escape']],
        ['#escape::keep', 'escape', ['escape']],
        ['#escapex', 'escape', ['escape']],
        ['#each', 'each', ['each']],
        ['#each [1] as x', 'each', ['each']],
        ['#each::keep [1] as x', 'each', ['each']],
        ['#eachx', 'each', ['each']],
        ['#func a', 'func', ['function']],
        ['#func ', 'func', ['function']],
        ['#func a b', 'func', ['function']],
    ])('%s is a %s block of %j', (text, keyword, expected) => {
        const result = blockOf(text)
        expect(result.keyword).toBe(keyword)
        expect(result.types).toEqual(types(...expected))
    })

    test.each(['', '#', '#foo', ':else', ':foo', '#pure ', '#pure x', '#code ', '#puredisplay ', '#func', '#funcx', '#pur', '#whe', 'pure', '/', 'x'])(
        '%j is not a block',
        (text) => {
            expect(complete(text)).toEqual({ kind: 'nothing' })
        },
    )
})

describe('classifyBlockStart, the #when:: fold', () => {
    test.each<[string, EngineBlockType[]]>([
        ['#when::keep::1', ['newif']],
        ['#when::keep::0', ['newif-falsy']],
        ['#when::not::1', ['newif-falsy']],
        ['#when::not::0', ['newif']],
        ['#when::1::and::1', ['newif']],
        ['#when::1::and::0', ['newif-falsy']],
        ['#when::0::or::1', ['newif']],
        ['#when::0::or::0', ['newif-falsy']],
        ['#when::a::is::a', ['newif']],
        ['#when::a::is::b', ['newif-falsy']],
        ['#when::a::isnot::b', ['newif']],
        ['#when::a::isnot::a', ['newif-falsy']],
        ['#when::2::>::1', ['newif']],
        ['#when::1::>::2', ['newif-falsy']],
        ['#when::1::<::2', ['newif']],
        ['#when::2::>=::2', ['newif']],
        ['#when::3::<=::2', ['newif-falsy']],
    ])('%s folds to %j', (text, expected) => {
        expect(blockOf(text).types).toEqual(types(...expected))
    })

    test('legacy as an operator selects the legacy types; as a condition it does not', () => {
        expect(blockOf('#when::legacy::1').types).toEqual(types('parse'))
        expect(blockOf('#when::legacy::0').types).toEqual(types('ignore'))
        expect(blockOf('#when::legacy::not::1').types).toEqual(types('ignore'))
        expect(blockOf('#when::1::legacy').types).toEqual(types('newif-falsy'))
    })

    test('the last mode assignment in pop order wins', () => {
        // Popped from the right: `legacy` is read first, then `keep`.
        expect(blockOf('#when::keep::legacy::1').types).toEqual(types('newif'))
        // Popped from the right: `keep` is read first, then `legacy`.
        expect(blockOf('#when::legacy::keep::1').types).toEqual(types('parse'))
    })

    test.each<[string, EngineBlockType[]]>([
        ['#when::var::x', ['newif', 'newif-falsy']],
        ['#when::toggle::x', ['newif', 'newif-falsy']],
        ['#when::x::vis::y', ['newif', 'newif-falsy']],
        ['#when::x::visnot::y', ['newif', 'newif-falsy']],
        ['#when::x::tis::y', ['newif', 'newif-falsy']],
        ['#when::x::tisnot::y', ['newif', 'newif-falsy']],
        ['#when::not::var::x', ['newif', 'newif-falsy']],
        ['#when::keep::var::x', ['newif', 'newif-falsy']],
        ['#when::legacy::var::x', ['parse', 'ignore']],
        ['#when::1::and::var::x', ['newif', 'newif-falsy']],
        ['#when::0::and::var::x', ['newif-falsy']],
        ['#when::1::or::var::x', ['newif']],
        ['#when::a::is::var::x', ['newif', 'newif-falsy']],
    ])('chat state in %s gives %j', (text, expected) => {
        expect(blockOf(text).types).toEqual(types(...expected))
    })

    test('complete static legacy text is never value-dependent', () => {
        for(const text of ['#when::legacy::1', '#when::legacy::0', '#when::legacy::not::0', '#when::legacy::1::and::1']){
            expect(purity(blockOf(text).types)).not.toBe('maybe')
        }
    })
})

describe('classifyBlockStart, text with a nested value after the prefix', () => {
    test('a keyword that may still be completed or broken is undecidable', () => {
        expect(incomplete('#pur')).toEqual({ kind: 'undecidable' })
        expect(incomplete('#pure')).toEqual({ kind: 'undecidable' })
        expect(incomplete('#')).toEqual({ kind: 'undecidable' })
        expect(incomplete('')).toEqual({ kind: 'undecidable' })
        expect(incomplete('#func')).toEqual({ kind: 'undecidable' })
        expect(incomplete('#cod')).toEqual({ kind: 'undecidable' })
    })

    test('a prefix no keyword can complete is nothing', () => {
        expect(incomplete('#pure ')).toEqual({ kind: 'nothing' })
        expect(incomplete('#foo')).toEqual({ kind: 'nothing' })
        expect(incomplete('#code ')).toEqual({ kind: 'nothing' })
        expect(incomplete(':else ')).toEqual({ kind: 'nothing' })
    })

    test('#func with its space is a function block whatever follows', () => {
        const result = incomplete('#func ')
        expect(result).toEqual({ kind: 'block', keyword: 'func', types: types('function') })
        expect(incomplete('#func a ')).toEqual({ kind: 'block', keyword: 'func', types: types('function') })
    })

    test('#when with its space answers the newif pair', () => {
        expect(incomplete('#when ')).toEqual({ kind: 'block', keyword: 'when', types: types('newif', 'newif-falsy') })
    })

    test('#when:: answers every fold result and its purity is maybe', () => {
        const result = incomplete('#when::')
        if(result.kind !== 'block'){
            throw new Error('expected a block')
        }
        expect(result.types).toEqual(types('newif', 'newif-falsy', 'parse', 'ignore'))
        expect(purity(result.types)).toBe('maybe')
        expect(elseCapable(result.types)).toBe('maybe')
    })

    test('a closed state token is decided even while later text is open', () => {
        expect(incomplete('#when 1 ')).toEqual({ kind: 'block', keyword: 'when', types: types('newif') })
        expect(incomplete('#when 0 ')).toEqual({ kind: 'block', keyword: 'when', types: types('newif-falsy') })
        expect(incomplete('#if 1 ')).toEqual({ kind: 'block', keyword: 'if', types: types('parse') })
        expect(incomplete('#if 0 ')).toEqual({ kind: 'block', keyword: 'if', types: types('ignore') })
    })

    test('an open #if state can still become truthy or falsy', () => {
        expect(incomplete('#if ')).toEqual({ kind: 'block', keyword: 'if', types: types('parse', 'ignore') })
        expect(incomplete('#if 1')).toEqual({ kind: 'block', keyword: 'if', types: types('parse', 'ignore') })
        // `2` cannot grow into `true` or `1`.
        expect(incomplete('#if 2')).toEqual({ kind: 'block', keyword: 'if', types: types('ignore') })
        expect(incomplete('#if_pure ')).toEqual({ kind: 'block', keyword: 'if_pure', types: types('ifpure', 'ignore') })
    })

    test('a prefix of #if_pure may still become either #if or #if_pure', () => {
        const result = incomplete('#if_pur')
        if(result.kind !== 'block'){
            throw new Error('expected a block')
        }
        expect(result.types).toEqual(types('parse', 'ifpure', 'ignore'))
    })

    test('always-block heads are blocks whatever follows', () => {
        expect(incomplete('#escape')).toEqual({ kind: 'block', keyword: 'escape', types: types('escape') })
        expect(incomplete('#each ')).toEqual({ kind: 'block', keyword: 'each', types: types('each') })
        expect(incomplete('#whenx')).toEqual({ kind: 'block', keyword: 'when', types: types('newif-falsy') })
    })
})

describe('purity and elseCapable', () => {
    test.each<[EngineBlockType, 'yes' | 'no']>([
        ['ignore', 'yes'],
        ['pure', 'yes'],
        ['each', 'yes'],
        ['function', 'yes'],
        ['pure-display', 'yes'],
        ['escape', 'yes'],
        ['parse', 'no'],
        ['ifpure', 'no'],
        ['newif', 'no'],
        ['newif-falsy', 'no'],
        ['normalize', 'no'],
    ])('purity of %s is %s', (type, expected) => {
        expect(purity(types(type))).toBe(expected)
    })

    test('a mixed set is maybe', () => {
        expect(purity(types('ignore', 'parse'))).toBe('maybe')
        expect(purity(types('pure', 'each'))).toBe('yes')
        expect(purity(types('parse', 'newif'))).toBe('no')
    })

    test.each<[EngineBlockType, 'yes' | 'no']>([
        ['newif', 'yes'],
        ['newif-falsy', 'yes'],
        ['parse', 'no'],
        ['ifpure', 'no'],
        ['ignore', 'no'],
        ['pure', 'no'],
        ['each', 'no'],
        ['function', 'no'],
        ['normalize', 'no'],
    ])('elseCapable of %s is %s', (type, expected) => {
        expect(elseCapable(types(type))).toBe(expected)
    })

    test('elseCapable of a mixed set is maybe', () => {
        expect(elseCapable(types('newif', 'parse'))).toBe('maybe')
        expect(elseCapable(types('newif', 'newif-falsy'))).toBe('yes')
    })

    test('#if_pure 1 is not pure and #pure_display is', () => {
        expect(purity(blockOf('#if_pure 1').types)).toBe('no')
        expect(purity(blockOf('#puredisplay').types)).toBe('yes')
    })
})

describe('registryNameFor', () => {
    test.each<[BlockKeyword, string | null]>([
        ['if', '#if'],
        ['if_pure', '#if_pure'],
        ['when', '#when'],
        ['pure', '#pure'],
        ['puredisplay', '#puredisplay'],
        ['escape', '#escape'],
        ['each', '#each'],
        ['code', null],
        ['func', null],
    ])('%s names %j', (keyword, expected) => {
        expect(registryNameFor(keyword)).toBe(expected)
    })
})
