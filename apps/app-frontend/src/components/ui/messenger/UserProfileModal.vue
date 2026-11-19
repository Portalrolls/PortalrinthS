<script setup lang="ts">
import {
	BoxIcon,
	CalendarIcon,
	ClockIcon,
	CopyIcon,
	EditIcon,
	GameIcon,
	HeartIcon,
	MessageIcon,
	ServerIcon,
	UserIcon,
	XIcon,
} from '@modrinth/assets'
import { SkinPreviewRenderer } from '@modrinth/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import {
	loadSkinTexture,
	type LooseRecord,
	resolveServiceMedia,
	serviceRequest,
} from '@/helpers/uprojects-service'

import { useMessengerT } from './i18n'
import { formatDate, isInGame, type Peer } from './model'
import PhoneIcon from './PhoneIcon.vue'
import { cardOf, profileEditor, requestCard } from './profile-card'
import { callUser, presenceFor, rememberUser, showToast, state, userOf } from './store'
import { vTip } from './tooltip'
import UserAvatar from './UserAvatar.vue'

defineOptions({ name: 'UserProfileModal' })

type ProfileTarget = {
	id: string
	username?: string
	name?: string
	uuid?: string
}

type Post = {
	id: string
	bodyMd: string
	title?: string | null
	createdAt: number
	attachments?: { id: string; url: string; mime?: string }[]
	reactions?: { counts: Record<string, number> }
	commentCount?: number
}

const t = useMessengerT()

const emit = defineEmits<{
	write: [user: ProfileTarget]
}>()

const open = ref(false)
const loading = ref(false)
const failed = ref(false)
const target = ref<ProfileTarget | null>(null)
const isSelf = ref(false)
const canWrite = ref(false)
const profile = ref<LooseRecord | null>(null)
const stats = ref<LooseRecord | null>(null)
const posts = ref<Post[] | null>(null)
const skinTexture = ref('')
const followBusy = ref(false)
const tab = ref<'about' | 'posts'>('about')

/** Как в Undefined Client: окно сразу рисует то, что знает мессенджер,
 * а полный профиль тихо подставляется, когда придёт — без плашек загрузки. */
async function loadProfile(user: ProfileTarget): Promise<void> {
	loading.value = true
	failed.value = false
	const id = encodeURIComponent(String(user.id))
	const [profileRes, statsRes] = await Promise.allSettled([
		serviceRequest(`/users/${id}/profile`),
		serviceRequest(`/social/users/${id}/stats`),
	])
	if (target.value !== user) return
	loading.value = false
	if (profileRes.status !== 'fulfilled' || !profileRes.value.ok) {
		failed.value = true
		return
	}
	const data = profileRes.value.data
	profile.value = (data?.profile ?? data?.user ?? data) as LooseRecord
	rememberUser(profile.value)
	if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
		stats.value = (statsRes.value.data?.stats ?? null) as LooseRecord | null
	}
	void refreshSkin()
}

defineExpose({
	async show(user: ProfileTarget, opts: { canWrite?: boolean; self?: boolean } = {}) {
		target.value = user
		isSelf.value = Boolean(opts.self)
		canWrite.value = Boolean(opts.canWrite)
		profile.value = null
		stats.value = null
		posts.value = null
		skinTexture.value = ''
		skinMissing.value = false
		tab.value = 'about'
		open.value = true
		requestCard(String(user.id))
		// Скин не ждёт профиль: uuid и ник уже есть у мессенджера.
		void refreshSkin()
		await loadProfile(user)
	},
})

function retry(): void {
	if (target.value) void loadProfile(target.value)
}

function close(): void {
	open.value = false
}

function onKey(event: KeyboardEvent): void {
	if (event.key === 'Escape' && open.value) close()
}

watch(open, (value) => {
	if (value) window.addEventListener('keydown', onKey)
	else window.removeEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const skinMissing = ref(false)

async function refreshSkin(): Promise<void> {
	const user = target.value
	if (!user) return
	const known = userOf(String(user.id))
	const url = await loadSkinTexture({
		skinUrl: (profile.value?.skinUrl as string | null) ?? known?.skinUrl ?? null,
		uuid: String(profile.value?.uuid || known?.uuid || user.uuid || ''),
		username: String(
			profile.value?.username || known?.username || user.username || user.name || '',
		),
		provider: String(profile.value?.provider || known?.provider || ''),
	})
	if (target.value !== user) return
	if (url) {
		skinTexture.value = url
		skinMissing.value = false
	} else if (!skinTexture.value) {
		skinMissing.value = true
	}
}

const userId = computed(() => String(target.value?.id ?? ''))

const peer = computed<Peer | null>(() => {
	void state.presenceClock
	return userOf(userId.value)
})

const username = computed(
	() =>
		(profile.value?.username as string) ||
		peer.value?.username ||
		target.value?.username ||
		target.value?.name ||
		'',
)

const card = computed(() => cardOf(userId.value))

const accent = computed(() => card.value.accent || card.value.bannerColor || '')

const bannerStyle = computed(() => {
	if (card.value.bannerImage) {
		return { backgroundImage: `url("${card.value.bannerImage}")` }
	}
	const color = card.value.bannerColor || accent.value
	if (color) return { background: `linear-gradient(135deg, ${color}, ${color}99)` }
	return {}
})

const presence = computed(() => {
	void state.presenceClock
	return presenceFor(userId.value)
})

/** Живая активность из мессенджера точнее, чем снимок профиля. */
const activity = computed(() => {
	const live = peer.value?.activity
	const snap = profile.value?.activity as LooseRecord | undefined
	if (live && isInGame(peer.value)) {
		return {
			playing: true,
			build: live.buildName || '',
			server: live.serverName || '',
			version: live.gameVersion || '',
			hosting: Boolean(live.hosting || live.worldShare),
		}
	}
	if (snap?.playing) {
		return {
			playing: true,
			build: String(snap.build ?? snap.buildName ?? ''),
			server: String(snap.server ?? snap.serverName ?? ''),
			version: String(snap.version ?? snap.gameVersion ?? ''),
			hosting: false,
		}
	}
	return null
})

const statusLine = computed(() => {
	if (activity.value) {
		if (activity.value.hosting) return t('app.messenger.activity.hosting', 'Открыл мир по сети')
		return activity.value.build
			? t('app.messenger.activity.playingBuild', 'Играет в {name}', { name: activity.value.build })
			: t('app.messenger.activity.playing', 'Играет в Minecraft')
	}
	switch (presence.value) {
		case 'online':
			return t('app.messenger.status.online', 'В сети')
		case 'busy':
			return t('app.messenger.status.busy', 'Отошёл')
		case 'dnd':
			return t('app.messenger.status.dnd', 'Не беспокоить')
		default: {
			const seen = Number(profile.value?.lastSeenAt ?? peer.value?.lastSeenAt)
			return seen
				? t('app.messenger.profile.seenAt', 'Был в сети {date}', { date: formatStamp(seen) })
				: t('app.messenger.status.offline', 'Не в сети')
		}
	}
})

function formatStamp(raw: unknown): string {
	const value = typeof raw === 'number' ? raw : Date.parse(String(raw || ''))
	return Number.isFinite(value) && value > 0 ? formatDate(value) : ''
}

function providerLabel(provider: unknown): string {
	if (provider === 'bot') return 'Undefined ID'
	return provider === 'ely' ? 'Ely.by' : 'Microsoft'
}

/** Цвет маркера на панели локатора — из UUID, как в игре. */
function markerColor(uuid: unknown): string {
	const key = String(uuid || '').replace(/-/g, '')
	if (!key) return ''
	let hash = 0x811c9dc5
	for (let i = 0; i < key.length; i++) {
		hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0
	}
	return `#${(hash & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`
}

type InfoRow = {
	key: string
	icon: typeof BoxIcon
	label: string
	value: string
	sub?: string
	color?: string
}

const rows = computed<InfoRow[]>(() => {
	const p: LooseRecord | null =
		profile.value ??
		(peer.value
			? {
					provider: peer.value.provider,
					uuid: peer.value.uuid,
					lastSeenAt: peer.value.lastSeenAt,
				}
			: null)
	if (!p) return []
	const noData = t('app.messenger.profile.empty', 'Пока-что ничего нет')
	const out: InfoRow[] = [
		{
			key: 'lastBuild',
			icon: BoxIcon,
			label: t('app.messenger.profile.lastBuild', 'Последняя сборка'),
			value: String(p.lastBuild ?? '') || noData,
			sub: String(p.lastBuildMeta ?? '') || undefined,
		},
		{
			key: 'lastServer',
			icon: ServerIcon,
			label: t('app.messenger.profile.lastServer', 'Последний сервер'),
			value: String(p.lastServer ?? '') || noData,
			sub: String(p.lastServerMeta ?? '') || undefined,
		},
		{
			key: 'favorite',
			icon: HeartIcon,
			label: t('app.messenger.profile.favoriteBuild', 'Любимая сборка'),
			value: String(p.favoriteBuild ?? '') || noData,
			sub: p.favoriteBuildCount
				? t('app.messenger.profile.favoriteCount', '{n} запусков', {
						n: String(p.favoriteBuildCount),
					})
				: undefined,
		},
		{
			key: 'account',
			icon: UserIcon,
			label: t('app.messenger.profile.account', 'Аккаунт'),
			value: providerLabel(p.provider),
			sub: String(p.uuid || '')
				.replace(/-/g, '')
				.slice(0, 8),
		},
	]
	const joined = formatStamp(p.createdAt)
	if (joined) {
		out.push({
			key: 'joined',
			icon: CalendarIcon,
			label: t('app.messenger.profile.joined', 'В Undefined с'),
			value: joined,
		})
	}
	const seen = formatStamp(p.lastSeenAt)
	if (seen && !activity.value && presence.value === 'offline') {
		out.push({
			key: 'seen',
			icon: ClockIcon,
			label: t('app.messenger.profile.lastSeen', 'Был в сети'),
			value: seen,
		})
	}
	const color = markerColor(p.uuid)
	if (color) {
		out.push({
			key: 'marker',
			icon: CopyIcon,
			label: t('app.messenger.profile.marker', 'Маркер в игре'),
			value: color,
			color,
		})
	}
	return out
})

async function copyMarker(row: InfoRow): Promise<void> {
	if (!row.color) return
	await navigator.clipboard.writeText(row.color).catch(() => undefined)
	showToast(
		t('app.messenger.profile.markerCopied', 'Цвет {color} скопирован', { color: row.color }),
	)
}

const statItems = computed(() => {
	const s = stats.value
	if (!s) return []
	return [
		{ key: 'posts', value: s.postCount, label: t('app.messenger.profile.posts', 'публикации') },
		{ key: 'friends', value: s.friendsCount, label: t('app.messenger.profile.friends', 'друзья') },
		{
			key: 'followers',
			value: s.followerCount,
			label: t('app.messenger.profile.followers', 'подписчики'),
		},
	]
		.filter((item) => item.value != null)
		.map((item) => ({ ...item, value: String(item.value) }))
})

const following = computed(() => Boolean(stats.value?.followedByMe))
const canFollow = computed(() => Boolean(stats.value && !isSelf.value))

async function toggleFollow(): Promise<void> {
	if (!target.value || !stats.value || followBusy.value) return
	followBusy.value = true
	const was = following.value
	const before = stats.value
	stats.value = {
		...before,
		followedByMe: !was,
		followerCount: Math.max(0, (Number(before.followerCount) || 0) + (was ? -1 : 1)),
	}
	const response = await serviceRequest(
		`/social/users/${encodeURIComponent(userId.value)}/follow`,
		{ method: was ? 'DELETE' : 'POST' },
	).catch(() => null)
	if (!response?.ok) stats.value = before
	else if (response.data?.stats) stats.value = { ...stats.value, ...response.data.stats }
	followBusy.value = false
}

async function loadPosts(): Promise<void> {
	if (posts.value) return
	const id = userId.value
	const res = await serviceRequest(`/social/users/${encodeURIComponent(id)}/posts`, {
		query: { limit: 20 },
	}).catch(() => null)
	if (userId.value !== id) return
	posts.value = res?.ok && Array.isArray(res.data?.posts) ? (res.data.posts as Post[]) : []
}

watch(tab, (value) => {
	if (value === 'posts') void loadPosts()
})

function postImages(post: Post): string[] {
	return (post.attachments ?? [])
		.filter((entry) => !entry.mime || entry.mime.startsWith('image/'))
		.map((entry) => resolveServiceMedia(entry.url))
		.filter(Boolean)
		.slice(0, 4)
}

function postLikes(post: Post): number {
	return Object.values(post.reactions?.counts ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0)
}

function write(): void {
	if (!target.value) return
	close()
	emit('write', target.value)
}

function call(): void {
	if (!target.value) return
	close()
	void callUser({ id: userId.value, username: username.value })
}

function edit(): void {
	close()
	profileEditor.open = true
}
</script>

<template>
	<Teleport to="body">
		<Transition name="upm">
			<div v-if="open" class="upm msgr-root" @mousedown.self="close">
				<div
					class="upm__window"
					:style="accent ? { '--upm-accent': accent } : undefined"
					role="dialog"
					aria-modal="true"
				>
					<button
						type="button"
						class="upm__close"
						:aria-label="t('app.messenger.close', 'Закрыть')"
						@click="close"
					>
						<XIcon />
					</button>

					<div
						class="upm__banner"
						:class="{ 'is-empty': !card.bannerImage && !accent }"
						:style="bannerStyle"
					/>

					<div class="upm__body">
						<aside class="upm__skin">
							<SkinPreviewRenderer
								v-if="skinTexture"
								:texture-src="skinTexture"
								framing="modal"
								:initial-rotation="Math.PI / 8"
								class="upm__canvas"
							/>
							<div v-else-if="skinMissing" class="upm__skin-none">
								<UserIcon class="upm__skin-stub" />
								<span>{{ t('app.messenger.profile.noSkin', 'Скин не найден') }}</span>
							</div>
							<div v-else class="upm__skin-wait" aria-hidden="true">
								<span class="upm__skin-figure" />
							</div>
						</aside>

						<div class="upm__main">
							<header class="upm__head">
								<div class="upm__avatar">
									<UserAvatar
										:user-id="userId"
										:name="username"
										:size="92"
										status
										ring="var(--upm-bg)"
									/>
								</div>
								<div class="upm__actions">
									<button v-if="isSelf" type="button" class="upm__btn is-accent" @click="edit">
										<EditIcon />
										{{ t('app.messenger.profile.edit', 'Редактировать профиль') }}
									</button>
									<template v-else>
										<button
											v-if="canWrite"
											type="button"
											class="upm__btn is-accent"
											:disabled="loading"
											@click="write"
										>
											<MessageIcon />
											{{ t('app.messenger.profile.write', 'Написать') }}
										</button>
										<button
											v-if="canWrite"
											v-tip="t('app.messenger.call.start', 'Позвонить')"
											type="button"
											class="upm__btn is-icon"
											@click="call"
										>
											<PhoneIcon />
										</button>
										<button
											v-if="canFollow"
											type="button"
											class="upm__btn"
											:class="{ 'is-on': following }"
											:disabled="followBusy"
											@click="toggleFollow"
										>
											{{
												following
													? t('app.messenger.profile.following', 'Вы подписаны')
													: t('app.messenger.profile.follow', 'Подписаться')
											}}
										</button>
									</template>
								</div>
							</header>

							<div class="upm__identity">
								<b class="upm__name">{{ username }}</b>
								<span class="upm__meta">
									<span class="upm__chip">{{
										providerLabel(profile?.provider ?? peer?.provider)
									}}</span>
									<span v-if="card.pronouns" class="upm__pronouns">{{ card.pronouns }}</span>
								</span>
								<span class="upm__status" :class="[`is-${activity ? 'game' : presence}`]">
									<i aria-hidden="true" />
									{{ statusLine }}
								</span>
							</div>

							<p v-if="card.bio" class="upm__bio">{{ card.bio }}</p>

							<div v-if="statItems.length" class="upm__stats">
								<div v-for="item in statItems" :key="item.key" class="upm__stat">
									<b>{{ item.value }}</b>
									<span>{{ item.label }}</span>
								</div>
							</div>

							<nav class="upm__tabs">
								<button type="button" :class="{ 'is-on': tab === 'about' }" @click="tab = 'about'">
									{{ t('app.messenger.profile.about', 'Обо мне') }}
								</button>
								<button type="button" :class="{ 'is-on': tab === 'posts' }" @click="tab = 'posts'">
									{{ t('app.messenger.profile.postsTab', 'Публикации') }}
								</button>
							</nav>

							<div class="upm__pane">
								<div v-if="loading && !rows.length && !activity" class="upm__state">
									<span class="msgr-spinner" />
									{{ t('app.messenger.profile.loading', 'Загружаем профиль…') }}
								</div>
								<div v-else-if="tab === 'about' && !rows.length && !activity" class="upm__state">
									<UserIcon />
									{{ t('app.messenger.profile.empty', 'Пока-что ничего нет') }}
									<button v-if="failed" type="button" class="upm__btn" @click="retry">
										{{ t('app.messenger.retry', 'Повторить') }}
									</button>
								</div>
								<template v-else-if="tab === 'about'">
									<div v-if="activity" class="upm__activity">
										<span class="upm__activity-icon"><GameIcon /></span>
										<div>
											<small>{{ t('app.messenger.profile.playingNow', 'Сейчас играет') }}</small>
											<b>{{ activity.build || 'Minecraft' }}</b>
											<span v-if="activity.server || activity.version">
												{{ [activity.version, activity.server].filter(Boolean).join(' · ') }}
											</span>
										</div>
									</div>
									<div class="upm__rows">
										<component
											:is="row.color ? 'button' : 'div'"
											v-for="(row, index) in rows"
											:key="row.key"
											class="upm__row"
											:class="{ 'is-click': row.color }"
											:style="{ animationDelay: `${index * 35}ms` }"
											:type="row.color ? 'button' : undefined"
											@click="copyMarker(row)"
										>
											<span
												class="upm__row-icon"
												:style="row.color ? { background: row.color } : undefined"
											>
												<component :is="row.icon" v-if="!row.color" />
											</span>
											<span class="upm__row-text">
												<small>{{ row.label }}</small>
												<b>{{ row.value }}</b>
												<em v-if="row.sub">{{ row.sub }}</em>
											</span>
										</component>
									</div>
								</template>
								<template v-else>
									<div v-if="!posts" class="upm__state">
										<span class="msgr-spinner" />
									</div>
									<div v-else-if="!posts.length" class="upm__state">
										{{ t('app.messenger.profile.empty', 'Пока-что ничего нет') }}
									</div>
									<div v-else class="upm__posts">
										<article v-for="post in posts" :key="post.id" class="upm__post">
											<header>
												<b v-if="post.title">{{ post.title }}</b>
												<small>{{ formatStamp(post.createdAt) }}</small>
											</header>
											<p v-if="post.bodyMd">{{ post.bodyMd }}</p>
											<div v-if="postImages(post).length" class="upm__post-media">
												<img
													v-for="src in postImages(post)"
													:key="src"
													:src="src"
													alt=""
													loading="lazy"
												/>
											</div>
											<footer>
												<span><HeartIcon /> {{ postLikes(post) }}</span>
												<span><MessageIcon /> {{ post.commentCount ?? 0 }}</span>
											</footer>
										</article>
									</div>
								</template>
							</div>
						</div>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.upm {
	position: fixed;
	inset: 0;
	z-index: 120;
	display: grid;
	place-items: center;
	padding: 1.5rem;
	background: rgba(0, 0, 0, 0.55);
	backdrop-filter: blur(8px);
}

.upm__window {
	--upm-bg: #18191c;
	--upm-accent: var(--color-brand);
	position: relative;
	display: flex;
	width: min(760px, 100%);
	max-height: min(640px, calc(100vh - 3rem));
	flex-direction: column;
	overflow: hidden;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 18px;
	background: var(--upm-bg);
	box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}

.upm__close {
	position: absolute;
	top: 0.75rem;
	right: 0.75rem;
	z-index: 3;
	display: grid;
	width: 2rem;
	height: 2rem;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: rgba(0, 0, 0, 0.45);
	color: #fff;
	cursor: pointer;
	backdrop-filter: blur(6px);
	transition:
		background 0.15s ease,
		transform 0.15s ease;
}

.upm__close:hover {
	background: rgba(0, 0, 0, 0.7);
	transform: rotate(90deg);
}

.upm__close svg {
	width: 1rem;
	height: 1rem;
}

.upm__banner {
	height: 140px;
	flex-shrink: 0;
	background-position: center;
	background-size: cover;
}

.upm__banner.is-empty {
	background:
		radial-gradient(
			120% 140% at 0% 0%,
			color-mix(in srgb, var(--color-brand) 55%, transparent),
			transparent 60%
		),
		linear-gradient(135deg, #26282e, #1d1e22);
}

.upm__body {
	display: grid;
	min-height: 0;
	flex: 1;
	grid-template-columns: 200px 1fr;
	gap: 1.25rem;
	padding: 0 1.25rem 1.25rem;
}

.upm__skin {
	display: grid;
	height: 330px;
	margin-top: -60px;
	place-items: center;
	overflow: hidden;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 14px;
	background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.01));
	backdrop-filter: blur(10px);
}

.upm__canvas {
	width: 100%;
	height: 100%;
}

.upm__skin-stub {
	width: 3rem;
	height: 3rem;
	color: var(--color-secondary);
}

.upm__skin-none {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.5rem;
	color: var(--color-secondary);
	font-size: 0.8rem;
}

/* Силуэт игрока, пока лист скина в пути. */
.upm__skin-wait {
	display: grid;
	width: 100%;
	height: 100%;
	place-items: center;
}

.upm__skin-figure {
	position: relative;
	display: block;
	width: 64px;
	height: 190px;
	border-radius: 6px;
	background: linear-gradient(
		100deg,
		rgba(255, 255, 255, 0.05) 30%,
		rgba(255, 255, 255, 0.14) 50%,
		rgba(255, 255, 255, 0.05) 70%
	);
	background-size: 220% 100%;
	mask:
		linear-gradient(#000 0 0) top / 40px 40px no-repeat,
		linear-gradient(#000 0 0) 50% 44px / 64px 72px no-repeat,
		linear-gradient(#000 0 0) 50% 118px / 32px 72px no-repeat;
	animation: upm-shimmer 1.4s linear infinite;
}

@keyframes upm-shimmer {
	to {
		background-position: -220% 0;
	}
}

.upm__main {
	display: flex;
	min-width: 0;
	min-height: 0;
	flex-direction: column;
	gap: 0.75rem;
}

.upm__head {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 0.75rem;
	margin-top: -46px;
}

.upm__avatar {
	position: relative;
	z-index: 1;
	flex-shrink: 0;
	border-radius: 50%;
	box-shadow: 0 0 0 6px var(--upm-bg);
}

.upm__actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 0.4rem;
	padding-bottom: 0.25rem;
}

.upm__btn {
	display: inline-flex;
	height: 2.1rem;
	align-items: center;
	gap: 0.4rem;
	padding: 0 0.85rem;
	border: 0;
	border-radius: 9px;
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.85rem;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
	transition:
		background 0.15s ease,
		filter 0.15s ease,
		transform 0.12s ease;
}

.upm__btn:hover:not(:disabled) {
	background: rgba(255, 255, 255, 0.14);
}

.upm__btn:active:not(:disabled) {
	transform: scale(0.97);
}

.upm__btn:disabled {
	opacity: 0.55;
	cursor: default;
}

.upm__btn.is-accent {
	background: var(--upm-accent);
	color: #fff;
}

.upm__btn.is-accent:hover:not(:disabled) {
	background: var(--upm-accent);
	filter: brightness(1.12);
}

.upm__btn.is-icon {
	width: 2.1rem;
	justify-content: center;
	padding: 0;
	color: var(--msgr-ok);
}

.upm__btn.is-on {
	color: var(--color-secondary);
}

.upm__btn svg {
	width: 1rem;
	height: 1rem;
}

.upm__identity {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 0.3rem;
}

.upm__name {
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 1.35rem;
	font-weight: 800;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.upm__meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.45rem;
}

.upm__chip {
	padding: 0.12rem 0.5rem;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-text);
	font-size: 0.72rem;
	font-weight: 700;
}

.upm__pronouns {
	color: var(--color-secondary);
	font-size: 0.82rem;
}

.upm__status {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 0.4rem;
	color: var(--color-secondary);
	font-size: 0.85rem;
}

.upm__status i {
	width: 0.55rem;
	height: 0.55rem;
	flex-shrink: 0;
	border-radius: 50%;
	background: #80848e;
}

.upm__status.is-online i,
.upm__status.is-game i {
	background: var(--msgr-ok);
}

.upm__status.is-game {
	color: var(--msgr-ok);
	font-weight: 600;
}

.upm__status.is-busy i {
	background: #f0b232;
}

.upm__status.is-dnd i {
	background: var(--msgr-danger);
}

.upm__bio {
	margin: 0;
	padding: 0.65rem 0.8rem;
	border-radius: 10px;
	background: rgba(255, 255, 255, 0.04);
	color: var(--color-text);
	font-size: 0.88rem;
	line-height: 1.45;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.upm__stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
	gap: 0.4rem;
}

.upm__stat {
	display: flex;
	min-width: 0;
	flex-direction: column;
	align-items: center;
	padding: 0.5rem;
	border-radius: 10px;
	background: rgba(255, 255, 255, 0.04);
}

.upm__stat b {
	color: var(--color-contrast);
	font-size: 1.05rem;
}

.upm__stat span {
	color: var(--color-secondary);
	font-size: 0.72rem;
}

.upm__tabs {
	display: flex;
	gap: 1rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.upm__tabs button {
	position: relative;
	padding: 0.45rem 0;
	border: 0;
	background: none;
	color: var(--color-secondary);
	font: inherit;
	font-size: 0.88rem;
	font-weight: 600;
	cursor: pointer;
	transition: color 0.15s ease;
}

.upm__tabs button::after {
	position: absolute;
	right: 0;
	bottom: -1px;
	left: 0;
	height: 2px;
	border-radius: 2px;
	background: var(--upm-accent);
	content: '';
	transform: scaleX(0);
	transition: transform 0.2s ease;
}

.upm__tabs button:hover,
.upm__tabs button.is-on {
	color: var(--color-contrast);
}

.upm__tabs button.is-on::after {
	transform: scaleX(1);
}

.upm__pane {
	min-height: 160px;
	overflow-y: auto;
	padding-right: 0.25rem;
	scrollbar-width: thin;
}

.upm__state {
	display: flex;
	min-height: 150px;
	align-items: center;
	justify-content: center;
	gap: 0.55rem;
	color: var(--color-secondary);
	font-size: 0.88rem;
}

.upm__state svg {
	width: 1.3rem;
	height: 1.3rem;
}

.upm__state .upm__btn {
	margin-left: 0.4rem;
}

@keyframes upm-notice {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
}

.upm__activity {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	margin-bottom: 0.5rem;
	padding: 0.7rem 0.8rem;
	border: 1px solid color-mix(in srgb, var(--msgr-ok) 30%, transparent);
	border-radius: 12px;
	background: color-mix(in srgb, var(--msgr-ok) 9%, transparent);
	animation: upm-row 0.3s ease both;
}

.upm__activity-icon {
	display: grid;
	width: 2.6rem;
	height: 2.6rem;
	flex-shrink: 0;
	place-items: center;
	border-radius: 10px;
	background: color-mix(in srgb, var(--msgr-ok) 22%, transparent);
	color: var(--msgr-ok);
}

.upm__activity-icon svg {
	width: 1.3rem;
	height: 1.3rem;
}

.upm__activity div {
	display: flex;
	min-width: 0;
	flex-direction: column;
}

.upm__activity small {
	color: var(--msgr-ok);
	font-size: 0.7rem;
	font-weight: 700;
	text-transform: uppercase;
}

.upm__activity b,
.upm__activity span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.upm__activity b {
	color: var(--color-contrast);
}

.upm__activity span {
	color: var(--color-secondary);
	font-size: 0.8rem;
}

.upm__rows {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.4rem;
}

.upm__row {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 0.6rem;
	padding: 0.55rem 0.65rem;
	border: 0;
	border-radius: 10px;
	background: rgba(255, 255, 255, 0.04);
	color: inherit;
	font: inherit;
	text-align: left;
	animation: upm-row 0.3s ease both;
	transition: background 0.15s ease;
}

.upm__row.is-click {
	cursor: pointer;
}

.upm__row.is-click:hover {
	background: rgba(255, 255, 255, 0.08);
}

.upm__row-icon {
	display: grid;
	width: 2rem;
	height: 2rem;
	flex-shrink: 0;
	place-items: center;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.07);
	color: var(--color-secondary);
}

.upm__row-icon svg {
	width: 1rem;
	height: 1rem;
}

.upm__row-text {
	display: flex;
	min-width: 0;
	flex-direction: column;
}

.upm__row-text small {
	color: var(--color-secondary);
	font-size: 0.7rem;
}

.upm__row-text b {
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 0.86rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.upm__row-text em {
	overflow: hidden;
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-style: normal;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.upm__posts {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.upm__post {
	padding: 0.7rem 0.8rem;
	border-radius: 12px;
	background: rgba(255, 255, 255, 0.04);
	animation: upm-row 0.3s ease both;
}

.upm__post header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.5rem;
}

.upm__post header b {
	color: var(--color-contrast);
}

.upm__post header small,
.upm__post footer {
	color: var(--color-secondary);
	font-size: 0.75rem;
}

.upm__post p {
	display: -webkit-box;
	margin: 0.35rem 0 0;
	overflow: hidden;
	color: var(--color-text);
	font-size: 0.86rem;
	line-height: 1.45;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 6;
}

.upm__post-media {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
	gap: 0.3rem;
	margin-top: 0.5rem;
}

.upm__post-media img {
	width: 100%;
	height: 110px;
	border-radius: 8px;
	object-fit: cover;
}

.upm__post footer {
	display: flex;
	gap: 0.9rem;
	margin-top: 0.5rem;
}

.upm__post footer span {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
}

.upm__post footer svg {
	width: 0.85rem;
	height: 0.85rem;
}

@keyframes upm-row {
	from {
		opacity: 0;
		transform: translateY(6px);
	}
}

.upm-enter-active,
.upm-leave-active {
	transition: opacity 0.2s ease;
}

.upm-enter-active .upm__window,
.upm-leave-active .upm__window {
	transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.upm-enter-from,
.upm-leave-to {
	opacity: 0;
}

.upm-enter-from .upm__window,
.upm-leave-to .upm__window {
	transform: scale(0.94) translateY(10px);
}

@media (max-width: 720px) {
	.upm__body {
		grid-template-columns: 1fr;
	}

	.upm__skin {
		display: none;
	}

	.upm__rows {
		grid-template-columns: 1fr;
	}
}

@media (prefers-reduced-motion: reduce) {
	.upm__row,
	.upm__post,
	.upm__activity {
		animation: none;
	}
}
</style>
