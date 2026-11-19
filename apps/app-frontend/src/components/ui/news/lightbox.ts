import { reactive } from 'vue'

import { isAnimatedImage, openMediaViewer } from '@/helpers/media-viewer'

export type LightboxItem = { url: string; video: boolean }

export const lightbox = reactive<{ items: LightboxItem[]; index: number; open: boolean }>({
	items: [],
	index: 0,
	open: false,
})

export function openLightbox(items: LightboxItem[], index = 0): void {
	if (!items.length) return
	const at = Math.min(Math.max(index, 0), items.length - 1)
	// Картинки — в общий просмотр, как у скриншотов; видео остаётся здесь.
	if (!items[at].video) {
		const images = items.filter((item) => !item.video)
		openMediaViewer(
			images.map((item) => ({ src: item.url, animated: isAnimatedImage(item.url) })),
			images.indexOf(items[at]),
		)
		return
	}
	lightbox.items = items
	lightbox.index = Math.min(Math.max(index, 0), items.length - 1)
	lightbox.open = true
}

export function closeLightbox(): void {
	lightbox.open = false
}

export function stepLightbox(delta: number): void {
	const count = lightbox.items.length
	if (count < 2) return
	lightbox.index = (((lightbox.index + delta) % count) + count) % count
}
