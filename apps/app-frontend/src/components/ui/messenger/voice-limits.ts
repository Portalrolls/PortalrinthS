/** Локальный лимит участников голосового канала. Сервис лимиты не хранит,
    поэтому настройка живёт в localStorage на этом устройстве — как иконки. */
const KEY = 'portalrinth-voice-limits'

const limits: Record<string, number> = read()

function read(): Record<string, number> {
	try {
		const raw = localStorage.getItem(KEY)
		const parsed = raw ? (JSON.parse(raw) as unknown) : null
		if (!parsed || typeof parsed !== 'object') return {}
		const out: Record<string, number> = {}
		for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
			const n = Number(value)
			if (Number.isFinite(n) && n > 0) out[id] = Math.floor(n)
		}
		return out
	} catch {
		return {}
	}
}

function persist(): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(limits))
	} catch {
		/* переполнился localStorage — лимит просто не сохранится */
	}
}

export function voiceLimit(channelId: string): number {
	return limits[channelId] || 0
}

export function setVoiceLimit(channelId: string, limit: number): void {
	const n = Math.max(0, Math.floor(limit) || 0)
	if (n > 0) limits[channelId] = n
	else Reflect.deleteProperty(limits, channelId)
	persist()
}
