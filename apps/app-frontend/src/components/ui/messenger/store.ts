import { computed, reactive } from 'vue'

import { getCallState, handleCallSignal, startDmCall } from '@/helpers/messenger-call'
import {
	type AccountState,
	ensureServiceSession,
	forgetServiceSession,
	lastServiceFailure,
	type LooseRecord,
	readAccountState,
	resetServiceFailure,
	resolveAvatar,
	resolveServiceMedia,
	type ServiceFailure,
	serviceRequest,
	type ServiceSession,
	serviceStreamUrl,
} from '@/helpers/uprojects-service'

import { aliasOf, loadAliases } from './aliases'
import { REACTIONS } from './emoji'
import { openLiveStream } from './live-stream'
import {
	attachmentKind,
	type Category,
	type Channel,
	type Conversation,
	isOnline,
	localChannels,
	mapActivity,
	mapChannels,
	mapConversation,
	mapMessage,
	mapPeer,
	type Member,
	type Msg,
	type Peer,
	type PresenceStatus,
	previewOf,
} from './model'
import { noteActivity } from './profile-activity'
import { handleProfileSignal } from './profile-card'
import { handleVoiceEvent, handleVoiceSignal, leaveVoice, resetVoice } from './voice-channel'

export type HomePage = 'friends' | 'worlds' | 'dm'
export type FriendsTab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

export type ThreadState = {
	messages: Msg[]
	loaded: boolean
	loading: boolean
	loadingOlder: boolean
	hasMore: boolean
	detached: boolean
	firstNewId: string
	error: boolean
}

export type Structure = {
	channels: Channel[]
	categories: Category[]
	loaded: boolean
}

export type PendingAttachment = {
	name: string
	mime: string
	size: number
	dataBase64: string
	preview: string
}

const PAGE = 50
const PRESENCE_KEY = 'portalrinth-messenger-presence:'

export const state = reactive({
	account: { kind: 'none' } as AccountState | { kind: 'checking' },
	session: null as ServiceSession | null,
	loading: true,
	failed: false,
	/** Почему не удалось подключиться — от этого зависит текст в окне ошибки. */
	failureReason: null as ServiceFailure | null,
	liveOpen: false,

	conversations: [] as Conversation[],
	friends: [] as Peer[],
	incoming: [] as Peer[],
	outgoing: [] as Peer[],
	blocked: [] as Peer[],
	users: {} as Record<string, Peer>,
	avatars: {} as Record<string, string>,

	section: 'home' as 'home' | 'server',
	homePage: 'friends' as HomePage,
	friendsTab: 'online' as FriendsTab,
	activeServerId: '',
	activeDmId: '',
	serverChannel: {} as Record<string, string>,

	structures: {} as Record<string, Structure>,
	threads: {} as Record<string, ThreadState>,
	channelUnread: {} as Record<string, number>,
	/** Важные непрочитанные на серверах (по threadKey): упоминания, владелец, роли выше моих. */
	important: {} as Record<string, number>,
	typing: {} as Record<string, Record<string, { name: string; at: number }>>,

	myStatus: 'online' as PresenceStatus,
	callTick: 0,
	clock: Date.now(),
	/** Редкий тик для статусов «в сети»: им хватает точности в 15 секунд. */
	presenceClock: Date.now(),
	toast: { text: '', id: 0 },
})

export const myId = computed(() => String(state.session?.user?.id ?? ''))

export const me = computed<Peer | null>(() => {
	const user = state.session?.user
	if (!user?.id) return null
	const known = state.users[String(user.id)]
	return {
		...mapPeer(user as LooseRecord),
		...(known ? { lastSeenAt: known.lastSeenAt } : {}),
		presenceStatus: state.myStatus,
		lastSeenAt: Date.now(),
	}
})

export const servers = computed(() => state.conversations.filter((conv) => !conv.dm))
export const dms = computed(() => state.conversations.filter((conv) => conv.dm))

export const activeConversation = computed<Conversation | null>(() => {
	if (state.section === 'server') {
		return state.conversations.find((conv) => conv.id === state.activeServerId) ?? null
	}
	if (state.homePage === 'dm') {
		return state.conversations.find((conv) => conv.id === state.activeDmId) ?? null
	}
	return null
})

export const activeServer = computed(() =>
	state.section === 'server' ? activeConversation.value : null,
)

export const activeStructure = computed<Structure | null>(() =>
	activeServer.value ? (state.structures[activeServer.value.id] ?? null) : null,
)

export const activeChannel = computed<Channel | null>(() => {
	const server = activeServer.value
	const structure = activeStructure.value
	if (!server || !structure) return null
	const wanted = state.serverChannel[server.id]
	const text = structure.channels.filter((channel) => channel.kind === 'text')
	return text.find((channel) => channel.id === wanted) ?? defaultChannel(structure) ?? null
})

export const activeKey = computed(() => {
	const conv = activeConversation.value
	if (!conv) return ''
	if (conv.dm) return threadKey(conv.id, '')
	const channel = activeChannel.value
	return channel ? threadKey(conv.id, channel.id) : ''
})

export const activeThread = computed<ThreadState | null>(() =>
	activeKey.value ? (state.threads[activeKey.value] ?? null) : null,
)

export const canManage = computed(() => {
	const server = activeServer.value
	if (!server) return false
	return canManageServer(server)
})

export function canManageServer(server: Conversation): boolean {
	if (server.myRole === 'owner' || server.myRole === 'admin') return true
	if (server.createdBy && server.createdBy === myId.value) return true
	const self = server.members.find((member) => member.id === myId.value)
	return self?.role === 'owner' || self?.role === 'admin'
}

export function isOwner(server: Conversation): boolean {
	if (server.myRole === 'owner') return true
	if (server.createdBy && server.createdBy === myId.value) return true
	return server.members.find((member) => member.id === myId.value)?.role === 'owner'
}

export function threadKey(convId: string, channelId: string): string {
	return `${convId}:${channelId}`
}

export function importantIn(convId: string, channelId = ''): number {
	if (channelId) return state.important[threadKey(convId, channelId)] ?? 0
	const prefix = `${convId}:`
	let sum = 0
	for (const [key, count] of Object.entries(state.important)) {
		if (key.startsWith(prefix)) sum += count
	}
	return sum
}

function clearImportant(convId: string, channelId: string): void {
	const key = threadKey(convId, channelId)
	if (state.important[key]) Reflect.deleteProperty(state.important, key)
}

/**
 * Важное в группе: меня упомянули, написал владелец или тот, у кого есть
 * роль, которой нет у меня. Обычные участники без ролей — просто «непрочитано».
 */
function isImportant(conv: Conversation, msg: Msg): boolean {
	const myName = String(state.session?.user?.username || '').toLowerCase()
	if (myName && msg.body.toLowerCase().includes(`@${myName}`)) return true
	if (conv.createdBy && conv.createdBy === msg.senderId) return true
	const sender = conv.members.find((member) => member.id === msg.senderId)
	if (!sender) return false
	if (sender.role === 'owner') return true
	const self = conv.members.find((member) => member.id === myId.value)
	const myRole = self?.role || conv.myRole
	if (sender.role === 'admin' && myRole !== 'admin' && myRole !== 'owner') return true
	const mine = new Set(self?.roleIds ?? [])
	return sender.roleIds.some((id) => !mine.has(id))
}

function defaultChannel(structure: Structure): Channel | undefined {
	const text = structure.channels.filter((channel) => channel.kind === 'text')
	return text.find((channel) => channel.slug === 'general') ?? text[0]
}

/** Канал, в котором лежит сообщение: без channelId — общий чат сервера. */
function channelOfMessage(convId: string, channelId: string): string {
	const structure = state.structures[convId]
	if (channelId) return channelId
	if (!structure) return ''
	return defaultChannel(structure)?.id ?? ''
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(text: string): void {
	state.toast = { text, id: state.toast.id + 1 }
	if (toastTimer) clearTimeout(toastTimer)
	toastTimer = setTimeout(() => {
		state.toast = { text: '', id: state.toast.id }
	}, 3800)
}

let failText = (code: string) => code

export function setFailText(fn: (code: string) => string): void {
	failText = fn
}

function fail(response: { error?: string; code?: string; status: number }): void {
	showToast(failText(String(response.error || response.code || response.status || 'network')))
}

function samePeer(a: Peer, b: Peer): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)])
	for (const key of keys) {
		const left = (a as LooseRecord)[key]
		const right = (b as LooseRecord)[key]
		if (left === right) continue
		if (left && right && typeof left === 'object' && typeof right === 'object') {
			if (JSON.stringify(left) === JSON.stringify(right)) continue
		}
		return false
	}
	return true
}

export function rememberUser(row: LooseRecord | null | undefined): Peer | null {
	if (!row?.id) return null
	const id = String(row.id)
	const next = mapPeer(row)
	const prev = state.users[id]
	const merged: Peer = prev
		? {
				...prev,
				...Object.fromEntries(
					Object.entries(next).filter(
						([, value]) => value !== undefined && value !== '' && value !== null,
					),
				),
				lastSeenAt: Math.max(prev.lastSeenAt, next.lastSeenAt),
				bot: prev.bot || next.bot,
			}
		: next
	if (!merged.username && prev?.username) merged.username = prev.username
	// Без изменений не перезаписываем: иначе каждое обновление списков
	// перерисовывало бы всех участников сервера.
	if (prev && samePeer(prev, merged)) return prev
	state.users[id] = merged
	noteActivity(id, merged.activity)
	return merged
}

const avatarQueued = new Set<string>()
const avatarBroken = new Set<string>()

/** Картинка не открылась — дальше рисуем букву, а не битую иконку. */
export function markAvatarBroken(id: string): void {
	const failed = state.avatars[id] || ''
	const user = state.users[id]
	const key = String(user?.uuid || user?.username || '').replace(/-/g, '')
	// mc-heads местами не открывается — пробуем minotar, и только потом букву.
	if (key && failed.includes('mc-heads')) {
		state.avatars[id] = `https://minotar.net/helm/${encodeURIComponent(key)}/64`
		return
	}
	avatarBroken.add(id)
	Reflect.deleteProperty(state.avatars, id)
}

export async function ensureAvatar(user: Partial<Peer> & { id?: string }): Promise<void> {
	const id = String(user.id || '')
	if (!id || state.avatars[id] || avatarQueued.has(id) || avatarBroken.has(id)) return
	if (!user.uuid && !user.skinUrl && !user.avatar && !user.username) return
	// У бота skinUrl — уже готовая квадратная иконка из настроек, а не лист
	// скина: кроп её ломал, и вместо иконки подставлялась чужая голова по нику.
	if (user.bot || user.provider === 'bot' || id.startsWith('bot:')) {
		const icon = resolveServiceMedia(user.avatar || user.skinUrl)
		if (icon) state.avatars[id] = icon
		else avatarBroken.add(id)
		return
	}
	avatarQueued.add(id)
	try {
		const url = await resolveAvatar({
			skinUrl: user.skinUrl ?? null,
			avatar: user.avatar ?? null,
			uuid: user.uuid,
			username: user.username,
		})
		if (url) state.avatars[id] = url
		else avatarQueued.delete(id)
	} catch {
		avatarQueued.delete(id)
	}
}

export function userOf(id: string): Peer | null {
	return state.users[id] ?? null
}

/** Имя автора: сначала свежая карточка пользователя, потом то, что пришло в сообщении. */
export function nameOf(id: string, fallback = ''): string {
	if (id && id === myId.value) return String(state.session?.user?.username || fallback)
	return state.users[id]?.username || fallback
}

export function memberOf(server: Conversation | null, id: string): Member | null {
	return server?.members.find((member) => member.id === id) ?? null
}

/** Своё имя друга, потом ник на сервере (если задан) — иначе имя игрока. */
export function displayName(id: string, fallback = ''): string {
	const alias = id === myId.value ? '' : aliasOf(id)
	if (alias) return alias
	const member = memberOf(activeServer.value, id)
	if (member?.nickname) return member.nickname
	return nameOf(id, fallback) || member?.username || fallback
}

export function presenceFor(id: string): PresenceStatus {
	if (id === myId.value) return state.myStatus
	void state.presenceClock
	const user = state.users[id]
	if (!user || !isOnline(user)) return 'offline'
	const manual = user.presenceStatus.toLowerCase()
	return manual === 'busy' || manual === 'dnd' ? manual : 'online'
}

export function sharedServers(userId: string): Conversation[] {
	return servers.value.filter((conv) => conv.members.some((member) => member.id === userId))
}

/** Диалоги ЛС, однажды привязанные к пользователю: если сервис не отдал
    peer и участников в списке бесед (или диалог скрыт), по этой памяти
    «Написать» всё равно найдёт чат друга и просто перекинет в него. */
const dmIdsByUser = new Map<string, string>()

function rememberDm(conv: Conversation): void {
	if (!conv.dm) return
	if (conv.peer?.id) dmIdsByUser.set(conv.peer.id, conv.id)
	const others = conv.members.filter((member) => member.id !== myId.value)
	if (others.length === 1 && others[0].id) dmIdsByUser.set(others[0].id, conv.id)
}

export function dmWith(userId: string): Conversation | null {
	const direct = dms.value.find((conv) => conv.peer?.id === userId)
	if (direct) return direct
	// В списке бесед peer бывает пуст: тогда ищем по составу — собеседник
	// один, и это не я. Иначе открытый диалог не находится, и «Написать» у
	// друга упирается в повторный запрос вместо существующего чата.
	const byMembers = dms.value.find((conv) => {
		const others = conv.members.filter((member) => member.id !== myId.value)
		return others.length === 1 && others[0].id === userId
	})
	if (byMembers) return byMembers
	const remembered = dmIdsByUser.get(userId)
	if (!remembered) return null
	return dms.value.find((conv) => conv.id === remembered) ?? null
}

function enc(value: string): string {
	return encodeURIComponent(value)
}

function mapOpts(convId?: string) {
	return { myId: myId.value, token: state.session?.token ?? '', conversationId: convId }
}

function touchThread(key: string): ThreadState {
	if (!state.threads[key]) {
		state.threads[key] = {
			messages: [],
			loaded: false,
			loading: false,
			loadingOlder: false,
			hasMore: true,
			detached: false,
			firstNewId: '',
			error: false,
		}
	}
	return state.threads[key]
}

function rememberMessage(msg: Msg): void {
	if (!msg.senderId) return
	if (!state.users[msg.senderId] && msg.senderName) {
		rememberUser({ id: msg.senderId, username: msg.senderName })
	} else if (state.users[msg.senderId] && !state.users[msg.senderId].username && msg.senderName) {
		state.users[msg.senderId].username = msg.senderName
	}
}

export async function loadLists(): Promise<void> {
	const [chatResponse, friendResponse, blockedResponse] = await Promise.all([
		serviceRequest('/conversations', { query: { limit: 100 } }),
		serviceRequest('/friends'),
		serviceRequest('/users/blocked'),
	])
	if (chatResponse.ok) {
		const raw = chatResponse.data?.conversations ?? chatResponse.data
		const mapped: Conversation[] = []
		for (const row of Array.isArray(raw) ? raw : []) {
			const conv = mapConversation(row)
			if (!conv) continue
			const prev = state.conversations.find((entry) => entry.id === conv.id)
			if (prev && (conv.id === state.activeDmId || conv.id === state.activeServerId)) {
				conv.unread = 0
			}
			if (!conv.members.length && prev?.members.length) conv.members = prev.members
			mapped.push(conv)
			if (conv.peer) rememberUser(row.peer)
			for (const member of Array.isArray(row.members) ? row.members : []) rememberUser(member)
		}
		mapped.sort((a, b) => b.updatedAt - a.updatedAt)
		for (const conv of mapped) rememberDm(conv)
		state.conversations = mapped
	}
	if (friendResponse.ok) {
		const data = friendResponse.data ?? {}
		const list = (rows: unknown): Peer[] =>
			(Array.isArray(rows) ? rows : [])
				.map((row) => rememberUser((row as LooseRecord).user ?? row))
				.filter((peer): peer is Peer => Boolean(peer?.id))
		state.friends = list(data.friends)
		state.incoming = list(data.incoming)
		state.outgoing = list(data.outgoing)
	}
	if (blockedResponse.ok) {
		const rows = blockedResponse.data?.users ?? blockedResponse.data
		state.blocked = (Array.isArray(rows) ? rows : [])
			.map((row: LooseRecord) => rememberUser(row.user ?? row))
			.filter((peer): peer is Peer => Boolean(peer?.id))
	}
}

export async function loadConversation(convId: string): Promise<void> {
	const response = await serviceRequest(`/conversations/${enc(convId)}`)
	if (!response.ok) return
	const raw = response.data?.conversation ?? response.data
	const conv = mapConversation(raw)
	if (!conv) return
	for (const member of Array.isArray(raw.members) ? raw.members : []) rememberUser(member)
	const index = state.conversations.findIndex((entry) => entry.id === conv.id)
	if (index >= 0) {
		const prev = state.conversations[index]
		conv.unread = prev.unread
		if (!conv.updatedAt) conv.updatedAt = prev.updatedAt
		if (!conv.lastPreview) conv.lastPreview = prev.lastPreview
		state.conversations.splice(index, 1, conv)
	} else {
		state.conversations.unshift(conv)
	}
}

export async function loadStructure(convId: string): Promise<void> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/channels`)
	const mapped = response.ok ? mapChannels(response.data) : { channels: [], categories: [] }
	if (!mapped.channels.some((channel) => channel.kind === 'text')) {
		mapped.channels = [...localChannels(convId), ...mapped.channels]
	}
	state.structures[convId] = { ...mapped, loaded: true }
}

export function openHome(page: HomePage = 'friends'): void {
	state.section = 'home'
	state.homePage = page
}

export async function openDm(convId: string): Promise<void> {
	state.section = 'home'
	state.homePage = 'dm'
	state.activeDmId = convId
	await openThread()
}

export async function openServer(convId: string): Promise<void> {
	state.section = 'server'
	state.activeServerId = convId
	const conv = state.conversations.find((entry) => entry.id === convId)
	if (!state.structures[convId]) {
		await loadStructure(convId)
	}
	if (conv && !conv.members.length) void loadConversation(convId)
	await openThread()
	void loadStructure(convId)
}

export async function openChannel(convId: string, channelId: string): Promise<void> {
	state.serverChannel[convId] = channelId
	state.channelUnread[channelId] = 0
	clearImportant(convId, channelId)
	await openThread()
}

async function openThread(): Promise<void> {
	const conv = activeConversation.value
	const key = activeKey.value
	if (!conv || !key) return
	const thread = touchThread(key)
	const unreadBefore = conv.unread
	if (activeChannel.value) {
		state.channelUnread[activeChannel.value.id] = 0
		clearImportant(conv.id, activeChannel.value.id)
	}
	if (!thread.loaded || thread.detached) {
		await fetchLatest(key, unreadBefore)
	}
	markRead(conv)
}

function channelQuery(key: string): { convId: string; channelId: string } {
	const split = key.indexOf(':')
	const convId = key.slice(0, split)
	const channelId = key.slice(split + 1)
	return { convId, channelId: channelId.startsWith('local:') ? '' : channelId }
}

async function fetchLatest(key: string, unread = 0): Promise<void> {
	const thread = touchThread(key)
	const { convId, channelId } = channelQuery(key)
	thread.loading = true
	thread.error = false
	try {
		const response = await serviceRequest(`/conversations/${enc(convId)}/messages`, {
			query: { limit: PAGE, channelId: channelId || undefined },
		})
		if (!response.ok) {
			thread.error = true
			return
		}
		const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
		const list = rows
			.map((row: LooseRecord) => mapMessage(row, mapOpts(convId)))
			.filter((msg: Msg | null): msg is Msg => Boolean(msg))
			.filter((msg: Msg) => belongs(convId, channelId, msg) && !isHiddenForMe(msg.id))
			.sort((a: Msg, b: Msg) => a.createdAt - b.createdAt)
		list.forEach(rememberMessage)
		thread.messages = list
		thread.hasMore = rows.length >= PAGE
		thread.detached = false
		thread.loaded = true
		const foreign = list.filter((msg: Msg) => msg.senderId !== myId.value)
		thread.firstNewId =
			unread > 0 && foreign.length ? foreign[Math.max(0, foreign.length - unread)].id : ''
	} finally {
		thread.loading = false
	}
}

/** Сообщения без channelId принадлежат общему каналу сервера. */
function belongs(convId: string, channelId: string, msg: Msg): boolean {
	const conv = state.conversations.find((entry) => entry.id === convId)
	if (!conv || conv.dm) return true
	if (!channelId) {
		const structure = state.structures[convId]
		const general = structure ? defaultChannel(structure) : undefined
		return !msg.channelId || msg.channelId === general?.id || Boolean(general?.local)
	}
	return msg.channelId === channelId || (!msg.channelId && isGeneral(convId, channelId))
}

function isGeneral(convId: string, channelId: string): boolean {
	const structure = state.structures[convId]
	return Boolean(structure && defaultChannel(structure)?.id === channelId)
}

export async function loadOlder(): Promise<boolean> {
	const key = activeKey.value
	const thread = key ? state.threads[key] : null
	if (!thread || thread.loadingOlder || !thread.hasMore || !thread.messages.length) return false
	const { convId, channelId } = channelQuery(key)
	thread.loadingOlder = true
	try {
		const response = await serviceRequest(`/conversations/${enc(convId)}/messages`, {
			query: {
				limit: PAGE,
				before: thread.messages[0].createdAt,
				channelId: channelId || undefined,
			},
		})
		if (!response.ok) return false
		const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
		const known = new Set(thread.messages.map((msg) => msg.id))
		const older = rows
			.map((row: LooseRecord) => mapMessage(row, mapOpts(convId)))
			.filter((msg: Msg | null): msg is Msg => Boolean(msg) && !known.has(msg!.id))
			.filter((msg: Msg) => belongs(convId, channelId, msg) && !isHiddenForMe(msg.id))
		older.forEach(rememberMessage)
		thread.messages = [...older, ...thread.messages].sort((a, b) => a.createdAt - b.createdAt)
		thread.hasMore = rows.length >= PAGE
		return older.length > 0
	} finally {
		thread.loadingOlder = false
	}
}

/** Переход к сообщению из поиска или закреплённых: если его нет в ленте — грузим историю до него. */
export async function jumpTo(msg: Msg): Promise<void> {
	const key = activeKey.value
	const thread = key ? state.threads[key] : null
	if (!thread || thread.messages.some((entry) => entry.id === msg.id)) return
	const { convId, channelId } = channelQuery(key)
	thread.loading = true
	try {
		const response = await serviceRequest(`/conversations/${enc(convId)}/messages`, {
			query: { limit: PAGE, before: msg.createdAt + 1, channelId: channelId || undefined },
		})
		if (!response.ok) return
		const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
		const list = rows
			.map((row: LooseRecord) => mapMessage(row, mapOpts(convId)))
			.filter((entry: Msg | null): entry is Msg => entry !== null && !isHiddenForMe(entry.id))
			.sort((a: Msg, b: Msg) => a.createdAt - b.createdAt)
		list.forEach(rememberMessage)
		thread.messages = list
		thread.hasMore = rows.length >= PAGE
		thread.detached = true
		thread.firstNewId = ''
	} finally {
		thread.loading = false
	}
}

export async function backToLatest(): Promise<void> {
	if (activeKey.value) await fetchLatest(activeKey.value)
}

let readTimer: ReturnType<typeof setTimeout> | null = null

function markRead(conv: Conversation): void {
	conv.unread = 0
	if (readTimer) clearTimeout(readTimer)
	readTimer = setTimeout(() => {
		void serviceRequest(`/conversations/${enc(conv.id)}/read`, { method: 'POST', body: {} })
	}, 400)
}

function upsert(key: string, msg: Msg): void {
	const thread = state.threads[key]
	if (!thread || isHiddenForMe(msg.id)) return
	const index = thread.messages.findIndex((entry) => entry.id === msg.id)
	if (index >= 0) thread.messages.splice(index, 1, msg)
	else if (!thread.detached) {
		thread.messages.push(msg)
		thread.messages.sort((a, b) => a.createdAt - b.createdAt)
	}
}

function patchEverywhere(id: string, patch: (msg: Msg) => Msg | null): void {
	for (const thread of Object.values(state.threads)) {
		const index = thread.messages.findIndex((entry) => entry.id === id)
		if (index < 0) continue
		const next = patch(thread.messages[index])
		if (next) thread.messages.splice(index, 1, next)
		else thread.messages.splice(index, 1)
	}
}

let pendingSeq = 0

export async function sendMessage(payload: {
	body: string
	replyToId?: string
	attachment?: PendingAttachment | null
	convId?: string
	channelId?: string
}): Promise<boolean> {
	const conv = payload.convId
		? state.conversations.find((entry) => entry.id === payload.convId)
		: activeConversation.value
	if (!conv) return false
	const channel = payload.convId ? payload.channelId || '' : (activeChannel.value?.id ?? '')
	const body: LooseRecord = { body: payload.body }
	if (channel && !channel.startsWith('local:')) body.channelId = channel
	if (payload.replyToId) body.replyToId = payload.replyToId
	if (payload.attachment) {
		body.attachment = {
			name: payload.attachment.name,
			mime: payload.attachment.mime,
			dataBase64: payload.attachment.dataBase64,
		}
	}
	const key = threadKey(conv.id, conv.dm ? '' : channel)
	const draft = optimisticMessage(conv.id, channel, payload)
	if (draft) upsert(key, draft)
	const response = await serviceRequest(`/conversations/${enc(conv.id)}/messages`, {
		method: 'POST',
		body,
	})
	if (draft) patchEverywhere(draft.id, () => null)
	if (!response.ok) {
		fail(response)
		return false
	}
	const sent = response.data?.message ? mapMessage(response.data.message, mapOpts(conv.id)) : null
	if (sent) {
		rememberMessage(sent)
		upsert(key, sent)
		conv.lastPreview = previewOf(response.data.message)
		conv.updatedAt = sent.createdAt
	}
	const thread = state.threads[key]
	if (thread) thread.firstNewId = ''
	sortConversations()
	return true
}

/** Сообщение видно в ленте сразу, пока сервер его принимает. */
function optimisticMessage(
	convId: string,
	channelId: string,
	payload: { body: string; replyToId?: string; attachment?: PendingAttachment | null },
): Msg | null {
	const self = me.value
	if (!self) return null
	const reply = payload.replyToId
		? Object.values(state.threads)
				.flatMap((thread) => thread.messages)
				.find((msg) => msg.id === payload.replyToId)
		: null
	const att = payload.attachment
	pendingSeq += 1
	return {
		id: `pending:${pendingSeq}`,
		conversationId: convId,
		channelId: channelId.startsWith('local:') ? '' : channelId,
		senderId: self.id,
		senderName: self.username,
		body: payload.body,
		createdAt: Date.now(),
		editedAt: 0,
		attachment: att
			? {
					name: att.name,
					size: att.size,
					mime: att.mime,
					url: att.preview || `data:${att.mime};base64,${att.dataBase64}`,
					kind: attachmentKind(att.name, att.mime),
				}
			: null,
		replyTo: reply
			? { id: reply.id, senderId: reply.senderId, senderName: reply.senderName, body: reply.body }
			: null,
		reactions: [],
		pinned: false,
		kind: 'text',
		pending: true,
	}
}

function sortConversations(): void {
	state.conversations.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function editMessage(msg: Msg, text: string): Promise<boolean> {
	const response = await serviceRequest(
		`/conversations/${enc(msg.conversationId || activeConversation.value?.id || '')}/messages/${enc(msg.id)}`,
		{ method: 'PATCH', body: { body: text } },
	)
	if (!response.ok) {
		fail(response)
		return false
	}
	const updated = response.data?.message
	patchEverywhere(msg.id, (entry) => ({
		...entry,
		body: String(updated?.body ?? text),
		editedAt: Number(updated?.editedAt) || Date.now(),
	}))
	return true
}

const HIDDEN_KEY = 'portalrinth-messenger-hidden:'

function hiddenKey(): string {
	return `${HIDDEN_KEY}${myId.value}`
}

function readHidden(): Set<string> {
	try {
		const raw = localStorage.getItem(hiddenKey())
		return new Set(raw ? (JSON.parse(raw) as string[]) : [])
	} catch {
		return new Set()
	}
}

let hiddenIds: Set<string> | null = null

export function isHiddenForMe(id: string): boolean {
	if (!hiddenIds) hiddenIds = readHidden()
	return hiddenIds.has(id)
}

/** «Удалить у меня» — сообщение пропадает только в этом лаунчере. */
export function hideMessageForMe(msg: Msg): void {
	if (!hiddenIds) hiddenIds = readHidden()
	hiddenIds.add(msg.id)
	try {
		localStorage.setItem(hiddenKey(), JSON.stringify([...hiddenIds].slice(-2000)))
	} catch {
		return
	} finally {
		patchEverywhere(msg.id, () => null)
	}
}

export async function deleteMessage(msg: Msg): Promise<boolean> {
	// Сообщение исчезает сразу и навсегда в этом лаунчере: даже если сервис
	// откажет в удалении или почему-то вернёт его в истории, оно уже не
	// покажется — раньше такие «застрявшие» сообщения не удалялись ни «у всех»,
	// ни «у меня». Для сообщений каналов сервису нужен и channelId.
	hideMessageForMe(msg)
	const response = await serviceRequest(
		`/conversations/${enc(msg.conversationId || activeConversation.value?.id || '')}/messages/${enc(msg.id)}`,
		{
			method: 'DELETE',
			query: msg.channelId ? { channelId: msg.channelId } : undefined,
		},
	)
	if (!response.ok)
		showToast(failText(String(response.error || response.code || response.status || 'delete')))
	return response.ok
}

/** Мультивыбор: «у меня» — скрыть все выбранные, «у всех» — удалить те, на которые хватает прав. */
export async function deleteMessagesBulk(
	msgs: Msg[],
	mode: 'me' | 'all',
): Promise<{ done: number; skipped: number }> {
	if (!msgs.length) return { done: 0, skipped: 0 }
	if (mode !== 'all') {
		msgs.forEach((msg) => hideMessageForMe(msg))
		return { done: msgs.length, skipped: 0 }
	}
	let done = 0
	let skipped = 0
	for (const msg of msgs) {
		if (msg.senderId === myId.value || canManage.value) {
			await deleteMessage(msg)
			done += 1
		} else {
			skipped += 1
		}
	}
	return { done, skipped }
}

function flipReaction(reactions: Msg['reactions'], emoji: string, mine: boolean): Msg['reactions'] {
	const next = reactions.map((reaction) => ({ ...reaction }))
	const hit = next.find((reaction) => reaction.emoji === emoji)
	if (hit) {
		if (hit.me !== mine) {
			hit.count += mine ? 1 : -1
			hit.me = mine
		}
	} else if (mine) next.push({ emoji, count: 1, me: true })
	return next.filter((reaction) => reaction.count > 0)
}

/** Повторный клик по своей реакции снимает её — как в оригинале, через DELETE. */
export async function reactMessage(msg: Msg, emoji: string): Promise<void> {
	const convId = msg.conversationId || activeConversation.value?.id || ''
	const fresh = Object.values(state.threads)
		.flatMap((thread) => thread.messages)
		.find((entry) => entry.id === msg.id)
	const current = (fresh ?? msg).reactions.find((reaction) => reaction.emoji === emoji)
	const adding = !current?.me
	if (adding && !REACTIONS.includes(emoji)) return
	patchEverywhere(msg.id, (entry) => ({
		...entry,
		reactions: flipReaction(entry.reactions, emoji, adding),
	}))
	const response = await serviceRequest(
		`/conversations/${enc(convId)}/messages/${enc(msg.id)}/reactions`,
		{ method: adding ? 'POST' : 'DELETE', body: { emoji } },
	)
	if (!response.ok) {
		patchEverywhere(msg.id, (entry) => ({
			...entry,
			reactions: flipReaction(entry.reactions, emoji, !adding),
		}))
		fail(response)
		return
	}
	const updated = response.data?.message ? mapMessage(response.data.message, mapOpts(convId)) : null
	if (updated) patchEverywhere(msg.id, (entry) => ({ ...entry, reactions: updated.reactions }))
}

export async function pinMessage(msg: Msg, pinned: boolean): Promise<boolean> {
	const convId = msg.conversationId || activeConversation.value?.id || ''
	const response = await serviceRequest(
		`/conversations/${enc(convId)}/messages/${enc(msg.id)}/pin`,
		{
			method: 'POST',
			body: { pinned },
		},
	)
	if (!response.ok) {
		fail(response)
		return false
	}
	const value = response.data?.message ? Boolean(response.data.message.pinned) : pinned
	patchEverywhere(msg.id, (entry) => ({ ...entry, pinned: value }))
	return true
}

export async function loadPins(): Promise<Msg[]> {
	const conv = activeConversation.value
	if (!conv) return []
	const channel = activeChannel.value
	const response = await serviceRequest(`/conversations/${enc(conv.id)}/pins`, {
		query: { channelId: channel && !channel.local ? channel.id : undefined },
	})
	if (!response.ok) return []
	const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
	const list = rows
		.map((row: LooseRecord) => mapMessage(row, mapOpts(conv.id)))
		.filter((msg: Msg | null): msg is Msg => Boolean(msg))
	list.forEach(rememberMessage)
	return list.sort((a: Msg, b: Msg) => b.createdAt - a.createdAt)
}

export async function searchMessages(query: string): Promise<Msg[] | null> {
	const conv = activeConversation.value
	if (!conv || !query.trim()) return []
	const channel = activeChannel.value
	const response = await serviceRequest(`/conversations/${enc(conv.id)}/messages/search`, {
		query: { q: query.trim(), channelId: channel && !channel.local ? channel.id : undefined },
	})
	if (!response.ok) {
		fail(response)
		return null
	}
	const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
	const list = rows
		.map((row: LooseRecord) => mapMessage(row, mapOpts(conv.id)))
		.filter((msg: Msg | null): msg is Msg => Boolean(msg))
	list.forEach(rememberMessage)
	return list.sort((a: Msg, b: Msg) => b.createdAt - a.createdAt)
}

export async function forwardMessage(msg: Msg, targets: string[]): Promise<number> {
	let sent = 0
	const author = nameOf(msg.senderId, msg.senderName)
	const quoted = msg.body ? msg.body : msg.attachment?.name || ''
	const body = `↪ ${author}: ${quoted}${msg.attachment && msg.body ? `\n📎 ${msg.attachment.name}` : ''}`
	for (const convId of targets) {
		const response = await serviceRequest(`/conversations/${enc(convId)}/messages`, {
			method: 'POST',
			body: { body },
		})
		if (response.ok) sent += 1
	}
	if (sent < targets.length) showToast(failText('forward'))
	return sent
}

export async function reportMessage(msg: Msg, reason: string): Promise<boolean> {
	const response = await serviceRequest('/reports', {
		method: 'POST',
		body: {
			reason,
			target_type: 'message',
			target_id: msg.id,
			room_id: msg.conversationId || activeConversation.value?.id || null,
		},
	})
	if (!response.ok) fail(response)
	return response.ok
}

let typingSent = 0

export function sendTyping(): void {
	const conv = activeConversation.value
	const now = Date.now()
	if (!conv || now - typingSent < 2500) return
	typingSent = now
	const channel = activeChannel.value
	void serviceRequest(`/conversations/${enc(conv.id)}/typing`, {
		method: 'POST',
		body: channel && !channel.local ? { channelId: channel.id } : {},
	})
}

const noTyping: string[] = []

export const typingNames = computed(() => {
	const key = activeKey.value
	const conv = activeConversation.value
	if (!key || !conv) return noTyping
	const bucket = { ...(state.typing[key] ?? {}), ...(conv.dm ? (state.typing[conv.id] ?? {}) : {}) }
	if (!Object.keys(bucket).length) return noTyping
	// Секундный тик нужен, только пока кто-то печатает, — иначе чат перерисовывался бы каждую секунду.
	void state.clock
	return Object.entries(bucket)
		.filter(([id, row]) => id !== myId.value && Date.now() - row.at < 6000)
		.map(([id, row]) => displayName(id, row.name))
})

export async function startDm(user: {
	id: string
	username?: string
}): Promise<Conversation | null> {
	const existing = dmWith(user.id)
	if (existing) return existing
	const response = await serviceRequest('/conversations/dm', {
		method: 'POST',
		body: { userId: user.id },
	})
	// Сервис может вернуть уже существующий диалог вместе с ошибкой повторного
	// создания: тело с диалогом важнее кода статуса. Иначе «Написать» другу
	// закрывает модалку и ничего не происходит.
	const offered = response.data?.conversation ?? response.data
	if (offered?.id) {
		const conv = mapConversation(offered as LooseRecord)
		if (conv?.dm) {
			if (offered.peer) rememberUser(offered.peer)
			rememberDm(conv)
			if (!state.conversations.some((entry) => entry.id === conv.id))
				state.conversations.unshift(conv)
			return conv
		}
	}
	if (!response.ok) {
		// Диалог мог уже существовать, а сервис отказал в повторном
		// создании: проверяем свежие списки, прежде чем ругаться.
		await loadLists()
		const existing = dmWith(user.id)
		if (existing) return existing
		// Последняя надежда: диалог однажды встречался — спрашиваем его у
		// сервиса напрямую, в списках его может не быть (например, скрыт).
		const remembered = dmIdsByUser.get(user.id)
		if (remembered) {
			const direct = await serviceRequest(`/conversations/${enc(remembered)}`)
			if (direct.ok) {
				const raw = direct.data?.conversation ?? direct.data
				const conv = mapConversation(raw as LooseRecord)
				if (conv?.dm) {
					if (raw?.peer) rememberUser(raw.peer)
					rememberDm(conv)
					if (!state.conversations.some((entry) => entry.id === conv.id))
						state.conversations.unshift(conv)
					return conv
				}
			}
		}
		fail(response)
		return null
	}
	const raw = response.data?.conversation ?? response.data
	const conv = mapConversation(raw)
	if (!conv) {
		await loadLists()
		return dmWith(user.id)
	}
	rememberDm(conv)
	if (raw?.peer) rememberUser(raw.peer)
	if (!state.conversations.some((entry) => entry.id === conv.id)) state.conversations.unshift(conv)
	return state.conversations.find((entry) => entry.id === conv.id) ?? conv
}

export async function writeTo(user: { id: string; username?: string }): Promise<void> {
	const conv = await startDm(user)
	if (conv) await openDm(conv.id)
}

export async function callUser(user: { id: string; username?: string }): Promise<void> {
	if (getCallState().phase !== 'idle') return
	const conv = await startDm(user)
	if (!conv) return
	await openDm(conv.id)
	await startDmCall(conv.id, user.id, user.username || nameOf(user.id))
	state.callTick += 1
}

export async function hideConversation(convId: string): Promise<void> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/hide`, {
		method: 'POST',
		body: {},
	})
	if (!response.ok) {
		fail(response)
		return
	}
	state.conversations = state.conversations.filter((conv) => conv.id !== convId)
	if (state.activeDmId === convId) {
		state.activeDmId = ''
		openHome('friends')
	}
	if (state.activeServerId === convId) {
		state.activeServerId = ''
		openHome('friends')
	}
}

async function friendCall(path: string, method: string, body?: unknown): Promise<boolean> {
	const response = await serviceRequest(path, { method, body })
	if (!response.ok) fail(response)
	await loadLists()
	return response.ok
}

export function requestFriend(id: string): Promise<boolean> {
	return friendCall(`/friends/${enc(id)}/request`, 'POST', {})
}

export function acceptFriend(id: string): Promise<boolean> {
	return friendCall(`/friends/${enc(id)}/accept`, 'POST', {})
}

export function declineFriend(id: string): Promise<boolean> {
	return friendCall(`/friends/${enc(id)}/decline`, 'POST', {})
}

export function removeFriend(id: string): Promise<boolean> {
	return friendCall(`/friends/${enc(id)}`, 'DELETE')
}

export function blockUser(id: string): Promise<boolean> {
	return friendCall(`/users/${enc(id)}/block`, 'POST', {})
}

export function unblockUser(id: string): Promise<boolean> {
	return friendCall(`/users/${enc(id)}/block`, 'DELETE', {})
}

export function relationOf(
	id: string,
): 'self' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none' {
	if (id === myId.value) return 'self'
	if (state.blocked.some((peer) => peer.id === id)) return 'blocked'
	if (state.friends.some((peer) => peer.id === id)) return 'friend'
	if (state.incoming.some((peer) => peer.id === id)) return 'incoming'
	if (state.outgoing.some((peer) => peer.id === id)) return 'outgoing'
	return 'none'
}

export async function searchUsers(query: string, limit = 12): Promise<Peer[]> {
	const response = await serviceRequest('/users/search', { query: { q: query.trim(), limit } })
	if (!response.ok) return []
	const rows = Array.isArray(response.data?.users) ? response.data.users : []
	return rows
		.map((row: LooseRecord) => rememberUser(row))
		.filter((peer: Peer | null): peer is Peer => Boolean(peer))
}

export async function createServer(
	title: string,
	description: string,
	avatarDataUrl: string,
): Promise<Conversation | null> {
	const response = await serviceRequest('/conversations/group', {
		method: 'POST',
		body: { title },
	})
	if (!response.ok) {
		fail(response)
		return null
	}
	const raw = response.data?.conversation ?? response.data
	const id = String(raw?.id ?? '')
	if (!id) return null
	if (description || avatarDataUrl) {
		await serviceRequest(`/conversations/${enc(id)}`, {
			method: 'PATCH',
			body: {
				description: description || undefined,
				avatarDataUrl: avatarDataUrl || undefined,
			},
		})
	}
	await loadLists()
	await loadConversation(id)
	return state.conversations.find((conv) => conv.id === id) ?? null
}

export async function updateServer(convId: string, patch: LooseRecord): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}`, {
		method: 'PATCH',
		body: patch,
	})
	if (!response.ok) {
		fail(response)
		return false
	}
	await loadConversation(convId)
	return true
}

export async function deleteServer(convId: string): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}`, { method: 'DELETE' })
	if (!response.ok) {
		fail(response)
		return false
	}
	dropConversation(convId)
	return true
}

export async function leaveServer(convId: string): Promise<boolean> {
	const response = await serviceRequest(
		`/conversations/${enc(convId)}/members/${enc(myId.value)}`,
		{
			method: 'DELETE',
		},
	)
	if (!response.ok) {
		fail(response)
		return false
	}
	dropConversation(convId)
	return true
}

function dropConversation(convId: string): void {
	state.conversations = state.conversations.filter((conv) => conv.id !== convId)
	if (state.activeServerId === convId) {
		state.activeServerId = ''
		openHome('friends')
	}
}

export async function addMembers(convId: string, ids: string[]): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/members`, {
		method: 'POST',
		body: { memberIds: ids },
	})
	if (!response.ok) fail(response)
	await loadConversation(convId)
	return response.ok
}

/** Вступить в группу/сервер по карточке из чата: сервер добавляет нас самих. */
export async function joinGroupServer(convId: string): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/members`, {
		method: 'POST',
		body: { memberIds: [myId.value] },
	})
	if (!response.ok) fail(response)
	await loadLists()
	if (response.ok) await loadConversation(convId)
	return response.ok
}

export async function kickMember(convId: string, userId: string): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/members/${enc(userId)}`, {
		method: 'DELETE',
	})
	if (!response.ok) fail(response)
	await loadConversation(convId)
	return response.ok
}

export async function saveChannel(
	convId: string,
	channelId: string | null,
	body: { name: string; topic?: string; kind?: 'text' | 'voice'; categoryId?: string | null },
): Promise<boolean> {
	const path = channelId
		? `/conversations/${enc(convId)}/channels/${enc(channelId)}`
		: `/conversations/${enc(convId)}/channels`
	const payload: LooseRecord = { name: body.name, topic: body.topic ?? '' }
	if (!channelId) payload.kind = body.kind ?? 'text'
	if (body.categoryId !== undefined)
		payload.categoryId = body.categoryId || (channelId ? null : undefined)
	const response = await serviceRequest(path, {
		method: channelId ? 'PATCH' : 'POST',
		body: payload,
	})
	if (!response.ok) {
		fail(response)
		return false
	}
	await loadStructure(convId)
	const created = response.data?.channel?.id
	if (created && (body.kind ?? 'text') === 'text') await openChannel(convId, String(created))
	return true
}

export async function deleteChannel(convId: string, channelId: string): Promise<boolean> {
	const response = await serviceRequest(
		`/conversations/${enc(convId)}/channels/${enc(channelId)}`,
		{
			method: 'DELETE',
		},
	)
	if (!response.ok) {
		fail(response)
		return false
	}
	if (state.serverChannel[convId] === channelId) Reflect.deleteProperty(state.serverChannel, convId)
	await loadStructure(convId)
	await openThread()
	return true
}

export async function saveCategory(
	convId: string,
	categoryId: string | null,
	name: string,
): Promise<boolean> {
	const path = categoryId
		? `/conversations/${enc(convId)}/categories/${enc(categoryId)}`
		: `/conversations/${enc(convId)}/categories`
	const response = await serviceRequest(path, {
		method: categoryId ? 'PATCH' : 'POST',
		body: { name },
	})
	if (!response.ok) {
		fail(response)
		return false
	}
	await loadStructure(convId)
	return true
}

export async function deleteCategory(convId: string, categoryId: string): Promise<boolean> {
	const response = await serviceRequest(
		`/conversations/${enc(convId)}/categories/${enc(categoryId)}`,
		{
			method: 'DELETE',
		},
	)
	if (!response.ok) {
		fail(response)
		return false
	}
	await loadStructure(convId)
	return true
}

export type Invite = {
	token: string
	uses: number
	maxUses: number
	expiresAt: number
	link: string
}

function mapInvite(row: LooseRecord, link = ''): Invite {
	return {
		token: String(row.token || row.code || ''),
		uses: Number(row.uses) || 0,
		maxUses: Number(row.maxUses) || 0,
		expiresAt: Number(row.expiresAt) || 0,
		link: String(link || row.deepLink || row.url || ''),
	}
}

export async function listInvites(convId: string): Promise<Invite[] | null> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/invites`)
	if (!response.ok) return null
	const rows = Array.isArray(response.data?.invites) ? response.data.invites : []
	return rows.map((row: LooseRecord) => mapInvite(row)).filter((invite: Invite) => invite.token)
}

export async function createInvite(
	convId: string,
	expiresInMs: number,
	maxUses: number,
): Promise<Invite | null> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/invites`, {
		method: 'POST',
		body: {
			expiresAt: expiresInMs ? Date.now() + expiresInMs : null,
			maxUses: maxUses || null,
		},
	})
	if (!response.ok) {
		fail(response)
		return null
	}
	const data = response.data ?? {}
	const invite = mapInvite(data.invite ?? data, String(data.deepLink || data.url || ''))
	return invite.token ? invite : null
}

export async function deleteInvite(convId: string, token: string): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/invites/${enc(token)}`, {
		method: 'DELETE',
	})
	if (!response.ok) fail(response)
	return response.ok
}

export async function previewInvite(code: string): Promise<LooseRecord | null> {
	const response = await serviceRequest(`/invites/${enc(code)}`)
	return response.ok ? (response.data ?? {}) : null
}

export async function joinInvite(code: string): Promise<Conversation | null> {
	const response = await serviceRequest(`/invites/${enc(code)}/join`, { method: 'POST', body: {} })
	if (!response.ok) {
		fail(response)
		return null
	}
	const id = String(response.data?.conversation?.id ?? response.data?.conversationId ?? '')
	await loadLists()
	if (id) await loadConversation(id)
	return state.conversations.find((conv) => conv.id === id) ?? null
}

export async function createRole(convId: string, name: string, color: string): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/roles`, {
		method: 'POST',
		body: { name, color },
	})
	if (!response.ok) fail(response)
	await loadConversation(convId)
	return response.ok
}

export async function deleteRole(convId: string, roleId: string): Promise<boolean> {
	const response = await serviceRequest(`/conversations/${enc(convId)}/roles/${enc(roleId)}`, {
		method: 'DELETE',
	})
	if (!response.ok) fail(response)
	await loadConversation(convId)
	return response.ok
}

export async function toggleMemberRole(
	convId: string,
	userId: string,
	roleId: string,
	on: boolean,
): Promise<boolean> {
	const response = on
		? await serviceRequest(`/conversations/${enc(convId)}/members/${enc(userId)}/roles`, {
				method: 'POST',
				body: { roleId },
			})
		: await serviceRequest(
				`/conversations/${enc(convId)}/members/${enc(userId)}/roles/${enc(roleId)}`,
				{
					method: 'DELETE',
				},
			)
	if (!response.ok) fail(response)
	await loadConversation(convId)
	return response.ok
}

function presenceKey(): string {
	return PRESENCE_KEY + (state.session?.accountKey ?? '')
}

export async function setPresence(status: PresenceStatus): Promise<void> {
	const previous = state.myStatus
	state.myStatus = status
	try {
		localStorage.setItem(presenceKey(), status)
	} catch {
		/* без хранилища статус просто не переживёт перезапуск */
	}
	const response = await serviceRequest('/presence', { method: 'POST', body: { status } })
	if (!response.ok) {
		state.myStatus = previous
		fail(response)
	}
}

let closeStream: (() => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
const structureTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleReload(): void {
	if (reloadTimer) return
	reloadTimer = setTimeout(() => {
		reloadTimer = null
		void loadLists().then(flushStrayIncoming)
	}, 500)
}

function scheduleStructure(convId: string): void {
	if (structureTimers.has(convId)) return
	structureTimers.set(
		convId,
		setTimeout(() => {
			structureTimers.delete(convId)
			if (state.structures[convId]) void loadStructure(convId)
			void loadConversation(convId)
		}, 400),
	)
}

export const pageVisible = { value: true }

type IncomingListener = (msg: Msg, conv: Conversation) => void

const incomingListeners = new Set<IncomingListener>()

/** Новое чужое сообщение не в открытом сейчас чате — для всплывающих уведомлений. */
const strayIncoming: { convId: string; msg: Msg }[] = []

function flushStrayIncoming(): void {
	for (const { convId, msg } of strayIncoming.splice(0)) {
		const conv = state.conversations.find((entry) => entry.id === convId)
		if (!conv || isHiddenForMe(msg.id)) continue
		for (const listener of incomingListeners) listener(msg, conv)
	}
}

export function onIncomingMessage(listener: IncomingListener): () => void {
	incomingListeners.add(listener)
	return () => incomingListeners.delete(listener)
}

function onLiveMessage(data: LooseRecord): void {
	const convId = String(data.conversationId || data.message?.conversationId || '')
	const msg = mapMessage(data.message, mapOpts(convId))
	if (!msg || !convId) return
	rememberMessage(msg)
	const conv = state.conversations.find((entry) => entry.id === convId)
	if (!conv) {
		// Новый чат (первое сообщение от человека) — сначала подтянем список,
		// а уведомление покажем, когда чат в нём появится.
		if (msg.senderId !== myId.value) strayIncoming.push({ convId, msg })
		scheduleReload()
		return
	}
	const mine = msg.senderId === myId.value
	const channelId = conv.dm ? '' : channelOfMessage(convId, msg.channelId)
	const key = threadKey(convId, channelId)
	const active = key === activeKey.value && pageVisible.value
	const thread = state.threads[key]
	if (thread) {
		const isNew = !thread.messages.some((entry) => entry.id === msg.id)
		upsert(key, msg)
		if (isNew && !mine && !thread.firstNewId && !active) thread.firstNewId = msg.id
	}
	conv.lastPreview = previewOf(data.message)
	conv.updatedAt = msg.createdAt
	// Открытый чат в свёрнутом или неактивном окне тоже уведомляет.
	if (!mine && !(active && document.hasFocus()) && !isHiddenForMe(msg.id)) {
		for (const listener of incomingListeners) listener(msg, conv)
	}
	if (state.typing[key]) Reflect.deleteProperty(state.typing[key], msg.senderId)
	if (state.typing[convId]) Reflect.deleteProperty(state.typing[convId], msg.senderId)
	if (!mine) {
		if (active) markRead(conv)
		else {
			conv.unread += 1
			if (channelId) state.channelUnread[channelId] = (state.channelUnread[channelId] ?? 0) + 1
			if (!conv.dm && isImportant(conv, msg)) {
				state.important[key] = (state.important[key] ?? 0) + 1
			}
		}
	}
	sortConversations()
}

/** Событие говорит, через какой аккаунт оно пришло: чужой не трогаем. */
function providerMatches(userId: string, provider: unknown): boolean {
	if (!provider) return true
	const known = state.users[userId]?.provider
	return !known || String(known).toLowerCase() === String(provider).toLowerCase()
}

function setPresenceOf(userId: string, patch: Partial<Peer>): void {
	const user = state.users[userId]
	if (user) state.users[userId] = { ...user, ...patch }
	for (const list of [state.friends, state.incoming, state.outgoing]) {
		const index = list.findIndex((peer) => peer.id === userId)
		if (index >= 0) list.splice(index, 1, { ...list[index], ...patch })
	}
	noteActivity(userId, state.users[userId]?.activity ?? null)
	for (const conv of state.conversations) {
		if (conv.peer?.id === userId) conv.peer = { ...conv.peer, ...patch }
		const index = conv.members.findIndex((member) => member.id === userId)
		if (index >= 0) conv.members.splice(index, 1, { ...conv.members[index], ...patch })
	}
}

export function handleLive(name: string, data: LooseRecord): void {
	if (!data || typeof data !== 'object') return
	switch (name) {
		case 'message':
			if (data.message) onLiveMessage(data)
			return
		case 'message_edited':
			if (data.message?.id) {
				const convId = String(data.conversationId || data.message.conversationId || '')
				const msg = mapMessage(data.message, mapOpts(convId))
				patchEverywhere(String(data.message.id), (entry) => ({
					...entry,
					body: String(data.message.body ?? entry.body),
					editedAt: Number(data.message.editedAt) || Date.now(),
					reactions: msg?.reactions.length ? msg.reactions : entry.reactions,
					pinned: data.message.pinned === undefined ? entry.pinned : Boolean(data.message.pinned),
				}))
			}
			return
		case 'message_deleted':
			if (data.message?.id || data.messageId) {
				patchEverywhere(String(data.message?.id ?? data.messageId), () => null)
			}
			return
		case 'reaction':
			if (data.message?.id) {
				const msg = mapMessage(data.message, mapOpts(String(data.conversationId || '')))
				if (msg) patchEverywhere(msg.id, (entry) => ({ ...entry, reactions: msg.reactions }))
			}
			return
		case 'presence':
			if (data.userId && providerMatches(String(data.userId), data.provider)) {
				setPresenceOf(String(data.userId), {
					lastSeenAt: Number(data.lastSeenAt) || Date.now(),
					presenceStatus: String(data.presenceStatus || ''),
				})
			}
			return
		case 'activity':
			if (data.userId && providerMatches(String(data.userId), data.provider)) {
				setPresenceOf(String(data.userId), {
					activity: mapActivity(data.activity),
					lastSeenAt: Date.now(),
				})
			}
			return
		case 'typing': {
			const userId = String(data.userId || '')
			const convId = String(data.conversationId || '')
			if (!userId || userId === myId.value || !convId) return
			const conv = state.conversations.find((entry) => entry.id === convId)
			const key =
				conv && !conv.dm
					? threadKey(convId, channelOfMessage(convId, String(data.channelId || '')))
					: threadKey(convId, '')
			state.typing[key] = {
				...(state.typing[key] ?? {}),
				[userId]: { name: String(data.username || nameOf(userId)), at: Date.now() },
			}
			return
		}
		case 'read':
			if (data.conversationId && String(data.userId ?? '') === myId.value) {
				const conv = state.conversations.find((entry) => entry.id === String(data.conversationId))
				if (conv) conv.unread = 0
			}
			return
		case 'signal':
			if (handleWorldShareSignal(data)) return
			if (handleProfileSignal(data)) return
			if (String(data.type || '').startsWith('vc_')) {
				void handleVoiceSignal(data)
				return
			}
			void handleCallSignal(data as Parameters<typeof handleCallSignal>[0]).finally(() => {
				state.callTick += 1
			})
			state.callTick += 1
			return
		case 'voice':
			void handleVoiceEvent(data)
			return
		case 'voice_mod':
			if (String(data.userId ?? '') === myId.value && data.action === 'disconnect')
				void leaveVoice()
			return
		case 'channels':
		case 'conversation_updated':
		case 'member_changed':
			if (data.conversationId) scheduleStructure(String(data.conversationId))
			scheduleReload()
			return
		case 'conversation':
		case 'friend':
			scheduleReload()
			return
	}
}

let pulseTick = 0

function pruneTyping(now: number): void {
	for (const [key, bucket] of Object.entries(state.typing)) {
		const stale = Object.keys(bucket).filter((id) => now - bucket[id].at >= 6000)
		if (!stale.length) continue
		if (stale.length === Object.keys(bucket).length) Reflect.deleteProperty(state.typing, key)
		else for (const id of stale) Reflect.deleteProperty(bucket, id)
	}
}

function startLive(token: string): void {
	stopLive()
	closeStream = openLiveStream(serviceStreamUrl(token), handleLive, (open) => {
		const reopened = open && !state.liveOpen
		state.liveOpen = open
		if (reopened) void catchUp()
	})
	pollTimer = setInterval(() => void pulse(), 4000)
	clockTimer = setInterval(() => {
		const now = Date.now()
		state.clock = now
		if (now - state.presenceClock >= 15000) state.presenceClock = now
		pruneTyping(now)
	}, 1000)
}

export function stopLive(): void {
	closeStream?.()
	closeStream = null
	if (pollTimer) clearInterval(pollTimer)
	if (clockTimer) clearInterval(clockTimer)
	if (reloadTimer) clearTimeout(reloadTimer)
	pollTimer = null
	clockTimer = null
	reloadTimer = null
	state.liveOpen = false
}

let lastCatchUp = 0

/** После обрыва потока забираем то, что успело прийти, пока его не было. */
async function catchUp(): Promise<void> {
	if (!state.session) return
	// Частые переподключения не должны каждый раз заново тянуть все списки.
	if (Date.now() - lastCatchUp < 15000) return
	lastCatchUp = Date.now()
	await loadLists()
	await refreshActiveThread()
}

/**
 * Страховка на случай, если поток молчит или оборвался: без потока
 * открытый чат сверяем каждые 4 секунды, с потоком — раз в 20.
 */
async function pulse(): Promise<void> {
	if (!state.session) return
	pulseTick += 1
	const live = state.liveOpen
	if (pulseTick % (live ? 15 : 2) === 0) await loadLists()
	if (live && pulseTick % 5 !== 0) return
	await refreshActiveThread()
}

async function refreshActiveThread(): Promise<void> {
	const key = activeKey.value
	const thread = key ? state.threads[key] : null
	if (!thread || thread.detached || !thread.loaded || !pageVisible.value) return
	const { convId, channelId } = channelQuery(key)
	const response = await serviceRequest(`/conversations/${enc(convId)}/messages`, {
		query: { limit: 20, channelId: channelId || undefined },
	})
	if (!response.ok || activeKey.value !== key) return
	const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
	for (const row of rows) {
		const msg = mapMessage(row, mapOpts(convId))
		if (msg && belongs(convId, channelId, msg)) {
			rememberMessage(msg)
			upsert(key, msg)
		}
	}
}

let activityPayload: LooseRecord = { playing: false }
let activityTimer: ReturnType<typeof setInterval> | null = null

/** Что видят друзья: «Играет в …» держится, пока лаунчер шлёт это раз в 45 секунд.
    Поля шаринга мира не обнуляются, когда игра закрыта: запущенный свой сервер
    (Self-Hosted) должен оставаться видимым, пока лаунчер работает. */
export function setActivity(payload: LooseRecord | null): void {
	const sharing = Boolean(payload && (payload.worldShare || payload.hosting))
	activityPayload =
		payload?.playing || sharing
			? {
					...payload,
					playing: Boolean(payload?.playing),
					hosting: Boolean(payload?.hosting),
					worldShare: Boolean(payload?.worldShare),
				}
			: { playing: false, hosting: false, worldShare: false }
	if (activityTimer) clearInterval(activityTimer)
	activityTimer = null
	void postActivity()
	if (activityPayload.playing) activityTimer = setInterval(() => void postActivity(), 45000)
}

async function postActivity(): Promise<void> {
	if (!state.session) return
	await serviceRequest('/activity', { method: 'POST', body: activityPayload }).catch(() => null)
	const id = myId.value
	if (id && state.users[id]) {
		noteActivity(id, activityPayload.playing ? mapActivity(activityPayload) : null)
		state.users[id] = {
			...state.users[id],
			activity: activityPayload.playing ? mapActivity(activityPayload) : null,
		}
	}
	broadcastWorldShare()
}

/* ─── Миры по сети: гарантированная доставка через сигналы ───
    Канал activity сервиса может отбрасывать наши поля (worldShare/serverHost),
    поэтому состояние мира дублируется личным сигналом «call_ice» — тем же
    способом, каким ходят карточки профилей и звонки: сервис передаёт его
    дословно и не знает о наших полях. Раздача отправляется друзьям при её
    изменении, а свежая — по запросу (кто открыл «Миры по сети», тот и просит). */

const WORLD_FRIENDS_LIMIT = 40
const WORLD_REPLY_GAP = 15000

let lastShareSent: string | null = null
let lastWorldRequest = 0
const shareReplied = new Map<string, number>()

function shareKey(): string {
	const payload = activityPayload || {}
	return JSON.stringify([
		Boolean(payload.playing),
		Boolean(payload.hosting),
		Boolean(payload.worldShare),
		String(payload.serverName || ''),
		String(payload.serverHost || ''),
		String(payload.buildName || ''),
		String(payload.gameVersion || ''),
		String(payload.loader || ''),
	])
}

async function worldSignal(friendId: string, candidate: LooseRecord): Promise<void> {
	const conv = dmWith(friendId)
	if (!conv) return
	await serviceRequest(`/conversations/${enc(conv.id)}/signals`, {
		method: 'POST',
		body: {
			type: 'call_ice',
			channelId: null,
			sdp: null,
			toUserId: friendId,
			candidate,
		},
	}).catch(() => null)
}

/** Друзьям с личным чатом уходит текущее состояние мира — при каждом изменении. */
function broadcastWorldShare(): void {
	if (!state.session) return
	const key = shareKey()
	if (key === lastShareSent) return
	lastShareSent = key
	const friendIds = state.friends
		.filter((friend) => dmWith(friend.id))
		.slice(0, WORLD_FRIENDS_LIMIT)
		.map((friend) => friend.id)
	for (const friendId of friendIds) {
		void worldSignal(friendId, { portalrinth: 'world_share', activity: activityPayload })
	}
}

/** Открыли «Миры по сети» — просим друзей прислать их свежие миры (раз в 20с). */
export function requestWorldShares(): void {
	if (!state.session) return
	const now = Date.now()
	if (now - lastWorldRequest < 20000) return
	lastWorldRequest = now
	const friendIds = state.friends
		.filter((friend) => dmWith(friend.id))
		.slice(0, WORLD_FRIENDS_LIMIT)
		.map((friend) => friend.id)
	for (const friendId of friendIds) {
		void worldSignal(friendId, { portalrinth: 'world_share_req' })
	}
}

/** true — пакет наш и обработан, дальше по цепочке звонков его не передаём. */
export function handleWorldShareSignal(data: LooseRecord): boolean {
	if (data.type !== 'call_ice') return false
	const raw = data.candidate
	const candidate: LooseRecord | null = (() => {
		if (raw && typeof raw === 'object') return raw as LooseRecord
		if (typeof raw !== 'string' || !raw.startsWith('{')) return null
		try {
			return JSON.parse(raw) as LooseRecord
		} catch {
			return null
		}
	})()
	const kind = String(candidate?.portalrinth ?? '')
	if (kind !== 'world_share' && kind !== 'world_share_req') return false
	const from = String(data.fromUserId ?? '')
	if (!from || from === myId.value) return true
	if (kind === 'world_share') {
		const activity = candidate?.activity
		setPresenceOf(from, {
			activity: activity && typeof activity === 'object' ? mapActivity(activity) : null,
			lastSeenAt: Date.now(),
		})
		return true
	}
	// Просьба прислать мир: отвечаем только с актуальной раздачей и не чаще
	// раза в 15 секунд на друга, чтобы открытые у всех «Миры» не плодили трафик.
	if (!activityPayload?.playing || (!activityPayload.worldShare && !activityPayload.hosting)) {
		return true
	}
	const now = Date.now()
	if (now - (shareReplied.get(from) ?? 0) < WORLD_REPLY_GAP) return true
	shareReplied.set(from, now)
	void worldSignal(from, { portalrinth: 'world_share', activity: activityPayload })
	return true
}

export function resetState(): void {
	stopLive()
	lastShareSent = null
	state.session = null
	state.conversations = []
	state.friends = []
	state.incoming = []
	state.outgoing = []
	state.blocked = []
	state.users = {}
	state.avatars = {}
	state.structures = {}
	state.threads = {}
	state.channelUnread = {}
	state.important = {}
	state.typing = {}
	resetVoice()
	state.serverChannel = {}
	state.activeDmId = ''
	state.activeServerId = ''
	state.section = 'home'
	state.homePage = 'friends'
	avatarQueued.clear()
	avatarBroken.clear()
}

let connectSeq = 0

let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let reconnectRefused = false

/**
 * Провалившийся вход в сервис сами пробуем снова с бэкоффом: сеть к сервису
 * дышит перебоями, и после краткого сбоя (или включённого VPN/прокси)
 * мессенджер поднимается сам — без перезапуска лаунчера и без нажатия
 * «Повторить». Причины, где нужен сам игрок (вход заново, нет аккаунта),
 * из автоповтора исключены; после пяти отказов по лимиту частоты не
 * дёргаем сервис вовсе — там нужна пауза, а не упорство.
 */
function scheduleReconnect(reason: ServiceFailure | null): void {
	if (reconnectRefused) return
	if (reason === 'auth' || reason === 'no_account') return
	if (reason === 'rate_limited' && reconnectAttempt >= 5) {
		reconnectRefused = true
		return
	}
	const delay =
		reason === 'rate_limited' || reconnectAttempt >= 3
			? 60000
			: ([5000, 15000, 45000][reconnectAttempt] ?? 60000)
	reconnectAttempt += 1
	if (reconnectTimer) clearTimeout(reconnectTimer)
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null
		void connect(true)
	}, delay)
}

/** Вход удался — автоповтор больше не нужен. */
function resetReconnect(): void {
	reconnectAttempt = 0
	reconnectRefused = false
	if (reconnectTimer) clearTimeout(reconnectTimer)
	reconnectTimer = null
}

export async function connect(force = false): Promise<void> {
	const seq = ++connectSeq
	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}
	state.loading = true
	state.failed = false
	state.failureReason = null
	resetServiceFailure()
	try {
		const account = await readAccountState()
		if (seq !== connectSeq) return
		state.account = account
		if (account.kind !== 'ready') {
			resetState()
			return
		}
		const session = await ensureServiceSession(force)
		if (seq !== connectSeq) return
		if (!session) {
			resetState()
			state.failed = true
			state.failureReason = lastServiceFailure() ?? 'network'
			scheduleReconnect(state.failureReason)
			return
		}
		if (state.session && state.session.accountKey !== session.accountKey) resetState()
		state.session = session
		loadAliases(String(session.user?.id ?? ''))
		rememberUser(session.user as LooseRecord)
		try {
			const saved = localStorage.getItem(presenceKey()) as PresenceStatus | null
			state.myStatus =
				saved && ['online', 'busy', 'dnd', 'offline'].includes(saved) ? saved : 'online'
		} catch {
			state.myStatus = 'online'
		}
		void serviceRequest('/presence', { method: 'POST', body: { status: state.myStatus } })
		await loadLists()
		if (seq !== connectSeq) return
		startLive(session.token)
		resetReconnect()
		if (activityPayload.playing) void postActivity()
		if (state.section === 'server' && state.activeServerId) await openServer(state.activeServerId)
		else if (state.homePage === 'dm' && state.activeDmId) await openDm(state.activeDmId)
	} catch {
		state.failed = true
		state.failureReason = lastServiceFailure() ?? 'network'
		scheduleReconnect(state.failureReason)
	} finally {
		if (seq === connectSeq) state.loading = false
	}
}

export async function signOut(): Promise<void> {
	forgetServiceSession()
	resetState()
	resetReconnect()
	await connect(true)
}
