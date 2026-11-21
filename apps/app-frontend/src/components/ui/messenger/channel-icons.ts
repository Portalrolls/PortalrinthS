/** Локальные иконки каналов: эмодзи вместо решётки. Сервис иконки каналов
    не хранит, поэтому привязка живёт в localStorage на этом устройстве. */
const KEY = 'portalrinth-channel-icons'

const icons: Record<string, string> = read()

function read(): Record<string, string> {
	try {
		const raw = localStorage.getItem(KEY)
		const parsed = raw ? (JSON.parse(raw) as unknown) : null
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
	} catch {
		return {}
	}
}

function persist(): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(icons))
	} catch {
		/* переполнился localStorage — иконки просто не сохранятся */
	}
}

export function channelIcon(channelId: string): string {
	return icons[channelId] || ''
}

export function setChannelIcon(channelId: string, emoji: string): void {
	const value = emoji.trim()
	if (value) icons[channelId] = value
	else Reflect.deleteProperty(icons, channelId)
	persist()
}

/** Частые эмодзи для быстрого выбора при создании канала. */
export const CHANNEL_ICON_PRESETS = [
	'💬',
	'🎮',
	'🏠',
	'🔥',
	'⭐',
	'👑',
	'⚡',
	'🎯',
	'🎲',
	'🛡️',
	'📌',
	'🎵',
	'🍀',
	'☢️',
	'🧨',
	'🤖',
	'🧱',
	'⚔️',
	'🌍',
	'💾',
]
