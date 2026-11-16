<script setup lang="ts">
import {
	CheckIcon,
	ChevronRightIcon,
	CopyIcon,
	GlobeIcon,
	HomeIcon,
	ImageIcon,
	MailIcon,
	MessageIcon,
	MicrophoneIcon,
	MoreVerticalIcon,
	PinIcon,
	PlusIcon,
	RefreshCwIcon,
	ReplyIcon,
	SearchIcon,
	SendIcon,
	SmartphoneIcon,
	SmileIcon,
	TrashIcon,
	UserIcon,
	UserPlusIcon,
	UsersIcon,
	VideoIcon,
	XIcon,
} from '@modrinth/assets'
import { Button, useVIntl } from '@modrinth/ui'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'

import UserProfileModal from '@/components/ui/messenger/UserProfileModal.vue'
import {
	acceptIncoming,
	declineIncoming,
	getCallState,
	handleCallSignal,
	hangupCall,
	initMessengerCall,
	startDmCall,
	toggleCallMute,
} from '@/helpers/messenger-call'
import {
	ensureServiceSession,
	forgetServiceSession,
	type LooseRecord,
	resolveAvatar,
	resolveServiceMedia,
	serviceRequest,
	type ServiceSession,
	serviceStreamUrl,
} from '@/helpers/uprojects-service'
import { useRootBreadcrumb } from '@/shared/breadcrumbs'

defineOptions({ name: 'MessengerPage' })

const { formatMessage } = useVIntl()
const messages = { heading: { id: 'app.messenger.heading', defaultMessage: 'MC Messenger' } }

const breadcrumb = useRootBreadcrumb({
	slot: 'root',
	id: 'messenger',
	label: () => formatMessage(messages.heading),
	to: '/messenger',
	visual: { type: 'icon', component: MessageIcon },
})

/** Короткая локализация: id + русский текст по умолчанию. */
function t(id: string, fallback: string, values?: Record<string, unknown>): string {
	return formatMessage({ id, defaultMessage: fallback }, values as never)
}

// ===== Типы =====

type Activity = {
	playing?: boolean
	hosting?: boolean
	worldShare?: boolean
	serverName?: string
	serverHost?: string
	buildName?: string
	gameVersion?: string
}

type Peer = {
	id: string
	username: string
	uuid?: string
	skinUrl?: string | null
	avatar?: string | null
	lastSeenAt?: number
	presenceStatus?: string
	activity?: Activity | null
	bot?: boolean
}

type Conversation = {
	id: string
	dm: boolean
	title: string
	peer?: Peer
	avatarUrl: string
	unread: number
	updatedAt: number
	lastPreview: string
	memberCount: number
	memberIds: string[]
}

type Reaction = { emoji: string; count: number; me: boolean }

type Msg = {
	id: string
	senderId: string
	senderName: string
	body: string
	createdAt: number
	attachmentUrl: string
	attachmentName?: string
	replyTo?: { id: string; senderName: string; body: string } | null
	reactions: Reaction[]
	pinned?: boolean
	mine: boolean
}

// ===== Состояние =====

const session = ref<ServiceSession | null>(null)
const loading = ref(true)
const loadError = ref('')

const conversations = ref<Conversation[]>([])
const friends = ref<Peer[]>([])
const incoming = ref<Peer[]>([])
const outgoing = ref<Peer[]>([])
const blocked = ref<Peer[]>([])

const activeId = ref('')
const thread = ref<Msg[]>([])
const threadLoading = ref(false)
const firstNewId = ref('')

const mainView = ref<'chat' | 'friends'>('chat')
const friendsTab = ref<'online' | 'all' | 'pending' | 'blocked'>('all')
const worldsOpen = ref(false)

const searchQuery = ref('')
const searchResults = ref<LooseRecord[]>([])
const searching = ref(false)
const searchTimer = ref<ReturnType<typeof setTimeout> | null>(null)

const chatSearchOpen = ref(false)
const chatSearchQuery = ref('')

const draft = ref('')
const replyTo = ref<Msg | null>(null)
const sending = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const pinnedOpen = ref(false)
const pinnedMessages = ref<Msg[]>([])

const forwardMsg = ref<Msg | null>(null)
const emojiOpen = ref(false)

const typingPeers = ref<Map<string, number>>(new Map())

const menu = ref<{ x: number; y: number; msg: Msg } | null>(null)

const menuStyle = computed(() => {
	if (!menu.value) return {}
	const maxX = window.innerWidth - 250
	const maxY = window.innerHeight - 380
	return {
		left: `${Math.max(8, Math.min(menu.value.x, maxX))}px`,
		top: `${Math.max(8, Math.min(menu.value.y, maxY))}px`,
	}
})
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const avatars = ref<Record<string, string>>({})
const refreshing = ref(false)
const threadEl = ref<HTMLElement | null>(null)
const callTick = ref(0)

const myId = computed(() => String(session.value?.user?.id ?? ''))

const callState = computed(() => {
	void callTick.value
	return getCallState()
})

function showToast(text: string) {
	toast.value = text
	if (toastTimer) clearTimeout(toastTimer)
	toastTimer = setTimeout(() => {
		toast.value = ''
	}, 4000)
}

// ===== Аватары =====

async function loadAvatar(key: string, user: LooseRecord): Promise<void> {
	if (!key || avatars.value[key]) return
	const url = await resolveAvatar({
		skinUrl: user.skinUrl ?? null,
		avatar: user.avatar ?? null,
		uuid: user.uuid,
		username: user.username || user.name,
		name: user.name,
	})
	if (url) avatars.value = { ...avatars.value, [key]: url }
}

function peerAvatar(peer: Peer | undefined): string {
	return (peer && avatars.value[`u:${peer.id}`]) || ''
}

// ===== Данные =====

function mapPeer(row: LooseRecord): Peer {
	const provider = String(row.provider || '')
	return {
		id: String(row.id ?? ''),
		username: String(row.username || row.name || ''),
		uuid: row.uuid ? String(row.uuid) : undefined,
		skinUrl: (row.skinUrl ?? null) as string | null,
		avatar: (row.avatar ?? null) as string | null,
		lastSeenAt: Number(row.lastSeenAt) || 0,
		presenceStatus: String(row.presenceStatus || ''),
		activity: (row.activity ?? null) as Activity | null,
		bot: Boolean(row.bot) || provider.toLowerCase() === 'bot',
	}
}

function mapConversation(row: LooseRecord): Conversation | null {
	const id = String(row.id ?? '')
	if (!id) return null
	const peer = row.peer ? mapPeer(row.peer) : undefined
	const members = Array.isArray(row.members) ? row.members : []
	const dm = Boolean(peer && (row.type === 'dm' || !row.type))
	const last = row.lastMessage
	const title = String(row.title || row.name || peer?.username || (dm ? 'Беседа' : 'Сервер'))
	return {
		id,
		dm,
		title,
		peer,
		avatarUrl: row.avatarUrl ? resolveServiceMedia(String(row.avatarUrl)) : '',
		unread: Number(row.unreadCount) || 0,
		updatedAt: Number(last?.createdAt) || Number(row.updatedAt) || 0,
		lastPreview: String(last?.body || ''),
		memberCount: members.length,
		memberIds: members.map((member: LooseRecord) => String(member?.id ?? '')).filter(Boolean),
	}
}

function mapReactions(raw: unknown): Reaction[] {
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
			if (String(row.userId) === myId.value) item.me = true
		} else {
			item.count += Number(row.count) || 0
			if (row.me) item.me = true
		}
		agg.set(emoji, item)
	}
	return [...agg.values()].filter((item) => item.count > 0)
}

function mapMessage(row: LooseRecord): Msg | null {
	const id = String(row.id ?? '')
	if (!id) return null
	const senderId = String(row.senderId ?? '')
	const reply = row.replyTo as LooseRecord | null | undefined
	const attachment = row.attachment as LooseRecord | null | undefined
	let attachmentUrl = ''
	if (attachment?.url) {
		const base = resolveServiceMedia(String(attachment.url))
		attachmentUrl = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(
			session.value?.token ?? '',
		)}`
	}
	return {
		id,
		senderId,
		senderName: String(row.senderUsername || ''),
		body: String(row.body || ''),
		createdAt: Number(row.createdAt) || Date.now(),
		attachmentUrl,
		attachmentName: attachment?.name ? String(attachment.name) : undefined,
		replyTo: reply
			? {
					id: String(reply.id ?? ''),
					senderName: replyName(reply),
					body: String(reply.body || ''),
				}
			: null,
		reactions: mapReactions(row.reactions),
		pinned: Boolean(row.pinned),
		mine: senderId === myId.value && myId.value !== '',
	}
}

function replyName(reply: LooseRecord | null | undefined): string {
	if (!reply) return ''
	return String(reply.senderUsername || reply.username || '')
}

async function loadLists(): Promise<void> {
	const [chatResponse, friendResponse] = await Promise.all([
		serviceRequest('/conversations', { query: { limit: 100 } }),
		serviceRequest('/friends'),
	])
	const rawChats = chatResponse.ok ? (chatResponse.data?.conversations ?? chatResponse.data) : []
	const mapped: Conversation[] = []
	for (const row of Array.isArray(rawChats) ? rawChats : []) {
		const conv = mapConversation(row)
		if (conv) {
			mapped.push(conv)
			if (conv.peer) void loadAvatar(`u:${conv.peer.id}`, conv.peer)
			for (const member of Array.isArray(row.members) ? row.members : []) {
				if (member?.id) void loadAvatar(`u:${String(member.id)}`, member)
			}
		}
	}
	mapped.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
	conversations.value = mapped

	if (friendResponse.ok) {
		const data = friendResponse.data ?? {}
		const list = (rows: unknown): Peer[] =>
			(Array.isArray(rows) ? rows : [])
				.map((row) => mapPeer((row as LooseRecord).user ?? row))
				.filter((peer) => peer.id)
		friends.value = list(data.friends)
		incoming.value = list(data.incoming)
		outgoing.value = list(data.outgoing)
		for (const peer of [...friends.value, ...incoming.value, ...outgoing.value]) {
			void loadAvatar(`u:${peer.id}`, peer)
		}
		const blockedResponse = await serviceRequest('/users/blocked').catch(() => null)
		if (blockedResponse?.ok) {
			blocked.value = list(blockedResponse.data?.users ?? blockedResponse.data)
			for (const peer of blocked.value) void loadAvatar(`u:${peer.id}`, peer)
		}
	}
}

// ===== Статусы =====

const ONLINE_MS = 2 * 60 * 1000

function isOnline(peer: Peer | undefined): boolean {
	if (!peer) return false
	if (peer.bot) return true
	if (String(peer.presenceStatus || '').toLowerCase() === 'offline') return false
	const seen = Number(peer.lastSeenAt)
	return Number.isFinite(seen) && seen > 0 && Date.now() - seen < ONLINE_MS
}

function statusText(peer: Peer | undefined): string {
	if (!peer) return ''
	if (peer.activity?.playing) {
		return peer.activity.serverName ? `Играет в ${peer.activity.serverName}` : 'Играет в Minecraft'
	}
	return isOnline(peer)
		? t('app.messenger.profile.online', 'В сети')
		: t('app.messenger.profile.offline', 'Оффлайн')
}

function fmtTime(ms: number): string {
	const date = new Date(ms)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(ms: number): string {
	const date = new Date(ms)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleDateString(undefined, {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	})
}

// ===== Списки для шаблона =====

const dmChats = computed(() => conversations.value.filter((conv) => conv.dm))
const groupChats = computed(() => conversations.value.filter((conv) => !conv.dm))
const onlineDms = computed(() => dmChats.value.filter((conv) => isOnline(conv.peer)))
const offlineDms = computed(() => dmChats.value.filter((conv) => !isOnline(conv.peer)))

const activeChat = computed(
	() => conversations.value.find((conv) => conv.id === activeId.value) || null,
)
const activePeer = computed(() => activeChat.value?.peer || null)

const visibleThread = computed(() => {
	const query = chatSearchQuery.value.trim().toLowerCase()
	if (!query) return thread.value
	return thread.value.filter((msg) => msg.body.toLowerCase().includes(query))
})

const sharedWorlds = computed(() => friends.value.filter((peer) => peer.activity?.worldShare))

/** Общие с собеседником серверы (группы, где он состоит). */
function sharedServersWith(peer: Peer | null): number {
	if (!peer) return 0
	return groupChats.value.filter((conv) => conv.memberIds.includes(peer.id)).length
}

function sharedServersLabel(peer: Peer | null): string {
	return t(
		'app.messenger.sharedServers',
		'{count, plural, one {# общий сервер} few {# общих сервера} many {# общих серверов} other {# общих серверов}}',
		{ count: sharedServersWith(peer) },
	)
}

const railFriends = computed(() => friends.value.filter((peer) => isOnline(peer)).slice(0, 7))

/** Группировка: подряд идущие сообщения одного автора не повторяют шапку. */
function groupStart(index: number): boolean {
	const list = visibleThread.value
	const msg = list[index]
	const prev = list[index - 1]
	if (!prev) return true
	return (
		prev.senderId !== msg.senderId ||
		msg.createdAt - prev.createdAt > 5 * 60 * 1000 ||
		prev.pinned !== msg.pinned
	)
}

function showDateDivider(index: number): boolean {
	const list = visibleThread.value
	const msg = list[index]
	const prev = list[index - 1]
	if (!prev) return true
	return new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString()
}

function typingIn(conv: Conversation): boolean {
	const at = conv.peer && typingPeers.value.get(conv.peer.id)
	return Boolean(at && Date.now() - at < 4000)
}

// ===== Чат =====

async function openChat(conv: Conversation, force = false): Promise<void> {
	mainView.value = 'chat'
	worldsOpen.value = false
	if (activeId.value === conv.id && !force) return
	activeId.value = conv.id
	firstNewId.value = ''
	chatSearchQuery.value = ''
	chatSearchOpen.value = false
	pinnedOpen.value = false
	threadLoading.value = true
	thread.value = []
	replyTo.value = null
	await nextTick()
	scrollThread()
	try {
		const response = await serviceRequest(
			`/conversations/${encodeURIComponent(conv.id)}/messages`,
			{ query: { limit: 80 } },
		)
		if (activeId.value !== conv.id) return
		const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
		thread.value = rows.map((row: LooseRecord) => mapMessage(row)).filter(Boolean) as Msg[]
		for (const msg of thread.value) {
			void loadAvatar(`u:${msg.senderId}`, {
				username: msg.senderName,
			})
		}
		void loadPins(conv)
		conv.unread = 0
		void serviceRequest(`/conversations/${encodeURIComponent(conv.id)}/read`, {
			method: 'POST',
			body: {},
		})
	} finally {
		if (activeId.value === conv.id) threadLoading.value = false
		await nextTick()
		scrollThread()
	}
}

async function loadPins(conv: Conversation): Promise<void> {
	const response = await serviceRequest(`/conversations/${encodeURIComponent(conv.id)}/pins`)
	if (!response.ok) return
	const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
	pinnedMessages.value = rows.map((row: LooseRecord) => mapMessage(row)).filter(Boolean) as Msg[]
}

function scrollThread(): void {
	const element = threadEl.value
	if (element) element.scrollTop = element.scrollHeight
}

async function sendDraft(): Promise<void> {
	const text = draft.value.trim()
	if ((!text && !attachPending.value) || !activeId.value || sending.value) return
	sending.value = true
	try {
		const body: LooseRecord = { body: text }
		if (replyTo.value) body.replyToId = replyTo.value.id
		if (attachPending.value) body.attachment = attachPending.value
		const response = await serviceRequest(
			`/conversations/${encodeURIComponent(activeId.value)}/messages`,
			{ method: 'POST', body },
		)
		if (response.ok) {
			draft.value = ''
			replyTo.value = null
			emojiOpen.value = false
			attachPending.value = null
			const sent = response.data?.message ? mapMessage(response.data.message) : null
			if (sent && !thread.value.some((msg) => msg.id === sent.id)) thread.value.push(sent)
			await refreshActive()
		} else {
			// вложение не теряем — можно поправить текст и отправить снова
			showToast(t('app.messenger.sendFailed', 'Не удалось отправить сообщение'))
		}
	} finally {
		sending.value = false
	}
}

async function refreshActive(): Promise<void> {
	const conv = conversations.value.find((row) => row.id === activeId.value)
	if (conv) await openChat(conv, true)
}

const attachPending = ref<{ name: string; mime: string; dataBase64: string } | null>(null)

async function pickFile(): Promise<void> {
	const input = fileInput.value
	if (!input) return
	input.onchange = async () => {
		const file = input.files?.[0]
		input.value = ''
		if (!file) return
		if (file.size > 8 * 1024 * 1024) {
			showToast(t('app.messenger.fileTooBig', 'Файл больше 8 МБ'))
			return
		}
		const reader = new FileReader()
		reader.onload = () => {
			const result = String(reader.result || '')
			const comma = result.indexOf(',')
			if (comma < 0) return
			attachPending.value = {
				name: file.name,
				mime: file.type || 'application/octet-stream',
				dataBase64: result.slice(comma + 1),
			}
		}
		reader.readAsDataURL(file)
	}
	input.click()
}

let typingSent = 0
function onDraftInput(): void {
	const now = Date.now()
	if (activeId.value && now - typingSent > 2500 && draft.value.trim()) {
		typingSent = now
		void serviceRequest(`/conversations/${encodeURIComponent(activeId.value)}/typing`, {
			method: 'POST',
			body: {},
		})
	}
}

// ===== Действия с сообщениями =====

async function reactMessage(msg: Msg, emoji: string): Promise<void> {
	menu.value = null
	const response = await serviceRequest(
		`/conversations/${encodeURIComponent(activeId.value)}/messages/${encodeURIComponent(msg.id)}/reactions`,
		{ method: 'POST', body: { emoji } },
	)
	if (response.ok) {
		const updated = response.data?.message ? mapMessage(response.data.message) : null
		if (updated) {
			thread.value = thread.value.map((row) => (row.id === updated.id ? updated : row))
			return
		}
	}
	await refreshActive()
}

async function deleteMessage(msg: Msg): Promise<void> {
	menu.value = null
	const response = await serviceRequest(
		`/conversations/${encodeURIComponent(activeId.value)}/messages/${encodeURIComponent(msg.id)}`,
		{ method: 'DELETE' },
	)
	if (response.ok) thread.value = thread.value.filter((row) => row.id !== msg.id)
}

async function pinMessage(msg: Msg, pinned: boolean): Promise<void> {
	menu.value = null
	const response = await serviceRequest(
		`/conversations/${encodeURIComponent(activeId.value)}/messages/${encodeURIComponent(msg.id)}/pin`,
		{ method: 'POST', body: { pinned } },
	)
	if (response.ok) await refreshActive()
}

function replyMessage(msg: Msg): void {
	menu.value = null
	replyTo.value = msg
}

function copyText(text: string): void {
	menu.value = null
	void navigator.clipboard?.writeText(text)
}

function reportMessage(msg: Msg): void {
	menu.value = null
	void serviceRequest('/reports', {
		method: 'POST',
		body: {
			reason: 'abuse',
			target_type: 'message',
			target_id: msg.id,
			room_id: activeId.value,
		},
	}).then((response) => {
		showToast(
			response.ok
				? t('app.messenger.reported', 'Жалоба отправлена')
				: t('app.messenger.reportFailed', 'Не удалось отправить жалобу'),
		)
	})
}

function openMenu(event: MouseEvent, msg: Msg): void {
	menu.value = { x: event.clientX, y: event.clientY, msg }
}

function onMenuClick(): void {
	menu.value = null
}

function forwardTo(conv: Conversation): void {
	const msg = forwardMsg.value
	forwardMsg.value = null
	if (!msg) return
	void serviceRequest(`/conversations/${encodeURIComponent(conv.id)}/messages`, {
		method: 'POST',
		body: { body: msg.body },
	}).then((response) => {
		if (!response.ok) showToast(t('app.messenger.sendFailed', 'Не удалось отправить сообщение'))
	})
}

// ===== Друзья =====

function openFriends(tab: 'online' | 'all' | 'pending' | 'blocked' = 'all'): void {
	mainView.value = 'friends'
	worldsOpen.value = false
	friendsTab.value = tab
}

async function acceptFriend(peer: Peer): Promise<void> {
	await serviceRequest(`/friends/${encodeURIComponent(peer.id)}/accept`, {
		method: 'POST',
		body: {},
	})
	await loadLists()
}

async function declineFriend(peer: Peer): Promise<void> {
	await serviceRequest(`/friends/${encodeURIComponent(peer.id)}`, { method: 'DELETE' })
	await loadLists()
}

async function addFriend(user: LooseRecord): Promise<void> {
	if (!user.id) return
	await serviceRequest(`/friends/${encodeURIComponent(String(user.id))}/request`, {
		method: 'POST',
		body: {},
	})
	await loadLists()
}

async function removeFriend(peer: Peer): Promise<void> {
	await serviceRequest(`/friends/${encodeURIComponent(peer.id)}`, { method: 'DELETE' })
	await loadLists()
}

async function startDm(user: LooseRecord): Promise<void> {
	const response = await serviceRequest('/conversations/dm', {
		method: 'POST',
		body: { userId: user.id },
	})
	await loadLists()
	if (response.ok) {
		const id = String(
			response.data?.conversation?.id ?? response.data?.id ?? response.data?.conversationId ?? '',
		)
		const conv = conversations.value.find((row) => row.id === id)
		if (conv) await openChat(conv)
	}
}

async function writeToPeer(peer: Peer): Promise<void> {
	await startDm({ id: peer.id, username: peer.username })
}

// ===== Поиск =====

function runSearch(): void {
	if (searchTimer.value) return
	searchTimer.value = setTimeout(async () => {
		searchTimer.value = null
		const query = searchQuery.value.trim()
		if (query.length < 2) {
			searchResults.value = []
			return
		}
		searching.value = true
		try {
			const response = await serviceRequest('/users/search', {
				query: { q: query, limit: 10 },
			})
			searchResults.value = Array.isArray(response.data?.users) ? response.data.users : []
			for (const user of searchResults.value) {
				void loadAvatar(`u:${String(user.id ?? '')}`, user)
			}
		} finally {
			searching.value = false
		}
	}, 400)
}

// ===== Звонки =====

function placeCall(): void {
	const conv = activeChat.value
	if (!conv?.peer || conv.peer.bot) return
	void startDmCall(conv.id, conv.peer.id, conv.peer.username)
}

function callStatusLabel(): string {
	const state = callState.value
	if (state.phase === 'outgoing') return t('app.messenger.call.ringing', 'Вызываем…')
	if (state.phase === 'incoming') return t('app.messenger.call.incoming', 'Входящий звонок')
	if (state.phase === 'connecting') return t('app.messenger.call.connecting', 'Соединение…')
	if (state.phase === 'active') return t('app.messenger.call.active', 'Идёт звонок')
	return ''
}

const EMOJI_PICK = ['😀', '😂', '❤️', '👍', '🔥', '😮', '😢', '🎉', '😎', '🤔', '🙏', '👀']

// ===== Живые события =====

let stream: EventSource | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let streamRetries = 0
let reloadTimer: ReturnType<typeof setTimeout> | null = null

function stopLive(): void {
	if (stream) {
		stream.close()
		stream = null
	}
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
	if (reloadTimer) {
		clearTimeout(reloadTimer)
		reloadTimer = null
	}
}

function scheduleReload(): void {
	if (reloadTimer) return
	reloadTimer = setTimeout(() => {
		reloadTimer = null
		void loadLists()
	}, 300)
}

function upsertMessage(convId: string, row: LooseRecord): void {
	const msg = mapMessage(row)
	if (!msg) return
	if (convId === activeId.value) {
		const exists = thread.value.some((entry) => entry.id === msg.id)
		if (exists) {
			thread.value = thread.value.map((entry) => (entry.id === msg.id ? msg : entry))
		} else {
			thread.value = [...thread.value, msg].sort((a, b) => a.createdAt - b.createdAt)
			if (!msg.mine && !firstNewId.value) firstNewId.value = msg.id
			void nextTick(scrollThread)
		}
		return
	}
	const conv = conversations.value.find((entry) => entry.id === convId)
	if (conv) {
		if (!msg.mine) conv.unread += 1
		conv.lastPreview = msg.body
		conv.updatedAt = msg.createdAt
		conversations.value = [...conversations.value].sort(
			(a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
		)
	}
	scheduleReload()
}

function handleLive(name: string, data: LooseRecord): void {
	if (!data || typeof data !== 'object') return
	if (name === 'message' && data.message) {
		upsertMessage(String(data.conversationId || data.message.conversationId || ''), data.message)
		return
	}
	if (name === 'message_deleted' && data.message) {
		const id = String(data.message.id ?? '')
		thread.value = thread.value.filter((msg) => msg.id !== id)
		scheduleReload()
		return
	}
	if (name === 'reaction' && data.message) {
		const msg = mapMessage(data.message)
		if (msg) {
			thread.value = thread.value.map((entry) => (entry.id === msg.id ? msg : entry))
		}
		return
	}
	if (name === 'presence' && data.userId) {
		const patch = {
			lastSeenAt: Number(data.lastSeenAt) || 0,
			presenceStatus: String(data.presenceStatus || ''),
		}
		for (const conv of conversations.value) {
			if (conv.peer && conv.peer.id === String(data.userId)) {
				conv.peer = { ...conv.peer, ...patch }
			}
		}
		for (const list of [friends, incoming, outgoing]) {
			list.value = list.value.map((peer) =>
				peer.id === String(data.userId) ? { ...peer, ...patch } : peer,
			)
		}
		return
	}
	if (name === 'typing' && data.userId && String(data.userId) !== myId.value) {
		typingPeers.value = new Map(typingPeers.value).set(String(data.userId), Date.now())
		setTimeout(() => {
			const at = typingPeers.value.get(String(data.userId))
			if (at && Date.now() - at >= 4000) {
				typingPeers.value = new Map(typingPeers.value)
				typingPeers.value.delete(String(data.userId))
			}
		}, 4200)
		return
	}
	if (name === 'read' && data.conversationId) {
		const conv = conversations.value.find((entry) => entry.id === String(data.conversationId))
		if (conv && String(data.userId ?? '') === myId.value) conv.unread = 0
		return
	}
	if (name === 'activity' && data.userId) {
		const activity = (data.activity ?? null) as Activity | null
		for (const list of [friends, incoming, outgoing]) {
			list.value = list.value.map((peer) =>
				peer.id === String(data.userId) ? { ...peer, activity } : peer,
			)
		}
		return
	}
	if (name === 'signal') {
		void handleCallSignal(data as Parameters<typeof handleCallSignal>[0])
		callTick.value += 1
		return
	}
	if (
		name === 'conversation' ||
		name === 'conversation_updated' ||
		name === 'channels' ||
		name === 'member_changed' ||
		name === 'friend'
	) {
		scheduleReload()
	}
}

function startLive(token: string): void {
	stopLive()
	try {
		stream = new EventSource(serviceStreamUrl(token))
		const source = stream
		for (const name of [
			'message',
			'message_deleted',
			'conversation',
			'conversation_updated',
			'channels',
			'member_changed',
			'reaction',
			'presence',
			'typing',
			'read',
			'friend',
			'activity',
			'signal',
		]) {
			source.addEventListener(name, (event) => {
				try {
					handleLive(name, JSON.parse((event as MessageEvent).data || '{}'))
				} catch {
					/* битое событие не должно ронять поток */
				}
			})
		}
		source.onopen = () => {
			streamRetries = 0
		}
		source.onerror = () => {
			if (stream !== source || source.readyState === EventSource.CLOSED) {
				stream = null
				streamRetries += 1
				const wait = Math.min(20000, 2000 * streamRetries)
				setTimeout(() => {
					if (session.value?.token) startLive(session.value.token)
				}, wait)
			}
		}
	} catch {
		stream = null
	}
	// Страховка: SSE может не пробиться сквозь вебвью — тогда тихо поллим.
	pollTimer = setInterval(() => void livePulse(), 9000)
}

async function livePulse(): Promise<void> {
	if (!session.value || refreshing.value) return
	refreshing.value = true
	try {
		await loadLists()
		if (activeId.value) {
			const conv = conversations.value.find((row) => row.id === activeId.value)
			if (conv) {
				const response = await serviceRequest(
					`/conversations/${encodeURIComponent(conv.id)}/messages`,
					{ query: { limit: 80 } },
				)
				const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
				const next = rows.map((row: LooseRecord) => mapMessage(row)).filter(Boolean) as Msg[]
				const known = new Set(thread.value.map((msg) => msg.id))
				let changed = next.length !== thread.value.length
				for (const msg of next) {
					if (!known.has(msg.id)) changed = true
				}
				if (changed) thread.value = next
			}
		}
	} finally {
		refreshing.value = false
	}
}

// ===== Профиль =====

const profileModal = ref<InstanceType<typeof UserProfileModal> | null>(null)

function openProfile(peer: Peer | LooseRecord | undefined): void {
	if (!peer || peer.id == null || String(peer.id) === '') return
	profileModal.value?.show(
		{
			id: String(peer.id),
			username: peer.username,
			name: peer.username,
			uuid: peer.uuid,
		},
		{
			canWrite: true,
			self: String(peer.id) === myId.value,
		},
	)
}

async function writeFromProfile(user: {
	id: string
	username?: string
	name?: string
}): Promise<void> {
	await startDm({ id: user.id, username: user.username || user.name })
}

// ===== Подключение =====

async function connect(force = false): Promise<void> {
	loading.value = true
	loadError.value = ''
	try {
		const ready = await ensureServiceSession(force)
		session.value = ready
		if (!ready) return
		if (ready.user?.id) {
			void loadAvatar(`u:${String(ready.user.id)}`, ready.user)
		}
		initMessengerCall({
			req: (path, opts) => serviceRequest(path, opts),
			me: () =>
				session.value?.user
					? { id: String(session.value.user.id ?? ''), username: session.value.user.username || '' }
					: null,
			onChange: () => {
				callTick.value += 1
			},
			toast: (text) => showToast(text),
			micDeniedText: () => t('app.messenger.call.micDenied', 'Нет доступа к микрофону'),
			failedText: () => t('app.messenger.call.failed', 'Не удалось дозвониться'),
		})
		await loadLists()
		startLive(ready.token)
		if (conversations.value.length) await openChat(conversations.value[0])
	} catch (error) {
		loadError.value = error instanceof Error ? error.message : 'network'
	} finally {
		loading.value = false
	}
}

async function signOut(): Promise<void> {
	forgetServiceSession()
	session.value = null
	conversations.value = []
	friends.value = []
	incoming.value = []
	outgoing.value = []
	blocked.value = []
	thread.value = []
	activeId.value = ''
	stopLive()
	await connect(true)
}

onMounted(() => {
	void connect()
	window.addEventListener('click', onMenuClick)
})

onActivated(breadcrumb.reset)

onDeactivated(() => {
	stopLive()
	window.removeEventListener('click', onMenuClick)
})
onUnmounted(() => {
	stopLive()
	window.removeEventListener('click', onMenuClick)
})
</script>

<template>
	<div class="msg2">
		<div v-if="loading" class="msg2-state">
			{{ t('app.messenger.loading', 'Соединяемся с сервисом…') }}
		</div>

		<div v-else-if="!session" class="msg2-gate">
			<MessageIcon />
			<b>{{ t('app.messenger.gateTitle', 'MC Messenger') }}</b>
			<p>
				{{
					t(
						'app.messenger.gateText',
						'Чаты и друзья прямо в лаунчере — как у Undefined Client. Нужен аккаунт Microsoft или Ely.by: мессенджер общий, переписка видна и их игрокам, и нашим.',
					)
				}}
			</p>
			<Button @click="connect(true)">
				{{ t('app.messenger.retry', 'Подключить аккаунт') }}
			</Button>
		</div>

		<div v-else-if="loadError" class="msg2-state">
			{{ loadError }}
			<Button @click="connect(true)">{{ t('app.messenger.retry', 'Повторить') }}</Button>
		</div>

		<template v-else>
			<!-- ===== 1. Рейл ===== -->
			<nav class="msg2-rail">
				<button
					type="button"
					class="msg2-rail__home"
					:class="{ 'is-on': mainView === 'friends' }"
					:title="t('app.messenger.navFriends', 'Друзья')"
					@click="openFriends()"
				>
					<HomeIcon />
				</button>
				<div class="msg2-rail__scroll">
					<button
						v-for="peer in railFriends"
						:key="`rail-${peer.id}`"
						type="button"
						class="msg2-rail__ava"
						:title="peer.username"
						@click="writeToPeer(peer)"
					>
						<img v-if="peerAvatar(peer)" :src="peerAvatar(peer)" alt="" />
						<span class="msg2-rail__dot" :class="{ 'is-on': isOnline(peer) }" />
					</button>
					<div v-if="railFriends.length && groupChats.length" class="msg2-rail__sep" />
					<button
						v-for="conv in groupChats"
						:key="`railg-${conv.id}`"
						type="button"
						class="msg2-rail__server"
						:class="{ 'is-on': conv.id === activeId }"
						:title="conv.title"
						@click="openChat(conv)"
					>
						<img v-if="conv.avatarUrl" :src="conv.avatarUrl" alt="" />
						<span v-else>{{ conv.title.slice(0, 2) }}</span>
					</button>
				</div>
				<button
					type="button"
					class="msg2-rail__add"
					:title="t('app.messenger.findPeople', 'Найти людей')"
					@click="openFriends()"
				>
					<PlusIcon />
				</button>
			</nav>

			<!-- ===== 2. Список ===== -->
			<aside class="msg2-side">
				<label class="msg2-search">
					<SearchIcon />
					<input
						v-model="searchQuery"
						:placeholder="t('app.messenger.searchStart', 'Найти или начать беседу')"
						@input="runSearch"
					/>
				</label>

				<nav class="msg2-nav">
					<button type="button" :class="{ 'is-on': mainView === 'friends' }" @click="openFriends()">
						<UsersIcon />
						<span>{{ t('app.messenger.navFriends', 'Друзья') }}</span>
						<span v-if="incoming.length" class="msg2-nav__badge">{{ incoming.length }}</span>
					</button>
					<button
						type="button"
						:class="{ 'is-on': mainView === 'friends' && friendsTab === 'pending' }"
						@click="openFriends('pending')"
					>
						<MailIcon />
						<span>{{ t('app.messenger.navRequests', 'Приглашения') }}</span>
						<span v-if="incoming.length" class="msg2-nav__badge msg2-nav__badge--red">
							{{ incoming.length }}
						</span>
					</button>
					<button
						type="button"
						class="msg2-nav__worlds"
						:class="{ 'is-on': worldsOpen }"
						@click="worldsOpen = !worldsOpen"
					>
						<GlobeIcon />
						<span>{{ t('app.messenger.navWorlds', 'Миры по сети') }}</span>
						<span v-if="sharedWorlds.length" class="msg2-nav__badge msg2-nav__badge--red">
							{{ sharedWorlds.length }}
						</span>
					</button>
				</nav>

				<div class="msg2-side__scroll">
					<template v-if="searchResults.length">
						<div class="msg2-sec">
							{{ t('app.messenger.searchResults', 'Результаты поиска') }}
						</div>
						<div v-for="user in searchResults" :key="`s-${user.id}`" class="msg2-person">
							<span class="msg2-person__ava">
								<img
									v-if="avatars[`u:${String(user.id ?? '')}`]"
									:src="avatars[`u:${String(user.id ?? '')}`]"
									alt=""
								/>
							</span>
							<span class="msg2-person__text">
								<b>{{ user.username || user.name }}</b>
							</span>
							<span class="msg2-person__tools">
								<button
									type="button"
									class="msg2-iconbtn"
									:title="t('app.messenger.profile.open', 'Открыть профиль')"
									@click="openProfile(user)"
								>
									<UserIcon />
								</button>
								<button
									type="button"
									class="msg2-iconbtn"
									:title="t('app.messenger.addFriend', 'Добавить в друзья')"
									@click="addFriend(user)"
								>
									<UserPlusIcon />
								</button>
								<button
									type="button"
									class="msg2-iconbtn"
									:title="t('app.messenger.write', 'Написать')"
									@click="startDm(user)"
								>
									<MessageIcon />
								</button>
							</span>
						</div>
					</template>

					<template v-else>
						<template v-if="groupChats.length">
							<div class="msg2-sec">{{ t('app.messenger.sectionServers', 'Серверы') }}</div>
							<button
								v-for="conv in groupChats"
								:key="conv.id"
								type="button"
								class="msg2-row"
								:class="{ 'is-on': conv.id === activeId }"
								@click="openChat(conv)"
							>
								<span class="msg2-row__ava msg2-row__ava--square">
									<img v-if="conv.avatarUrl" :src="conv.avatarUrl" alt="" />
									<span v-else class="msg2-row__letter">{{ conv.title.slice(0, 1) }}</span>
								</span>
								<span class="msg2-row__text">
									<b>{{ conv.title }}</b>
									<small>{{
										t('app.messenger.membersCount', '{count} участников', {
											count: conv.memberCount,
										})
									}}</small>
								</span>
								<span v-if="conv.unread" class="msg2-row__badge">{{ conv.unread }}</span>
							</button>
						</template>

						<div class="msg2-sec">{{ t('app.messenger.sectionDms', 'Личные сообщения') }}</div>
						<template v-if="onlineDms.length">
							<div class="msg2-sub">{{ t('app.messenger.subOnline', 'В сети') }}</div>
							<button
								v-for="conv in onlineDms"
								:key="conv.id"
								type="button"
								class="msg2-row"
								:class="{ 'is-on': conv.id === activeId }"
								@click="openChat(conv)"
							>
								<span class="msg2-row__ava">
									<img v-if="peerAvatar(conv.peer)" :src="peerAvatar(conv.peer)" alt="" />
									<span v-else class="msg2-row__letter">{{
										conv.title.slice(0, 1).toUpperCase()
									}}</span>
									<span class="msg2-row__status" />
								</span>
								<span class="msg2-row__text">
									<b>{{ conv.title }}</b>
									<small>{{
										typingIn(conv)
											? t('app.messenger.typing', 'печатает…')
											: conv.lastPreview || statusText(conv.peer)
									}}</small>
								</span>
								<span v-if="conv.unread" class="msg2-row__badge">{{ conv.unread }}</span>
							</button>
						</template>
						<template v-if="offlineDms.length">
							<div class="msg2-sub">{{ t('app.messenger.subOffline', 'Оффлайн') }}</div>
							<button
								v-for="conv in offlineDms"
								:key="conv.id"
								type="button"
								class="msg2-row"
								:class="{ 'is-on': conv.id === activeId }"
								@click="openChat(conv)"
							>
								<span class="msg2-row__ava">
									<img v-if="peerAvatar(conv.peer)" :src="peerAvatar(conv.peer)" alt="" />
									<span v-else class="msg2-row__letter">{{
										conv.title.slice(0, 1).toUpperCase()
									}}</span>
								</span>
								<span class="msg2-row__text">
									<b>{{ conv.title }}</b>
									<small>{{
										typingIn(conv)
											? t('app.messenger.typing', 'печатает…')
											: conv.lastPreview || statusText(conv.peer)
									}}</small>
								</span>
								<span v-if="conv.unread" class="msg2-row__badge">{{ conv.unread }}</span>
							</button>
						</template>
						<p v-if="!dmChats.length && !groupChats.length" class="msg2-empty">
							{{
								t(
									'app.messenger.noChats',
									'Чатов пока нет — найдите друга через поиск или вкладку «Друзья».',
								)
							}}
						</p>
					</template>
				</div>

				<div class="msg2-side__foot">
					<button
						type="button"
						class="msg2-refresh"
						:class="{ 'is-busy': refreshing }"
						@click="livePulse"
					>
						<RefreshCwIcon v-if="!refreshing" />
						<span v-else class="msg2-spinner" />
						{{ t('app.messenger.refresh', 'Обновить') }}
					</button>
					<button type="button" class="msg2-signout" @click="signOut">
						{{ t('app.messenger.signOut', 'Выйти из сессии') }}
					</button>
				</div>
			</aside>

			<!-- ===== 3. Чат ===== -->
			<section v-if="mainView === 'chat'" class="msg2-main">
				<header class="msg2-head">
					<span class="msg2-head__ava">
						<img v-if="peerAvatar(activePeer)" :src="peerAvatar(activePeer)" alt="" />
						<span v-else class="msg2-row__letter">{{
							(activeChat?.title || '?').slice(0, 1).toUpperCase()
						}}</span>
						<span
							v-if="activePeer"
							class="msg2-row__status"
							:class="{ 'is-off': !isOnline(activePeer) }"
						/>
					</span>
					<span class="msg2-head__text">
						<b>{{ activeChat?.title }}</b>
						<small>{{
							typingIn(activeChat!)
								? t('app.messenger.typing', 'печатает…')
								: statusText(activePeer)
						}}</small>
					</span>
					<div class="msg2-head__tools">
						<template v-if="activeChat?.dm && activePeer && !activePeer.bot">
							<button
								type="button"
								class="msg2-iconbtn"
								:title="t('app.messenger.call.start', 'Позвонить')"
								:disabled="callState.phase !== 'idle'"
								@click="placeCall"
							>
								<SmartphoneIcon />
							</button>
							<button
								type="button"
								class="msg2-iconbtn"
								:title="t('app.messenger.call.video', 'Видеозвонок')"
								:disabled="callState.phase !== 'idle'"
								@click="placeCall"
							>
								<VideoIcon />
							</button>
						</template>
						<button
							type="button"
							class="msg2-iconbtn"
							:class="{ 'is-on': pinnedOpen }"
							:title="t('app.messenger.pinned', 'Закреплённые')"
							@click="pinnedOpen = !pinnedOpen"
						>
							<PinIcon />
						</button>
						<button
							v-if="activePeer && !friends.some((peer) => peer.id === activePeer.id)"
							type="button"
							class="msg2-iconbtn"
							:title="t('app.messenger.addFriend', 'Добавить в друзья')"
							@click="addFriend({ id: activePeer.id })"
						>
							<UserPlusIcon />
						</button>
						<button
							type="button"
							class="msg2-iconbtn"
							:class="{ 'is-on': chatSearchOpen }"
							:title="t('app.messenger.chatSearch', 'Поиск в чате')"
							@click="chatSearchOpen = !chatSearchOpen"
						>
							<SearchIcon />
						</button>
						<input
							v-if="chatSearchOpen"
							v-model="chatSearchQuery"
							class="msg2-head__search"
							type="text"
							:placeholder="t('app.messenger.chatSearch', 'Поиск в чате')"
						/>
					</div>
				</header>

				<div v-if="pinnedOpen" class="msg2-pins">
					<template v-if="pinnedMessages.length">
						<div v-for="msg in pinnedMessages" :key="`pin-${msg.id}`" class="msg2-pins__row">
							<PinIcon />
							<b>{{ msg.senderName }}</b>
							<span>{{ msg.body }}</span>
							<button type="button" @click="pinMessage(msg, false)">
								{{ t('app.messenger.unpin', 'Открепить') }}
							</button>
						</div>
					</template>
					<p v-else class="msg2-pins__empty">
						{{ t('app.messenger.noPins', 'Закреплённых сообщений нет') }}
					</p>
				</div>

				<div ref="threadEl" class="msg2-thread">
					<div v-if="threadLoading" class="msg2-thread__state">
						<span class="msg2-spinner" />
					</div>
					<div v-else-if="!activeChat" class="msg2-thread__state">
						{{ t('app.messenger.pickChat', 'Выберите беседу слева') }}
					</div>
					<div v-else-if="!visibleThread.length" class="msg2-thread__state">
						{{
							chatSearchQuery.trim()
								? t('app.messenger.searchNothing', 'Ничего не найдено')
								: t('app.messenger.threadEmpty', 'Сообщений пока нет — напишите первым')
						}}
					</div>
					<template v-else>
						<div
							v-for="(msg, index) in visibleThread"
							:key="msg.id"
							class="msg2-mrow"
							:class="{ 'is-group': !groupStart(index) }"
							@contextmenu.prevent="openMenu($event, msg)"
						>
							<div v-if="showDateDivider(index)" class="msg2-date">
								{{ fmtDate(msg.createdAt) }}
							</div>
							<div v-if="msg.id === firstNewId" class="msg2-new">
								<span>{{ t('app.messenger.newDivider', 'НОВЫЕ') }}</span>
							</div>
							<div class="msg2-msg" :class="{ 'is-pinned': msg.pinned }">
								<span v-if="groupStart(index)" class="msg2-msg__ava">
									<img
										v-if="avatars[`u:${msg.senderId}`]"
										:src="avatars[`u:${msg.senderId}`]"
										alt=""
									/>
									<span v-else class="msg2-row__letter">{{
										msg.senderName.slice(0, 1).toUpperCase()
									}}</span>
								</span>
								<div class="msg2-msg__body">
									<div v-if="groupStart(index)" class="msg2-msg__head">
										<button
											type="button"
											class="msg2-msg__name"
											@click="openProfile({ id: msg.senderId, username: msg.senderName })"
										>
											{{ msg.senderName || t('app.messenger.unknown', 'Игрок') }}
										</button>
										<time>{{ fmtDate(msg.createdAt) }} {{ fmtTime(msg.createdAt) }}</time>
									</div>
									<div v-if="msg.replyTo" class="msg2-reply">
										<b>{{ msg.replyTo.senderName }}</b>
										<span>{{ msg.replyTo.body }}</span>
									</div>
									<p v-if="msg.body" class="msg2-msg__text">{{ msg.body }}</p>
									<a
										v-if="msg.attachmentUrl"
										class="msg2-msg__att"
										:href="msg.attachmentUrl"
										target="_blank"
									>
										<img :src="msg.attachmentUrl" :alt="msg.attachmentName || ''" loading="lazy" />
									</a>
									<div v-if="msg.reactions.length" class="msg2-reacts">
										<button
											v-for="reaction in msg.reactions"
											:key="reaction.emoji"
											type="button"
											class="msg2-react"
											:class="{ 'is-me': reaction.me }"
											@click="reactMessage(msg, reaction.emoji)"
										>
											{{ reaction.emoji }} {{ reaction.count }}
										</button>
									</div>
								</div>
								<div class="msg2-msg__tools">
									<button type="button" title="❤️" @click="reactMessage(msg, '❤️')">❤️</button>
									<button type="button" title="👍" @click="reactMessage(msg, '👍')">👍</button>
									<button type="button" title="😂" @click="reactMessage(msg, '😂')">😂</button>
									<button
										type="button"
										:title="t('app.messenger.reply', 'Ответить')"
										@click="replyMessage(msg)"
									>
										<ReplyIcon />
									</button>
									<button
										type="button"
										:title="t('app.messenger.more', 'Ещё')"
										@click="openMenu($event, msg)"
									>
										<MoreVerticalIcon />
									</button>
								</div>
							</div>
						</div>
					</template>
				</div>

				<div v-if="replyTo" class="msg2-replybar">
					<ReplyIcon />
					<span>
						<b>{{ replyTo.senderName }}</b>
						{{ replyTo.body }}
					</span>
					<button type="button" @click="replyTo = null"><XIcon /></button>
				</div>

				<footer class="msg2-composer">
					<div v-if="attachPending" class="msg2-attachbar">
						<ImageIcon />
						<span>{{ attachPending.name }}</span>
						<button type="button" @click="attachPending = null"><XIcon /></button>
					</div>
					<div class="msg2-composer__row">
						<button
							type="button"
							class="msg2-iconbtn"
							:title="t('app.messenger.attach', 'Прикрепить файл')"
							@click="pickFile"
						>
							<PlusIcon />
						</button>
						<input ref="fileInput" type="file" hidden accept="image/*,video/*,application/pdf" />
						<input
							v-model="draft"
							class="msg2-composer__input"
							type="text"
							:placeholder="
								t('app.messenger.writeTo', 'Написать {name}', {
									name: activeChat?.title || '',
								})
							"
							@input="onDraftInput"
							@keydown.enter.prevent="sendDraft"
						/>
						<div class="msg2-composer__tools">
							<button
								type="button"
								class="msg2-iconbtn"
								:class="{ 'is-on': emojiOpen }"
								:title="t('app.messenger.emoji', 'Эмодзи')"
								@click="emojiOpen = !emojiOpen"
							>
								<SmileIcon />
							</button>
							<button
								type="button"
								class="msg2-iconbtn msg2-send"
								:disabled="!draft.trim() && !attachPending"
								:title="t('app.messenger.send', 'Отправить')"
								@click="sendDraft"
							>
								<SendIcon />
							</button>
						</div>
					</div>
					<div v-if="emojiOpen" class="msg2-emoji">
						<button v-for="emoji in EMOJI_PICK" :key="emoji" type="button" @click="draft += emoji">
							{{ emoji }}
						</button>
					</div>
				</footer>
			</section>

			<!-- ===== 3б. Друзья ===== -->
			<section v-else class="msg2-friends">
				<header class="msg2-friends__head">
					<UsersIcon />
					<b>{{ t('app.messenger.navFriends', 'Друзья') }}</b>
					<nav class="msg2-friends__tabs">
						<button
							v-for="tab in ['online', 'all', 'pending', 'blocked'] as const"
							:key="tab"
							type="button"
							:class="{ 'is-on': friendsTab === tab }"
							@click="friendsTab = tab"
						>
							{{
								{
									online: t('app.messenger.friendsTab.online', 'В сети'),
									all: t('app.messenger.friendsTab.all', 'Все'),
									pending: t('app.messenger.friendsTab.pending', 'Ожидание'),
									blocked: t('app.messenger.friendsTab.blocked', 'Заблокированные'),
								}[tab]
							}}
						</button>
					</nav>
				</header>

				<div class="msg2-friends__list">
					<template v-if="friendsTab === 'pending'">
						<div v-if="incoming.length" class="msg2-sub">
							{{ t('app.messenger.requestsIn', 'Входящие заявки') }}
						</div>
						<div v-for="peer in incoming" :key="`in-${peer.id}`" class="msg2-person">
							<span class="msg2-person__ava">
								<img v-if="peerAvatar(peer)" :src="peerAvatar(peer)" alt="" />
							</span>
							<span class="msg2-person__text">
								<b>{{ peer.username }}</b>
								<small>{{ t('app.messenger.wantsFriend', 'Хочет дружить') }}</small>
							</span>
							<span class="msg2-person__tools">
								<button
									type="button"
									class="msg2-iconbtn msg2-iconbtn--ok"
									:title="t('app.messenger.accept', 'Принять')"
									@click="acceptFriend(peer)"
								>
									<CheckIcon />
								</button>
								<button
									type="button"
									class="msg2-iconbtn msg2-iconbtn--bad"
									:title="t('app.messenger.decline', 'Отклонить')"
									@click="declineFriend(peer)"
								>
									<XIcon />
								</button>
							</span>
						</div>
						<div v-if="outgoing.length" class="msg2-sub">
							{{ t('app.messenger.requestsOut', 'Исходящие заявки') }}
						</div>
						<div v-for="peer in outgoing" :key="`out-${peer.id}`" class="msg2-person">
							<span class="msg2-person__ava">
								<img v-if="peerAvatar(peer)" :src="peerAvatar(peer)" alt="" />
							</span>
							<span class="msg2-person__text">
								<b>{{ peer.username }}</b>
								<small>{{ t('app.messenger.waitAnswer', 'Ожидает ответа') }}</small>
							</span>
							<span class="msg2-person__tools">
								<button
									type="button"
									class="msg2-iconbtn msg2-iconbtn--bad"
									:title="t('app.messenger.cancelRequest', 'Отменить')"
									@click="declineFriend(peer)"
								>
									<XIcon />
								</button>
							</span>
						</div>
						<p v-if="!incoming.length && !outgoing.length" class="msg2-empty">
							{{ t('app.messenger.noRequests', 'Заявок нет') }}
						</p>
					</template>

					<template v-else-if="friendsTab === 'blocked'">
						<div v-for="peer in blocked" :key="`bl-${peer.id}`" class="msg2-person">
							<span class="msg2-person__ava">
								<img v-if="peerAvatar(peer)" :src="peerAvatar(peer)" alt="" />
							</span>
							<span class="msg2-person__text">
								<b>{{ peer.username }}</b>
								<small>{{ t('app.messenger.blocked', 'Заблокирован') }}</small>
							</span>
						</div>
						<p v-if="!blocked.length" class="msg2-empty">
							{{ t('app.messenger.noBlocked', 'Заблокированных нет') }}
						</p>
					</template>

					<template v-else>
						<div
							v-for="peer in friendsTab === 'online'
								? friends.filter((row) => isOnline(row))
								: friends"
							:key="`f-${peer.id}`"
							class="msg2-person"
						>
							<span class="msg2-person__ava">
								<img v-if="peerAvatar(peer)" :src="peerAvatar(peer)" alt="" />
								<span class="msg2-row__status" :class="{ 'is-off': !isOnline(peer) }" />
							</span>
							<span class="msg2-person__text">
								<b>{{ peer.username }}</b>
								<small>{{ statusText(peer) }}</small>
							</span>
							<span class="msg2-person__tools">
								<button
									type="button"
									class="msg2-iconbtn"
									:title="t('app.messenger.write', 'Написать')"
									@click="writeToPeer(peer)"
								>
									<MessageIcon />
								</button>
								<button
									type="button"
									class="msg2-iconbtn"
									:title="t('app.messenger.profile.open', 'Открыть профиль')"
									@click="openProfile(peer)"
								>
									<UserIcon />
								</button>
								<button
									type="button"
									class="msg2-iconbtn msg2-iconbtn--bad"
									:title="t('app.messenger.removeFriend', 'Удалить из друзей')"
									@click="removeFriend(peer)"
								>
									<TrashIcon />
								</button>
							</span>
						</div>
						<p v-if="!friends.length" class="msg2-empty">
							{{
								t(
									'app.messenger.noFriends',
									'Друзей пока нет — найдите через поиск сверху или добавьте из чата.',
								)
							}}
						</p>
					</template>
				</div>
			</section>

			<!-- ===== 4. Профиль ===== -->
			<aside v-if="mainView === 'chat' && activePeer" class="msg2-profile">
				<span class="msg2-profile__ava">
					<img v-if="peerAvatar(activePeer)" :src="peerAvatar(activePeer)" alt="" />
				</span>
				<b class="msg2-profile__name">{{ activePeer.username }}</b>
				<span class="msg2-profile__tag">@{{ activePeer.username }}</span>
				<button type="button" class="msg2-profile__btn" @click="openProfile(activePeer)">
					{{ t('app.messenger.profile.open', 'Открыть полный профиль') }}
				</button>
				<div v-if="sharedServersWith(activePeer)" class="msg2-profile__row">
					<GlobeIcon />
					<span>{{ sharedServersLabel(activePeer) }}</span>
					<ChevronRightIcon />
				</div>
			</aside>
			<aside v-else-if="mainView === 'friends'" class="msg2-profile msg2-profile--list">
				<b>{{ t('app.messenger.activeNow', 'Активны сейчас') }}</b>
				<div
					v-for="peer in friends.filter((row) => row.activity?.playing).slice(0, 6)"
					:key="`act-${peer.id}`"
					class="msg2-profile__activity"
					@click="openProfile(peer)"
				>
					<span class="msg2-person__ava">
						<img v-if="peerAvatar(peer)" :src="peerAvatar(peer)" alt="" />
					</span>
					<span>
						<b>{{ peer.username }}</b>
						<small>{{ statusText(peer) }}</small>
					</span>
				</div>
				<p v-if="!friends.some((row) => row.activity?.playing)" class="msg2-empty">
					{{ t('app.messenger.nobodyPlaying', 'Сейчас никто не играет') }}
				</p>
			</aside>
		</template>

		<!-- ===== Миры по сети ===== -->
		<div v-if="worldsOpen && session" class="msg2-worlds">
			<header>
				<b>{{ t('app.messenger.navWorlds', 'Миры по сети') }}</b>
				<button type="button" @click="worldsOpen = false"><XIcon /></button>
			</header>
			<div v-for="peer in sharedWorlds" :key="`w-${peer.id}`" class="msg2-worlds__row">
				<span class="msg2-person__ava">
					<img v-if="peerAvatar(peer)" :src="peerAvatar(peer)" alt="" />
				</span>
				<span>
					<b>{{ peer.username }}</b>
					<small>{{ peer.activity?.serverName || t('app.messenger.world', 'Мир') }}</small>
					<code v-if="peer.activity?.serverHost">{{ peer.activity.serverHost }}</code>
				</span>
			</div>
			<p v-if="!sharedWorlds.length" class="msg2-empty">
				{{ t('app.messenger.noWorlds', 'Открытых миров нет — друзья ещё не в игре') }}
			</p>
		</div>

		<!-- ===== Звонок ===== -->
		<div
			v-if="session && callState.phase !== 'idle'"
			class="msg2-call"
			:class="{ 'is-incoming': callState.phase === 'incoming' }"
		>
			<span class="msg2-call__ava">
				<img
					v-if="callState.peerId && avatars[`u:${callState.peerId}`]"
					:src="avatars[`u:${callState.peerId}`]"
					alt=""
				/>
				<MicrophoneIcon v-else />
			</span>
			<div class="msg2-call__text">
				<b>{{ callState.peerName || t('app.messenger.call.peer', 'Собеседник') }}</b>
				<small>{{ callStatusLabel() }}</small>
			</div>
			<div class="msg2-call__tools">
				<template v-if="callState.phase === 'incoming'">
					<button
						type="button"
						class="msg2-call__btn msg2-call__btn--ok"
						:title="t('app.messenger.call.accept', 'Принять')"
						@click="acceptIncoming()"
					>
						<CheckIcon />
					</button>
					<button
						type="button"
						class="msg2-call__btn msg2-call__btn--bad"
						:title="t('app.messenger.call.decline', 'Отклонить')"
						@click="declineIncoming()"
					>
						<XIcon />
					</button>
				</template>
				<template v-else>
					<button
						type="button"
						class="msg2-call__btn"
						:class="{ 'is-on': callState.muted }"
						:title="t('app.messenger.call.mute', 'Выключить микрофон')"
						@click="toggleCallMute()"
					>
						<MicrophoneIcon />
					</button>
					<button
						type="button"
						class="msg2-call__btn msg2-call__btn--bad"
						:title="t('app.messenger.call.hangup', 'Завершить')"
						@click="hangupCall()"
					>
						<XIcon />
					</button>
				</template>
			</div>
		</div>

		<!-- ===== Пересылка ===== -->
		<div v-if="forwardMsg" class="msg2-forward">
			<header>
				<b>{{ t('app.messenger.forwardTo', 'Переслать в…') }}</b>
				<button type="button" @click="forwardMsg = null"><XIcon /></button>
			</header>
			<button
				v-for="conv in dmChats"
				:key="`fw-${conv.id}`"
				type="button"
				class="msg2-row"
				@click="forwardTo(conv)"
			>
				<span class="msg2-row__ava">
					<img v-if="peerAvatar(conv.peer)" :src="peerAvatar(conv.peer)" alt="" />
					<span v-else class="msg2-row__letter">{{ conv.title.slice(0, 1) }}</span>
				</span>
				<span class="msg2-row__text"
					><b>{{ conv.title }}</b></span
				>
			</button>
		</div>

		<!-- ===== Контекстное меню ===== -->
		<Teleport to="body">
			<div v-if="menu" class="msg2-menu" :style="menuStyle" @click.stop>
				<div class="msg2-menu__reacts">
					<button
						v-for="emoji in ['❤️', '👍', '😂', '🔥', '😮', '😢']"
						:key="emoji"
						type="button"
						@click="reactMessage(menu.msg, emoji)"
					>
						{{ emoji }}
					</button>
				</div>
				<button type="button" @click="pinMessage(menu.msg, !menu.msg.pinned)">
					<PinIcon />
					{{
						menu.msg.pinned
							? t('app.messenger.unpinMessage', 'Открепить сообщение')
							: t('app.messenger.pinMessage', 'Закрепить сообщение')
					}}
				</button>
				<button type="button" @click="replyMessage(menu.msg)">
					<ReplyIcon />
					{{ t('app.messenger.reply', 'Ответить') }}
				</button>
				<button type="button" @click="forwardMsg = menu.msg">
					<ChevronRightIcon />
					{{ t('app.messenger.forward', 'Переслать') }}
				</button>
				<button type="button" @click="copyText(menu.msg.body)">
					<CopyIcon />
					{{ t('app.messenger.copyText', 'Копировать текст') }}
				</button>
				<button type="button" @click="copyText(menu.msg.id)">
					<CopyIcon />
					{{ t('app.messenger.copyId', 'Копировать ID сообщения') }}
				</button>
				<button v-if="!menu.msg.mine" type="button" class="is-bad" @click="reportMessage(menu.msg)">
					{{ t('app.messenger.report', 'Сообщить о нарушении') }}
				</button>
				<button v-if="menu.msg.mine" type="button" class="is-bad" @click="deleteMessage(menu.msg)">
					<TrashIcon />
					{{ t('app.messenger.deleteMessage', 'Удалить сообщение') }}
				</button>
			</div>
		</Teleport>

		<transition name="msg2-fade">
			<div v-if="toast" class="msg2-toast">{{ toast }}</div>
		</transition>

		<UserProfileModal ref="profileModal" @write="writeFromProfile" />
	</div>
</template>

<style scoped>
.msg2 {
	position: relative;
	display: flex;
	height: 100%;
	min-height: 0;
	background: #202020;
	color: #e8e8e8;
}

.msg2-state,
.msg2-gate {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	margin: auto;
	padding: 40px;
	text-align: center;
	max-width: 480px;
}

.msg2-gate svg {
	width: 42px;
	height: 42px;
	color: #5b8ed4;
}

.msg2-gate p {
	color: #9a9a9a;
	font-size: 13px;
	line-height: 1.5;
}

/* ===== 1. Рейл ===== */

.msg2-rail {
	display: flex;
	flex-direction: column;
	align-items: center;
	flex: none;
	width: 72px;
	background: #191919;
	border-right: 1px solid #2a2a2a;
	padding: 12px 0;
	gap: 8px;
}

.msg2-rail__scroll {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	width: 100%;
}

.msg2-rail__scroll::-webkit-scrollbar {
	width: 0;
}

.msg2-rail__home,
.msg2-rail__add {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 42px;
	height: 42px;
	flex: none;
	border: 0;
	border-radius: 12px;
	background: #272727;
	color: #b8b8b8;
	cursor: pointer;
	transition:
		background 0.15s,
		color 0.15s,
		border-radius 0.15s;
}

.msg2-rail__home:hover,
.msg2-rail__add:hover {
	background: #5b8ed4;
	color: #fff;
	border-radius: 12px;
}

.msg2-rail__home.is-on {
	background: #5b8ed4;
	color: #fff;
}

.msg2-rail__ava,
.msg2-rail__server {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 42px;
	height: 42px;
	flex: none;
	border: 0;
	border-radius: 50%;
	background: #272727;
	color: #d8d8d8;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	overflow: hidden;
	transition:
		border-radius 0.15s,
		background 0.15s;
}

.msg2-rail__server {
	border-radius: 12px;
}

.msg2-rail__ava:hover,
.msg2-rail__server:hover {
	border-radius: 10px;
	background: #5b8ed4;
}

.msg2-rail__server.is-on {
	border-radius: 10px;
	background: #5b8ed4;
	color: #fff;
}

.msg2-rail__ava img,
.msg2-rail__server img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.msg2-rail__dot {
	position: absolute;
	right: -1px;
	bottom: -1px;
	width: 11px;
	height: 11px;
	border-radius: 50%;
	background: #4a4a4a;
	border: 2px solid #191919;
}

.msg2-rail__dot.is-on {
	background: #4ac364;
}

.msg2-rail__sep {
	width: 32px;
	height: 1px;
	background: #2f2f2f;
	flex: none;
}

/* ===== 2. Список ===== */

.msg2-side {
	display: flex;
	flex-direction: column;
	flex: none;
	width: 274px;
	min-height: 0;
	background: #1f1f1f;
	border-right: 1px solid #2a2a2a;
}

.msg2-search {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 12px 12px 8px;
	padding: 0 10px;
	height: 34px;
	background: #1a1a1a;
	border: 1px solid #2b2b2b;
	border-radius: 8px;
	color: #8a8a8a;
}

.msg2-search input {
	flex: 1;
	min-width: 0;
	background: none;
	border: 0;
	outline: none;
	color: #e8e8e8;
	font-size: 13px;
}

.msg2-search input::placeholder {
	color: #6f6f6f;
}

.msg2-nav {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 0 8px;
}

.msg2-nav button {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 7px 10px;
	border: 0;
	border-radius: 8px;
	background: none;
	color: #b8b8b8;
	font-size: 14px;
	text-align: left;
	cursor: pointer;
}

.msg2-nav button:hover {
	background: #272727;
	color: #fff;
}

.msg2-nav button.is-on {
	background: #272727;
	color: #fff;
}

.msg2-nav__badge {
	margin-left: auto;
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 9px;
	background: #4ac364;
	color: #10240f;
	font-size: 11px;
	font-weight: 700;
}

.msg2-nav__badge--red {
	background: #d93838;
	color: #fff;
}

.msg2-side__scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 8px;
}

.msg2-side__foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px 12px;
	border-top: 1px solid #2a2a2a;
}

.msg2-refresh {
	display: flex;
	align-items: center;
	gap: 6px;
	border: 0;
	background: none;
	color: #9a9a9a;
	font-size: 12px;
	cursor: pointer;
}

.msg2-refresh:hover {
	color: #fff;
}

.msg2-signout {
	border: 0;
	background: none;
	color: #777;
	font-size: 11px;
	cursor: pointer;
}

.msg2-signout:hover {
	color: #d93838;
}

.msg2-sec {
	padding: 10px 8px 4px;
	color: #8a8a8a;
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.msg2-sub {
	padding: 8px 8px 2px;
	color: #6f6f6f;
	font-size: 11px;
	font-weight: 600;
}

.msg2-row {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 6px 8px;
	border: 0;
	border-radius: 8px;
	background: none;
	color: #d8d8d8;
	text-align: left;
	cursor: pointer;
}

.msg2-row:hover {
	background: #272727;
}

.msg2-row.is-on {
	background: #2f2f2f;
}

.msg2-row__ava {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	flex: none;
	border-radius: 50%;
	background: #2f2f2f;
	overflow: visible;
}

.msg2-row__ava img {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	object-fit: cover;
}

.msg2-row__ava--square img,
.msg2-row__ava--square {
	border-radius: 8px;
}

.msg2-row__letter {
	font-size: 13px;
	font-weight: 700;
	color: #b0b0b0;
}

.msg2-row__status {
	position: absolute;
	right: -2px;
	bottom: -2px;
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: #4ac364;
	border: 2px solid #1f1f1f;
}

.msg2-row__status.is-off {
	background: #6a6a6a;
}

.msg2-row__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
	flex: 1;
}

.msg2-row__text b {
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msg2-row__text small {
	font-size: 12px;
	color: #8f8f8f;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msg2-row__badge {
	flex: none;
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 9px;
	background: #d93838;
	color: #fff;
	font-size: 11px;
	font-weight: 700;
}

.msg2-empty {
	padding: 14px 10px;
	color: #777;
	font-size: 13px;
	line-height: 1.5;
}

/* ===== 3. Чат ===== */

.msg2-main {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	min-height: 0;
}

.msg2-head {
	display: flex;
	align-items: center;
	gap: 10px;
	height: 48px;
	flex: none;
	padding: 0 12px;
	border-bottom: 1px solid #2a2a2a;
	background: #202020;
}

.msg2-head__ava {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: #2f2f2f;
	overflow: visible;
}

.msg2-head__ava img {
	width: 24px;
	height: 24px;
	border-radius: 50%;
	object-fit: cover;
}

.msg2-head__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.msg2-head__text b {
	font-size: 14px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msg2-head__text small {
	font-size: 11px;
	color: #8f8f8f;
}

.msg2-head__tools {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-left: auto;
}

.msg2-head__search {
	width: 160px;
	height: 28px;
	padding: 0 10px;
	background: #1a1a1a;
	border: 1px solid #2b2b2b;
	border-radius: 8px;
	color: #e8e8e8;
	font-size: 12px;
	outline: none;
}

.msg2-iconbtn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 30px;
	height: 30px;
	border: 0;
	border-radius: 8px;
	background: none;
	color: #9a9a9a;
	cursor: pointer;
}

.msg2-iconbtn:hover {
	background: #2f2f2f;
	color: #fff;
}

.msg2-iconbtn.is-on {
	background: #2f2f2f;
	color: #fff;
}

.msg2-iconbtn:disabled {
	opacity: 0.4;
	cursor: default;
}

.msg2-iconbtn--ok {
	color: #4ac364;
}

.msg2-iconbtn--bad {
	color: #d93838;
}

.msg2-pins {
	max-height: 200px;
	overflow-y: auto;
	background: #1d1d1d;
	border-bottom: 1px solid #2a2a2a;
	padding: 6px 12px;
}

.msg2-pins__row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 0;
	font-size: 13px;
	color: #c8c8c8;
	border-bottom: 1px solid #262626;
}

.msg2-pins__row svg {
	color: #faa81a;
	flex: none;
}

.msg2-pins__row span {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: #8f8f8f;
}

.msg2-pins__row button {
	border: 0;
	background: none;
	color: #8f8f8f;
	font-size: 12px;
	cursor: pointer;
}

.msg2-pins__row button:hover {
	color: #fff;
}

.msg2-pins__empty {
	padding: 8px 0;
	color: #777;
	font-size: 13px;
}

.msg2-thread {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 12px 0 8px;
}

.msg2-thread__state {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	height: 100%;
	color: #777;
	font-size: 14px;
}

.msg2-date {
	display: flex;
	align-items: center;
	gap: 12px;
	margin: 12px 16px 6px;
	color: #8f8f8f;
	font-size: 11px;
	font-weight: 600;
}

.msg2-date::before,
.msg2-date::after {
	content: '';
	flex: 1;
	height: 1px;
	background: #2a2a2a;
}

.msg2-new {
	display: flex;
	align-items: center;
	gap: 10px;
	margin: 8px 16px;
	color: #d93838;
	font-size: 11px;
	font-weight: 700;
}

.msg2-new::before {
	content: '';
	flex: 1;
	height: 1px;
	background: #d93838;
}

.msg2-mrow {
	padding: 0;
}

.msg2-mrow.is-group .msg2-msg {
	padding-top: 1px;
}

.msg2-msg {
	position: relative;
	display: flex;
	gap: 12px;
	padding: 3px 16px 3px 12px;
}

.msg2-msg:hover {
	background: #232323;
}

.msg2-msg.is-pinned {
	background: #24221c;
}

.msg2-msg__ava {
	display: flex;
	align-items: flex-start;
	flex: none;
	width: 40px;
}

.msg2-msg__ava img {
	width: 40px;
	height: 40px;
	border-radius: 50%;
	object-fit: cover;
}

.msg2-msg__ava .msg2-row__letter {
	width: 40px;
	height: 40px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	background: #2f2f2f;
	font-size: 15px;
}

.msg2-msg__body {
	flex: 1;
	min-width: 0;
}

.msg2-msg__head {
	display: flex;
	align-items: baseline;
	gap: 8px;
	margin-bottom: 1px;
}

.msg2-msg__name {
	border: 0;
	background: none;
	padding: 0;
	color: #fff;
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
}

.msg2-msg__name:hover {
	text-decoration: underline;
}

.msg2-msg__head time {
	color: #777;
	font-size: 11px;
}

.msg2-msg__text {
	margin: 0;
	font-size: 14px;
	line-height: 1.45;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.msg2-reply {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 2px;
	padding: 2px 8px;
	border-left: 2px solid #4a4a4a;
	background: #262626;
	border-radius: 4px;
	font-size: 12px;
	color: #8f8f8f;
	white-space: nowrap;
	overflow: hidden;
}

.msg2-reply b {
	color: #b8b8b8;
}

.msg2-msg__att {
	display: block;
	margin-top: 4px;
}

.msg2-msg__att img {
	max-width: 400px;
	max-height: 300px;
	border-radius: 8px;
	display: block;
}

.msg2-reacts {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 4px;
}

.msg2-react {
	border: 1px solid #2f2f2f;
	border-radius: 8px;
	background: #262626;
	padding: 2px 8px;
	color: #d8d8d8;
	font-size: 12px;
	cursor: pointer;
}

.msg2-react.is-me {
	border-color: #5b8ed4;
	background: #25304a;
}

.msg2-msg__tools {
	position: absolute;
	top: -14px;
	right: 16px;
	display: none;
	align-items: center;
	gap: 2px;
	padding: 2px;
	background: #272727;
	border: 1px solid #2f2f2f;
	border-radius: 8px;
}

.msg2-msg:hover .msg2-msg__tools,
.msg2-menu-open .msg2-msg__tools {
	display: flex;
}

.msg2-msg__tools button {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	border: 0;
	border-radius: 6px;
	background: none;
	color: #b8b8b8;
	font-size: 13px;
	cursor: pointer;
}

.msg2-msg__tools button:hover {
	background: #333;
	color: #fff;
}

.msg2-replybar {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0 12px;
	padding: 6px 10px;
	background: #262626;
	border: 1px solid #2b2b2b;
	border-bottom: 0;
	border-radius: 8px 8px 0 0;
	color: #8f8f8f;
	font-size: 12px;
}

.msg2-replybar span {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msg2-replybar b {
	color: #d8d8d8;
	margin-right: 6px;
}

.msg2-replybar button {
	border: 0;
	background: none;
	color: #9a9a9a;
	cursor: pointer;
}

.msg2-composer {
	flex: none;
	padding: 0 12px 14px;
}

.msg2-attachbar {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 6px;
	padding: 6px 12px;
	background: #262626;
	border: 1px solid #2b2b2b;
	border-radius: 10px;
	font-size: 13px;
	color: #b8b8b8;
}

.msg2-attachbar button {
	margin-left: auto;
	border: 0;
	background: none;
	color: #9a9a9a;
	cursor: pointer;
}

.msg2-composer__row {
	display: flex;
	align-items: center;
	gap: 4px;
	background: #272727;
	border: 1px solid #2b2b2b;
	border-radius: 12px;
	padding: 4px 6px;
}

.msg2-composer__input {
	flex: 1;
	min-width: 0;
	height: 34px;
	background: none;
	border: 0;
	outline: none;
	color: #e8e8e8;
	font-size: 14px;
	padding: 0 8px;
}

.msg2-composer__input::placeholder {
	color: #6f6f6f;
}

.msg2-composer__tools {
	display: flex;
	align-items: center;
	gap: 4px;
}

.msg2-send {
	color: #5b8ed4;
}

.msg2-send:disabled {
	color: #4a5a70;
	cursor: default;
}

.msg2-emoji {
	display: flex;
	flex-wrap: wrap;
	gap: 2px;
	margin-top: 6px;
	padding: 8px;
	background: #272727;
	border: 1px solid #2b2b2b;
	border-radius: 12px;
}

.msg2-emoji button {
	width: 34px;
	height: 34px;
	border: 0;
	border-radius: 8px;
	background: none;
	font-size: 18px;
	cursor: pointer;
}

.msg2-emoji button:hover {
	background: #333;
}

/* ===== 3б. Друзья ===== */

.msg2-friends {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	min-height: 0;
}

.msg2-friends__head {
	display: flex;
	align-items: center;
	gap: 10px;
	height: 48px;
	flex: none;
	padding: 0 16px;
	border-bottom: 1px solid #2a2a2a;
	color: #9a9a9a;
}

.msg2-friends__head b {
	color: #fff;
	font-size: 15px;
}

.msg2-friends__tabs {
	display: flex;
	gap: 4px;
	margin-left: auto;
}

.msg2-friends__tabs button {
	padding: 5px 10px;
	border: 0;
	border-radius: 8px;
	background: none;
	color: #9a9a9a;
	font-size: 13px;
	cursor: pointer;
}

.msg2-friends__tabs button:hover {
	background: #272727;
	color: #fff;
}

.msg2-friends__tabs button.is-on {
	background: #2f2f2f;
	color: #fff;
}

.msg2-friends__list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 10px 16px;
}

.msg2-person {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 8px;
	border-radius: 8px;
}

.msg2-person:hover {
	background: #272727;
}

.msg2-person__ava {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	flex: none;
	border-radius: 50%;
	background: #2f2f2f;
}

.msg2-person__ava img {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	object-fit: cover;
}

.msg2-person__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
	flex: 1;
}

.msg2-person__text b {
	font-size: 14px;
	font-weight: 600;
}

.msg2-person__text small {
	font-size: 12px;
	color: #8f8f8f;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msg2-person__tools {
	display: flex;
	align-items: center;
	gap: 4px;
}

/* ===== 4. Профиль ===== */

.msg2-profile {
	display: flex;
	flex-direction: column;
	align-items: center;
	flex: none;
	width: 260px;
	min-height: 0;
	overflow-y: auto;
	background: #1f1f1f;
	border-left: 1px solid #2a2a2a;
	padding: 24px 16px;
	gap: 6px;
}

.msg2-profile__ava img {
	width: 80px;
	height: 80px;
	border-radius: 16px;
	object-fit: cover;
}

.msg2-profile__name {
	margin-top: 8px;
	font-size: 16px;
	color: #fff;
}

.msg2-profile__tag {
	color: #777;
	font-size: 13px;
}

.msg2-profile__btn {
	width: 100%;
	margin-top: 10px;
	padding: 8px;
	border: 1px solid #2f2f2f;
	border-radius: 8px;
	background: #272727;
	color: #d8d8d8;
	font-size: 13px;
	cursor: pointer;
}

.msg2-profile__btn:hover {
	background: #2f2f2f;
	color: #fff;
}

.msg2-profile__row {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	margin-top: 10px;
	padding: 8px 10px;
	border: 1px solid #2f2f2f;
	border-radius: 8px;
	background: #272727;
	color: #b8b8b8;
	font-size: 13px;
	cursor: pointer;
}

.msg2-profile__row span {
	flex: 1;
}

.msg2-profile__activity {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 8px 6px;
	border-radius: 8px;
	cursor: pointer;
}

.msg2-profile__activity:hover {
	background: #272727;
}

.msg2-profile__activity small {
	display: block;
	color: #8f8f8f;
	font-size: 12px;
}

.msg2-profile--list {
	align-items: stretch;
}

.msg2-profile--list > b {
	font-size: 13px;
	color: #9a9a9a;
	text-transform: uppercase;
}

/* ===== Миры ===== */

.msg2-worlds {
	position: absolute;
	left: 346px;
	top: 60px;
	z-index: 30;
	width: 300px;
	max-height: 420px;
	overflow-y: auto;
	background: #1d1d1d;
	border: 1px solid #2f2f2f;
	border-radius: 12px;
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
	padding: 8px;
}

.msg2-worlds header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 6px 8px;
	color: #d8d8d8;
}

.msg2-worlds header button {
	border: 0;
	background: none;
	color: #9a9a9a;
	cursor: pointer;
}

.msg2-worlds__row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px;
	border-radius: 8px;
}

.msg2-worlds__row:hover {
	background: #272727;
}

.msg2-worlds__row small {
	display: block;
	color: #8f8f8f;
	font-size: 12px;
}

.msg2-worlds__row code {
	color: #5b8ed4;
	font-size: 11px;
}

/* ===== Звонок ===== */

.msg2-call {
	position: absolute;
	right: 276px;
	bottom: 18px;
	z-index: 40;
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 250px;
	padding: 10px 12px;
	background: #1d1d1d;
	border: 1px solid #2f2f2f;
	border-radius: 12px;
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

.msg2-call.is-incoming {
	border-color: #4ac364;
}

.msg2-call__ava {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	flex: none;
	border-radius: 50%;
	background: #2f2f2f;
	color: #9a9a9a;
	overflow: hidden;
}

.msg2-call__ava img {
	width: 36px;
	height: 36px;
	object-fit: cover;
}

.msg2-call__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
	flex: 1;
}

.msg2-call__text b {
	font-size: 13px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msg2-call__text small {
	color: #8f8f8f;
	font-size: 11px;
}

.msg2-call__tools {
	display: flex;
	gap: 6px;
}

.msg2-call__btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border: 0;
	border-radius: 50%;
	background: #2f2f2f;
	color: #d8d8d8;
	cursor: pointer;
}

.msg2-call__btn:hover {
	background: #3a3a3a;
}

.msg2-call__btn.is-on {
	background: #d93838;
	color: #fff;
}

.msg2-call__btn--ok {
	background: #4ac364;
	color: #10240f;
}

.msg2-call__btn--bad {
	background: #d93838;
	color: #fff;
}

/* ===== Пересылка ===== */

.msg2-forward {
	position: absolute;
	left: 50%;
	top: 80px;
	transform: translateX(-50%);
	z-index: 40;
	width: 320px;
	max-height: 420px;
	overflow-y: auto;
	background: #1d1d1d;
	border: 1px solid #2f2f2f;
	border-radius: 12px;
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
	padding: 8px;
}

.msg2-forward header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 6px 8px;
	color: #d8d8d8;
}

.msg2-forward header button {
	border: 0;
	background: none;
	color: #9a9a9a;
	cursor: pointer;
}

/* ===== Меню ===== */

.msg2-menu {
	position: fixed;
	z-index: 100;
	min-width: 220px;
	background: #1d1d1d;
	border: 1px solid #2f2f2f;
	border-radius: 10px;
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
	padding: 6px;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.msg2-menu__reacts {
	display: flex;
	gap: 2px;
	padding: 4px 6px 8px;
	border-bottom: 1px solid #2a2a2a;
	margin-bottom: 4px;
}

.msg2-menu__reacts button {
	width: 32px;
	height: 32px;
	border: 0;
	border-radius: 8px;
	background: none;
	font-size: 16px;
	cursor: pointer;
}

.msg2-menu__reacts button:hover {
	background: #2f2f2f;
}

.msg2-menu > button {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 7px 10px;
	border: 0;
	border-radius: 6px;
	background: none;
	color: #d8d8d8;
	font-size: 13px;
	text-align: left;
	cursor: pointer;
}

.msg2-menu > button:hover {
	background: #2f2f2f;
}

.msg2-menu > button.is-bad {
	color: #d93838;
}

/* ===== Прочее ===== */

.msg2-toast {
	position: absolute;
	left: 50%;
	bottom: 24px;
	transform: translateX(-50%);
	z-index: 60;
	padding: 9px 16px;
	background: #1d1d1d;
	border: 1px solid #2f2f2f;
	border-radius: 10px;
	color: #d8d8d8;
	font-size: 13px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	pointer-events: none;
}

.msg2-fade-enter-active,
.msg2-fade-leave-active {
	transition: opacity 0.2s;
}

.msg2-fade-enter-from,
.msg2-fade-leave-to {
	opacity: 0;
}

.msg2-spinner {
	width: 16px;
	height: 16px;
	border-radius: 50%;
	border: 2px solid #3a3a3a;
	border-top-color: #5b8ed4;
	animation: msg2-spin 0.8s linear infinite;
	flex: none;
}

@keyframes msg2-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
