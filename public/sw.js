// @ts-nocheck

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)
    const path = url.pathname.split('/')
    if(path[1] === 'receive-files' && event.request.method === 'POST'){
        event.respondWith(receiveShare(event.request))
        return
    }
    if(path[1] === 'sw'){
        try {
            switch (path[2]){
                case "check":{
                    let targetUrl = url
                    const headers = event.request.headers
                    const headerUrl = headers.get('x-register-url')
                    if(headerUrl){
                        targetUrl.pathname = decodeURIComponent(headerUrl)
                    }
                    event.respondWith(checkCache(targetUrl))
                    break
                }
                case "img": {
                    event.respondWith(getSource(url))
                    break
                }
                case "register": {
                    let targetUrl = url
                    const headers = event.request.headers
                    const headerUrl = headers.get('x-register-url')
                    if(headerUrl){
                        targetUrl.pathname = decodeURIComponent(headerUrl)
                    }
                    const noContentType = headers.get('x-no-content-type') === 'true'
                    event.respondWith(
                        registerCache(targetUrl, event.request.arrayBuffer(), noContentType)
                    )
                    break
                }
                case "init":{
                    event.respondWith(new Response("v2"))
                    break
                }
                case 'share':{
                    event.respondWith(shareRoute(event.request, url, path))
                    break
                }
                default: {
                    event.respondWith(new Response(
                        path[2]
                    ))
                }
            }
        } catch (error) {
            event.respondWith(new Response(`${error}`))
        }
    }
    if(path[1] === 'tf'){{
        event.respondWith(new Response("Cannot find resource from cache", {
            status: 404
        }))
    }}
})


async function checkCache(url){
    const cache = await caches.open('risuCache')

    if(url.pathname.startsWith("/sw/check")) {
        url.pathname = "/sw/img" + url.pathname.slice(9);
        return new Response(JSON.stringify({
            "able": !!(await cache.match(url))
        }))
    }

    return new Response(JSON.stringify({
        "able": !!(await cache.match(url))
    }))
}

async function getSource(url){
    const cache = await caches.open('risuCache')
    return await cache.match(url)
}

async function check(){

}

async function registerCache(urlr, buffer, noContentType = false){
    const cache = await caches.open('risuCache')
    const url = new URL(urlr)
    if(!noContentType){
        let path = url.pathname.split('/')
        path[2] = 'img'
        url.pathname = path.join('/')
    }
    const buf = new Uint8Array(await buffer)
    if(buf.byteLength === 0){
        return new Response(JSON.stringify({
            "done": false,
            "error": "empty body"
        }))
    }
    let headers = {
        "cache-control": "max-age=604800",
        "content-type": "image/png"
    }
    if(noContentType){
        delete headers["content-type"]
    }
    await cache.put(url, new Response(buf, {
        headers
    }))
    return new Response(JSON.stringify({
        "done": true
    }))
}

// Shared files live in their own cache, apart from the asset cache. Each share is stored under
// /sw/share/<id>/<n> (files) and /sw/share/<id>/index, where <id> is "<receive time in ms>-<uuid>".
// The time in the id is what ages a share out, so it survives the index being claimed.
const SHARE_CACHE = 'risuShare'
const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SHARE_ID_PATTERN = /^[0-9]+-[0-9a-f-]+$/i

function shareUrl(path){
    return new URL(path, self.location.origin).href
}

function shareRedirect(hash){
    return new Response(null, {
        status: 303,
        headers: {
            Location: shareUrl('/' + hash)
        }
    })
}

function shareNotFound(){
    return new Response('Cannot find shared file', {
        status: 404
    })
}

function shareIdOfKey(keyUrl){
    const path = new URL(keyUrl).pathname.split('/')
    if(path[1] === 'sw' && path[2] === 'share' && SHARE_ID_PATTERN.test(path[3] ?? '')){
        return path[3]
    }
    return null
}

async function removeShareFiles(cache, id){
    for(const key of await cache.keys()){
        if(shareIdOfKey(key.url) === id){
            await cache.delete(key)
        }
    }
}

async function removeExpiredShares(cache){
    const now = Date.now()
    for(const key of await cache.keys()){
        const id = shareIdOfKey(key.url)
        if(id !== null && now - Number(id.split('-')[0]) > SHARE_MAX_AGE_MS){
            await cache.delete(key)
        }
    }
}

// Never rejects: every outcome is a 303 to the app, so the form POST never reaches the origin server.
async function receiveShare(request){
    let cache = null
    let id = null
    try {
        const form = await request.formData()
        const files = []
        for(const [, value] of form.entries()){
            if(typeof value !== 'string' && !(value.size === 0 && value.name === '')){
                files.push(value)
            }
        }
        cache = await caches.open(SHARE_CACHE)
        try {
            await removeExpiredShares(cache)
        } catch (error) {}
        if(files.length === 0){
            return shareRedirect('#share-empty')
        }
        id = `${Date.now()}-${crypto.randomUUID()}`
        const index = {files: []}
        for(let n = 0; n < files.length; n++){
            const file = files[n]
            const key = `/sw/share/${id}/${n}`
            const headers = {
                'x-file-name': encodeURIComponent(file.name)
            }
            if(file.type){
                headers['content-type'] = file.type
            }
            await cache.put(shareUrl(key), new Response(file, {headers}))
            index.files.push({key, name: file.name, type: file.type})
        }
        // The index goes in last, so an index that exists means every file it lists was stored.
        await cache.put(shareUrl(`/sw/share/${id}/index`), new Response(JSON.stringify(index), {
            headers: {
                'content-type': 'application/json'
            }
        }))
        return shareRedirect(`#share=${id}`)
    } catch (error) {
        if(cache && id){
            try {
                await removeShareFiles(cache, id)
            } catch (cleanupError) {}
        }
        return shareRedirect('#share-failed')
    }
}

async function shareRoute(request, url, path){
    try {
        const id = path[3]
        const part = path[4]
        if(!id || !SHARE_ID_PATTERN.test(id)){
            return shareNotFound()
        }
        const cache = await caches.open(SHARE_CACHE)
        if(request.method === 'GET' && part){
            return (await cache.match(shareUrl(`/sw/share/${id}/${part}`))) ?? shareNotFound()
        }
        if(request.method === 'DELETE' && part === 'index'){
            // Claiming: the caller that removes the index entry is the one that gets its content.
            const key = shareUrl(`/sw/share/${id}/index`)
            const hit = await cache.match(key)
            if(!hit){
                return shareNotFound()
            }
            const body = await hit.text()
            if(!(await cache.delete(key))){
                return shareNotFound()
            }
            return new Response(body, {
                headers: {
                    'content-type': 'application/json'
                }
            })
        }
        if(request.method === 'DELETE' && !part){
            await removeShareFiles(cache, id)
            return new Response(JSON.stringify({
                "done": true
            }))
        }
        return shareNotFound()
    } catch (error) {
        return new Response('Shared file storage failed', {
            status: 500
        })
    }
}