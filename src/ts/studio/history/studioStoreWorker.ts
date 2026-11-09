// The entry of the Studio history store's module worker. Everything it does happens synchronously at the top
// level of the module: no top-level `await` stands before the handlers are assigned, so a message queued
// before the worker started is handed to a handler that exists.

import type { FromWorker } from './studioStoreProtocol'
import { createStudioStoreHost } from './studioStoreHost'
import { createStudioStoreIdb } from './studioStoreIdb'

function reply(message: FromWorker): void {
    self.postMessage(message)
}

const host = createStudioStoreHost(createStudioStoreIdb(), reply)

self.onmessage = (event: MessageEvent) => host.handle(event.data)
self.onmessageerror = () => reply({ t: 'fatal' })
