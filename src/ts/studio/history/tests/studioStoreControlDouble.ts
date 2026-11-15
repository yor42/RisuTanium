// A history store whose saves answer as the test scripts them, over the memory double's real storage. The modes
// stand for what a real store can do to one save: commit and answer `ok`; refuse before committing; never answer;
// commit and then answer `unwritable` (a lost or failed reply after the commit); or hold until the test releases it.

import type { OwnerKey } from '../ownerPhase'
import type { SaveResult } from '../studioHistoryStore'
import { createGate, createMemoryStudioStore, type Gate, type MemoryStudioStore, type MemoryStudioStoreOptions } from './studioStoreDoubles'

export type SaveMode = 'ok' | 'unwritable' | 'never' | 'storeThenUnwritable' | 'holdThenOk'

export interface ControlStudioStore extends MemoryStudioStore {
    // The modes of the next saves, in order; `fallback` answers once the script is empty.
    script: SaveMode[]
    fallback: SaveMode
    // Every save that reached the store, with the mode it was answered with and the owner and record it carried.
    readonly answered: { owner: OwnerKey; mode: SaveMode; stepIds: string[] }[]
    // The gate a `holdThenOk` save waits on; replaced after each release.
    hold: Gate
}

export function createControlStudioStore(options: MemoryStudioStoreOptions = {}): ControlStudioStore {
    const inner = createMemoryStudioStore(options)
    const answered: ControlStudioStore['answered'] = []
    const store: ControlStudioStore = {
        ...inner,
        script: [],
        fallback: 'ok',
        answered,
        hold: createGate(),
        async save(owner, record, protect): Promise<SaveResult> {
            const mode = store.script.shift() ?? store.fallback
            answered.push({ owner, mode, stepIds: [...record.done, ...record.undone].map((step) => step.id) })
            switch (mode) {
                case 'ok':
                    return inner.save(owner, record, protect)
                case 'unwritable':
                    return { kind: 'unwritable' }
                case 'never':
                    return new Promise<SaveResult>(() => {})
                case 'storeThenUnwritable':
                    await inner.save(owner, record, protect)
                    return { kind: 'unwritable' }
                case 'holdThenOk': {
                    const gate = store.hold
                    await gate.promise
                    return inner.save(owner, record, protect)
                }
            }
        },
    }
    return store
}
