import { appDataDir } from '@tauri-apps/api/path'
import * as fs from '@tauri-apps/plugin-fs'

import { install_create_modpack_instance, packLocationFromFile } from '@/helpers/install'
import { export_instance_mrpack, get_pack_export_candidates } from '@/helpers/instance'
import { proxiedFetch } from '@/helpers/proxy-fetch'
import type { GameInstance } from '@/helpers/types'
import { rebaseServiceUrl } from '@/helpers/uprojects-service'

import { MAX_FILE_BYTES, readFileBase64 } from './model'
import type { PendingAttachment } from './store'

export const BUILD_MIME = 'application/x-modrinth-modpack+zip'

export function isBuildFile(name: string): boolean {
	return /\.mrpack$/i.test(name)
}

function safeName(value: string): string {
	return value.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'build'
}

async function buildsDir(sub: string): Promise<{ dir: string; sep: string }> {
	const base = (await appDataDir()).replace(/[\\/]+$/, '')
	const sep = base.includes('\\') ? '\\' : '/'
	const dir = `${base}${sep}messenger-builds${sep}${sub}`
	await fs.mkdir(dir, { recursive: true })
	return { dir, sep }
}

export type BuildError = 'too_large' | 'export' | 'read'

/** Сборка уходит обычным .mrpack: те же файлы, что выбраны по умолчанию в окне экспорта. */
export async function packBuild(instance: GameInstance): Promise<PendingAttachment | BuildError> {
	const { dir, sep } = await buildsDir('outgoing')
	const name = `${safeName(instance.name)}.mrpack`
	const path = `${dir}${sep}${name}`
	try {
		const candidates = await get_pack_export_candidates(instance.id)
		const included = candidates
			.filter((file) => !file.disabled && file.defaultSelected)
			.map((file) => file.path)
		await export_instance_mrpack(instance.id, path, included, [], undefined, '', instance.name)
	} catch {
		return 'export'
	}
	try {
		const bytes = await fs.readFile(path)
		await fs.remove(path).catch(() => undefined)
		if (bytes.byteLength > MAX_FILE_BYTES) return 'too_large'
		const blob = new Blob([bytes], { type: BUILD_MIME })
		return {
			name,
			mime: BUILD_MIME,
			size: bytes.byteLength,
			dataBase64: await readFileBase64(blob),
			preview: '',
		}
	} catch {
		return 'read'
	}
}

/** Полученную сборку скачиваем во временную папку и ставим как новую установку.
    Качаем тем же клиентом, что и весь API: голый fetch из вебвью режется CSP —
    домена сервиса нет в connect-src, установка сборки всегда падала. */
export async function installBuild(url: string, name: string): Promise<boolean> {
	try {
		const response = await proxiedFetch(rebaseServiceUrl(url), {
			headers: { 'User-Agent': 'Undefined-Client' },
			connectTimeout: 12000,
		})
		if (!response.ok) return false
		const bytes = new Uint8Array(await response.arrayBuffer())
		const { dir, sep } = await buildsDir('incoming')
		const path = `${dir}${sep}${Date.now()}_${safeName(name)}`
		await fs.writeFile(path, bytes)
		await install_create_modpack_instance(packLocationFromFile(path))
		return true
	} catch {
		return false
	}
}
