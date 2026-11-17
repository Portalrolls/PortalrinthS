import { useVIntl } from '@modrinth/ui'
import { renderString } from '@modrinth/utils'
import { ref } from 'vue'

import { resolveServiceMedia, UPROJECTS_BASE } from '@/helpers/uprojects-service'

export type FeedUser = {
	id: string
	username: string
	uuid?: string | null
	skinUrl?: string | null
	avatar?: string | null
	verified?: boolean
	provider?: string | null
	followerCount?: number
}

export type FeedAttachment = {
	id?: string
	url: string
	mime?: string
	type?: string
	kind?: string
}

export type FeedReactions = { counts: Record<string, number>; mine: string[] }

export type FeedPost = {
	id: string
	bodyMd: string
	title?: string | null
	createdAt: number | string
	pinned?: boolean
	canDelete?: boolean
	canReport?: boolean
	reported?: boolean
	attachments?: FeedAttachment[]
	reactions?: FeedReactions
	repostCount?: number
	commentCount?: number
	views?: number
	repostOf?: FeedPost | null
	author?: {
		type?: string
		user?: FeedUser
		clan?: { id: string; name: string; iconUrl?: string | null; verified?: boolean }
		name?: string
	}
}

export type FeedComment = {
	id: string
	bodyMd: string
	createdAt: number | string
	parentId?: string | null
	replyTo?: { id?: string; username?: string } | null
	canDelete?: boolean
	author?: Partial<FeedUser> | null
}

export type ReportReason = 'spam' | 'abuse' | 'other'

export type CommentNode = FeedComment & { children: CommentNode[] }

/** Откуда брать картинку автора: готовый адрес (клан, студия) или скин игрока. */
export type AvatarSource = {
	direct?: string
	skinUrl?: string | null
	uuid?: string | null
	username?: string | null
	avatar?: string | null
}

export type AuthorView = {
	kind: 'user' | 'clan' | 'launcher'
	name: string
	userId: string
	user?: FeedUser
	verified: boolean
	avatar: AvatarSource
}

export const STUDIO_NAME = 'Undefined Studio'
export const STUDIO_AVATAR =
	'https://uprojects.site/client/api/messenger/avatars/91c843c7-3252-49d2-93ab-70d314cffbe3.png'

export const LIKE_EMOJIS = ['❤️', '👍', '🔥']

export function authorOf(post: FeedPost): AuthorView {
	const author = post.author
	if (author?.type === 'clan' && author.clan) {
		return {
			kind: 'clan',
			name: author.clan.name || author.name || '',
			userId: '',
			verified: Boolean(author.clan.verified),
			avatar: { direct: resolveServiceMedia(author.clan.iconUrl), username: author.clan.name },
		}
	}
	if (author?.type === 'launcher') {
		return {
			kind: 'launcher',
			name: author.name || STUDIO_NAME,
			userId: '',
			verified: true,
			avatar: { direct: STUDIO_AVATAR },
		}
	}
	const user = author?.user
	return {
		kind: 'user',
		name: user?.username || 'Игрок',
		userId: user?.id ? String(user.id) : '',
		user,
		verified: Boolean(user?.verified),
		avatar: userAvatar(user),
	}
}

export function userAvatar(user?: Partial<FeedUser> | null): AvatarSource {
	return {
		skinUrl: user?.skinUrl ?? null,
		uuid: user?.uuid ?? null,
		username: user?.username ?? null,
		avatar: user?.avatar ?? null,
	}
}

export function toMs(value: number | string | undefined | null): number {
	if (typeof value === 'number') return value
	const text = String(value ?? '').trim()
	if (!text) return 0
	const asNumber = Number(text)
	if (Number.isFinite(asNumber)) return asNumber
	const parsed = Date.parse(text)
	return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeReactions(raw: unknown): FeedReactions {
	const value = (raw ?? {}) as Partial<FeedReactions>
	const counts: Record<string, number> = {}
	if (value.counts && typeof value.counts === 'object') {
		for (const [emoji, count] of Object.entries(value.counts)) counts[emoji] = Number(count) || 0
	}
	const mine = Array.isArray(value.mine) ? value.mine.map(String) : []
	return { counts, mine }
}

export function likeCount(post: FeedPost): number {
	const counts = post.reactions?.counts ?? {}
	return LIKE_EMOJIS.reduce((sum, emoji) => sum + (Number(counts[emoji]) || 0), 0)
}

export function likedMine(post: FeedPost): boolean {
	const mine = post.reactions?.mine ?? []
	return LIKE_EMOJIS.some((emoji) => mine.includes(emoji))
}

/** Какой эмодзи переключать: уже поставленный, иначе сердечко. */
export function likeEmojiFor(post: FeedPost): string {
	const mine = post.reactions?.mine ?? []
	return LIKE_EMOJIS.find((emoji) => mine.includes(emoji)) ?? '❤️'
}

/** Реакции после переключения эмодзи — для оптимистичного обновления. */
export function toggledReactions(post: FeedPost, emoji: string): FeedReactions {
	const current = normalizeReactions(post.reactions)
	const counts = { ...current.counts }
	const on = current.mine.includes(emoji)
	counts[emoji] = Math.max(0, (counts[emoji] || 0) + (on ? -1 : 1))
	const mine = on ? current.mine.filter((entry) => entry !== emoji) : [...current.mine, emoji]
	return { counts, mine }
}

export function popularityScore(post: FeedPost): number {
	return likeCount(post) * 3 + Number(post.commentCount || 0) * 2 + Number(post.views || 0) * 0.05
}

export function mediaIsVideo(attachment: FeedAttachment): boolean {
	const tag = String(attachment.mime || attachment.type || attachment.kind || '').toLowerCase()
	if (tag.startsWith('video/') || tag === 'video') return true
	return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(attachment.url || ''))
}

export function buildCommentTree(flat: FeedComment[]): CommentNode[] {
	const map = new Map<string, CommentNode>()
	const roots: CommentNode[] = []
	for (const comment of flat) map.set(comment.id, { ...comment, children: [] })
	for (const comment of flat) {
		const node = map.get(comment.id)!
		const parent = comment.parentId ? map.get(comment.parentId) : undefined
		if (parent && parent !== node) parent.children.push(node)
		else roots.push(node)
	}
	const byTime = (a: CommentNode, b: CommentNode) => toMs(a.createdAt) - toMs(b.createdAt)
	const sortDeep = (list: CommentNode[]) => {
		list.sort(byTime)
		for (const node of list) sortDeep(node.children)
	}
	sortDeep(roots)
	return roots
}

export function hashtagsOf(text: string): string[] {
	return (String(text || '').match(/#[\p{L}\p{N}_]{2,32}/gu) ?? []).map((tag) => tag.toLowerCase())
}

const TAG_RE = /(^|[\s([«"'])#([\p{L}\p{N}_]{1,32})/gu
const MENTION_RE = /(^|[\s([«"'])@([A-Za-z0-9_]{2,32})/g

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/**
 * Markdown поста в безопасный HTML: разметку чистит общий санитайзер, а хештеги
 * и упоминания становятся кнопками уже после него — их содержимое ограничено
 * буквами и цифрами, так что вставить туда разметку нельзя.
 */
export function renderRich(md: string): string {
	const prepared = String(md || '')
		.replace(TAG_RE, (_, lead: string, tag: string) => `${lead}\uE000T${tag}\uE001`)
		.replace(MENTION_RE, (_, lead: string, name: string) => `${lead}\uE000M${name}\uE001`)
	return renderString(prepared)
		.replace(/\uE000T([\p{L}\p{N}_]{1,32})\uE001/gu, (_: string, tag: string) => {
			const safe = escapeHtml(tag)
			return `<button type="button" class="nf-tag" data-nf-tag="#${safe}">#${safe}</button>`
		})
		.replace(/\uE000M([A-Za-z0-9_]{2,32})\uE001/g, (_: string, name: string) => {
			const safe = escapeHtml(name)
			return `<button type="button" class="nf-mention" data-nf-user="${safe}">@${safe}</button>`
		})
		.replace(/\uE000T|\uE000M|\uE001/g, '')
}

/** Адреса из статей сайта: относительные пути растут от домена uprojects.site. */
export function resolveNewsAssetUrl(url: string | null | undefined): string {
	const value = String(url || '').trim()
	if (!value) return ''
	if (/^(https?:|data:)/i.test(value)) return value
	if (value.startsWith('/')) return `${new URL(UPROJECTS_BASE).origin}${value}`
	return `${UPROJECTS_BASE}/${value.replace(/^\.?\//, '')}`
}

export function renderArticle(md: string): string {
	return renderString(String(md || '')).replace(
		/\s(src|href)="([^"]*)"/g,
		(match: string, attr: string, value: string) => {
			if (/^(https?:|data:|mailto:|#)/i.test(value)) return match
			return ` ${attr}="${escapeHtml(resolveNewsAssetUrl(value.replace(/&amp;/g, '&')))}"`
		},
	)
}

const BOOKMARK_KEY = 'sf-bookmarks'

function readBookmarks(): string[] {
	try {
		const raw = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]')
		return Array.isArray(raw) ? raw.map(String) : []
	} catch {
		return []
	}
}

const bookmarks = ref<string[]>(readBookmarks())

/** Закладки в том же ключе, что у Undefined Client, — общие с ним на этом компьютере. */
export function useBookmarks() {
	function toggle(id: string): boolean {
		const on = bookmarks.value.includes(id)
		bookmarks.value = on
			? bookmarks.value.filter((entry) => entry !== id)
			: [...bookmarks.value, id]
		try {
			localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks.value))
		} catch {
			/* хранилище переполнено — закладка останется до перезапуска */
		}
		return !on
	}
	return { bookmarks, toggle, has: (id: string) => bookmarks.value.includes(id) }
}

const viewedPosts = new Set<string>()

/** Просмотр засчитывается один раз за запуск лаунчера. */
export function claimView(id: string): boolean {
	if (viewedPosts.has(id)) return false
	viewedPosts.add(id)
	return true
}

export function releaseView(id: string): void {
	viewedPosts.delete(id)
}

export function useNewsText() {
	const { formatMessage, locale } = useVIntl()
	function t(id: string, fallback: string, values?: Record<string, unknown>): string {
		return formatMessage({ id, defaultMessage: fallback }, values as never)
	}
	function pad(value: number): string {
		return String(value).padStart(2, '0')
	}
	function postDate(value: number | string | undefined): string {
		const ms = toMs(value)
		if (!ms) return ''
		const date = new Date(ms)
		return t('app.news.dateAt', '{date} в {time}', {
			date: `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`,
			time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
		})
	}
	function timeAgo(value: number | string | undefined): string {
		const ms = toMs(value)
		if (!ms) return ''
		const diff = Math.max(0, Date.now() - ms)
		const minutes = Math.floor(diff / 60000)
		if (minutes < 1) return t('app.news.timeNow', 'только что')
		if (minutes < 60) return t('app.news.timeMinutesShort', '{n} мин', { n: minutes })
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return t('app.news.timeHoursShort', '{n} ч', { n: hours })
		const days = Math.floor(hours / 24)
		if (days < 7) return t('app.news.timeDaysShort', '{n} д', { n: days })
		return postDate(ms)
	}
	function longDate(value: number | string | undefined): string {
		const ms = toMs(value)
		if (!ms) return ''
		return new Date(ms).toLocaleDateString(locale.value, {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		})
	}
	return { t, postDate, timeAgo, longDate, locale }
}
