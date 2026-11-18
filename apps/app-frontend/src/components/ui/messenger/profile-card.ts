import { reactive, watch } from 'vue'

import { serviceRequest } from '@/helpers/uprojects-service'

import { dmWith, myId, state } from './store'

/**
 * Оформление профиля: баннер, описание, акцент. У сервера мессенджера нет
 * для этого поля, поэтому карточка хранится у владельца и расходится между
 * клиентами лаунчера служебным пакетом в сигнальном канале личного чата —
 * так же, как ростер звонка. Чужие клиенты такой пакет пропускают.
 */
export type ProfileCard = {
	bio: string
	pronouns: string
	bannerColor: string
	bannerImage: string
	accent: string
	updatedAt: number
}

export const BANNER_COLORS = [
	'#5865f2',
	'#23a55a',
	'#f0b232',
	'#f23f43',
	'#eb459e',
	'#3ba7ff',
	'#9b59b6',
	'#1abc9c',
	'#2b2d31',
]

export const BIO_LIMIT = 190
const OWN_KEY = 'portalrinth.messenger.profile'
const CACHE_KEY = 'portalrinth.messenger.profiles'
const CACHE_LIMIT = 60
const ASK_GAP = 60_000

export function emptyCard(): ProfileCard {
	return { bio: '', pronouns: '', bannerColor: '', bannerImage: '', accent: '', updatedAt: 0 }
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key)
		return raw ? (JSON.parse(raw) as T) : fallback
	} catch {
		return fallback
	}
}

function writeJson(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value))
	} catch {
		return
	}
}

function clean(raw: unknown): ProfileCard | null {
	if (!raw || typeof raw !== 'object') return null
	const src = raw as Record<string, unknown>
	const color = (value: unknown) =>
		typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : ''
	const image = typeof src.bannerImage === 'string' ? src.bannerImage : ''
	return {
		bio: String(src.bio ?? '').slice(0, BIO_LIMIT),
		pronouns: String(src.pronouns ?? '').slice(0, 40),
		bannerColor: color(src.bannerColor),
		bannerImage: /^data:image\/(webp|png|jpeg);base64,/.test(image) ? image : '',
		accent: color(src.accent),
		updatedAt: Number(src.updatedAt) || 0,
	}
}

export const profileEditor = reactive({ open: false })

const own = reactive<Record<string, ProfileCard>>(readJson(OWN_KEY, {}))
const cache = reactive<Record<string, ProfileCard>>(readJson(CACHE_KEY, {}))
const asked = new Map<string, number>()

watch(own, () => writeJson(OWN_KEY, own), { deep: true })

function persistCache(): void {
	const ids = Object.keys(cache)
	if (ids.length > CACHE_LIMIT) {
		ids
			.sort((a, b) => cache[a].updatedAt - cache[b].updatedAt)
			.slice(0, ids.length - CACHE_LIMIT)
			.forEach((id) => Reflect.deleteProperty(cache, id))
	}
	writeJson(CACHE_KEY, cache)
}

export function myCard(): ProfileCard {
	return own[myId.value] ?? emptyCard()
}

export function cardOf(userId: string): ProfileCard {
	if (userId && userId === myId.value) return myCard()
	return cache[userId] ?? emptyCard()
}

export function hasCard(card: ProfileCard): boolean {
	return Boolean(card.bio || card.pronouns || card.bannerColor || card.bannerImage || card.accent)
}

async function send(userId: string, payload: Record<string, unknown>): Promise<boolean> {
	const conv = dmWith(userId)
	if (!conv) return false
	const res = await serviceRequest(`/conversations/${encodeURIComponent(conv.id)}/signals`, {
		method: 'POST',
		body: {
			type: 'call_ice',
			channelId: null,
			sdp: null,
			toUserId: userId,
			candidate: payload,
		},
	}).catch(() => null)
	return Boolean(res?.ok)
}

/** Просим свежую карточку, не чаще раза в минуту на человека. */
export function requestCard(userId: string): void {
	if (!userId || userId === myId.value) return
	const last = asked.get(userId) ?? 0
	if (Date.now() - last < ASK_GAP) return
	asked.set(userId, Date.now())
	void send(userId, { portalrinth: 'profile_req', have: cache[userId]?.updatedAt ?? 0 })
}

export async function saveMyCard(patch: Partial<ProfileCard>): Promise<void> {
	const id = myId.value
	if (!id) return
	const next = clean({ ...myCard(), ...patch, updatedAt: Date.now() })
	if (!next) return
	own[id] = next
	const peers = state.friends
		.filter((friend) => dmWith(friend.id))
		.slice(0, 40)
		.map((friend) => friend.id)
	await Promise.allSettled(peers.map((peer) => send(peer, { portalrinth: 'profile', card: next })))
}

function parseCandidate(raw: unknown): Record<string, unknown> | null {
	if (raw && typeof raw === 'object') return raw as Record<string, unknown>
	if (typeof raw !== 'string') return null
	try {
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === 'object' ? parsed : null
	} catch {
		return null
	}
}

/** true — пакет наш и уже обработан, в звонок его передавать не нужно. */
export function handleProfileSignal(data: Record<string, unknown>): boolean {
	if (data.type !== 'call_ice') return false
	const payload = parseCandidate(data.candidate)
	const kind = String(payload?.portalrinth ?? '')
	if (!payload || !kind.startsWith('profile')) return false
	const from = String(data.fromUserId ?? '')
	if (!from || from === myId.value) return true
	if (kind === 'profile_req') {
		const mine = myCard()
		if (hasCard(mine) && mine.updatedAt > (Number(payload.have) || 0)) {
			void send(from, { portalrinth: 'profile', card: mine })
		}
		return true
	}
	if (kind === 'profile') {
		const card = clean(payload.card)
		if (card && card.updatedAt >= (cache[from]?.updatedAt ?? 0)) {
			cache[from] = card
			persistCache()
		}
	}
	return true
}

/** Баннер ужимается до 600×240 WebP, чтобы пакет проходил через сигнальный канал. */
export async function compressBanner(file: Blob): Promise<string> {
	const bitmap = await createImageBitmap(file)
	const width = 600
	const height = 240
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('canvas')
	const scale = Math.max(width / bitmap.width, height / bitmap.height)
	const w = bitmap.width * scale
	const h = bitmap.height * scale
	ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h)
	bitmap.close()
	for (const quality of [0.8, 0.65, 0.5, 0.38]) {
		const url = canvas.toDataURL('image/webp', quality)
		if (url.length < 60_000) return url
	}
	return canvas.toDataURL('image/webp', 0.3)
}
