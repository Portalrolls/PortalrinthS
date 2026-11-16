<script setup lang="ts">
import {
	CheckIcon,
	MessagesSquareIcon,
	RefreshCwIcon,
	SearchIcon,
	SendIcon,
	UserIcon,
	UserPlusIcon,
	XIcon,
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
							'Чаты и друзья прямо в лаунчере — как у Undefined Client. Нужен аккаунт Microsoft или Ely.by: мессенджер общий, переписка видна и их игрокам, и нашим.',
					})
				}}
			</p>
			<Button @click="connect(true)">
				{{ formatMessage({ id: 'app.messenger.retry', defaultMessage: 'Подключить аккаунт' }) }}
			</Button>
		</div>

		<div v-else class="msgr-body">
			<aside class="msgr-side">
				<div class="msgr-side__head">
					<span class="msgr-side__title">{{ formatMessage(messages.heading) }}</span>
					<button
						class="msgr-refresh"
						:class="{ 'is-busy': refreshing }"
						aria-label="Обновить"
						@click="livePulse"
					>
						<RefreshCwIcon v-if="!refreshing" />
						<span v-else class="msgr-spinner" />
					</button>
				</div>

				<div class="msgr-side__tabs" role="tablist">
					<button
						:class="{ 'is-on': railTab === 'chats' }"
						role="tab"
						:aria-selected="railTab === 'chats'"
						@click="railTab = 'chats'"
					>
						{{ formatMessage({ id: 'app.messenger.tabChats', defaultMessage: 'Чаты' }) }}
					</button>
					<button
						:class="{ 'is-on': railTab === 'friends' }"
						role="tab"
						:aria-selected="railTab === 'friends'"
						@click="railTab = 'friends'"
					>
						{{ formatMessage({ id: 'app.messenger.tabFriends', defaultMessage: 'Друзья' }) }}
					</button>
				</div>

				<div class="msgr-side__scroll">
					<template v-if="railTab === 'chats'">
						<TransitionGroup
							v-if="conversations.length"
							name="msgr-pop"
							tag="div"
							class="msgr-list"
						>
							<button
								v-for="chat in conversations"
								:key="chat.id"
								class="msgr-row"
								:class="{ 'is-on': chat.id === activeId }"
								@click="openChat(chat)"
							>
								<span class="msgr-row__ava">
									<img
										v-if="avatarUrl(railAvatarStore, avatarVersion, `chat:${chat.id}`)"
										:src="avatarUrl(railAvatarStore, avatarVersion, `chat:${chat.id}`)"
										alt=""
									/>
								</span>
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
								<span class="msgr-row__ava">
									<span class="msgr-row__letter">{{
										String(user.username || user.name || '?')
											.slice(0, 1)
											.toUpperCase()
									}}</span>
								</span>
								<span class="msgr-row__text">
									<b>{{ user.username || user.name }}</b>
								</span>
								<span class="msgr-row__tools">
									<button
										class="msgr-mini"
										:aria-label="openProfileLabel"
										@click="openProfile(user)"
									>
										<UserIcon />
									</button>
									<button
										class="msgr-mini msgr-mini--ok"
										aria-label="Добавить в друзья"
										@click="addFriend(user)"
									>
										<UserPlusIcon />
									</button>
									<button class="msgr-mini" aria-label="Написать" @click="startDm(user)">
										<MessagesSquareIcon />
									</button>
								</span>
							</div>
						</div>

						<div v-if="incoming.length" class="msgr-requests">
							<b>{{ formatMessage({ id: 'app.messenger.requests', defaultMessage: 'Заявки' }) }}</b>
							<div
								v-for="friend in incoming"
								:key="`in-${friend.id}`"
								class="msgr-row msgr-row--static"
							>
								<span class="msgr-row__ava">
									<img
										v-if="avatarUrl(railAvatarStore, avatarVersion, `friend:${friend.id}`)"
										:src="avatarUrl(railAvatarStore, avatarVersion, `friend:${friend.id}`)"
										alt=""
									/>
								</span>
								<span class="msgr-row__text">
									<b>{{ friend.name }}</b>
									<small>{{
										formatMessage({
											id: 'app.messenger.wantsFriend',
											defaultMessage: 'Хочет дружить',
										})
									}}</small>
								</span>
								<span class="msgr-row__tools">
									<button
										class="msgr-mini msgr-mini--ok"
										aria-label="Принять"
										@click="acceptFriend(friend)"
									>
										<CheckIcon />
									</button>
									<button class="msgr-mini" aria-label="Отклонить" @click="declineFriend(friend)">
										<XIcon />
									</button>
								</span>
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
								<span class="msgr-row__ava">
									<img
										v-if="avatarUrl(railAvatarStore, avatarVersion, `friend:${friend.id}`)"
										:src="avatarUrl(railAvatarStore, avatarVersion, `friend:${friend.id}`)"
										alt=""
									/>
								</span>
								<span class="msgr-row__text">
									<b>{{ friend.name }}</b>
									<small>{{
										formatMessage({ id: 'app.messenger.online', defaultMessage: 'в сети' })
									}}</small>
								</span>
								<span class="msgr-row__tools">
									<button
										class="msgr-mini"
										:aria-label="openProfileLabel"
										@click.stop="openProfile(friend)"
									>
										<UserIcon />
									</button>
								</span>
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
				</div>

				<button class="msgr-logout" @click="signOut">
					{{ formatMessage({ id: 'app.messenger.logout', defaultMessage: 'Выйти из сессии' }) }}
				</button>
			</aside>

			<section class="msgr-chat">
				<template v-if="activeId">
					<header class="msgr-chat__head">
						<span class="msgr-chat__ava">
							<img
								v-if="avatarUrl(railAvatarStore, avatarVersion, `chat:${activeId}`)"
								:src="avatarUrl(railAvatarStore, avatarVersion, `chat:${activeId}`)"
								alt=""
							/>
						</span>
						<div class="msgr-chat__who">
							<button
								v-if="activePeer"
								class="msgr-chat__peer"
								:aria-label="openProfileLabel"
								@click="openProfile(activePeer)"
							>
								{{ activePeerName }}
							</button>
							<b v-else>{{ activePeerName }}</b>
							<span class="msgr-chat__status">{{
								formatMessage({ id: 'app.messenger.chatStatus', defaultMessage: 'Личный чат' })
							}}</span>
						</div>
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
								<span class="msgr-msg__ava">
									<img
										v-if="avatarUrl(threadAvatarStore, avatarVersion, `msg:${message.senderId}`)"
										:src="avatarUrl(threadAvatarStore, avatarVersion, `msg:${message.senderId}`)"
										alt=""
									/>
									<span v-else class="msgr-msg__letter">{{
										(message.senderName || '?').slice(0, 1).toUpperCase()
									}}</span>
								</span>
								<div class="msgr-msg__body">
									<div class="msgr-msg__top">
										<span class="msgr-msg__name">{{ message.senderName }}</span>
										<span class="msgr-msg__time">{{ message.time }}</span>
									</div>
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
/* ===== Оболочка: во всю высоту вкладки, без рамок ===== */

.msgr {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
}

.msgr-body {
	flex: 1;
	min-height: 0;
	display: flex;
	background: #202020;
	border-radius: 8px 0 0 0;
	overflow: hidden;
}

.msgr-state {
	padding: 2rem;
	text-align: center;
	color: var(--color-text-inactive);
}

.msgr-state--pad {
	flex: 1;
	display: grid;
	place-items: center;
}

.msgr-state--error {
	color: var(--color-red, #ed4245);
}

/* ===== Вход без аккаунта ===== */

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

/* ===== Левая панель — как канал-лист Discord ===== */

.msgr-side {
	width: 274px;
	flex: none;
	min-height: 0;
	display: flex;
	flex-direction: column;
	background: #191919;
	border-right: 1px solid #1b1b1b;
}

.msgr-side__head {
	height: 54px;
	flex: none;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 12px;
	box-shadow: 0 1px 0 rgba(0, 0, 0, 0.24);
}

.msgr-side__title {
	flex: 1;
	min-width: 0;
	font-size: 15px;
	font-weight: 700;
	color: #fff;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msgr-refresh {
	width: 28px;
	height: 28px;
	flex: none;
	display: grid;
	place-items: center;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: rgba(255, 255, 255, 0.6);
	cursor: pointer;
	transition: background-color 0.12s ease;
}

.msgr-refresh:hover {
	background: rgba(255, 255, 255, 0.06);
	color: #fff;
}

.msgr-refresh.is-busy {
	pointer-events: none;
}

.msgr-spinner {
	width: 14px;
	height: 14px;
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

.msgr-side__tabs {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 2px;
	margin: 10px 10px 8px;
	padding: 3px;
	border: 1px solid #303030;
	border-radius: 10px;
	background: #1f1f1f;
}

.msgr-side__tabs button {
	height: 28px;
	border: none;
	border-radius: 7px;
	background: transparent;
	color: rgba(255, 255, 255, 0.45);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.msgr-side__tabs button.is-on {
	background: #3c3c3c;
	color: #fff;
}

.msgr-side__scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 0 8px 8px;
}

.msgr-list {
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.msgr-empty {
	margin: 12px 8px;
	color: rgba(255, 255, 255, 0.38);
	font-size: 13px;
	line-height: 1.45;
}

/* ===== Поиск ===== */

.msgr-search {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 2px 2px 10px;
	padding: 0 10px;
	height: 34px;
	background: #1a1a1a;
	border-radius: 8px;
	color: rgba(255, 255, 255, 0.4);
}

.msgr-search:focus-within {
	box-shadow: 0 0 0 1px var(--color-brand);
}

.msgr-search svg {
	flex: none;
	width: 15px;
	height: 15px;
}

.msgr-search input {
	flex: 1;
	min-width: 0;
	height: 100%;
	border: none;
	background: transparent;
	color: #fff;
	font: inherit;
	font-size: 13px;
	outline: none;
}

.msgr-search input::placeholder {
	color: rgba(255, 255, 255, 0.35);
}

/* ===== Строки списка ===== */

.msgr-row {
	position: relative;
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	margin: 0;
	padding: 7px 8px;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.1s ease;
}

.msgr-row:hover {
	background: rgba(255, 255, 255, 0.05);
}

.msgr-row.is-on {
	background: #262626;
}

.msgr-row--static {
	cursor: default;
}

.msgr-row--static:hover {
	background: rgba(255, 255, 255, 0.03);
}

.msgr-row__ava {
	width: 40px;
	height: 40px;
	flex: none;
	border-radius: 50%;
	background: #2b2b2b;
	display: grid;
	place-items: center;
	overflow: hidden;
}

.msgr-row__ava img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	image-rendering: pixelated;
}

.msgr-row__letter {
	color: rgba(255, 255, 255, 0.55);
	font-size: 15px;
	font-weight: 600;
}

.msgr-row__text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.msgr-row__text b {
	font-size: 14px;
	font-weight: 500;
	color: #fff;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msgr-row__text small {
	font-size: 12px;
	color: rgba(255, 255, 255, 0.4);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.msgr-row__tools {
	flex: none;
	display: flex;
	gap: 2px;
}

.msgr-mini {
	width: 26px;
	height: 26px;
	display: grid;
	place-items: center;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: rgba(255, 255, 255, 0.55);
	cursor: pointer;
	transition:
		background-color 0.12s ease,
		color 0.12s ease;
}

.msgr-mini:hover {
	background: rgba(255, 255, 255, 0.08);
	color: #fff;
}

.msgr-mini--ok:hover {
	color: var(--color-brand, #4ac364);
}

.msgr-requests {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 4px 0 10px;
}

.msgr-requests > b {
	padding: 4px 8px;
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: rgba(255, 255, 255, 0.4);
}

/* ===== Выйти ===== */

.msgr-logout {
	flex: none;
	margin: 4px 8px 8px;
	padding: 8px 10px;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: rgba(255, 255, 255, 0.38);
	font: inherit;
	font-size: 13px;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.12s ease;
}

.msgr-logout:hover {
	background: rgba(217, 56, 56, 0.12);
	color: #ff4848;
}

/* ===== Окно чата ===== */

.msgr-chat {
	flex: 1;
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	background: #202020;
}

.msgr-chat__head {
	height: 54px;
	flex: none;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0 12px;
	border-bottom: 1px solid #2a2a2a;
	position: relative;
	z-index: 2;
}

.msgr-chat__ava {
	width: 32px;
	height: 32px;
	flex: none;
	border-radius: 50%;
	background: #2b2b2b;
	display: grid;
	place-items: center;
	overflow: hidden;
}

.msgr-chat__ava img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	image-rendering: pixelated;
}

.msgr-chat__who {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.msgr-chat__peer {
	border: none;
	padding: 0;
	background: transparent;
	color: #fff;
	font: inherit;
	font-size: 15px;
	font-weight: 700;
	text-align: left;
	cursor: pointer;
}

.msgr-chat__peer:hover {
	text-decoration: underline;
}

.msgr-chat__status {
	font-size: 12px;
	color: rgba(255, 255, 255, 0.4);
}

/* ===== Сообщения — строки Discord, без пузырей ===== */

.msgr-thread {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 12px 0 10px;
	display: flex;
	flex-direction: column;
}

.msgr-thread__list {
	display: flex;
	flex-direction: column;
	flex: 1;
	justify-content: flex-end;
}

.msgr-msg {
	display: flex;
	gap: 12px;
	padding: 2px 16px 2px 12px;
	margin-top: 8px;
	transition: background 0.08s ease;
}

.msgr-msg:first-child {
	margin-top: 0;
}

.msgr-msg:hover {
	background: rgba(255, 255, 255, 0.03);
}

.msgr-msg__ava {
	width: 40px;
	height: 40px;
	flex: none;
	border-radius: 50%;
	background: #2b2b2b;
	display: grid;
	place-items: center;
	overflow: hidden;
}

.msgr-msg__ava img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	image-rendering: pixelated;
}

.msgr-msg__letter {
	color: rgba(255, 255, 255, 0.55);
	font-size: 15px;
	font-weight: 600;
}

.msgr-msg__body {
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.msgr-msg__top {
	display: flex;
	align-items: baseline;
	gap: 8px;
}

.msgr-msg__name {
	font-size: 14px;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.85);
}

.msgr-msg.is-mine .msgr-msg__name {
	color: var(--color-brand, #4ac364);
}

.msgr-msg__time {
	font-size: 11px;
	color: rgba(255, 255, 255, 0.35);
}

.msgr-msg__body p {
	margin: 1px 0 0;
	color: rgba(255, 255, 255, 0.9);
	font-size: 14px;
	line-height: 1.4;
	white-space: pre-wrap;
	overflow-wrap: break-word;
}

.msgr-msg__body a {
	color: #6fa6d3;
	font-size: 13px;
}

/* ===== Композер ===== */

.msgr-composer {
	flex: none;
	display: flex;
	gap: 8px;
	padding: 0 12px 12px;
}

.msgr-composer input {
	flex: 1;
	min-width: 0;
	height: 42px;
	padding: 0 14px;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 12px;
	background: rgba(255, 255, 255, 0.03);
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
	color: #fff;
	font: inherit;
	font-size: 14px;
	outline: none;
	transition:
		border-color 0.15s ease,
		background 0.15s ease;
}

.msgr-composer input:focus {
	border-color: rgba(255, 255, 255, 0.08);
}

.msgr-composer input::placeholder {
	color: rgba(255, 255, 255, 0.38);
}

.msgr-send {
	width: 42px;
	height: 42px;
	flex: none;
	display: grid;
	place-items: center;
	border: none;
	border-radius: 12px;
	background: var(--color-brand, #1bd96a);
	color: #0b0e11;
	cursor: pointer;
	transition: transform 0.15s ease;
}

.msgr-send:hover:not(:disabled) {
	transform: scale(1.05);
}

.msgr-send:disabled {
	opacity: 0.45;
	cursor: default;
}

/* ===== Анимации ===== */

.msgr-pop-enter-active,
.msgr-pop-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.msgr-pop-enter-from {
	opacity: 0;
	transform: translateX(-6px);
}

.msgr-msg-enter-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.msgr-msg-enter-from {
	opacity: 0;
	transform: translateY(6px);
}

@media (max-width: 720px) {
	.msgr-body {
		flex-direction: column;
	}

	.msgr-side {
		width: auto;
		max-height: 40vh;
		border-right: none;
		border-bottom: 1px solid #1b1b1b;
	}
}
</style>
