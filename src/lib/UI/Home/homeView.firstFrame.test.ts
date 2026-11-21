import { describe, expect, test } from 'vitest'
import { drainMicrotasks } from '../../../ts/tests/firstFrame.test-helpers'
import {
    engageHomeLibrary, homeView, openHomeLibrary, requestHomeLibrary, requestHomeReturnFocus, showHomeLanding,
    startHomeView, takeHomeReturnFocus,
} from './homeView.svelte'

describe('homeView pending library intent, before the first frame', () => {
    test('T13 a visit end clears the pending intent before the first frame, so a later creation starts at the top', async () => {
        requestHomeLibrary()
        // Only microtasks run: a wait that needs an animation frame or a timer has not finished.
        await drainMicrotasks()
        expect(startHomeView()).toBe(false)
    })

    test('CG a creation in the same turn as the request still resumes the library', () => {
        requestHomeLibrary()
        expect(startHomeView()).toBe(true)
    })

    test('S4a-U5 each creation resets the engaged flag; a resume of the library keeps it set', () => {
        homeView.libraryEngaged = true
        expect(startHomeView()).toBe(false)
        expect(homeView.libraryEngaged).toBe(false)

        requestHomeLibrary()
        expect(startHomeView()).toBe(true)
        expect(homeView.libraryEngaged).toBe(true)

        expect(startHomeView()).toBe(false)
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

describe('homeView library requests', () => {
    test('S4b-U1 opening the library engages it and raises the request counter by one', () => {
        startHomeView()
        const before = homeView.libraryRequest
        openHomeLibrary()
        expect(homeView.libraryEngaged).toBe(true)
        expect(homeView.libraryRequest).toBe(before + 1)
    })

    test('S4b-U1 requesting the library raises the counter, engages, and is resumed by a creation in the same turn only', async () => {
        startHomeView()
        const before = homeView.libraryRequest
        requestHomeLibrary()
        expect(homeView.libraryRequest).toBe(before + 1)
        expect(homeView.libraryEngaged).toBe(true)
        expect(startHomeView()).toBe(true)

        requestHomeLibrary()
        await drainMicrotasks()
        expect(startHomeView()).toBe(false)
    })

    test('S4b-U1 showing the landing drops a pending return focus and changes nothing else', () => {
        startHomeView()
        openHomeLibrary()
        const request = homeView.libraryRequest
        requestHomeReturnFocus('one')
        showHomeLanding()
        expect(takeHomeReturnFocus()).toBeNull()
        expect(homeView.libraryEngaged).toBe(true)
        expect(homeView.libraryRequest).toBe(request)
        startHomeView()
    })

    test('a creation that does not resume drops a pending return focus; a resuming one keeps it', () => {
        startHomeView()
        requestHomeReturnFocus('one')
        expect(startHomeView()).toBe(false)
        expect(takeHomeReturnFocus()).toBeNull()

        requestHomeLibrary()
        requestHomeReturnFocus('two')
        expect(startHomeView()).toBe(true)
        expect(takeHomeReturnFocus()).toBe('two')
        startHomeView()
    })
})
