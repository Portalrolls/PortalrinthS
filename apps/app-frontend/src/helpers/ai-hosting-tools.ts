/**
 * Portalus's hands on the player's own Self-Hosted servers: see what runs,
 * start and stop them, read the console and type commands into it, exactly
 * as the player would on the server's console tab.
 */
import { noteAgentThought, registerAiFinishHandler, registerAiToolHandler } from './ai-assistant'
import { installToHostedServer, NoFittingVersionError, searchHostedContent } from './hosted-content'
import {
	hostedAddress,
	type HostedServerView,
	hosting_command,
	hosting_file_read,
	hosting_file_write,
	hosting_files,
	hosting_get,
	hosting_list,
	hosting_log,
	hosting_plugin_remove,
	hosting_plugin_toggle,
	hosting_plugins,
	hosting_restart,
	hosting_start,
	hosting_stop,
	isHostedActive,
} from './hosting'

const STATUS: Record<string, string> = {
	stopped: 'выключен',
	installing: 'устанавливается',
	starting: 'запускается',
	running: 'работает',
	stopping: 'выключается',
	crashed: 'упал',
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function describe(server: HostedServerView) {
	const address = hostedAddress(server) ?? `localhost:${server.port}`
	const players =
		server.status === 'running'
			? `, онлайн ${server.players.length}/${server.max_players}${server.players.length ? `: ${server.players.join(', ')}` : ''}`
			: ''
	return `- «${server.name}» (id ${server.id}): ${STATUS[server.status] ?? server.status}, ${server.software} ${server.game_version}, адрес \`${address}\`${players}`
}

async function resolveServer(raw: string): Promise<HostedServerView | string> {
	const servers = await hosting_list().catch(() => [] as HostedServerView[])
	if (servers.length === 0)
		return 'У игрока нет своих серверов. Создать: экран Self-Hosted — [Self-Hosted](/server-hosting).'
	const wanted = raw.trim().toLowerCase()
	if (!wanted) {
		const running = servers.filter((server) => isHostedActive(server.status))
		if (servers.length === 1) return servers[0]
		if (running.length === 1) return running[0]
		return `Какой сервер? Спроси игрока через ask_user. Серверы:\n${servers.map(describe).join('\n')}`
	}
	const found =
		servers.find((server) => server.id === raw.trim()) ??
		servers.find((server) => server.name.toLowerCase() === wanted) ??
		servers.find((server) => server.name.toLowerCase().includes(wanted))
	return found ?? `Сервер «${raw.trim()}» не найден. Есть:\n${servers.map(describe).join('\n')}`
}

function splitArgs(args: string): [string, string] {
	const at = args.indexOf('::')
	return at < 0 ? ['', args.trim()] : [args.slice(0, at).trim(), args.slice(at + 2).trim()]
}

async function waitRunning(id: string, timeoutMs: number) {
	const started = Date.now()
	while (Date.now() - started < timeoutMs) {
		const fresh = await hosting_get(id).catch(() => null)
		if (
			!fresh ||
			fresh.status === 'running' ||
			fresh.status === 'crashed' ||
			fresh.status === 'stopped'
		)
			return fresh
		await sleep(1500)
	}
	return hosting_get(id).catch(() => null)
}

async function runCommands(server: HostedServerView, commands: string[], gapMs = 150) {
	const before = await hosting_log(server.id).catch(() => [] as string[])
	const mark = before[before.length - 1]
	for (const command of commands) {
		await hosting_command(server.id, command)
		await sleep(gapMs)
	}
	let answer: string[] = []
	for (let attempt = 0; attempt < 6; attempt++) {
		await sleep(attempt === 0 ? 700 : 400)
		const after = await hosting_log(server.id).catch(() => [] as string[])
		const from = mark === undefined ? 0 : after.lastIndexOf(mark) + 1
		answer = (from > 0 || mark === undefined ? after.slice(from) : after.slice(-24)).filter(
			(line) => !line.startsWith('> '),
		)
		if (answer.length >= commands.length) break
	}
	return answer.map((line) => line.replace(ANSI, '').trim()).filter(Boolean)
}

function parseCommands(raw: string, limit: number) {
	return raw
		.split(/;;|\n/)
		.map((command) => command.trim().replace(/^\//, ''))
		.filter(Boolean)
		.slice(0, limit)
}

/** Console lines carry a «[12:00:00 INFO]: » head; the model needs only the text. */
function stripHead(line: string) {
	return line.replace(/^\[[^\]]*\]\s*(?:\[[^\]]*\]\s*)?:?\s*/, '')
}

const COMMAND_ERROR_RE =
	/unknown|incorrect|invalid|expected|no (?:player|entity|entities|block|item)|could not|cannot|can't|not loaded|out of (?:the )?world|too many blocks|failed|<--\[HERE\]/i

function atLeast(version: string, major: number, minor: number, patch = 0) {
	const [a = 0, b = 0, c = 0] = version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
	if (a !== major) return a > major
	if (b !== minor) return b > minor
	return c >= patch
}

function notRunning(server: HostedServerView) {
	return `«${server.name}» ${STATUS[server.status] ?? server.status} — команды принимает только работающий сервер. Предложи игроку запустить: <<hosting_power|${server.id}::start>>.`
}

/** Серверы, выключенные ради изменений за этот ход: включатся сами, когда ход агента закончится. */
const autoStopped = new Map<string, string>()

/** Выключает работающий сервер перед изменением и запоминает его для авто-запуска в конце хода. */
async function stopForChange(server: HostedServerView): Promise<boolean> {
	if (!isHostedActive(server.status)) return false
	noteAgentThought(`Выключаю «${server.name}» для изменений`)
	await hosting_stop(server.id)
	autoStopped.set(server.id, server.name)
	return true
}

// Когда ход агента закончен (финальный ответ уже у игрока), серверы,
// выключенные ради изменений, включаются сами — игрок не должен помнить про них.
registerAiFinishHandler(async () => {
	for (const [id, name] of [...autoStopped.entries()]) {
		autoStopped.delete(id)
		try {
			noteAgentThought(`Запускаю «${name}» — изменения закончены`)
			await hosting_start(id)
		} catch (error) {
			console.warn('Не удалось запустить сервер после изменений:', error)
		}
	}
})

/** Пути сервера нормализуем: без ведущих слешей и без блуждания вверх по дереву. */
function normalizeServerPath(raw: string): string {
	const trimmed = raw
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\.?\//, '')
	const segments = trimmed
		.split('/')
		.filter((segment) => segment && segment !== '.' && segment !== '..')
	return segments.join('/')
}

function formatSize(size: number): string {
	return size >= 1024 * 1024
		? `${(size / (1024 * 1024)).toFixed(1)} МБ`
		: size >= 1024
			? `${(size / 1024).toFixed(1)} КБ`
			: `${size} Б`
}

function pickPlayer(server: HostedServerView, wanted: string): string {
	const name = wanted.trim()
	if (name) return server.players.find((p) => p.toLowerCase() === name.toLowerCase()) ?? name
	return server.players.length === 1 ? server.players[0] : ''
}

registerAiToolHandler(async (tool, args) => {
	switch (tool) {
		case 'hosting_list': {
			const servers = await hosting_list().catch(() => [] as HostedServerView[])
			if (servers.length === 0)
				return 'Своих серверов нет. Создать можно на экране [Self-Hosted](/server-hosting).'
			return `Серверы игрока (Self-Hosted):\n${servers.map(describe).join('\n')}`
		}
		case 'hosting_status': {
			const server = await resolveServer(args)
			if (typeof server === 'string') return server
			const lines = [describe(server)]
			if (server.status === 'running')
				lines.push(
					`CPU ${Math.round(server.cpu_percent)}%, RAM ${server.ram_used_mb}/${server.memory_mb} МБ`,
				)
			lines.push(
				`Настройки: режим ${server.gamemode}, сложность ${server.difficulty}, whitelist ${server.white_list ? 'вкл' : 'выкл'}, PvP ${server.pvp ? 'вкл' : 'выкл'}, лицензия ${server.online_mode ? 'нужна' : 'не нужна'}`,
			)
			if (server.status === 'crashed' && server.crash_line)
				lines.push(`Причина падения: ${server.crash_line}`)
			return lines.join('\n')
		}
		case 'hosting_power': {
			const [target, action] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			const verb = action.toLowerCase()
			if (verb === 'stop') {
				if (!isHostedActive(server.status)) return `«${server.name}» и так выключен.`
				autoStopped.delete(server.id)
				await hosting_stop(server.id)
				return `Выключаю «${server.name}» — мир сохранится сам.`
			}
			if (verb === 'restart') {
				autoStopped.delete(server.id)
				await hosting_restart(server.id)
				return `Перезапускаю «${server.name}».`
			}
			if (verb !== 'start') return 'Действие: start, stop или restart.'
			if (server.status === 'running') return `«${server.name}» уже работает.`
			noteAgentThought(`Запускаю сервер «${server.name}»`)
			await hosting_start(server.id)
			const fresh = await waitRunning(server.id, 120000)
			if (fresh?.status === 'running') return `«${server.name}» запущен.\n${describe(fresh)}`
			if (fresh?.status === 'crashed')
				return `«${server.name}» упал при запуске: ${fresh.crash_line ?? fresh.error ?? 'смотри консоль'}`
			return `«${server.name}» ещё запускается — проверь позже <<hosting_status|${server.id}>>.`
		}
		case 'hosting_cmd': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			const commands = parseCommands(raw, 20)
			if (commands.length === 0)
				return 'Нет команды. Формат: <<hosting_cmd|сервер::команда;;команда>>.'
			if (server.status !== 'running') return notRunning(server)
			const answer = (await runCommands(server, commands)).slice(-30)
			return [
				`Консоль «${server.name}»:`,
				...commands.map((command) => `> ${command}`),
				answer.length ? answer.map(stripHead).join('\n') : '(сервер ничего не ответил)',
			].join('\n')
		}
		case 'hosting_build': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			const commands = parseCommands(raw, 600)
			if (commands.length === 0)
				return 'Нет команд. Формат: <<hosting_build|сервер::setblock x y z блок;;fill …>>.'
			if (server.status !== 'running') return notRunning(server)
			noteAgentThought(`Строю на «${server.name}»: ${commands.length} команд`)
			const answer = (await runCommands(server, commands, commands.length > 60 ? 20 : 45)).map(
				stripHead,
			)
			const errors = answer.filter((line) => COMMAND_ERROR_RE.test(line))
			const done = Math.max(0, Math.min(commands.length, answer.length - errors.length))
			return [
				`Стройка на «${server.name}»: отправлено ${commands.length} команд, успешных ответов ~${done}, ошибок ${errors.length}.`,
				...(errors.length
					? [
							'Ошибки (исправь id блока/состояние/координаты и повтори только их):',
							...errors.slice(0, 12),
						]
					: []),
				...(errors.length === 0 && answer.length ? ['Последние ответы:', ...answer.slice(-4)] : []),
			].join('\n')
		}
		case 'hosting_player': {
			const [target, wanted] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			if (server.status !== 'running') return notRunning(server)
			const player = pickPlayer(server, wanted)
			if (!player)
				return server.players.length
					? `Чей инвентарь смотреть? Онлайн: ${server.players.join(', ')}. Спроси через ask_user.`
					: 'На сервере сейчас никого нет — смотреть некого.'
			const modern = atLeast(server.game_version, 1, 21, 5)
			const commands = [
				`data get entity ${player} Pos`,
				`data get entity ${player} Dimension`,
				`data get entity ${player} Rotation`,
				`data get entity ${player} SelectedItemSlot`,
				`data get entity ${player} SelectedItem`,
				modern
					? `data get entity ${player} equipment`
					: `data get entity ${player} Inventory[{Slot:-106b}]`,
				...(modern
					? []
					: [100, 101, 102, 103].map(
							(slot) => `data get entity ${player} Inventory[{Slot:${slot}b}]`,
						)),
			]
			const answer = (await runCommands(server, commands, 60)).map(stripHead).slice(-14)
			return [
				`Игрок ${player} на «${server.name}» (${server.software} ${server.game_version}) — по порядку: позиция, измерение, поворот [yaw, pitch], номер слота в руке, предмет в руке (если ошибка — смотри Inventory[{Slot:<номер>b}]), ${modern ? 'экипировка (броня, вторая рука)' : 'вторая рука и броня (слоты 100-103)'}:`,
				answer.length ? answer.join('\n') : '(сервер ничего не ответил)',
				'«Found no elements» = слот пуст. Id модового предмета (mod:item) объясни по его моду; при сомнении — web_search по id.',
			].join('\n')
		}
		case 'hosting_chest': {
			const [target, where] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			if (server.status !== 'running') return notRunning(server)
			const coords = where
				.match(/-?\d+(?:\.\d+)?/g)
				?.slice(0, 3)
				.map((n) => Math.floor(Number(n)))
			if (!coords || coords.length < 3)
				return 'Нужны координаты: <<hosting_chest|сервер::x y z>>. Позицию игрока даёт hosting_player.'
			const [x, y, z] = coords
			const answer = (await runCommands(server, [`data get block ${x} ${y} ${z} Items`], 60)).map(
				stripHead,
			)
			return [
				`Блок ${x} ${y} ${z} на «${server.name}»:`,
				answer.length ? answer.join('\n') : '(сервер ничего не ответил)',
				'«is not a block entity» — там не сундук/контейнер; пустой список [] — контейнер пуст.',
			].join('\n')
		}
		case 'hosting_install': {
			const [target, wanted] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			if (!wanted)
				return 'Что ставить? Формат: <<hosting_install|сервер::название или id на Modrinth>>.'
			noteAgentThought(`Ставлю «${wanted}» на «${server.name}»`)
			const attempt = async (projectId: string, title: string) => {
				await stopForChange(server)
				await installToHostedServer(server, projectId)
				return `Установлено на «${server.name}» (${server.software} ${server.game_version}): ${title}. Сервер включится сам, когда задача будет закончена.`
			}
			try {
				if (/^[\w-]{3,64}$/.test(wanted)) return await attempt(wanted, wanted)
			} catch (error) {
				if (!(error instanceof NoFittingVersionError) && !/HTTP 404/.test(String(error)))
					return `Не установилось: ${String(error).slice(0, 200)}`
			}
			const { hits } = await searchHostedContent(server, wanted, 0).catch(() => ({ hits: [] }))
			const hit = hits[0]
			if (!hit)
				return `На Modrinth нет «${wanted}» под ${server.software} ${server.game_version}. Предложи аналог.`
			try {
				return await attempt(hit.project_id, hit.title)
			} catch (error) {
				return error instanceof NoFittingVersionError
					? `У «${hit.title}» нет файла под ${server.software} ${server.game_version}.`
					: `Не установилось: ${String(error).slice(0, 200)}`
			}
		}
		case 'hosting_plugins': {
			const server = await resolveServer(args)
			if (typeof server === 'string') return server
			const plugins = await hosting_plugins(server.id).catch(() => null)
			if (!plugins) return `Не удалось прочитать плагины «${server.name}».`
			if (plugins.length === 0)
				return `На «${server.name}» нет плагинов/модов. Поставить: <<hosting_install|${server.id}::название>>.`
			return [
				`Плагины/моды «${server.name}» (${plugins.length}):`,
				...plugins.map((plugin) => `- ${plugin.name}: ${plugin.enabled ? 'включён' : 'ВЫКЛЮЧЕН'}`),
			].join('\n')
		}
		case 'hosting_plugin': {
			const parts = args.split('::')
			const server = await resolveServer(parts[0] ?? '')
			if (typeof server === 'string') return server
			const name = (parts[1] ?? '').trim()
			const action = (parts[2] ?? '').trim().toLowerCase()
			if (!name)
				return 'Какой плагин? Список: <<hosting_plugins|сервер>>. Формат: <<hosting_plugin|сервер::plugin.jar::enable>>.'
			if (action !== 'enable' && action !== 'disable' && action !== 'remove')
				return 'Действие: enable, disable или remove.'
			await stopForChange(server)
			try {
				if (action === 'remove') {
					await hosting_plugin_remove(server.id, name)
					return `Плагин ${name} удалён с «${server.name}». Сервер включится сам, когда задача будет закончена.`
				}
				await hosting_plugin_toggle(server.id, name)
				const plugins = await hosting_plugins(server.id).catch(() => null)
				const now = plugins?.find((plugin) => plugin.name === name)?.enabled
				const state =
					now === undefined
						? action === 'disable'
							? 'выключен'
							: 'включён'
						: now
							? 'включён'
							: 'выключен'
				return `Плагин ${name} на «${server.name}»: ${state}. Сервер включится сам, когда задача будет закончена.`
			} catch (error) {
				return `Не получилось: ${String(error).slice(0, 200)}`
			}
		}
		case 'hosting_files': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			const folder = normalizeServerPath(raw || '.')
			const items = await hosting_files(server.id, folder).catch(() => null)
			if (!items) return `Не удалось прочитать папку «${folder}» на «${server.name}».`
			if (items.length === 0) return `Папка «${folder}» на «${server.name}» пуста.`
			return [
				`Папка «${folder}» на «${server.name}» (всего ${items.length}, показаны первые):`,
				...items
					.slice(0, 80)
					.map((item) =>
						item.dir
							? `- [папка] ${item.name}/`
							: `- [файл] ${item.name} (${formatSize(item.size)})`,
					),
			].join('\n')
		}
		case 'hosting_read': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			const path = normalizeServerPath(raw)
			if (!path)
				return 'Какой файл? Формат: <<hosting_read|сервер::server.properties>>. Список: <<hosting_files|сервер::папка>>.'
			const bytes = await hosting_file_read(server.id, path).catch(() => null)
			if (bytes === null)
				return `Не удалось прочитать «${path}» на «${server.name}» (файла нет или это папка).`
			const text = new TextDecoder().decode(Uint8Array.from(bytes))
			if (text.length > 4000)
				return `${path} на «${server.name}» (первые 4000 символов из ${text.length}):\n${text.slice(0, 4000)}\n…(дальше обрезано)`
			return `${path} на «${server.name}»:\n${text}`
		}
		case 'hosting_write': {
			const parts = args.split('::')
			const server = await resolveServer(parts[0] ?? '')
			if (typeof server === 'string') return server
			const path = normalizeServerPath(parts[1] ?? '')
			const content = parts.slice(2).join('::')
			if (!path)
				return 'Какой файл? Формат: <<hosting_write|сервер::путь::текст>> — текст это всё после второго «::».'
			if (!content.trim())
				return 'Пустой текст так сотрёт файл. Прочитай файл <<hosting_read|сервер::путь>> и запиши полный текст.'
			const current = await hosting_file_read(server.id, path).catch(() => null)
			if (current !== null) {
				const existing = new TextDecoder().decode(Uint8Array.from(current))
				if (content.length < existing.length * 0.4)
					return `Файл «${path}» существует и в нём ${existing.length} символов, а новый текст — ${content.length} символов: похоже на обрезку. Прочитай файл <<hosting_read|${server.id}::${path}>> и запиши ПОЛНЫЙ текст, а не кусок.`
			}
			await stopForChange(server)
			try {
				await hosting_file_write(server.id, path, new TextEncoder().encode(content))
				return `Записано «${path}» на «${server.name}» (${content.length} символов). Сервер включится сам, когда задача будет закончена.`
			} catch (error) {
				return `Не удалось записать: ${String(error).slice(0, 200)}`
			}
		}
		case 'hosting_console': {
			const [target, count] = splitArgs(args)
			const server = await resolveServer(target || count)
			if (typeof server === 'string') return server
			const lines = await hosting_log(server.id).catch(() => [] as string[])
			const take = Math.min(200, Math.max(10, Number.parseInt(target ? count : '', 10) || 40))
			const tail = lines.slice(-take).map((line) => line.replace(ANSI, ''))
			return tail.length
				? `Последние строки консоли «${server.name}»:\n${tail.join('\n')}`
				: 'Консоль пуста.'
		}
		default:
			return null
	}
})
