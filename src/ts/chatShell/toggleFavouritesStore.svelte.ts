import { changeFavourites, readFavourites, serializeFavourites, type FavouriteChange, type FavouritesView } from './toggleFavourites'

// One reactive copy of the device-local favourites. The panel reads it and changes it only through
// updateFavourites, which applies each change to what device storage holds at that moment.
const store = $state<{ view: FavouritesView }>({ view: readFavourites() })
// What the shared copy last agreed with; an unreadable or unwritable storage keeps the session list.
let storedSerial = serialOf(readFavourites())

function serialOf(view: FavouritesView): string {
    return view.unreadable ? 'unreadable' : serializeFavourites(view.items)
}

export function currentFavourites(): FavouritesView {
    return store.view
}

// Adopts the stored list when storage changed behind the shared copy, for example in another tab. While the stored
// value is unreadable the session list is kept: it is all there is.
export function syncFavourites(): void {
    const stored = readFavourites()
    const serial = serialOf(stored)
    if (serial === storedSerial) return
    storedSerial = serial
    if (stored.unreadable) {
        store.view = { items: store.view.items, unreadable: true }
        return
    }
    store.view = stored
}

export function updateFavourites(change: FavouriteChange): void {
    store.view = changeFavourites(change, store.view.items)
    storedSerial = serialOf(readFavourites())
}
