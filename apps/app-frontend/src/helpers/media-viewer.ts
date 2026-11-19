import { reactive } from 'vue'

import { proxiedFetch } from '@/helpers/proxy-fetch'

/**
 * Общий полноэкранный просмотр картинок — тот же, что у скриншотов.
 * Мессенджер и новости только передают список, остальное делает MediaViewerHost.
 */
export type MediaViewerItem = {
	src: string
	name?: string
	/** GIF смотрим, но в скриншоты не кладём: там только статичные картинки. */
	animated?: boolean
}

export const mediaViewer = reactive({
	items: [] as MediaViewerItem[],
	index: 0,
	/** Растёт при каждом открытии, чтобы повторный клик по той же картинке тоже срабатывал. */
	seq: 0,
})

export function openMediaViewer(items: MediaViewerItem[], index = 0): void {
	const list = items.filter((item) => item.src)
	if (!list.length) return
	mediaViewer.items = list
	mediaViewer.index = Math.min(Math.max(index, 0), list.length - 1)
	mediaViewer.seq += 1
}

export function isAnimatedImage(name = '', mime = ''): boolean {
	return /gif/i.test(mime) || /\.gif(?:$|\?)/i.test(name)
}

/** Байты картинки: blob/data — напрямую, сеть — сначала вебвью, потом клиентом лаунчера. */
export async function imageBytes(src: string): Promise<Uint8Array> {
	if (src.startsWith('data:')) {
		const base64 = src.slice(src.indexOf(',') + 1)
		return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
	}
	let response: Response | null = null
	if (src.startsWith('blob:')) response = await fetch(src)
	else {
		response = await fetch(src).catch(() => null)
		if (!response?.ok) response = await proxiedFetch(src, { signal: AbortSignal.timeout(30000) })
	}
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	return new Uint8Array(await response.arrayBuffer())
}

/** Папка скриншотов индексирует PNG, поэтому всё перекодируем в него. */
export async function pngBytes(src: string): Promise<Uint8Array> {
	const bytes = await imageBytes(src)
	const bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer]))
	const canvas = document.createElement('canvas')
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	const context = canvas.getContext('2d')
	if (!context) {
		bitmap.close()
		throw new Error('canvas is unavailable')
	}
	context.drawImage(bitmap, 0, 0)
	bitmap.close()
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
	if (!blob) throw new Error('PNG encoding failed')
	return new Uint8Array(await blob.arrayBuffer())
}
