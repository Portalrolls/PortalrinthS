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
	hosting_file_create_dir,
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
import { proxiedFetch } from './proxy-fetch'

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

/** Игрок ждёт постройку, а не лог ошибок: модели пишут координаты с дробями
 * (Pos игрока — 100.45) и блоки через пробел («polished granite») — сервер
 * это не принимает, команда падает с ошибкой. Чиним заранее, до отправки. */
const BUILD_KEYWORDS = new Set(['replace', 'hollow', 'destroy', 'keep'])

function sanitizeBuildCommand(command: string): string {
	const match = /^(fill|setblock)\s+(.+)$/i.exec(command.trim())
	if (!match) return command
	const verb = match[1].toLowerCase()
	const rest = match[2]
	const brace = rest.indexOf('{')
	const rawHead = brace >= 0 ? rest.slice(0, brace) : rest
	const tail = brace >= 0 ? rest.slice(brace) : ''
	const glue = brace >= 0 && /\s$/.test(rawHead) ? ' ' : ''
	const tokens = rawHead.trim().split(/\s+/)
	const coordsEnd = verb === 'fill' ? 6 : 3
	const fixed = tokens
		.slice(0, coordsEnd)
		.map((token) => (/^-?\d+\.\d+$/.test(token) ? String(Math.round(Number(token))) : token))
	let blockPart = tokens.slice(coordsEnd)
	let trailing: string[] = []
	if (blockPart.length > 0 && BUILD_KEYWORDS.has(blockPart[blockPart.length - 1].toLowerCase())) {
		trailing = blockPart.slice(-1)
		blockPart = blockPart.slice(0, -1)
	}
	if (blockPart.length > 1 && blockPart.every((token) => /^[a-z0-9_:.[\]=,+-]+$/i.test(token))) {
		blockPart = [
			blockPart.some((token) => token.includes('[')) ? blockPart.join('') : blockPart.join('_'),
		]
	}
	return `${verb} ${[...fixed, ...blockPart, ...trailing].join(' ')}${glue}${tail}`
}

function parseCommands(raw: string, limit: number) {
	return raw
		.split(/;;|\n/)
		.map((command) => sanitizeBuildCommand(command.trim().replace(/^\//, '')))
		.filter(Boolean)
		.slice(0, limit)
}

/** Console lines carry a «[12:00:00 INFO]: » head; the model needs only the text. */
function stripHead(line: string) {
	return line.replace(/^\[[^\]]*\]\s*(?:\[[^\]]*\]\s*)?:?\s*/, '')
}

const COMMAND_ERROR_RE =
	/unknown|incorrect|invalid|expected|no (?:player|entity|entities|block|item)|could not|cannot|can't|not loaded|out of (?:the )?world|too many blocks|failed|<--\[HERE\]|нет (?:игрок|цели|сущност|такого)|не найден|не найдена|не найдено|неизвестн|неверн|неправильн|не удалось|ошибк/i

/** Что сервер отвечает на успешные fill/setblock («Filled … blocks», «Changed the block»). */
const GEO_OK_RE = /\bfilled\b|changed the block|placed/i

// ---- Геометрические примитивы (hosting_geo) --------------------------------
//
// Один вызов hosting_geo разворачивается на фронте в пачку fill/setblock и
// уходит в тот же консольный канал, что и hosting_build: модель строит
// фигурами (box, cylinder, sphere, dome, pyramid), а не сотней отдельных
// команд — быстрее, точнее и меньше нагрузки на консоль сервера.

const GEO_MAX_COMMANDS = 1500
const GEO_MAX_RADIUS = 16
const GEO_CHUNK = 300

function fillRange(
	x1: number,
	y1: number,
	z1: number,
	x2: number,
	y2: number,
	z2: number,
	block: string,
): string {
	return `fill ${Math.min(x1, x2)} ${Math.min(y1, y2)} ${Math.min(z1, z2)} ${Math.max(x1, x2)} ${Math.max(y1, y2)} ${Math.max(z1, z2)} ${block}`
}

/** Круглый слой: fill квадрата, потом ступенчатый срез углов по квадрантам
    (соседние ряды одной ширины уже склеены в fill по строке). */
function circleLayer(cx: number, y: number, cz: number, r: number, block: string): string[] {
	const commands = [fillRange(cx - r, y, cz - r, cx + r, y, cz + r, block)]
	if (r < 3) return commands
	for (const sx of [1, -1]) {
		for (const sz of [1, -1]) {
			for (let dz = 0; dz <= r; dz++) {
				const maxdx = Math.floor(Math.sqrt(r * r - dz * dz))
				if (maxdx >= r || maxdx + 1 > r) continue
				commands.push(
					fillRange(cx + sx * (maxdx + 1), y, cz + sz * dz, cx + sx * r, y, cz + sz * dz, 'air'),
				)
			}
		}
	}
	return commands
}

function parseGeoNums(parts: string[], count: number, offset: number): number[] | string {
	const nums: number[] = []
	for (let i = 0; i < count; i++) {
		const raw = parts[offset + i] ?? ''
		if (/^[-+]?~/i.test(raw))
			return `«${raw}» — консоль не знает, где стоит игрок: относительные координаты тут не работают. Возьми абсолютные числа из <<hosting_player|сервер::ник>> и подставь готовые числа.`
		const value = Number(raw)
		if (!Number.isFinite(value)) return `Ожидались числа: в позиции ${offset + i} стоит «${raw}»`
		nums.push(Math.round(value))
	}
	return nums
}

function geoBlock(parts: string[], afterNums: number): { block: string; hollow: boolean } | string {
	const rest = parts.slice(afterNums)
	if (rest.length === 0)
		return 'Не назван блок (например: stone, oak_log, oak_stairs[facing=north])'
	const hollow = (rest[rest.length - 1] ?? '').toLowerCase() === 'hollow'
	let block = (hollow ? rest.slice(0, -1) : rest).join(' ')
	// Модели часто пишут «gold block» с пробелом: id блоков пробелов не содержат.
	if (!block.includes('[')) block = block.replace(/\s+/g, '_')
	return { block, hollow }
}

const GEO_HELP =
	'Формат: <<hosting_geo|сервер::операция параметры>>. Операции: box x1 y1 z1 x2 y2 z2 блок; hollow_box x1 y1 z1 x2 y2 z2 блок; cylinder cx cy cz радиус высота блок [hollow]; sphere cx cy cz радиус блок [hollow]; dome cx cy cz радиус блок [hollow]; pyramid cx cy cz радиус высота блок; line x1 y1 z1 x2 y2 z2 блок. Радиус до 16.'

function buildGeoCommands(raw: string): { op: string; commands: string[] } | string {
	const parts = raw.trim().split(/\s+/)
	const op = (parts[0] ?? '').toLowerCase()
	if (!op) return `Нет операции. ${GEO_HELP}`
	const commands: string[] = []
	if (op === 'box' || op === 'hollow_box') {
		const nums = parseGeoNums(parts, 6, 1)
		if (typeof nums === 'string') return nums
		const block = geoBlock(parts, 7)
		if (typeof block === 'string') return block
		const [x1, y1, z1, x2, y2, z2] = nums
		commands.push(fillRange(x1, y1, z1, x2, y2, z2, block.block))
		if (op === 'hollow_box') {
			const ix1 = Math.min(x1, x2) + 1
			const iy1 = Math.min(y1, y2) + 1
			const iz1 = Math.min(z1, z2) + 1
			const ix2 = Math.max(x1, x2) - 1
			const iy2 = Math.max(y1, y2) - 1
			const iz2 = Math.max(z1, z2) - 1
			if (ix2 >= ix1 && iy2 >= iy1 && iz2 >= iz1)
				commands.push(fillRange(ix1, iy1, iz1, ix2, iy2, iz2, 'air'))
		}
	} else if (op === 'cylinder') {
		const nums = parseGeoNums(parts, 5, 1)
		if (typeof nums === 'string') return nums
		const block = geoBlock(parts, 6)
		if (typeof block === 'string') return block
		const [cx, cy, cz, r, h] = nums
		if (r < 1 || r > GEO_MAX_RADIUS || h < 1 || h > 64)
			return `Радиус 1-${GEO_MAX_RADIUS}, высота 1-64 (получилось r=${r}, h=${h}).`
		for (let dy = 0; dy < h; dy++) commands.push(...circleLayer(cx, cy + dy, cz, r, block.block))
		if (block.hollow)
			for (let dy = 0; dy < h; dy++) commands.push(...circleLayer(cx, cy + dy, cz, r - 1, 'air'))
	} else if (op === 'sphere') {
		const nums = parseGeoNums(parts, 4, 1)
		if (typeof nums === 'string') return nums
		const block = geoBlock(parts, 5)
		if (typeof block === 'string') return block
		const [cx, cy, cz, r] = nums
		if (r < 1 || r > GEO_MAX_RADIUS) return `Радиус 1-${GEO_MAX_RADIUS} (получилось ${r}).`
		for (let dy = -r; dy <= r; dy++) {
			const rl = Math.floor(Math.sqrt(r * r - dy * dy))
			if (rl <= 0) continue
			commands.push(...circleLayer(cx, cy + dy, cz, rl, block.block))
		}
		if (block.hollow) {
			const ir = r - 1
			for (let dy = -ir; dy <= ir; dy++) {
				const rl = Math.floor(Math.sqrt(ir * ir - dy * dy))
				if (rl <= 0) continue
				commands.push(...circleLayer(cx, cy + dy, cz, rl, 'air'))
			}
		}
	} else if (op === 'dome') {
		const nums = parseGeoNums(parts, 4, 1)
		if (typeof nums === 'string') return nums
		const block = geoBlock(parts, 5)
		if (typeof block === 'string') return block
		const [cx, cy, cz, r] = nums
		if (r < 1 || r > GEO_MAX_RADIUS) return `Радиус 1-${GEO_MAX_RADIUS} (получилось ${r}).`
		for (let dy = 0; dy <= r; dy++) {
			const rl = Math.floor(Math.sqrt(r * r - dy * dy))
			if (rl <= 0) continue
			commands.push(...circleLayer(cx, cy + dy, cz, rl, block.block))
		}
		if (block.hollow) {
			const ir = r - 1
			for (let dy = 1; dy <= ir; dy++) {
				const rl = Math.floor(Math.sqrt(ir * ir - dy * dy))
				if (rl <= 0) continue
				commands.push(...circleLayer(cx, cy + dy, cz, rl, 'air'))
			}
		}
	} else if (op === 'pyramid') {
		const nums = parseGeoNums(parts, 5, 1)
		if (typeof nums === 'string') return nums
		const block = geoBlock(parts, 6)
		if (typeof block === 'string') return block
		const [cx, cy, cz, r, h] = nums
		if (r < 1 || r > GEO_MAX_RADIUS || h < 1 || h > 64)
			return `Радиус 1-${GEO_MAX_RADIUS}, высота 1-64 (получилось r=${r}, h=${h}).`
		for (let level = 0; level < h; level++) {
			const half = r - level
			if (half < 0) break
			commands.push(
				fillRange(cx - half, cy + level, cz - half, cx + half, cy + level, cz + half, block.block),
			)
		}
	} else if (op === 'line') {
		const nums = parseGeoNums(parts, 6, 1)
		if (typeof nums === 'string') return nums
		const block = geoBlock(parts, 7)
		if (typeof block === 'string') return block
		const [x1, y1, z1, x2, y2, z2] = nums
		const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), Math.abs(z2 - z1))
		if (steps > 256) return 'Линия длиннее 256 блоков — разбей на части.'
		for (let t = 0; t <= steps; t++) {
			const x = Math.round(x1 + ((x2 - x1) * t) / steps)
			const y = Math.round(y1 + ((y2 - y1) * t) / steps)
			const z = Math.round(z1 + ((z2 - z1) * t) / steps)
			commands.push(`setblock ${x} ${y} ${z} ${block.block}`)
		}
	} else {
		return `Не знаю операцию «${op}». ${GEO_HELP}`
	}
	if (commands.length > GEO_MAX_COMMANDS)
		return `Фигура разворачивается в ${commands.length} команд (лимит ${GEO_MAX_COMMANDS}): уменьши радиус/высоту или разбей на несколько вызовов.`
	return { op, commands }
}

/** Ошибка про игрока (ник не совпал или офлайн) — для честной подсказки модели. */
const PLAYER_ERROR_RE = /player|игрок|ник/i

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

/** Стиль дома: стартовый (малый), уютный (двускатная крыша) и современный. */
const HOUSE_STYLES = new Set(['start', 'cozy', 'modern'])

type Anchor = { x: number; y: number; z: number; yaw: number }

/** Куда смотрит игрок: 0 — юг (+Z), 90 — запад (−X), 180 — север (−Z), −90 — восток (+X). */
function facingFromYaw(yaw: number): { dx: number; dz: number; name: string } {
	const sector = Math.round(yaw / 90) % 4
	if (sector === 0) return { dx: 0, dz: 1, name: 'south' }
	if (sector === 1 || sector === -3) return { dx: -1, dz: 0, name: 'west' }
	if (Math.abs(sector) === 2) return { dx: 0, dz: -1, name: 'north' }
	return { dx: 1, dz: 0, name: 'east' }
}

function axisName(dx: number, dz: number): string {
	if (dx > 0) return 'east'
	if (dx < 0) return 'west'
	if (dz > 0) return 'south'
	return 'north'
}

/** Где стоит игрок: Pos и Rotation из консоли (формат с суффиксами d/f). */
async function playerAnchor(server: HostedServerView, player: string): Promise<Anchor | string> {
	const answer = (
		await runCommands(
			server,
			[`data get entity ${player} Pos`, `data get entity ${player} Rotation`],
			80,
		)
	).map(stripHead)
	const text = answer.join(' ')
	const pos = /\[(-?[\d.]+)d?, (-?[\d.]+)d?, (-?[\d.]+)d?\]/.exec(text)
	if (!pos) {
		return (
			`Не удалось узнать, где стоит ${player}: ${answer.slice(-4).join(' ') || 'сервер молчит'}. ` +
			'Игрок в сети? Проверь <<hosting_status|' +
			server.id +
			'>>.'
		)
	}
	const rot = /\[(-?[\d.]+)f?, (-?[\d.]+)f?\]/.exec(text)
	return {
		x: Number(pos[1]),
		y: Number(pos[2]),
		z: Number(pos[3]),
		yaw: rot ? Number(rot[1]) : 0,
	}
}

/**
 * Готовый дом перед игроком, лицом к игроку. Считает сам: координаты берёт
 * у игрока, сторону — из его взгляда, порядок блоков — от расчистки до
 * мебели. Возвращает команды для hosting-консоли (setblock/fill).
 */
function houseCommands(style: string, anchor: Anchor): string[] {
	const spec = {
		start: {
			w: 7,
			d: 6,
			h: 3,
			walls: 'oak_planks',
			corners: 'stripped_oak_log',
			floor: 'cobblestone',
			roof: 'oak_slab',
			door: 'oak_door',
			light: 'torch',
		},
		cozy: {
			w: 9,
			d: 8,
			h: 4,
			walls: 'spruce_planks',
			corners: 'dark_oak_log',
			floor: 'dark_oak_planks',
			roof: 'spruce_stairs',
			door: 'spruce_door',
			light: 'lantern',
		},
		modern: {
			w: 11,
			d: 9,
			h: 4,
			walls: 'smooth_quartz',
			corners: '',
			floor: 'polished_andesite',
			roof: 'smooth_stone_slab',
			door: 'dark_oak_door',
			light: 'sea_lantern',
		},
	}[style]
	const dir = facingFromYaw(anchor.yaw)
	const ground = Math.floor(anchor.y)
	const cx = Math.floor(anchor.x) + dir.dx * 2
	const cz = Math.floor(anchor.z) + dir.dz * 2
	const px = dir.dz // перпендикуляр к взгляду: меняем компоненты местами
	const pz = dir.dx
	const half = Math.floor(spec.w / 2)
	const x0 = cx - px * half
	const z0 = cz - pz * half
	const x1 = cx + px * half + dir.dx * (spec.d - 1)
	const z1 = cz + pz * half + dir.dz * (spec.d - 1)
	const minX = Math.min(x0, x1)
	const maxX = Math.max(x0, x1)
	const minZ = Math.min(z0, z1)
	const maxZ = Math.max(z0, z1)
	const top = ground + spec.h - 1
	const box = (
		block: string,
		yA: number,
		yB: number,
		mx0 = minX,
		mx1 = maxX,
		mz0 = minZ,
		mz1 = maxZ,
	) =>
		`fill ${Math.min(mx0, mx1)} ${yA} ${Math.min(mz0, mz1)} ${Math.max(mx0, mx1)} ${yB} ${Math.max(mz0, mz1)} ${block}`
	const line = (block: string, y: number, x: number, z: number, x2: number, z2: number) =>
		`fill ${Math.min(x, x2)} ${y} ${Math.min(z, z2)} ${Math.max(x, x2)} ${y} ${Math.max(z, z2)} ${block}`
	const commands: string[] = []
	// расчистка: объём дома, крыша и запас сверху
	commands.push(box('air', ground, top + spec.h + 1))
	// фундамент и пол
	commands.push(box('cobblestone', ground - 1, ground - 1))
	commands.push(box(spec.floor, ground, ground))
	// стены: четыре полосы
	commands.push(box(spec.walls, ground, top, minX, minX, minZ, maxZ))
	commands.push(box(spec.walls, ground, top, maxX, maxX, minZ, maxZ))
	commands.push(box(spec.walls, ground, top, minX, maxX, minZ, minZ))
	commands.push(box(spec.walls, ground, top, minX, maxX, maxZ, maxZ))
	// углы — брёвнами
	if (spec.corners) {
		for (const [ax, az] of [
			[minX, minZ],
			[minX, maxZ],
			[maxX, minZ],
			[maxX, maxZ],
		]) {
			commands.push(`fill ${ax} ${ground} ${az} ${ax} ${top} ${az} ${spec.corners}`)
		}
	}
	// воздух внутри — после стен, до мебели
	commands.push(box('air', ground + 1, top, minX + 1, maxX - 1, minZ + 1, maxZ - 1))
	// окна: ленты на боковых стенах и напротив двери
	const winY0 = ground + 1
	const winY1 = Math.min(ground + 2, top - (style === 'start' ? 1 : 0))
	if (winY1 > winY0) {
		commands.push(box('glass', winY0, winY1, minX, minX, minZ + 2, maxZ - 2))
		commands.push(box('glass', winY0, winY1, maxX, maxX, minZ + 2, maxZ - 2))
		commands.push(box('glass', winY0, winY1, minX + 2, maxX - 2, maxZ, maxZ))
	}
	// дверь: по центру ближней стены, лицом к игроку
	const back = axisName(-dir.dx, -dir.dz)
	commands.push(`setblock ${cx} ${ground} ${cz} air`)
	commands.push(`setblock ${cx} ${ground + 1} ${cz} air`)
	commands.push(`setblock ${cx} ${ground} ${cz} ${spec.door}[facing=${back},half=lower]`)
	commands.push(`setblock ${cx} ${ground + 1} ${cz} ${spec.door}[facing=${back},half=upper]`)
	// крыша
	if (style === 'cozy') {
		const dirLine = (y: number, k: number, block: string) => {
			const lx = cx + px * (k - half)
			const lz = cz + pz * (k - half)
			return line(block, y, lx, lz, lx + dir.dx * (spec.d - 1), lz + dir.dz * (spec.d - 1))
		}
		const up = axisName(px, pz)
		const down = axisName(-px, -pz)
		for (let i = 0; i < half; i++) {
			commands.push(dirLine(ground + spec.h + i, i, `${spec.roof}[facing=${up}]`))
			commands.push(dirLine(ground + spec.h + i, spec.w - 1 - i, `${spec.roof}[facing=${down}]`))
		}
		commands.push(dirLine(ground + spec.h + half, half, 'spruce_slab'))
	} else {
		commands.push(box(spec.roof, top + 1, top + 1))
	}
	// свет и мебель: у дальней стены, лицом внутрь
	const fx = cx + dir.dx * (spec.d - 2)
	const fz = cz + dir.dz * (spec.d - 2)
	const inner = axisName(-dir.dx, -dir.dz)
	commands.push(`setblock ${cx - px} ${ground + 1} ${cz - pz} ${spec.light}`)
	commands.push(`setblock ${cx + px} ${ground + 1} ${cz + pz} ${spec.light}`)
	commands.push(`setblock ${fx - px} ${ground} ${fz - pz} crafting_table`)
	commands.push(`setblock ${fx} ${ground} ${fz} chest[facing=${inner}]`)
	commands.push(`setblock ${fx + px} ${ground} ${fz + pz} furnace[facing=${inner}]`)
	if (style !== 'start') {
		commands.push(`setblock ${fx - px} ${ground + 1} ${fz - pz} bookshelf`)
	}
	return commands
}

/**
 * Размер файла структуры не бесконечен: сетевые каталоги любят крупные постройки,
 * но гонять десятки мегабайт через консольный пайп незачем.
 */
const STRUCTURE_LIMIT = 10 * 1024 * 1024

function sanitizeStructureName(raw: string): string {
	return (
		raw
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 40) || 'structure'
	)
}

/** Папка мира сервера: та, где лежит level.dat (мир мог переименовать кто угодно). */
async function findWorldFolder(server: HostedServerView): Promise<string | null> {
	const entries = await hosting_files(server.id, '.').catch(() => null)
	if (!entries) return null
	const dirs = entries.filter((item) => item.dir).map((item) => item.name)
	const candidates = [
		...dirs.filter((name) => name.toLowerCase() === 'world'),
		...dirs.filter((name) => name.toLowerCase().includes('world')),
		...dirs.filter(
			(name) => !/^(plugins|mods|config|logs|libraries|cache|versions|worlds?)$/i.test(name),
		),
	].slice(0, 8)
	for (const folder of candidates) {
		const marker = await hosting_file_read(server.id, `${folder}/level.dat`).catch(() => null)
		if (marker !== null) return folder
	}
	return null
}

/** Где у сервера лежат схематики WorldEdit/FastAsyncWorldEdit — иначе ставить некуда. */
const SCHEMATIC_DIRS = [
	'plugins/WorldEdit/schematics',
	'plugins/FastAsyncWorldEdit/schematics',
	'config/worldedit/schematics',
]

async function findSchematicDir(server: HostedServerView): Promise<string | null> {
	for (const dir of SCHEMATIC_DIRS) {
		const entries = await hosting_files(server.id, dir).catch(() => null)
		if (entries !== null) return dir
	}
	return null
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
			const errors = answer.filter((line) => COMMAND_ERROR_RE.test(line))
			// Честная пометка провала: если сервер не принял команды, ответ
			// начинается с «Ошибка:» — шаг краснеет в карточке, модель видит
			// провал явно, а не пересказывает консоль как успех.
			const allBad = errors.length > 0 && errors.length >= commands.length
			const playerMiss = errors.some((line) => PLAYER_ERROR_RE.test(line))
			return [
				allBad
					? `Ошибка: сервер «${server.name}» не принял ${commands.length > 1 ? 'все команды' : 'команду'} — исправь и повтори:`
					: `Консоль «${server.name}»:`,
				...commands.map((command) => `> ${command}`),
				answer.length ? answer.map(stripHead).join('\n') : '(сервер ничего не ответил)',
				...(errors.length > 0 && !allBad
					? [`Ошибки (${errors.length}):`, ...errors.slice(0, 6)]
					: []),
				...(playerMiss
					? [
							'Ник не совпал или игрок не в сети: точные ники онлайн — в <<hosting_list|сервер>> (строка «онлайн»). Спроси игрока через ask_user и повтори с точным ником.',
						]
					: []),
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
			const confirmed = answer.filter((line) => GEO_OK_RE.test(line)).length
			return [
				`Стройка на «${server.name}»: отправлено ${commands.length} команд, подтверждено сервером ${confirmed}, ошибок ${errors.length}.`,
				...(confirmed === 0 && errors.length === 0
					? [
							'Сервер не подтвердил ни одной команды: скорее всего координаты вне загруженных чанков. Возьми позицию игрока через <<hosting_player|сервер::ник>> и строй рядом с ним — НЕ по угаданным координатам.',
						]
					: []),
				...(errors.length
					? [
							'Ошибки (исправь id блока/состояние/координаты и повтори только их):',
							...errors.slice(0, 12),
						]
					: []),
				...(errors.length === 0 && answer.length ? ['Последние ответы:', ...answer.slice(-4)] : []),
			].join('\n')
		}

		case 'hosting_geo': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			if (server.status !== 'running') return notRunning(server)
			const built = buildGeoCommands(raw)
			if (typeof built === 'string') return built
			noteAgentThought(
				`Геометрия «${built.op}» на «${server.name}»: ${built.commands.length} команд`,
			)
			const answers: string[] = []
			for (let from = 0; from < built.commands.length; from += GEO_CHUNK) {
				const chunk = built.commands.slice(from, from + GEO_CHUNK)
				answers.push(...(await runCommands(server, chunk, 20)).map(stripHead))
			}
			const errors = answers.filter((line) => COMMAND_ERROR_RE.test(line))
			const confirmed = answers.filter((line) => GEO_OK_RE.test(line)).length
			return [
				`Геометрия «${built.op}» на «${server.name}»: развёрнуто ${built.commands.length} команд (fill/setblock), подтверждено сервером ${confirmed}, ошибок ${errors.length}.`,
				...(confirmed === 0 && errors.length === 0
					? [
							'Сервер не подтвердил ни одной команды: координаты вне загруженных чанков или команды не дошли. Возьми позицию игрока через <<hosting_player|сервер::ник>> и строй рядом с ним — НЕ по угаданным координатам.',
						]
					: []),
				...(errors.length
					? [
							'Ошибки (проверь координаты/блок и повтори вызов с исправлением):',
							...errors.slice(0, 12),
						]
					: []),
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
		case 'hosting_give': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			if (server.status !== 'running') return notRunning(server)
			const parts = raw
				.split('::')
				.map((part) => part.trim())
				.filter(Boolean)
			const who = parts[0] ?? ''
			const item = (parts[1] ?? '').replace(/^minecraft:/, '')
			const count = Math.max(1, Math.min(2304, Number.parseInt(parts[2] ?? '1', 10) || 1))
			if (!who || !item)
				return 'Формат: <<hosting_give|сервер::ник::предмет::количество>>. Предмет — id (minecraft:diamond, create:wrench); вместо ника можно селектор @a (всем) или @p (ближайшему).'
			const player = who.startsWith('@') ? who : pickPlayer(server, who)
			if (!player)
				return `«${who}» нет в онлайне (сейчас: ${server.players.join(', ') || 'никого'}). Селектор @a выдаёт всем.`
			const answer = (await runCommands(server, [`give ${player} ${item} ${count}`], 60))
				.map(stripHead)
				.slice(-6)
			const errors = answer.filter((line) => COMMAND_ERROR_RE.test(line))
			// Сервер отклонил команду — честный «Ошибка:» вместо успешного вида:
			// шаг краснеет, действие не считается выполненным, модель видит
			// точную причину и может повторить с правильным ником/id.
			if (errors.length > 0)
				return [
					`Ошибка: сервер не принял give ${player} ${item} ×${count}:`,
					...answer,
					PLAYER_ERROR_RE.test(errors.join(' '))
						? `Ник не совпал или игрок не в сети (сейчас онлайн: ${server.players.join(', ') || 'никого'}). Уточни ник и повтори.`
						: '«Unknown item» — неверный id; у модовых предметов префикс мода обязателен.',
				].join('\n')
			return [
				`Выдаю ${item} ×${count} → ${player} на «${server.name}»:`,
				answer.length ? answer.join('\n') : '(сервер ничего не ответил)',
				'«Unknown item» — неверный id; у модовых предметов не забывай префикс мода.',
			].join('\n')
		}
		case 'hosting_config': {
			const parts = args.split('::')
			const server = await resolveServer(parts[0] ?? '')
			if (typeof server === 'string') return server
			const path = normalizeServerPath(parts[1] ?? '')
			const changes = parts
				.slice(2)
				.join('::')
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
			if (!path || !changes.length)
				return 'Формат: <<hosting_config|сервер::путь::ключ=значение;;ключ: значение>> — правит ТОЛЬКО перечисленные ключи (server.properties — «=», yml — «:»), остальной файл не трогает.'
			const bytes = await hosting_file_read(server.id, path).catch(() => null)
			if (bytes === null)
				return `Не удалось прочитать «${path}». Список файлов: <<hosting_files|${server.id}::папка>>.`
			const lines = new TextDecoder().decode(Uint8Array.from(bytes)).split(/\r?\n/)
			const report: string[] = []
			for (const change of changes) {
				const eq = change.indexOf('=')
				const colon = change.indexOf(':')
				const isProps = eq >= 0 && (colon < 0 || eq < colon)
				const key = (isProps ? change.slice(0, eq) : change.slice(0, colon)).trim()
				const value = (isProps ? change.slice(eq + 1) : change.slice(colon + 1)).trim()
				if (!key) return `«${change}» — не понял. Нужен вид «ключ=значение» или «ключ: значение».`
				let done = false
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]
					if (line.trimStart().startsWith('#')) continue
					const lineEq = line.indexOf('=')
					const lineColon = line.indexOf(':')
					const lineIsProps = lineEq >= 0 && (lineColon < 0 || lineEq < lineColon)
					const lineKey = (
						lineIsProps ? line.slice(0, lineEq) : lineColon >= 0 ? line.slice(0, lineColon) : ''
					).trim()
					if (!lineKey || lineKey.toLowerCase() !== key.toLowerCase()) continue
					const indent = line.slice(0, line.length - line.trimStart().length)
					lines[i] = `${indent}${key}${isProps ? '=' : ': '}${value}`
					report.push(`${key} → «${value}» (строка ${i + 1}, было «${line.trim()}»)`)
					done = true
					break
				}
				if (!done) {
					lines.push(`${key}${isProps ? '=' : ': '}${value}`)
					report.push(`${key} → «${value}» (ключа не было — дописан в конец)`)
				}
			}
			await stopForChange(server)
			try {
				await hosting_file_write(server.id, path, new TextEncoder().encode(lines.join('\n')))
				return [
					`Конфиг «${path}» на «${server.name}» обновлён точечно:`,
					...report,
					'Сервер включится сам, когда задача будет закончена.',
				].join('\n')
			} catch (error) {
				return `Не удалось записать: ${String(error).slice(0, 200)}`
			}
		}
		case 'hosting_house': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			if (server.status !== 'running') return notRunning(server)
			const parts = raw
				.split('::')
				.map((part) => part.trim())
				.filter(Boolean)
			const who = pickPlayer(server, parts[0] ?? '')
			const style = (parts[1] ?? 'cozy').toLowerCase()
			if (!who)
				return server.players.length
					? `У кого строить? Онлайн: ${server.players.join(', ')}. Формат: <<hosting_house|сервер::ник::cozy>>.`
					: 'Дом строят рядом с игроком, а на сервере сейчас никого нет.'
			if (!HOUSE_STYLES.has(style))
				return 'Стиль: start (домик новичка), cozy (уютный, двускатная крыша) или modern (современный).'
			noteAgentThought(`Строю «${style}» для ${who} на «${server.name}»`)
			const anchor = await playerAnchor(server, who)
			if (typeof anchor === 'string') return anchor
			const commands = houseCommands(style, anchor)
			const answer = (await runCommands(server, commands, commands.length > 60 ? 20 : 45)).map(
				stripHead,
			)
			const errors = answer.filter((line) => COMMAND_ERROR_RE.test(line))
			return [
				`Дом (${style}) для ${who} на «${server.name}»: ${commands.length} команд, ошибок ${errors.length}.`,
				...(errors.length ? ['Ошибки:', ...errors.slice(0, 10)] : []),
				'Площадка вокруг игрока могла быть занята: при ошибках предложи другое место или расчисти его hosting_build.',
			].join('\n')
		}
		case 'hosting_structure': {
			const [target, raw] = splitArgs(args)
			const server = await resolveServer(target)
			if (typeof server === 'string') return server
			if (server.status !== 'running') return notRunning(server)
			const parts = raw
				.split('::')
				.map((part) => part.trim())
				.filter(Boolean)
			const url = parts[0] ?? ''
			const name = sanitizeStructureName(parts[1] || url.split('?')[0].split('/').pop() || '')
			if (!url || !/^https?:\/\//i.test(url))
				return 'Нужна ПРЯМАЯ ссылка на файл структуры: <<hosting_structure|сервер::https://…/house.nbt::имя::x y z>>. Ссылка на страницу не годится — ищи raw-ссылку (например raw.githubusercontent.com) через web_search.'
			noteAgentThought(`Скачиваю структуру «${name}» на «${server.name}»`)
			let response: Response
			try {
				response = await proxiedFetch(url)
			} catch {
				try {
					response = await fetch(url)
				} catch {
					return `Не удалось скачать ${url} — сеть не пустила. Попробуй другой источник.`
				}
			}
			if (!response.ok)
				return `Ссылка ответила ${response.status}. Нужна прямая ссылка на сам файл.`
			const buffer = await response.arrayBuffer()
			if (buffer.byteLength > STRUCTURE_LIMIT)
				return `Файл слишком большой (${formatSize(buffer.byteLength)}) — лимит 10 МБ.`
			const path = url.split('?')[0].toLowerCase()
			const coords = (parts[2] ?? '')
				.match(/-?\d+/g)
				?.slice(0, 3)
				.map((n) => Number.parseInt(n, 10))
			const bytes = new Uint8Array(buffer)

			// .schem/.schematic — схематик WorldEdit: в папку схематиков, затем schem load + paste -o
			if (/\.(schem|schematic)$/.test(path)) {
				const dir = await findSchematicDir(server)
				if (!dir)
					return `Схематики держит WorldEdit/FastAsyncWorldEdit, а на «${server.name}» его нет. Поставить: <<hosting_install|${server.id}::worldedit>> (или fastasyncworldedit), потом повторить.`
				const written = await hosting_file_write(server.id, `${dir}/${name}.schem`, bytes).then(
					() => true,
					() => false,
				)
				if (!written) return `Не удалось записать ${dir}/${name}.schem.`
				const answer = (await runCommands(server, [`schem load ${name}`, 'paste -o'], 300)).map(
					stripHead,
				)
				const errors = answer.filter((line) => COMMAND_ERROR_RE.test(line))
				return [
					`Схематик ${name}.schem положен в ${dir}/ на «${server.name}» и вставлен командой paste -o — на то место, где постройку сохранили.`,
					answer.length ? `Консоль:\n${answer.slice(-8).join('\n')}` : '(сервер ничего не ответил)',
					...(errors.length ? ['Ошибки:', ...errors.slice(0, 6)] : []),
					'Если консоль не поняла schem/paste — на ядре другой плагин схематиков; проверь hosting_plugins и консоль hosting_console. Paste ставит постройку по СТАРЫМ координатам — перенести можно hosting_build (clone) или самим schematics-плагином.',
				].join('\n')
			}

			// .nbt/.mcstructure — ванильная структура: в <мир>/structures, затем place template
			if (/\.(nbt|mcstructure)$/.test(path)) {
				const world = await findWorldFolder(server)
				if (!world)
					return `Не нашёл папку мира на «${server.name}» (ищу level.dat). Список папок: <<hosting_files|${server.id}::.>>.`
				const structures = `${world}/structures`
				await hosting_file_create_dir(server.id, structures).catch(() => undefined)
				const written = await hosting_file_write(
					server.id,
					`${structures}/${name}.nbt`,
					bytes,
				).then(
					() => true,
					() => false,
				)
				if (!written) return `Не удалось записать ${structures}/${name}.nbt.`
				// Позиция: назвал игрок → она; один игрок в сети → перед ним; иначе спросим.
				let at: number[] | null = coords && coords.length === 3 ? coords : null
				if (!at && server.players.length === 1) {
					const anchor = await playerAnchor(server, server.players[0])
					if (typeof anchor !== 'string') {
						const dir = facingFromYaw(anchor.yaw)
						at = [
							Math.floor(anchor.x) + dir.dx * 3,
							Math.floor(anchor.y),
							Math.floor(anchor.z) + dir.dz * 3,
						]
					}
				}
				if (!at)
					return `Структура ${name}.nbt записана в ${structures}/. Куда ставить? Дай координаты: <<hosting_structure|${server.id}::${url}::${name}::x y z>> (позицию игрока знает hosting_player).`
				const [x, y, z] = at
				let answer = (
					await runCommands(server, [`place template ${name} ${x} ${y} ${z}`], 300)
				).map(stripHead)
				if (answer.some((line) => COMMAND_ERROR_RE.test(line))) {
					// Версии 1.19.4–1.20.1 называют ту же команду «place structure».
					answer = (await runCommands(server, [`place structure ${name} ${x} ${y} ${z}`], 300)).map(
						stripHead,
					)
				}
				const errors = answer.filter((line) => COMMAND_ERROR_RE.test(line))
				return [
					`Структура ${name}.nbt → ${structures}/ на «${server.name}», ставлю в ${x} ${y} ${z}.`,
					answer.length ? `Консоль:\n${answer.slice(-6).join('\n')}` : '(сервер ничего не ответил)',
					...(errors.length ? ['Ошибки:', ...errors.slice(0, 6)] : []),
					'«Unknown template» — файл не ванильный .nbt; «Unknown command» у обоих вариантов — версия старше 1.19.4, тогда только hosting_build. Повернуть: <<hosting_cmd|сервер::place template ' +
						`${name} ${x} ${y} ${z} 90` +
						'>>.',
				].join('\n')
			}

			return 'Не понял формат файла. Поддерживаю .nbt (ванильная структура) и .schem/.schematic (WorldEdit). Прямая ссылка должна вести на сам файл, а не на страницу.'
		}
		default:
			return null
	}
})
