/**
 * Суперинструменты — слияние «2 в 1»: лучшие идеи инструментов Undefined
 * Client (UAgent) и родные инструменты Portalrinth, собранные в по одному
 * усиленному варианту. Каждый инструмент знает путь, структуру папок и живое
 * состояние сборки, отвечает коротко и по делу, как и остальные инструменты
 * Портуса. Регистрируется один раз из App.vue.
 */
import { getVersion } from '@tauri-apps/api/app'
import { appDataDir } from '@tauri-apps/api/path'
import * as fs from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'

import { readSelectedBuild, registerAiToolHandler } from './ai-assistant'
import { describeBuild } from './ai-build-info'
import { get_content_items, get_full_path, list } from './instance'
import { get_game_versions, get_loader_versions } from './metadata'
import type { LooseRecord } from './uprojects-service'

/** Стандартные папки сборки: то, о чём игрок спрашивает чаще всего. */
const INSTANCE_DIRS: [string, string][] = [
	['mods', 'моды'],
	['config', 'конфиги'],
	['resourcepacks', 'ресурс-паки'],
	['shaderpacks', 'шейдеры'],
	['saves', 'миры'],
	['logs', 'логи'],
	['screenshots', 'скриншоты'],
	['crash-reports', 'краш-репорты'],
]

async function resolveBuild(raw: string): Promise<{ id: string; name: string } | string> {
	const wanted = raw.trim()
	const all = await list().catch(() => [])
	if (wanted) {
		const exact = all.find((instance) => instance.id === wanted)
		if (exact) return { id: exact.id, name: exact.name }
		const lower = wanted.toLowerCase()
		const byName =
			all.find((instance) => instance.name.toLowerCase() === lower) ??
			all.find((instance) => instance.name.toLowerCase().includes(lower))
		if (byName) return { id: byName.id, name: byName.name }
		return `Сборки «${wanted}» нет. Есть: ${all
			.slice(0, 15)
			.map((instance) => `«${instance.name}» (${instance.id})`)
			.join(', ')}`
	}
	const selected = readSelectedBuild()
	if (selected) return selected
	if (all.length === 1) return { id: all[0].id, name: all[0].name }
	return 'Не понял, какая сборка: укажи id или название (список — <<list_instances|>>)'
}

/** Карта папок сборки: что лежит и сколько файлов в каждой. */
async function folderMap(base: string): Promise<string> {
	const lines: string[] = []
	for (const [dir, label] of INSTANCE_DIRS) {
		try {
			const entries = await fs.readDir(`${base}/${dir}`)
			lines.push(`- ${dir}/ (${label}): ${entries.length} шт.`)
		} catch {
			lines.push(`- ${dir}/ (${label}): нет`)
		}
	}
	return lines.join('\n')
}

registerAiToolHandler(async (tool, args) => {
	switch (tool) {
		case 'instance_path': {
			const build = await resolveBuild(args.trim())
			if (typeof build === 'string') return build
			try {
				const base = (await get_full_path(build.id)).replace(/[\\/]+$/, '')
				return `Сборка «${build.name}»\nПолный путь: ${base}\nПапки:\n${await folderMap(base)}`
			} catch (error) {
				return `Путь не получился: ${String(error).slice(0, 200)}`
			}
		}
		case 'instance_ensure_dirs': {
			const build = await resolveBuild(args.trim())
			if (typeof build === 'string') return build
			try {
				const base = (await get_full_path(build.id)).replace(/[\\/]+$/, '')
				const made: string[] = []
				for (const [dir] of INSTANCE_DIRS) {
					const path = `${base}/${dir}`
					try {
						await fs.stat(path)
					} catch {
						await fs.mkdir(path, { recursive: true })
						made.push(dir)
					}
				}
				return made.length
					? `Создал папки в «${build.name}»: ${made.join(', ')}.`
					: `Все стандартные папки «${build.name}» уже на месте (${INSTANCE_DIRS.map(([dir]) => dir).join(', ')}).`
			} catch (error) {
				return `Папки не создались: ${String(error).slice(0, 200)}`
			}
		}
		case 'open_build_folder': {
			const build = await resolveBuild(args.trim())
			if (typeof build === 'string') return build
			try {
				await openPath(await get_full_path(build.id))
				return `Открыл папку сборки «${build.name}» в проводнике.`
			} catch (error) {
				return `Не открылось: ${String(error).slice(0, 200)}`
			}
		}
		case 'open_build_subfolder': {
			const [buildRaw = '', subRaw = ''] = args.split('::').map((part) => part.trim())
			const build = await resolveBuild(buildRaw)
			if (typeof build === 'string') return build
			const sub = subRaw.replace(/^[\\/]+/, '')
			try {
				const base = (await get_full_path(build.id)).replace(/[\\/]+$/, '')
				const target = sub ? `${base}/${sub}` : base
				await fs.stat(target)
				await openPath(target)
				return `Открыл «${target}» в проводнике.`
			} catch {
				const base = (await get_full_path(build.id)).replace(/[\\/]+$/, '')
				return `Папки «${sub}» в сборке нет. Есть: ${INSTANCE_DIRS.map(([dir]) => dir).join(', ')}. Полный путь сборки: ${base}`
			}
		}
		case 'open_launcher_folder': {
			try {
				const base = (await appDataDir()).replace(/[\\/]+$/, '')
				await openPath(base)
				return `Открыл папку лаунчера: ${base}`
			} catch (error) {
				return `Не открылось: ${String(error).slice(0, 200)}`
			}
		}
		case 'find_mod_in_build': {
			const modRaw = args.trim()
			if (!modRaw) return 'Формат: <<find_mod_in_build|мод или сокращение>> — ищет по ВСЕМ сборкам'
			const wanted = modRaw.toLowerCase()
			const all = await list().catch(() => [])
			const hits: string[] = []
			const seen: string[] = []
			for (const instance of all) {
				const items = await get_content_items(instance.id).catch(() => [])
				const found = items.filter((item) => {
					const title = (item.project?.title ?? '').toLowerCase()
					const file = item.file_name.toLowerCase()
					return title.includes(wanted) || file.includes(wanted)
				})
				if (found.length) {
					hits.push(
						`- «${instance.name}»: ${found
							.slice(0, 10)
							.map(
								(item) =>
									`${item.project?.title ?? item.file_name}${item.version?.version_number ? ` ${item.version.version_number}` : ''} (${item.enabled === false ? 'выкл' : 'вкл'})`,
							)
							.join('; ')}`,
					)
					for (const item of found.slice(0, 10)) {
						const title = item.project?.title
						if (title && !seen.includes(title.toLowerCase())) seen.push(title.toLowerCase())
					}
				}
			}
			if (!hits.length) {
				return `«${modRaw}» не нашёлся ни в одной сборке (${all.length} шт. просканировано). Проверь написание или поискать под установку: <<launcher_search_mods|${modRaw}::mod>>`
			}
			return `«${modRaw}» найден:\n${hits.join('\n')}\nДействия: переключить — <<mod_toggle|сборка::мод::вкл или выкл>>, обновить — <<mod_update|сборка::мод>>, зависимости — <<mod_deps|сборка::мод>>.`
		}
		case 'list_java': {
			try {
				const runtimes = (await list_installed_runtimes().catch(() => [])) as LooseRecord[]
				const lines = runtimes.map((row) => {
					const path = row?.path ?? row?.full_path ?? ''
					const version = row?.version ?? row?.name ?? ''
					return `- Java ${version} — ${path}`
				})
				return `Установленные Java:\n${lines.join('\n') || '— системных записей нет'}\nУстановить под версию: <<launcher_install|версия>> не нужно — лаунчер сам ставит нужную Java при создании сборки.`
			} catch (error) {
				return `Список Java не получился: ${String(error).slice(0, 200)}`
			}
		}
		case 'list_mc_versions': {
			try {
				const versions = (await get_game_versions()) as unknown[]
				const snapshot = versions.slice(-15).reverse() as LooseRecord[]
				return `Версии Minecraft (всего ${versions.length}; последние 15 — от старых к новым):\n${snapshot
					.map(
						(row) =>
							`- ${String((row as LooseRecord)?.version ?? (row as LooseRecord)?.id ?? row)}`,
					)
					.join('\n')}\nСоздать сборку под версию: <<create_instance|название::версия::ядро>>`
			} catch (error) {
				return `Список версий не получился: ${String(error).slice(0, 200)}`
			}
		}
		case 'list_loader_versions': {
			const loader = args.trim().toLowerCase() || 'fabric'
			if (!['fabric', 'forge', 'neoforge', 'quilt'].includes(loader))
				return `Ядро «${loader}» не знаю. Ядра: fabric, forge, neoforge, quilt.`
			try {
				const versions = (await get_loader_versions(loader)) as unknown[]
				const tail = versions.slice(-12) as LooseRecord[]
				return `Версии ${loader} (последние 12):\n${tail.map((row) => `- ${String((row as LooseRecord)?.version ?? (row as LooseRecord)?.id ?? row)}`).join('\n')}`
			} catch (error) {
				return `Версии ${loader} не получились: ${String(error).slice(0, 200)}`
			}
		}
		case 'list_configs': {
			const build = await resolveBuild(args.trim())
			if (typeof build === 'string') return build
			try {
				const base = (await get_full_path(build.id)).replace(/[\\/]+$/, '')
				const entries = await fs.readDir(`${base}/config`).catch(() => [] as fs.DirEntry[])
				if (!entries.length)
					return `В «${build.name}» папки config нет или она пуста (конфиги появляются после первого запуска игры).`
				const files = entries.filter((entry) => !entry.isDirectory).slice(0, 60)
				const dirs = entries.filter((entry) => entry.isDirectory).slice(0, 30)
				return `Конфиги «${build.name}» (config/):\n${dirs.map((entry) => `- ${entry.name}/`).join('\n')}\n${files.map((entry) => `- ${entry.name}`).join('\n')}\nЧитать: <<instance_read|${build.name}::config/файл>>, править: <<instance_write|сборка::config/файл::текст>>.`
			} catch (error) {
				return `Конфиги не прочитались: ${String(error).slice(0, 200)}`
			}
		}
		case 'launcher_info': {
			try {
				const [version, dataDir, all, selected] = await Promise.all([
					getVersion().catch(() => '?'),
					appDataDir().catch(() => '?'),
					list().catch(() => []),
					readSelectedBuild(),
				])
				const selectedLine = selected
					? `Выбранная сборка: «${selected.name}» — ${await describeBuild(selected.id).catch(() => '')}`
					: 'Выбранная сборка: не выбрана'
				return `Portalrinth (форк Modrinth App), версия ${version}\nПапка лаунчера: ${dataDir}\nСборок: ${all.length} — ${all
					.slice(0, 10)
					.map((instance) => `«${instance.name}»`)
					.join(', ')}${all.length > 10 ? ' и др.' : ''}\n${selectedLine}`
			} catch (error) {
				return `Инфо не собралось: ${String(error).slice(0, 200)}`
			}
		}
		default:
			return undefined
	}
})
