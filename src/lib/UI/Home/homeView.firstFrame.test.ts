import { describe, expect, test } from 'vitest'
import { drainMicrotasks } from '../../../ts/tests/firstFrame.test-helpers'
import { engageHomeLibrary, homeView, openHomeLibrary, requestHomeLibrary, showHomeLanding, startHomeView } from './homeView.svelte'

describe('homeView pending library intent, before the first frame', () => {
    test('T13 a visit end clears the pending intent before the first frame, so a later creation starts at the landing', async () => {
        requestHomeLibrary()
        // Only microtasks run: a wait that needs an animation frame or a timer has not finished.
        await drainMicrotasks()
        expect(startHomeView()).toBe('landing')
    })

    test('CG a creation in the same turn as the request still resumes the library', () => {
        requestHomeLibrary()
        expect(startHomeView()).toBe('library')
    })

    test('S4a-U5 each creation resets the engaged flag; a resume of the library keeps it set', () => {
        homeView.libraryEngaged = true
        expect(startHomeView()).toBe('landing')
        expect(homeView.libraryEngaged).toBe(false)

        requestHomeLibrary()
        expect(startHomeView()).toBe('library')
        expect(homeView.libraryEngaged).toBe(true)

        expect(startHomeView()).toBe('landing')
        expect(homeView.libraryEngaged).toBe(false)
    })

    test('S4a-U5 opening or requesting the library, or touching it, engages; only a creation resets', () => {
        startHomeView()
        openHomeLibrary()
        expect(homeView.libraryEngaged).toBe(true)

        startHomeView()
        engageHomeLibrary()
        expect(homeView.libraryEngaged).toBe(true)
        showHomeLanding()
        expect(homeView.libraryEngaged).toBe(true)

        startHomeView()
        requestHomeLibrary()
        expect(homeView.libraryEngaged).toBe(true)
        startHomeView()
    })
})
