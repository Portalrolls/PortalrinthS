<script setup lang="ts">
import {
	BookmarkIcon,
	CalendarIcon,
	ExternalIcon,
	EyeIcon,
	FlameIcon,
	HashIcon,
	LogInIcon,
	NewspaperIcon,
	RefreshCwIcon,
	SearchIcon,
	UserIcon,
	XIcon,
} from '@modrinth/assets'
import {
	Button,
	ConfirmModal,
	defineMessages,
	injectNotificationManager,
	useVIntl,
} from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import UserProfileModal from '@/components/ui/messenger/UserProfileModal.vue'
import {
	authorOf,
	type AuthorView,
	claimView,
	type FeedPost,
	type FeedUser,
	hashtagsOf,
	likeCount,
	likeEmojiFor,
	normalizeReactions,
	popularityScore,
	releaseView,
	type ReportReason,
	STUDIO_AVATAR,
	STUDIO_NAME,
	toggledReactions,
	toMs,
	useBookmarks,
	useNewsText,
	userAvatar,
} from '@/components/ui/news/feed'
import NewsArticleModal from '@/components/ui/news/NewsArticleModal.vue'
import NewsAvatar from '@/components/ui/news/NewsAvatar.vue'
import NewsComposer from '@/components/ui/news/NewsComposer.vue'
import NewsLightbox from '@/components/ui/news/NewsLightbox.vue'
import NewsPostCard from '@/components/ui/news/NewsPostCard.vue'
import NewsPostModal from '@/components/ui/news/NewsPostModal.vue'
import NewsRepostModal from '@/components/ui/news/NewsRepostModal.vue'
import {
	fetchOfficialNews,
	officialCover,
	officialDate,
	type OfficialNews,
} from '@/components/ui/news/official-news'
import { injectMinecraftAccounts } from '@/features/minecraft-accounts/context'
import { useNoctrinthNews, usePortalrinthNews } from '@/features/news/portalrinth-news'
import {
	ensureServiceSession,
	onServiceAccountChange,
	readAccountState,
	serviceRequest,
	type ServiceUser,
} from '@/helpers/uprojects-service'
import { useRootBreadcrumb } from '@/shared/breadcrumbs'

defineOptions({ name: 'NewsPage' })

type Tab = 'feed' | 'following' | 'articles' | 'bookmarks'
type Range = '7d' | '30d' | 'all'
type ArticleSource = 'undefined' | 'portalrinth' | 'noctrinth'
type Gate = 'loading' | 'ready' | 'offline' | 'none' | 'error'

const { formatMessage } = useVIntl()
const { t, longDate, locale } = useNewsText()
const { addNotification } = injectNotificationManager()
const accounts = injectMinecraftAccounts()
const router = useRouter()
const { bookmarks, toggle: toggleBookmark, has: isBookmarked } = useBookmarks()

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

const gate = ref<Gate>('loading')
const gateError = ref('')
const me = ref<ServiceUser | null>(null)
const posts = ref<FeedPost[]>([])
const extraPosts = ref<FeedPost[]>([])
const suggestions = ref<FeedUser[]>([])
const followingIds = ref<string[]>([])
const postingBanned = ref(false)
const loading = ref(true)
const refreshing = ref(false)
const loadError = ref('')

const tab = ref<Tab>('feed')
const search = ref('')
const tagFilter = ref('')
const range = ref<Range>('7d')
const articleSource = ref<ArticleSource>('undefined')

const official = ref<OfficialNews[]>([])
const officialLoading = ref(false)
const officialError = ref('')
const officialLoaded = ref(false)
const portalrinthNews = usePortalrinthNews()
const noctrinthNews = useNoctrinthNews()

const activePostId = ref('')
const pendingDelete = ref<FeedPost | null>(null)
const followBusy = ref<string[]>([])
const freshId = ref('')

const profileModal = ref<InstanceType<typeof UserProfileModal> | null>(null)
const postModal = ref<InstanceType<typeof NewsPostModal> | null>(null)
const repostModal = ref<InstanceType<typeof NewsRepostModal> | null>(null)
const articleModal = ref<InstanceType<typeof NewsArticleModal> | null>(null)
const deleteModal = ref<InstanceType<typeof ConfirmModal> | null>(null)

const signedIn = computed(() => gate.value === 'ready' && Boolean(me.value))
const myId = computed(() => (me.value?.id != null ? String(me.value.id) : ''))
const myAvatar = computed(() => userAvatar(me.value as Partial<FeedUser> | null))

const tabs = computed(() => [
	{ id: 'feed' as const, label: t('app.news.tabFeed', 'Рекомендации') },
	{ id: 'following' as const, label: t('app.news.tabFollowing', 'Подписки') },
	{ id: 'articles' as const, label: t('app.news.tabArticles', 'Статьи') },
	{ id: 'bookmarks' as const, label: t('app.news.tabBookmarks', 'Закладки') },
])
const tabIndex = computed(() => tabs.value.findIndex((entry) => entry.id === tab.value))

const allPosts = computed(() => {
	const seen = new Set(posts.value.map((post) => post.id))
	return [...posts.value, ...extraPosts.value.filter((post) => !seen.has(post.id))]
})

function postById(id: string): FeedPost | null {
	return allPosts.value.find((post) => post.id === id) ?? null
}

const activePost = computed(() => (activePostId.value ? postById(activePostId.value) : null))

function matches(post: FeedPost): boolean {
	const author = authorOf(post).name.toLowerCase()
	const body =
		`${post.title || ''} ${post.bodyMd || ''} ${post.repostOf?.bodyMd || ''}`.toLowerCase()
	if (tagFilter.value && !hashtagsOf(body).includes(tagFilter.value)) return false
	const needle = search.value.trim().toLowerCase()
	if (!needle) return true
	return body.includes(needle) || author.includes(needle)
}

const visiblePosts = computed(() => {
	let list: FeedPost[]
	if (tab.value === 'following') {
		const set = new Set(followingIds.value)
		list = posts.value.filter((post) => {
			const author = authorOf(post)
			return author.userId && (set.has(author.userId) || author.userId === myId.value)
		})
	} else if (tab.value === 'bookmarks') {
		list = bookmarks.value
			.map((id) => postById(id))
			.filter((post): post is FeedPost => Boolean(post))
			.reverse()
	} else {
		list = posts.value
	}
	return list.filter(matches)
})

const failedBookmarks = ref<string[]>([])
const missingBookmarks = computed(
	() => bookmarks.value.filter((id) => !postById(id) && !failedBookmarks.value.includes(id)).length,
)

const popular = computed(() => {
	const days = range.value === '7d' ? 7 : range.value === '30d' ? 30 : 0
	const since = days ? Date.now() - days * 86400000 : 0
	return posts.value
		.filter((post) => toMs(post.createdAt) >= since)
		.map((post) => ({ post, score: popularityScore(post) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
		.map((entry) => entry.post)
})

const hashtags = computed(() => {
	const counts = new Map<string, number>()
	for (const post of posts.value) {
		for (const tag of new Set(hashtagsOf(post.bodyMd))) counts.set(tag, (counts.get(tag) || 0) + 1)
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12)
		.map(([tag]) => tag)
})

const whoToRead = computed(() =>
	suggestions.value.filter((user) => String(user.id) !== myId.value).slice(0, 6),
)

type ArticleCard = {
	id: string
	title: string
	summary: string
	cover: string
	date: string
	views?: number
	author: string
	official?: OfficialNews
	link?: string
}

const articleCards = computed<ArticleCard[]>(() => {
	let list: ArticleCard[]
	if (articleSource.value === 'undefined') {
		list = official.value.map((item) => ({
			id: item.id,
			title: item.title,
			summary: item.summary || '',
			cover: officialCover(item),
			date: officialDate(item),
			views: item.views,
			author: item.author || STUDIO_NAME,
			official: item,
		}))
	} else {
		const source =
			articleSource.value === 'portalrinth' ? portalrinthNews.value : noctrinthNews.value
		list = source.map((item) => ({
			id: item.path,
			title: item.title || item.path,
			summary: item.summary || '',
			cover: item.thumbnail || '',
			date: item.date || '',
			author: articleSource.value === 'portalrinth' ? 'Portalrinth' : 'Noctrinth',
			link: item.path,
		}))
	}
	const needle = search.value.trim().toLowerCase()
	return needle
		? list.filter((item) => `${item.title} ${item.summary}`.toLowerCase().includes(needle))
		: list
})

function normalizePost(raw: FeedPost): FeedPost {
	const post = { ...raw, reactions: normalizeReactions(raw.reactions) }
	if (post.repostOf)
		post.repostOf = { ...post.repostOf, reactions: normalizeReactions(post.repostOf.reactions) }
	return post
}

function notify(type: 'success' | 'error' | 'info', title: string, text = '') {
	addNotification({ type, title, text })
}

async function loadFeed(force = false) {
	loadError.value = ''
	const state = await readAccountState()
	if (state.kind !== 'ready') {
		gate.value = state.kind
		me.value = null
		posts.value = []
		loading.value = false
		return
	}
	const session = await ensureServiceSession(force)
	if (!session) {
		gate.value = 'error'
		gateError.value = t(
			'app.news.sessionFailed',
			'Не удалось войти в сервис Undefined. Проверь интернет и попробуй ещё раз.',
		)
		loading.value = false
		return
	}
	gate.value = 'ready'
	me.value = session.user
	const response = await serviceRequest('/social/feed', {
		query: { channel: 'community', limit: 40 },
	})
	loading.value = false
	if (!response.ok) {
		loadError.value = response.error || t('app.news.feedFailed', 'Не удалось загрузить ленту')
		return
	}
	posts.value = (Array.isArray(response.data?.posts) ? response.data.posts : []).map(normalizePost)
	suggestions.value = Array.isArray(response.data?.suggestions) ? response.data.suggestions : []
	followingIds.value = Array.isArray(response.data?.followingIds)
		? response.data.followingIds.map(String)
		: []
	postingBanned.value = Boolean(response.data?.postingBanned)
	if (tab.value === 'bookmarks') void loadMissingBookmarks()
}

async function refresh() {
	if (refreshing.value) return
	refreshing.value = true
	if (tab.value === 'articles') await loadOfficial(true)
	else await loadFeed()
	refreshing.value = false
}

async function loadOfficial(force = false) {
	if (officialLoading.value || (officialLoaded.value && !force)) return
	officialLoading.value = true
	officialError.value = ''
	try {
		official.value = await fetchOfficialNews(locale.value)
		officialLoaded.value = true
	} catch (error) {
		officialError.value = error instanceof Error ? error.message : 'network'
	} finally {
		officialLoading.value = false
	}
}

async function loadMissingBookmarks() {
	if (!signedIn.value) return
	const missing = bookmarks.value
		.filter((id) => !postById(id) && !failedBookmarks.value.includes(id))
		.slice(0, 30)
	const found = await Promise.all(
		missing.map(async (id) => {
			const response = await serviceRequest(`/social/posts/${encodeURIComponent(id)}`)
			const post = (response.data?.post || response.data) as FeedPost | undefined
			if (!response.ok || !post?.id) {
				failedBookmarks.value = [...failedBookmarks.value, id]
				return null
			}
			return normalizePost(post)
		}),
	)
	extraPosts.value = [
		...extraPosts.value,
		...found.filter((post): post is FeedPost => Boolean(post)),
	]
}

function setTab(next: Tab) {
	tab.value = next
	if (next === 'articles') void loadOfficial()
	if (next === 'bookmarks') void loadMissingBookmarks()
}

function filterTag(tag: string) {
	tagFilter.value = tag.toLowerCase()
	if (tab.value === 'articles') tab.value = 'feed'
	postModal.value?.hide()
	window.scrollTo({ top: 0, behavior: 'smooth' })
}

function patchPost(id: string, patch: (post: FeedPost) => FeedPost) {
	const apply = (list: FeedPost[]) =>
		list.map((post) => {
			let next = post.id === id ? patch(post) : post
			if (next.repostOf?.id === id) next = { ...next, repostOf: patch(next.repostOf) }
			return next
		})
	posts.value = apply(posts.value)
	extraPosts.value = apply(extraPosts.value)
}

async function like(post: FeedPost) {
	if (!signedIn.value) return
	const emoji = likeEmojiFor(post)
	const before = post.reactions
	patchPost(post.id, (item) => ({ ...item, reactions: toggledReactions(item, emoji) }))
	const response = await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/react`, {
		method: 'POST',
		body: { emoji },
	})
	if (!response.ok) {
		patchPost(post.id, (item) => ({ ...item, reactions: before }))
		notify('error', t('app.news.likeFailed', 'Не удалось поставить лайк'), response.error || '')
		return
	}
	if (response.data?.reactions) {
		patchPost(post.id, (item) => ({
			...item,
			reactions: normalizeReactions(response.data.reactions),
		}))
	}
}

async function noteView(post: FeedPost) {
	if (!signedIn.value || !claimView(post.id)) return
	const response = await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/view`, {
		method: 'POST',
	})
	const views = Number(response.data?.views)
	if (response.ok && Number.isFinite(views)) patchPost(post.id, (item) => ({ ...item, views }))
	else releaseView(post.id)
}

function openPost(post: FeedPost, focusComposer = false) {
	if (!postById(post.id)) extraPosts.value = [...extraPosts.value, normalizePost(post)]
	activePostId.value = post.id
	void nextTick(() => postModal.value?.show(post, focusComposer))
}

function bookmark(post: FeedPost) {
	const on = toggleBookmark(post.id)
	if (on && !postById(post.id)) extraPosts.value = [...extraPosts.value, post]
	notify(
		'info',
		on
			? t('app.news.bookmarked', 'Пост добавлен в закладки')
			: t('app.news.unbookmarked', 'Пост убран из закладок'),
	)
}

async function report(post: FeedPost, reason: ReportReason) {
	const response = await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}/report`, {
		method: 'POST',
		body: { reason },
	})
	if (!response.ok) {
		notify('error', t('app.news.reportFailed', 'Не удалось отправить жалобу'), response.error || '')
		return
	}
	patchPost(post.id, (item) => ({ ...item, reported: true }))
	notify(
		'success',
		t('app.news.reportSent', 'Жалоба отправлена'),
		t('app.news.reportThanks', 'Модераторы посмотрят пост.'),
	)
}

function askDelete(post: FeedPost) {
	pendingDelete.value = post
	deleteModal.value?.show()
}

async function confirmDelete() {
	const post = pendingDelete.value
	pendingDelete.value = null
	if (!post) return
	const response = await serviceRequest(`/social/posts/${encodeURIComponent(post.id)}`, {
		method: 'DELETE',
	})
	if (!response.ok) {
		notify('error', t('app.news.deleteFailed', 'Не удалось удалить пост'), response.error || '')
		return
	}
	if (activePostId.value === post.id) postModal.value?.hide()
	posts.value = posts.value.filter((item) => item.id !== post.id)
	extraPosts.value = extraPosts.value.filter((item) => item.id !== post.id)
	notify('success', t('app.news.deleted', 'Пост удалён'))
}

async function copy(text: string, kind: 'text' | 'link') {
	try {
		await navigator.clipboard.writeText(text)
		notify(
			'success',
			kind === 'link'
				? t('app.news.linkCopied', 'Ссылка скопирована')
				: t('app.news.textCopied', 'Текст скопирован'),
		)
	} catch {
		notify('error', t('app.news.copyFailed', 'Не удалось скопировать'))
	}
}

async function toggleFollow(userId: string) {
	if (!userId || followBusy.value.includes(userId)) return
	const on = followingIds.value.includes(userId)
	followBusy.value = [...followBusy.value, userId]
	followingIds.value = on
		? followingIds.value.filter((id) => id !== userId)
		: [...followingIds.value, userId]
	const response = await serviceRequest(`/social/users/${encodeURIComponent(userId)}/follow`, {
		method: on ? 'DELETE' : 'POST',
	})
	followBusy.value = followBusy.value.filter((id) => id !== userId)
	if (!response.ok) {
		followingIds.value = on
			? [...followingIds.value, userId]
			: followingIds.value.filter((id) => id !== userId)
		notify(
			'error',
			t('app.news.followFailed', 'Не удалось изменить подписку'),
			response.error || '',
		)
		return
	}
	suggestions.value = suggestions.value.map((user) =>
		String(user.id) === userId
			? { ...user, followerCount: Math.max(0, Number(user.followerCount || 0) + (on ? -1 : 1)) }
			: user,
	)
}

function openProfile(author: AuthorView | FeedUser) {
	const user = 'kind' in author ? author.user : author
	const id = 'kind' in author ? author.userId : String(author.id)
	if (!id) return
	profileModal.value?.show(
		{ id, username: user?.username, uuid: user?.uuid ?? undefined },
		{ canWrite: id !== myId.value, self: id === myId.value },
	)
}

async function openMention(username: string) {
	if (!signedIn.value) return
	const response = await serviceRequest('/social/users/lookup', { query: { username } })
	const user = response.data?.user as FeedUser | undefined
	if (!response.ok || !user?.id) {
		notify('error', t('app.news.userNotFound', 'Игрок {name} не найден', { name: username }))
		return
	}
	openProfile({ ...user, id: String(user.id) })
}

function writeTo(user: { id: string; username?: string }) {
	void router.push({ path: '/messenger', query: { user: user.id, username: user.username || '' } })
}

function onPosted(post: FeedPost | null) {
	notify('success', t('app.news.published', 'Пост опубликован'))
	if (post?.id) {
		posts.value = [normalizePost(post), ...posts.value.filter((item) => item.id !== post.id)]
		freshId.value = post.id
		if (tab.value !== 'feed' && tab.value !== 'following') tab.value = 'feed'
	} else {
		void loadFeed()
	}
}

function onBanned() {
	postingBanned.value = true
	notify(
		'error',
		t('app.news.postingBanned', 'Публикация постов и комментариев для тебя ограничена.'),
	)
}

function onReposted(message: string, wall: boolean) {
	notify('success', message)
	if (wall) void loadFeed()
	else if (repostTarget.value)
		patchPost(repostTarget.value, (item) => ({ ...item, repostCount: (item.repostCount || 0) + 1 }))
}

const repostTarget = ref('')
function repost(post: FeedPost) {
	repostTarget.value = post.id
	repostModal.value?.show(post)
}

function openArticle(card: ArticleCard) {
	if (card.official) articleModal.value?.show(card.official)
	else if (card.link) void openUrl(card.link)
}

function onArticleViewed(id: string, views: number) {
	official.value = official.value.map((item) => (item.id === id ? { ...item, views } : item))
}

function signInMicrosoft() {
	void accounts.value?.login()
}

function signInEly() {
	accounts.value?.showElyLogin()
}

function plural(n: number, one: string, few: string, many: string): string {
	const mod10 = n % 10
	const mod100 = n % 100
	if (mod10 === 1 && mod100 !== 11) return one
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
	return many
}

function likesLabel(n: number): string {
	return locale.value.startsWith('ru')
		? t('app.news.likesCount', '{n} {word}', { n, word: plural(n, 'лайк', 'лайка', 'лайков') })
		: t('app.news.likesCountEn', '{n} likes', { n })
}

function followersLabel(n: number): string {
	return locale.value.startsWith('ru')
		? t('app.news.followersCount', '{n} {word}', {
				n,
				word: plural(n, 'подписчик', 'подписчика', 'подписчиков'),
			})
		: t('app.news.followersCountEn', '{n} followers', { n })
}

function popularTitle(post: FeedPost): string {
	const line = String(post.title || post.bodyMd || post.repostOf?.bodyMd || '')
		.split('\n')
		.find((entry) => entry.trim())
	return line?.replace(/[#*_`>]/g, '').trim() || t('app.news.photoPost', 'Пост с фото')
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
	void loadFeed()
	unsubscribe = onServiceAccountChange(() => {
		loading.value = true
		posts.value = []
		extraPosts.value = []
		void loadFeed(true)
	})
})

onBeforeUnmount(() => unsubscribe?.())

onActivated(() => breadcrumb.reset())

watch(locale, () => {
	if (officialLoaded.value) void loadOfficial(true)
})
</script>

<template>
	<div class="nf-page">
		<main class="nf-main">
			<div
				class="nf-tabs"
				role="tablist"
				:style="{ '--nf-tab': tabIndex, '--nf-tabs': tabs.length }"
			>
				<span class="nf-tabs__ink" />
				<button
					v-for="entry in tabs"
					:key="entry.id"
					type="button"
					role="tab"
					class="nf-tabs__tab"
					:class="{ 'is-active': tab === entry.id }"
					:aria-selected="tab === entry.id"
					@click="setTab(entry.id)"
				>
					{{ entry.label }}
					<span v-if="entry.id === 'bookmarks' && bookmarks.length" class="nf-tabs__badge">
						{{ bookmarks.length }}
					</span>
				</button>
			</div>

			<div class="nf-toolbar">
				<label class="nf-search">
					<SearchIcon />
					<input
						v-model="search"
						type="search"
						:placeholder="
							tab === 'articles'
								? t('app.news.searchArticles', 'Поиск по статьям…')
								: t('app.news.search', 'Поиск в ленте…')
						"
					/>
					<button
						v-if="search"
						type="button"
						class="nf-search__clear"
						:aria-label="t('app.news.clearSearch', 'Очистить поиск')"
						@click="search = ''"
					>
						<XIcon />
					</button>
				</label>
				<button
					type="button"
					class="nf-icon-btn"
					:class="{ 'is-spinning': refreshing }"
					:aria-label="t('app.news.refresh', 'Обновить')"
					:title="t('app.news.refresh', 'Обновить')"
					@click="refresh"
				>
					<RefreshCwIcon />
				</button>
			</div>

			<Transition name="nf-tab" mode="out-in">
				<section v-if="tab === 'articles'" key="articles" class="nf-stack">
					<div class="nf-chips">
						<button
							v-for="source in [
								{ id: 'undefined' as const, label: 'Undefined' },
								{ id: 'portalrinth' as const, label: 'Portalrinth' },
								{ id: 'noctrinth' as const, label: 'Noctrinth' },
							]"
							:key="source.id"
							type="button"
							class="nf-chip"
							:class="{ 'is-active': articleSource === source.id }"
							@click="articleSource = source.id"
						>
							{{ source.label }}
						</button>
					</div>

					<template v-if="articleSource === 'undefined' && officialLoading && !official.length">
						<div v-for="n in 3" :key="n" class="nf-art-card is-skeleton">
							<span class="nf-sk nf-sk--cover" />
							<span class="nf-sk-lines">
								<span class="nf-sk" style="width: 60%; height: 14px" />
								<span class="nf-sk" style="width: 90%" />
								<span class="nf-sk" style="width: 40%" />
							</span>
						</div>
					</template>
					<div v-else-if="articleSource === 'undefined' && officialError" class="nf-empty">
						<p>{{ t('app.news.articlesFailed', 'Не удалось загрузить статьи Undefined') }}</p>
						<Button @click="loadOfficial(true)">
							<RefreshCwIcon />
							{{ t('app.news.retry', 'Повторить') }}
						</Button>
					</div>
					<div v-else-if="!articleCards.length" class="nf-empty">
						<NewspaperIcon />
						<p>
							{{
								search
									? t('app.news.nothingFound', 'Ничего не нашлось')
									: t('app.news.noArticles', 'Статей пока нет')
							}}
						</p>
					</div>
					<TransitionGroup v-else tag="div" name="nf-list" class="nf-stack" appear>
						<button
							v-for="(card, index) in articleCards"
							:key="card.id"
							type="button"
							class="nf-art-card"
							:style="{ '--nf-delay': `${Math.min(index, 8) * 45}ms` }"
							@click="openArticle(card)"
						>
							<span class="nf-art-card__cover">
								<img v-if="card.cover" :src="card.cover" alt="" loading="lazy" />
								<NewspaperIcon v-else />
							</span>
							<span class="nf-art-card__body">
								<span class="nf-art-card__title">{{ card.title }}</span>
								<span v-if="card.summary" class="nf-art-card__summary">{{ card.summary }}</span>
								<span class="nf-art-card__meta">
									<NewsAvatar
										v-if="card.official"
										:source="{ direct: STUDIO_AVATAR }"
										:size="16"
										round
									/>
									{{ card.author }}
									<template v-if="card.date">
										<CalendarIcon />
										{{ longDate(card.date) }}
									</template>
									<template v-if="card.official">
										<EyeIcon />
										{{ card.views || 0 }}
									</template>
									<ExternalIcon v-if="card.link" />
								</span>
							</span>
						</button>
					</TransitionGroup>
				</section>

				<section v-else-if="gate === 'offline' || gate === 'none'" key="gate" class="nf-gate">
					<span class="nf-gate__icon"><LogInIcon /></span>
					<h2>{{ t('app.news.gateTitle', 'Лента доступна с аккаунтом Microsoft или Ely.by') }}</h2>
					<p v-if="gate === 'offline'">
						{{
							t(
								'app.news.gateOffline',
								'Сейчас выбран офлайн-аккаунт. У него нет подтверждённой личности, поэтому публиковать, лайкать и читать ленту сообщества с ним нельзя.',
							)
						}}
					</p>
					<p v-else>
						{{
							t(
								'app.news.gateNone',
								'Войди через Microsoft или Ely.by — лента, комментарии и подписки привязаны к игровому аккаунту.',
							)
						}}
					</p>
					<p class="nf-gate__hint">
						{{
							t(
								'app.news.gateArticles',
								'Статьи Undefined, Portalrinth и Noctrinth читаются и без аккаунта.',
							)
						}}
					</p>
					<div class="nf-gate__actions">
						<Button type="colored" color="brand" :disabled="!accounts" @click="signInMicrosoft">
							<LogInIcon />
							{{ t('app.news.signInMicrosoft', 'Войти через Microsoft') }}
						</Button>
						<Button :disabled="!accounts" @click="signInEly">
							<UserIcon />
							{{ t('app.news.signInEly', 'Войти через Ely.by') }}
						</Button>
						<Button type="quiet" @click="setTab('articles')">
							<NewspaperIcon />
							{{ t('app.news.toArticles', 'К статьям') }}
						</Button>
					</div>
				</section>

				<section v-else-if="gate === 'error'" key="error" class="nf-gate">
					<h2>{{ t('app.news.sessionTitle', 'Сервис ленты недоступен') }}</h2>
					<p>{{ gateError }}</p>
					<div class="nf-gate__actions">
						<Button type="colored" color="brand" @click="loadFeed(true)">
							<RefreshCwIcon />
							{{ t('app.news.retry', 'Повторить') }}
						</Button>
					</div>
				</section>

				<section v-else :key="tab" class="nf-stack">
					<NewsComposer
						v-if="tab === 'feed' && signedIn"
						:avatar="myAvatar"
						:posting-banned="postingBanned"
						@posted="onPosted"
						@banned="onBanned"
						@failed="(message) => notify('error', message)"
					/>

					<Transition name="nf-fade">
						<div v-if="tagFilter" class="nf-filter">
							<HashIcon />
							{{ t('app.news.tagFilter', 'Посты с тегом') }}
							<b>{{ tagFilter }}</b>
							<button
								type="button"
								:aria-label="t('app.news.clearTag', 'Сбросить тег')"
								@click="tagFilter = ''"
							>
								<XIcon />
							</button>
						</div>
					</Transition>

					<template v-if="loading || gate === 'loading'">
						<div v-for="n in 3" :key="n" class="nf-skeleton">
							<div class="nf-skeleton__head">
								<span class="nf-sk nf-sk--avatar" />
								<span class="nf-sk-lines">
									<span class="nf-sk" style="width: 28%" />
									<span class="nf-sk" style="width: 18%" />
								</span>
							</div>
							<span class="nf-sk" style="width: 80%" />
							<span class="nf-sk nf-sk--media" />
						</div>
					</template>
					<div v-else-if="loadError" class="nf-empty">
						<p>{{ loadError }}</p>
						<Button @click="loadFeed()">
							<RefreshCwIcon />
							{{ t('app.news.retry', 'Повторить') }}
						</Button>
					</div>
					<div v-else-if="!visiblePosts.length" class="nf-empty">
						<BookmarkIcon v-if="tab === 'bookmarks'" />
						<UserIcon v-else-if="tab === 'following'" />
						<NewspaperIcon v-else />
						<p v-if="search || tagFilter">{{ t('app.news.nothingFound', 'Ничего не нашлось') }}</p>
						<p v-else-if="tab === 'bookmarks'">
							{{
								missingBookmarks
									? t('app.news.loading', 'Загрузка…')
									: t(
											'app.news.noBookmarks',
											'Закладок пока нет — нажми на значок закладки под постом, чтобы сохранить его.',
										)
							}}
						</p>
						<p v-else-if="tab === 'following'">
							{{
								t(
									'app.news.noFollowing',
									'Здесь появятся посты тех, на кого ты подписан. Начни с блока «Кого читать».',
								)
							}}
						</p>
						<p v-else>{{ t('app.news.noPosts', 'В ленте пока пусто — напиши первый пост.') }}</p>
					</div>
					<TransitionGroup v-else tag="div" name="nf-list" class="nf-stack">
						<NewsPostCard
							v-for="(post, index) in visiblePosts"
							:key="post.id"
							:class="{ 'is-fresh': post.id === freshId }"
							:post="post"
							:index="index"
							:signed-in="signedIn"
							:following="followingIds.includes(authorOf(post).userId)"
							:bookmarked="isBookmarked(post.id)"
							@open="openPost"
							@like="like"
							@repost="repost"
							@follow="toggleFollow"
							@bookmark="bookmark"
							@delete="askDelete"
							@report="report"
							@copy="copy"
							@profile="openProfile"
							@tag="filterTag"
							@mention="openMention"
							@seen="noteView"
						/>
					</TransitionGroup>
				</section>
			</Transition>
		</main>

		<aside class="nf-rail">
			<section v-if="signedIn" class="nf-rail__card">
				<header class="nf-rail__head">
					<FlameIcon />
					<span>{{ t('app.news.popular', 'Популярное') }}</span>
					<div class="nf-range">
						<button
							v-for="option in [
								{ id: '7d' as const, label: t('app.news.range7', '7Д') },
								{ id: '30d' as const, label: t('app.news.range30', '30Д') },
								{ id: 'all' as const, label: t('app.news.rangeAll', 'Всё') },
							]"
							:key="option.id"
							type="button"
							:class="{ 'is-active': range === option.id }"
							@click="range = option.id"
						>
							{{ option.label }}
						</button>
					</div>
				</header>
				<TransitionGroup v-if="popular.length" tag="ol" name="nf-list" class="nf-popular">
					<li v-for="(post, index) in popular" :key="post.id">
						<button type="button" class="nf-popular__item" @click="openPost(post)">
							<span class="nf-popular__rank">{{ index + 1 }}</span>
							<NewsAvatar :source="authorOf(post).avatar" :size="24" />
							<span class="nf-popular__text">
								<b>{{ popularTitle(post) }}</b>
								<span>{{ authorOf(post).name }} · {{ likesLabel(likeCount(post)) }}</span>
							</span>
						</button>
					</li>
				</TransitionGroup>
				<p v-else class="nf-rail__empty">
					{{ t('app.news.popularEmpty', 'За этот период популярных постов нет') }}
				</p>
			</section>

			<section v-if="signedIn && hashtags.length" class="nf-rail__card">
				<header class="nf-rail__head">
					<HashIcon />
					<span>{{ t('app.news.hashtags', 'Популярные хештеги') }}</span>
				</header>
				<div class="nf-tags">
					<button
						v-for="tag in hashtags"
						:key="tag"
						type="button"
						class="nf-tags__tag"
						:class="{ 'is-active': tagFilter === tag }"
						@click="tagFilter === tag ? (tagFilter = '') : filterTag(tag)"
					>
						{{ tag }}
					</button>
				</div>
			</section>

			<section v-if="signedIn && whoToRead.length" class="nf-rail__card">
				<header class="nf-rail__head">
					<UserIcon />
					<span>{{ t('app.news.whoToRead', 'Кого читать') }}</span>
				</header>
				<ul class="nf-who">
					<li v-for="user in whoToRead" :key="user.id">
						<button type="button" class="nf-who__user" @click="openProfile(user)">
							<NewsAvatar :source="userAvatar(user)" :size="28" />
							<span>
								<b>{{ user.username }}</b>
								<small>{{ followersLabel(Number(user.followerCount || 0)) }}</small>
							</span>
						</button>
						<button
							type="button"
							class="nf-who__follow"
							:class="{ 'is-on': followingIds.includes(String(user.id)) }"
							:disabled="followBusy.includes(String(user.id))"
							@click="toggleFollow(String(user.id))"
						>
							{{
								followingIds.includes(String(user.id))
									? t('app.news.unfollow', 'Отписаться')
									: t('app.news.read', 'Читать')
							}}
						</button>
					</li>
				</ul>
			</section>

			<section v-if="!signedIn" class="nf-rail__card">
				<header class="nf-rail__head">
					<NewspaperIcon />
					<span>{{ t('app.news.aboutTitle', 'Новости Undefined') }}</span>
				</header>
				<p class="nf-rail__empty is-left">
					{{
						t(
							'app.news.aboutText',
							'Официальные статьи студии и сообщество игроков: посты, лайки, комментарии и репосты в чаты MC Messenger.',
						)
					}}
				</p>
			</section>
		</aside>

		<NewsPostModal
			ref="postModal"
			:post="activePost"
			:signed-in="signedIn"
			:following="activePost ? followingIds.includes(authorOf(activePost).userId) : false"
			:bookmarked="activePost ? isBookmarked(activePost.id) : false"
			:posting-banned="postingBanned"
			@like="like"
			@repost="repost"
			@follow="toggleFollow"
			@bookmark="bookmark"
			@delete="askDelete"
			@report="report"
			@copy="copy"
			@profile="openProfile"
			@tag="filterTag"
			@mention="openMention"
			@open="openPost"
			@seen="noteView"
			@comments="(id, count) => patchPost(id, (item) => ({ ...item, commentCount: count }))"
			@banned="onBanned"
			@failed="(message) => notify('error', message)"
		/>
		<NewsRepostModal
			ref="repostModal"
			@done="onReposted"
			@banned="onBanned"
			@failed="(message) => notify('error', message)"
		/>
		<NewsArticleModal
			ref="articleModal"
			@viewed="onArticleViewed"
			@copied="notify('success', t('app.news.linkCopied', 'Ссылка скопирована'))"
		/>
		<ConfirmModal
			ref="deleteModal"
			:title="t('app.news.deleteTitle', 'Удалить пост?')"
			:description="
				t(
					'app.news.deleteText',
					'Пост, комментарии и реакции к нему исчезнут без возможности восстановления.',
				)
			"
			:proceed-label="t('app.news.delete', 'Удалить')"
			:markdown="false"
			@proceed="confirmDelete"
		/>
		<UserProfileModal ref="profileModal" @write="writeTo" />
		<NewsLightbox />
	</div>
</template>

<style scoped>
.nf-page {
	display: grid;
	grid-template-columns: minmax(0, 620px) 240px;
	justify-content: center;
	align-items: start;
	gap: 14px;
	padding: 12px 16px 32px;
}

.nf-main {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
	padding: 6px;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 18px;
	background: rgba(20, 20, 24, 0.55);
	backdrop-filter: blur(18px) saturate(1.2);
}

.nf-stack {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.nf-tabs {
	position: relative;
	display: grid;
	grid-template-columns: repeat(var(--nf-tabs), 1fr);
	padding: 4px;
	border-radius: 12px;
	background: rgba(30, 30, 35, 0.85);
}

.nf-tabs__ink {
	position: absolute;
	top: 4px;
	bottom: 4px;
	left: 4px;
	width: calc((100% - 8px) / var(--nf-tabs));
	border-radius: 9px;
	background: #34343b;
	box-shadow: inset 0 -2px 0 var(--color-brand);
	transform: translateX(calc(var(--nf-tab) * 100%));
	transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.nf-tabs__tab {
	position: relative;
	z-index: 1;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 32px;
	border: 0;
	background: none;
	color: rgba(255, 255, 255, 0.5);
	font: inherit;
	font-size: 13px;
	font-weight: 700;
	cursor: pointer;
	transition: color 0.2s ease;
}

.nf-tabs__tab:hover,
.nf-tabs__tab.is-active {
	color: #fff;
}

.nf-tabs__badge {
	min-width: 18px;
	padding: 0 5px;
	border-radius: 999px;
	background: var(--color-brand);
	color: #fff;
	font-size: 11px;
	line-height: 17px;
}

.nf-toolbar {
	display: flex;
	gap: 8px;
}

.nf-search {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 8px;
	padding: 0 10px;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 11px;
	background: rgba(30, 30, 35, 0.85);
	transition: border-color 0.18s ease;
}

.nf-search:focus-within {
	border-color: rgba(176, 0, 255, 0.45);
}

.nf-search > svg {
	width: 15px;
	height: 15px;
	color: rgba(255, 255, 255, 0.45);
}

.nf-search input {
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

.nf-search__clear,
.nf-filter button {
	display: grid;
	place-items: center;
	width: 20px;
	height: 20px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: rgba(255, 255, 255, 0.55);
	cursor: pointer;
}

.nf-search__clear:hover,
.nf-filter button:hover {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}

.nf-search__clear svg,
.nf-filter button svg {
	width: 12px;
	height: 12px;
}

.nf-icon-btn {
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 11px;
	background: rgba(30, 30, 35, 0.85);
	color: rgba(255, 255, 255, 0.65);
	cursor: pointer;
	transition:
		color 0.15s ease,
		background-color 0.15s ease;
}

.nf-icon-btn:hover {
	background: #2b2b31;
	color: #fff;
}

.nf-icon-btn svg {
	width: 16px;
	height: 16px;
}

.nf-icon-btn.is-spinning svg {
	animation: nf-spin 0.8s linear infinite;
}

.nf-filter {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 10px;
	border-radius: 11px;
	background: rgba(176, 0, 255, 0.12);
	color: rgba(255, 255, 255, 0.75);
	font-size: 13px;
}

.nf-filter > svg {
	width: 14px;
	height: 14px;
	color: var(--color-brand);
}

.nf-filter b {
	flex: 1;
	color: #e2b6ff;
}

.nf-chips {
	display: flex;
	gap: 6px;
}

.nf-chip {
	height: 28px;
	padding: 0 12px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 999px;
	background: rgba(30, 30, 35, 0.85);
	color: rgba(255, 255, 255, 0.65);
	font: inherit;
	font-size: 12.5px;
	font-weight: 600;
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		color 0.18s ease,
		border-color 0.18s ease;
}

.nf-chip:hover {
	color: #fff;
}

.nf-chip.is-active {
	border-color: transparent;
	background: var(--color-brand);
	color: #fff;
}

.nf-art-card {
	display: flex;
	gap: 12px;
	padding: 10px;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 14px;
	background: #1d1d21;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	animation: nf-card-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
	animation-delay: var(--nf-delay, 0ms);
	transition:
		border-color 0.2s ease,
		transform 0.2s ease;
}

.nf-art-card:not(.is-skeleton):hover {
	border-color: rgba(176, 0, 255, 0.3);
	transform: translateY(-1px);
}

.nf-art-card.is-skeleton {
	cursor: default;
}

.nf-art-card__cover {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 168px;
	height: 104px;
	overflow: hidden;
	border-radius: 10px;
	background: #141417;
	color: rgba(255, 255, 255, 0.25);
}

.nf-art-card__cover img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	transition: transform 0.4s ease;
}

.nf-art-card:hover .nf-art-card__cover img {
	transform: scale(1.05);
}

.nf-art-card__cover svg {
	width: 28px;
	height: 28px;
}

.nf-art-card__body {
	display: flex;
	flex-direction: column;
	gap: 5px;
	min-width: 0;
	padding: 2px 0;
}

.nf-art-card__title {
	color: var(--color-contrast, #fff);
	font-size: 15px;
	font-weight: 700;
	line-height: 1.3;
}

.nf-art-card__summary {
	display: -webkit-box;
	overflow: hidden;
	color: rgba(255, 255, 255, 0.6);
	font-size: 13px;
	line-height: 1.4;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
}

.nf-art-card__meta {
	display: flex;
	align-items: center;
	gap: 5px;
	flex-wrap: wrap;
	margin-top: auto;
	color: rgba(255, 255, 255, 0.42);
	font-size: 12px;
}

.nf-art-card__meta svg {
	width: 12px;
	height: 12px;
	margin-left: 6px;
}

.nf-gate {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	padding: 36px 24px;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 14px;
	background: #1d1d21;
	text-align: center;
}

.nf-gate__icon {
	display: grid;
	place-items: center;
	width: 52px;
	height: 52px;
	border-radius: 16px;
	background: rgba(176, 0, 255, 0.15);
	color: var(--color-brand);
}

.nf-gate__icon svg {
	width: 24px;
	height: 24px;
}

.nf-gate h2 {
	margin: 4px 0 0;
	color: var(--color-contrast, #fff);
	font-size: 18px;
}

.nf-gate p {
	max-width: 440px;
	margin: 0;
	color: rgba(255, 255, 255, 0.62);
	font-size: 14px;
	line-height: 1.5;
}

.nf-gate .nf-gate__hint {
	color: rgba(255, 255, 255, 0.42);
	font-size: 12.5px;
}

.nf-gate__actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 8px;
	margin-top: 8px;
}

.nf-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	padding: 40px 20px;
	border-radius: 14px;
	background: rgba(29, 29, 33, 0.7);
	color: rgba(255, 255, 255, 0.5);
	text-align: center;
}

.nf-empty > svg {
	width: 28px;
	height: 28px;
	color: rgba(255, 255, 255, 0.3);
}

.nf-empty p {
	max-width: 380px;
	margin: 0;
	font-size: 14px;
}

.nf-skeleton {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 14px;
	background: #1d1d21;
}

.nf-skeleton__head {
	display: flex;
	gap: 10px;
}

.nf-sk-lines {
	display: flex;
	flex-direction: column;
	gap: 7px;
	flex: 1;
	min-width: 0;
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
	width: 34px;
	height: 34px;
	border-radius: 9px;
}

.nf-sk--media {
	height: 220px;
	border-radius: 10px;
}

.nf-sk--cover {
	flex-shrink: 0;
	width: 168px;
	height: 104px;
	border-radius: 10px;
}

.nf-rail {
	position: sticky;
	top: 12px;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.nf-rail__card {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 14px;
	background: rgba(24, 24, 28, 0.6);
	backdrop-filter: blur(18px) saturate(1.2);
	animation: nf-card-in 0.4s ease both;
}

.nf-rail__head {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--color-contrast, #fff);
	font-size: 13px;
	font-weight: 700;
}

.nf-rail__head > svg {
	width: 14px;
	height: 14px;
}

.nf-rail__head > span {
	flex: 1;
}

.nf-rail__empty {
	margin: 0;
	padding: 6px 0;
	color: rgba(255, 255, 255, 0.42);
	font-size: 12px;
	text-align: center;
}

.nf-rail__empty.is-left {
	text-align: left;
	line-height: 1.5;
}

.nf-range {
	display: flex;
	gap: 2px;
}

.nf-range button {
	height: 20px;
	padding: 0 6px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: rgba(255, 255, 255, 0.45);
	font: inherit;
	font-size: 11px;
	font-weight: 700;
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		color 0.18s ease;
}

.nf-range button:hover {
	color: #fff;
}

.nf-range button.is-active {
	background: var(--color-brand);
	color: #fff;
}

.nf-popular {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.nf-popular__item {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 5px 4px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.nf-popular__item:hover {
	background: rgba(255, 255, 255, 0.05);
}

.nf-popular__rank {
	width: 14px;
	flex-shrink: 0;
	color: rgba(255, 255, 255, 0.4);
	font-size: 12px;
	font-weight: 700;
	text-align: center;
}

.nf-popular__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.nf-popular__text b,
.nf-popular__text span {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.nf-popular__text b {
	color: var(--color-contrast, #fff);
	font-size: 12px;
}

.nf-popular__text span {
	color: rgba(255, 255, 255, 0.42);
	font-size: 11px;
}

.nf-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 2px 8px;
}

.nf-tags__tag {
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-brand);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	transition: opacity 0.15s ease;
}

.nf-tags__tag:hover {
	opacity: 0.75;
}

.nf-tags__tag.is-active {
	text-decoration: underline;
	text-underline-offset: 3px;
}

.nf-who {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.nf-who li {
	display: flex;
	align-items: center;
	gap: 6px;
}

.nf-who__user {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 8px;
	min-width: 0;
	padding: 2px;
	border: 0;
	border-radius: 8px;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.nf-who__user > span {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.nf-who__user b {
	overflow: hidden;
	color: var(--color-contrast, #fff);
	font-size: 12.5px;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.nf-who__user:hover b {
	color: var(--color-brand);
}

.nf-who__user small {
	color: rgba(255, 255, 255, 0.42);
	font-size: 11px;
}

.nf-who__follow {
	flex-shrink: 0;
	height: 24px;
	padding: 0 9px;
	border: 1px solid var(--color-brand);
	border-radius: 6px;
	background: transparent;
	color: var(--color-brand);
	font: inherit;
	font-size: 11.5px;
	font-weight: 700;
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		color 0.18s ease,
		border-color 0.18s ease;
}

.nf-who__follow:hover {
	background: var(--color-brand);
	color: #fff;
}

.nf-who__follow.is-on {
	border-color: rgba(255, 255, 255, 0.14);
	color: rgba(255, 255, 255, 0.55);
}

.nf-who__follow.is-on:hover {
	border-color: var(--color-red);
	background: transparent;
	color: var(--color-red);
}

.nf-who__follow:disabled {
	opacity: 0.5;
	cursor: default;
}

.nf-stack :deep(.is-fresh) {
	animation: nf-fresh 1.6s ease;
}

.nf-tab-enter-active,
.nf-tab-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.nf-tab-enter-from {
	opacity: 0;
	transform: translateY(8px);
}

.nf-tab-leave-to {
	opacity: 0;
	transform: translateY(-4px);
}

.nf-list-move,
.nf-list-enter-active,
.nf-list-leave-active {
	transition:
		opacity 0.28s ease,
		transform 0.28s ease;
}

.nf-list-enter-from,
.nf-list-leave-to {
	opacity: 0;
	transform: translateY(8px);
}

.nf-list-leave-active {
	position: absolute;
	visibility: hidden;
}

.nf-fade-enter-active,
.nf-fade-leave-active {
	transition: opacity 0.18s ease;
}

.nf-fade-enter-from,
.nf-fade-leave-to {
	opacity: 0;
}

@keyframes nf-card-in {
	from {
		opacity: 0;
		transform: translateY(10px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@keyframes nf-shimmer {
	from {
		background-position: 200% 0;
	}
	to {
		background-position: -200% 0;
	}
}

@keyframes nf-spin {
	to {
		transform: rotate(360deg);
	}
}

@keyframes nf-fresh {
	0% {
		box-shadow: 0 0 0 2px var(--color-brand);
	}
	100% {
		box-shadow: 0 0 0 0 transparent;
	}
}

@media (max-width: 960px) {
	.nf-page {
		grid-template-columns: minmax(0, 1fr);
	}

	.nf-rail {
		position: static;
	}
}

@media (prefers-reduced-motion: reduce) {
	.nf-tabs__ink,
	.nf-tabs__tab,
	.nf-chip,
	.nf-art-card,
	.nf-art-card__cover img,
	.nf-range button,
	.nf-who__follow,
	.nf-tab-enter-active,
	.nf-tab-leave-active,
	.nf-list-move,
	.nf-list-enter-active,
	.nf-list-leave-active,
	.nf-fade-enter-active,
	.nf-fade-leave-active {
		transition: none;
	}

	.nf-art-card,
	.nf-rail__card,
	.nf-sk,
	.nf-icon-btn.is-spinning svg,
	.nf-stack :deep(.is-fresh) {
		animation: none;
	}
}
</style>
