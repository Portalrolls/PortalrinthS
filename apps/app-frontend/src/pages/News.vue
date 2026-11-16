<script setup lang="ts">
import {
	HeartIcon,
	ImagesIcon,
	NewspaperIcon,
	RefreshCwIcon,
	SearchIcon,
	SendIcon,
	XIcon,
} from '@modrinth/assets'
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, onActivated, onMounted, ref } from 'vue'

import UserProfileModal from '@/components/ui/messenger/UserProfileModal.vue'
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

const profileModal = ref<InstanceType<typeof UserProfileModal> | null>(null)

const openProfileLabel = formatMessage({
	id: 'app.messenger.profile.open',
	defaultMessage: 'Открыть профиль',
})

/** Полный профиль автора поста — та же карточка, что в MC Messenger. */
function openProfile(author?: FeedAuthor) {
	if (author?.id == null || author.id === '') return
	profileModal.value?.show(
		{ id: String(author.id), username: author.username, name: author.name, uuid: author.uuid },
		{ canWrite: false, self: String(author.id) === String(me.value?.id ?? '') },
	)
}

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

type FeedTab = 'feed' | 'following' | 'articles'
const tab = ref<FeedTab>('feed')
const search = ref('')
const loading = ref(true)
const loadError = ref('')
const session = ref<ServiceSession | null>(null)
const me = ref<ServiceUser | null>(null)
const myAvatar = ref('')
const posts = ref<FeedPost[]>([])
const suggestions = ref<ServiceUser[]>([])
const followingIds = ref<string[]>([])
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

/** Вкладки и поиск работают как в оригинале: лента фильтруется на месте. */
const visiblePosts = computed<FeedPost[]>(() => {
	const followed = new Set(followingIds.value)
	const query = search.value.trim().toLowerCase()
	return posts.value.filter((post) => {
		if (tab.value === 'following') {
			const id = postAuthor(post)?.id
			if (id == null || !followed.has(String(id))) return false
		}
		if (!query) return true
		const author = authorName(postAuthor(post)).toLowerCase()
		return postText(post).toLowerCase().includes(query) || author.includes(query)
	})
})

/** Правая колонка: самые горячие посты ленты. */
const popularPosts = computed<FeedPost[]>(() => {
	return [...posts.value]
		.sort((a, b) => reactionCount(b) + (b.views || 0) - reactionCount(a) - (a.views || 0))
		.slice(0, 5)
})

/** Правая колонка: живые хэштеги из постов. */
const feedTags = computed<string[]>(() => {
	const counts = new Map<string, number>()
	for (const post of posts.value) {
		for (const tag of postText(post).matchAll(/#([\p{L}\p{N}_]{2,24})/gu)) {
			const name = tag[1].toLowerCase()
			counts.set(name, (counts.get(name) || 0) + 1)
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([name]) => `#${name}`)
})

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
			followingIds.value = Array.isArray(response.data?.followingIds)
				? response.data.followingIds.map(String)
				: []
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

async function toggleFollow(user: { id?: string | number }) {
	if (!user.id) return
	const id = String(user.id)
	const on = followingIds.value.includes(id)
	const response = await serviceRequest(`/social/users/${encodeURIComponent(id)}/follow`, {
		method: on ? 'DELETE' : 'POST',
	})
	if (!response.ok) return
	followingIds.value = on
		? followingIds.value.filter((entry) => entry !== id)
		: [...followingIds.value, id]
	if (!on) {
		suggestions.value = suggestions.value.filter((entry) => String(entry.id) !== id)
	}
}

async function openArticle(article: OfficialArticle) {
	if (article.link) window.open(article.link, '_blank')
}

onMounted(async () => {
	await loadFeed()
})

onActivated(breadcrumb.reset)
</script>

<template>
	<div class="nr-page" :data-tab="tab">
		<div class="nr-main">
			<div class="nr-tabs" role="tablist" :aria-label="formatMessage(messages.heading)">
				<button
					type="button"
					class="nr-tabs__btn"
					:class="{ 'is-active': tab === 'feed' }"
					role="tab"
					:aria-selected="tab === 'feed'"
					@click="tab = 'feed'"
				>
					{{ formatMessage({ id: 'app.news.tabFeed', defaultMessage: 'Рекомендации' }) }}
				</button>
				<button
					type="button"
					class="nr-tabs__btn"
					:class="{ 'is-active': tab === 'following' }"
					role="tab"
					:aria-selected="tab === 'following'"
					@click="tab = 'following'"
				>
					{{ formatMessage({ id: 'app.news.tabFollowing', defaultMessage: 'Подписки' }) }}
				</button>
				<button
					type="button"
					class="nr-tabs__btn"
					:class="{ 'is-active': tab === 'articles' }"
					role="tab"
					:aria-selected="tab === 'articles'"
					@click="tab = 'articles'"
				>
					{{ formatMessage({ id: 'app.news.tabArticles', defaultMessage: 'Статьи' }) }}
				</button>
			</div>

			<label class="nr-search">
				<SearchIcon />
				<input
					v-model="search"
					type="text"
					:placeholder="
						formatMessage({ id: 'app.news.searchPlaceholder', defaultMessage: 'Поиск в ленте...' })
					"
					autocomplete="off"
					spellcheck="false"
				/>
				<button
					v-if="refreshing"
					type="button"
					class="nr-search__spin"
					aria-label="Обновляем"
					disabled
				/>
			</label>

			<div v-if="tab !== 'articles'" class="nr-tools">
				<button
					type="button"
					class="nr-refresh"
					:class="{ 'is-busy': refreshing }"
					aria-label="Обновить"
					@click="refresh"
				>
					<RefreshCwIcon v-if="!refreshing" />
					<span v-else class="nr-spinner" />
				</button>
			</div>

			<template v-if="tab === 'articles'">
				<TransitionGroup name="nr-post" tag="div" class="nr-feed">
					<article
						v-for="article in officialArticles"
						:key="article.id"
						class="nr-post nr-post--article"
						@click="openArticle(article)"
					>
						<img
							v-if="article.thumbnail"
							:src="article.thumbnail"
							class="nr-post__cover"
							alt=""
							loading="lazy"
						/>
						<div class="nr-post__body">
							<div class="nr-post__meta">
								<span class="nr-source" :data-source="article.source.toLowerCase()">{{
									article.source
								}}</span>
								<span class="nr-post__time">{{ article.date }}</span>
							</div>
							<p class="nr-post__title">{{ article.title }}</p>
							<p v-if="article.summary" class="nr-post__text">{{ article.summary }}</p>
						</div>
					</article>
				</TransitionGroup>
				<p v-if="!officialArticles.length" class="nr-empty">
					{{
						formatMessage({
							id: 'app.news.officialEmpty',
							defaultMessage: 'Официальных новостей пока нет.',
						})
					}}
				</p>
			</template>

			<template v-else>
				<div v-if="!session && !loading" class="nr-gate">
					<NewspaperIcon />
					<b>{{
						formatMessage({ id: 'app.news.gateTitle', defaultMessage: 'Новости сообщества' })
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

				<form v-else-if="session" class="nr-compose" @submit.prevent="publish">
					<div class="nr-compose__row">
						<img v-if="myAvatar" :src="myAvatar" class="nr-compose__avatar" alt="" />
						<span v-else class="nr-compose__avatar nr-compose__avatar--stub" />
						<div class="nr-compose__field">
							<textarea
								v-model="composerText"
								rows="1"
								:placeholder="
									formatMessage({
										id: 'app.news.composerPlaceholder',
										defaultMessage: 'Что нового у вас?',
									})
								"
							/>
							<label class="nr-compose__plus" aria-label="Добавить фото">
								<ImagesIcon />
								<input
									type="file"
									accept="image/png,image/jpeg,image/webp"
									multiple
									hidden
									@change="attachImages"
								/>
							</label>
						</div>
						<button
							type="submit"
							class="nr-compose__publish"
							:disabled="
								publishing || postingBanned || (!composerText.trim() && !composerImages.length)
							"
							:aria-label="
								formatMessage({ id: 'app.news.publish', defaultMessage: 'Опубликовать' })
							"
						>
							<SendIcon />
						</button>
					</div>
					<div v-if="composerImages.length" class="nr-compose__previews">
						<span v-for="(image, index) in composerImages" :key="index" class="nr-compose__preview">
							<img :src="image" alt="" />
							<button type="button" aria-label="Убрать" @click="composerImages.splice(index, 1)">
								<XIcon />
							</button>
						</span>
					</div>
					<p v-if="composerNotice" class="nr-compose__notice">{{ composerNotice }}</p>
				</form>

				<div v-if="loading" class="nr-empty">
					{{ formatMessage({ id: 'app.news.loading', defaultMessage: 'Загружаем ленту…' }) }}
				</div>
				<div v-else-if="loadError" class="nr-empty nr-empty--error">
					{{
						formatMessage({ id: 'app.news.loadError', defaultMessage: 'Сервис пока не отвечает' })
					}}
					· {{ loadError }}
				</div>

				<TransitionGroup v-else name="nr-post" tag="div" class="nr-feed">
					<article
						v-for="post in visiblePosts"
						:key="post.id"
						class="nr-post"
						@click="toggleComments(post)"
					>
						<div class="nr-post__head">
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
								class="nr-post__avatar"
								alt=""
							/>
							<span v-else class="nr-post__avatar nr-post__avatar--stub" />
							<div class="nr-post__who">
								<div class="nr-post__name-row">
									<button
										type="button"
										class="nr-post__name"
										:disabled="postAuthor(post)?.id == null"
										:aria-label="openProfileLabel"
										@click="openProfile(postAuthor(post))"
									>
										{{ authorName(postAuthor(post)) }}
										<span
											v-if="postAuthor(post)?.verified"
											class="nr-post__verified"
											title="Проверенный автор"
											>✓</span
										>
									</button>
									<span class="nr-post__time">{{ postTime(post) }}</span>
								</div>
							</div>
							<button
								v-if="
									postAuthor(post)?.id &&
									session &&
									String(postAuthor(post)!.id) !== String(me?.id ?? '') &&
									postAuthor(post)?.type === 'user'
								"
								type="button"
								class="nr-follow"
								:class="{ 'is-on': followingIds.includes(String(postAuthor(post)!.id)) }"
								@click.stop="toggleFollow({ id: postAuthor(post)!.id })"
							>
								{{
									followingIds.includes(String(postAuthor(post)!.id))
										? formatMessage({ id: 'app.news.unfollow', defaultMessage: 'Отписаться' })
										: formatMessage({ id: 'app.news.follow', defaultMessage: 'Подписаться' })
								}}
							</button>
						</div>
						<p v-if="post.title" class="nr-post__title">{{ post.title }}</p>
						<p v-if="postText(post)" class="nr-post__text">{{ postText(post) }}</p>
						<div
							v-if="postImages(post).length"
							class="nr-post__media"
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
						<div class="nr-post__footer">
							<button type="button" class="nr-act" @click.stop="react(post)">
								<HeartIcon />
								<span class="nr-act__count">{{ reactionCount(post) || '' }}</span>
							</button>
							<button type="button" class="nr-act" @click.stop="toggleComments(post)">
								{{ formatMessage({ id: 'app.news.comments', defaultMessage: 'Комментарии' }) }}
								<span class="nr-act__count">{{
									post.commentCount ?? post.commentsCount ?? ''
								}}</span>
							</button>
							<span class="nr-post__spacer" />
							<span v-if="post.views" class="nr-post__views">
								{{ formatMessage(VIEWS_LABEL, { count: post.views }) }}
							</span>
						</div>
						<div v-if="openComments === post.id" class="nr-comments" @click.stop>
							<div v-if="commentsLoading" class="nr-comments__state">
								{{
									formatMessage({
										id: 'app.news.commentsLoading',
										defaultMessage: 'Загружаем комментарии…',
									})
								}}
							</div>
							<template v-else>
								<div v-for="comment in comments" :key="comment.id" class="nr-comment">
									<button
										type="button"
										class="nr-comment__author"
										:disabled="comment.author?.id == null"
										:aria-label="openProfileLabel"
										@click="openProfile(comment.author)"
									>
										{{ authorName(comment.author) }}
									</button>
									<p>{{ comment.body || comment.bodyMd }}</p>
								</div>
								<p v-if="!comments.length" class="nr-comments__empty">
									{{
										formatMessage({
											id: 'app.news.noComments',
											defaultMessage: 'Пока тихо — будьте первым.',
										})
									}}
								</p>
								<div v-if="session" class="nr-comment__form">
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

				<p v-if="!loading && !visiblePosts.length" class="nr-empty">
					{{
						tab === 'following'
							? formatMessage({
									id: 'app.news.followingEmpty',
									defaultMessage: 'В подписках пока пусто. Нажмите «Подписаться» у автора.',
								})
							: search.trim()
								? formatMessage({ id: 'app.news.searchEmpty', defaultMessage: 'Ничего не нашли.' })
								: formatMessage({ id: 'app.news.feedEmpty', defaultMessage: 'Пока тихо.' })
					}}
				</p>
			</template>
		</div>

		<aside class="nr-rail" aria-label="Обзор ленты">
			<section class="nr-card">
				<h3>{{ formatMessage({ id: 'app.news.popular', defaultMessage: 'Популярное' }) }}</h3>
				<button
					v-for="(post, index) in popularPosts"
					:key="post.id"
					type="button"
					class="nr-pop"
					@click="toggleComments(post)"
				>
					<span class="nr-pop__n">{{ index + 1 }}</span>
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
						class="nr-pop__ava"
						alt=""
					/>
					<span v-else class="nr-pop__ava nr-pop__ava--stub" />
					<span class="nr-pop__text">
						<span class="nr-pop__title">{{ postText(post).slice(0, 64) || post.title }}</span>
						<span class="nr-pop__meta">
							{{ authorName(postAuthor(post)) }} ·
							{{
								formatMessage(VIEWS_LABEL, {
									count: post.views || reactionCount(post),
								})
							}}
						</span>
					</span>
				</button>
				<p v-if="!popularPosts.length" class="nr-card__empty">
					{{
						formatMessage({ id: 'app.news.railEmpty', defaultMessage: 'Лента ещё наполняется.' })
					}}
				</p>
			</section>

			<section v-if="feedTags.length" class="nr-card">
				<h3>{{ formatMessage({ id: 'app.news.tags', defaultMessage: 'Хэштеги' }) }}</h3>
				<div class="nr-tags">
					<button
						v-for="tag in feedTags"
						:key="tag"
						type="button"
						:class="{ 'is-on': search.trim().toLowerCase() === tag }"
						@click="search = search.trim().toLowerCase() === tag ? '' : tag"
					>
						{{ tag }}
					</button>
				</div>
			</section>

			<section v-if="session && suggestions.length" class="nr-card">
				<h3>{{ formatMessage({ id: 'app.news.suggestions', defaultMessage: 'Кого читать' }) }}</h3>
				<div v-for="user in suggestions.slice(0, 6)" :key="String(user.id)" class="nr-who">
					<span class="nr-who__ava nr-who__ava--stub">{{
						String(user.username || user.name || '?')
							.slice(0, 1)
							.toUpperCase()
					}}</span>
					<span class="nr-who__text">
						<span class="nr-who__name">{{ user.username || user.name }}</span>
						<span class="nr-who__meta">
							{{ formatMessage({ id: 'app.news.whoMeta', defaultMessage: 'Игрок Undefined' }) }}
						</span>
					</span>
					<button type="button" class="nr-who__btn" @click="toggleFollow(user)">
						{{
							formatMessage({
								id: 'app.news.followShort',
								defaultMessage: 'Читать',
							})
						}}
					</button>
				</div>
			</section>

			<section class="nr-card nr-card--note">
				{{
					formatMessage({
						id: 'app.news.railNote',
						defaultMessage: 'Лента общая с Undefined Client — посты видны всем.',
					})
				}}
			</section>
		</aside>

		<UserProfileModal ref="profileModal" />
	</div>
</template>

<style scoped>
.nr-page {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 280px;
	gap: 16px;
	align-items: start;
	width: min(1080px, 100%);
	margin: 0 auto;
	padding: 16px 18px 24px;
	flex: none;
	align-self: center;
	min-height: 100%;
	box-sizing: border-box;
}

/* ===== Главная колонна ===== */

.nr-main {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
}

.nr-tabs {
	display: grid;
	grid-template-columns: 1fr 1fr 1fr;
	height: 40px;
	flex-shrink: 0;
	margin: 0 0 12px;
	padding: 4px;
	box-sizing: border-box;
	border: 1px solid #303030;
	border-radius: 12px;
	background: #272727;
	gap: 0;
}

.nr-tabs__btn {
	position: relative;
	height: 32px;
	margin: 0;
	padding: 0 8px;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: var(--color-text-inactive, rgba(255, 255, 255, 0.45));
	font-size: 15px;
	font-weight: 400;
	line-height: 19px;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.nr-tabs__btn.is-active {
	color: var(--color-contrast, #fff);
	background: #3c3c3c;
}

.nr-tabs__btn.is-active::after {
	content: '';
	position: absolute;
	left: 50%;
	bottom: 0;
	width: 40px;
	height: 2px;
	margin-left: -20px;
	border-radius: 1px;
	background: var(--color-contrast, #fff);
}

/* ===== Поиск ===== */

.nr-search {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 38px;
	margin: 0 0 12px;
	padding: 0 12px;
	box-sizing: border-box;
	background: var(--color-bg, #1f1f1f);
	border: none;
	border-radius: 10px;
	color: var(--color-text-inactive, rgba(255, 255, 255, 0.45));
}

.nr-search:focus-within {
	outline: 2px solid var(--color-brand);
	outline-offset: -2px;
}

.nr-search svg {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
}

.nr-search input {
	flex: 1;
	min-width: 0;
	height: 100%;
	border: none;
	background: transparent;
	color: var(--color-text, #fff);
	font: inherit;
	font-size: 14px;
	outline: none;
}

.nr-search input::placeholder {
	color: var(--color-text-inactive, rgba(255, 255, 255, 0.4));
}

.nr-search__spin {
	width: 16px;
	height: 16px;
	border: 2px solid var(--color-brand);
	border-top-color: transparent;
	border-radius: 50%;
	animation: nr-spin 0.8s linear infinite;
}

/* ===== Кнопка обновления ===== */

.nr-tools {
	display: flex;
	justify-content: flex-end;
	margin: -4px 0 8px;
}

.nr-refresh {
	width: 32px;
	height: 32px;
	display: grid;
	place-items: center;
	border: none;
	border-radius: 10px;
	background: #272727;
	border: 1px solid #303030;
	color: var(--color-text, #fff);
	cursor: pointer;
	transition: transform 0.25s ease;
}

.nr-refresh:hover {
	transform: rotate(90deg);
}

.nr-refresh.is-busy {
	pointer-events: none;
}

.nr-spinner {
	width: 14px;
	height: 14px;
	border: 2px solid var(--color-brand);
	border-top-color: transparent;
	border-radius: 50%;
	animation: nr-spin 0.8s linear infinite;
}

@keyframes nr-spin {
	to {
		transform: rotate(360deg);
	}
}

/* ===== Строка создания поста ===== */

.nr-compose {
	display: flex;
	flex-direction: column;
	flex-shrink: 0;
	margin: 0 0 12px;
	padding: 9px;
	border: 1px solid #383838;
	border-radius: 12px;
	background: #282828;
	box-sizing: border-box;
	min-height: 58px;
}

.nr-compose__row {
	display: flex;
	align-items: center;
	gap: 9px;
}

.nr-compose__avatar {
	width: 40px;
	height: 40px;
	border: 0;
	border-radius: 4px;
	object-fit: cover;
	background: #363636;
	image-rendering: pixelated;
	flex-shrink: 0;
	overflow: hidden;
}

.nr-compose__avatar--stub {
	display: inline-block;
}

.nr-compose__field {
	position: relative;
	display: flex;
	align-items: center;
	flex: 1;
	min-width: 0;
	min-height: 40px;
}

.nr-compose textarea {
	display: block;
	width: 100%;
	height: 40px;
	min-height: 40px;
	max-height: 140px;
	padding: 10px 44px 10px 12px;
	border: none;
	border-radius: 8px;
	resize: none;
	background: #1f1f1f;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 15px;
	line-height: 20px;
	outline: none;
	box-sizing: border-box;
	vertical-align: top;
}

.nr-compose textarea::placeholder {
	color: rgba(255, 255, 255, 0.38);
}

.nr-compose__plus {
	position: absolute;
	top: 0;
	right: 0;
	width: 40px;
	height: 40px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--color-text, #fff);
	cursor: pointer;
}

.nr-compose__plus:hover {
	color: var(--color-contrast, #fff);
}

.nr-compose__publish {
	width: 32px;
	height: 32px;
	padding: 0;
	border: none;
	border-radius: 16px;
	background: var(--color-brand, #1bd96a);
	color: var(--color-contrast, #fff);
	cursor: pointer;
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	transition: transform 0.15s ease;
}

.nr-compose__publish:hover:not(:disabled) {
	transform: scale(1.06);
}

.nr-compose__publish:disabled {
	opacity: 0.55;
	cursor: default;
}

.nr-compose__previews {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin: 8px 0 0 49px;
}

.nr-compose__preview {
	position: relative;
	width: 72px;
	height: 72px;
}

.nr-compose__preview img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	border-radius: 8px;
}

.nr-compose__preview button {
	position: absolute;
	top: -6px;
	right: -6px;
	width: 20px;
	height: 20px;
	display: grid;
	place-items: center;
	border: none;
	border-radius: 50%;
	background: #3c3c3c;
	color: #fff;
	cursor: pointer;
}

.nr-compose__notice {
	margin: 8px 0 0 49px;
	color: var(--color-orange, #faa81a);
	font-size: 13px;
}

/* ===== Карточка поста ===== */

.nr-feed {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 0 0 16px;
}

.nr-post {
	position: relative;
	background: #282828;
	border: 1px solid #383838;
	border-radius: 12px;
	padding: 0;
	flex-shrink: 0;
	cursor: pointer;
	overflow: visible;
}

.nr-post--article {
	display: flex;
	flex-direction: column;
	gap: 0;
}

.nr-post--article .nr-post__body {
	padding: 12px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.nr-post__cover {
	width: 100%;
	max-height: 260px;
	object-fit: cover;
	border-radius: 12px 12px 0 0;
}

.nr-post__head {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 12px 12px 0;
	box-sizing: border-box;
}

.nr-post__avatar {
	width: 32px;
	height: 32px;
	border: 0;
	border-radius: 4px;
	object-fit: cover;
	background: #363636;
	display: block;
	image-rendering: pixelated;
	flex-shrink: 0;
}

.nr-post__avatar--stub {
	display: inline-block;
}

.nr-post__who {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	min-width: 0;
	flex: 1;
}

.nr-post__name-row {
	display: flex;
	align-items: baseline;
	gap: 8px;
	min-width: 0;
	max-width: 100%;
	flex-wrap: wrap;
}

.nr-post__name {
	border: none;
	padding: 0;
	background: transparent;
	color: var(--color-contrast, #fff);
	font-size: 15px;
	font-weight: 500;
	line-height: 19px;
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.nr-post__name:disabled {
	cursor: default;
}

.nr-post__verified {
	color: var(--color-brand, #1bd96a);
	font-size: 13px;
}

.nr-post__time {
	font-size: 13px;
	line-height: 17px;
	color: rgba(255, 255, 255, 0.35);
	white-space: nowrap;
}

.nr-follow {
	height: 26px;
	padding: 0 10px;
	border: 1px solid #4c4c4c;
	border-radius: 6px;
	background: transparent;
	color: var(--color-text, #fff);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
	flex-shrink: 0;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.nr-follow:hover {
	background: rgba(255, 255, 255, 0.06);
}

.nr-follow.is-on {
	background: #3c3c3c;
	border-color: #3c3c3c;
	color: rgba(255, 255, 255, 0.6);
}

.nr-post__title {
	margin: 10px 12px 0;
	color: var(--color-contrast, #fff);
	font-size: 16px;
	font-weight: 600;
	line-height: 1.35;
}

.nr-post__text {
	margin: 8px 12px 0;
	color: var(--color-text, rgba(255, 255, 255, 0.85));
	font-size: 14px;
	line-height: 1.45;
	white-space: pre-wrap;
	overflow-wrap: break-word;
}

.nr-post__media {
	display: grid;
	grid-template-columns: 1fr;
	gap: 4px;
	margin: 10px 12px 0;
	border-radius: 8px;
	overflow: hidden;
}

.nr-post__media.is-many {
	grid-template-columns: 1fr 1fr;
}

.nr-post__media img {
	width: 100%;
	max-height: 420px;
	object-fit: cover;
	display: block;
	background: #1f1f1f;
}

.nr-post__footer {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 8px 8px 8px;
	margin: 6px 0 0;
}

.nr-act {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 30px;
	padding: 0 10px;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: rgba(255, 255, 255, 0.55);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
	transition:
		background-color 0.12s ease,
		color 0.12s ease;
}

.nr-act:hover {
	background: rgba(255, 255, 255, 0.05);
	color: #fff;
}

.nr-act__count {
	color: inherit;
}

.nr-post__spacer {
	flex: 1;
}

.nr-post__views {
	color: rgba(255, 255, 255, 0.35);
	font-size: 12px;
	padding: 0 8px 0 0;
}

.nr-post__meta {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.nr-source {
	padding: 2px 8px;
	border-radius: 9999px;
	font-size: 11px;
	font-weight: 600;
	background: rgba(255, 255, 255, 0.08);
	color: rgba(255, 255, 255, 0.7);
}

.nr-source[data-source='portalrinth'] {
	background: rgba(27, 217, 106, 0.15);
	color: #1bd96a;
}

.nr-source[data-source='noctrinth'] {
	background: rgba(91, 142, 212, 0.15);
	color: #5b8ed4;
}

/* ===== Комментарии ===== */

.nr-comments {
	margin: 4px 12px 12px;
	padding: 10px;
	border: 1px solid #333;
	border-radius: 10px;
	background: #222;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.nr-comments__state,
.nr-comments__empty {
	color: rgba(255, 255, 255, 0.4);
	font-size: 13px;
}

.nr-comment {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.nr-comment__author {
	align-self: flex-start;
	border: none;
	padding: 0;
	background: transparent;
	color: var(--color-brand, #1bd96a);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.nr-comment__author:disabled {
	cursor: default;
}

.nr-comment p {
	margin: 0;
	color: var(--color-text, rgba(255, 255, 255, 0.85));
	font-size: 13px;
	line-height: 1.4;
}

.nr-comment__form {
	display: flex;
	gap: 8px;
	margin-top: 4px;
}

.nr-comment__form input {
	flex: 1;
	height: 34px;
	padding: 0 12px;
	border: none;
	border-radius: 8px;
	background: #1a1a1a;
	color: var(--color-text, #fff);
	font: inherit;
	font-size: 13px;
	outline: none;
}

.nr-comment__form input:focus {
	box-shadow: 0 0 0 2px var(--color-brand);
}

/* ===== Заглушки ===== */

.nr-gate {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	gap: 0.5rem;
	padding: 2.5rem 2rem;
	background: #282828;
	border: 1px solid #383838;
	border-radius: 12px;
	color: var(--color-text-inactive, rgba(255, 255, 255, 0.5));
}

.nr-gate svg {
	width: 2rem;
	height: 2rem;
	color: var(--color-brand);
}

.nr-gate b {
	color: var(--color-contrast, #fff);
	font-size: 1rem;
}

.nr-gate p {
	margin: 0;
	font-size: 0.85rem;
	max-width: 34rem;
}

.nr-empty {
	padding: 1.5rem 1rem;
	text-align: center;
	color: var(--color-text-inactive, rgba(255, 255, 255, 0.45));
	font-size: 14px;
}

.nr-empty--error {
	color: var(--color-red, #ed4245);
}

/* ===== Правая колонка ===== */

.nr-rail {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 0;
	width: 280px;
	position: sticky;
	top: 0;
	max-height: calc(100vh - 32px);
	overflow-y: auto;
	padding-bottom: 4px;
}

.nr-card {
	flex-shrink: 0;
	padding: 12px;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.03);
}

.nr-card h3 {
	margin: 0 0 10px;
	color: var(--color-contrast, #fff);
	font-size: 14px;
	font-weight: 600;
}

.nr-card--note {
	color: rgba(255, 255, 255, 0.45);
	font-size: 12px;
}

.nr-card__empty {
	margin: 0;
	color: rgba(255, 255, 255, 0.38);
	font-size: 13px;
}

.nr-pop {
	display: grid;
	grid-template-columns: 18px 28px minmax(0, 1fr);
	gap: 8px;
	align-items: center;
	width: 100%;
	margin: 0;
	padding: 6px 4px;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
}

.nr-pop:hover {
	background: rgba(255, 255, 255, 0.04);
}

.nr-pop__n {
	color: rgba(255, 255, 255, 0.4);
	font-size: 13px;
}

.nr-pop__ava {
	width: 28px;
	height: 28px;
	border: 0;
	border-radius: 3px;
	object-fit: cover;
	background: #2a2a2a;
	image-rendering: pixelated;
}

.nr-pop__ava--stub {
	display: inline-block;
}

.nr-pop__text {
	min-width: 0;
}

.nr-pop__title {
	display: block;
	color: var(--color-contrast, #fff);
	font-size: 13px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.nr-pop__meta {
	display: block;
	margin-top: 1px;
	color: rgba(255, 255, 255, 0.4);
	font-size: 11px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.nr-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 8px;
}

.nr-tags button {
	margin: 0;
	padding: 0;
	border: none;
	background: transparent;
	color: var(--color-brand, #1bd96a);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}

.nr-tags button:hover,
.nr-tags button.is-on {
	text-decoration: underline;
}

.nr-who {
	display: grid;
	grid-template-columns: 32px minmax(0, 1fr) auto;
	gap: 8px;
	align-items: center;
	margin-bottom: 8px;
}

.nr-who:last-child {
	margin-bottom: 0;
}

.nr-who__ava {
	width: 32px;
	height: 32px;
	display: grid;
	place-items: center;
	border-radius: 3px;
	background: #2a2a2a;
	color: rgba(255, 255, 255, 0.55);
	font-size: 14px;
	font-weight: 600;
	object-fit: cover;
	image-rendering: pixelated;
}

.nr-who__text {
	min-width: 0;
}

.nr-who__name {
	display: block;
	color: var(--color-contrast, #fff);
	font-size: 13px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.nr-who__meta {
	display: block;
	color: rgba(255, 255, 255, 0.42);
	font-size: 11px;
}

.nr-who__btn {
	height: 26px;
	padding: 0 10px;
	border: 1px solid var(--color-brand, #1bd96a);
	border-radius: 4px;
	background: transparent;
	color: var(--color-brand, #1bd96a);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}

.nr-who__btn:hover {
	background: rgba(27, 217, 106, 0.12);
}

/* ===== Анимации ===== */

.nr-post-enter-active,
.nr-post-leave-active {
	transition:
		transform 0.25s ease,
		opacity 0.25s ease;
}

.nr-post-enter-from {
	transform: translateY(-6px);
	opacity: 0;
}

.nr-post-leave-to {
	opacity: 0;
}

@media (max-width: 900px) {
	.nr-page {
		grid-template-columns: 1fr;
	}

	.nr-rail {
		position: static;
		width: auto;
		max-height: none;
	}
}
</style>
