import type { Activity } from './model'

/**
 * Локальная статистика игрока для карточек профиля: последняя сборка,
 * последний сервер и любимая сборка (у которой накопилось больше всего
 * времени игры). Всё считается из того, что лаунчер реально видел — живые
 * события activity, снимки списков друзей и собственная активность — и
 * живёт в localStorage: сервер ничего про время игры не хранит.
 */
const KEY = 'portalrinth-messenger-playstats:'
/** Раз в полминуты натикаем время открытой игровой сессии. */
const TICK_MS = 30_000
/** Вебвью мог уснуть: шаг длиннее этого считаем сном и время не начисляем. */
const MAX_STEP_MS = 90_000

type Stats = {
	lastBuild: string
	lastBuildMeta: string
	lastServer: string
	lastServerMeta: string
	builds: Record<string, number>
}

const stats = new Map<string, Stats>()
const sessions = new Map<string, { build: string; lastTick: number }>()
let ticker: ReturnType<typeof setInterval> | null = null

function readStats(userId: string): Stats {
	const known = stats.get(userId)
	if (known) return known
	let item: Stats | null = null
	try {
		item = JSON.parse(localStorage.getItem(KEY + userId) || 'null') as Stats | null
	} catch {
		item = null
	}
	if (!item || typeof item !== 'object') {
		item = { lastBuild: '', lastBuildMeta: '', lastServer: '', lastServerMeta: '', builds: {} }
	}
	stats.set(userId, item)
	return item
}

function persist(userId: string, item: Stats): void {
	try {
		localStorage.setItem(KEY + userId, JSON.stringify(item))
	} catch {
		/* без хранилища статистика живёт до перезапуска */
	}
}

function metaOf(activity: Activity): string {
	const loader = (activity.loader || '').toLowerCase()
	const loaderName =
		loader && loader !== 'vanilla' ? loader.charAt(0).toUpperCase() + loader.slice(1) : ''
	return [activity.gameVersion, loaderName].filter(Boolean).join(' · ')
}

function accrue(item: Stats, build: string, ms: number): void {
	if (ms <= 0 || !build) return
	item.builds[build] = (item.builds[build] || 0) + ms
}

function tickAll(): void {
	const now = Date.now()
	for (const [userId, session] of sessions) {
		const item = readStats(userId)
		accrue(item, session.build, Math.min(now - session.lastTick, MAX_STEP_MS))
		session.lastTick = now
		persist(userId, item)
	}
}

function ensureTicker(): void {
	if (ticker) return
	ticker = setInterval(tickAll, TICK_MS)
}

/**
 * Каждое появление активности игрока идёт сюда: живые события из потока,
 * снимки из списков друзей и собственная активность («сейчас играю»).
 */
export function noteActivity(userId: string, activity: Activity | null | undefined): void {
	if (!userId) return
	const item = readStats(userId)
	if (!activity?.playing || !activity.buildName) {
		sessions.delete(userId)
		return
	}
	ensureTicker()
	if (activity.serverName || activity.serverHost) {
		const server = activity.serverName || activity.serverHost || ''
		if (server) item.lastServer = server
		if (activity.serverHost && activity.serverHost !== server) {
			item.lastServerMeta = activity.serverHost
		}
	}
	item.lastBuild = activity.buildName
	item.lastBuildMeta = metaOf(activity)
	const session = sessions.get(userId)
	if (session && session.build !== activity.buildName) {
		accrue(item, session.build, Math.min(Date.now() - session.lastTick, MAX_STEP_MS))
		sessions.delete(userId)
	}
	if (!sessions.has(userId)) {
		sessions.set(userId, { build: activity.buildName, lastTick: Date.now() })
	}
	persist(userId, item)
}

export type PlayStats = Stats & { favoriteBuild: string; favoriteSeconds: number }

/** Снимок статистики игрока: с любимой сборкой и её временем в секундах. */
export function playStatsOf(userId: string): PlayStats | null {
	if (!userId) return null
	const item = readStats(userId)
	let favoriteBuild = ''
	let favoriteMs = 0
	for (const [build, ms] of Object.entries(item.builds)) {
		if (ms > favoriteMs) {
			favoriteBuild = build
			favoriteMs = ms
		}
	}
	return {
		...item,
		favoriteBuild,
		favoriteSeconds: Math.round(favoriteMs / 1000),
	}
}

/** «2 ч 34 мин», «45 мин», «меньше минуты». */
export function formatPlaytime(seconds: number): string {
	if (seconds < 60) return 'меньше минуты'
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	if (hours === 0) return `${minutes} мин`
	const rest = minutes % 60
	return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}
