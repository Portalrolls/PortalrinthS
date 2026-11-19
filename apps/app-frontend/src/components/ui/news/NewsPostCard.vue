<script setup lang="ts">
import {
	BookmarkIcon,
	CopyIcon,
	EyeIcon,
	HeartIcon,
	ImageIcon,
	MessageIcon,
	MoreHorizontalIcon,
	NewspaperIcon,
	RepeatIcon,
	ReportIcon,
	TrashIcon,
} from '@modrinth/assets'
import { type ButtonMenuOption, TeleportOverflowMenu } from '@modrinth/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
	authorOf,
	type AuthorView,
	type FeedPost,
	likeCount,
	likedMine,
	type ReportReason,
	useNewsText,
} from './feed'
import { openLightbox } from './lightbox'
import NewsAvatar from './NewsAvatar.vue'
import NewsCarousel from './NewsCarousel.vue'
import NewsRichText from './NewsRichText.vue'

const props = withDefaults(
	defineProps<{
		post: FeedPost
		signedIn: boolean
		following: boolean
		bookmarked: boolean
		index?: number
		detached?: boolean
	}>(),
	{ index: 0, detached: false },
)

const emit = defineEmits<{
	open: [post: FeedPost]
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
	seen: [post: FeedPost]
}>()

const { t, postDate, timeAgo } = useNewsText()

const author = computed(() => authorOf(props.post))
const quote = computed(() => props.post.repostOf ?? null)
const quoteAuthor = computed(() => (quote.value ? authorOf(quote.value) : null))
const likes = computed(() => likeCount(props.post))
const liked = computed(() => likedMine(props.post))
const text = computed(() => String(props.post.bodyMd || '').trim())
const long = computed(
	() => !props.detached && (text.value.length > 420 || text.value.split('\n').length > 9),
)
const expanded = ref(false)
const popping = ref(false)

const canFollow = computed(
	() =>
		props.signedIn &&
		author.value.kind === 'user' &&
		Boolean(author.value.userId) &&
		Boolean(props.post.canReport),
)

function like() {
	if (!liked.value) {
		popping.value = false
		requestAnimationFrame(() => (popping.value = true))
	}
	emit('like', props.post)
}

function open(event: MouseEvent) {
	if (props.detached) return
	if (window.getSelection()?.toString()) return
	if ((event.target as HTMLElement | null)?.closest('button, a, video, input, textarea')) return
	emit('open', props.post)
}

function openProfile(view: AuthorView | null) {
	if (view?.kind === 'user' && view.userId) emit('profile', view)
}

const menuOptions = computed<ButtonMenuOption[]>(() => {
	const firstMedia = props.post.attachments?.find((item) => item.url)
	return [
		{
			id: 'open',
			label: t('app.news.openPost', 'Открыть пост'),
			icon: NewspaperIcon,
			action: () => emit('open', props.post),
		},
		{
			id: 'bookmark',
			label: props.bookmarked
				? t('app.news.bookmarkRemove', 'Убрать из закладок')
				: t('app.news.bookmarkAdd', 'В закладки'),
			icon: BookmarkIcon,
			action: () => emit('bookmark', props.post),
		},
		{
			id: 'copy-text',
			label: t('app.news.copyText', 'Копировать текст'),
			icon: CopyIcon,
			shown: Boolean(text.value),
			action: () => emit('copy', text.value, 'text'),
		},
		{
			id: 'copy-media',
			label: t('app.news.copyMediaLink', 'Копировать ссылку на фото'),
			icon: ImageIcon,
			shown: Boolean(firstMedia),
			action: () => emit('copy', firstMedia?.url ?? '', 'link'),
		},
		{ type: 'divider', shown: Boolean(props.post.canDelete) },
		{
			id: 'delete',
			label: t('app.news.deletePost', 'Удалить пост'),
			icon: TrashIcon,
			tone: 'red',
			shown: Boolean(props.post.canDelete),
			action: () => emit('delete', props.post),
		},
	]
})

const reportOptions = computed<ButtonMenuOption[]>(() =>
	props.post.reported
		? [
				{
					id: 'reported',
					label: t('app.news.reportSent', 'Жалоба отправлена'),
					disabled: true,
					action: () => {},
				},
			]
		: [
				{ type: 'heading', label: t('app.news.reportReason', 'Причина жалобы') },
				{
					id: 'spam',
					label: t('app.news.reportSpam', 'Спам'),
					action: () => emit('report', props.post, 'spam'),
				},
				{
					id: 'abuse',
					label: t('app.news.reportAbuse', 'Оскорбления'),
					action: () => emit('report', props.post, 'abuse'),
				},
				{
					id: 'other',
					label: t('app.news.reportOther', 'Другое'),
					action: () => emit('report', props.post, 'other'),
				},
			],
)

const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
	if (!root.value) return
	if (typeof IntersectionObserver === 'undefined') {
		emit('seen', props.post)
		return
	}
	observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return
			emit('seen', props.post)
			observer?.disconnect()
			observer = null
		},
		{ threshold: 0.35 },
	)
	observer.observe(root.value)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
	<article
		ref="root"
		class="nf-post"
		:class="{ 'is-pinned': post.pinned, 'is-detached': detached }"
		:style="{ '--nf-delay': `${Math.min(index, 8) * 45}ms` }"
		@click="open"
	>
		<header class="nf-post__head">
			<button
				type="button"
				class="nf-post__who"
				:class="{ 'is-static': author.kind !== 'user' || !author.userId }"
				:aria-label="t('app.news.openProfile', 'Открыть профиль')"
				@click.stop="openProfile(author)"
			>
				<NewsAvatar :source="author.avatar" :size="34" />
				<span class="nf-post__id">
					<span class="nf-post__name">
						{{ author.name }}
						<span
							v-if="author.verified"
							class="nf-verified"
							:title="t('app.news.verified', 'Подтверждённый аккаунт')"
							>✓</span
						>
					</span>
					<span class="nf-post__time">
						{{ postDate(post.createdAt) }}
						<template v-if="post.repostOf"> · {{ t('app.news.repostMark', 'репост') }}</template>
						<template v-if="post.pinned"> · {{ t('app.news.pinned', 'закреплено') }}</template>
					</span>
				</span>
			</button>
			<button
				v-if="canFollow"
				type="button"
				class="nf-follow"
				:class="{ 'is-on': following }"
				@click.stop="emit('follow', author.userId)"
			>
				{{ following ? t('app.news.unfollow', 'Отписаться') : t('app.news.follow', 'Подписаться') }}
			</button>
			<TeleportOverflowMenu
				type="quiet"
				size="sm"
				:label="t('app.news.postMenu', 'Действия с постом')"
				:options="menuOptions"
				@click.stop
			>
				<MoreHorizontalIcon aria-hidden="true" />
			</TeleportOverflowMenu>
		</header>

		<p v-if="post.title" class="nf-post__title">{{ post.title }}</p>
		<div v-if="text" class="nf-post__body" :class="{ 'is-clamped': long && !expanded }">
			<NewsRichText
				:text="text"
				@tag="emit('tag', $event)"
				@mention="emit('mention', $event)"
				@image="(url) => openLightbox([{ url, video: false }])"
			/>
		</div>
		<button v-if="long" type="button" class="nf-post__more" @click.stop="expanded = !expanded">
			{{
				expanded ? t('app.news.showLess', 'Свернуть') : t('app.news.showMore', 'Показать полностью')
			}}
		</button>

		<div v-if="quote && quoteAuthor" class="nf-quote" @click.stop="emit('open', quote)">
			<div class="nf-quote__head">
				<button
					type="button"
					class="nf-quote__who"
					:class="{ 'is-static': quoteAuthor.kind !== 'user' || !quoteAuthor.userId }"
					@click.stop="openProfile(quoteAuthor)"
				>
					<NewsAvatar :source="quoteAuthor.avatar" :size="22" />
					<b>{{ quoteAuthor.name }}</b>
				</button>
				<span class="nf-post__time">{{ timeAgo(quote.createdAt) }}</span>
			</div>
			<div v-if="quote.bodyMd" class="nf-quote__body">
				<NewsRichText
					:text="quote.bodyMd"
					@tag="emit('tag', $event)"
					@mention="emit('mention', $event)"
					@image="(url) => openLightbox([{ url, video: false }])"
				/>
			</div>
			<NewsCarousel v-if="quote.attachments?.length" :items="quote.attachments.slice(0, 1)" />
		</div>

		<NewsCarousel
			v-if="post.attachments?.length"
			class="nf-post__media"
			:items="post.attachments"
		/>

		<footer class="nf-post__foot">
			<button
				type="button"
				class="nf-act nf-act--like"
				:class="{ 'is-on': liked, 'is-pop': popping }"
				:disabled="!signedIn"
				:aria-pressed="liked"
				:aria-label="t('app.news.like', 'Нравится')"
				@click.stop="like"
				@animationend="popping = false"
			>
				<span class="nf-heart">
					<HeartIcon />
					<i v-for="n in 6" :key="n" class="nf-heart__spark" :style="{ '--n': n }" />
				</span>
				<span class="nf-act__count">{{ likes }}</span>
			</button>
			<button
				type="button"
				class="nf-act"
				:aria-label="t('app.news.comments', 'Комментарии')"
				@click.stop="emit('open', post)"
			>
				<MessageIcon />
				<span class="nf-act__count">{{ post.commentCount || 0 }}</span>
			</button>
			<button
				type="button"
				class="nf-act"
				:disabled="!signedIn"
				:aria-label="t('app.news.repost', 'Репост')"
				@click.stop="emit('repost', post)"
			>
				<RepeatIcon />
				<span class="nf-act__count">{{ post.repostCount || 0 }}</span>
			</button>
			<span class="nf-act nf-act--views" :title="t('app.news.viewsTitle', 'Просмотры')">
				<EyeIcon />
				<span class="nf-act__count">{{ post.views || 0 }}</span>
			</span>
			<span class="nf-post__gap" />
			<TeleportOverflowMenu
				v-if="post.canReport && signedIn"
				type="quiet"
				size="sm"
				:class="{ 'nf-reported': post.reported }"
				:label="t('app.news.report', 'Пожаловаться')"
				:tooltip="t('app.news.report', 'Пожаловаться')"
				:options="reportOptions"
				@click.stop
			>
				<ReportIcon aria-hidden="true" />
			</TeleportOverflowMenu>
			<button
				type="button"
				class="nf-act nf-act--icon"
				:class="{ 'is-saved': bookmarked }"
				:aria-pressed="bookmarked"
				:aria-label="
					bookmarked
						? t('app.news.bookmarkRemove', 'Убрать из закладок')
						: t('app.news.bookmarkAdd', 'В закладки')
				"
				@click.stop="emit('bookmark', post)"
			>
				<BookmarkIcon />
			</button>
		</footer>
	</article>
</template>

<style scoped>
.nf-post {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 14px;
	background: #1d1d21;
	box-shadow: 0 6px 22px rgba(0, 0, 0, 0.22);
	cursor: pointer;
	animation: nf-card-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
	animation-delay: var(--nf-delay, 0ms);
	transition:
		border-color 0.2s ease,
		box-shadow 0.2s ease;
}

.nf-post:not(.is-detached):hover {
	border-color: rgba(176, 0, 255, 0.28);
	box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
}

.nf-post.is-detached {
	padding: 0;
	border: 0;
	background: transparent;
	box-shadow: none;
	cursor: default;
	animation: none;
}

.nf-post.is-pinned {
	border-color: rgba(176, 0, 255, 0.35);
}

.nf-post__head {
	display: flex;
	align-items: center;
	gap: 8px;
}

.nf-post__who,
.nf-quote__who {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	flex: 1;
	margin: 0;
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	text-align: left;
	cursor: pointer;
}

.nf-post__who.is-static,
.nf-quote__who.is-static {
	cursor: default;
}

.nf-post__id {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.nf-post__name {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	overflow: hidden;
	color: var(--color-contrast, #fff);
	font-size: 15px;
	font-weight: 600;
	line-height: 19px;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.nf-post__who:not(.is-static):hover .nf-post__name {
	color: var(--color-brand);
}

.nf-verified {
	display: inline-grid;
	place-items: center;
	width: 15px;
	height: 15px;
	border-radius: 50%;
	background: var(--color-brand);
	color: #fff;
	font-size: 10px;
	font-weight: 800;
}

.nf-post__time {
	color: rgba(255, 255, 255, 0.4);
	font-size: 12px;
	line-height: 16px;
	white-space: nowrap;
}

.nf-follow {
	flex-shrink: 0;
	height: 26px;
	padding: 0 10px;
	border: 0;
	border-radius: 7px;
	background: #2b2b31;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		color 0.18s ease;
}

.nf-follow:hover {
	background: #36363d;
}

.nf-follow.is-on {
	background: transparent;
	color: rgba(255, 255, 255, 0.5);
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.nf-post__title {
	margin: 0;
	color: var(--color-contrast, #fff);
	font-size: 16px;
	font-weight: 700;
	line-height: 1.35;
}

.nf-post__body {
	position: relative;
}

.nf-post__body.is-clamped {
	max-height: 13.5em;
	overflow: hidden;
	-webkit-mask-image: linear-gradient(#000 70%, transparent);
	mask-image: linear-gradient(#000 70%, transparent);
}

.nf-post__more {
	align-self: flex-start;
	margin: -4px 0 0;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-brand);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.nf-quote {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px;
	border-radius: 10px;
	border-left: 3px solid var(--color-brand);
	background: #17171a;
	transition: background-color 0.18s ease;
}

.nf-quote:hover {
	background: #1a1a1e;
}

.nf-quote__head {
	display: flex;
	align-items: center;
	gap: 8px;
}

.nf-quote__who b {
	overflow: hidden;
	color: var(--color-contrast, #fff);
	font-size: 13px;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.nf-quote__body {
	max-height: 7.5em;
	overflow: hidden;
	font-size: 13px;
}

.nf-post__foot {
	display: flex;
	align-items: center;
	gap: 4px;
	margin: 0 -4px -4px;
	padding-top: 8px;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.nf-post__gap {
	flex: 1;
}

.nf-act {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 30px;
	padding: 0 9px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: rgba(255, 255, 255, 0.62);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	transition:
		background-color 0.16s ease,
		color 0.16s ease,
		transform 0.16s ease;
}

.nf-act svg {
	width: 16px;
	height: 16px;
}

.nf-act:not(:disabled, .nf-act--views):hover {
	background: rgba(255, 255, 255, 0.06);
	color: #fff;
}

.nf-act:not(:disabled, .nf-act--views):active {
	transform: scale(0.94);
}

.nf-act:disabled {
	cursor: default;
	opacity: 0.6;
}

.nf-act--views {
	cursor: default;
	color: rgba(255, 255, 255, 0.4);
	font-weight: 500;
}

.nf-act--views svg {
	width: 14px;
	height: 14px;
}

.nf-act--icon {
	width: 30px;
	padding: 0;
	justify-content: center;
}

.nf-act--icon.is-saved {
	color: var(--color-brand);
}

.nf-act--icon.is-saved svg {
	fill: currentColor;
}

.nf-act__count {
	font-variant-numeric: tabular-nums;
}

.nf-act--like.is-on {
	background: rgba(237, 66, 101, 0.16);
	color: #ff4d6d;
}

.nf-act--like.is-on svg {
	fill: currentColor;
}

.nf-heart {
	position: relative;
	display: inline-grid;
	place-items: center;
}

.nf-act--like.is-pop .nf-heart svg {
	animation: nf-heart-pop 0.5s cubic-bezier(0.17, 0.89, 0.32, 1.49);
}

.nf-heart__spark {
	position: absolute;
	top: 50%;
	left: 50%;
	width: 4px;
	height: 4px;
	margin: -2px 0 0 -2px;
	border-radius: 50%;
	background: #ff4d6d;
	opacity: 0;
	pointer-events: none;
	transform: rotate(calc(var(--n) * 60deg)) translateY(0);
}

.nf-act--like.is-pop .nf-heart__spark {
	animation: nf-heart-spark 0.55s ease-out;
}

.nf-post :deep(.nf-reported) {
	opacity: 0.5;
}

@keyframes nf-card-in {
	from {
		opacity: 0;
		transform: translateY(10px) scale(0.99);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@keyframes nf-heart-pop {
	0% {
		transform: scale(1);
	}
	30% {
		transform: scale(0.72);
	}
	65% {
		transform: scale(1.32);
	}
	100% {
		transform: scale(1);
	}
}

@keyframes nf-heart-spark {
	0% {
		opacity: 1;
		transform: rotate(calc(var(--n) * 60deg)) translateY(0) scale(1);
	}
	100% {
		opacity: 0;
		transform: rotate(calc(var(--n) * 60deg)) translateY(-14px) scale(0.4);
	}
}

@media (prefers-reduced-motion: reduce) {
	.nf-post,
	.nf-act--like.is-pop .nf-heart svg,
	.nf-act--like.is-pop .nf-heart__spark {
		animation: none;
	}

	.nf-post,
	.nf-act,
	.nf-follow,
	.nf-quote {
		transition: none;
	}
}
</style>
