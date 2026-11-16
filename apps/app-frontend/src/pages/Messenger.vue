<script setup lang="ts">
import {
	MessagesSquareIcon,
	RefreshCwIcon,
	SearchIcon,
	SendIcon,
	UserIcon,
	UserPlusIcon,
} from '@modrinth/assets'
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'

import UserProfileModal from '@/components/ui/messenger/UserProfileModal.vue'
import {
	ensureServiceSession,
	forgetServiceSession,
	type LooseRecord,
	resolveAvatar,
	resolveServiceMedia,
	serviceRequest,
	type ServiceSession,
	serviceStreamUrl,
	type ServiceUser,
} from '@/helpers/uprojects-service'
import { useRootBreadcrumb } from '@/shared/breadcrumbs'

defineOptions({ name: 'MessengerPage' })

const { formatMessage } = useVIntl()
const messages = defineMessages({
	heading: { id: 'app.messenger.heading', defaultMessage: 'MC Messenger' },
})

const breadcrumb = useRootBreadcrumb({
	slot: 'root',
	id: 'messenger',
	label: () => formatMessage(messages.heading),
	to: '/messenger',
	visual: { type: 'icon', component: MessagesSquareIcon },
})

type Conversation = {
	id: string
	title: string
	peerId?: string
	avatar?: string
	preview?: string
	updatedAt?: number
}

type FriendRow = {
	id: string
	name: string
	status: 'friends' | 'incoming' | 'outgoing'
	avatar?: string
}

type ChatMessage = {
	id: string
	text: string
	senderId: string
	senderName: string
	mine: boolean
	time: string
	attachment?: string
}

const session = ref<ServiceSession | null>(null)
const loading = ref(true)
const loadError = ref('')

const railTab = ref<'chats' | 'friends'>('chats')
const conversations = ref<Conversation[]>([])
const friends = ref<FriendRow[]>([])
const incoming = ref<FriendRow[]>([])

const searchQuery = ref('')
const searchResults = ref<ServiceUser[]>([])
const searching = ref(false)

const activeId = ref('')
const thread = ref<ChatMessage[]>([])
const threadLoading = ref(false)
const activePeerName = computed(
	() => conversations.value.find((chat) => chat.id === activeId.value)?.title || '',
)
/** Собеседник активного чата — для полного профиля из заголовка. */
const activePeer = computed(() => {
	const chat = conversations.value.find((row) => row.id === activeId.value)
	if (!chat?.peerId) return null
	return { id: chat.peerId, username: chat.title }
})
const draft = ref('')
const sending = ref(false)

const refreshing = ref(false)

const threadEl = ref<HTMLElement | null>(null)

const searchTimer = ref<ReturnType<typeof setTimeout> | null>(null)

function timeLabel(raw: string): string {
	const date = new Date(raw)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

type AvatarUser = {
	skinUrl?: string | null
	avatar?: string | null
	uuid?: string
	username?: string
	name?: string
	sender_avatar_url?: string | null
	avatar_url?: string | null
}

const railAvatarStore: Record<string, string> = {}
const threadAvatarStore: Record<string, string> = {}
const avatarVersion = ref(0)

function avatarUrl(store: Record<string, string>, version: number, key: string): string {
	// version — зависимость для реактивности: хранилище обычное, но при его
	// пополнении счётчик растёт (в шаблоне он читается), и аватарки перечитываются.
	void version
	return store[key] || ''
}

async function avatarFor(
	store: Record<string, string>,
	key: string,
	user: AvatarUser,
): Promise<string> {
	if (store[key]) return store[key]
	const url = await resolveAvatar({
		skinUrl: user.skinUrl ?? user.sender_avatar_url ?? user.avatar_url ?? null,
		avatar: user.avatar ?? user.sender_avatar_url ?? user.avatar_url ?? null,
		uuid: user.uuid,
		username: user.username,
		name: user.name,
	})
	if (url) {
		store[key] = url
		avatarVersion.value += 1
	}
	return url
}

function conversationTitle(raw: LooseRecord): string {
	if (raw?.name) return String(raw.name)
	if (raw?.title) return String(raw.title)
	const peer = raw?.peer || raw?.user || raw?.members?.[0]
	if (peer?.username || peer?.name) return String(peer.username || peer.name)
	return formatMessage({ id: 'app.messenger.unnamedChat', defaultMessage: 'Беседа' })
}

async function loadLists() {
	const [chatResponse, friendResponse] = await Promise.all([
		serviceRequest('/conversations', { query: { limit: 100 } }),
		serviceRequest('/friends'),
	])
	const rawChats = chatResponse.ok ? (chatResponse.data?.conversations ?? chatResponse.data) : []
	const mapped: Conversation[] = []
	for (const chat of Array.isArray(rawChats) ? rawChats : []) {
		if (!chat?.id) continue
		const peer = chat.peer || chat.user || null
		const entry: Conversation = {
			id: String(chat.id),
			title: conversationTitle(chat),
			peerId: peer?.id != null ? String(peer.id) : undefined,
			avatar: resolveServiceMedia(peer?.avatar || peer?.skinUrl || chat.avatar || null),
			preview: String(chat.last_message?.text || chat.last_message?.body || chat.preview || ''),
			updatedAt:
				Date.parse(String(chat.updated_at || chat.last_message?.created_at || '')) || undefined,
		}
		mapped.push(entry)
		const key = `chat:${entry.id}`
		if (peer) {
			void avatarFor(railAvatarStore, key, {
				skinUrl: peer.skinUrl ?? peer.avatar_url ?? null,
				avatar: peer.avatar ?? peer.avatar_url ?? null,
				uuid: peer.uuid,
				username: peer.username,
				name: peer.name,
			})
		}
	}
	mapped.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
	conversations.value = mapped

	if (friendResponse.ok) {
		const mapFriend = (row: LooseRecord, status: FriendRow['status']): FriendRow | null =>
			row?.id || row?.user?.id
				? {
						id: String(row.user?.id ?? row.id),
						name: String(row.user?.username || row.user?.name || row.username || row.name || ''),
						status,
						avatar: resolveServiceMedia(
							row.user?.skinUrl || row.user?.avatar || row.skinUrl || row.avatar || null,
						),
					}
				: null
		friends.value = (friendResponse.data?.friends || [])
			.map((row: LooseRecord) => mapFriend(row, 'friends'))
			.filter(Boolean) as FriendRow[]
		incoming.value = (friendResponse.data?.incoming || [])
			.map((row: LooseRecord) => mapFriend(row, 'incoming'))
			.filter(Boolean) as FriendRow[]
	}
	for (const friend of [...friends.value, ...incoming.value]) {
		void avatarFor(railAvatarStore, `friend:${friend.id}`, {
			avatar: friend.avatar,
			uuid: friend.id,
			username: friend.name,
		})
	}
}

function mapMessage(row: LooseRecord, myId: string): ChatMessage | null {
	const id = row?.id ?? row?.message_id
	if (!id) return null
	const senderId = String(row.sender_id ?? row.user?.id ?? row.author?.id ?? '')
	return {
		id: String(id),
		text: String(row.body ?? row.text ?? ''),
		senderId,
		senderName: String(row.sender_username ?? row.user?.username ?? row.author?.username ?? ''),
		mine: senderId === myId,
		time: timeLabel(String(row.created_at ?? row.createdAt ?? '')),
		attachment:
			resolveServiceMedia(row.attachment_url || row.file_url || row.attachment?.url || null) ||
			undefined,
	}
}

async function openChat(chat: Conversation) {
	activeId.value = chat.id
	threadLoading.value = true
	thread.value = []
	await nextTick()
	scrollThread()
	try {
		const response = await serviceRequest(
			`/conversations/${encodeURIComponent(chat.id)}/messages`,
			{
				query: { limit: 80 },
			},
		)
		const myId = String(session.value?.user?.id ?? '')
		thread.value = (Array.isArray(response.data?.messages) ? response.data.messages : [])
			.map((row: LooseRecord) => mapMessage(row, myId))
			.filter(Boolean) as ChatMessage[]
		for (const message of thread.value) {
			const key = `msg:${message.senderId}`
			if (!threadAvatarStore[key]) {
				void avatarFor(threadAvatarStore, key, {
					avatar_url: message.mine
						? (session.value?.user?.avatar ?? session.value?.user?.skinUrl ?? null)
						: null,
					username: message.senderName,
				})
			}
		}
		void serviceRequest(`/conversations/${encodeURIComponent(chat.id)}/read`, {
			method: 'POST',
			body: {},
		})
	} finally {
		threadLoading.value = false
		await nextTick()
		scrollThread()
	}
}

async function sendDraft() {
	const text = draft.value.trim()
	if (!text || !activeId.value || sending.value) return
	sending.value = true
	try {
		const response = await serviceRequest(
			`/conversations/${encodeURIComponent(activeId.value)}/messages`,
			{ method: 'POST', body: { body: text } },
		)
		if (response.ok) {
			draft.value = ''
			const myId = String(session.value?.user?.id ?? '')
			const raw = response.data?.message || response.data
			const sent = raw ? mapMessage(raw, myId) : null
			if (sent) thread.value.push(sent)
			else {
				const chat = conversations.value.find((row) => row.id === activeId.value)
				if (chat) await openChat(chat)
			}
			await nextTick()
			scrollThread()
			await loadLists()
		}
	} finally {
		sending.value = false
	}
}

async function acceptFriend(friend: FriendRow) {
	await serviceRequest(`/friends/${encodeURIComponent(friend.id)}/accept`, {
		method: 'POST',
		body: {},
	})
	await loadLists()
}

async function declineFriend(friend: FriendRow) {
	await serviceRequest(`/friends/${encodeURIComponent(friend.id)}/decline`, {
		method: 'POST',
		body: {},
	})
	await loadLists()
}

async function addFriend(user: ServiceUser) {
	if (!user.id) return
	await serviceRequest(`/friends/${encodeURIComponent(String(user.id))}/request`, {
		method: 'POST',
		body: {},
	})
	await loadLists()
}

async function startDm(user: ServiceUser) {
	const response = await serviceRequest('/conversations/dm', {
		method: 'POST',
		body: { userId: user.id },
	})
	await loadLists()
	if (response.ok) {
		const id = String(
			response.data?.conversation?.id ?? response.data?.id ?? response.data?.conversationId ?? '',
		)
		const chat = conversations.value.find((row) => row.id === id)
		if (chat) {
			railTab.value = 'chats'
			await openChat(chat)
		}
	}
}

function runSearch() {
	if (!searchTimer.value) {
		searchTimer.value = setTimeout(async () => {
			searchTimer.value = null
			if (searchQuery.value.trim().length < 2) {
				searchResults.value = []
				return
			}
			searching.value = true
			try {
				const response = await serviceRequest('/users/search', {
					query: { q: searchQuery.value.trim(), limit: 8 },
				})
				searchResults.value = Array.isArray(response.data?.users) ? response.data.users : []
			} finally {
				searching.value = false
			}
		}, 400)
	}
}

let stream: EventSource | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let streamRetries = 0

function stopLive() {
	if (stream) {
		stream.close()
		stream = null
	}
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

function startLive(token: string) {
	stopLive()
	try {
		stream = new EventSource(serviceStreamUrl(token))
		const source = stream
		source.addEventListener('message', () => void livePulse())
		source.addEventListener('conversation_updated', () => void livePulse())
		source.addEventListener('friend', () => void loadLists())
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

async function livePulse() {
	if (!session.value || refreshing.value) return
	refreshing.value = true
	try {
		await loadLists()
		if (activeId.value) {
			const chat = conversations.value.find((row) => row.id === activeId.value)
			if (chat) await openChat(chat)
		}
	} finally {
		refreshing.value = false
	}
}

function scrollThread() {
	const element = threadEl.value
	if (element) element.scrollTop = element.scrollHeight
}

const profileModal = ref<InstanceType<typeof UserProfileModal> | null>(null)

const openProfileLabel = formatMessage({
	id: 'app.messenger.profile.open',
	defaultMessage: 'Открыть профиль',
})

/** Полный профиль игрока: карточка со скином, игровой активностью и маркером. */
function openProfile(user: {
	id?: string | number
	username?: string
	name?: string
	uuid?: string
}) {
	if (user.id == null || user.id === '') return
	const selfId = session.value?.user?.id
	profileModal.value?.show(
		{
			id: String(user.id),
			username: user.username,
			name: user.name,
			uuid: user.uuid,
		},
		{
			canWrite: true,
			self: selfId != null && String(selfId) === String(user.id),
		},
	)
}

async function writeFromProfile(user: { id: string; username?: string; name?: string }) {
	await startDm({ id: user.id, username: user.username || user.name })
}

async function connect(force = false) {
	loading.value = true
	loadError.value = ''
	try {
		const ready = await ensureServiceSession(force)
		session.value = ready
		if (!ready) return
		await loadLists()
		startLive(ready.token)
		if (conversations.value.length) await openChat(conversations.value[0])
	} catch (error) {
		loadError.value = error instanceof Error ? error.message : 'network'
	} finally {
		loading.value = false
	}
}

onMounted(() => {
	void connect()
})

onActivated(breadcrumb.reset)

onDeactivated(stopLive)
onUnmounted(stopLive)

async function signOut() {
	forgetServiceSession()
	session.value = null
	conversations.value = []
	friends.value = []
	incoming.value = []
	thread.value = []
	activeId.value = ''
	stopLive()
	await connect(true)
}
</script>

<template>
	<div class="msgr">
		<div class="msgr-head">
			<span class="msgr-title">{{ formatMessage(messages.heading) }}</span>
			<button
				v-if="session"
				class="msgr-refresh"
				:class="{ 'is-busy': refreshing }"
				aria-label="Обновить"
				@click="livePulse"
			>
				<RefreshCwIcon v-if="!refreshing" />
				<span v-else class="msgr-spinner" />
			</button>
		</div>

		<div v-if="loading" class="msgr-state">
			{{
				formatMessage({ id: 'app.messenger.loading', defaultMessage: 'Соединяемся с сервисом…' })
			}}
		</div>

		<div v-else-if="!session" class="msgr-gate">
			<MessagesSquareIcon />
			<b>{{ formatMessage({ id: 'app.messenger.gateTitle', defaultMessage: 'MC Messenger' }) }}</b>
			<p>
				{{
					formatMessage({
						id: 'app.messenger.gateText',
						defaultMessage:
							'Чаты и друзья прямо в лаунчере — как у Undefined Client. Нужен аккаунт Microsoft или Ely.by: мессенджер общий, переписка видна и их игрокам, и нашим. Написано на их живом сервисе — обновления придут сами.',
					})
				}}
			</p>
			<Button @click="connect(true)">
				{{ formatMessage({ id: 'app.messenger.retry', defaultMessage: 'Подключить аккаунт' }) }}
			</Button>
		</div>

		<div v-else class="msgr-body">
			<aside class="msgr-rail">
				<div class="msgr-rail__tabs">
					<button :class="{ 'is-on': railTab === 'chats' }" @click="railTab = 'chats'">
						{{ formatMessage({ id: 'app.messenger.tabChats', defaultMessage: 'Чаты' }) }}
					</button>
					<button :class="{ 'is-on': railTab === 'friends' }" @click="railTab = 'friends'">
						{{ formatMessage({ id: 'app.messenger.tabFriends', defaultMessage: 'Друзья' }) }}
					</button>
				</div>

				<template v-if="railTab === 'chats'">
					<TransitionGroup v-if="conversations.length" name="msgr-pop" tag="div" class="msgr-list">
						<button
							v-for="chat in conversations"
							:key="chat.id"
							class="msgr-row"
							:class="{ 'is-on': chat.id === activeId }"
							@click="openChat(chat)"
						>
							<img
								v-if="avatarUrl(railAvatarStore, avatarVersion, `chat:${chat.id}`)"
								:src="avatarUrl(railAvatarStore, avatarVersion, `chat:${chat.id}`)"
								alt=""
							/>
							<span v-else class="msgr-row__stub" />
							<span class="msgr-row__text">
								<b>{{ chat.title }}</b>
								<small>{{ chat.preview }}</small>
							</span>
						</button>
					</TransitionGroup>
					<p v-else class="msgr-empty">
						{{
							formatMessage({
								id: 'app.messenger.noChats',
								defaultMessage: 'Чатов пока нет — найдите друга во вкладке «Друзья».',
							})
						}}
					</p>
				</template>

				<template v-else>
					<label class="msgr-search">
						<SearchIcon />
						<input
							v-model="searchQuery"
							:placeholder="
								formatMessage({
									id: 'app.messenger.searchPlaceholder',
									defaultMessage: 'Ник игрока…',
								})
							"
							@input="runSearch"
						/>
					</label>
					<div v-if="searchResults.length" class="msgr-list">
						<div
							v-for="user in searchResults"
							:key="`search-${user.id}`"
							class="msgr-row msgr-row--static"
						>
							<span class="msgr-row__stub" />
							<span class="msgr-row__text"
								><b>{{ user.username || user.name }}</b></span
							>
							<button class="msgr-mini" :aria-label="openProfileLabel" @click="openProfile(user)">
								<UserIcon />
							</button>
							<button class="msgr-mini" @click="addFriend(user)">
								<UserPlusIcon />
							</button>
							<button class="msgr-mini" @click="startDm(user)">
								<MessagesSquareIcon />
							</button>
						</div>
					</div>

					<div v-if="incoming.length" class="msgr-requests">
						<b>{{ formatMessage({ id: 'app.messenger.requests', defaultMessage: 'Заявки' }) }}</b>
						<div
							v-for="friend in incoming"
							:key="`in-${friend.id}`"
							class="msgr-row msgr-row--static"
						>
							<span class="msgr-row__stub" />
							<span class="msgr-row__text"
								><b>{{ friend.name }}</b></span
							>
							<button class="msgr-mini msgr-mini--ok" @click="acceptFriend(friend)">✓</button>
							<button class="msgr-mini" @click="declineFriend(friend)">✕</button>
						</div>
					</div>

					<TransitionGroup v-if="friends.length" name="msgr-pop" tag="div" class="msgr-list">
						<div
							v-for="friend in friends"
							:key="friend.id"
							class="msgr-row"
							role="button"
							tabindex="0"
							:class="{
								'is-on': friend.id === conversations.find((chat) => chat.id === activeId)?.peerId,
							}"
							@click="startDm({ id: friend.id, username: friend.name })"
							@keydown.enter="startDm({ id: friend.id, username: friend.name })"
						>
							<img
								v-if="avatarUrl(railAvatarStore, avatarVersion, `friend:${friend.id}`)"
								:src="avatarUrl(railAvatarStore, avatarVersion, `friend:${friend.id}`)"
								alt=""
							/>
							<span v-else class="msgr-row__stub" />
							<span class="msgr-row__text"
								><b>{{ friend.name }}</b></span
							>
							<button
								class="msgr-mini"
								:aria-label="openProfileLabel"
								@click.stop="openProfile(friend)"
							>
								<UserIcon />
							</button>
						</div>
					</TransitionGroup>
					<p v-else class="msgr-empty">
						{{
							formatMessage({
								id: 'app.messenger.noFriends',
								defaultMessage: 'Пока никого. Найдите игрока по нику выше.',
							})
						}}
					</p>
				</template>

				<button class="msgr-logout" @click="signOut">
					{{ formatMessage({ id: 'app.messenger.logout', defaultMessage: 'Выйти из сессии' }) }}
				</button>
			</aside>

			<section class="msgr-chat">
				<template v-if="activeId">
					<header class="msgr-chat__head">
						<button
							v-if="activePeer"
							class="msgr-chat__peer"
							:aria-label="openProfileLabel"
							@click="openProfile(activePeer)"
						>
							<b>{{ activePeerName }}</b>
						</button>
						<b v-else>{{ activePeerName }}</b>
					</header>
					<div ref="threadEl" class="msgr-thread">
						<div v-if="threadLoading" class="msgr-state">
							{{
								formatMessage({
									id: 'app.messenger.threadLoading',
									defaultMessage: 'Загружаем сообщения…',
								})
							}}
						</div>
						<TransitionGroup v-else name="msgr-msg" tag="div" class="msgr-thread__list">
							<div
								v-for="message in thread"
								:key="message.id"
								class="msgr-msg"
								:class="{ 'is-mine': message.mine }"
							>
								<img
									v-if="
										avatarUrl(threadAvatarStore, avatarVersion, `msg:${message.senderId}`) &&
										!message.mine
									"
									:src="avatarUrl(threadAvatarStore, avatarVersion, `msg:${message.senderId}`)"
									alt=""
								/>
								<div class="msgr-msg__bubble">
									<small v-if="!message.mine">{{ message.senderName }}</small>
									<p v-if="message.text">{{ message.text }}</p>
									<a
										v-if="message.attachment"
										:href="message.attachment"
										target="_blank"
										rel="noopener"
									>
										{{
											formatMessage({ id: 'app.messenger.attachment', defaultMessage: 'Вложение' })
										}}
									</a>
									<span class="msgr-msg__time">{{ message.time }}</span>
								</div>
							</div>
						</TransitionGroup>
					</div>
					<form class="msgr-composer" @submit.prevent="sendDraft">
						<input
							v-model="draft"
							:placeholder="
								formatMessage({
									id: 'app.messenger.composerPlaceholder',
									defaultMessage: 'Сообщение…',
								})
							"
						/>
						<button class="msgr-send" :disabled="sending || !draft.trim()" aria-label="Отправить">
							<SendIcon />
						</button>
					</form>
				</template>
				<div v-else class="msgr-state msgr-state--pad">
					{{
						formatMessage({ id: 'app.messenger.pickChat', defaultMessage: 'Выберите чат слева' })
					}}
				</div>
			</section>
		</div>

		<div v-if="loadError" class="msgr-state msgr-state--error">{{ loadError }}</div>

		<UserProfileModal ref="profileModal" @write="writeFromProfile" />
	</div>
</template>

<style scoped>
.msgr {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	height: 100%;
	padding: 1.5rem 1rem 1rem;
	max-width: 60rem;
	margin: 0 auto;
}

.msgr-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.msgr-title {
	font-size: 1.15rem;
	font-weight: 700;
	color: var(--color-contrast);
}

.msgr-refresh {
	border: none;
	background: var(--color-bg);
	color: var(--color-text);
	border-radius: 0.75rem;
	width: 2.5rem;
	height: 2.5rem;
	display: grid;
	place-items: center;
	cursor: pointer;
	transition: transform 0.3s ease;
}

.msgr-refresh:hover {
	transform: rotate(60deg);
}

.msgr-refresh.is-busy {
	pointer-events: none;
}

.msgr-spinner {
	width: 1rem;
	height: 1rem;
	border: 2px solid var(--color-brand);
	border-top-color: transparent;
	border-radius: 50%;
	animation: msgr-spin 0.8s linear infinite;
}

@keyframes msgr-spin {
	to {
		transform: rotate(360deg);
	}
}

.msgr-gate {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	gap: 0.75rem;
	background: var(--color-bg);
	border-radius: 1.25rem;
	padding: 2.5rem 2rem;
	max-width: 30rem;
	margin: 3rem auto 0;
}

.msgr-gate svg {
	width: 2.25rem;
	height: 2.25rem;
	color: var(--color-brand);
}

.msgr-gate b {
	font-size: 1.1rem;
	color: var(--color-contrast);
}

.msgr-gate p {
	margin: 0;
	color: var(--color-text-inactive);
	font-size: 0.9rem;
}

.msgr-body {
	display: grid;
	grid-template-columns: 17rem 1fr;
	gap: 1rem;
	flex: 1;
	min-height: 0;
}

.msgr-rail {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	background: var(--color-bg);
	border-radius: 1rem;
	padding: 0.75rem;
	min-height: 0;
	overflow-y: auto;
}

.msgr-rail__tabs {
	display: flex;
	gap: 0.25rem;
	background: var(--color-button-bg);
	border-radius: 0.75rem;
	padding: 0.2rem;
}

.msgr-rail__tabs button {
	flex: 1;
	border: none;
	background: transparent;
	color: var(--color-text-inactive);
	padding: 0.4rem;
	border-radius: 0.55rem;
	cursor: pointer;
	font-weight: 600;
	font-size: 0.85rem;
	transition:
		background-color 0.18s ease,
		color 0.18s ease;
}

.msgr-rail__tabs button.is-on {
	background: var(--color-brand);
	color: var(--color-brand-invert);
}

.msgr-list {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.msgr-row {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	border: none;
	background: transparent;
	border-radius: 0.75rem;
	padding: 0.5rem 0.6rem;
	cursor: pointer;
	text-align: left;
	width: 100%;
	transition:
		background-color 0.18s ease,
		transform 0.18s ease;
}

.msgr-row:hover {
	background: var(--color-button-bg);
	transform: translateX(2px);
}

.msgr-row.is-on {
	background: var(--color-button-bg);
}

.msgr-row img,
.msgr-row__stub {
	width: 2.25rem;
	height: 2.25rem;
	border-radius: 0.55rem;
	flex-shrink: 0;
	object-fit: cover;
	image-rendering: pixelated;
}

.msgr-row__stub {
	background: var(--color-button-bg);
}

.msgr-row__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
	flex: 1;
}

.msgr-row__text b {
	color: var(--color-contrast);
	font-size: 0.9rem;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msgr-row__text small {
	color: var(--color-text-inactive);
	font-size: 0.78rem;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msgr-mini {
	border: none;
	background: var(--color-button-bg);
	color: var(--color-text);
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 0.5rem;
	display: grid;
	place-items: center;
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		color 0.18s ease,
		transform 0.18s ease;
}

.msgr-mini:hover {
	background: var(--color-brand);
	color: var(--color-brand-invert);
	transform: scale(1.08);
}

.msgr-mini svg {
	width: 0.9rem;
	height: 0.9rem;
}

.msgr-mini--ok {
	color: var(--color-green);
	font-weight: 800;
}

.msgr-requests {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.msgr-requests > b {
	font-size: 0.78rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--color-text-inactive);
}

.msgr-search {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	background: var(--color-button-bg);
	border-radius: 0.75rem;
	padding: 0.45rem 0.7rem;
	color: var(--color-text-inactive);
}

.msgr-search svg {
	width: 1rem;
	height: 1rem;
	flex-shrink: 0;
}

.msgr-search input {
	background: transparent;
	border: none;
	outline: none;
	color: var(--color-contrast);
	font: inherit;
	width: 100%;
}

.msgr-empty {
	color: var(--color-text-inactive);
	font-size: 0.85rem;
	padding: 0.5rem 0.25rem;
}

.msgr-logout {
	margin-top: auto;
	border: none;
	background: transparent;
	color: var(--color-text-inactive);
	font-size: 0.8rem;
	cursor: pointer;
	padding: 0.4rem;
	border-radius: 0.5rem;
	transition: color 0.18s ease;
}

.msgr-logout:hover {
	color: var(--color-red);
}

.msgr-chat {
	display: flex;
	flex-direction: column;
	background: var(--color-bg);
	border-radius: 1rem;
	min-height: 0;
	overflow: hidden;
}

.msgr-chat__head {
	padding: 0.85rem 1.1rem;
	border-bottom: 1px solid var(--color-button-bg);
	color: var(--color-contrast);
}

.msgr-chat__peer {
	border: none;
	background: transparent;
	color: inherit;
	padding: 0.15rem 0.4rem;
	margin: -0.15rem -0.4rem;
	border-radius: 0.55rem;
	cursor: pointer;
	text-align: left;
	transition: background-color 0.18s ease;
}

.msgr-chat__peer:hover {
	background: var(--color-button-bg);
}

.msgr-thread {
	flex: 1;
	overflow-y: auto;
	padding: 1rem;
	display: flex;
	flex-direction: column;
}

.msgr-thread__list {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
}

.msgr-msg {
	display: flex;
	gap: 0.5rem;
	align-items: flex-end;
	max-width: 78%;
}

.msgr-msg img {
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 0.5rem;
	object-fit: cover;
	image-rendering: pixelated;
}

.msgr-msg.is-mine {
	align-self: flex-end;
	flex-direction: row-reverse;
}

.msgr-msg__bubble {
	background: var(--color-button-bg);
	border-radius: 0.9rem;
	padding: 0.5rem 0.8rem;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	animation: msgr-msg-in 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.msgr-msg.is-mine .msgr-msg__bubble {
	background: var(--color-brand);
	color: var(--color-brand-invert);
}

.msgr-msg__bubble small {
	font-size: 0.72rem;
	opacity: 0.75;
}

.msgr-msg__bubble p {
	margin: 0;
	word-break: break-word;
	white-space: pre-wrap;
	font-size: 0.92rem;
}

.msgr-msg__bubble a {
	color: inherit;
	font-size: 0.85rem;
	text-decoration: underline;
}

.msgr-msg__time {
	font-size: 0.68rem;
	opacity: 0.65;
	align-self: flex-end;
}

@keyframes msgr-msg-in {
	from {
		opacity: 0;
		transform: translateY(8px) scale(0.97);
	}
}

.msgr-composer {
	display: flex;
	gap: 0.5rem;
	padding: 0.75rem;
	border-top: 1px solid var(--color-button-bg);
}

.msgr-composer input {
	flex: 1;
	background: var(--color-button-bg);
	border: none;
	border-radius: 0.75rem;
	padding: 0.55rem 0.85rem;
	color: var(--color-contrast);
	font: inherit;
	outline: none;
}

.msgr-send {
	border: none;
	background: var(--color-brand);
	color: var(--color-brand-invert);
	width: 2.5rem;
	border-radius: 0.75rem;
	display: grid;
	place-items: center;
	cursor: pointer;
	transition:
		transform 0.18s ease,
		opacity 0.18s ease;
}

.msgr-send:hover:not(:disabled) {
	transform: scale(1.06);
}

.msgr-send:disabled {
	opacity: 0.5;
	cursor: default;
}

.msgr-send svg {
	width: 1.1rem;
	height: 1.1rem;
}

.msgr-state {
	color: var(--color-text-inactive);
	padding: 1.25rem;
	text-align: center;
}

.msgr-state--pad {
	margin: auto;
}

.msgr-state--error {
	color: var(--color-red);
	padding: 0;
}

.msgr-pop-enter-active,
.msgr-pop-leave-active,
.msgr-pop-move {
	transition:
		transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
		opacity 0.25s ease;
}

.msgr-pop-enter-from {
	opacity: 0;
	transform: translateY(8px);
}

.msgr-pop-leave-to {
	opacity: 0;
}
</style>
