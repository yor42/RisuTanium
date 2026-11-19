/**
 * `public/manifest.json` is the file the browser installs the web app from. It declares the file handler for card,
 * preset and module files and no share target: no page code receives a share POST or a `#share=` hash.
 *
 * Labels: regression reproducer (the manifest still declares `share_target`), compatibility guard (the `file_handlers`
 * entry stays and keeps its three extensions).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

type FileHandler = { action: string, accept: Record<string, string[]> }
type Manifest = { share_target?: unknown, file_handlers?: FileHandler[] }

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../public/manifest.json'), 'utf8')) as Manifest

describe('public/manifest.json', () => {
    test('R5 declares no share target', () => {
        expect(manifest.share_target).toBeUndefined()
    })

    test('guard: the file handler for .charx, .risup and .risum stays (passes before and after)', () => {
        expect(manifest.file_handlers).toEqual([
            { action: '/', accept: { 'application/octet-stream': ['.charx', '.risup', '.risum'] } },
        ])
    })
})
