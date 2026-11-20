<script setup lang="ts">
import {
	FileIcon,
	ImageIcon,
	PackageIcon,
	PlusIcon,
	SearchIcon,
	SendIcon,
	SmileIcon,
	StickyNotePlusIcon,
	TrashIcon,
	XIcon,
} from '@modrinth/assets'
import { convertFileSrc } from '@tauri-apps/api/core'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { list as listInstances } from '@/helpers/instance'
import type { GameInstance } from '@/helpers/types'

import { packBuild } from './builds'
import { openMic } from './devices'
import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import MicIcon from './MicIcon.vue'
import {
	formatDuration,
	formatSize,
	MAX_FILE_BYTES,
	mimeFor,
	type Msg,
	type Peer,
	readFileBase64,
} from './model'
import StickerPicker from './StickerPicker.vue'
import { type OwnSticker, ownStickerFile, PLAYER_STICKER_MARK } from './stickers'
import {
	activeConversation,
	activeKey,
	displayName,
	type PendingAttachment,
	sendMessage,
	sendTyping,
	showToast,
	state,
} from './store'
import type { Anchor } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

const props = defineProps<{
	placeholder: string
	replyTo: Msg | null
	mentionables: Peer[]
	disabled?: boolean
}>()

const emit = defineEmits<{
	cancelReply: []
	editLast: []
	sent: []
}>()

const t = useMessengerT()

const drafts = new Map<string, string>()
const text = ref('')
const box = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const fileAccept = ref('')
const pending = ref<PendingAttachment | null>(null)
const preparing = ref(false)
const sending = ref(false)
const plusAnchor = ref<Anchor | null>(null)
const emojiAnchor = ref<Anchor | null>(null)
const pickerTab = ref<'emoji' | 'stickers'>('emoji')
const buildAnchor = ref<Anchor | null>(null)
const builds = ref<GameInstance[]>([])
const buildQuery = ref('')
const buildBusy = ref('')
const mentionQuery = ref<string | null>(null)
const mentionIndex = ref(0)

const recorder = ref<MediaRecorder | null>(null)
const recordStart = ref(0)
const recordChunks: Blob[] = []
let recordStream: MediaStream | null = null
let recordCancelled = false

const recording = computed(() => Boolean(recorder.value))
const recordSeconds = computed(() => {
	if (!recordStart.value) return 0
	void state.clock
	return (Date.now() - recordStart.value) / 1000
})

const canSend = computed(
	() =>
		!sending.value && !preparing.value && (Boolean(text.value.trim()) || Boolean(pending.value)),
)

const mentionList = computed(() => {
	const query = mentionQuery.value
	if (query === null) return []
	const lower = query.toLowerCase()
	return props.mentionables
		.filter((peer) => peer.username.toLowerCase().startsWith(lower))
		.slice(0, 8)
})

watch(
	activeKey,
	(next, prev) => {
		if (prev) drafts.set(prev, text.value)
		text.value = drafts.get(next) ?? ''
		clearAttachment()
		mentionQuery.value = null
		void nextTick(() => {
			grow()
			focus()
		})
	},
	{ immediate: true },
)

watch(
	() => props.replyTo,
	(msg) => {
		if (msg) focus()
	},
)

function focus(): void {
	box.value?.focus()
}

function grow(): void {
	const el = box.value
	if (!el) return
	el.style.height = 'auto'
	el.style.height = `${Math.min(el.scrollHeight, 220)}px`
}

function updateMention(): void {
	const el = box.value
	if (!el) return
	const before = el.value.slice(0, el.selectionStart ?? el.value.length)
	const match = /(?:^|\s)@([A-Za-z0-9_]{0,32})$/.exec(before)
	mentionQuery.value = match ? match[1] : null
	mentionIndex.value = 0
}

function onInput(): void {
	grow()
	updateMention()
	if (text.value.trim()) sendTyping()
}

function pickMention(peer: Peer): void {
	const el = box.value
	if (!el) return
	const caret = el.selectionStart ?? text.value.length
	const before = text.value.slice(0, caret).replace(/@([A-Za-z0-9_]{0,32})$/, `@${peer.username} `)
	text.value = before + text.value.slice(caret)
	mentionQuery.value = null
	void nextTick(() => {
		el.focus()
		el.setSelectionRange(before.length, before.length)
		grow()
	})
}

function onKey(event: KeyboardEvent): void {
	if (mentionList.value.length) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			const step = event.key === 'ArrowDown' ? 1 : -1
			mentionIndex.value =
				(mentionIndex.value + step + mentionList.value.length) % mentionList.value.length
			return
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault()
			pickMention(mentionList.value[mentionIndex.value])
			return
		}
		if (event.key === 'Escape') {
			mentionQuery.value = null
			return
		}
	}
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault()
		void submit()
		return
	}
	if (event.key === 'Escape' && props.replyTo) {
		emit('cancelReply')
		return
	}
	if (event.key === 'ArrowUp' && !text.value && !pending.value) {
		event.preventDefault()
		emit('editLast')
	}
}

async function submit(): Promise<void> {
	if (!canSend.value || props.disabled) return
	const body = text.value.trim()
	const attachment = pending.value
	sending.value = true
	const ok = await sendMessage({ body, replyToId: props.replyTo?.id, attachment })
	sending.value = false
	if (!ok) return
	text.value = ''
	if (activeKey.value) drafts.delete(activeKey.value)
	clearAttachment()
	emit('sent')
	await nextTick()
	grow()
	focus()
}

function clearAttachment(): void {
	if (pending.value?.preview) URL.revokeObjectURL(pending.value.preview)
	pending.value = null
}

async function addFile(file: File | Blob, name?: string): Promise<void> {
	const fileName = name || (file instanceof File ? file.name : '') || `file_${Date.now()}`
	if (file.size > MAX_FILE_BYTES) {
		showToast(t('app.messenger.file.tooBig', 'Файл больше 1 ГБ — так нельзя'))
		return
	}
	if (!file.size) {
		showToast(t('app.messenger.file.empty', 'Файл пустой'))
		return
	}
	preparing.value = true
	try {
		const mime = mimeFor(fileName, file.type)
		const dataBase64 = await readFileBase64(file)
		clearAttachment()
		pending.value = {
			name: fileName,
			mime,
			size: file.size,
			dataBase64,
			preview: mime.startsWith('image/') ? URL.createObjectURL(file) : '',
		}
		focus()
	} catch {
		showToast(t('app.messenger.file.readFailed', 'Не удалось прочитать файл'))
	} finally {
		preparing.value = false
	}
}

function choose(kind: 'file' | 'image'): void {
	plusAnchor.value = null
	fileAccept.value = kind === 'image' ? 'image/*' : ''
	void nextTick(() => fileInput.value?.click())
}

function onFilePicked(event: Event): void {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (file) void addFile(file)
}

function onPaste(event: ClipboardEvent): void {
	const items = event.clipboardData?.items
	if (!items) return
	for (const item of items) {
		if (item.kind !== 'file') continue
		const file = item.getAsFile()
		if (!file) continue
		event.preventDefault()
		const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
		void addFile(
			file,
			file.name && file.name !== 'image.png' ? file.name : `paste_${Date.now()}.${ext}`,
		)
		return
	}
}

function anchorOf(event: Event): Anchor {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

function togglePlus(event: MouseEvent): void {
	emojiAnchor.value = null
	plusAnchor.value = plusAnchor.value ? null : anchorOf(event)
}

function togglePicker(event: MouseEvent, tab: 'emoji' | 'stickers'): void {
	plusAnchor.value = null
	if (emojiAnchor.value && pickerTab.value === tab) {
		emojiAnchor.value = null
		return
	}
	pickerTab.value = tab
	emojiAnchor.value = anchorOf(event)
}

async function sendSticker(
	body: string,
	attachment: PendingAttachment | null = null,
): Promise<void> {
	emojiAnchor.value = null
	if (props.disabled || sending.value) return
	sending.value = true
	const ok = await sendMessage({ body, replyToId: props.replyTo?.id, attachment })
	sending.value = false
	if (ok) emit('sent')
}

function pickServerSticker(id: number): void {
	void sendSticker(`[[sticker:${id}]]`)
}

function pickOwnSticker(sticker: OwnSticker): void {
	void sendSticker(PLAYER_STICKER_MARK, ownStickerFile(sticker))
}

const shownBuilds = computed(() => {
	const q = buildQuery.value.trim().toLowerCase()
	return q ? builds.value.filter((item) => item.name.toLowerCase().includes(q)) : builds.value
})

async function openBuilds(): Promise<void> {
	const anchor = plusAnchor.value
	plusAnchor.value = null
	buildQuery.value = ''
	builds.value = await listInstances().catch(() => [])
	builds.value.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
	buildAnchor.value = anchor
}

function buildIcon(item: GameInstance): string {
	return item.icon_path ? convertFileSrc(item.icon_path) : ''
}

async function shareBuild(item: GameInstance): Promise<void> {
	if (buildBusy.value) return
	buildBusy.value = item.id
	preparing.value = true
	try {
		const result = await packBuild(item)
		if (typeof result === 'string') {
			showToast(
				result === 'too_large'
					? t(
							'app.messenger.build.tooLarge',
							'Сборка весит больше 1 ГБ — отправить её не получится',
						)
					: t('app.messenger.build.failed', 'Не удалось упаковать сборку'),
			)
			return
		}
		buildAnchor.value = null
		clearAttachment()
		pending.value = result
		focus()
	} finally {
		buildBusy.value = ''
		preparing.value = false
	}
}

function insertEmoji(emoji: string): void {
	const el = box.value
	const caret = el?.selectionStart ?? text.value.length
	text.value = text.value.slice(0, caret) + emoji + text.value.slice(caret)
	void nextTick(() => {
		el?.focus()
		el?.setSelectionRange(caret + emoji.length, caret + emoji.length)
	})
}

function pickRecorderMime(): string {
	for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
		if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return mime
	}
	return ''
}

async function startRecording(): Promise<void> {
	plusAnchor.value = null
	if (recording.value) return
	if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
		showToast(t('app.messenger.voice.unsupported', 'Запись голоса недоступна в этой системе'))
		return
	}
	try {
		recordStream = await openMic()
	} catch {
		showToast(t('app.messenger.call.micDenied', 'Нет доступа к микрофону'))
		return
	}
	const mime = pickRecorderMime()
	const rec = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined)
	recordChunks.length = 0
	recordCancelled = false
	rec.ondataavailable = (event) => {
		if (event.data.size) recordChunks.push(event.data)
	}
	rec.onstop = () => void finishRecording()
	rec.start(250)
	recorder.value = rec
	recordStart.value = Date.now()
}

function stopRecording(cancel: boolean): void {
	recordCancelled = cancel
	recorder.value?.stop()
}

async function finishRecording(): Promise<void> {
	recordStream?.getTracks().forEach((track) => track.stop())
	recordStream = null
	const seconds = (Date.now() - recordStart.value) / 1000
	recorder.value = null
	recordStart.value = 0
	if (recordCancelled) return
	if (seconds < 0.6 || !recordChunks.length) {
		showToast(t('app.messenger.voice.tooShort', 'Слишком короткое голосовое'))
		return
	}
	const blob = new Blob(recordChunks, { type: 'audio/webm' })
	const name = `voice_${Date.now()}.webm`
	if (blob.size > MAX_FILE_BYTES) {
		showToast(t('app.messenger.file.tooBig', 'Файл больше 1 ГБ — так нельзя'))
		return
	}
	const conv = activeConversation.value
	if (!conv) return
	sending.value = true
	const ok = await sendMessage({
		body: '',
		replyToId: props.replyTo?.id,
		attachment: {
			name,
			mime: 'audio/webm',
			size: blob.size,
			dataBase64: await readFileBase64(blob),
			preview: '',
		},
	})
	sending.value = false
	if (ok) emit('sent')
}

onBeforeUnmount(() => {
	if (recorder.value) stopRecording(true)
	clearAttachment()
})

defineExpose({ addFile, focus, insertText: (value: string) => (text.value += value) })
</script>

<template>
	<div class="msgr-composer" :class="{ 'is-disabled': disabled }">
		<Transition name="msgr-slide-up">
			<div v-if="mentionList.length" class="msgr-composer__mentions">
				<div class="msgr-composer__mentions-title">
					{{ t('app.messenger.mention.title', 'Участники') }}
				</div>
				<button
					v-for="(peer, index) in mentionList"
					:key="peer.id"
					type="button"
					:class="{ 'is-active': index === mentionIndex }"
					@mousedown.prevent="pickMention(peer)"
					@mouseenter="mentionIndex = index"
				>
					<UserAvatar :user-id="peer.id" :name="peer.username" :size="22" />
					<b>{{ displayName(peer.id, peer.username) }}</b>
					<span>{{ peer.username }}</span>
				</button>
			</div>
		</Transition>
		<Transition name="msgr-slide-up">
			<div v-if="replyTo" class="msgr-composer__bar">
				<span>
					{{ t('app.messenger.replyingTo', 'Ответ') }}
					<b>{{ displayName(replyTo.senderId, replyTo.senderName) }}</b>
				</span>
				<button
					type="button"
					class="msgr-composer__bar-close"
					:aria-label="t('app.messenger.cancel', 'Отмена')"
					@click="emit('cancelReply')"
				>
					<XIcon />
				</button>
			</div>
		</Transition>
		<Transition name="msgr-slide-up">
			<div v-if="pending || preparing" class="msgr-composer__attachment">
				<div class="msgr-composer__chip">
					<img v-if="pending?.preview" :src="pending.preview" alt="" />
					<span v-else class="msgr-composer__chip-icon"><FileIcon /></span>
					<div class="msgr-composer__chip-body">
						<b>{{ pending?.name ?? t('app.messenger.file.preparing', 'Подготовка…') }}</b>
						<span v-if="pending">{{ formatSize(pending.size) }}</span>
					</div>
					<button
						v-if="pending"
						type="button"
						class="msgr-composer__chip-remove"
						:title="t('app.messenger.file.remove', 'Убрать вложение')"
						@click="clearAttachment"
					>
						<TrashIcon />
					</button>
				</div>
			</div>
		</Transition>
		<div class="msgr-composer__box" :class="{ 'has-top': replyTo || pending || preparing }">
			<button
				type="button"
				class="msgr-composer__icon msgr-composer__plus"
				:class="{ 'is-on': plusAnchor }"
				:aria-label="t('app.messenger.attach', 'Прикрепить')"
				:disabled="disabled || recording"
				@click.stop="togglePlus"
			>
				<PlusIcon />
			</button>
			<div v-if="recording" class="msgr-composer__recording">
				<span class="msgr-composer__rec-dot" />
				<span>{{ t('app.messenger.voice.recording', 'Идёт запись') }}</span>
				<b>{{ formatDuration(recordSeconds) }}</b>
				<button type="button" class="msgr-composer__rec-cancel" @click="stopRecording(true)">
					{{ t('app.messenger.cancel', 'Отмена') }}
				</button>
			</div>
			<textarea
				v-else
				ref="box"
				v-model="text"
				rows="1"
				maxlength="4000"
				:placeholder="placeholder"
				:disabled="disabled"
				@input="onInput"
				@keydown="onKey"
				@paste="onPaste"
				@click="updateMention"
				@blur="mentionQuery = null"
			/>
			<button
				type="button"
				class="msgr-composer__icon"
				:class="{ 'is-recording': recording }"
				:title="
					recording
						? t('app.messenger.voice.stop', 'Остановить и отправить')
						: t('app.messenger.voice.record', 'Записать голосовое')
				"
				:disabled="disabled || sending"
				@click="recording ? stopRecording(false) : startRecording()"
			>
				<SendIcon v-if="recording" />
				<MicIcon v-else />
			</button>
			<button
				v-if="!recording"
				type="button"
				class="msgr-composer__icon"
				:class="{ 'is-on': emojiAnchor && pickerTab === 'stickers' }"
				:title="t('app.messenger.stickers.title', 'Стикеры')"
				:disabled="disabled"
				@click.stop="togglePicker($event, 'stickers')"
			>
				<StickyNotePlusIcon />
			</button>
			<button
				v-if="!recording"
				type="button"
				class="msgr-composer__icon"
				:class="{ 'is-on': emojiAnchor && pickerTab === 'emoji' }"
				:aria-label="t('app.messenger.emoji', 'Эмодзи')"
				:disabled="disabled"
				@click.stop="togglePicker($event, 'emoji')"
			>
				<SmileIcon />
			</button>
			<button
				v-if="!recording"
				type="button"
				class="msgr-composer__send"
				:disabled="!canSend || disabled"
				:aria-label="t('app.messenger.send', 'Отправить')"
				@click="submit"
			>
				<SendIcon />
			</button>
		</div>
		<input ref="fileInput" type="file" hidden :accept="fileAccept" @change="onFilePicked" />

		<FloatingMenu
			:anchor="plusAnchor"
			placement="top-start"
			:width="240"
			@close="plusAnchor = null"
		>
			<button type="button" class="msgr-menu-item" @click="choose('file')">
				<FileIcon />
				<span>{{ t('app.messenger.plus.file', 'Загрузить файл') }}</span>
				<span class="msgr-menu-item__hint">≤ 1 ГБ</span>
			</button>
			<button type="button" class="msgr-menu-item" @click="choose('image')">
				<ImageIcon /> {{ t('app.messenger.plus.image', 'Изображение или GIF') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="openBuilds">
				<PackageIcon /> {{ t('app.messenger.plus.build', 'Отправить сборку') }}
			</button>
		</FloatingMenu>
		<FloatingMenu
			:anchor="buildAnchor"
			placement="top-start"
			:width="300"
			@close="buildAnchor = buildBusy ? buildAnchor : null"
		>
			<div class="msgr-builds">
				<label class="msgr-builds__search">
					<SearchIcon />
					<input
						v-model="buildQuery"
						type="search"
						:placeholder="t('app.messenger.build.search', 'Найти сборку')"
						autocomplete="off"
					/>
				</label>
				<div class="msgr-builds__list">
					<button
						v-for="item in shownBuilds"
						:key="item.id"
						type="button"
						class="msgr-builds__item"
						:disabled="Boolean(buildBusy)"
						@click="shareBuild(item)"
					>
						<span class="msgr-builds__icon">
							<img v-if="buildIcon(item)" :src="buildIcon(item)" alt="" />
							<PackageIcon v-else />
						</span>
						<span class="msgr-builds__meta">
							<b>{{ item.name }}</b>
							<span>{{ item.loader }} {{ item.game_version }}</span>
						</span>
						<span v-if="buildBusy === item.id" class="msgr-spinner msgr-builds__spin" />
					</button>
					<p v-if="!shownBuilds.length" class="msgr-builds__empty">
						{{ t('app.messenger.build.empty', 'Сборок не найдено') }}
					</p>
				</div>
			</div>
		</FloatingMenu>
		<FloatingMenu :anchor="emojiAnchor" placement="top-end" @close="emojiAnchor = null">
			<StickerPicker
				:key="pickerTab"
				:tab="pickerTab"
				@emoji="insertEmoji"
				@sticker="pickServerSticker"
				@own="pickOwnSticker"
			/>
		</FloatingMenu>
	</div>
</template>

<style scoped>
.msgr-builds {
	display: flex;
	max-height: 22rem;
	flex-direction: column;
	gap: 0.4rem;
}

.msgr-builds__search {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	padding: 0 0.6rem;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.28);
	color: var(--color-secondary);
}

.msgr-builds__search svg {
	width: 0.95rem;
	height: 0.95rem;
}

.msgr-builds__search input {
	min-width: 0;
	flex: 1;
	height: 2rem;
	border: 0;
	background: transparent;
	box-shadow: none;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.85rem;
	outline: none;
}

.msgr-builds__list {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	overflow-y: auto;
	scrollbar-width: thin;
}

.msgr-builds__item {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.4rem 0.45rem;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: background 0.15s ease;
}

.msgr-builds__item:hover:not(:disabled) {
	background: rgba(255, 255, 255, 0.07);
}

.msgr-builds__item:disabled {
	cursor: default;
	opacity: 0.7;
}

.msgr-builds__icon {
	display: grid;
	width: 2.2rem;
	height: 2.2rem;
	flex-shrink: 0;
	place-items: center;
	overflow: hidden;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.3);
	color: var(--color-secondary);
}

.msgr-builds__icon img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.msgr-builds__icon svg {
	width: 1.1rem;
	height: 1.1rem;
}

.msgr-builds__meta {
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
}

.msgr-builds__meta b {
	overflow: hidden;
	font-size: 0.86rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-builds__meta span {
	overflow: hidden;
	color: var(--color-secondary);
	font-size: 0.74rem;
	text-overflow: ellipsis;
	text-transform: capitalize;
	white-space: nowrap;
}

.msgr-builds__spin {
	width: 1rem;
	height: 1rem;
}

.msgr-builds__empty {
	margin: 0;
	padding: 0.8rem;
	color: var(--color-secondary);
	font-size: 0.82rem;
	text-align: center;
}

.msgr-composer {
	position: relative;
	padding: 0 1rem 1.1rem;
}

.msgr-composer__box {
	display: flex;
	align-items: flex-end;
	gap: 0.15rem;
	padding: 0.3rem 0.4rem;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 10px;
	background: #222327;
	box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25);
	transition: border-color 0.15s ease;
}

.msgr-composer__box:focus-within {
	border-color: color-mix(in srgb, var(--color-brand) 45%, transparent);
}

.msgr-composer__box.has-top {
	border-top-left-radius: 0;
	border-top-right-radius: 0;
}

.msgr-composer textarea {
	min-height: 2.4rem;
	max-height: 13.75rem;
	flex: 1;
	padding: 0.6rem 0.4rem;
	border: 0;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.95rem;
	line-height: 1.35;
	resize: none;
	outline: none;
}

.msgr-composer textarea::placeholder {
	color: var(--color-secondary);
}

.msgr-composer__icon,
.msgr-composer__send {
	display: grid;
	width: 2.4rem;
	height: 2.4rem;
	flex-shrink: 0;
	place-items: center;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
	transition:
		background 0.12s ease,
		color 0.12s ease,
		transform 0.12s ease;
}

.msgr-composer__icon:hover:not(:disabled),
.msgr-composer__icon.is-on {
	background: rgba(255, 255, 255, 0.07);
	color: var(--color-contrast);
}

.msgr-composer__plus svg {
	transition: transform 0.18s ease;
}

.msgr-composer__plus.is-on svg {
	transform: rotate(45deg);
}

.msgr-composer__icon svg,
.msgr-composer__send svg {
	width: 1.25rem;
	height: 1.25rem;
}

.msgr-composer__icon.is-recording {
	background: #da373c;
	color: white;
}

.msgr-composer__send {
	background: var(--color-brand);
	color: white;
}

.msgr-composer__send:hover:not(:disabled) {
	transform: scale(1.05);
}

.msgr-composer__send:disabled {
	background: rgba(255, 255, 255, 0.06);
	color: var(--color-secondary);
	cursor: default;
}

.msgr-composer__icon:disabled {
	opacity: 0.45;
	cursor: default;
}

.msgr-composer__bar,
.msgr-composer__attachment {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.45rem 0.75rem;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-bottom: 0;
	border-radius: 10px 10px 0 0;
	background: #1b1c20;
	color: var(--color-secondary);
	font-size: 0.82rem;
}

.msgr-composer__attachment + .msgr-composer__box,
.msgr-composer__bar + .msgr-composer__attachment {
	border-top-left-radius: 0;
	border-top-right-radius: 0;
}

.msgr-composer__bar b {
	color: var(--color-contrast);
}

.msgr-composer__bar-close {
	display: grid;
	width: 1.4rem;
	height: 1.4rem;
	place-items: center;
	border: 0;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-contrast);
	cursor: pointer;
}

.msgr-composer__bar-close svg {
	width: 0.85rem;
	height: 0.85rem;
}

.msgr-composer__chip {
	position: relative;
	display: flex;
	align-items: center;
	gap: 0.6rem;
	max-width: 100%;
	padding: 0.4rem 2.4rem 0.4rem 0.4rem;
	border-radius: 8px;
	background: #2b2d31;
	animation: msgr-pop-in 0.18s ease-out;
}

.msgr-composer__chip img {
	width: 3.2rem;
	height: 3.2rem;
	border-radius: 6px;
	object-fit: cover;
}

.msgr-composer__chip-icon {
	display: grid;
	width: 2.6rem;
	height: 2.6rem;
	place-items: center;
	border-radius: 6px;
	background: color-mix(in srgb, var(--color-brand) 20%, transparent);
	color: var(--color-brand);
}

.msgr-composer__chip-body {
	display: flex;
	min-width: 0;
	flex-direction: column;
}

.msgr-composer__chip-body b {
	overflow: hidden;
	max-width: 18rem;
	color: var(--color-contrast);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-composer__chip-remove {
	position: absolute;
	right: 0.35rem;
	top: 50%;
	display: grid;
	width: 1.8rem;
	height: 1.8rem;
	place-items: center;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: #f87171;
	cursor: pointer;
	transform: translateY(-50%);
}

.msgr-composer__chip-remove:hover {
	background: rgba(248, 113, 113, 0.15);
}

.msgr-composer__chip-remove svg {
	width: 1rem;
	height: 1rem;
}

.msgr-composer__recording {
	display: flex;
	min-height: 2.4rem;
	flex: 1;
	align-items: center;
	gap: 0.6rem;
	padding: 0 0.5rem;
	color: var(--color-contrast);
	font-size: 0.9rem;
}

.msgr-composer__recording b {
	font-variant-numeric: tabular-nums;
}

.msgr-composer__rec-dot {
	width: 0.65rem;
	height: 0.65rem;
	border-radius: 50%;
	background: #f23f43;
	animation: msgr-rec 1s ease-in-out infinite;
}

.msgr-composer__rec-cancel {
	margin-left: auto;
	padding: 0.3rem 0.6rem;
	border: 0;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.07);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.8rem;
	cursor: pointer;
}

.msgr-composer__mentions {
	position: absolute;
	left: 1rem;
	right: 1rem;
	bottom: calc(100% - 0.6rem);
	z-index: 5;
	padding: 0.4rem;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 10px;
	background: #111214;
	box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.45);
}

.msgr-composer__mentions-title {
	padding: 0.2rem 0.5rem 0.4rem;
	color: var(--color-secondary);
	font-size: 0.7rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.msgr-composer__mentions button {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 0.55rem;
	padding: 0.35rem 0.5rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: 0.88rem;
	text-align: left;
	cursor: pointer;
}

.msgr-composer__mentions button span {
	color: var(--color-secondary);
	font-size: 0.78rem;
}

.msgr-composer__mentions button.is-active {
	background: rgba(255, 255, 255, 0.07);
}

.msgr-slide-up-enter-active,
.msgr-slide-up-leave-active {
	transition:
		opacity 0.15s ease,
		transform 0.15s ease;
}

.msgr-slide-up-enter-from,
.msgr-slide-up-leave-to {
	opacity: 0;
	transform: translateY(6px);
}

@keyframes msgr-rec {
	50% {
		opacity: 0.3;
	}
}

@keyframes msgr-pop-in {
	from {
		opacity: 0;
		transform: scale(0.95);
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-slide-up-enter-active,
	.msgr-slide-up-leave-active,
	.msgr-composer__chip,
	.msgr-composer__rec-dot,
	.msgr-composer__plus svg {
		transition: none;
		animation: none;
	}
}
</style>
