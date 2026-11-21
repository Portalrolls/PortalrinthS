import { type LooseRecord, resolveServiceMedia, serviceBase } from '@/helpers/uprojects-service'

import type { Translate } from './i18n'

export type Activity = {
	playing?: boolean
	hosting?: boolean
	worldShare?: boolean
	serverName?: string
	serverHost?: string
	buildName?: string
	gameVersion?: string
	loader?: string
}

export type Peer = {
	id: string
	username: string
	uuid?: string
	skinUrl?: string | null
	avatar?: string | null
	provider?: string
	lastSeenAt: number
	presenceStatus: string
	activity?: Activity | null
	bot: boolean
}

export type Member = Peer & {
	role: string
	roleIds: string[]
	nickname: string
}

export type Role = {
	id: string
	name: string
	color: string
	position: number
}

export type Conversation = {
	id: string
	dm: boolean
	project: boolean
	title: string
	description: string
	peer?: Peer
	avatarUrl: string
	coverUrl: string
	createdBy: string
	myRole: string
	unread: number
	updatedAt: number
	lastPreview: string
	members: Member[]
	roles: Role[]
}

export type Channel = {
	id: string
	name: string
	kind: 'text' | 'voice'
	slug: string
	topic: string
	categoryId: string
	position: number
	local: boolean
}

export type Category = {
	id: string
	name: string
	position: number
}

export type Reaction = { emoji: string; count: number; me: boolean }

export type Attachment = {
	name: string
	size: number
	mime: string
	url: string
	kind: 'image' | 'gif' | 'video' | 'audio' | 'voice' | 'file'
}

export type Msg = {
	id: string
	conversationId: string
	channelId: string
	senderId: string
	senderName: string
	body: string
	createdAt: number
	editedAt: number
	attachment: Attachment | null
	replyTo: { id: string; senderId: string; senderName: string; body: string } | null
	reactions: Reaction[]
	pinned: boolean
	kind: string
	pending?: boolean
}

export const ONLINE_MS = 2 * 60 * 1000
export const MAX_FILE_BYTES = 1024 * 1024 * 1024

export function isBotUser(row: LooseRecord | null | undefined): boolean {
	if (!row) return false
	return (
		Boolean(row.bot) ||
		String(row.provider || '').toLowerCase() === 'bot' ||
		String(row.id || '').startsWith('bot:')
	)
}

export function mapPeer(row: LooseRecord): Peer {
	return {
		id: String(row.id ?? ''),
		username: String(row.username || row.name || ''),
		uuid: row.uuid ? String(row.uuid) : undefined,
		skinUrl: (row.skinUrl ?? null) as string | null,
		avatar: (row.avatar ?? null) as string | null,
		provider: row.provider ? String(row.provider) : undefined,
		lastSeenAt: Number(row.lastSeenAt) || 0,
		presenceStatus: String(row.presenceStatus || ''),
		activity: mapActivity(row.activity),
		bot: isBotUser(row),
	}
}

function mapMember(row: LooseRecord): Member {
	return {
		...mapPeer(row),
		role: String(row.role || 'member'),
		roleIds: Array.isArray(row.roleIds) ? row.roleIds.map(String) : [],
		nickname: String(row.nickname || ''),
	}
}

export function mapConversation(row: LooseRecord): Conversation | null {
	const id = String(row?.id ?? '')
	if (!id) return null
	const peer = row.peer?.id ? mapPeer(row.peer) : undefined
	const project = Boolean(row.isProject)
	const dm = row.type === 'dm' || (Boolean(peer) && row.type !== 'group' && !project)
	const last = row.lastMessage as LooseRecord | undefined
	const members = (Array.isArray(row.members) ? row.members : [])
		.filter((member: LooseRecord) => member?.id)
		.map(mapMember)
	const roles = (Array.isArray(row.roles) ? row.roles : [])
		.filter((role: LooseRecord) => role?.id)
		.map((role: LooseRecord) => ({
			id: String(role.id),
			name: String(role.name || ''),
			color: String(role.color || '#99aab5'),
			position: Number(role.position) || 0,
		}))
		.sort((a: Role, b: Role) => b.position - a.position)
	return {
		id,
		dm,
		project,
		title: String(row.title || row.name || peer?.username || ''),
		description: String(row.description || ''),
		peer,
		avatarUrl: row.avatarUrl ? resolveServiceMedia(String(row.avatarUrl)) : '',
		coverUrl: row.coverUrl ? resolveServiceMedia(String(row.coverUrl)) : '',
		createdBy: String(row.createdBy || ''),
		myRole: String(row.myRole || ''),
		unread: Number(row.unreadCount) || 0,
		updatedAt: Number(last?.createdAt) || Number(row.updatedAt) || Number(row.createdAt) || 0,
		lastPreview: last ? previewOf(last) : '',
		members,
		roles,
	}
}

export function mapChannels(data: LooseRecord | null | undefined): {
	channels: Channel[]
	categories: Category[]
} {
	const channels = (Array.isArray(data?.channels) ? data.channels : [])
		.filter((row: LooseRecord) => row?.id)
		.map(
			(row: LooseRecord, index: number): Channel => ({
				id: String(row.id),
				name: String(row.name || ''),
				kind: row.kind === 'voice' ? 'voice' : 'text',
				slug: String(row.slug || ''),
				topic: String(row.topic || ''),
				categoryId: row.categoryId ? String(row.categoryId) : '',
				position: row.position == null ? index : Number(row.position) || 0,
				local: false,
			}),
		)
		.sort((a: Channel, b: Channel) => a.position - b.position)
	const categories = (Array.isArray(data?.categories) ? data.categories : [])
		.filter((row: LooseRecord) => row?.id)
		.map(
			(row: LooseRecord, index: number): Category => ({
				id: String(row.id),
				name: String(row.name || ''),
				position: row.position == null ? index : Number(row.position) || 0,
			}),
		)
		.sort((a: Category, b: Category) => a.position - b.position)
	return { channels, categories }
}

/** Когда у сервера нет своих каналов, общий чат живёт без channelId. */
export function localChannels(convId: string): Channel[] {
	return [
		{
			id: `local:${convId}`,
			name: 'общий',
			kind: 'text',
			slug: 'general',
			topic: '',
			categoryId: '',
			position: 0,
			local: true,
		},
	]
}

const EXT_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	bmp: 'image/bmp',
	svg: 'image/svg+xml',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	mkv: 'video/x-matroska',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/opus',
	wav: 'audio/wav',
	m4a: 'audio/mp4',
	flac: 'audio/flac',
	pdf: 'application/pdf',
	zip: 'application/zip',
	rar: 'application/vnd.rar',
	'7z': 'application/x-7z-compressed',
	txt: 'text/plain',
	log: 'text/plain',
	json: 'application/json',
	jar: 'application/java-archive',
	mrpack: 'application/x-modrinth-modpack+zip',
}

export function extensionOf(name: string): string {
	const match = /\.([a-z0-9]+)$/i.exec(name || '')
	return match ? match[1].toLowerCase() : ''
}

/** Расширение важнее того, что сказал проводник: GIF без image/gif сервер отдаст одним кадром. */
export function mimeFor(name: string, given?: string): string {
	const ext = extensionOf(name)
	if (ext === 'gif') return 'image/gif'
	if (name.startsWith('voice_') && ext === 'webm') return 'audio/webm'
	return EXT_MIME[ext] || given || 'application/octet-stream'
}

export function attachmentKind(name: string, mime: string): Attachment['kind'] {
	const lower = mime.toLowerCase()
	if (lower === 'image/gif' || extensionOf(name) === 'gif') return 'gif'
	if (lower.startsWith('image/')) return 'image'
	if (/^voice_/i.test(name)) return 'voice'
	if (lower.startsWith('audio/')) return 'audio'
	if (lower.startsWith('video/')) return 'video'
	return 'file'
}

export function attachmentUrl(messageId: string, token: string): string {
	return `${serviceBase()}/api/messenger/messages/${encodeURIComponent(messageId)}/attachment?token=${encodeURIComponent(token)}`
}

export function mapReactions(raw: unknown, myId: string): Reaction[] {
	if (!Array.isArray(raw)) return []
	const agg = new Map<string, Reaction>()
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const row = entry as LooseRecord
		const emoji = String(row.emoji || '')
		if (!emoji) continue
		const item = agg.get(emoji) || { emoji, count: 0, me: false }
		if (row.userId != null) {
			item.count += 1
			if (String(row.userId) === myId) item.me = true
		} else {
			item.count += Number(row.count) || 0
			if (row.me) item.me = true
		}
		agg.set(emoji, item)
	}
	return [...agg.values()].filter((item) => item.count > 0)
}

export function mapMessage(
	row: LooseRecord,
	opts: { myId: string; token: string; conversationId?: string },
): Msg | null {
	const id = String(row?.id ?? '')
	if (!id) return null
	const reply = row.replyTo as LooseRecord | null | undefined
	// Старые сообщения несли вложения массивом attachments, новые — объектом
	// attachment: без фолбэка такие сообщения рисуются пустыми пузырями.
	const rawAtt =
		(row.attachment as LooseRecord | null | undefined) ??
		(Array.isArray(row.attachments)
			? (row.attachments[0] as LooseRecord | undefined)
			: undefined) ??
		null
	const att = rawAtt && typeof rawAtt === 'object' ? rawAtt : null
	let attachment: Attachment | null = null
	if (att && (att.name || att.url || att.mime)) {
		const name = String(att.name || 'file')
		const mime = mimeFor(name, att.mime ? String(att.mime) : undefined)
		attachment = {
			name,
			size: Number(att.size) || 0,
			mime,
			url: opts.token
				? attachmentUrl(id, opts.token)
				: resolveServiceMedia(att.url ? String(att.url) : ''),
			kind: attachmentKind(name, mime),
		}
	}
	// Сервис подставляет имя файла в body, если текста не было — это не подпись.
	let body = String(row.body || '')
	if (attachment && body.trim() === attachment.name) body = ''
	return {
		id,
		conversationId: String(row.conversationId || opts.conversationId || ''),
		channelId: row.channelId ? String(row.channelId) : '',
		senderId: String(row.senderId ?? ''),
		senderName: String(row.senderUsername || ''),
		body,
		createdAt: Number(row.createdAt) || Date.now(),
		editedAt: Number(row.editedAt) || 0,
		attachment,
		replyTo: reply
			? {
					id: String(reply.id ?? ''),
					senderId: String(reply.senderId ?? ''),
					senderName: String(reply.senderUsername || reply.username || ''),
					body: String(reply.body || ''),
				}
			: null,
		reactions: mapReactions(row.reactions, opts.myId),
		pinned: Boolean(row.pinned),
		kind: String(row.kind || 'text'),
	}
}

export function previewOf(row: LooseRecord): string {
	const body = String(row.body || '').trim()
	if (/^\[\[(?:sticker:\d+|psticker)\]\]$/.test(body)) return '✦ Стикер'
	if (/^\[\[(?:profile|user):[^\]]+\]\]$/.test(body)) return '👤 Профиль'
	if (/^\[\[group:[^\]]+\]\]$/.test(body)) return '👥 Группа'
	if (body) return body
	const name = String(row.attachment?.name || '')
	return name ? `📎 ${name}` : ''
}

/** Сервис отдаёт активность то как build/version, то как buildName/gameVersion. */
export function mapActivity(raw: unknown): Activity | null {
	if (!raw || typeof raw !== 'object') return null
	const row = raw as LooseRecord
	const text = (...keys: string[]) => {
		for (const key of keys) if (row[key]) return String(row[key])
		return ''
	}
	return {
		playing: Boolean(row.playing),
		hosting: Boolean(row.hosting),
		worldShare: Boolean(row.worldShare),
		serverName: text('serverName', 'server'),
		serverHost: text('serverHost'),
		buildName: text('buildName', 'build'),
		gameVersion: text('gameVersion', 'version'),
		loader: text('loader'),
	}
}

const LOADER_NAMES: Record<string, string> = {
	fabric: 'Fabric',
	forge: 'Forge',
	neoforge: 'NeoForge',
	quilt: 'Quilt',
}

/** «Fabric»/«Forge»/«NeoForge»/«Quilt» или исходная строка; без ядра и vanilla — «Vanilla». */
export function loaderName(loader: string | undefined | null): string {
	const key = (loader || '').toLowerCase()
	if (!key || key === 'vanilla') return 'Vanilla'
	return LOADER_NAMES[key] ?? loader!
}

/** Как в Undefined Client: «Сборка · 1.21.1 · Fabric» вместо безликого «Играет в Minecraft». */
export function buildLine(activity: Activity | null | undefined): string {
	if (!activity?.buildName) return ''
	const parts = [activity.buildName]
	if (activity.gameVersion) parts.push(activity.gameVersion)
	const loader = (activity.loader || '').toLowerCase()
	if (loader && loader !== 'vanilla') parts.push(LOADER_NAMES[loader] ?? activity.loader!)
	return parts.join(' · ')
}

export function activityLine(activity: Activity | null | undefined, t: Translate): string {
	if (!activity) return ''
	if (activity.hosting || activity.worldShare) {
		return t('app.messenger.activity.hosting', 'Открыл мир по сети')
	}
	if (!activity.playing) return ''
	const build = buildLine(activity)
	if (build) return activity.serverName ? `${build} · ${activity.serverName}` : build
	return activity.serverName
		? t('app.messenger.activity.server', 'Играет на {name}', { name: activity.serverName })
		: t('app.messenger.activity.playing', 'Играет в Minecraft')
}

export function isInGame(peer: Pick<Peer, 'activity'> | undefined | null): boolean {
	const activity = peer?.activity
	return Boolean(activity && (activity.playing || activity.hosting || activity.worldShare))
}

export function isOnline(
	peer: Pick<Peer, 'bot' | 'presenceStatus' | 'lastSeenAt' | 'activity'> | undefined | null,
): boolean {
	if (!peer) return false
	if (peer.bot) return true
	if (String(peer.presenceStatus || '').toLowerCase() === 'offline') return false
	if (isInGame(peer)) return true
	const seen = Number(peer.lastSeenAt)
	return Number.isFinite(seen) && seen > 0 && Date.now() - seen < ONLINE_MS
}

export type PresenceStatus = 'online' | 'busy' | 'dnd' | 'offline'

export function presenceOf(peer: Peer | null | undefined): PresenceStatus {
	if (!peer || !isOnline(peer)) return 'offline'
	const manual = String(peer.presenceStatus || '').toLowerCase()
	if (manual === 'busy' || manual === 'dnd') return manual
	return 'online'
}

export function formatSize(bytes: number): string {
	if (!bytes || bytes < 0) return ''
	if (bytes < 1024) return `${bytes} Б`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

export function formatTime(ms: number): string {
	const date = new Date(ms)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(ms: number): string {
	const date = new Date(ms)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDuration(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const rest = String(total % 60).padStart(2, '0')
	return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export function sameDay(a: number, b: number): boolean {
	return new Date(a).toDateString() === new Date(b).toDateString()
}

export function readFileBase64(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onerror = () => reject(new Error('read_failed'))
		reader.onload = () => {
			const result = String(reader.result || '')
			const comma = result.indexOf(',')
			resolve(comma < 0 ? '' : result.slice(comma + 1))
		}
		reader.readAsDataURL(file)
	})
}

export function readFileDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onerror = () => reject(new Error('read_failed'))
		reader.onload = () => resolve(String(reader.result || ''))
		reader.readAsDataURL(file)
	})
}

/** Код из ссылки-приглашения или сам код как есть. */
export function inviteCodeFrom(raw: string): string {
	const value = raw.trim()
	if (!value) return ''
	try {
		const url = new URL(value)
		const param = url.searchParams.get('invite') || url.searchParams.get('code')
		if (param) return param
		const parts = url.pathname.split('/').filter(Boolean)
		return parts[parts.length - 1] || ''
	} catch {
		return value.replace(/^.*[/:]/, '')
	}
}
