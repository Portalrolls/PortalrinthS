<script setup lang="ts">
import { UserIcon } from '@modrinth/assets'
import { Button, NewModal, SkinPreviewRenderer, useVIntl } from '@modrinth/ui'
import { computed, ref } from 'vue'

import {
	type LooseRecord,
	resolveAvatar,
	resolveServiceMedia,
	serviceRequest,
} from '@/helpers/uprojects-service'

defineOptions({ name: 'UserProfileModal' })

type ProfileTarget = {
	id: string
	username?: string
	name?: string
	uuid?: string
}

const { formatMessage } = useVIntl()

const emit = defineEmits<{
	write: [user: ProfileTarget]
}>()

const modal = ref<InstanceType<typeof NewModal> | null>(null)

const loading = ref(false)
const failed = ref(false)
const target = ref<ProfileTarget | null>(null)
const isSelf = ref(false)
const canWrite = ref(false)
const profile = ref<LooseRecord | null>(null)
const stats = ref<LooseRecord | null>(null)
const avatar = ref('')
const skinTexture = ref('')
const followBusy = ref(false)

defineExpose({
	async show(user: ProfileTarget, opts: { canWrite?: boolean; self?: boolean } = {}) {
		target.value = user
		isSelf.value = Boolean(opts.self)
		canWrite.value = Boolean(opts.canWrite)
		loading.value = true
		failed.value = false
		profile.value = null
		stats.value = null
		avatar.value = ''
		skinTexture.value = ''
		modal.value?.show()
		const id = encodeURIComponent(String(user.id))
		const [profileRes, statsRes] = await Promise.allSettled([
			serviceRequest(`/users/${id}/profile`),
			serviceRequest(`/social/users/${id}/stats`),
		])
		loading.value = false
		if (target.value !== user) return
		if (profileRes.status !== 'fulfilled' || !profileRes.value.ok) {
			failed.value = true
			return
		}
		profile.value = (profileRes.value.data?.user ?? profileRes.value.data) as LooseRecord
		if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
			stats.value = (statsRes.value.data?.stats ?? null) as LooseRecord | null
		}
		void loadAvatar()
		loadSkinTexture()
	},
})

async function loadAvatar() {
	if (!profile.value) return
	avatar.value = await resolveAvatar({
		skinUrl: profile.value.skinUrl as string | null,
		avatar: profile.value.avatar as string | null,
		uuid: profile.value.uuid as string | undefined,
		username: profile.value.username as string | undefined,
	})
}

function loadSkinTexture() {
	if (!profile.value) return
	const direct = resolveServiceMedia(profile.value.skinUrl as string | null)
	if (direct) {
		skinTexture.value = direct
		return
	}
	const uuid = String(profile.value.uuid || target.value?.uuid || '').replace(/-/g, '')
	if (uuid) skinTexture.value = `https://crafatar.com/skins/${uuid}`
}

const username = computed(() => {
	const name =
		(profile.value?.username as string) ||
		(profile.value?.name as string) ||
		target.value?.username ||
		target.value?.name ||
		''
	return name
})

const online = computed(() =>
	Boolean((profile.value?.activity as LooseRecord | undefined)?.playing),
)

function providerLabel(provider: unknown): string {
	if (provider === 'bot') return 'Undefined ID'
	return provider === 'ely' ? 'Ely.by' : 'Microsoft'
}

function shortUuid(uuid: unknown): string {
	return String(uuid || '')
		.replace(/-/g, '')
		.slice(0, 8)
}

function formatStamp(raw: unknown): string {
	const date = new Date(String(raw || ''))
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Стабильный цвет маркера игрока — из UUID, как в игре. */
function markerColor(uuid: unknown): string {
	const key = String(uuid || '').replace(/-/g, '')
	if (!key) return ''
	let hash = 0x811c9dc5
	for (let i = 0; i < key.length; i++) {
		hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0
	}
	const r = (hash >>> 16) & 0xff
	const g = (hash >>> 8) & 0xff
	const b = hash & 0xff
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`
}

type ProfileRow = {
	key: string
	label: string
	value: string
	sub?: string
	marker?: boolean
}

const rows = computed<ProfileRow[]>(() => {
	const p = profile.value
	if (!p) return []
	const activity = p.activity as LooseRecord | undefined
	const playing = Boolean(activity?.playing)
	const build = playing ? String(activity?.build ?? '') : ''
	const buildSub = playing
		? [activity?.version, activity?.loader, activity?.server].filter(Boolean).join(' · ')
		: ''
	const noData = formatMessage({ id: 'app.messenger.profile.noData', defaultMessage: 'Нет данных' })
	const out: ProfileRow[] = [
		{
			key: 'lastSeen',
			label: formatMessage({ id: 'app.messenger.profile.lastSeen', defaultMessage: 'Был в сети' }),
			value: formatStamp(p.lastSeenAt) || '—',
		},
		{
			key: 'playing',
			label: formatMessage({
				id: 'app.messenger.profile.playingNow',
				defaultMessage: 'Сейчас играет в',
			}),
			value: playing
				? build || 'Minecraft'
				: formatMessage({ id: 'app.messenger.profile.notPlaying', defaultMessage: 'Не в игре' }),
			sub: buildSub || undefined,
		},
		{
			key: 'lastBuild',
			label: formatMessage({
				id: 'app.messenger.profile.lastBuild',
				defaultMessage: 'Последняя сборка',
			}),
			value: String(p.lastBuild ?? '') || noData,
			sub: String(p.lastBuildMeta ?? '') || undefined,
		},
		{
			key: 'lastServer',
			label: formatMessage({
				id: 'app.messenger.profile.lastServer',
				defaultMessage: 'Последний сервер',
			}),
			value: String(p.lastServer ?? '') || noData,
			sub: String(p.lastServerMeta ?? '') || undefined,
		},
		{
			key: 'favoriteBuild',
			label: formatMessage({
				id: 'app.messenger.profile.favoriteBuild',
				defaultMessage: 'Любимая сборка',
			}),
			value:
				String(p.favoriteBuild ?? '') ||
				formatMessage({ id: 'app.messenger.profile.noFavorite', defaultMessage: 'Нет любимой' }),
			sub: p.favoriteBuildCount
				? formatMessage(
						{ id: 'app.messenger.profile.favoriteCount', defaultMessage: '{n} запусков' },
						{ n: String(p.favoriteBuildCount) },
					)
				: undefined,
		},
	]
	const color = markerColor(p.uuid)
	if (color) {
		out.push({
			key: 'marker',
			label: formatMessage({ id: 'app.messenger.profile.marker', defaultMessage: 'Маркер' }),
			value: color,
			sub: formatMessage({ id: 'app.messenger.profile.markerHint', defaultMessage: 'цвет в игре' }),
			marker: true,
		})
	}
	out.push({
		key: 'account',
		label: formatMessage({ id: 'app.messenger.profile.account', defaultMessage: 'Аккаунт' }),
		value: providerLabel(p.provider),
		sub: shortUuid(p.uuid) ? `${shortUuid(p.uuid)}…` : undefined,
	})
	const joined = formatStamp(p.createdAt)
	if (joined) {
		out.push({
			key: 'joined',
			label: formatMessage({
				id: 'app.messenger.profile.joined',
				defaultMessage: 'Дата регистрации',
			}),
			value: joined,
		})
	}
	return out
})

type StatItem = { key: string; value: string; label: string }

const statItems = computed<StatItem[]>(() => {
	const s = stats.value
	if (!s) return []
	const items: StatItem[] = []
	if (s.postCount != null) {
		items.push({
			key: 'posts',
			value: String(s.postCount),
			label: formatMessage({ id: 'app.messenger.profile.posts', defaultMessage: 'публикации' }),
		})
	}
	if (s.friendsCount != null) {
		items.push({
			key: 'friends',
			value: String(s.friendsCount),
			label: formatMessage({ id: 'app.messenger.profile.friends', defaultMessage: 'друзья' }),
		})
	}
	if (s.followerCount != null) {
		items.push({
			key: 'followers',
			value: String(s.followerCount),
			label: formatMessage({ id: 'app.messenger.profile.followers', defaultMessage: 'подписчики' }),
		})
	}
	return items
})

const following = computed(() => Boolean(stats.value?.followedByMe))

const canFollow = computed(() => Boolean(stats.value && !isSelf.value))

async function toggleFollow() {
	if (!target.value || followBusy.value) return
	followBusy.value = true
	const id = encodeURIComponent(String(target.value.id))
	const response = await serviceRequest(`/social/users/${id}/follow`, { method: 'POST' })
	if (response.ok && stats.value) {
		stats.value = { ...stats.value, followedByMe: !following.value }
	}
	followBusy.value = false
}

function write() {
	if (!target.value) return
	modal.value?.hide()
	emit('write', target.value)
}
</script>

<template>
	<NewModal ref="modal" width="680px" max-width="680px" merge-header>
		<div class="upm">
			<div v-if="loading" class="upm__state">
				<span class="upm__spinner" aria-hidden="true" />
				{{
					formatMessage({
						id: 'app.messenger.profile.loading',
						defaultMessage: 'Загружаем профиль…',
					})
				}}
			</div>
			<div v-else-if="failed" class="upm__state">
				<UserIcon class="upm__state-icon" aria-hidden="true" />
				{{
					formatMessage({
						id: 'app.messenger.profile.failed',
						defaultMessage: 'Профиль не загрузился — попробуйте ещё раз',
					})
				}}
			</div>
			<div v-else-if="profile" class="upm__grid">
				<div class="upm__skin">
					<SkinPreviewRenderer
						v-if="skinTexture"
						:texture-src="skinTexture"
						framing="modal"
						:initial-rotation="Math.PI / 8"
						class="upm__canvas"
					/>
					<img v-else-if="avatar" :src="avatar" alt="" class="upm__skin-fallback" />
				</div>
				<div class="upm__main">
					<header class="upm__head">
						<img v-if="avatar" :src="avatar" alt="" class="upm__avatar" />
						<span v-else class="upm__avatar upm__avatar--stub" aria-hidden="true" />
						<div class="upm__id">
							<b class="upm__name">{{ username }}</b>
							<span class="upm__badges">
								<span class="upm__chip">{{ providerLabel(profile.provider) }}</span>
								<span class="upm__dot" :class="{ 'is-on': online }" aria-hidden="true" />
								<span class="upm__status">
									{{
										online
											? formatMessage({
													id: 'app.messenger.profile.online',
													defaultMessage: 'В сети',
												})
											: formatMessage({
													id: 'app.messenger.profile.offline',
													defaultMessage: 'Оффлайн',
												})
									}}
								</span>
							</span>
						</div>
					</header>
					<div class="upm__cards">
						<div
							v-for="(row, i) in rows"
							:key="row.key"
							class="upm__card"
							:style="{ animationDelay: `${i * 40}ms` }"
						>
							<span class="upm__card-label">{{ row.label }}</span>
							<span class="upm__card-value" :class="{ 'is-marker': row.marker }">
								<i
									v-if="row.marker"
									class="upm__marker"
									:style="{ background: row.value }"
									aria-hidden="true"
								/>
								{{ row.value }}
							</span>
							<small v-if="row.sub" class="upm__card-sub">{{ row.sub }}</small>
						</div>
					</div>
					<div v-if="statItems.length" class="upm__stats">
						<div v-for="item in statItems" :key="item.key" class="upm__stat">
							<b>{{ item.value }}</b>
							<span>{{ item.label }}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
		<template #actions>
			<div class="upm__actions">
				<Button v-if="canWrite" color="brand" :disabled="loading" @click="write">
					{{
						formatMessage({
							id: 'app.messenger.profile.write',
							defaultMessage: 'Написать',
						})
					}}
				</Button>
				<Button v-if="canFollow" :disabled="followBusy" @click="toggleFollow">
					{{
						following
							? formatMessage({
									id: 'app.messenger.profile.following',
									defaultMessage: 'Вы подписаны',
								})
							: formatMessage({
									id: 'app.messenger.profile.follow',
									defaultMessage: 'Подписаться',
								})
					}}
				</Button>
			</div>
		</template>
	</NewModal>
</template>

<style scoped>
.upm {
	min-height: 24rem;
}

.upm__state {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.6rem;
	min-height: 24rem;
	color: var(--color-text-inactive);
}

.upm__state-icon {
	width: 1.5rem;
	height: 1.5rem;
}

.upm__spinner {
	width: 1rem;
	height: 1rem;
	border: 2px solid var(--color-brand);
	border-top-color: transparent;
	border-radius: 50%;
	animation: upm-spin 0.8s linear infinite;
	flex-shrink: 0;
}

@keyframes upm-spin {
	to {
		transform: rotate(360deg);
	}
}

.upm__grid {
	display: grid;
	grid-template-columns: 15rem 1fr;
	gap: 1.25rem;
}

/* Левая колонка — сцена скина: прозрачная, с мягким свечением за моделью. */
.upm__skin {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 24rem;
	border-radius: 1rem;
	background: linear-gradient(180deg, var(--color-button-bg), transparent 80%);
	overflow: hidden;
}

.upm__canvas {
	width: 100%;
	height: 100%;
}

.upm__skin-fallback {
	width: 8rem;
	image-rendering: pixelated;
}

/* Правая колонка — карточки данных на плотном фоне. */
.upm__main {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	min-width: 0;
}

.upm__head {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}

.upm__avatar {
	width: 3.25rem;
	height: 3.25rem;
	border-radius: 0.75rem;
	object-fit: cover;
	image-rendering: pixelated;
	flex-shrink: 0;
}

.upm__avatar--stub {
	background: var(--color-button-bg);
}

.upm__id {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	min-width: 0;
}

.upm__name {
	font-size: 1.15rem;
	font-weight: 700;
	color: var(--color-contrast);
	overflow-wrap: anywhere;
}

.upm__badges {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.upm__chip {
	font-size: 0.72rem;
	font-weight: 700;
	padding: 0.15rem 0.5rem;
	border-radius: 0.5rem;
	background: var(--color-button-bg);
	color: var(--color-text);
}

.upm__dot {
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	background: var(--color-text-inactive);
}

.upm__dot.is-on {
	background: var(--color-green);
}

.upm__status {
	font-size: 0.8rem;
	color: var(--color-text-inactive);
}

.upm__cards {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.upm__card {
	display: grid;
	grid-template-columns: 8.5rem 1fr;
	grid-template-rows: auto auto;
	column-gap: 0.75rem;
	align-items: baseline;
	padding: 0.5rem 0.65rem;
	border-radius: 0.75rem;
	background: var(--color-bg);
	animation: upm-in 0.25s ease both;
}

@keyframes upm-in {
	from {
		opacity: 0;
		transform: translateY(6px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

.upm__card-label {
	font-size: 0.8rem;
	color: var(--color-text-inactive);
}

.upm__card-value {
	font-size: 0.9rem;
	font-weight: 600;
	color: var(--color-contrast);
	overflow-wrap: anywhere;
}

.upm__card-value.is-marker {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
}

.upm__marker {
	width: 0.9rem;
	height: 0.9rem;
	border-radius: 0.35rem;
	flex-shrink: 0;
}

.upm__card-sub {
	grid-column: 2;
	font-size: 0.75rem;
	color: var(--color-text-inactive);
}

.upm__stats {
	display: flex;
	gap: 0.5rem;
	margin-top: 0.25rem;
}

.upm__stat {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.15rem;
	padding: 0.6rem 0.5rem;
	border-radius: 0.75rem;
	background: var(--color-bg);
}

.upm__stat b {
	font-size: 1.05rem;
	color: var(--color-contrast);
}

.upm__stat span {
	font-size: 0.72rem;
	color: var(--color-text-inactive);
}

.upm__actions {
	display: flex;
	gap: 0.5rem;
	justify-content: flex-end;
}
</style>
