import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'

import { currentProxyUrl, proxiedFetch } from '@/helpers/proxy-fetch'

const blobs = new Map<string, Promise<string>>()

/** Одновременно качаем шесть файлов: чат с гифками не должен забирать всю сеть лаунчера. */
const SLOTS = 6
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

/** Видео и аудио вебвью не грузит с чужого домена (CSP), поэтому отдаём их как blob. */
export function mediaBlobUrl(url: string, mime: string): Promise<string> {
	const cached = blobs.get(url)
	if (cached) return cached
	const job = inSlot(async () => {
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
