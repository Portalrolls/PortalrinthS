<script setup lang="ts">
import { CheckIcon, MessagesSquareIcon, RepeatIcon, SearchIcon } from '@modrinth/assets'
import { Button, NewModal } from '@modrinth/ui'
import { computed, ref } from 'vue'

import { type LooseRecord, serviceRequest } from '@/helpers/uprojects-service'

import { authorOf, type FeedPost, useNewsText, userAvatar } from './feed'
import NewsAvatar from './NewsAvatar.vue'

type Chat = { id: string; title: string; avatar: ReturnType<typeof userAvatar>; group: boolean }

const emit = defineEmits<{
	done: [message: string, wall: boolean]
	failed: [message: string]
	banned: []
}>()

const { t } = useNewsText()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const post = ref<FeedPost | null>(null)
const tab = ref<'wall' | 'chats'>('wall')
const comment = ref('')
const chats = ref<Chat[]>([])
const chatsLoading = ref(false)
const chatsError = ref('')
const picked = ref<string[]>([])
const query = ref('')
const sending = ref(false)

const source = computed(() => (post.value ? authorOf(post.value) : null))
const filtered = computed(() => {
	const needle = query.value.trim().toLowerCase()
	return needle
		? chats.value.filter((chat) => chat.title.toLowerCase().includes(needle))
		: chats.value
})

function toChat(row: LooseRecord): Chat | null {
	if (!row?.id) return null
	const peer = row.peer as LooseRecord | undefined
	const group = String(row.type || row.kind || '') === 'group' || Boolean(row.isGroup)
	const title =
		String(row.title || row.name || peer?.username || peer?.name || '').trim() ||
		t('app.news.chatFallback', 'Чат')
	const icon = String(row.avatarUrl || row.iconUrl || row.avatar || '')
	return {
		id: String(row.id),
		title,
		group,
		avatar: icon && group ? { direct: icon } : userAvatar(peer ?? { username: title }),
	}
}

async function loadChats() {
	chatsLoading.value = true
	chatsError.value = ''
	const response = await serviceRequest('/conversations', { query: { limit: 100 } })
	chatsLoading.value = false
	if (!response.ok) {
		chatsError.value = response.error || t('app.news.chatsFailed', 'Не удалось загрузить чаты')
		return
	}
	const rows = Array.isArray(response.data?.conversations)
		? response.data.conversations
		: Array.isArray(response.data)
			? response.data
			: []
	chats.value = rows.map(toChat).filter((chat: Chat | null): chat is Chat => Boolean(chat))
}

function show(target: FeedPost) {
	post.value = target.repostOf && !target.bodyMd?.trim() ? target.repostOf : target
	tab.value = 'wall'
	comment.value = ''
	picked.value = []
	query.value = ''
	modal.value?.show()
	void loadChats()
}

function toggle(id: string) {
	picked.value = picked.value.includes(id)
		? picked.value.filter((entry) => entry !== id)
		: [...picked.value, id]
}

async function submit() {
	if (!post.value || sending.value) return
	sending.value = true
	const id = post.value.id
	const response =
		tab.value === 'wall'
			? await serviceRequest('/social/posts', {
					method: 'POST',
					body: { bodyMd: comment.value.trim(), repostOfId: id },
				})
			: await serviceRequest(`/social/posts/${encodeURIComponent(id)}/repost`, {
					method: 'POST',
					body: { conversationIds: picked.value },
				})
	sending.value = false
	if (!response.ok) {
		if (response.code === 'posting_banned') emit('banned')
		else emit('failed', response.error || t('app.news.repostFailed', 'Репост не удался'))
		return
	}
	const sent = Array.isArray(response.data?.sent) ? response.data.sent.length : picked.value.length
	emit(
		'done',
		tab.value === 'wall'
			? t('app.news.repostedWall', 'Пост появился у тебя на стене')
			: t('app.news.repostedChats', 'Отправлено в чаты: {n}', { n: sent }),
		tab.value === 'wall',
	)
	modal.value?.hide()
}

defineExpose({ show })
</script>

<template>
	<NewModal ref="modal" :header="t('app.news.repostTitle', 'Поделиться постом')" width="480px">
		<div class="nf-rp">
			<div class="nf-rp__tabs" role="tablist">
				<button
					type="button"
					role="tab"
					:aria-selected="tab === 'wall'"
					:class="{ 'is-active': tab === 'wall' }"
					@click="tab = 'wall'"
				>
					<RepeatIcon />
					{{ t('app.news.repostWall', 'На стену') }}
				</button>
				<button
					type="button"
					role="tab"
					:aria-selected="tab === 'chats'"
					:class="{ 'is-active': tab === 'chats' }"
					@click="tab = 'chats'"
				>
					<MessagesSquareIcon />
					{{ t('app.news.repostChats', 'В чат') }}
				</button>
				<span class="nf-rp__ink" :class="{ 'is-right': tab === 'chats' }" />
			</div>

			<div v-if="post && source" class="nf-rp__preview">
				<NewsAvatar :source="source.avatar" :size="22" />
				<b>{{ source.name }}</b>
				<span>{{ post.bodyMd || t('app.news.repostMedia', 'Пост с фото') }}</span>
			</div>

			<Transition name="nf-swap" mode="out-in">
				<div v-if="tab === 'wall'" key="wall" class="nf-rp__panel">
					<textarea
						v-model="comment"
						class="nf-rp__area"
						rows="3"
						maxlength="2000"
						:placeholder="t('app.news.repostComment', 'Добавь комментарий (необязательно)')"
					/>
				</div>
				<div v-else key="chats" class="nf-rp__panel">
					<label class="nf-rp__search">
						<SearchIcon />
						<input
							v-model="query"
							type="search"
							:placeholder="t('app.news.chatSearch', 'Найти чат')"
						/>
					</label>
					<div class="nf-rp__chats">
						<p v-if="chatsLoading" class="nf-rp__empty">
							{{ t('app.news.loading', 'Загрузка…') }}
						</p>
						<p v-else-if="chatsError" class="nf-rp__empty is-error">
							{{ chatsError }}
							<button type="button" class="nf-rp__link" @click="loadChats">
								{{ t('app.news.retry', 'Повторить') }}
							</button>
						</p>
						<p v-else-if="!filtered.length" class="nf-rp__empty">
							{{ t('app.news.noChats', 'Чатов не нашлось') }}
						</p>
						<button
							v-for="chat in filtered"
							v-else
							:key="chat.id"
							type="button"
							class="nf-rp__chat"
							:class="{ 'is-on': picked.includes(chat.id) }"
							:aria-pressed="picked.includes(chat.id)"
							@click="toggle(chat.id)"
						>
							<NewsAvatar :source="chat.avatar" :size="28" />
							<span class="nf-rp__chat-name">{{ chat.title }}</span>
							<span class="nf-rp__check"><CheckIcon /></span>
						</button>
					</div>
				</div>
			</Transition>
		</div>

		<template #actions>
			<div class="nf-rp__actions">
				<Button type="quiet" @click="modal?.hide()">
					{{ t('app.news.cancel', 'Отмена') }}
				</Button>
				<Button
					type="colored"
					color="brand"
					:disabled="sending || (tab === 'chats' && !picked.length)"
					@click="submit"
				>
					<RepeatIcon v-if="tab === 'wall'" />
					<MessagesSquareIcon v-else />
					{{
						tab === 'wall'
							? t('app.news.repostWallSubmit', 'Репостнуть')
							: picked.length
								? t('app.news.repostChatsSubmit', 'Отправить ({n})', { n: picked.length })
								: t('app.news.repostPick', 'Выбери чаты')
					}}
				</Button>
			</div>
		</template>
	</NewModal>
</template>

<style scoped>
.nf-rp {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.nf-rp__tabs {
	position: relative;
	display: grid;
	grid-template-columns: 1fr 1fr;
	padding: 3px;
	border-radius: 11px;
	background: #141417;
}

.nf-rp__tabs button {
	position: relative;
	z-index: 1;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 32px;
	border: 0;
	background: none;
	color: rgba(255, 255, 255, 0.55);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	transition: color 0.2s ease;
}

.nf-rp__tabs button svg {
	width: 15px;
	height: 15px;
}

.nf-rp__tabs button.is-active {
	color: #fff;
}

.nf-rp__ink {
	position: absolute;
	top: 3px;
	bottom: 3px;
	left: 3px;
	width: calc(50% - 3px);
	border-radius: 9px;
	background: #2a2a31;
	transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.nf-rp__ink.is-right {
	transform: translateX(100%);
}

.nf-rp__preview {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	padding: 8px 10px;
	border-left: 3px solid var(--color-brand);
	border-radius: 8px;
	background: #17171a;
	font-size: 13px;
}

.nf-rp__preview b {
	flex-shrink: 0;
	color: var(--color-contrast, #fff);
}

.nf-rp__preview span {
	overflow: hidden;
	color: rgba(255, 255, 255, 0.55);
	white-space: nowrap;
	text-overflow: ellipsis;
}

.nf-rp__panel {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.nf-rp__area {
	min-height: 84px;
	padding: 10px 12px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 10px;
	outline: none;
	resize: vertical;
	background: #141417;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 14px;
}

.nf-rp__area:focus {
	border-color: color-mix(in srgb, var(--color-brand) 50%, transparent);
}

.nf-rp__search {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 10px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 10px;
	background: #141417;
}

.nf-rp__search svg {
	width: 15px;
	height: 15px;
	color: rgba(255, 255, 255, 0.45);
}

.nf-rp__search input {
	flex: 1;
	height: 34px;
	padding: 0;
	border: 0;
	outline: none;
	background: transparent;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 13px;
	box-shadow: none;
}

.nf-rp__chats {
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-height: 280px;
	overflow-y: auto;
}

.nf-rp__chat {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 8px;
	border: 0;
	border-radius: 9px;
	background: transparent;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 14px;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.nf-rp__chat:hover {
	background: rgba(255, 255, 255, 0.05);
}

.nf-rp__chat.is-on {
	background: color-mix(in srgb, var(--color-brand) 14%, transparent);
}

.nf-rp__chat-name {
	flex: 1;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.nf-rp__check {
	display: grid;
	place-items: center;
	width: 18px;
	height: 18px;
	border: 2px solid rgba(255, 255, 255, 0.2);
	border-radius: 6px;
	color: transparent;
	transition:
		background-color 0.15s ease,
		border-color 0.15s ease,
		color 0.15s ease;
}

.nf-rp__check svg {
	width: 12px;
	height: 12px;
}

.nf-rp__chat.is-on .nf-rp__check {
	border-color: var(--color-brand);
	background: var(--color-brand);
	color: #fff;
}

.nf-rp__empty {
	margin: 0;
	padding: 18px 0;
	color: rgba(255, 255, 255, 0.45);
	font-size: 13px;
	text-align: center;
}

.nf-rp__empty.is-error {
	color: var(--color-red);
}

.nf-rp__link {
	margin-left: 6px;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-brand);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
}

.nf-rp__actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}

.nf-swap-enter-active,
.nf-swap-leave-active {
	transition:
		opacity 0.16s ease,
		transform 0.16s ease;
}

.nf-swap-enter-from {
	opacity: 0;
	transform: translateX(8px);
}

.nf-swap-leave-to {
	opacity: 0;
	transform: translateX(-8px);
}

@media (prefers-reduced-motion: reduce) {
	.nf-rp__ink,
	.nf-rp__tabs button,
	.nf-rp__chat,
	.nf-rp__check,
	.nf-swap-enter-active,
	.nf-swap-leave-active {
		transition: none;
	}
}
</style>
