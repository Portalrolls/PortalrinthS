/**
 * Клиент сервиса Undefined Client (uprojects.site) — тот же бэкенд, на котором
 * у них работают MC Messenger и социальная лента. Portalrinth входит тем же
 * способом: сессия создаётся из токена аккаунта Microsoft или Ely.by, поэтому
 * посты и чаты одни и те же и у их игроков, и у наших — «посты всех, у нас в
 * лаунчере». Сервис обновят позже, наш клиент к этому готов: все адреса идут
 * от одного базового, а ответы разбираются мягко (неизвестные поля не ломают).
 */
import { ACTIVE_ACCOUNT_EVENT, readActiveAccount, sameUuid } from './active-account'
import { get_default_user, users } from './auth'
import { ely_get_default_user, ely_get_users, type ElyCredentials } from './ely_auth'
import { offline_users } from './offline_auth'
import { proxiedFetch } from './proxy-fetch'

/** Прод-адрес API лаунчера Undefined Client. */
export const UPROJECTS_BASE = 'https://uprojects.site/client'
/** Запасной вход того же сайта (Европа). */
export const UPROJECTS_BASE_EU = 'https://eu.uprojects.site/client'

const MESSENGER_API = `${UPROJECTS_BASE}/api/messenger`

/** Свободный ответ сервиса: сетевые поля меняются, разбираем мягко. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseRecord = Record<string, any>

export type ServiceAccount = {
	provider: 'msa' | 'ely'
	uuid: string
	name: string
	accessToken: string
}

export type ServiceUser = {
	id?: string | number
	username?: string
	name?: string
	uuid?: string
	provider?: string
	skinUrl?: string | null
	avatar?: string | null
	verified?: boolean
	followerCount?: number
	postCount?: number
	friendsCount?: number
}

export type ServiceSession = {
	token: string
	user: ServiceUser
	accountKey: string
}

const SESSION_KEY = 'portalrinth-uprojects-session'
const SESSION_TTL = 12 * 60 * 60 * 1000

type StoredSession = ServiceSession & { savedAt: number }

let sessionPromise: Promise<ServiceSession | null> | null = null

export type AccountState =
	| { kind: 'ready'; account: ServiceAccount }
	| { kind: 'offline'; name: string }
	| { kind: 'none' }

type MsaCredential = { profile?: { id?: string; name?: string }; access_token?: string }

async function pickElyAccount(id?: string | null): Promise<ServiceAccount | null> {
	const ely: ElyCredentials[] = (await ely_get_users().catch(() => [])) ?? []
	const hit =
		(id ? ely.find((account) => sameUuid(account.profile?.id, id)) : undefined) ??
		ely.find((account) => account.active)
	if (!hit?.access_token || !hit.profile?.id) return null
	return {
		provider: 'ely',
		uuid: hit.profile.id,
		name: hit.profile.name,
		accessToken: hit.access_token,
	}
}

async function pickMsaAccount(id?: string | null): Promise<ServiceAccount | null> {
	const msa = ((await users().catch(() => [])) ?? []) as MsaCredential[]
	const wanted = id || ((await get_default_user().catch(() => null)) as string | null)
	if (!wanted) return null
	const hit = msa.find((account) => sameUuid(account.profile?.id, wanted))
	if (!hit?.access_token || !hit.profile?.id) return null
	return {
		provider: 'msa',
		uuid: hit.profile.id,
		name: hit.profile.name || '',
		accessToken: hit.access_token,
	}
}

/**
 * Тот аккаунт, что выбран в карточке аккаунтов. Офлайн-аккаунт в сервис не
 * пускают — у него нет токена, поэтому о нём сообщаем отдельно.
 */
export async function readAccountState(): Promise<AccountState> {
	const chosen = readActiveAccount()
	if (chosen?.provider === 'offline') {
		const list = await offline_users().catch(() => [])
		const hit = list.find((account) => sameUuid(account.profile?.id, chosen.id))
		return { kind: 'offline', name: hit?.profile?.name || '' }
	}
	if (chosen?.provider === 'ely_by') {
		const account = await pickElyAccount(chosen.id)
		if (account) return { kind: 'ready', account }
	}
	if (chosen?.provider === 'microsoft') {
		const account = await pickMsaAccount(chosen.id)
		if (account) return { kind: 'ready', account }
	}
	const elyId = await ely_get_default_user().catch(() => null)
	if (elyId) {
		const account = await pickElyAccount(elyId)
		if (account) return { kind: 'ready', account }
	}
	const msa = await pickMsaAccount()
	if (msa) return { kind: 'ready', account: msa }
	return { kind: 'none' }
}

async function readServiceAccount(): Promise<ServiceAccount | null> {
	const state = await readAccountState()
	return state.kind === 'ready' ? state.account : null
}

function accountKeyOf(account: ServiceAccount): string {
	return `${account.provider}:${String(account.uuid).replace(/-/g, '').toLowerCase()}`
}

async function serviceFetch(
	path: string,
	opts: { method?: string; body?: unknown; token?: string; base?: string } = {},
): Promise<{ ok: boolean; status: number; data: LooseRecord }> {
	const base = opts.base || MESSENGER_API
	const headers: Record<string, string> = {
		'User-Agent': 'Undefined-Client',
		Accept: 'application/json',
	}
	if (opts.token) headers.Authorization = `Bearer ${opts.token}`
	let bodyText: string | undefined
	if (opts.body !== undefined) {
		headers['Content-Type'] = 'application/json'
		bodyText = JSON.stringify(opts.body)
	}
	try {
		const response = await proxiedFetch(`${base}${path}`, {
			method: opts.method || 'GET',
			headers,
			body: bodyText,
			connectTimeout: 12000,
		})
		const data = (await response.json().catch(() => ({}))) as LooseRecord
		return { ok: response.ok, status: response.status, data }
	} catch (error) {
		return {
			ok: false,
			status: 0,
			data: { error: error instanceof Error ? error.message : 'network' },
		}
	}
}

async function accountSkinUrl(account: ServiceAccount): Promise<string | null> {
	try {
		if (account.provider === 'ely') {
			const res = await proxiedFetch(
				`https://skinsystem.ely.by/textures/${encodeURIComponent(account.name)}`,
				{ connectTimeout: 8000 },
			)
			if (!res.ok || res.status === 204) return null
			const data = (await res.json()) as { SKIN?: { url?: string } }
			const url = data?.SKIN?.url || null
			return url ? url.replace(/^http:\/\//, 'https://') : null
		}
		const id = account.uuid.replace(/-/g, '')
		const res = await proxiedFetch(
			`https://sessionserver.mojang.com/session/minecraft/profile/${id}`,
			{ connectTimeout: 8000 },
		)
		if (!res.ok) return null
		const data = (await res.json()) as { properties?: { name: string; value: string }[] }
		const raw = data?.properties?.find((prop) => prop.name === 'textures')?.value
		if (!raw) return null
		const textures = JSON.parse(atob(raw)) as { textures?: { SKIN?: { url?: string } } }
		const url = textures?.textures?.SKIN?.url || null
		return url ? url.replace(/^http:\/\//, 'https://') : null
	} catch {
		return null
	}
}

async function createSession(account: ServiceAccount): Promise<ServiceSession | null> {
	const response = await serviceFetch('/session', {
		method: 'POST',
		body: {
			provider: account.provider,
			accessToken: account.accessToken,
			skinUrl: await accountSkinUrl(account),
		},
	})
	if (!response.ok || !response.data?.token) return null
	return {
		token: String(response.data.token),
		user: response.data.user || {},
		accountKey: accountKeyOf(account),
	}
}

/**
 * Сессия сервиса: берётся из кэша, иначе создаётся из активного аккаунта.
 * Возвращает null, когда аккаунта Microsoft/Ely.by нет (это решение игрока,
 * а не поломка) или когда сервис недоступен.
 */
export async function ensureServiceSession(force = false): Promise<ServiceSession | null> {
	if (!force && sessionPromise) return sessionPromise
	sessionPromise = (async () => {
		const account = await readServiceAccount()
		if (!account) return null
		const key = accountKeyOf(account)
		if (!force) {
			try {
				const raw = localStorage.getItem(SESSION_KEY)
				if (raw) {
					const saved = JSON.parse(raw) as StoredSession
					const fresh = Date.now() - (saved?.savedAt || 0) < SESSION_TTL
					if (saved?.token && saved.accountKey === key && fresh) {
						const probe = await serviceFetch('/me', { token: saved.token })
						if (probe.ok) {
							return {
								token: saved.token,
								user: probe.data?.user || saved.user,
								accountKey: saved.accountKey,
							}
						}
					}
				}
			} catch {
				localStorage.removeItem(SESSION_KEY)
			}
		}
		const created = await createSession(account)
		if (created) {
			try {
				localStorage.setItem(
					SESSION_KEY,
					JSON.stringify({ ...created, savedAt: Date.now() } satisfies StoredSession),
				)
			} catch {
				/* нет места — сессия просто не переживёт перезапуск */
			}
		}
		return created
	})()
	return sessionPromise
}

const sessionListeners = new Set<() => void>()

/** Подписка на смену аккаунта: страницы пересоздают сессию и перерисовываются. */
export function onServiceAccountChange(listener: () => void): () => void {
	sessionListeners.add(listener)
	return () => sessionListeners.delete(listener)
}

if (typeof window !== 'undefined') {
	window.addEventListener(ACTIVE_ACCOUNT_EVENT, () => {
		forgetServiceSession()
		for (const listener of sessionListeners) listener()
	})
}

export function forgetServiceSession(): void {
	sessionPromise = null
	try {
		localStorage.removeItem(SESSION_KEY)
	} catch {
		/* ignore */
	}
}

/** Запрос к API мессенджера с токеном сессии; 401 один раз обновляет сессию. */
export async function serviceRequest(
	path: string,
	opts: {
		method?: string
		body?: unknown
		query?: Record<string, string | number | undefined>
	} = {},
): Promise<{ ok: boolean; status: number; data: LooseRecord; error?: string; code?: string }> {
	let session = await ensureServiceSession()
	if (!session) return { ok: false, status: 0, data: {}, error: 'no_account', code: 'no_account' }
	let target = path.startsWith('/') ? path : `/${path}`
	if (opts.query) {
		const search = new URLSearchParams()
		for (const [key, value] of Object.entries(opts.query)) {
			if (value === undefined || value === null || value === '') continue
			search.set(key, String(value))
		}
		const qs = search.toString()
		if (qs) target += `?${qs}`
	}
	let response = await serviceFetch(target, {
		method: opts.method,
		body: opts.body,
		token: session.token,
	})
	if (response.status === 401) {
		forgetServiceSession()
		session = await ensureServiceSession(true)
		if (!session)
			return { ok: false, status: 401, data: {}, error: 'no_account', code: 'no_account' }
		response = await serviceFetch(target, {
			method: opts.method,
			body: opts.body,
			token: session.token,
		})
	}
	return {
		ok: response.ok,
		status: response.status,
		data: response.data,
		error: response.data?.error,
		code: response.data?.code,
	}
}

/** Адрес SSE-потока живых событий мессенджера. */
export function serviceStreamUrl(token: string): string {
	return `${MESSENGER_API}/stream?token=${encodeURIComponent(token)}`
}

/** Ссылка на файл из сервиса: относительные пути растут от базового адреса. */
export function resolveServiceMedia(url: string | null | undefined): string {
	const value = String(url || '').trim()
	if (!value) return ''
	if (/^(https?:|data:)/.test(value)) return value
	if (value.startsWith('/api/messenger/')) return `${UPROJECTS_BASE}${value}`
	if (value.startsWith('/client/')) return UPROJECTS_BASE.replace(/\/client$/, '') + value
	if (value.startsWith('/')) return `${UPROJECTS_BASE}${value}`
	return value
}

/**
 * Голова игрока для аватарки: сервис отдаёт skinUrl — лист текстуры скина,
 * а не готовую голову. Рисуем голову сами (лицо 8,8 + шляпа 40,8), как в
 * оригинальном клиенте. Пустой skinUrl закрываем по uuid/нику.
 */
const avatarCache = new Map<string, string>()
const avatarInflight = new Map<string, Promise<string>>()

const STEVE_HEAD = 'https://mc-heads.net/avatar/MHF_Steve/64'

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('decode'))
		image.src = src
	})
}

/**
 * Скины качаем не больше чем по четыре сразу: у сервера сотни участников, и
 * если запросить все головы разом, сеть лаунчера захлёбывается — Modrinth и
 * загрузка файлов сборок встают в очередь за ними.
 */
const SKIN_SLOTS = 4
let skinBusy = 0
const skinWaiting: (() => void)[] = []

async function withSkinSlot<T>(task: () => Promise<T>): Promise<T> {
	if (skinBusy >= SKIN_SLOTS) await new Promise<void>((resolve) => skinWaiting.push(resolve))
	skinBusy += 1
	try {
		return await task()
	} finally {
		skinBusy -= 1
		skinWaiting.shift()?.()
	}
}

/** Кроп головы из листа скина 64×32/64×64 (и кратных ему HD-вариантов). */
async function cropSkinHead(src: string, size = 64): Promise<string> {
	try {
		const probe = await withSkinSlot(async () => {
			const response = await proxiedFetch(src, { connectTimeout: 8000 })
			return { ok: response.ok, blob: response.ok ? await response.blob() : null }
		})
		if (!probe.ok || !probe.blob) return ''
		const blob = probe.blob
		const objectUrl = URL.createObjectURL(blob)
		try {
			const image = await loadImage(objectUrl)
			const width = image.naturalWidth || image.width
			const height = image.naturalHeight || image.height
			if (width < 64 || width % 64 !== 0) return ''
			const scale = width / 64
			const rows = height / scale
			if (Math.abs(rows - 64) > 0.5 && Math.abs(rows - 32) > 0.5) return ''
			const canvas = document.createElement('canvas')
			canvas.width = size
			canvas.height = size
			const context = canvas.getContext('2d')
			if (!context) return ''
			context.imageSmoothingEnabled = false
			const face = 8 * scale
			context.drawImage(image, 8 * scale, 8 * scale, face, face, 0, 0, size, size)
			context.drawImage(image, 40 * scale, 8 * scale, face, face, 0, 0, size, size)
			return canvas.toDataURL('image/png')
		} finally {
			URL.revokeObjectURL(objectUrl)
		}
	} catch {
		return ''
	}
}

/** Готовая голова от сервисов рендера — кропать не нужно. */
function isFinishedHeadUrl(raw: string): boolean {
	return (
		/crafatar\.com\/(avatars|renders)\//i.test(raw) ||
		/mc-heads\.net\/(avatar|helm|head)\//i.test(raw) ||
		/minotar\.net\/(avatar|helm|cube)\//i.test(raw) ||
		/mineatar\.io\/(face|body)\//i.test(raw) ||
		/\/api\/messenger\/avatars\//i.test(raw) ||
		/\/avatar\//i.test(raw)
	)
}

/** Внешняя голова по uuid/нику — когда своего скина нет. */
function serviceHead(key: string, size: number): string {
	const trimmed = key.replace(/-/g, '').toLowerCase()
	if (trimmed.length >= 32) {
		return `https://mc-heads.net/avatar/${trimmed}/${size}`
	}
	if (key) {
		return `https://mc-heads.net/avatar/${encodeURIComponent(key)}/${size}`
	}
	return STEVE_HEAD
}

export async function resolveAvatar(
	user: {
		skinUrl?: string | null
		avatar?: string | null
		uuid?: string
		username?: string
		name?: string
	},
	size = 64,
): Promise<string> {
	const key = String(user.uuid || user.username || user.name || '')
	const inflight = avatarInflight.get(key)
	if (inflight) return inflight
	const task = buildAvatar(user, key, size).then((url) => {
		if (key && url) avatarCache.set(key, url)
		avatarInflight.delete(key)
		return url
	})
	if (key) avatarInflight.set(key, task)
	return task
}

async function buildAvatar(
	user: { skinUrl?: string | null; avatar?: string | null },
	key: string,
	size: number,
): Promise<string> {
	if (key) {
		const cached = avatarCache.get(key)
		if (cached) return cached
	}
	// avatar бывает уже готовой головой (иконка клана, загруженный файл) —
	// тогда кроп не сработает и картинка уйдёт как есть.
	const direct = String(user.avatar || '').trim()
	if (direct) {
		const resolved = resolveServiceMedia(direct)
		if (isFinishedHeadUrl(resolved) || isFinishedHeadUrl(direct)) return resolved
		const cropped = await cropSkinHead(resolved, size)
		if (cropped) return cropped
		if (resolved) return resolved
	}
	const skin = String(user.skinUrl || '').trim()
	if (skin) {
		const resolved = resolveServiceMedia(skin)
		const cropped = await cropSkinHead(resolved, size)
		if (cropped) return cropped
	}
	if (!key) return ''
	return serviceHead(key, size)
}

/** Сжимает картинку в JPEG нужного размера (base64) — так сервис принимает вложения постов. */
export function compressImageFile(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onerror = () => reject(new Error('read_failed'))
		reader.onload = () => {
			const image = new Image()
			image.onerror = () => reject(new Error('decode_failed'))
			image.onload = () => {
				const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
				const canvas = document.createElement('canvas')
				canvas.width = Math.max(1, Math.round(image.width * scale))
				canvas.height = Math.max(1, Math.round(image.height * scale))
				const context = canvas.getContext('2d')
				if (!context) {
					reject(new Error('canvas_failed'))
					return
				}
				context.fillStyle = '#000'
				context.fillRect(0, 0, canvas.width, canvas.height)
				context.drawImage(image, 0, 0, canvas.width, canvas.height)
				resolve(canvas.toDataURL('image/jpeg', quality))
			}
			image.src = String(reader.result)
		}
		reader.readAsDataURL(file)
	})
}
