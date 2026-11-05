// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const components = ['ChatShell', 'ShellHeader', 'ShellComposer', 'ShellSheet', 'PlusSheet', 'PersonaSheet', 'ExtrasStrip', 'ShellNotices', 'ShellFloatingButtons', 'ShellMessageList', 'ShellMessage', 'StreamingView']

const namedColours = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const named = new RegExp('(?<![\\w-])(?:' + namedColours.join('|') + ')(?![\\w-])', 'i')
const colour = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\s*\(/i

function literals(css: string): string[] {
    const found: string[] = []
    postcss.parse(css).walkDecls((decl) => {
        const value = decl.value.replace(/var\([^)]*\)/g, 'var()')
        if (colour.test(value) || named.test(value)) found.push(`${decl.prop}: ${decl.value}`)
        if (decl.prop === 'font-size' && /\d+(?:\.\d+)?px\b/i.test(value)) found.push(`${decl.prop}: ${decl.value}`)
        if (/\b\d+(?:\.\d+)?(?:ms|s)\b/i.test(value)) found.push(`${decl.prop}: ${decl.value}`)
    })
    return found
}

describe('T ChatShell CSS literals', () => {
    test('style blocks use tokens for colours, pixel font sizes and durations', () => {
        for (const component of components) {
            const source = readFileSync(path.join(root, 'src/lib/ChatShell', `${component}.svelte`), 'utf8')
            const styles = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1])
            for (const style of styles) expect(literals(style), component).toEqual([])
        }
    })
    test('a reintroduced literal is rejected', () => {
        expect(literals('.mutant { color: #fff; font-size: 13px; transition: opacity 200ms ease; }')).toHaveLength(3)
    })
})