// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile, parse, type AST } from 'svelte/compiler'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

function readComponent(relPath: string): string {
    return readFileSync(path.join(root, relPath), 'utf8')
}

function compiledCss(relPath: string): postcss.Root {
    const source = readComponent(relPath)
    const { css } = compile(source, { filename: path.basename(relPath), generate: 'client', css: 'external' })
    return postcss.parse(css?.code ?? '')
}

function declsMatching(cssRoot: postcss.Root, predicate: (selector: string) => boolean): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    cssRoot.walkRules((rule) => {
        if (!predicate(rule.selector)) return
        rule.walkDecls((decl) => {
            (result[decl.prop] ??= []).push(decl.value)
        })
    })
    return result
}

describe('ChatShell persona tab clearance and floating control alignment', () => {
    test('ShellComposer omits top margin on first-child composer and reserves it only after notices', () => {
        const css = compiledCss('src/lib/ChatShell/ShellComposer.svelte')
        const bareComposer = declsMatching(
            css,
            (sel) => sel.includes('[data-part="chat-composer"]') && !sel.includes(':not(:first-child)'),
        )
        const followingComposer = declsMatching(
            css,
            (sel) => sel.includes('[data-part="chat-composer"]') && sel.includes(':not(:first-child)'),
        )

        expect(bareComposer['margin-block-start']).toBeUndefined()
        expect(followingComposer['margin-block-start']).toEqual(['var(--size-touch)'])
    })

    test('ChatShell transcript reserves bottom padding for the floating tab and raises composer-host stacking', () => {
        const css = compiledCss('src/lib/ChatShell/ChatShell.svelte')
        const transcript = declsMatching(
            css,
            (sel) => sel.includes('[data-part="chat-transcript"]') && !sel.includes('[data-find-open]') && !sel.includes('[data-header-concealed]') && !sel.includes('mark.search-mark') && !sel.includes('[data-fade'),
        )
        const composerHost = declsMatching(css, (sel) => sel.includes('[data-part="chat-composer-host"]'))

        expect(transcript['padding-bottom']).toEqual(['var(--size-touch)'])
        expect(transcript['scroll-padding-bottom']).toEqual(['var(--size-touch)'])
        expect(composerHost['position']).toEqual(['relative'])
        expect(composerHost['z-index']).toEqual(['2'])
    })

    test('jump and scrubber share an offset that clears the measured composer', () => {
        const shellPath = 'src/lib/ChatShell/ChatShell.svelte'
        const jumpHost = declsMatching(compiledCss(shellPath), (sel) => sel.includes('.jump-host'))
        expect(jumpHost['--chat-jump-bottom']).toEqual([
            'max(calc(var(--size-34) + env(safe-area-inset-bottom)), calc(var(--chat-composer-height) + var(--space-7)))',
        ])

        const floatingCss = compiledCss('src/lib/ChatShell/ShellFloatingButtons.svelte')
        const jumpButton = declsMatching(floatingCss, (sel) => sel.includes('[data-part="chat-new-message"]') && !sel.includes('.badge'))
        expect(jumpButton['bottom']).toEqual(['var(--chat-jump-bottom)'])
        expect(jumpButton['inset-inline-end']).toEqual(['var(--space-12)'])

        const scrubberCss = compiledCss('src/lib/ChatShell/Scrubber.svelte')
        const scrubber = declsMatching(
            scrubberCss,
            (sel) => sel.includes('[data-part="chat-scrubber"]') && !sel.includes('[data-hidden]') && !sel.includes('[data-find-open]'),
        )
        expect(scrubber['bottom']).toEqual(['calc(var(--chat-jump-bottom) + var(--size-touch-lg) + var(--space-7))'])

        const hintCss = compiledCss('src/lib/ChatShell/LongChatHint.svelte')
        const hint = declsMatching(hintCss, (sel) => sel.includes('[data-part="chat-long-hint"]'))
        expect(hint['bottom']).toEqual(['var(--size-37)'])

        const chipCss = compiledCss('src/lib/ChatShell/ReturnChip.svelte')
        const chip = declsMatching(chipCss, (sel) => sel.includes('[data-part="chat-return-chip"]'))
        expect(chip['bottom']).toEqual(['var(--size-37)'])
    })
})

function dataPartValue(node: AST.ElementLike): string | null {
    for (const attr of node.attributes) {
        if (attr.type !== 'Attribute' || attr.name !== 'data-part') continue
        if (Array.isArray(attr.value)) {
            return attr.value.map((part) => (part.type === 'Text' ? part.data : '')).join('')
        }
    }
    return null
}

function childFragments(node: AST.Fragment['nodes'][number]): AST.Fragment[] {
    if ('fragment' in node && node.fragment) return [node.fragment]
    switch (node.type) {
        case 'IfBlock':
            return [node.consequent, ...(node.alternate ? [node.alternate] : [])]
        case 'EachBlock':
            return [node.body, ...(node.fallback ? [node.fallback] : [])]
        case 'AwaitBlock':
            return [node.pending, node.then, node.catch].filter((frag): frag is AST.Fragment => frag !== null)
        case 'SnippetBlock':
            return [node.body]
        default:
            return []
    }
}

describe('ChatShell message CSS stacking isolation', () => {
    test('ShellMessage isolates chat-message-body without isolating chat-message or trapping PartialEditController', () => {
        const msgSource = readComponent('src/lib/ChatShell/ShellMessage.svelte')
        const msgCss = compiledCss('src/lib/ChatShell/ShellMessage.svelte')
        const body = declsMatching(
            msgCss,
            (sel) => sel.includes('[data-part="chat-message-body"]') && !sel.includes('[data-spring]') && !sel.includes('[data-commit') && !sel.includes('[data-settle]') && !sel.includes('[data-theme-pack-base]') && !sel.includes('mark['),
        )
        const article = declsMatching(
            msgCss,
            (sel) => sel.includes('[data-part="chat-message"]') && !sel.includes('.user') && !sel.includes('body'),
        )

        expect(body['isolation']).toEqual(['isolate'])
        expect(article['isolation']).toBeUndefined()

        // PartialEditController must remain outside chat-message-stage / chat-message-body so its fixed overlay stays untrapped.
        const ast = parse(msgSource, { filename: 'ShellMessage.svelte', modern: true })
        let foundStage = false
        let foundBody = false
        let foundPartialEdit = false
        let partialEditInsideStageOrBody = false

        function walk(fragment: AST.Fragment, insideStageOrBody: boolean): void {
            for (const node of fragment.nodes) {
                let nextInside = insideStageOrBody
                if (node.type === 'RegularElement') {
                    const part = dataPartValue(node)
                    if (part === 'chat-message-stage') { foundStage = true; nextInside = true }
                    if (part === 'chat-message-body') { foundBody = true; nextInside = true }
                } else if (node.type === 'Component' && node.name === 'PartialEditController') {
                    foundPartialEdit = true
                    if (insideStageOrBody) partialEditInsideStageOrBody = true
                }
                for (const child of childFragments(node)) {
                    walk(child, nextInside)
                }
            }
        }
        walk(ast.fragment, false)

        expect(foundStage).toBe(true)
        expect(foundBody).toBe(true)
        expect(foundPartialEdit).toBe(true)
        expect(partialEditInsideStageOrBody).toBe(false)
    })

    test('ChatShell header-host sits above transcript search/switch layers without isolating chat-transcript', () => {
        const shellCss = compiledCss('src/lib/ChatShell/ChatShell.svelte')
        const headerHost = declsMatching(shellCss, (sel) => sel.includes('[data-part="chat-header-host"]'))
        const transcript = declsMatching(shellCss, (sel) => sel.includes('[data-part="chat-transcript"]'))

        const listCss = compiledCss('src/lib/ChatShell/ShellMessageList.svelte')
        const hitNote = declsMatching(listCss, (sel) => sel.includes('.search-hit-note'))

        const switchCss = compiledCss('src/lib/ChatShell/SwitchFrame.svelte')
        const switchFrame = declsMatching(switchCss, (sel) => sel.includes('[data-part="chat-switch-frame"]'))

        expect(headerHost['z-index']).toEqual(['2'])
        expect(Number(headerHost['z-index']?.[0])).toBeGreaterThan(Number(hitNote['z-index']?.[0]))
        expect(Number(headerHost['z-index']?.[0])).toBeGreaterThan(Number(switchFrame['z-index']?.[0]))
        expect(transcript['isolation']).toBeUndefined()
    })

    test('BackgroundDom isolates its root container', () => {
        const bgSource = readComponent('src/lib/ChatScreens/BackgroundDom.svelte')
        expect(bgSource).toMatch(/class="[^"]*\bisolate\b[^"]*"[^>]*CARD_BACKGROUND_ATTR/)
    })
})
