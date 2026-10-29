// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/util', () => ({
    sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
}))

let startFn: () => () => void
let dispose: (() => void) | null = null
let downloads: string[] = []
let writeText: ReturnType<typeof vi.fn>

// The pre-fix export returns a promise, so the disposer is recorded only when
// the export returns one.
function start() {
    const result = startFn()
    if (typeof result === 'function') {
        dispose = result
    }
    return result
}

const codeBlock = (lang: string, text = 'let a = 1') =>
    `<pre class="hljs" x-hl-lang="${lang}"><code>${text}</code></pre>`

function rightClick(target: Element) {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 }))
}

function menuOptions() {
    return Array.from(document.querySelectorAll('#code-contextmenu > div')) as HTMLElement[]
}

function chooseOption(label: string) {
    const option = menuOptions().find(o => o.textContent === label)
    expect(option).toBeDefined()
    option!.click()
}

beforeEach(async () => {
    vi.useFakeTimers()
    downloads = []
    writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    URL.createObjectURL = vi.fn(() => 'blob:fake')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download)
    })
    vi.resetModules()
    startFn = (await import('./observer.svelte')).startObserveDom as unknown as () => () => void
})

afterEach(() => {
    if (typeof dispose === 'function') {
        dispose()
    }
    dispose = null
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('code block context menu', () => {
    it('T-M1 one right-click builds one menu after any amount of idle time', async () => {
        document.body.innerHTML = codeBlock('js')
        start()
        await vi.advanceTimersByTimeAsync(500)
        const append = vi.spyOn(document.body, 'appendChild')
        rightClick(document.querySelector('code')!)
        const menus = append.mock.calls.filter(([node]) => (node as Element).id === 'code-contextmenu')
        expect(menus).toHaveLength(1)
        expect(menuOptions().map(o => o.textContent)).toEqual(['Copy', 'Download'])
    })

    it('T-M2 starting twice does not double the menu', async () => {
        document.body.innerHTML = codeBlock('js')
        start()
        start()
        await vi.advanceTimersByTimeAsync(500)
        const append = vi.spyOn(document.body, 'appendChild')
        rightClick(document.querySelector('code')!)
        const menus = append.mock.calls.filter(([node]) => (node as Element).id === 'code-contextmenu')
        expect(menus).toHaveLength(1)
    })

    it('T-M3 a block inserted after start has a menu with no timer advance', () => {
        start()
        document.body.innerHTML = `<div><div>${codeBlock('js')}</div></div>`
        rightClick(document.querySelector('code')!)
        expect(document.getElementById('code-contextmenu')).not.toBeNull()
    })

    it('T-M4 Copy writes the block text and Download names code.js', async () => {
        document.body.innerHTML = codeBlock('js', 'let a = 1')
        start()
        await vi.advanceTimersByTimeAsync(0)
        rightClick(document.querySelector('code')!)
        chooseOption('Copy')
        expect(writeText).toHaveBeenCalledWith('let a = 1')
        expect(document.getElementById('code-contextmenu')).toBeNull()
        rightClick(document.querySelector('code')!)
        chooseOption('Download')
        expect(downloads).toEqual(['code.js'])
    })

    it('T-M5 an element without x-hl-lang opens no menu', async () => {
        document.body.innerHTML = '<pre x-hl-lang=""><code>x</code></pre><p>plain</p>'
        start()
        await vi.advanceTimersByTimeAsync(0)
        rightClick(document.querySelector('code')!)
        rightClick(document.querySelector('p')!)
        expect(document.getElementById('code-contextmenu')).toBeNull()
    })

    it('T-B1 an authored extension outside the parser set downloads as code.txt', async () => {
        document.body.innerHTML = codeBlock('exe')
        start()
        await vi.advanceTimersByTimeAsync(0)
        rightClick(document.querySelector('code')!)
        chooseOption('Download')
        expect(downloads).toEqual(['code.txt'])
    })
})
