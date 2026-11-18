<script setup lang="ts">
import {
	ChevronDownIcon,
	HashIcon,
	PinIcon,
	SearchIcon,
	SendIcon,
	UploadIcon,
	UserIcon,
	UserPlusIcon,
	UsersIcon,
	XIcon,
} from '@modrinth/assets'
import { computed, nextTick, ref, watch } from 'vue'

import { getCallState, startDmCall } from '@/helpers/messenger-call'

import Composer from './Composer.vue'
import { useMessengerT } from './i18n'
import MessageItem from './MessageItem.vue'
import MessageText from './MessageText.vue'
import { formatDate, formatTime, type Msg, type Peer, sameDay } from './model'
import PhoneIcon from './PhoneIcon.vue'
import {
	activeChannel,
	activeConversation,
	activeKey,
	activeServer,
	activeThread,
	backToLatest,
	displayName,
	editMessage,
	jumpTo,
	loadOlder,
	loadPins,
	myId,
	openServer,
	presenceFor,
	relationOf,
	requestFriend,
	searchMessages,
	state,
	typingNames,
	userOf,
} from './store'
import { vTip } from './tooltip'
import { openProfile } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

const props = defineProps<{ sidePanel: boolean }>()
const emit = defineEmits<{ 'update:sidePanel': [value: boolean] }>()

const t = useMessengerT()

const scroller = ref<HTMLElement | null>(null)
const composer = ref<InstanceType<typeof Composer> | null>(null)
const replyTo = ref<Msg | null>(null)
const editingId = ref('')
const highlightId = ref('')
const atBottom = ref(true)
const dragging = ref(0)

const tool = ref<'none' | 'search' | 'pins'>('none')
const searchText = ref('')
const searchResults = ref<Msg[] | null>(null)
const searching = ref(false)
const pins = ref<Msg[]>([])
const pinsLoading = ref(false)

const conv = computed(() => activeConversation.value)
const peer = computed(() =>
	conv.value?.peer ? (userOf(conv.value.peer.id) ?? conv.value.peer) : null,
)
const thread = computed(() => activeThread.value)
const messages = computed(() => thread.value?.messages ?? [])

const title = computed(() => {
	if (!conv.value) return ''
	if (conv.value.dm)
		return peer.value ? displayName(peer.value.id, peer.value.username) : conv.value.title
	return activeChannel.value?.name ?? conv.value.title
})

const placeholder = computed(() =>
	conv.value?.dm
		? t('app.messenger.composer.dm', 'Написать @{name}', { name: title.value })
		: t('app.messenger.composer.channel', 'Написать в #{name}', { name: title.value }),
)

const callPhase = computed(() => {
	void state.callTick
	return getCallState().phase
})

const peerStatus = computed(() => (peer.value ? presenceFor(peer.value.id) : 'offline'))

const peerProvider = computed(() => {
	const provider = peer.value?.provider
	if (peer.value?.bot || provider === 'bot') return 'Undefined ID'
	return provider === 'ely' ? 'Ely.by' : 'Microsoft'
})

/** Серверы, где мы оба — из уже загруженных составов, без лишних запросов. */
const sharedServers = computed(() => {
	const id = peer.value?.id
	if (!id) return []
	return state.conversations.filter(
		(item) => !item.dm && item.members.some((member) => member.id === id),
	)
})

const statusLabel = computed(() => {
	switch (peerStatus.value) {
		case 'online':
			return t('app.messenger.status.online', 'В сети')
		case 'busy':
			return t('app.messenger.status.busy', 'Отошёл')
		case 'dnd':
			return t('app.messenger.status.dnd', 'Не беспокоить')
		default:
			return t('app.messenger.status.offline', 'Не в сети')
	}
})

const mentionables = computed<Peer[]>(() => {
	if (!conv.value) return []
	if (conv.value.dm) return peer.value ? [peer.value] : []
	return conv.value.members.filter((member) => member.id !== myId.value)
})

type Row =
	| { type: 'date'; key: string; label: string }
	| { type: 'new'; key: string }
	| { type: 'msg'; key: string; msg: Msg; grouped: boolean }

const rows = computed<Row[]>(() => {
	const out: Row[] = []
	let prev: Msg | null = null
	for (const msg of messages.value) {
		if (!prev || !sameDay(prev.createdAt, msg.createdAt)) {
			out.push({ type: 'date', key: `d${msg.id}`, label: dayLabel(msg.createdAt) })
			prev = null
		}
		const isNew = thread.value?.firstNewId === msg.id
		if (isNew) out.push({ type: 'new', key: `n${msg.id}` })
		const grouped =
			Boolean(prev) &&
			!isNew &&
			prev!.senderId === msg.senderId &&
			prev!.kind !== 'system' &&
			msg.kind !== 'system' &&
			msg.createdAt - prev!.createdAt < 7 * 60 * 1000
		out.push({ type: 'msg', key: msg.id, msg, grouped })
		prev = msg
	}
	return out
})

function dayLabel(ms: number): string {
	const today = new Date()
	const date = new Date(ms)
	if (sameDay(ms, today.getTime())) return t('app.messenger.today', 'Сегодня')
	if (sameDay(ms, today.getTime() - 86400000)) return t('app.messenger.yesterday', 'Вчера')
	return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

function scrollToBottom(smooth = false): void {
	const el = scroller.value
	if (!el) return
	el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

watch(activeKey, async () => {
	replyTo.value = null
	editingId.value = ''
	tool.value = 'none'
	searchResults.value = null
	searchText.value = ''
	await nextTick()
	scrollToNewOrBottom()
})

watch(
	() => thread.value?.loaded,
	async (loaded) => {
		if (!loaded) return
		await nextTick()
		scrollToNewOrBottom()
	},
)

function scrollToNewOrBottom(): void {
	const el = scroller.value
	const id = thread.value?.firstNewId
	if (el && id) {
		const target = el.querySelector(`[data-new-marker]`) as HTMLElement | null
		if (target) {
			el.scrollTop = Math.max(0, target.offsetTop - 80)
			return
		}
	}
	scrollToBottom()
}

watch(
	() => messages.value.length,
	async (next, prev) => {
		const el = scroller.value
		if (!el) return
		const last = messages.value[messages.value.length - 1]
		const mine = last?.senderId === myId.value
		const stick = atBottom.value || mine
		await nextTick()
		if (stick && next > prev) scrollToBottom(true)
	},
)

watch(typingNames, async () => {
	if (atBottom.value) {
		await nextTick()
		scrollToBottom()
	}
})

async function onScroll(): Promise<void> {
	const el = scroller.value
	if (!el) return
	atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
	if (el.scrollTop < 160 && thread.value?.hasMore && !thread.value.loadingOlder) {
		const height = el.scrollHeight
		const top = el.scrollTop
		const added = await loadOlder()
		if (added) {
			await nextTick()
			el.scrollTop = el.scrollHeight - height + top
		}
	}
	if (atBottom.value && thread.value?.firstNewId) {
		setTimeout(() => {
			if (atBottom.value && thread.value) thread.value.firstNewId = ''
		}, 4000)
	}
}

async function jumpToPresent(): Promise<void> {
	if (thread.value?.detached) await backToLatest()
	await nextTick()
	scrollToBottom(true)
}

async function jump(id: string, source?: Msg): Promise<void> {
	let el = scroller.value?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null
	if (!el && source) {
		await jumpTo(source)
		await nextTick()
		el = scroller.value?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null
	}
	if (!el) return
	el.scrollIntoView({ block: 'center', behavior: 'smooth' })
	highlightId.value = ''
	await nextTick()
	highlightId.value = id
	setTimeout(() => {
		if (highlightId.value === id) highlightId.value = ''
	}, 1800)
}

function jumpReply(id: string): void {
	const msg = messages.value.find((entry) => entry.id === id)
	void jump(id, msg)
}

function startReply(msg: Msg): void {
	replyTo.value = msg
	editingId.value = ''
	composer.value?.focus()
}

function startEdit(msg: Msg): void {
	editingId.value = msg.id
}

function editLast(): void {
	const own = [...messages.value]
		.reverse()
		.find((msg) => msg.senderId === myId.value && msg.kind !== 'system')
	if (own) editingId.value = own.id
}

async function saveEdit(msg: Msg, text: string): Promise<void> {
	if (await editMessage(msg, text)) editingId.value = ''
}

function cancelEdit(): void {
	editingId.value = ''
	composer.value?.focus()
}

function onSent(): void {
	replyTo.value = null
	void nextTick(() => scrollToBottom(true))
}

async function toggleTool(next: 'search' | 'pins'): Promise<void> {
	tool.value = tool.value === next ? 'none' : next
	if (tool.value === 'pins') {
		pinsLoading.value = true
		pins.value = await loadPins()
		pinsLoading.value = false
	}
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput(): void {
	if (searchTimer) clearTimeout(searchTimer)
	if (!searchText.value.trim()) {
		searchResults.value = null
		if (tool.value === 'search') tool.value = 'none'
		return
	}
	searchTimer = setTimeout(() => void runSearch(), 350)
}

async function runSearch(): Promise<void> {
	const query = searchText.value.trim()
	if (!query) return
	tool.value = 'search'
	searching.value = true
	const found = await searchMessages(query)
	searching.value = false
	if (searchText.value.trim() === query) searchResults.value = found ?? []
}

function clearSearch(): void {
	searchText.value = ''
	searchResults.value = null
	tool.value = 'none'
}

async function callPeer(): Promise<void> {
	if (!conv.value || !peer.value || callPhase.value !== 'idle') return
	await startDmCall(conv.value.id, peer.value.id, peer.value.username)
	state.callTick += 1
}

async function addFriend(): Promise<void> {
	if (peer.value) await requestFriend(peer.value.id)
}

function hasFiles(event: DragEvent): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(event: DragEvent): void {
	if (!hasFiles(event)) return
	event.preventDefault()
	dragging.value += 1
}

function onDragLeave(event: DragEvent): void {
	if (!hasFiles(event)) return
	dragging.value = Math.max(0, dragging.value - 1)
}

function onDrop(event: DragEvent): void {
	if (!hasFiles(event)) return
	event.preventDefault()
	dragging.value = 0
	const file = event.dataTransfer?.files?.[0]
	if (file) void composer.value?.addFile(file)
}
</script>

<template>
	<section
		v-if="conv"
		class="msgr-chat"
		@dragenter="onDragEnter"
		@dragover.prevent
		@dragleave="onDragLeave"
		@drop="onDrop"
	>
		<header class="msgr-chat__head">
			<template v-if="conv.dm && peer">
				<button type="button" class="msgr-chat__who" @click="openProfile(peer.id, peer.username)">
					<UserAvatar :user-id="peer.id" :name="peer.username" :size="26" status ring="#1a1b1e" />
					<b>{{ title }}</b>
				</button>
				<span class="msgr-chat__status">{{ statusLabel }}</span>
			</template>
			<template v-else>
				<HashIcon class="msgr-chat__hash" />
				<b class="msgr-chat__title">{{ title }}</b>
				<template v-if="activeChannel?.topic">
					<span class="msgr-chat__divider" />
					<span class="msgr-chat__topic" :title="activeChannel.topic">{{
						activeChannel.topic
					}}</span>
				</template>
			</template>
			<div class="msgr-chat__actions">
				<button
					v-if="conv.dm && peer && !peer.bot"
					v-tip:bottom="t('app.messenger.call.start', 'Начать голосовой звонок')"
					type="button"
					class="msgr-chat__action"
					:disabled="callPhase !== 'idle'"
					:aria-label="t('app.messenger.call.start', 'Начать голосовой звонок')"
					@click="callPeer"
				>
					<PhoneIcon />
				</button>
				<button
					v-tip:bottom="t('app.messenger.pins.title', 'Закреплённые сообщения')"
					type="button"
					class="msgr-chat__action"
					:class="{ 'is-on': tool === 'pins' }"
					:aria-label="t('app.messenger.pins.title', 'Закреплённые сообщения')"
					@click="toggleTool('pins')"
				>
					<PinIcon />
				</button>
				<button
					v-if="conv.dm && peer && relationOf(peer.id) === 'none' && !peer.bot"
					v-tip:bottom="t('app.messenger.friends.add', 'Добавить в друзья')"
					type="button"
					class="msgr-chat__action"
					:aria-label="t('app.messenger.friends.add', 'Добавить в друзья')"
					@click="addFriend"
				>
					<UserPlusIcon />
				</button>
				<button
					v-tip:bottom="
						conv.dm
							? t('app.messenger.panel.profile', 'Показать профиль пользователя')
							: t('app.messenger.panel.members', 'Список участников')
					"
					type="button"
					class="msgr-chat__action"
					:class="{ 'is-on': props.sidePanel }"
					:aria-label="t('app.messenger.panel.toggle', 'Боковая панель')"
					@click="emit('update:sidePanel', !props.sidePanel)"
				>
					<UserIcon v-if="conv.dm" />
					<UsersIcon v-else />
				</button>
				<label class="msgr-chat__search">
					<input
						v-model="searchText"
						type="search"
						:placeholder="t('app.messenger.search.placeholder', 'Поиск в чате')"
						@input="onSearchInput"
						@keydown.enter.prevent="runSearch"
						@keydown.esc="clearSearch"
					/>
					<button
						v-if="searchText"
						type="button"
						:aria-label="t('app.messenger.cancel', 'Отмена')"
						@click="clearSearch"
					>
						<XIcon />
					</button>
					<SearchIcon v-else />
				</label>
			</div>
		</header>

		<div class="msgr-chat__body">
			<div class="msgr-chat__main">
				<div ref="scroller" class="msgr-chat__scroll" @scroll.passive="onScroll">
					<div v-if="thread?.loadingOlder" class="msgr-chat__older">
						<span class="msgr-spinner" />
					</div>
					<div v-if="thread && !thread.hasMore && !thread.loading" class="msgr-chat__intro">
						<template v-if="conv.dm && peer">
							<div class="msgr-chat__intro-card">
								<button
									type="button"
									class="msgr-chat__intro-avatar"
									@click="openProfile(peer.id, peer.username)"
								>
									<UserAvatar
										:user-id="peer.id"
										:name="peer.username"
										:size="88"
										status
										ring="#1a1b1e"
									/>
								</button>
								<div class="msgr-chat__intro-text">
									<h2>{{ title }}</h2>
									<span class="msgr-chat__intro-meta">
										<span class="msgr-chat__intro-chip">{{ peerProvider }}</span>
										<span class="msgr-chat__intro-status" :class="`is-${peerStatus}`">
											<i />
											{{ statusLabel }}
										</span>
									</span>
									<p>
										{{
											t(
												'app.messenger.intro.dm',
												'Это начало вашей истории личных сообщений с {name}.',
												{
													name: title,
												},
											)
										}}
									</p>
								</div>
							</div>
							<div class="msgr-chat__intro-actions">
								<button type="button" class="is-accent" @click="composer?.focus()">
									<SendIcon />
									{{ t('app.messenger.intro.sayHi', 'Поздороваться') }}
								</button>
								<button type="button" @click="openProfile(peer.id, peer.username)">
									<UserIcon />
									{{ t('app.messenger.intro.profile', 'Профиль') }}
								</button>
								<button
									v-if="!peer.bot"
									type="button"
									:disabled="callPhase !== 'idle'"
									@click="callPeer"
								>
									<PhoneIcon />
									{{ t('app.messenger.call.short', 'Позвонить') }}
								</button>
								<button
									v-if="!peer.bot && relationOf(peer.id) === 'none'"
									type="button"
									@click="addFriend"
								>
									<UserPlusIcon />
									{{ t('app.messenger.friends.add', 'Добавить в друзья') }}
								</button>
								<span v-else-if="relationOf(peer.id) === 'outgoing'" class="msgr-chat__intro-note">
									{{ t('app.messenger.intro.requestSent', 'Заявка в друзья отправлена') }}
								</span>
							</div>
							<div v-if="sharedServers.length" class="msgr-chat__intro-shared">
								<small>
									{{
										t('app.messenger.intro.shared', 'Общие серверы · {n}', {
											n: String(sharedServers.length),
										})
									}}
								</small>
								<div>
									<button
										v-for="server in sharedServers.slice(0, 6)"
										:key="server.id"
										v-tip="server.title"
										type="button"
										class="msgr-chat__intro-server"
										@click="openServer(server.id)"
									>
										<img v-if="server.avatarUrl" :src="server.avatarUrl" alt="" />
										<span v-else>{{ server.title.slice(0, 2).toUpperCase() }}</span>
									</button>
								</div>
							</div>
						</template>
						<template v-else>
							<span class="msgr-chat__intro-hash"><HashIcon /></span>
							<h2>
								{{
									t('app.messenger.intro.channelTitle', 'Добро пожаловать в #{name}', {
										name: title,
									})
								}}
							</h2>
							<p>
								{{
									t('app.messenger.intro.channel', 'Это начало канала #{name}.', { name: title })
								}}
							</p>
						</template>
					</div>
					<div v-if="thread?.loading && !messages.length" class="msgr-chat__skeleton">
						<div v-for="index in 6" :key="index" class="msgr-chat__skeleton-row">
							<span class="msgr-chat__skeleton-avatar" />
							<span class="msgr-chat__skeleton-lines">
								<span :style="{ width: `${30 + ((index * 17) % 40)}%` }" />
								<span :style="{ width: `${45 + ((index * 23) % 45)}%` }" />
							</span>
						</div>
					</div>
					<div v-else-if="thread?.error && !messages.length" class="msgr-chat__error">
						{{ t('app.messenger.loadFailed', 'Не удалось загрузить сообщения') }}
						<button type="button" @click="backToLatest">
							{{ t('app.messenger.retry', 'Повторить') }}
						</button>
					</div>
					<template v-for="row in rows" :key="row.key">
						<div v-if="row.type === 'date'" class="msgr-chat__date">
							<span>{{ row.label }}</span>
						</div>
						<div v-else-if="row.type === 'new'" class="msgr-chat__new" data-new-marker>
							<span>{{ t('app.messenger.newMessages', 'НОВЫЕ') }}</span>
						</div>
						<MessageItem
							v-else
							:msg="row.msg"
							:grouped="row.grouped"
							:editing="editingId === row.msg.id"
							:highlight="highlightId === row.msg.id"
							@reply="startReply"
							@edit="startEdit"
							@save="saveEdit"
							@cancel="cancelEdit"
							@jump="jumpReply"
						/>
					</template>
					<div class="msgr-chat__tail" />
				</div>
				<Transition name="msgr-fade">
					<button
						v-if="!atBottom || thread?.detached"
						type="button"
						class="msgr-chat__present"
						@click="jumpToPresent"
					>
						{{
							thread?.detached
								? t('app.messenger.viewingOlder', 'Вы просматриваете старые сообщения')
								: t('app.messenger.jumpPresent', 'Перейти к новым')
						}}
						<ChevronDownIcon />
					</button>
				</Transition>
				<div class="msgr-chat__typing" :class="{ 'is-on': typingNames.length }">
					<template v-if="typingNames.length">
						<span class="msgr-chat__typing-dots"><i /><i /><i /></span>
						<span>
							{{
								typingNames.length === 1
									? t('app.messenger.typing.one', '{name} печатает…', { name: typingNames[0] })
									: t('app.messenger.typing.many', '{names} печатают…', {
											names: typingNames.slice(0, 3).join(', '),
										})
							}}
						</span>
					</template>
				</div>
				<Composer
					ref="composer"
					:placeholder="placeholder"
					:reply-to="replyTo"
					:mentionables="mentionables"
					:disabled="relationOf(peer?.id ?? '') === 'blocked'"
					@cancel-reply="replyTo = null"
					@edit-last="editLast"
					@sent="onSent"
				/>
			</div>

			<Transition name="msgr-panel">
				<aside v-if="tool !== 'none'" class="msgr-chat__tool">
					<header>
						<b v-if="tool === 'pins'"
							><PinIcon /> {{ t('app.messenger.pins.title', 'Закреплённые сообщения') }}</b
						>
						<b v-else>
							<SearchIcon />
							{{
								searching
									? t('app.messenger.search.searching', 'Ищем…')
									: t('app.messenger.search.count', 'Найдено: {count}', {
											count: searchResults?.length ?? 0,
										})
							}}
						</b>
						<button
							type="button"
							:aria-label="t('app.messenger.close', 'Закрыть')"
							@click="tool = 'none'"
						>
							<XIcon />
						</button>
					</header>
					<div class="msgr-chat__tool-list">
						<div
							v-if="(tool === 'pins' && pinsLoading) || (tool === 'search' && searching)"
							class="msgr-chat__tool-empty"
						>
							<span class="msgr-spinner" />
						</div>
						<div
							v-else-if="(tool === 'pins' ? pins : (searchResults ?? [])).length === 0"
							class="msgr-chat__tool-empty"
						>
							<template v-if="tool === 'pins'">
								<PinIcon />
								{{ t('app.messenger.pins.empty', 'Здесь пока нет закреплённых сообщений') }}
							</template>
							<template v-else>{{ t('app.messenger.search.empty', 'Ничего не найдено') }}</template>
						</div>
						<button
							v-for="msg in tool === 'pins' ? pins : (searchResults ?? [])"
							v-else
							:key="msg.id"
							type="button"
							class="msgr-chat__hit"
							@click="jump(msg.id, msg)"
						>
							<UserAvatar :user-id="msg.senderId" :name="msg.senderName" :size="32" />
							<span class="msgr-chat__hit-body">
								<span class="msgr-chat__hit-head">
									<b>{{ displayName(msg.senderId, msg.senderName) }}</b>
									<time>{{ formatDate(msg.createdAt) }} {{ formatTime(msg.createdAt) }}</time>
								</span>
								<MessageText v-if="msg.body" :text="msg.body" />
								<span v-else-if="msg.attachment" class="msgr-chat__hit-file"
									>📎 {{ msg.attachment.name }}</span
								>
							</span>
						</button>
					</div>
				</aside>
			</Transition>
		</div>

		<Transition name="msgr-fade">
			<div v-if="dragging" class="msgr-chat__drop">
				<div class="msgr-chat__drop-card">
					<UploadIcon />
					<b>{{ t('app.messenger.drop.title', 'Перетащите файл сюда') }}</b>
					<span>{{
						activeServer
							? t('app.messenger.drop.channel', 'Файл уйдёт в #{name}', { name: title })
							: t('app.messenger.drop.dm', 'Файл уйдёт {name}', { name: title })
					}}</span>
				</div>
			</div>
		</Transition>
	</section>
</template>

<style scoped>
.msgr-chat {
	position: relative;
	display: flex;
	min-width: 0;
	min-height: 0;
	flex: 1;
	flex-direction: column;
}

.msgr-chat__head {
	display: flex;
	height: 3rem;
	flex-shrink: 0;
	align-items: center;
	gap: 0.55rem;
	padding: 0 0.75rem 0 1rem;
	border-bottom: 1px solid rgba(0, 0, 0, 0.35);
	box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03);
}

.msgr-chat__who {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	padding: 0.2rem 0.35rem;
	margin-left: -0.35rem;
	border: 0;
	border-radius: 6px;
	background: none;
	color: var(--color-contrast);
	font: inherit;
	cursor: pointer;
}

.msgr-chat__who:hover {
	background: rgba(255, 255, 255, 0.05);
}

.msgr-chat__hash {
	width: 1.35rem;
	height: 1.35rem;
	flex-shrink: 0;
	color: var(--color-secondary);
}

.msgr-chat__title {
	color: var(--color-contrast);
	white-space: nowrap;
}

.msgr-chat__status {
	color: var(--color-secondary);
	font-size: 0.8rem;
}

.msgr-chat__divider {
	width: 1px;
	height: 1.4rem;
	background: rgba(255, 255, 255, 0.1);
}

.msgr-chat__topic {
	overflow: hidden;
	min-width: 0;
	color: var(--color-secondary);
	font-size: 0.82rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-chat__actions {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	margin-left: auto;
}

.msgr-chat__action {
	position: relative;
	display: grid;
	width: 2.1rem;
	height: 2.1rem;
	place-items: center;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
	transition:
		color 0.12s ease,
		background 0.12s ease;
}

.msgr-chat__action:hover:not(:disabled),
.msgr-chat__action.is-on {
	color: var(--color-contrast);
}

.msgr-chat__action.is-on {
	background: rgba(255, 255, 255, 0.06);
}

.msgr-chat__action:disabled {
	opacity: 0.4;
	cursor: default;
}

.msgr-chat__action svg {
	width: 1.3rem;
	height: 1.3rem;
}

.msgr-chat__search {
	display: flex;
	width: 10rem;
	height: 1.75rem;
	align-items: center;
	gap: 0.3rem;
	padding: 0 0.45rem;
	margin-left: 0.35rem;
	border-radius: 6px;
	background: #111214;
	transition: width 0.2s ease;
}

.msgr-chat__search:focus-within {
	width: 15rem;
}

.msgr-chat__search input {
	min-width: 0;
	flex: 1;
	border: 0;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.8rem;
	outline: none;
}

.msgr-chat__search input::-webkit-search-cancel-button {
	display: none;
}

.msgr-chat__search svg {
	width: 0.95rem;
	height: 0.95rem;
	color: var(--color-secondary);
}

.msgr-chat__search button {
	display: grid;
	padding: 0;
	border: 0;
	background: none;
	cursor: pointer;
}

.msgr-chat__body {
	position: relative;
	display: flex;
	min-height: 0;
	flex: 1;
}

.msgr-chat__main {
	position: relative;
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
}

.msgr-chat__scroll {
	min-height: 0;
	flex: 1;
	overflow-x: hidden;
	overflow-y: auto;
	padding-top: 1rem;
	overscroll-behavior: contain;
}

.msgr-chat__tail {
	height: 0.4rem;
}

.msgr-chat__older {
	display: flex;
	justify-content: center;
	padding: 0.6rem;
}

.msgr-chat__intro {
	padding: 1rem 1rem 0.5rem;
	animation: msgr-fade-up 0.3s ease-out;
}

.msgr-chat__intro-card {
	display: flex;
	align-items: center;
	gap: 1.1rem;
}

.msgr-chat__intro-avatar {
	position: relative;
	flex-shrink: 0;
	border: none;
	border-radius: 50%;
	background: transparent;
	cursor: pointer;
	padding: 0;
	transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1.2);
}

.msgr-chat__intro-avatar::after {
	position: absolute;
	inset: -6px;
	border: 2px solid color-mix(in srgb, var(--color-brand) 55%, transparent);
	border-radius: 50%;
	opacity: 0;
	transform: scale(0.9);
	transition:
		opacity 0.25s ease,
		transform 0.25s ease;
	content: '';
}

.msgr-chat__intro-avatar:hover {
	transform: translateY(-2px) scale(1.03);
}

.msgr-chat__intro-avatar:hover::after {
	opacity: 1;
	transform: scale(1);
}

.msgr-chat__intro-text {
	min-width: 0;
}

.msgr-chat__intro .msgr-chat__intro-text h2 {
	margin-top: 0;
}

.msgr-chat__intro-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
	margin-bottom: 0.4rem;
	font-size: 0.8rem;
}

.msgr-chat__intro-chip {
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-contrast);
	font-size: 0.7rem;
	font-weight: 700;
	padding: 0.1rem 0.45rem;
}

.msgr-chat__intro-status {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	color: var(--color-secondary);
}

.msgr-chat__intro-status i {
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	background: #80848e;
}

.msgr-chat__intro-status.is-online i {
	background: #23a55a;
	box-shadow: 0 0 0 0 rgba(35, 165, 90, 0.6);
	animation: msgr-intro-ping 2.2s ease-out infinite;
}

.msgr-chat__intro-status.is-busy i {
	background: #f0b232;
}

.msgr-chat__intro-status.is-dnd i {
	background: #f23f43;
}

.msgr-chat__intro-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
	margin-top: 1rem;
}

.msgr-chat__intro-actions button {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 9px;
	background: #2b2d31;
	color: var(--color-contrast);
	cursor: pointer;
	font: inherit;
	font-size: 0.82rem;
	font-weight: 600;
	padding: 0.45rem 0.8rem;
	animation: msgr-fade-up 0.35s ease-out both;
	transition:
		background 0.15s ease,
		transform 0.15s ease,
		border-color 0.15s ease;
}

.msgr-chat__intro-actions button:nth-child(2) {
	animation-delay: 40ms;
}

.msgr-chat__intro-actions button:nth-child(3) {
	animation-delay: 80ms;
}

.msgr-chat__intro-actions button:nth-child(4) {
	animation-delay: 120ms;
}

.msgr-chat__intro-actions button:hover:not(:disabled) {
	background: #35373c;
	transform: translateY(-1px);
}

.msgr-chat__intro-actions button:active:not(:disabled) {
	transform: translateY(0) scale(0.98);
}

.msgr-chat__intro-actions button:disabled {
	cursor: default;
	opacity: 0.5;
}

.msgr-chat__intro-actions button.is-accent {
	border-color: transparent;
	background: var(--color-brand);
	color: var(--color-accent-contrast, #fff);
}

.msgr-chat__intro-actions button.is-accent:hover {
	background: color-mix(in srgb, var(--color-brand) 85%, #fff);
}

.msgr-chat__intro-actions svg {
	width: 1rem;
	height: 1rem;
}

.msgr-chat__intro-note {
	color: var(--color-secondary);
	font-size: 0.8rem;
}

.msgr-chat__intro-shared {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	margin-top: 1rem;
}

.msgr-chat__intro-shared small {
	color: var(--color-secondary);
	font-size: 0.7rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.msgr-chat__intro-shared div {
	display: flex;
	gap: 0.4rem;
}

.msgr-chat__intro-server {
	display: grid;
	width: 2.4rem;
	height: 2.4rem;
	place-items: center;
	overflow: hidden;
	border: none;
	border-radius: 14px;
	background: #2b2d31;
	color: var(--color-contrast);
	cursor: pointer;
	font-size: 0.75rem;
	font-weight: 700;
	padding: 0;
	transition:
		border-radius 0.2s ease,
		transform 0.2s ease;
}

.msgr-chat__intro-server:hover {
	border-radius: 10px;
	transform: translateY(-1px);
}

.msgr-chat__intro-server img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

@keyframes msgr-intro-ping {
	0% {
		box-shadow: 0 0 0 0 rgba(35, 165, 90, 0.55);
	}
	70%,
	100% {
		box-shadow: 0 0 0 6px rgba(35, 165, 90, 0);
	}
}

.msgr-chat__intro h2 {
	margin: 0.6rem 0 0.25rem;
	color: var(--color-contrast);
	font-size: 1.8rem;
	font-weight: 800;
}

.msgr-chat__intro p {
	margin: 0;
	color: var(--color-secondary);
}

.msgr-chat__intro-hash {
	display: grid;
	width: 4.25rem;
	height: 4.25rem;
	place-items: center;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.08);
}

.msgr-chat__intro-hash svg {
	width: 2.4rem;
	height: 2.4rem;
	color: var(--color-contrast);
}

.msgr-chat__date {
	display: flex;
	align-items: center;
	margin: 1.4rem 1rem 0.2rem;
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 600;
}

.msgr-chat__date::before,
.msgr-chat__date::after {
	content: '';
	height: 1px;
	flex: 1;
	background: rgba(255, 255, 255, 0.08);
}

.msgr-chat__date span {
	padding: 0 0.6rem;
}

.msgr-chat__new {
	position: relative;
	display: flex;
	align-items: center;
	margin: 0.8rem 1rem 0 0;
	height: 1px;
	background: #f23f43;
}

.msgr-chat__new span {
	position: absolute;
	right: 0;
	padding: 0 0.35rem;
	border-radius: 0 4px 4px 0;
	background: #f23f43;
	color: white;
	font-size: 0.62rem;
	font-weight: 800;
	line-height: 1rem;
	transform: translateY(-50%);
	top: 50%;
}

.msgr-chat__error {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.6rem;
	padding: 2rem;
	color: var(--color-secondary);
}

.msgr-chat__error button {
	padding: 0.35rem 0.7rem;
	border: 0;
	border-radius: 6px;
	background: var(--color-brand);
	color: white;
	font: inherit;
	cursor: pointer;
}

.msgr-chat__skeleton {
	padding: 0 1rem;
}

.msgr-chat__skeleton-row {
	display: flex;
	gap: 0.9rem;
	margin: 1.25rem 0;
}

.msgr-chat__skeleton-avatar {
	width: 40px;
	height: 40px;
	flex-shrink: 0;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.06);
	animation: msgr-shimmer 1.2s ease-in-out infinite;
}

.msgr-chat__skeleton-lines {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.5rem;
	padding-top: 0.25rem;
}

.msgr-chat__skeleton-lines span {
	height: 0.75rem;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.06);
	animation: msgr-shimmer 1.2s ease-in-out infinite;
}

.msgr-chat__present {
	position: absolute;
	left: 50%;
	bottom: 6.4rem;
	z-index: 4;
	display: flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.4rem 0.8rem;
	border: 0;
	border-radius: 999px;
	background: var(--color-brand);
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
	color: white;
	font: inherit;
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	transform: translateX(-50%);
}

.msgr-chat__present svg {
	width: 1rem;
	height: 1rem;
}

.msgr-chat__typing {
	display: flex;
	height: 1.35rem;
	align-items: center;
	gap: 0.4rem;
	padding: 0 1.1rem;
	margin-bottom: -0.2rem;
	color: var(--color-secondary);
	font-size: 0.76rem;
}

.msgr-chat__typing b {
	color: var(--color-contrast);
}

.msgr-chat__typing-dots {
	display: inline-flex;
	gap: 3px;
}

.msgr-chat__typing-dots i {
	width: 5px;
	height: 5px;
	border-radius: 50%;
	background: var(--color-contrast);
	animation: msgr-typing 1.2s ease-in-out infinite;
}

.msgr-chat__typing-dots i:nth-child(2) {
	animation-delay: 0.15s;
}

.msgr-chat__typing-dots i:nth-child(3) {
	animation-delay: 0.3s;
}

.msgr-chat__tool {
	display: flex;
	width: 23rem;
	max-width: 50%;
	flex-direction: column;
	border-left: 1px solid rgba(0, 0, 0, 0.35);
	background: #17181b;
}

.msgr-chat__tool header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.75rem 0.9rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.msgr-chat__tool header b {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	color: var(--color-contrast);
	font-size: 0.9rem;
}

.msgr-chat__tool header svg {
	width: 1rem;
	height: 1rem;
}

.msgr-chat__tool header button {
	display: grid;
	padding: 0.2rem;
	border: 0;
	border-radius: 6px;
	background: none;
	color: var(--color-secondary);
	cursor: pointer;
}

.msgr-chat__tool header button:hover {
	background: rgba(255, 255, 255, 0.06);
	color: var(--color-contrast);
}

.msgr-chat__tool-list {
	min-height: 0;
	flex: 1;
	overflow-y: auto;
	padding: 0.5rem;
}

.msgr-chat__tool-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	padding: 2.5rem 1rem;
	color: var(--color-secondary);
	font-size: 0.85rem;
	text-align: center;
}

.msgr-chat__tool-empty svg {
	width: 2rem;
	height: 2rem;
	opacity: 0.5;
}

.msgr-chat__hit {
	display: flex;
	width: 100%;
	gap: 0.6rem;
	padding: 0.6rem;
	margin-bottom: 0.4rem;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 8px;
	background: #1e1f23;
	color: var(--color-base);
	font: inherit;
	font-size: 0.85rem;
	text-align: left;
	cursor: pointer;
	transition:
		border-color 0.12s ease,
		transform 0.12s ease;
}

.msgr-chat__hit:hover {
	border-color: color-mix(in srgb, var(--color-brand) 50%, transparent);
	transform: translateX(-2px);
}

.msgr-chat__hit-body {
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
	gap: 0.15rem;
}

.msgr-chat__hit-head {
	display: flex;
	align-items: baseline;
	gap: 0.4rem;
}

.msgr-chat__hit-head b {
	color: var(--color-contrast);
}

.msgr-chat__hit-head time {
	color: var(--color-secondary);
	font-size: 0.7rem;
}

.msgr-chat__hit-file {
	color: var(--color-secondary);
}

.msgr-chat__drop {
	position: absolute;
	inset: 0;
	z-index: 20;
	display: grid;
	place-items: center;
	background: rgba(10, 10, 14, 0.7);
	backdrop-filter: blur(4px);
	pointer-events: none;
}

.msgr-chat__drop-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.5rem;
	padding: 2rem 3rem;
	border: 2px dashed rgba(255, 255, 255, 0.5);
	border-radius: 16px;
	background: var(--color-brand);
	color: white;
	animation: msgr-pop-in 0.18s ease-out;
}

.msgr-chat__drop-card svg {
	width: 2.6rem;
	height: 2.6rem;
}

.msgr-chat__drop-card b {
	font-size: 1.15rem;
}

.msgr-chat__drop-card span {
	opacity: 0.85;
}

.msgr-panel-enter-active,
.msgr-panel-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.msgr-panel-enter-from,
.msgr-panel-leave-to {
	opacity: 0;
	transform: translateX(16px);
}

.msgr-fade-enter-active,
.msgr-fade-leave-active {
	transition: opacity 0.15s ease;
}

.msgr-fade-enter-from,
.msgr-fade-leave-to {
	opacity: 0;
}

@keyframes msgr-typing {
	0%,
	60%,
	100% {
		opacity: 0.3;
		transform: translateY(0);
	}

	30% {
		opacity: 1;
		transform: translateY(-3px);
	}
}

@keyframes msgr-shimmer {
	50% {
		opacity: 0.45;
	}
}

@keyframes msgr-fade-up {
	from {
		opacity: 0;
		transform: translateY(8px);
	}
}

@keyframes msgr-pop-in {
	from {
		opacity: 0;
		transform: scale(0.94);
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-panel-enter-active,
	.msgr-panel-leave-active,
	.msgr-fade-enter-active,
	.msgr-fade-leave-active,
	.msgr-chat__search,
	.msgr-chat__hit {
		transition: none;
	}

	.msgr-chat__typing-dots i,
	.msgr-chat__skeleton-avatar,
	.msgr-chat__skeleton-lines span,
	.msgr-chat__intro,
	.msgr-chat__intro-actions button,
	.msgr-chat__intro-status i,
	.msgr-chat__drop-card {
		animation: none;
	}
}
</style>
