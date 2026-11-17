<script setup lang="ts">
import { SendIcon, XIcon } from '@modrinth/assets'
import { NewModal } from '@modrinth/ui'
import { computed, nextTick, ref } from 'vue'

import { serviceRequest } from '@/helpers/uprojects-service'

import {
	type AuthorView,
	buildCommentTree,
	type CommentNode,
	type FeedComment,
	type FeedPost,
	type ReportReason,
	useNewsText,
	userAvatar,
} from './feed'
import NewsComment from './NewsComment.vue'
import NewsPostCard from './NewsPostCard.vue'

const props = defineProps<{
	post: FeedPost | null
	signedIn: boolean
	following: boolean
	bookmarked: boolean
	postingBanned: boolean
}>()

const emit = defineEmits<{
	like: [post: FeedPost]
	repost: [post: FeedPost]
	follow: [userId: string]
	bookmark: [post: FeedPost]
	delete: [post: FeedPost]
	report: [post: FeedPost, reason: ReportReason]
	copy: [text: string, kind: 'text' | 'link']
	profile: [author: AuthorView]
	tag: [tag: string]
	mention: [username: string]
	open: [post: FeedPost]
	seen: [post: FeedPost]
	comments: [postId: string, count: number]
	banned: []
	failed: [message: string]
}>()

const { t } = useNewsText()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
const comments = ref<FeedComment[]>([])
const loading = ref(false)
const loadError = ref('')
const sending = ref(false)
const draft = ref('')
const replyTo = ref<CommentNode | null>(null)
const removing = ref('')

const tree = computed(() => buildCommentTree(comments.value))
const total = computed(() => comments.value.length)

async function loadComments(postId: string) {
	loading.value = true
	loadError.value = ''
	const response = await serviceRequest(`/social/posts/${encodeURIComponent(postId)}/comments`, {
		query: { limit: 120 },
	})
	if (props.post?.id !== postId) return
	loading.value = false
	if (!response.ok) {
		loadError.value =
			response.error || t('app.news.commentsFailed', 'Не удалось загрузить комментарии')
		return
	}
	if (response.data?.postingBanned) emit('banned')
	comments.value = Array.isArray(response.data?.comments) ? response.data.comments : []
	emit('comments', postId, comments.value.length)
}

function show(post: FeedPost, focusComposer = false) {
	comments.value = []
	draft.value = ''
	replyTo.value = null
	modal.value?.show()
	void nextTick(() => {
		void loadComments(post.id)
		if (focusComposer) input.value?.focus()
	})
}

function hide() {
	modal.value?.hide()
}

function startReply(node: CommentNode) {
	replyTo.value = node
	void nextTick(() => input.value?.focus())
}

async function send() {
	const post = props.post
	const body = draft.value.trim()
	if (!post || !body || sending.value) return
	if (props.postingBanned) return
	sending.value = true
	const response = await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/comments`, {
		method: 'POST',
		body: { bodyMd: body, parentId: replyTo.value?.id || undefined },
	})
	sending.value = false
	if (!response.ok) {
		if (response.code === 'posting_banned') emit('banned')
		else
			emit(
				'failed',
				response.error || t('app.news.commentFailed', 'Не удалось отправить комментарий'),
			)
		return
	}
	draft.value = ''
	replyTo.value = null
	resize()
	await loadComments(post.id)
}

async function remove(node: CommentNode) {
	const post = props.post
	if (!post || removing.value) return
	removing.value = node.id
	const response = await serviceRequest(
		`/social/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(node.id)}`,
		{ method: 'DELETE' },
	)
	removing.value = ''
	if (!response.ok) {
		emit(
			'failed',
			response.error || t('app.news.commentDeleteFailed', 'Не удалось удалить комментарий'),
		)
		return
	}
	if (replyTo.value?.id === node.id) replyTo.value = null
	await loadComments(post.id)
}

function openCommentAuthor(node: CommentNode) {
	const user = node.author
	if (!user?.id) return
	emit('profile', {
		kind: 'user',
		name: user.username || '',
		userId: String(user.id),
		user: {
			id: String(user.id),
			username: user.username || '',
			uuid: user.uuid,
			skinUrl: user.skinUrl,
		},
		verified: Boolean(user.verified),
		avatar: userAvatar(user),
	})
}

function onKey(event: KeyboardEvent) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault()
		void send()
	}
}

function resize() {
	const el = input.value
	if (!el) return
	el.style.height = 'auto'
	el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

defineExpose({ show, hide })
</script>

<template>
	<NewModal
		ref="modal"
		:header="t('app.news.postTitle', 'Пост')"
		width="680px"
		max-width="calc(100vw - 48px)"
		scrollable
	>
		<div v-if="post" class="nf-pm">
			<NewsPostCard
				:post="post"
				:signed-in="signedIn"
				:following="following"
				:bookmarked="bookmarked"
				detached
				@like="emit('like', $event)"
				@repost="emit('repost', $event)"
				@follow="emit('follow', $event)"
				@bookmark="emit('bookmark', $event)"
				@delete="emit('delete', $event)"
				@report="(item, reason) => emit('report', item, reason)"
				@copy="(text, kind) => emit('copy', text, kind)"
				@profile="emit('profile', $event)"
				@tag="emit('tag', $event)"
				@mention="emit('mention', $event)"
				@open="emit('open', $event)"
				@seen="emit('seen', $event)"
			/>

			<section class="nf-pm__comments">
				<h3 class="nf-pm__title">
					{{ t('app.news.comments', 'Комментарии') }}
					<span v-if="total">{{ total }}</span>
				</h3>

				<div v-if="loading && !comments.length" class="nf-pm__skeleton">
					<div v-for="n in 3" :key="n" class="nf-pm__skeleton-row">
						<span class="nf-sk nf-sk--avatar" />
						<span class="nf-sk-lines">
							<span class="nf-sk" style="width: 30%" />
							<span class="nf-sk" :style="{ width: `${50 + n * 12}%` }" />
						</span>
					</div>
				</div>
				<p v-else-if="loadError" class="nf-pm__empty is-error">
					{{ loadError }}
					<button type="button" class="nf-pm__link" @click="post && loadComments(post.id)">
						{{ t('app.news.retry', 'Повторить') }}
					</button>
				</p>
				<p v-else-if="!comments.length" class="nf-pm__empty">
					{{ t('app.news.noComments', 'Комментариев пока нет — будь первым.') }}
				</p>
				<div v-else class="nf-pm__list">
					<NewsComment
						v-for="node in tree"
						:key="node.id"
						:node="node"
						:can-reply="signedIn && !postingBanned"
						:class="{ 'is-removing': removing === node.id }"
						@reply="startReply"
						@delete="remove"
						@profile="openCommentAuthor"
						@tag="emit('tag', $event)"
						@mention="emit('mention', $event)"
					/>
				</div>
			</section>
		</div>

		<template #actions>
			<div class="nf-pm__composer">
				<p v-if="!signedIn" class="nf-pm__note">
					{{
						t(
							'app.news.commentNeedAccount',
							'Войди через Microsoft или Ely.by, чтобы комментировать.',
						)
					}}
				</p>
				<p v-else-if="postingBanned" class="nf-pm__note is-error">
					{{ t('app.news.postingBanned', 'Публикация постов и комментариев для тебя ограничена.') }}
				</p>
				<template v-else>
					<Transition name="nf-fade">
						<div v-if="replyTo" class="nf-pm__reply">
							{{
								t('app.news.replyTo', 'Ответ для {name}', {
									name: replyTo.author?.username || t('app.news.someone', 'Игрок'),
								})
							}}
							<button
								type="button"
								:aria-label="t('app.news.cancelReply', 'Отменить ответ')"
								@click="replyTo = null"
							>
								<XIcon />
							</button>
						</div>
					</Transition>
					<div class="nf-pm__input">
						<textarea
							ref="input"
							v-model="draft"
							rows="1"
							maxlength="2000"
							:placeholder="t('app.news.commentPlaceholder', 'Написать комментарий…')"
							@input="resize"
							@keydown="onKey"
						/>
						<button
							type="button"
							class="nf-pm__send"
							:disabled="!draft.trim() || sending"
							:aria-label="t('app.news.send', 'Отправить')"
							@click="send"
						>
							<SendIcon />
						</button>
					</div>
				</template>
			</div>
		</template>
	</NewModal>
</template>

<style scoped>
.nf-pm {
	display: flex;
	flex-direction: column;
	gap: 18px;
}

.nf-pm__comments {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-top: 14px;
	border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.nf-pm__title {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	color: var(--color-contrast, #fff);
	font-size: 15px;
	font-weight: 700;
}

.nf-pm__title span {
	padding: 1px 7px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.08);
	color: rgba(255, 255, 255, 0.7);
	font-size: 12px;
}

.nf-pm__list {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.nf-pm__list :deep(.is-removing) {
	opacity: 0.4;
	pointer-events: none;
}

.nf-pm__empty {
	margin: 0;
	padding: 14px 0;
	color: rgba(255, 255, 255, 0.45);
	font-size: 13px;
	text-align: center;
}

.nf-pm__empty.is-error {
	color: var(--color-red);
}

.nf-pm__link {
	margin-left: 6px;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-brand);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
}

.nf-pm__skeleton {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.nf-pm__skeleton-row {
	display: flex;
	gap: 10px;
}

.nf-sk-lines {
	display: flex;
	flex-direction: column;
	gap: 6px;
	flex: 1;
}

.nf-sk {
	display: block;
	height: 10px;
	border-radius: 6px;
	background: linear-gradient(90deg, #26262b 0%, #303036 50%, #26262b 100%);
	background-size: 200% 100%;
	animation: nf-shimmer 1.2s linear infinite;
}

.nf-sk--avatar {
	flex-shrink: 0;
	width: 28px;
	height: 28px;
	border-radius: 8px;
}

.nf-pm__composer {
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 100%;
}

.nf-pm__note {
	margin: 0;
	color: rgba(255, 255, 255, 0.55);
	font-size: 13px;
}

.nf-pm__note.is-error {
	color: var(--color-red);
}

.nf-pm__reply {
	display: inline-flex;
	align-items: center;
	align-self: flex-start;
	gap: 6px;
	padding: 3px 4px 3px 10px;
	border-radius: 999px;
	background: rgba(176, 0, 255, 0.14);
	color: #e2b6ff;
	font-size: 12px;
	font-weight: 600;
}

.nf-pm__reply button {
	display: grid;
	place-items: center;
	width: 18px;
	height: 18px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: inherit;
	cursor: pointer;
}

.nf-pm__reply button:hover {
	background: rgba(255, 255, 255, 0.12);
}

.nf-pm__reply svg {
	width: 12px;
	height: 12px;
}

.nf-pm__input {
	display: flex;
	align-items: flex-end;
	gap: 8px;
	padding: 6px 6px 6px 12px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 12px;
	background: #141417;
	transition: border-color 0.18s ease;
}

.nf-pm__input:focus-within {
	border-color: rgba(176, 0, 255, 0.5);
}

.nf-pm__input textarea {
	flex: 1;
	min-height: 30px;
	max-height: 160px;
	padding: 5px 0;
	border: 0;
	outline: none;
	resize: none;
	background: transparent;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 14px;
	line-height: 20px;
	box-shadow: none;
}

.nf-pm__send {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 32px;
	height: 32px;
	border: 0;
	border-radius: 9px;
	background: var(--color-brand);
	color: #fff;
	cursor: pointer;
	transition:
		opacity 0.15s ease,
		transform 0.15s ease;
}

.nf-pm__send:disabled {
	cursor: default;
	opacity: 0.4;
}

.nf-pm__send:not(:disabled):active {
	transform: scale(0.92);
}

.nf-pm__send svg {
	width: 16px;
	height: 16px;
}

.nf-fade-enter-active,
.nf-fade-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.nf-fade-enter-from,
.nf-fade-leave-to {
	opacity: 0;
	transform: translateY(4px);
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
	.nf-sk {
		animation: none;
	}

	.nf-fade-enter-active,
	.nf-fade-leave-active,
	.nf-pm__send,
	.nf-pm__input {
		transition: none;
	}
}
</style>
