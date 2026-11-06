export async function doLossyCompression(imageData: Uint8Array): Promise<Buffer> {
    // Invariant: a decode that fires neither onload nor onerror leaves the promise pending; no timeout is applied.
    return new Promise((resolve) => {
        const base64Image = 'data:image/png;base64,' + Buffer.from(imageData).toString('base64')
        const image = new Image()
        let canvas: HTMLCanvasElement | null = null
        let settled = false

        // The outcome is fixed before resources are released; handlers are detached
        // before src is cleared because clearing src fires an error event.
        const settle = (result: Buffer) => {
            if (settled) {
                return
            }
            settled = true
            resolve(result)
            if (canvas) {
                canvas.width = 0
                canvas.height = 0
            }
            image.onload = null
            image.onerror = null
            image.src = ''
        }

        const fallBackToOriginal = (reason: string) => {
            if (settled) {
                return
            }
            console.warn('Lossy image compression failed, keeping the original image: ' + reason)
            settle(Buffer.from(imageData))
        }

        image.onerror = () => {
            fallBackToOriginal('image decode failed')
        }
        image.onload = () => {
            try {
                canvas = document.createElement('canvas')
                const context = canvas.getContext('2d')
                if (!context) {
                    fallBackToOriginal('unable to get 2D context')
                    return
                }

                // Compute the new dimensions while maintaining aspect ratio
                let { width, height } = image
                if (width > 3000 || height > 3000) {
                    const aspectRatio = width / height
                    if (width > height) {
                        width = 3000
                        height = Math.round(width / aspectRatio)
                    } else {
                        height = 3000
                        width = Math.round(height * aspectRatio)
                    }
                }

                // Resize and draw the image to the canvas
                canvas.width = width
                canvas.height = height
                context.drawImage(image, 0, 0, width, height)

                // Try to convert to WebP
                let base64 = canvas.toDataURL('image/webp', 75)

                // If WebP is not supported, convert to JPEG
                if (base64.indexOf('data:image/webp') != 0) {
                    base64 = canvas.toDataURL('image/jpeg', 75)
                }

                const array = Buffer.from(base64.split(',')[1], 'base64')
                settle(array)
            } catch (error) {
                fallBackToOriginal(error instanceof Error ? error.message : String(error))
            }
        }
        image.src = base64Image
    })
}
