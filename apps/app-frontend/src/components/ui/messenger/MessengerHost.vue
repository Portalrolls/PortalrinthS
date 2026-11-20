<script setup lang="ts">
import './messenger.css'

import { XIcon } from '@modrinth/assets'
import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
} from '@tauri-apps/plugin-notification'
import { computed, onMounted, onUnmounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useAppEvent } from '@/composables/use-app-event'
import { get as getInstance } from '@/helpers/instance'
import { list_lan_relays } from '@/helpers/lan'
import { initMessengerCall } from '@/helpers/messenger-call'
import { get_all as runningProcesses } from '@/helpers/process'
import { onServiceAccountChange, serviceRequest } from '@/helpers/uprojects-service'

import CallBar from './CallBar.vue'
import { playSound, voicePrefs } from './devices'
import { useMessengerT } from './i18n'
import type { Attachment, Conversation, Msg } from './model'
import ServiceImage from './ServiceImage.vue'
import { stickerPreviewText } from './stickers'
import {
	connect,
	displayName,
	me,
	myId,
	onIncomingMessage,
	openChannel,
	openDm,
	openServer,
	resetState,
	sendMessage,
	setActivity,
	setFailText,
	showToast,
	state,
} from './store'
import UserAvatar from './UserAvatar.vue'
import { initVoiceChannels } from './voice-channel'

const t = useMessengerT()
const router = useRouter()

setFailText((code) => {
	switch (code) {
		case 'mic':
			return t('app.messenger.call.micDenied', 'Нет доступа к микрофону')
		case 'forward':
			return t('app.messenger.error.forward', 'Не во все чаты удалось переслать сообщение')
		case 'forbidden':
		case '403':
			return t('app.messenger.error.forbidden', 'Недостаточно прав для этого действия')
		case 'not_found':
		case '404':
			return t('app.messenger.error.notFound', 'Не найдено — возможно, это уже удалили')
		case 'too_large':
		case 'payload_too_large':
		case '413':
			return t('app.messenger.error.tooLarge', 'Файл слишком большой (максимум 1 ГБ)')
		case 'rate_limited':
		case '429':
			return t('app.messenger.error.rate', 'Слишком часто. Подождите немного')
		case 'blocked':
			return t('app.messenger.error.blocked', 'Пользователь ограничил общение с вами')
		case 'network':
			return t('app.messenger.error.network', 'Нет связи с сервером')
		case 'delete':
			return t(
				'app.messenger.delete.forAllFailed',
				'Не удалось удалить у всех — сообщение скрыто только у вас',
			)
		default:
			return t('app.messenger.error.generic', 'Не получилось: {code}', { code })
	}
})

initMessengerCall({
	req: (path, opts) => serviceRequest(path, opts),
	me: () => (me.value ? { id: me.value.id, username: me.value.username } : null),
	onChange: () => {
		state.callTick += 1
	},
	toast: (text) => showToast(text),
	micDeniedText: () => t('app.messenger.call.micDenied', 'Нет доступа к микрофону'),
	failedText: () => t('app.messenger.call.failed', 'Не удалось соединиться'),
	noAnswerText: () => t('app.messenger.call.noAnswer', 'Нет ответа'),
	lostText: () => t('app.messenger.call.lost', 'Соединение со звонком потеряно'),
	busyText: () => t('app.messenger.call.busy', 'Собеседник сейчас в другом звонке'),
})

watch(
	myId,
	(id) => {
		initVoiceChannels({
			myId: id,
			error: (code) =>
				showToast(
					code === 'mic'
						? t('app.messenger.call.micDenied', 'Нет доступа к микрофону')
						: t('app.messenger.voice.failed', 'Не удалось подключиться к голосовому каналу'),
				),
		})
	},
	{ immediate: true },
)

const stopAccountWatch = onServiceAccountChange(() => {
	resetState()
	void connect(true)
})

type ProcessRow = { uuid: string; instance_id: string }

const playing = new Map<string, string>()

let activityJson = ''

/** Друзья видят «Играет в …», только пока мы сами сообщаем серверу, что игра запущена. */
async function syncActivity(): Promise<void> {
	const rows = ((await runningProcesses().catch(() => [])) || []) as ProcessRow[]
	playing.clear()
	for (const row of rows) playing.set(row.uuid, row.instance_id)
	const instanceId = [...playing.values()].pop()
	if (!instanceId) {
		if (activityJson) setActivity(null)
		activityJson = ''
		return
	}
	const instance = await getInstance(instanceId).catch(() => null)
	// Открытый мир по сети делим с друзьями: их «Миры по сети» показывают
	// карточку мира, а у опубликованного мира — ещё и адрес для подключения.
	const relays = (await list_lan_relays().catch(() => [])) || []
	const open =
		relays.find(
			(relay) =>
				relay.instance_id === instanceId && (relay.state === 'ready' || relay.state === 'live'),
		) ??
		relays.find((relay) => relay.state === 'ready' || relay.state === 'live') ??
		null
	const address =
		open && open.state === 'live' && open.public_host && open.public_port
			? `${open.public_host}:${open.public_port}`
			: ''
	const payload = {
		playing: true,
		buildName: instance?.name || '',
		gameVersion: instance?.game_version || '',
		loader: instance?.loader || '',
		...(open
			? {
					worldShare: true,
					serverName: open.instance_name || instance?.name || '',
					serverHost: address,
				}
			: {}),
	}
	const json = JSON.stringify(payload)
	if (json === activityJson) return
	activityJson = json
	setActivity(payload)
}

/** Мир по сети открывают кнопкой в самой игре — без опроса лаунчер его не заметит. */
const activityPoll = setInterval(() => {
	if (state.session) void syncActivity()
}, 20000)

useAppEvent('process', (event) => {
	if (event.event === 'launched' || event.event === 'finished') void syncActivity()
})

watch(
	() => state.session,
	(session, before) => {
		if (session && !before) void syncActivity()
	},
)

type PushToast = {
	id: string
	convId: string
	dm: boolean
	/** Канал сервера: переход по клику открывает именно его. */
	channelId: string
	senderId: string
	name: string
	text: string
	media: Attachment | null
	expanded: boolean
	reply: string
	sending: boolean
	timer: ReturnType<typeof setTimeout> | null
}

/** Нативное уведомление, по которому окно ещё не открывали. */
type PendingJump = { convId: string; dm: boolean; channelId: string; at: number }

let pendingJump: PendingJump | null = null

const JUMP_WINDOW_MS = 30_000

/** Нативный пуш — когда лаунчер свёрнут или в другом окне. */
async function notifyNative(title: string, body: string): Promise<void> {
	try {
		if (document.hasFocus()) return
		let granted = await isPermissionGranted()
		if (!granted) granted = (await requestPermission()) === 'granted'
		if (granted) sendNotification({ title, body })
	} catch {
		/* без нативных уведомлений остаются тосты */
	}
}

function jumpTo(target: { convId: string; dm: boolean; channelId: string }): void {
	void (async () => {
		await router.push('/messenger')
		if (target.dm) await openDm(target.convId)
		else {
			await openServer(target.convId)
			if (target.channelId) await openChannel(target.convId, target.channelId)
		}
	})()
}

/** Клик по пушу Windows сам выводит окно на передний план — за ним доскакиваем до чата. */
function onWindowFocus(): void {
	if (!pendingJump) return
	if (Date.now() - pendingJump.at > JUMP_WINDOW_MS) {
		pendingJump = null
		return
	}
	const target = pendingJump
	pendingJump = null
	jumpTo(target)
}

/** Сколько висит уведомление, если с ним ничего не делали. */
const PUSH_LIFETIME = 20_000
const PUSH_SHORT = 90

const toasts = reactive<PushToast[]>([])

function scheduleClose(toast: PushToast, ms = PUSH_LIFETIME): void {
	if (toast.timer) clearTimeout(toast.timer)
	toast.timer = null
	// Развёрнутое пользователь закрывает сам.
	if (toast.expanded) return
	toast.timer = setTimeout(() => closeToast(toast.id), ms)
}

function closeToast(id: string): void {
	const index = toasts.findIndex((entry) => entry.id === id)
	if (index < 0) return
	const [toast] = toasts.splice(index, 1)
	if (toast.timer) clearTimeout(toast.timer)
}

function holdToast(toast: PushToast): void {
	if (toast.timer) clearTimeout(toast.timer)
	toast.timer = null
}

function canExpand(toast: PushToast): boolean {
	return (
		!toast.expanded && (toast.text.length > PUSH_SHORT || /\n/.test(toast.text) || !!toast.media)
	)
}

function expandToast(toast: PushToast): void {
	toast.expanded = true
	holdToast(toast)
}

function previewText(msg: Msg): string {
	const sticker = stickerPreviewText(msg.body)
	if (sticker) return t('app.messenger.push.sticker', 'Стикер')
	const text = msg.body.trim()
	if (text) return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
	if (msg.kind === 'voice' || msg.attachment?.kind === 'voice') {
		return t('app.messenger.push.voice', 'Голосовое сообщение')
	}
	const kind = msg.attachment?.kind
	if (kind === 'image' || kind === 'gif') return t('app.messenger.push.image', 'Изображение')
	return msg.attachment ? t('app.messenger.push.attachment', 'Вложение') : ''
}

function mediaOf(msg: Msg): Attachment | null {
	const kind = msg.attachment?.kind
	return kind === 'image' || kind === 'gif' ? msg.attachment : null
}

const stopIncoming = onIncomingMessage((msg: Msg, conv: Conversation) => {
	if (voicePrefs.notifySound) playSound('message')
	if (!voicePrefs.notifyToasts) return
	const existing = toasts.find((entry) => entry.convId === conv.id)
	const name = displayName(msg.senderId, msg.senderName) || conv.title
	const title = conv.dm ? name : `${name} · ${conv.title}`
	const channelId = conv.dm ? '' : msg.channelId || ''
	// Окно свёрнуто — ин-app тост не виден: дублируем нативным пушем.
	if (!document.hasFocus()) {
		pendingJump = { convId: conv.id, dm: conv.dm, channelId, at: Date.now() }
		void notifyNative(title, previewText(msg) || 'MC Messenger')
	}
	if (existing) {
		existing.channelId = channelId
		existing.text = previewText(msg)
		existing.media = mediaOf(msg)
		existing.senderId = msg.senderId
		existing.name = title
		scheduleClose(existing)
		return
	}
	const toast: PushToast = {
		id: msg.id,
		convId: conv.id,
		dm: conv.dm,
		channelId,
		senderId: msg.senderId,
		name: title,
		text: previewText(msg),
		media: mediaOf(msg),
		expanded: false,
		reply: '',
		sending: false,
		timer: null,
	}
	toasts.unshift(toast)
	while (toasts.length > 4) {
		const last = toasts.pop()
		if (last?.timer) clearTimeout(last.timer)
	}
	scheduleClose(toasts[0])
})

async function openToast(toast: PushToast): Promise<void> {
	closeToast(toast.id)
	await router.push('/messenger')
	if (toast.dm) await openDm(toast.convId)
	else {
		await openServer(toast.convId)
		if (toast.channelId) await openChannel(toast.convId, toast.channelId)
	}
}

/** Ответ прямо из пуша, не открывая чат. */
async function replyFromToast(toast: PushToast): Promise<void> {
	const body = toast.reply.trim()
	if (!body || toast.sending) return
	toast.sending = true
	try {
		const ok = await sendMessage({
			body,
			convId: toast.convId,
			channelId: toast.channelId || undefined,
		})
		if (ok) closeToast(toast.id)
		else toast.reply = body
	} finally {
		toast.sending = false
	}
}

const toastKey = computed(() => state.toast.id)

onMounted(() => {
	if (!state.session && !state.loading) void connect()
	window.addEventListener('focus', onWindowFocus)
})

onUnmounted(() => {
	stopAccountWatch()
	stopIncoming()
	clearInterval(activityPoll)
	window.removeEventListener('focus', onWindowFocus)
	for (const toast of toasts) if (toast.timer) clearTimeout(toast.timer)
})
</script>

<template>
	<div class="msgr-root msgr-host">
		<CallBar mode="incoming" />
		<Teleport to="body">
			<Transition name="msgr-toast">
				<div v-if="state.toast.text" :key="toastKey" class="msgr-toast" role="status">
					{{ state.toast.text }}
				</div>
			</Transition>
			<TransitionGroup tag="div" name="msgr-push" class="msgr-push-stack msgr-root">
				<article
					v-for="toast in toasts"
					:key="toast.id"
					class="msgr-push"
					role="button"
					tabindex="0"
					:class="{ 'is-expanded': toast.expanded }"
					@mouseenter="holdToast(toast)"
					@mouseleave="scheduleClose(toast)"
					@click="openToast(toast)"
					@keydown.enter="openToast(toast)"
				>
					<UserAvatar :user-id="toast.senderId" :name="toast.name" :size="40" />
					<div class="msgr-push__body">
						<header>
							<b>{{ toast.name }}</b>
							<button
								type="button"
								class="msgr-push__close"
								:aria-label="t('app.messenger.push.close', 'Закрыть')"
								@click.stop="closeToast(toast.id)"
							>
								<XIcon />
							</button>
						</header>
						<p v-if="toast.text">{{ toast.text }}</p>
						<ServiceImage
							v-if="toast.expanded && toast.media"
							class="msgr-push__media"
							:src="toast.media.url"
							:mime="toast.media.mime"
							:lazy="false"
						/>
						<button
							v-if="canExpand(toast)"
							type="button"
							class="msgr-push__more"
							@click.stop="expandToast(toast)"
						>
							{{ t('app.messenger.push.more', 'Показать ещё') }}
						</button>
						<form
							class="msgr-push__reply"
							@submit.prevent="replyFromToast(toast)"
							@click.stop
							@keydown.stop
						>
							<input
								v-model="toast.reply"
								type="text"
								:placeholder="t('app.messenger.push.reply', 'Ответить…')"
								autocomplete="off"
								spellcheck="false"
							/>
							<button
								type="submit"
								:disabled="!toast.reply.trim() || toast.sending"
								:aria-label="t('app.messenger.push.replySend', 'Отправить')"
							>
								{{ t('app.messenger.push.replySend', 'Отправить') }}
							</button>
						</form>
					</div>
				</article>
			</TransitionGroup>
		</Teleport>
	</div>
</template>

<style scoped>
.msgr-host {
	display: contents;
}

.msgr-toast {
	position: fixed;
	bottom: 1.5rem;
	left: 50%;
	z-index: 350;
	max-width: min(32rem, 90vw);
	padding: 0.65rem 1rem;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 10px;
	background: #111214;
	box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
	color: #f2f3f5;
	font-size: 0.88rem;
	transform: translateX(-50%);
}

.msgr-toast-enter-active,
.msgr-toast-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.msgr-toast-enter-from,
.msgr-toast-leave-to {
	opacity: 0;
	transform: translate(-50%, 10px);
}

.msgr-push-stack {
	position: fixed;
	right: 1.25rem;
	bottom: 1.25rem;
	z-index: 340;
	display: flex;
	width: min(22rem, calc(100vw - 2.5rem));
	flex-direction: column-reverse;
	gap: 0.6rem;
	pointer-events: none;
}

.msgr-push {
	display: flex;
	gap: 0.7rem;
	padding: 0.75rem 0.8rem;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 14px;
	background: #16171b;
	box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
	color: #dbdee1;
	cursor: pointer;
	pointer-events: auto;
	transition:
		transform 0.18s ease,
		border-color 0.18s ease;
}

.msgr-push:hover {
	border-color: color-mix(in srgb, var(--color-brand) 45%, transparent);
	transform: translateY(-2px);
}

.msgr-push__body {
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
	gap: 0.2rem;
}

.msgr-push__body header {
	display: flex;
	align-items: center;
	gap: 0.4rem;
}

.msgr-push__body b {
	overflow: hidden;
	flex: 1;
	color: #f2f3f5;
	font-size: 0.9rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-push__body p {
	display: -webkit-box;
	overflow: hidden;
	margin: 0;
	font-size: 0.85rem;
	line-height: 1.35;
	overflow-wrap: anywhere;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
}

.msgr-push.is-expanded .msgr-push__body p {
	display: block;
	overflow: auto;
	max-height: 14rem;
	white-space: pre-wrap;
}

.msgr-push__media {
	display: block;
	max-width: 100%;
	max-height: 12rem;
	margin-top: 0.3rem;
	border-radius: 8px;
	background: #0e0f12;
	object-fit: contain;
}

.msgr-push__more {
	align-self: flex-start;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-brand);
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
}

.msgr-push__more:hover {
	text-decoration: underline;
}

.msgr-push__reply {
	display: flex;
	gap: 0.35rem;
	margin-top: 0.4rem;
}

.msgr-push__reply input {
	min-width: 0;
	flex: 1;
	padding: 0.3rem 0.55rem;
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 8px;
	background: #0e0f12;
	color: #f2f3f5;
	font: inherit;
	font-size: 0.82rem;
}

.msgr-push__reply input:focus {
	outline: none;
	border-color: color-mix(in srgb, var(--color-brand) 55%, transparent);
}

.msgr-push__reply button {
	padding: 0.3rem 0.6rem;
	border: 0;
	border-radius: 8px;
	background: var(--color-brand);
	color: white;
	font: inherit;
	font-size: 0.78rem;
	font-weight: 600;
	cursor: pointer;
}

.msgr-push__reply button:disabled {
	opacity: 0.5;
	cursor: default;
}

.msgr-push__close {
	display: grid;
	width: 1.4rem;
	height: 1.4rem;
	flex-shrink: 0;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 6px;
	background: none;
	color: var(--color-secondary);
	cursor: pointer;
}

.msgr-push__close:hover {
	background: rgba(255, 255, 255, 0.08);
	color: #f2f3f5;
}

.msgr-push__close svg {
	width: 0.9rem;
	height: 0.9rem;
}

.msgr-push-enter-active,
.msgr-push-leave-active,
.msgr-push-move {
	transition:
		opacity 0.24s ease,
		transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}

.msgr-push-enter-from {
	opacity: 0;
	transform: translateX(110%);
}

.msgr-push-leave-to {
	opacity: 0;
	transform: translateX(40%) scale(0.96);
}

.msgr-push-leave-active {
	position: absolute;
	right: 0;
	left: 0;
}

@media (prefers-reduced-motion: reduce) {
	.msgr-toast-enter-active,
	.msgr-toast-leave-active,
	.msgr-push-enter-active,
	.msgr-push-leave-active,
	.msgr-push-move,
	.msgr-push {
		transition: none;
	}
}
</style>
