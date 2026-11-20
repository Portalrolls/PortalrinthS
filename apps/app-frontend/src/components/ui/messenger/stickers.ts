import { reactive } from 'vue'

import {
	type LooseRecord,
	resolveServiceMedia,
	serviceRequest,
	UPROJECTS_BASE,
} from '@/helpers/uprojects-service'

import { mediaBlobUrl, viaProxy } from './media'

export type StickerKind = 'lottie' | 'image' | 'video'

export type Sticker = { id: number; pack: string; emoji: string; url: string; kind: StickerKind }

export type StickerPack = {
	pack: string
	name: string
	count: number
	owned: boolean
	cover: Sticker | null
}

export type OwnSticker = { id: string; name: string; dataUrl: string; createdAt: number }

const SERVER_STICKER = /^\[\[sticker:(\d+)\]\]$/
export const PLAYER_STICKER_MARK = '[[psticker]]'
const OWN_KEY = 'portalrinth.messenger.stickers.own'
const OWN_LIMIT = 60
const OWN_SIDE = 512

export const stickers = reactive({
	catalog: {} as Record<number, Sticker>,
	mine: [] as Sticker[],
	packs: [] as StickerPack[],
	own: readOwn(),
	loaded: false,
	loading: false,
	error: '',
})

function readOwn(): OwnSticker[] {
	try {
		const raw = localStorage.getItem(OWN_KEY)
		const list = raw ? (JSON.parse(raw) as OwnSticker[]) : []
		return Array.isArray(list) ? list.filter((entry) => entry?.id && entry.dataUrl) : []
	} catch {
		return []
	}
}

function saveOwn(): boolean {
	try {
		localStorage.setItem(OWN_KEY, JSON.stringify(stickers.own))
		return true
	} catch {
		return false
	}
}

const jsonCache = new Map<string, Promise<unknown>>()

export function loadStickerJson(url: string): Promise<unknown> {
	let job = jsonCache.get(url)
	if (!job) {
		job = fetch(url).then((response) => {
			if (!response.ok) throw new Error('sticker')
			return response.json()
		})
		job.catch(() => jsonCache.delete(url))
		jsonCache.set(url, job)
		if (jsonCache.size > 48) jsonCache.delete(jsonCache.keys().next().value as string)
	}
	return job
}

export function stickerIdOf(body: string): number | null {
	const match = SERVER_STICKER.exec(body.trim())
	return match ? Number(match[1]) : null
}

export function isPlayerSticker(body: string): boolean {
	return body.trim() === PLAYER_STICKER_MARK
}

export function stickerPreviewText(body: string): boolean {
	return stickerIdOf(body) !== null || isPlayerSticker(body)
}

function kindOf(url: string, kind?: string): StickerKind {
	if (kind === 'image' || kind === 'video' || kind === 'lottie') return kind
	if (/\.(webp|png|gif|jpe?g)(\?|$)/i.test(url)) return 'image'
	if (/\.webm(\?|$)/i.test(url)) return 'video'
	return 'lottie'
}

function stickerUrl(raw: string): string {
	const value = raw.trim()
	if (value.startsWith('/stickers/')) return `${UPROJECTS_BASE}/api/messenger${value}`
	return resolveServiceMedia(value)
}

/** Сервер может не прислать стикер в каталоге — тогда файл ищем по id. */
export function stickerById(id: number): Sticker {
	const known = stickers.catalog[id]
	if (known) return known
	const url = stickerUrl(`/stickers/file/st_${id}.json`)
	return { id, pack: '', emoji: '', url, kind: 'lottie' }
}

function parseList(raw: unknown): Sticker[] {
	const rows = Array.isArray(raw) ? (raw as LooseRecord[]) : []
	const list: Sticker[] = []
	for (const row of rows) {
		const id = Number(row.id)
		const url = stickerUrl(String(row.url || ''))
		if (!(id > 0) || !url) continue
		const sticker = {
			id,
			pack: String(row.pack || ''),
			emoji: String(row.emoji || ''),
			url,
			kind: kindOf(url, String(row.kind || '')),
		}
		stickers.catalog[id] = sticker
		list.push(sticker)
	}
	return list
}

export async function loadStickers(force = false): Promise<void> {
	if (stickers.loading || (stickers.loaded && !force)) return
	stickers.loading = true
	stickers.error = ''
	try {
		const [all, mine] = await Promise.all([
			serviceRequest('/stickers'),
			serviceRequest('/stickers/mine'),
		])
		if (all.ok) parseList(all.data?.stickers)
		if (mine.ok) stickers.mine = parseList(mine.data?.stickers)
		else stickers.error = mine.error || 'network'
		stickers.loaded = mine.ok
	} finally {
		stickers.loading = false
	}
}

export async function loadPacks(): Promise<boolean> {
	const response = await serviceRequest('/stickers/catalog')
	if (!response.ok) return false
	const rows = Array.isArray(response.data?.packs) ? (response.data.packs as LooseRecord[]) : []
	stickers.packs = rows.map((row) => {
		const cover = row.cover as LooseRecord | null
		const parsed = cover ? parseList([{ ...cover, pack: row.pack }]) : []
		return {
			pack: String(row.pack || ''),
			name: String(row.name || row.pack || ''),
			count: Number(row.count) || 0,
			owned: Boolean(row.owned),
			cover: parsed[0] ?? null,
		}
	})
	return true
}

let preloaded = false

/**
 * Тихий прогрев до открытия меню стикеров: списки подтягиваются заранее, а
 * медиа своих стикеров качаются строго по одному, чтобы не занимать сеть.
 */
export async function preloadStickers(): Promise<void> {
	if (preloaded) return
	preloaded = true
	await loadStickers().catch(() => undefined)
	await loadPacks().catch(() => false)
	const proxied = await viaProxy().catch(() => false)
	for (const sticker of [...stickers.mine]) {
		try {
			if (sticker.kind === 'lottie') await loadStickerJson(sticker.url)
			else if (sticker.kind === 'video') await mediaBlobUrl(sticker.url, 'video/webm')
			else if (proxied) await mediaBlobUrl(sticker.url, '')
			else
				await new Promise<void>((resolve, reject) => {
					const image = new Image()
					image.onload = () => resolve()
					image.onerror = () => reject(new Error('image'))
					image.src = sticker.url
				})
		} catch {
			/* один стикер не прогрелся — при открытии он загрузится как раньше */
		}
	}
}

export async function setPackOwned(pack: string, add: boolean): Promise<boolean> {
	const response = await serviceRequest('/stickers/packs', {
		method: 'POST',
		body: { pack, add },
	})
	if (!response.ok) return false
	const entry = stickers.packs.find((item) => item.pack === pack)
	if (entry) entry.owned = add
	await loadStickers(true)
	return true
}

export type StickerGroup = { key: string; name: string; items: Sticker[] }

export function groupMine(list: Sticker[]): StickerGroup[] {
	const map = new Map<string, Sticker[]>()
	for (const sticker of list) {
		const bag = map.get(sticker.pack) || []
		bag.push(sticker)
		map.set(sticker.pack, bag)
	}
	return [...map.entries()]
		.map(([key, items]) => ({
			key,
			name: stickers.packs.find((pack) => pack.pack === key)?.name || key,
			items,
		}))
		.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.crossOrigin = 'anonymous'
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('image'))
		img.src = src
	})
}

/** Свои стикеры храним уменьшенными до 512px в WebP — качество в сообщении и лайтбоксе остаётся нормальным. */
async function shrink(src: string): Promise<string> {
	const img = await loadImage(src)
	const scale = Math.min(1, OWN_SIDE / Math.max(img.naturalWidth, img.naturalHeight, 1))
	const width = Math.max(1, Math.round(img.naturalWidth * scale))
	const height = Math.max(1, Math.round(img.naturalHeight * scale))
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('canvas')
	ctx.drawImage(img, 0, 0, width, height)
	const webp = canvas.toDataURL('image/webp', 0.92)
	return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
}

function readAsDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result || ''))
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}

export type OwnResult = 'ok' | 'full' | 'bad' | 'storage'

export async function addOwnSticker(source: Blob | string, name = ''): Promise<OwnResult> {
	if (stickers.own.length >= OWN_LIMIT) return 'full'
	let dataUrl = ''
	try {
		const src = typeof source === 'string' ? source : await readAsDataUrl(source)
		const animated = typeof source !== 'string' && source.type === 'image/gif'
		dataUrl = animated && source.size <= 2_500_000 ? src : await shrink(src)
	} catch {
		return 'bad'
	}
	const sticker: OwnSticker = {
		id: `own_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40),
		dataUrl,
		createdAt: Date.now(),
	}
	stickers.own.unshift(sticker)
	if (saveOwn()) return 'ok'
	stickers.own.shift()
	return 'storage'
}

export function removeOwnSticker(id: string): void {
	const index = stickers.own.findIndex((entry) => entry.id === id)
	if (index < 0) return
	stickers.own.splice(index, 1)
	saveOwn()
}

/** Чужой стикер из чата сохраняем к себе — по ссылке вложения. */
export async function saveStickerFromUrl(url: string): Promise<OwnResult> {
	try {
		const response = await fetch(url)
		if (!response.ok) return 'bad'
		return await addOwnSticker(await response.blob())
	} catch {
		return 'bad'
	}
}

export function ownStickerFile(sticker: OwnSticker): {
	name: string
	mime: string
	size: number
	dataBase64: string
	preview: string
} {
	const [head, data = ''] = sticker.dataUrl.split(',')
	const mime = /data:([^;]+)/.exec(head)?.[1] || 'image/png'
	const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
	return {
		name: `sticker.${ext}`,
		mime,
		size: Math.floor((data.length * 3) / 4),
		dataBase64: data,
		preview: sticker.dataUrl,
	}
}
