<script setup lang="ts">
import {
	CheckIcon,
	CopyIcon,
	EditIcon,
	HashIcon,
	HeartIcon,
	LinkIcon,
	MoreHorizontalIcon,
	PinIcon,
	ReplyIcon,
	ReportIcon,
	SaveIcon,
	SendIcon,
	ShareIcon,
	SmileIcon,
	TrashIcon,
	UserIcon,
} from '@modrinth/assets'
import { computed, nextTick, ref, watch } from 'vue'

import { QUICK_REACTIONS, REACTIONS } from './emoji'
import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import MessageAttachment from './MessageAttachment.vue'
import MessageText from './MessageText.vue'
import { formatDate, formatTime, type Msg, stripXferMarker, xferIdOf } from './model'
import ProfileCard from './ProfileCard.vue'
import { isOnlyEmoji } from './rich-text'
import { isPlayerSticker, saveStickerFromUrl, stickerById, stickerIdOf } from './stickers'
import StickerView from './StickerView.vue'
import {
	activeServer,
	canManage,
	deleteMessage,
	displayName,
	hideMessageForMe,
	memberOf,
	myId,
	pinMessage,
	reactMessage,
	reportMessage,
	showToast,
	state,
} from './store'
import { vTip } from './tooltip'
import {
	type Anchor,
	askChoice,
	askPrompt,
	openForward,
	openLightbox,
	openPopover,
	openProfile,
} from './ui-bus'
import UserAvatar from './UserAvatar.vue'

const props = withDefaults(
	defineProps<{
		msg: Msg
		grouped: boolean
		editing: boolean
		highlight: boolean
		selectMode: boolean
		selected: boolean
	}>(),
	{},
)

const emit = defineEmits<{
	reply: [msg: Msg]
	edit: [msg: Msg]
	save: [msg: Msg, text: string]
	cancel: []
	jump: [id: string]
	select: [msg: Msg]
	toggleSelect: [msg: Msg]
}>()

const t = useMessengerT()

const menuAnchor = ref<Anchor | null>(null)
const pickerAnchor = ref<Anchor | null>(null)
const editText = ref('')
const editBox = ref<HTMLTextAreaElement | null>(null)

const mine = computed(() => props.msg.senderId === myId.value)
const system = computed(() => props.msg.kind === 'system')
const author = computed(() => displayName(props.msg.senderId, props.msg.senderName) || '?')
const bigEmoji = computed(() => !props.msg.attachment && isOnlyEmoji(props.msg.body))
/** P2P-передача большого файла: маркер в теле не показывается, карточке нужен только id. */
const xferId = computed(() => xferIdOf(props.msg.body))
const displayBody = computed(() => stripXferMarker(props.msg.body))
const serverSticker = computed(() => {
	const id = stickerIdOf(props.msg.body)
	return id === null ? null : stickerById(id)
})
const playerSticker = computed(() =>
	isPlayerSticker(props.msg.body) && props.msg.attachment?.kind !== 'file'
		? props.msg.attachment
		: null,
)
const isSticker = computed(() => Boolean(serverSticker.value || playerSticker.value))

/** Вложение-визитка: [[profile:id]] — профиль игрока, [[group:id]] — группа. */
const userCard = computed(() => {
	const match = /^\[\[(?:profile|user):([^\]]+)\]\]$/.exec(props.msg.body.trim())
	return match ? match[1] : ''
})
const groupCard = computed(() => {
	const match = /^\[\[group:([^\]]+)\]\]$/.exec(props.msg.body.trim())
	return match ? match[1] : ''
})

/** Пересланное сообщение приходит текстом «↪ автор: текст» — разбираем его обратно. */
const forwarded = computed(() => {
	const match = /^↪ ([^:\n]{1,64}): ?([\s\S]*)$/.exec(props.msg.body)
	return match ? { author: match[1], text: match[2] } : null
})
const canDelete = computed(() => mine.value || canManage.value)
const canPin = computed(() => !activeServer.value || canManage.value || mine.value)
const liked = computed(() =>
	props.msg.reactions.some((reaction) => reaction.emoji === '❤️' && reaction.me),
)
const isBot = computed(() => Boolean(state.users[props.msg.senderId]?.bot))

const roleColor = computed(() => {
	const server = activeServer.value
	const member = memberOf(server, props.msg.senderId)
	if (!server || !member) return ''
	const role = server.roles
		.filter((entry) => member.roleIds.includes(entry.id) && entry.color)
		.sort((a, b) => b.position - a.position)[0]
	return role?.color || ''
})

const reactionNames = computed(() => (emoji: string) => {
	const reaction = props.msg.reactions.find((entry) => entry.emoji === emoji)
	return reaction ? `${emoji} ×${reaction.count}` : emoji
})

watch(
	() => props.editing,
	async (on) => {
		if (!on) return
		editText.value = props.msg.body
		await nextTick()
		const el = editBox.value
		if (!el) return
		el.focus()
		el.setSelectionRange(el.value.length, el.value.length)
		grow()
	},
	{ immediate: true },
)

function grow(): void {
	const el = editBox.value
	if (!el) return
	el.style.height = 'auto'
	el.style.height = `${Math.min(el.scrollHeight, 240)}px`
}

function onEditKey(event: KeyboardEvent): void {
	if (event.key === 'Escape') {
		event.preventDefault()
		emit('cancel')
	} else if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault()
		saveEdit()
	}
}

function saveEdit(): void {
	const text = editText.value.trim()
	if (!text && !props.msg.attachment) return
	if (text === props.msg.body.trim()) {
		emit('cancel')
		return
	}
	emit('save', props.msg, text)
}

function anchorOf(event: Event): Anchor {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

function openMenu(event: MouseEvent): void {
	pickerAnchor.value = null
	menuAnchor.value = menuAnchor.value ? null : anchorOf(event)
}

function openContext(event: MouseEvent): void {
	if (props.editing || system.value || props.selectMode) return
	const selection = window.getSelection()?.toString()
	if (selection) return
	event.preventDefault()
	pickerAnchor.value = null
	menuAnchor.value = { x: event.clientX, y: event.clientY }
}

function openPicker(event: MouseEvent): void {
	menuAnchor.value = null
	pickerAnchor.value = pickerAnchor.value ? null : anchorOf(event)
}

function closeAll(): void {
	menuAnchor.value = null
	pickerAnchor.value = null
}

/** Режим мультивыбора: первый же клик по сообщению выбирает его, внутренние клики глушатся. */
function onCaptureClick(event: MouseEvent): void {
	if (!props.selectMode) return
	event.stopPropagation()
	event.preventDefault()
	emit('toggleSelect', props.msg)
}

function startSelect(): void {
	closeAll()
	emit('select', props.msg)
}

function react(emoji: string): void {
	closeAll()
	void reactMessage(props.msg, emoji)
}

async function copy(text: string, done: string): Promise<void> {
	closeAll()
	try {
		await navigator.clipboard.writeText(text)
		showToast(done)
	} catch {
		showToast(t('app.messenger.copyFailed', 'Не удалось скопировать'))
	}
}

function messageLink(): string {
	const channel = props.msg.channelId ? `/${props.msg.channelId}` : ''
	return `undefined://messenger/${props.msg.conversationId}${channel}/${props.msg.id}`
}

async function togglePin(): Promise<void> {
	closeAll()
	const ok = await pinMessage(props.msg, !props.msg.pinned)
	if (ok) {
		showToast(
			props.msg.pinned
				? t('app.messenger.pin.removed', 'Сообщение откреплено')
				: t('app.messenger.pin.added', 'Сообщение закреплено'),
		)
	}
}

async function remove(): Promise<void> {
	closeAll()
	const choices = [
		{
			id: 'me',
			label: t('app.messenger.delete.forMe', 'Удалить у меня'),
			danger: !canDelete.value,
		},
	]
	if (canDelete.value) {
		choices.push({
			id: 'all',
			label: t('app.messenger.delete.forAll', 'Удалить у всех'),
			danger: true,
		})
	}
	const choice = await askChoice({
		title: t('app.messenger.delete.title', 'Удалить сообщение'),
		text: canDelete.value
			? t(
					'app.messenger.delete.textBoth',
					'«У меня» — сообщение пропадёт только в этом лаунчере. «У всех» — его больше никто не увидит.',
				)
			: t('app.messenger.delete.textMe', 'Сообщение пропадёт только у вас, собеседник его увидит.'),
		choices,
	})
	if (choice === 'me') hideMessageForMe(props.msg)
	else if (choice === 'all') await deleteMessage(props.msg)
}

async function saveSticker(): Promise<void> {
	closeAll()
	const url = playerSticker.value?.url
	if (!url) return
	const result = await saveStickerFromUrl(url)
	showToast(
		result === 'ok'
			? t('app.messenger.stickers.saved', 'Стикер добавлен в «Мои стикеры»')
			: result === 'full'
				? t('app.messenger.stickers.full', 'Своих стикеров уже 60 — удалите лишние')
				: t('app.messenger.stickers.saveFailed', 'Не удалось сохранить стикер'),
	)
}

async function report(): Promise<void> {
	closeAll()
	const reason = await askPrompt({
		title: t('app.messenger.report.title', 'Пожаловаться на сообщение'),
		text: t('app.messenger.report.text', 'Опишите, что не так. Жалобу увидит модерация.'),
		placeholder: t('app.messenger.report.placeholder', 'Спам, оскорбления, мошенничество…'),
		confirm: t('app.messenger.report.send', 'Отправить жалобу'),
		input: true,
		multiline: true,
		danger: true,
	})
	if (reason === null) return
	const ok = await reportMessage(props.msg, reason.trim() || 'other')
	if (ok) showToast(t('app.messenger.report.sent', 'Жалоба отправлена'))
}

function startEdit(): void {
	closeAll()
	emit('edit', props.msg)
}

function startReply(): void {
	closeAll()
	emit('reply', props.msg)
}

function forward(): void {
	closeAll()
	openForward(props.msg)
}

function showAuthor(): void {
	closeAll()
	openProfile(props.msg.senderId, author.value)
}

function mention(name: string, el: HTMLElement): void {
	const lower = name.toLowerCase()
	const hit = Object.values(state.users).find((user) => user.username.toLowerCase() === lower)
	if (hit) openPopover(hit.id, hit.username, el)
}
</script>

<template>
	<div v-if="system" class="msgr-msg msgr-msg--system" :data-msg-id="msg.id">
		<span class="msgr-msg__system-line" />
		<MessageText :text="msg.body" />
		<time class="msgr-msg__system-time">{{ formatTime(msg.createdAt) }}</time>
	</div>
	<div
		v-else
		class="msgr-msg"
		:class="{
			'is-grouped': grouped,
			'is-editing': editing,
			'is-highlight': highlight,
			'is-menu': menuAnchor || pickerAnchor,
			'is-pending': msg.pending,
			'is-selectable': selectMode,
			'is-selected': selected,
			'is-mention': msg.body
				.toLowerCase()
				.includes(`@${String(state.session?.user?.username || '~').toLowerCase()}`),
		}"
		:data-msg-id="msg.id"
		@contextmenu="openContext"
		@click.capture="onCaptureClick"
	>
		<div v-if="msg.replyTo" class="msgr-msg__reply" @click="emit('jump', msg.replyTo.id)">
			<span class="msgr-msg__reply-spine" />
			<UserAvatar :user-id="msg.replyTo.senderId" :name="msg.replyTo.senderName" :size="16" />
			<b>{{ displayName(msg.replyTo.senderId, msg.replyTo.senderName) }}</b>
			<span class="msgr-msg__reply-body">{{
				stripXferMarker(msg.replyTo.body) || t('app.messenger.attachment', 'Вложение')
			}}</span>
		</div>
		<div class="msgr-msg__row">
			<div class="msgr-msg__gutter">
				<button
					v-if="!grouped || msg.replyTo"
					type="button"
					class="msgr-msg__avatar"
					:aria-label="author"
					@click.stop="openProfile(msg.senderId, author)"
				>
					<UserAvatar :user-id="msg.senderId" :name="author" :size="40" />
				</button>
				<time v-else class="msgr-msg__hover-time" :title="formatDate(msg.createdAt)">{{
					formatTime(msg.createdAt)
				}}</time>
			</div>
			<div class="msgr-msg__content">
				<div v-if="!grouped || msg.replyTo" class="msgr-msg__head">
					<button
						type="button"
						class="msgr-msg__author"
						:style="roleColor ? { color: roleColor } : undefined"
						@click.stop="openProfile(msg.senderId, author)"
					>
						{{ author }}
					</button>
					<span v-if="isBot" class="msgr-msg__tag">BOT</span>
					<time class="msgr-msg__time" :title="new Date(msg.createdAt).toLocaleString()">
						{{ formatDate(msg.createdAt) }} {{ formatTime(msg.createdAt) }}
					</time>
					<PinIcon v-if="msg.pinned" class="msgr-msg__pinned" />
				</div>
				<div v-if="editing" class="msgr-msg__edit">
					<textarea
						ref="editBox"
						v-model="editText"
						rows="1"
						maxlength="4000"
						@input="grow"
						@keydown="onEditKey"
					/>
					<div class="msgr-msg__edit-hint">
						{{ t('app.messenger.edit.hintEsc', 'Escape —') }}
						<button type="button" @click="emit('cancel')">
							{{ t('app.messenger.edit.cancel', 'отмена') }}
						</button>
						• {{ t('app.messenger.edit.hintEnter', 'Enter —') }}
						<button type="button" @click="saveEdit">
							{{ t('app.messenger.edit.save', 'сохранить') }}
						</button>
					</div>
				</div>
				<div v-else-if="serverSticker" class="msgr-msg__sticker">
					<StickerView :url="serverSticker.url" :kind="serverSticker.kind" :size="224" />
				</div>
				<button
					v-else-if="playerSticker"
					type="button"
					class="msgr-msg__sticker"
					@click="openLightbox(playerSticker.url, playerSticker.name)"
				>
					<img :src="playerSticker.url" alt="" draggable="false" />
				</button>
				<div v-else-if="userCard || groupCard" class="msgr-msg__card">
					<ProfileCard :id="(userCard || groupCard)!" :kind="userCard ? 'user' : 'group'" />
				</div>
				<div v-else-if="forwarded" class="msgr-msg__forward">
					<span class="msgr-msg__forward-head">
						<ShareIcon />
						{{ t('app.messenger.forward.from', 'Переслано от') }}
						<b>{{ forwarded.author }}</b>
					</span>
					<MessageText v-if="forwarded.text" :text="forwarded.text" @mention="mention" />
				</div>
				<div v-else-if="displayBody" class="msgr-msg__body" :class="{ 'is-emoji': bigEmoji }">
					<MessageText :text="displayBody" @mention="mention" />
					<span
						v-if="msg.editedAt"
						class="msgr-msg__edited"
						:title="new Date(msg.editedAt).toLocaleString()"
					>
						{{ t('app.messenger.edited', '(изменено)') }}
					</span>
				</div>
				<div v-else-if="!msg.attachment && !forwarded" class="msgr-msg__empty">
					{{ t('app.messenger.message.empty', 'Пустое сообщение') }}
				</div>

				<MessageAttachment
					v-if="msg.attachment && !isSticker"
					:attachment="msg.attachment"
					:xfer-id="xferId"
					:xfer-sender="msg.senderId"
				/>

				<TransitionGroup
					v-if="msg.reactions.length"
					tag="div"
					name="msgr-reaction"
					class="msgr-msg__reactions"
				>
					<button
						v-for="reaction in msg.reactions"
						:key="reaction.emoji"
						type="button"
						class="msgr-msg__reaction"
						:class="{ 'is-mine': reaction.me }"
						:title="reactionNames(reaction.emoji)"
						@click="react(reaction.emoji)"
					>
						<span>{{ reaction.emoji }}</span>
						<b :key="reaction.count" class="msgr-msg__reaction-count">{{ reaction.count }}</b>
					</button>
					<button
						key="__add"
						type="button"
						class="msgr-msg__reaction msgr-msg__reaction--add"
						:title="t('app.messenger.react.add', 'Добавить реакцию')"
						@click.stop="openPicker"
					>
						<SmileIcon />
					</button>
				</TransitionGroup>
			</div>
		</div>

		<div v-if="!editing && !msg.pending && !selectMode" class="msgr-msg__toolbar" @pointerdown.stop>
			<button
				v-tip="t('app.messenger.react.heart', 'Нравится')"
				type="button"
				:class="{ 'is-on': liked }"
				@click.stop="react('❤️')"
			>
				<HeartIcon />
			</button>
			<button
				v-tip="t('app.messenger.react.add', 'Добавить реакцию')"
				type="button"
				@click.stop="openPicker"
			>
				<SmileIcon />
			</button>
			<button v-tip="t('app.messenger.reply', 'Ответить')" type="button" @click.stop="startReply">
				<ReplyIcon />
			</button>
			<button
				v-if="mine && msg.attachment?.kind !== 'voice' && !isSticker"
				v-tip="t('app.messenger.edit.action', 'Изменить')"
				type="button"
				@click.stop="startEdit"
			>
				<EditIcon />
			</button>
			<button
				v-if="canPin"
				v-tip="
					msg.pinned
						? t('app.messenger.pin.unpin', 'Открепить')
						: t('app.messenger.pin.pin', 'Закрепить')
				"
				type="button"
				:class="{ 'is-on': msg.pinned }"
				@click.stop="togglePin"
			>
				<PinIcon />
			</button>
			<button
				v-tip="t('app.messenger.forward.action', 'Переслать')"
				type="button"
				@click.stop="forward"
			>
				<SendIcon />
			</button>
			<button
				v-tip="t('app.messenger.more', 'Ещё')"
				type="button"
				:class="{ 'is-on': menuAnchor }"
				@click.stop="openMenu"
			>
				<MoreHorizontalIcon />
			</button>
		</div>

		<FloatingMenu
			:anchor="pickerAnchor"
			placement="bottom-end"
			:width="248"
			@close="pickerAnchor = null"
		>
			<div class="msgr-menu-reactions msgr-menu-reactions--grid">
				<button v-for="emoji in REACTIONS" :key="emoji" type="button" @click="react(emoji)">
					{{ emoji }}
				</button>
			</div>
		</FloatingMenu>

		<FloatingMenu
			:anchor="menuAnchor"
			placement="bottom-end"
			:width="232"
			@close="menuAnchor = null"
		>
			<div class="msgr-menu-reactions">
				<button
					v-for="emoji in QUICK_REACTIONS.slice(0, 5)"
					:key="emoji"
					type="button"
					@click="react(emoji)"
				>
					{{ emoji }}
				</button>
			</div>
			<button type="button" class="msgr-menu-item" @click="openPicker($event)">
				<SmileIcon /> {{ t('app.messenger.react.add', 'Добавить реакцию') }}
			</button>
			<div class="msgr-menu-sep" />
			<button v-if="mine && !isSticker" type="button" class="msgr-menu-item" @click="startEdit">
				<EditIcon /> {{ t('app.messenger.edit.action', 'Изменить') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="startReply">
				<ReplyIcon /> {{ t('app.messenger.reply', 'Ответить') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="startSelect">
				<CheckIcon /> {{ t('app.messenger.select.action', 'Выбрать') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="forward">
				<SendIcon /> {{ t('app.messenger.forward.action', 'Переслать') }}
			</button>
			<button v-if="canPin" type="button" class="msgr-menu-item" @click="togglePin">
				<PinIcon />
				{{
					msg.pinned
						? t('app.messenger.pin.unpin', 'Открепить')
						: t('app.messenger.pin.pin', 'Закрепить')
				}}
			</button>
			<button v-if="playerSticker" type="button" class="msgr-menu-item" @click="saveSticker">
				<SaveIcon /> {{ t('app.messenger.stickers.save', 'Сохранить стикер') }}
			</button>
			<div class="msgr-menu-sep" />
			<button
				v-if="msg.body && !isSticker"
				type="button"
				class="msgr-menu-item"
				@click="copy(displayBody, t('app.messenger.copied.text', 'Текст скопирован'))"
			>
				<CopyIcon /> {{ t('app.messenger.copy.text', 'Копировать текст') }}
			</button>
			<button
				type="button"
				class="msgr-menu-item"
				@click="copy(messageLink(), t('app.messenger.copied.link', 'Ссылка скопирована'))"
			>
				<LinkIcon /> {{ t('app.messenger.copy.link', 'Копировать ссылку') }}
			</button>
			<button
				type="button"
				class="msgr-menu-item"
				@click="copy(msg.id, t('app.messenger.copied.id', 'ID скопирован'))"
			>
				<HashIcon /> {{ t('app.messenger.copy.id', 'Копировать ID сообщения') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="showAuthor">
				<UserIcon /> {{ t('app.messenger.viewProfile', 'Открыть полный профиль') }}
			</button>
			<div class="msgr-menu-sep" />
			<button v-if="!mine" type="button" class="msgr-menu-item is-danger" @click="report">
				<ReportIcon /> {{ t('app.messenger.report.action', 'Пожаловаться') }}
			</button>
			<button type="button" class="msgr-menu-item is-danger" @click="remove">
				<TrashIcon /> {{ t('app.messenger.delete.action', 'Удалить сообщение') }}
			</button>
		</FloatingMenu>
	</div>
</template>

<style scoped>
.msgr-msg.is-pending .msgr-msg__content {
	opacity: 0.55;
}

.msgr-msg.is-selectable {
	cursor: pointer;
}

.msgr-msg.is-selectable:hover {
	background: rgba(255, 255, 255, 0.03);
}

.msgr-msg.is-selected {
	background: color-mix(in srgb, var(--color-brand) 16%, transparent);
	box-shadow: inset 2px 0 0 var(--color-brand);
}

.msgr-msg__empty {
	font-size: 0.85rem;
	font-style: italic;
	opacity: 0.55;
}

.msgr-msg__sticker {
	display: inline-grid;
	width: 14rem;
	height: 14rem;
	place-items: center;
	padding: 0;
	margin-top: 0.15rem;
	border: 0;
	background: none;
	cursor: pointer;
}

.msgr-msg__sticker img {
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
	transition: transform 0.18s ease;
}

.msgr-msg__sticker:hover img {
	transform: scale(1.04);
}

.msgr-msg__forward {
	display: flex;
	max-width: 42rem;
	flex-direction: column;
	gap: 0.2rem;
	padding: 0.35rem 0.7rem;
	margin-top: 0.1rem;
	border-left: 3px solid color-mix(in srgb, var(--color-brand) 70%, transparent);
	border-radius: 0 8px 8px 0;
	background: rgba(255, 255, 255, 0.035);
	overflow-wrap: anywhere;
}

.msgr-msg__forward-head {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	color: var(--color-secondary);
	font-size: 0.76rem;
}

.msgr-msg__forward-head svg {
	width: 0.85rem;
	height: 0.85rem;
	flex-shrink: 0;
}

.msgr-msg__forward-head b {
	overflow: hidden;
	color: var(--color-contrast);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-msg {
	position: relative;
	padding: 0.15rem 1rem 0.15rem 0;
	margin-top: 1rem;
	transition: background 0.12s ease;
	animation: msgr-msg-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.msgr-msg.is-grouped {
	margin-top: 0;
}

.msgr-msg:hover,
.msgr-msg.is-menu,
.msgr-msg.is-editing {
	background: rgba(255, 255, 255, 0.035);
}

.msgr-msg.is-mention {
	background: rgba(240, 178, 50, 0.07);
	box-shadow: inset 2px 0 0 #f0b232;
}

.msgr-msg.is-highlight {
	animation: msgr-msg-flash 1.6s ease-out;
}

.msgr-msg__row {
	display: flex;
	gap: 0;
}

.msgr-msg__gutter {
	display: flex;
	width: 4.5rem;
	flex-shrink: 0;
	justify-content: center;
	padding-top: 0.1rem;
}

.msgr-msg__avatar {
	height: 40px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: none;
	cursor: pointer;
	transition: transform 0.12s ease;
}

.msgr-msg__avatar:hover {
	transform: translateY(-1px);
}

.msgr-msg__avatar:active {
	transform: translateY(1px);
}

.msgr-msg__hover-time {
	padding-top: 0.2rem;
	font-size: 0.66rem;
	opacity: 0;
	color: var(--color-secondary);
	font-variant-numeric: tabular-nums;
}

.msgr-msg:hover .msgr-msg__hover-time {
	opacity: 0.8;
}

.msgr-msg__content {
	min-width: 0;
	flex: 1;
}

.msgr-msg__head {
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
	line-height: 1.35;
}

.msgr-msg__author {
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.95rem;
	font-weight: 700;
	cursor: pointer;
}

.msgr-msg__author:hover {
	text-decoration: underline;
}

.msgr-msg__tag {
	padding: 0 0.3rem;
	border-radius: 4px;
	background: var(--color-brand);
	color: white;
	font-size: 0.6rem;
	font-weight: 800;
	line-height: 1.4;
}

.msgr-msg__time {
	color: var(--color-secondary);
	font-size: 0.72rem;
}

.msgr-msg__pinned {
	width: 0.8rem;
	height: 0.8rem;
	color: #f0b232;
}

.msgr-msg__body {
	color: var(--color-base);
	font-size: 0.95rem;
	line-height: 1.4;
}

.msgr-msg__body.is-emoji {
	font-size: 2.6rem;
	line-height: 1.15;
}

.msgr-msg__edited {
	margin-left: 0.25rem;
	color: var(--color-secondary);
	font-size: 0.68rem;
	user-select: none;
}

.msgr-msg__reply {
	position: relative;
	display: flex;
	align-items: center;
	gap: 0.35rem;
	min-width: 0;
	padding-left: 4.5rem;
	margin-bottom: 0.15rem;
	color: var(--color-secondary);
	font-size: 0.8rem;
	cursor: pointer;
}

.msgr-msg__reply-spine {
	position: absolute;
	left: 2.15rem;
	top: 50%;
	width: 2rem;
	height: 0.6rem;
	border-left: 2px solid rgba(255, 255, 255, 0.18);
	border-top: 2px solid rgba(255, 255, 255, 0.18);
	border-top-left-radius: 6px;
}

.msgr-msg__reply b {
	color: var(--color-contrast);
	font-weight: 600;
	white-space: nowrap;
}

.msgr-msg__reply-body {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-msg__reply:hover .msgr-msg__reply-body {
	color: var(--color-contrast);
}

.msgr-msg__reactions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
	margin-top: 0.3rem;
}

.msgr-msg__reaction {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.1rem 0.45rem;
	border: 1px solid transparent;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.06);
	color: var(--color-base);
	font: inherit;
	font-size: 0.85rem;
	cursor: pointer;
	animation: msgr-pop 0.34s cubic-bezier(0.3, 1.5, 0.5, 1);
	transition:
		background 0.15s ease,
		border-color 0.15s ease,
		transform 0.15s ease;
}

.msgr-msg__reaction:active {
	transform: scale(0.9);
}

.msgr-msg__reaction-count {
	display: inline-block;
	animation: msgr-count 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.msgr-reaction-leave-active {
	position: absolute;
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.msgr-reaction-leave-to {
	opacity: 0;
	transform: scale(0.5);
}

.msgr-reaction-move {
	transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.msgr-msg__reaction b {
	font-size: 0.75rem;
	font-weight: 700;
}

.msgr-msg__reaction:hover {
	border-color: rgba(255, 255, 255, 0.18);
}

.msgr-msg__reaction.is-mine {
	border-color: color-mix(in srgb, var(--color-brand) 70%, transparent);
	background: color-mix(in srgb, var(--color-brand) 22%, transparent);
	color: white;
}

.msgr-msg__reaction--add {
	opacity: 0;
	transition: opacity 0.12s ease;
}

.msgr-msg:hover .msgr-msg__reaction--add {
	opacity: 1;
}

.msgr-msg__reaction--add svg {
	width: 1rem;
	height: 1rem;
}

.msgr-msg__toolbar {
	position: absolute;
	top: -1rem;
	right: 1rem;
	z-index: 3;
	display: flex;
	padding: 2px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 8px;
	background: var(--msgr-btn2);
	box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
	opacity: 0;
	pointer-events: none;
	transform: translateY(4px) scale(0.96);
	transform-origin: right bottom;
	transition:
		opacity 0.14s ease,
		transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1.2);
}

.msgr-msg:hover .msgr-msg__toolbar,
.msgr-msg.is-menu .msgr-msg__toolbar {
	opacity: 1;
	pointer-events: auto;
	transform: none;
}

.msgr-msg__toolbar button {
	display: grid;
	width: 2rem;
	height: 2rem;
	place-items: center;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
	transition:
		background 0.1s ease,
		color 0.1s ease;
}

.msgr-msg__toolbar button:hover {
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-contrast);
}

.msgr-msg__toolbar button.is-on {
	color: var(--color-brand);
}

.msgr-msg__toolbar svg {
	width: 1.1rem;
	height: 1.1rem;
}

.msgr-msg__edit textarea {
	width: 100%;
	min-height: 2.6rem;
	padding: 0.6rem 0.8rem;
	border: 1px solid color-mix(in srgb, var(--color-brand) 50%, transparent);
	border-radius: 8px;
	background: var(--msgr-btn2);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.95rem;
	line-height: 1.4;
	resize: none;
	outline: none;
}

.msgr-msg__edit-hint {
	margin-top: 0.2rem;
	color: var(--color-secondary);
	font-size: 0.72rem;
}

.msgr-msg__edit-hint button {
	padding: 0;
	border: 0;
	background: none;
	color: #7cc4ff;
	font: inherit;
	cursor: pointer;
}

.msgr-msg__edit-hint button:hover {
	text-decoration: underline;
}

.msgr-msg--system {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.35rem 1rem 0.35rem 1.5rem;
	margin-top: 0.6rem;
	color: var(--color-secondary);
	font-size: 0.85rem;
}

.msgr-msg__system-line {
	width: 1.2rem;
	height: 2px;
	border-radius: 2px;
	background: color-mix(in srgb, var(--color-brand) 60%, transparent);
}

.msgr-msg__system-time {
	margin-left: auto;
	font-size: 0.7rem;
	opacity: 0.7;
}

@keyframes msgr-msg-in {
	from {
		opacity: 0;
		transform: translateY(8px) scale(0.99);
	}
}

@keyframes msgr-count {
	from {
		opacity: 0;
		transform: translateY(-60%);
	}
}

@keyframes msgr-msg-flash {
	0%,
	30% {
		background: color-mix(in srgb, var(--color-brand) 22%, transparent);
	}
}

@keyframes msgr-pop {
	from {
		opacity: 0;
		transform: scale(0.4);
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-msg,
	.msgr-msg__reaction,
	.msgr-msg__reaction-count,
	.msgr-msg.is-highlight {
		animation: none;
	}

	.msgr-msg__toolbar,
	.msgr-msg__avatar {
		transition: none;
	}
}
</style>
