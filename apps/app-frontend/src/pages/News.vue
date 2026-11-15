<script setup lang="ts">
import {
	HeartIcon,
	ImagesIcon,
	NewspaperIcon,
	RefreshCwIcon,
	SendIcon,
	XIcon,
} from '@modrinth/assets'
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, onActivated, onMounted, ref } from 'vue'

import { useNoctrinthNews, usePortalrinthNews } from '@/features/news/portalrinth-news'
import {
	compressImageFile,
	ensureServiceSession,
	resolveAvatar,
	resolveServiceMedia,
	serviceRequest,
	type ServiceSession,
	type ServiceUser,
} from '@/helpers/uprojects-service'
import { useRootBreadcrumb } from '@/shared/breadcrumbs'

defineOptions({ name: 'NewsPage' })

const { formatMessage } = useVIntl()
const messages = defineMessages({
	heading: { id: 'app.news.heading', defaultMessage: 'Новости' },
})

const breadcrumb = useRootBreadcrumb({
	slot: 'root',
	id: 'news',
	label: () => formatMessage(messages.heading),
	to: '/news',
	visual: { type: 'icon', component: NewspaperIcon },
})

type FeedAuthor = {
	uuid?: string
	type?: string
	id?: string | number
	name?: string
	username?: string
	skinUrl?: string | null
	avatar?: string | null
	verified?: boolean
}

type FeedComment = {
	id: string
	body?: string
	bodyMd?: string
	author?: FeedAuthor
	createdAt?: string
	created_at?: string
}

type FeedPost = {
	id: string
	title?: string
	body?: string
	bodyMd?: string
	views?: number
	createdAt?: string
	created_at?: string
	author?: FeedAuthor
	user?: FeedAuthor
	attachments?: { id?: string; url: string; mime?: string }[]
	images?: string[]
	reactions?: Record<string, number>
	reactionEmoji?: string[]
	myReaction?: string | null
	commentCount?: number
	commentsCount?: number
}

const TIME_NOW = { id: 'app.news.timeNow', defaultMessage: 'только что' }
const TIME_MINUTES = {
	id: 'app.news.timeMinutes',
	defaultMessage:
		'{count, plural, one {# минуту} few {# минуты} many {# минут} other {# минуты}} назад',
}
const TIME_HOURS = {
	id: 'app.news.timeHours',
	defaultMessage: '{count, plural, one {# час} few {# часа} many {# часов} other {# часа}} назад',
}
const COMPOSER_EMPTY = {
	id: 'app.news.composerEmpty',
	defaultMessage: 'Напиши текст или добавь фото',
}
const NEED_ACCOUNT = {
	id: 'app.news.needAccount',
	defaultMessage: 'Нужен аккаунт Microsoft или Ely.by',
}
const POSTING_BANNED = {
	id: 'app.news.postingBanned',
	defaultMessage: 'Публикация постов и комментариев ограничена сервисом',
}
const PUBLISH_FAILED = { id: 'app.news.publishFailed', defaultMessage: 'Не удалось опубликовать' }
const VIEWS_LABEL = {
	id: 'app.news.views',
	defaultMessage:
		'{count, plural, one {# просмотр} few {# просмотра} many {# просмотров} other {# просмотра}}',
}

type OfficialArticle = {
	id: string
	title: string
	summary?: string
	thumbnail?: string | null
	date?: string
	source: string
	link?: string
}

const tab = ref<'feed' | 'official'>('feed')
const loading = ref(true)
const loadError = ref('')
const session = ref<ServiceSession | null>(null)
const me = ref<ServiceUser | null>(null)
const myAvatar = ref('')
const posts = ref<FeedPost[]>([])
const suggestions = ref<ServiceUser[]>([])
const postingBanned = ref(false)

const composerText = ref('')
const composerImages = ref<string[]>([])
const publishing = ref(false)
const composerNotice = ref('')

const openComments = ref('')
const comments = ref<FeedComment[]>([])
const commentsLoading = ref(false)
const commentDraft = ref('')

const refreshing = ref(false)

const officialPortalrinth = usePortalrinthNews()
const officialNoctrinth = useNoctrinthNews()

const officialArticles = computed<OfficialArticle[]>(() => {
	const map = (
		list: {
			path: string
			title?: string
			summary?: string
			thumbnail?: string | null
			date?: string
		}[],
		source: string,
	) =>
		list.map((article) => ({
			id: `${source}:${article.path}`,
			title: article.title || article.path,
			summary: article.summary,
			thumbnail: article.thumbnail,
			date: article.date,
			source,
			link: article.path,
		}))
	return [
		...map(officialPortalrinth.value as never, 'Portalrinth'),
		...map(officialNoctrinth.value as never, 'Noctrinth'),
	].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
})

const avatarUrls = ref<Record<string, string>>({})

async function avatarFor(key: string, author?: FeedAuthor): Promise<string> {
	if (!author) return ''
	if (avatarUrls.value[key]) return avatarUrls.value[key]
	const url = await resolveAvatar({
		skinUrl: author.skinUrl,
		avatar: author.avatar,
		uuid: author.id ? String(author.id) : undefined,
		username: author.username,
		name: author.name,
	})
	avatarUrls.value = { ...avatarUrls.value, [key]: url }
	return url
}

function postAuthor(post: FeedPost): FeedAuthor | undefined {
	return post.author || post.user
}

function authorName(author?: FeedAuthor): string {
	return String(
		author?.username ||
			author?.name ||
			(author?.type === 'launcher' ? 'Undefined Studio' : 'Игрок'),
	).trim()
}

function postText(post: FeedPost): string {
	return String(post.bodyMd || post.body || '').trim()
}

function postTime(post: FeedPost): string {
	const raw = post.createdAt || post.created_at || ''
	if (!raw) return ''
	const date = new Date(raw)
	if (Number.isNaN(date.getTime())) return ''
	const diff = Date.now() - date.getTime()
	const minutes = Math.floor(diff / 60000)
	if (minutes < 1) return formatMessage(TIME_NOW)
	if (minutes < 60) return formatMessage(TIME_MINUTES, { count: minutes })
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return formatMessage(TIME_HOURS, { count: hours })
	return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function postImages(post: FeedPost): { id: string; url: string }[] {
	if (post.attachments?.length) {
		return post.attachments.map((attachment, index) => ({
			id: attachment.id || `${post.id}-${index}`,
			url: resolveServiceMedia(attachment.url),
		}))
	}
	if (post.images?.length) {
		return post.images.map((url, index) => ({
			id: `${post.id}-${index}`,
			url: resolveServiceMedia(url),
		}))
	}
	return []
}

function reactionCount(post: FeedPost): number {
	const map = post.reactions
	if (map && typeof map === 'object') {
		return Object.values(map).reduce((sum, value) => sum + (Number(value) || 0), 0)
	}
	return 0
}

async function loadFeed() {
	loading.value = true
	loadError.value = ''
	try {
		const [sessionReady, response] = await Promise.all([
			ensureServiceSession(),
			serviceRequest('/social/feed', { query: { channel: 'community', limit: 40 } }),
		])
		session.value = sessionReady
		if (sessionReady) {
			me.value = sessionReady.user
			myAvatar.value = await avatarFor(
				`me:${sessionReady.user.id ?? sessionReady.user.username ?? ''}`,
				{
					skinUrl: sessionReady.user.skinUrl,
					avatar: sessionReady.user.avatar,
					uuid: sessionReady.user.uuid,
					username: sessionReady.user.username,
					name: sessionReady.user.name,
				},
			)
		}
		if (response.ok) {
			posts.value = Array.isArray(response.data?.posts) ? response.data.posts : []
			suggestions.value = Array.isArray(response.data?.suggestions) ? response.data.suggestions : []
			postingBanned.value = Boolean(response.data?.postingBanned)
			for (const post of posts.value) {
				const author = postAuthor(post)
				if (author)
					void avatarFor(`${post.id}:${author.id ?? author.username ?? author.name}`, author)
			}
		} else {
			loadError.value =
				response.code === 'no_account' ? '' : response.error || `HTTP ${response.status}`
		}
	} catch (error) {
		loadError.value = error instanceof Error ? error.message : 'network'
	} finally {
		loading.value = false
	}
}

async function refresh() {
	refreshing.value = true
	await loadFeed()
	refreshing.value = false
}

async function publish() {
	const text = composerText.value.trim()
	if (!text && !composerImages.value.length) {
		composerNotice.value = formatMessage(COMPOSER_EMPTY)
		return
	}
	if (!session.value) {
		composerNotice.value = formatMessage(NEED_ACCOUNT)
		return
	}
	publishing.value = true
	composerNotice.value = ''
	try {
		const response = await serviceRequest('/social/posts', {
			method: 'POST',
			body: { bodyMd: text, images: composerImages.value.slice(0, 6) },
		})
		if (!response.ok) {
			composerNotice.value =
				response.code === 'posting_banned'
					? formatMessage(POSTING_BANNED)
					: response.error || formatMessage(PUBLISH_FAILED)
			return
		}
		composerText.value = ''
		composerImages.value = []
		await loadFeed()
	} finally {
		publishing.value = false
	}
}

async function attachImages(event: Event) {
	const input = event.target as HTMLInputElement
	const files = Array.from(input.files || []).slice(0, 6 - composerImages.value.length)
	for (const file of files) {
		try {
			const dataUrl = await compressImageFile(file)
			composerImages.value.push(dataUrl)
		} catch {
			/* одна картинка не должна ронять выбор остальных */
		}
	}
	input.value = ''
}

async function react(post: FeedPost) {
	if (!session.value) return
	const emoji = post.myReaction ? post.myReaction : '❤️'
	await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/react`, {
		method: 'POST',
		body: { emoji },
	})
	await loadFeed()
}

async function toggleComments(post: FeedPost) {
	if (openComments.value === post.id) {
		openComments.value = ''
		return
	}
	openComments.value = post.id
	comments.value = []
	commentsLoading.value = true
	commentDraft.value = ''
	try {
		const response = await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/comments`, {
			query: { limit: 50 },
		})
		comments.value = Array.isArray(response.data?.comments) ? response.data.comments : []
	} finally {
		commentsLoading.value = false
	}
}

async function sendComment(post: FeedPost) {
	const body = commentDraft.value.trim()
	if (!body || !session.value) return
	commentsLoading.value = true
	try {
		await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/comments`, {
			method: 'POST',
			body: { body },
		})
		commentDraft.value = ''
		const response = await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/comments`, {
			query: { limit: 50 },
		})
		comments.value = Array.isArray(response.data?.comments) ? response.data.comments : []
	} finally {
		commentsLoading.value = false
	}
}

async function follow(user: ServiceUser) {
	if (!user.id) return
	await serviceRequest(`/social/users/${encodeURIComponent(String(user.id))}/follow`, {
		method: 'POST',
	})
	await loadFeed()
}

function openArticle(article: OfficialArticle) {
	if (article.link) window.open(article.link, '_blank')
}

onMounted(async () => {
	await loadFeed()
})

onActivated(breadcrumb.reset)
</script>

<template>
	<div class="news-page">
		<div class="news-head">
			<div class="news-tabs" role="tablist">
				<button
					class="news-tab"
					:class="{ 'is-on': tab === 'feed' }"
					role="tab"
					:aria-selected="tab === 'feed'"
					@click="tab = 'feed'"
				>
					{{ formatMessage({ id: 'app.news.tabFeed', defaultMessage: 'Лента' }) }}
				</button>
				<button
					class="news-tab"
					:class="{ 'is-on': tab === 'official' }"
					role="tab"
					:aria-selected="tab === 'official'"
					@click="tab = 'official'"
				>
					{{ formatMessage({ id: 'app.news.tabOfficial', defaultMessage: 'Официальные новости' }) }}
				</button>
			</div>
			<button
				class="news-refresh"
				:class="{ 'is-busy': refreshing }"
				aria-label="Обновить"
				@click="refresh"
			>
				<RefreshCwIcon v-if="!refreshing" />
				<span v-else class="news-spinner" />
			</button>
		</div>

		<template v-if="tab === 'feed'">
			<div v-if="!session" class="news-gate">
				<NewspaperIcon />
				<div>
					<b>{{
						formatMessage({
							id: 'app.news.gateTitle',
							defaultMessage: 'Посты и новости сообщества',
						})
					}}</b>
					<p>
						{{
							formatMessage({
								id: 'app.news.gateText',
								defaultMessage:
									'Войдите в аккаунт Microsoft или Ely.by — и вы сможете публиковать посты, ставить реакции и комментировать. Лента общая с Undefined Client: посты всех видны и у нас, и у них.',
							})
						}}
					</p>
				</div>
			</div>

			<div v-else class="news-composer">
				<img v-if="myAvatar" :src="myAvatar" class="news-avatar" alt="" />
				<div v-else class="news-avatar news-avatar--empty" />
				<div class="news-composer__body">
					<textarea
						v-model="composerText"
						class="news-composer__input"
						rows="2"
						:placeholder="
							formatMessage({
								id: 'app.news.composerPlaceholder',
								defaultMessage: 'Поделитесь новостями, сборкой или скриншотом…',
							})
						"
					/>
					<div v-if="composerImages.length" class="news-composer__thumbs">
						<span v-for="(image, index) in composerImages" :key="index" class="news-thumb">
							<img :src="image" alt="" />
							<button :aria-label="'Убрать'" @click="composerImages.splice(index, 1)">
								<XIcon />
							</button>
						</span>
					</div>
					<div class="news-composer__row">
						<label class="news-attach">
							<ImagesIcon />
							<input
								type="file"
								accept="image/png,image/jpeg,image/webp"
								multiple
								hidden
								@change="attachImages"
							/>
						</label>
						<span v-if="composerNotice" class="news-composer__notice">{{ composerNotice }}</span>
						<Button
							class="news-publish"
							:disabled="
								publishing || postingBanned || (!composerText.trim() && !composerImages.length)
							"
							@click="publish"
						>
							<SendIcon />
							{{ formatMessage({ id: 'app.news.publish', defaultMessage: 'Опубликовать' }) }}
						</Button>
					</div>
				</div>
			</div>

			<div v-if="loading" class="news-state">
				{{ formatMessage({ id: 'app.news.loading', defaultMessage: 'Загружаем ленту…' }) }}
			</div>
			<div v-else-if="loadError" class="news-state news-state--error">
				{{ formatMessage({ id: 'app.news.loadError', defaultMessage: 'Сервис пока не отвечает' }) }}
				· {{ loadError }}
			</div>

			<TransitionGroup v-else name="news-card" tag="div" class="news-feed">
				<article
					v-for="post in posts"
					:key="post.id"
					class="news-card"
					@click="toggleComments(post)"
				>
					<div class="news-card__head">
						<img
							v-if="
								avatarUrls[
									`${post.id}:${postAuthor(post)?.id ?? postAuthor(post)?.username ?? postAuthor(post)?.name}`
								]
							"
							:src="
								avatarUrls[
									`${post.id}:${postAuthor(post)?.id ?? postAuthor(post)?.username ?? postAuthor(post)?.name}`
								]
							"
							class="news-avatar"
							alt=""
						/>
						<div v-else class="news-avatar news-avatar--empty" />
						<div class="news-card__who">
							<span class="news-card__name">
								{{ authorName(postAuthor(post)) }}
								<span
									v-if="postAuthor(post)?.verified"
									class="news-verified"
									title="Проверенный автор"
									>✓</span
								>
							</span>
							<span class="news-card__time">{{ postTime(post) }}</span>
						</div>
						<button
							v-if="
								postAuthor(post)?.id &&
								session &&
								String(postAuthor(post)!.id) !== String(me?.id ?? '')
							"
							class="news-follow"
							@click.stop="follow(postAuthor(post)!)"
						>
							{{ formatMessage({ id: 'app.news.follow', defaultMessage: 'Подписаться' }) }}
						</button>
					</div>
					<p v-if="post.title" class="news-card__title">{{ post.title }}</p>
					<p v-if="postText(post)" class="news-card__text">{{ postText(post) }}</p>
					<div
						v-if="postImages(post).length"
						class="news-card__grid"
						:class="{ 'is-many': postImages(post).length > 1 }"
					>
						<img
							v-for="image in postImages(post)"
							:key="image.id"
							:src="image.url"
							alt=""
							loading="lazy"
						/>
					</div>
					<div class="news-card__actions">
						<button class="news-action" :title="'Реакция'" @click.stop="react(post)">
							<HeartIcon />
							<span>{{ reactionCount(post) || '' }}</span>
						</button>
						<button class="news-action" @click.stop="toggleComments(post)">
							{{ formatMessage({ id: 'app.news.comments', defaultMessage: 'Комментарии' }) }}
							<span v-if="post.commentCount ?? post.commentsCount">{{
								post.commentCount ?? post.commentsCount
							}}</span>
						</button>
						<span v-if="post.views" class="news-card__views">
							{{ formatMessage(VIEWS_LABEL, { count: post.views }) }}
						</span>
					</div>
					<div v-if="openComments === post.id" class="news-comments" @click.stop>
						<div v-if="commentsLoading" class="news-comments__loading">
							{{
								formatMessage({
									id: 'app.news.commentsLoading',
									defaultMessage: 'Загружаем комментарии…',
								})
							}}
						</div>
						<template v-else>
							<div v-for="comment in comments" :key="comment.id" class="news-comment">
								<b>{{ authorName(comment.author) }}</b>
								<p>{{ comment.body || comment.bodyMd }}</p>
							</div>
							<p v-if="!comments.length" class="news-comments__empty">
								{{
									formatMessage({
										id: 'app.news.noComments',
										defaultMessage: 'Пока тихо — будьте первым.',
									})
								}}
							</p>
							<div v-if="session" class="news-comment__form">
								<input
									v-model="commentDraft"
									:placeholder="
										formatMessage({
											id: 'app.news.commentPlaceholder',
											defaultMessage: 'Написать комментарий…',
										})
									"
									@keydown.enter.prevent="sendComment(post)"
								/>
								<Button :disabled="!commentDraft.trim()" @click="sendComment(post)">
									<SendIcon />
								</Button>
							</div>
						</template>
					</div>
				</article>
			</TransitionGroup>

			<div v-if="suggestions.length && session" class="news-suggestions">
				<b>{{ formatMessage({ id: 'app.news.suggestions', defaultMessage: 'Кого читать' }) }}</b>
				<div class="news-suggestions__row">
					<button
						v-for="user in suggestions.slice(0, 8)"
						:key="String(user.id)"
						class="news-suggestion"
						@click="follow(user)"
					>
						{{ user.username || user.name }}
					</button>
				</div>
			</div>
		</template>

		<template v-else>
			<TransitionGroup name="news-card" tag="div" class="news-feed">
				<article
					v-for="article in officialArticles"
					:key="article.id"
					class="news-card news-card--official"
					@click="openArticle(article)"
				>
					<img
						v-if="article.thumbnail"
						:src="article.thumbnail"
						class="news-card__cover"
						alt=""
						loading="lazy"
					/>
					<div class="news-card__head">
						<span class="news-source" :data-source="article.source.toLowerCase()">{{
							article.source
						}}</span>
						<span class="news-card__time">{{ article.date }}</span>
					</div>
					<p class="news-card__title">{{ article.title }}</p>
					<p v-if="article.summary" class="news-card__text">{{ article.summary }}</p>
				</article>
			</TransitionGroup>
			<div v-if="!officialArticles.length" class="news-state">
				{{
					formatMessage({
						id: 'app.news.officialEmpty',
						defaultMessage: 'Официальных новостей пока нет.',
					})
				}}
			</div>
		</template>
	</div>
</template>

<style scoped>
.news-page {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	max-width: 46rem;
	margin: 0 auto;
	padding: 1.5rem 1rem 3rem;
}

.news-head {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}

.news-tabs {
	display: flex;
	gap: 0.25rem;
	background: var(--color-bg);
	border-radius: 1rem;
	padding: 0.25rem;
	flex: 1;
}

.news-tab {
	flex: 1;
	border: none;
	background: transparent;
	color: var(--color-text-inactive);
	padding: 0.5rem 1rem;
	border-radius: 0.75rem;
	cursor: pointer;
	font-weight: 600;
	transition:
		background-color 0.18s ease,
		color 0.18s ease,
		transform 0.18s ease;
}

.news-tab:hover {
	color: var(--color-contrast);
	transform: translateY(-1px);
}

.news-tab.is-on {
	background: var(--color-brand);
	color: var(--color-brand-invert);
}

.news-refresh {
	border: none;
	background: var(--color-bg);
	color: var(--color-text);
	border-radius: 0.75rem;
	width: 2.75rem;
	height: 2.75rem;
	display: grid;
	place-items: center;
	cursor: pointer;
	transition: transform 0.3s ease;
}

.news-refresh:hover {
	transform: rotate(60deg);
}

.news-refresh.is-busy {
	pointer-events: none;
}

.news-spinner {
	width: 1rem;
	height: 1rem;
	border: 2px solid var(--color-brand);
	border-top-color: transparent;
	border-radius: 50%;
	animation: news-spin 0.8s linear infinite;
}

@keyframes news-spin {
	to {
		transform: rotate(360deg);
	}
}

.news-gate {
	display: flex;
	gap: 1rem;
	align-items: flex-start;
	background: var(--color-bg);
	border: 1px dashed var(--color-button-bg);
	border-radius: 1rem;
	padding: 1rem 1.25rem;
	color: var(--color-text);
}

.news-gate svg {
	width: 1.75rem;
	height: 1.75rem;
	flex-shrink: 0;
	color: var(--color-brand);
}

.news-gate p {
	margin: 0.25rem 0 0;
	color: var(--color-text-inactive);
	font-size: 0.9rem;
}

.news-composer,
.news-card {
	background: var(--color-bg);
	border-radius: 1rem;
	padding: 1rem 1.25rem;
	box-shadow: var(--shadow-card);
}

.news-composer {
	display: flex;
	gap: 0.75rem;
}

.news-avatar {
	width: 2.5rem;
	height: 2.5rem;
	border-radius: 0.6rem;
	object-fit: cover;
	flex-shrink: 0;
	image-rendering: pixelated;
}

.news-avatar--empty {
	background: var(--color-button-bg);
}

.news-composer__body {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.news-composer__input {
	background: var(--color-button-bg);
	border: none;
	border-radius: 0.75rem;
	color: var(--color-contrast);
	padding: 0.65rem 0.85rem;
	resize: vertical;
	min-height: 3rem;
	font: inherit;
}

.news-composer__thumbs {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.news-thumb {
	position: relative;
	width: 4.5rem;
	height: 4.5rem;
	border-radius: 0.6rem;
	overflow: hidden;
}

.news-thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.news-thumb button {
	position: absolute;
	top: 0.2rem;
	right: 0.2rem;
	border: none;
	background: rgba(0, 0, 0, 0.6);
	color: white;
	border-radius: 50%;
	width: 1.25rem;
	height: 1.25rem;
	display: grid;
	place-items: center;
	cursor: pointer;
}

.news-thumb button svg {
	width: 0.75rem;
	height: 0.75rem;
}

.news-composer__row {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}

.news-attach {
	display: grid;
	place-items: center;
	width: 2.25rem;
	height: 2.25rem;
	border-radius: 0.6rem;
	background: var(--color-button-bg);
	color: var(--color-text);
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		color 0.18s ease;
}

.news-attach:hover {
	background: var(--color-brand);
	color: var(--color-brand-invert);
}

.news-attach svg {
	width: 1.1rem;
	height: 1.1rem;
}

.news-composer__notice {
	color: var(--color-text-inactive);
	font-size: 0.85rem;
	flex: 1;
}

.news-publish {
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
}

.news-publish svg {
	width: 0.9rem;
	height: 0.9rem;
}

.news-feed {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.news-card {
	cursor: pointer;
	transition:
		transform 0.18s ease,
		box-shadow 0.18s ease;
}

.news-card:hover {
	transform: translateY(-2px);
	box-shadow: var(--shadow-floating);
}

.news-card__head {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}

.news-card__who {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
}

.news-card__name {
	font-weight: 700;
	color: var(--color-contrast);
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
}

.news-verified {
	color: var(--color-brand);
	font-weight: 800;
}

.news-card__time {
	color: var(--color-text-inactive);
	font-size: 0.8rem;
}

.news-follow {
	border: 1px solid var(--color-brand);
	background: transparent;
	color: var(--color-brand);
	border-radius: 2rem;
	padding: 0.25rem 0.8rem;
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		color 0.18s ease,
		transform 0.18s ease;
}

.news-follow:hover {
	background: var(--color-brand);
	color: var(--color-brand-invert);
	transform: scale(1.04);
}

.news-card__title {
	margin: 0.75rem 0 0;
	font-weight: 700;
	font-size: 1.05rem;
	color: var(--color-contrast);
}

.news-card__text {
	margin: 0.5rem 0 0;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--color-text);
}

.news-card__grid {
	display: grid;
	gap: 0.4rem;
	margin-top: 0.75rem;
	border-radius: 0.75rem;
	overflow: hidden;
	grid-template-columns: 1fr;
}

.news-card__grid.is-many {
	grid-template-columns: repeat(2, 1fr);
}

.news-card__grid img {
	width: 100%;
	height: 100%;
	max-height: 22rem;
	object-fit: cover;
}

.news-card__cover {
	width: 100%;
	max-height: 14rem;
	object-fit: cover;
	border-radius: 0.75rem;
	margin-bottom: 0.75rem;
}

.news-card__actions {
	display: flex;
	align-items: center;
	gap: 1.25rem;
	margin-top: 0.75rem;
	color: var(--color-text-inactive);
}

.news-action {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	border: none;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font: inherit;
	font-size: 0.85rem;
	padding: 0.15rem 0;
	transition:
		color 0.18s ease,
		transform 0.18s ease;
}

.news-action:hover {
	color: var(--color-brand);
	transform: scale(1.06);
}

.news-action svg {
	width: 1rem;
	height: 1rem;
}

.news-card__views {
	margin-left: auto;
	font-size: 0.8rem;
}

.news-comments {
	margin-top: 0.75rem;
	border-top: 1px solid var(--color-button-bg);
	padding-top: 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	cursor: default;
}

.news-comment b {
	font-size: 0.85rem;
	color: var(--color-contrast);
}

.news-comment p {
	margin: 0.15rem 0 0;
	font-size: 0.9rem;
	color: var(--color-text);
	word-break: break-word;
}

.news-comments__empty,
.news-comments__loading {
	color: var(--color-text-inactive);
	font-size: 0.85rem;
}

.news-comment__form {
	display: flex;
	gap: 0.5rem;
	margin-top: 0.5rem;
}

.news-comment__form input {
	flex: 1;
	background: var(--color-button-bg);
	border: none;
	border-radius: 0.6rem;
	padding: 0.5rem 0.75rem;
	color: var(--color-contrast);
	font: inherit;
}

.news-suggestions {
	background: var(--color-bg);
	border-radius: 1rem;
	padding: 0.9rem 1.25rem;
}

.news-suggestions__row {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-top: 0.6rem;
}

.news-suggestion {
	border: 1px solid var(--color-button-bg);
	background: var(--color-button-bg);
	border-radius: 2rem;
	padding: 0.3rem 0.9rem;
	font-size: 0.85rem;
	color: var(--color-text);
	cursor: pointer;
	transition:
		border-color 0.18s ease,
		color 0.18s ease,
		transform 0.18s ease;
}

.news-suggestion:hover {
	border-color: var(--color-brand);
	color: var(--color-brand);
	transform: translateY(-1px);
}

.news-source {
	font-size: 0.75rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-brand);
}

.news-state {
	text-align: center;
	color: var(--color-text-inactive);
	padding: 2rem 0;
}

.news-state--error {
	color: var(--color-red);
}

.news-card-enter-active,
.news-card-leave-active,
.news-card-move {
	transition:
		transform 0.35s cubic-bezier(0.22, 1, 0.36, 1),
		opacity 0.35s ease;
}

.news-card-enter-from {
	opacity: 0;
	transform: translateY(14px) scale(0.98);
}

.news-card-leave-to {
	opacity: 0;
	transform: scale(0.97);
}

.news-card-leave-active {
	position: absolute;
	width: 100%;
}
</style>
