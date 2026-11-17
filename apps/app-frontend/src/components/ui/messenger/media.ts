import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'

import { proxiedFetch } from '@/helpers/proxy-fetch'

const blobs = new Map<string, Promise<string>>()

/** Видео и аудио вебвью не грузит с чужого домена (CSP), поэтому отдаём их как blob. */
export function mediaBlobUrl(url: string, mime: string): Promise<string> {
	const cached = blobs.get(url)
	if (cached) return cached
	const job = (async () => {
		const response = await proxiedFetch(url, { headers: { 'User-Agent': 'Undefined-Client' } })
		if (!response.ok) throw new Error(`media_${response.status}`)
		const data = await response.arrayBuffer()
		return URL.createObjectURL(new Blob([data], { type: mime || 'application/octet-stream' }))
	})()
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
