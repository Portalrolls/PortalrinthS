<script setup lang="ts">
import { ArrowUpIcon, ImageIcon, XIcon } from '@modrinth/assets'
import { computed, nextTick, ref } from 'vue'

import { compressImageFile, serviceRequest } from '@/helpers/uprojects-service'

import { type AvatarSource, type FeedPost, type FeedUser, useNewsText, userAvatar } from './feed'
import NewsAvatar from './NewsAvatar.vue'

const MAX_IMAGES = 6

const props = defineProps<{
	avatar: AvatarSource
	postingBanned: boolean
}>()

const emit = defineEmits<{
	posted: [post: FeedPost | null]
	banned: []
	failed: [message: string]
}>()

const { t } = useNewsText()

const text = ref('')
const images = ref<string[]>([])
const focused = ref(false)
const publishing = ref(false)
const attaching = ref(false)
const notice = ref('')
const input = ref<HTMLTextAreaElement | null>(null)
const files = ref<HTMLInputElement | null>(null)
const mentions = ref<FeedUser[]>([])
const mentionIndex = ref(0)
let mentionTimer: ReturnType<typeof setTimeout> | undefined
let mentionToken = 0

const open = computed(() => focused.value || Boolean(text.value) || images.value.length > 0)
const canPublish = computed(
	() =>
		!publishing.value &&
		!attaching.value &&
		(Boolean(text.value.trim()) || images.value.length > 0),
)

function resize() {
	const el = input.value
	if (!el) return
	el.style.height = 'auto'
	el.style.height = `${Math.min(el.scrollHeight, 260)}px`
}

async function attach(event: Event) {
	const target = event.target as HTMLInputElement
	const list = Array.from(target.files || [])
	target.value = ''
	const room = MAX_IMAGES - images.value.length
	if (list.length > room) {
		notice.value = t('app.news.imagesLimit', 'Можно прикрепить не больше {n} фото', {
			n: MAX_IMAGES,
		})
	} else {
		notice.value = ''
	}
	attaching.value = true
	for (const file of list.slice(0, Math.max(0, room))) {
		try {
			images.value.push(await compressImageFile(file))
		} catch {
			notice.value = t('app.news.imageBroken', 'Не получилось прочитать «{name}»', {
				name: file.name,
			})
		}
	}
	attaching.value = false
}

function removeImage(index: number) {
	images.value.splice(index, 1)
	if (!images.value.length && !text.value) notice.value = ''
}

async function publish() {
	if (!canPublish.value || props.postingBanned) return
	publishing.value = true
	notice.value = ''
	const response = await serviceRequest('/social/posts', {
		method: 'POST',
		body: { bodyMd: text.value.trim(), images: images.value.slice(0, MAX_IMAGES) },
	})
	publishing.value = false
	if (!response.ok) {
		if (response.code === 'posting_banned') emit('banned')
		else {
			notice.value = response.error || t('app.news.publishFailed', 'Не удалось опубликовать')
			emit('failed', notice.value)
		}
		return
	}
	text.value = ''
	images.value = []
	focused.value = false
	mentions.value = []
	await nextTick()
	resize()
	input.value?.blur()
	emit('posted', (response.data?.post as FeedPost | undefined) ?? null)
}

function mentionQuery(): string | null {
	const el = input.value
	if (!el) return null
	const before = text.value.slice(0, el.selectionStart ?? text.value.length)
	const match = before.match(/(?:^|\s)@([A-Za-z0-9_]{2,32})$/)
	return match ? match[1] : null
}

function onInput() {
	resize()
	clearTimeout(mentionTimer)
	const query = mentionQuery()
	if (!query) {
		mentions.value = []
		return
	}
	const token = ++mentionToken
	mentionTimer = setTimeout(async () => {
		const response = await serviceRequest('/users/search', { query: { q: query, limit: 8 } })
		if (token !== mentionToken) return
		mentions.value = response.ok && Array.isArray(response.data?.users) ? response.data.users : []
		mentionIndex.value = 0
	}, 180)
}

function pickMention(user: FeedUser) {
	const el = input.value
	if (!el) return
	const cursor = el.selectionStart ?? text.value.length
	const before = text.value.slice(0, cursor).replace(/@([A-Za-z0-9_]*)$/, `@${user.username} `)
	text.value = before + text.value.slice(cursor)
	mentions.value = []
	void nextTick(() => {
		el.focus()
		el.setSelectionRange(before.length, before.length)
		resize()
	})
}

function onKey(event: KeyboardEvent) {
	if (mentions.value.length) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			const step = event.key === 'ArrowDown' ? 1 : -1
			mentionIndex.value =
				(mentionIndex.value + step + mentions.value.length) % mentions.value.length
			return
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault()
			pickMention(mentions.value[mentionIndex.value])
			return
		}
		if (event.key === 'Escape') {
			mentions.value = []
			return
		}
	}
	if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
		event.preventDefault()
		void publish()
	}
}

function onBlur() {
	focused.value = false
	setTimeout(() => (mentions.value = []), 150)
}

function focus() {
	input.value?.focus()
}

defineExpose({ focus })
</script>

<template>
	<div v-if="postingBanned" class="nf-composer is-banned">
		<p>
			{{ t('app.news.postingBanned', 'Публикация постов и комментариев для тебя ограничена.') }}
		</p>
	</div>
	<div v-else class="nf-composer" :class="{ 'is-open': open }">
		<div class="nf-composer__row">
			<NewsAvatar :source="avatar" :size="34" />
			<div class="nf-composer__field">
				<textarea
					ref="input"
					v-model="text"
					rows="1"
					maxlength="5000"
					:placeholder="t('app.news.composerPlaceholder', 'Что нового у вас?')"
					@focus="focused = true"
					@blur="onBlur"
					@input="onInput"
					@click="onInput"
					@keydown="onKey"
				/>
				<Transition name="nf-pop">
					<div v-if="mentions.length" class="nf-composer__mentions" role="listbox">
						<button
							v-for="(user, index) in mentions"
							:key="user.id"
							type="button"
							role="option"
							:aria-selected="index === mentionIndex"
							:class="{ 'is-active': index === mentionIndex }"
							@mousedown.prevent="pickMention(user)"
						>
							<NewsAvatar :source="userAvatar(user)" :size="22" />
							{{ user.username }}
						</button>
					</div>
				</Transition>
			</div>
			<button
				type="button"
				class="nf-composer__icon"
				:disabled="images.length >= MAX_IMAGES || attaching"
				:title="t('app.news.attachImages', 'Прикрепить фото (до {n})', { n: MAX_IMAGES })"
				:aria-label="t('app.news.attachImages', 'Прикрепить фото (до {n})', { n: MAX_IMAGES })"
				@click="files?.click()"
			>
				<ImageIcon />
			</button>
			<button
				type="button"
				class="nf-composer__send"
				:disabled="!canPublish"
				:aria-label="t('app.news.publish', 'Опубликовать')"
				:title="t('app.news.publishHint', 'Опубликовать (Ctrl+Enter)')"
				@click="publish"
			>
				<ArrowUpIcon />
			</button>
			<input ref="files" type="file" accept="image/*" multiple hidden @change="attach" />
		</div>
		<TransitionGroup
			v-if="images.length || attaching"
			tag="div"
			name="nf-thumb"
			class="nf-composer__thumbs"
		>
			<div
				v-for="(image, index) in images"
				:key="image.slice(-48) + index"
				class="nf-composer__thumb"
			>
				<img :src="image" alt="" />
				<button
					type="button"
					:aria-label="t('app.news.removeImage', 'Убрать фото')"
					@click="removeImage(index)"
				>
					<XIcon />
				</button>
			</div>
			<div v-if="attaching" key="loading" class="nf-composer__thumb is-loading" />
		</TransitionGroup>
		<p v-if="notice" class="nf-composer__notice">{{ notice }}</p>
	</div>
</template>

<style scoped>
.nf-composer {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 10px 12px;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 14px;
	background: #1d1d21;
	transition:
		border-color 0.2s ease,
		box-shadow 0.2s ease;
}

.nf-composer.is-open {
	border-color: color-mix(in srgb, var(--color-brand) 35%, transparent);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand) 8%, transparent);
}

.nf-composer.is-banned p {
	margin: 0;
	color: var(--color-red);
	font-size: 13px;
	font-weight: 600;
}

.nf-composer__row {
	display: flex;
	align-items: flex-end;
	gap: 10px;
}

.nf-composer__field {
	position: relative;
	flex: 1;
	min-width: 0;
	align-self: center;
}

.nf-composer__field textarea {
	display: block;
	width: 100%;
	min-height: 22px;
	max-height: 260px;
	padding: 6px 0;
	border: 0;
	outline: none;
	resize: none;
	background: transparent;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 14.5px;
	line-height: 21px;
	box-shadow: none;
}

.nf-composer__field textarea::placeholder {
	color: rgba(255, 255, 255, 0.4);
}

.nf-composer__mentions {
	position: absolute;
	top: calc(100% + 6px);
	left: 0;
	z-index: 20;
	display: flex;
	flex-direction: column;
	min-width: 200px;
	padding: 4px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 11px;
	background: #232328;
	box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
}

.nf-composer__mentions button {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 13px;
	text-align: left;
	cursor: pointer;
}

.nf-composer__mentions button.is-active,
.nf-composer__mentions button:hover {
	background: color-mix(in srgb, var(--color-brand) 16%, transparent);
}

.nf-composer__icon,
.nf-composer__send {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 34px;
	height: 34px;
	border: 0;
	border-radius: 10px;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease,
		opacity 0.15s ease,
		transform 0.15s ease;
}

.nf-composer__icon {
	background: transparent;
	color: rgba(255, 255, 255, 0.6);
}

.nf-composer__icon:not(:disabled):hover {
	background: rgba(255, 255, 255, 0.07);
	color: #fff;
}

.nf-composer__send {
	background: var(--color-brand);
	color: #fff;
}

.nf-composer__icon:disabled,
.nf-composer__send:disabled {
	cursor: default;
	opacity: 0.4;
}

.nf-composer__icon:not(:disabled):active,
.nf-composer__send:not(:disabled):active {
	transform: scale(0.92);
}

.nf-composer__icon svg,
.nf-composer__send svg {
	width: 18px;
	height: 18px;
}

.nf-composer__thumbs {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding-left: 44px;
}

.nf-composer__thumb {
	position: relative;
	width: 76px;
	height: 76px;
	overflow: hidden;
	border-radius: 10px;
	background: #141417;
}

.nf-composer__thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.nf-composer__thumb button {
	position: absolute;
	top: 4px;
	right: 4px;
	display: grid;
	place-items: center;
	width: 20px;
	height: 20px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: rgba(0, 0, 0, 0.7);
	color: #fff;
	cursor: pointer;
}

.nf-composer__thumb button svg {
	width: 12px;
	height: 12px;
}

.nf-composer__thumb.is-loading {
	background: linear-gradient(90deg, #26262b 0%, #303036 50%, #26262b 100%);
	background-size: 200% 100%;
	animation: nf-shimmer 1.2s linear infinite;
}

.nf-composer__notice {
	margin: 0;
	padding-left: 44px;
	color: var(--color-orange);
	font-size: 12px;
}

.nf-thumb-enter-active,
.nf-thumb-leave-active,
.nf-pop-enter-active,
.nf-pop-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.nf-thumb-enter-from,
.nf-thumb-leave-to {
	opacity: 0;
	transform: scale(0.85);
}

.nf-pop-enter-from,
.nf-pop-leave-to {
	opacity: 0;
	transform: translateY(-4px);
}

@keyframes nf-shimmer {
	from {
		background-position: 200% 0;
	}
	to {
		background-position: -200% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.nf-composer,
	.nf-composer__icon,
	.nf-composer__send,
	.nf-thumb-enter-active,
	.nf-thumb-leave-active,
	.nf-pop-enter-active,
	.nf-pop-leave-active {
		transition: none;
	}

	.nf-composer__thumb.is-loading {
		animation: none;
	}
}
</style>
