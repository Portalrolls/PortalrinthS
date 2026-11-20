import { save } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'

import { currentProxyUrl, proxiedFetch } from '@/helpers/proxy-fetch'

const blobs = new Map<string, Promise<string>>()

/** Одновременно качаем десять файлов: чат с гифками не должен забирать всю сеть лаунчера. */
const SLOTS = 10
const MEDIA_TIMEOUT = 90000
let busy = 0
const waiting: (() => void)[] = []

async function inSlot<T>(task: () => Promise<T>): Promise<T> {
	if (busy >= SLOTS) await new Promise<void>((resolve) => waiting.push(resolve))
	busy += 1
	try {
		return await task()
	} finally {
		busy -= 1
		waiting.shift()?.()
	}
}

/** Задан прокси — значит, напрямую до сервиса не достучаться, и картинки тоже идут через него. */
export async function viaProxy(): Promise<boolean> {
	return Boolean(await currentProxyUrl())
}

const CACHE_DIR = 'media-cache'

/** Ключ кэша без токена сессии: файл один и тот же, каким бы токеном ни качали. */
function cacheKey(url: string): string {
	const stable = url.replace(/([?&])token=[^&]*/g, '$1').replace(/[?&]$/, '')
	let first = 0x811c9dc5
	let second = 0x1000193
	for (let index = 0; index < stable.length; index += 1) {
		const code = stable.charCodeAt(index)
		first = Math.imul(first ^ code, 16777619)
		second = Math.imul(second ^ code, 2246822519)
	}
	return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}${stable.length.toString(36)}`
}

let cacheReady = false

async function ensureCacheDir(): Promise<boolean> {
	if (cacheReady) return true
	try {
		await mkdir(CACHE_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
		cacheReady = true
	} catch {
		cacheReady = false
	}
	return cacheReady
}

async function readCache(url: string): Promise<Uint8Array | null> {
	if (!(await ensureCacheDir())) return null
	try {
		return await readFile(`${CACHE_DIR}/${cacheKey(url)}`, { baseDir: BaseDirectory.AppData })
	} catch {
		return null
	}
}

async function writeCache(url: string, data: ArrayBuffer): Promise<void> {
	if (!(await ensureCacheDir())) return
	try {
		await writeFile(`${CACHE_DIR}/${cacheKey(url)}`, new Uint8Array(data), {
			baseDir: BaseDirectory.AppData,
		})
	} catch {
		/* переполнился диск — кэш просто не пишется */
	}
}

/** Видео и аудио вебвью не грузит с чужого домена (CSP), поэтому отдаём их как blob. */
export function mediaBlobUrl(url: string, mime: string): Promise<string> {
	const cached = blobs.get(url)
	if (cached) return cached
	const job = inSlot(async () => {
		// Скачанное живёт на диске: открытый повторно чат не качает всё заново.
		const saved = await readCache(url)
		if (saved?.length) {
			return URL.createObjectURL(new Blob([saved], { type: mime || 'application/octet-stream' }))
		}
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT)
		try {
			const response = await proxiedFetch(url, {
				headers: { 'User-Agent': 'Undefined-Client' },
				connectTimeout: 12000,
				signal: controller.signal,
			})
			if (!response.ok) throw new Error(`media_${response.status}`)
			const data = await response.arrayBuffer()
			void writeCache(url, data)
			const type = mime || response.headers.get('content-type') || 'application/octet-stream'
			return URL.createObjectURL(new Blob([data], { type }))
		} finally {
			clearTimeout(timer)
		}
	})
	blobs.set(url, job)
	job.catch(() => blobs.delete(url))
	return job
}

export async function downloadAttachment(
	url: string,
	name: string,
): Promise<'saved' | 'cancel' | 'opened'> {
	const target = await save({ defaultPath: name }).catch(() => null)
	if (target === null) return 'cancel'
	try {
		const response = await proxiedFetch(url, { headers: { 'User-Agent': 'Undefined-Client' } })
		if (!response.ok) throw new Error(`download_${response.status}`)
		await writeFile(target, new Uint8Array(await response.arrayBuffer()))
		return 'saved'
	} catch {
		await openUrl(url)
		return 'opened'
	}
}
