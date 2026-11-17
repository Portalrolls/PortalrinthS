import { reactive } from 'vue'

export type LightboxItem = { url: string; video: boolean }

export const lightbox = reactive<{ items: LightboxItem[]; index: number; open: boolean }>({
	items: [],
	index: 0,
	open: false,
})

export function openLightbox(items: LightboxItem[], index = 0): void {
	if (!items.length) return
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
