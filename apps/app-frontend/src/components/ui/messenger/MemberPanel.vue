<script setup lang="ts">
import { CrownIcon, ShieldIcon } from '@modrinth/assets'
import { computed, watch } from 'vue'

import { useMessengerT } from './i18n'
import { activityLine, isInGame, type Member } from './model'
import { cardOf, requestCard } from './profile-card'
import {
	activeConversation,
	activeServer,
	displayName,
	nameOf,
	openServer,
	presenceFor,
	sharedServers,
	state,
	userOf,
} from './store'
import { openPopover, openProfile } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const conv = computed(() => activeConversation.value)
const peer = computed(() =>
	conv.value?.peer ? (userOf(conv.value.peer.id) ?? conv.value.peer) : null,
)
const peerCard = computed(() => (peer.value ? cardOf(peer.value.id) : null))

const peerBanner = computed(() => {
	const card = peerCard.value
	if (!card) return undefined
	if (card.bannerImage) return { backgroundImage: `url("${card.bannerImage}")` }
	const color = card.bannerColor || card.accent
	return color ? { background: `linear-gradient(135deg, ${color}, ${color}99)` } : undefined
})

watch(
	() => peer.value?.id,
	(id) => {
		if (id) requestCard(id)
	},
	{ immediate: true },
)

const peerServers = computed(() => (peer.value ? sharedServers(peer.value.id) : []))
const peerFriends = computed(() =>
	peer.value ? state.friends.some((friend) => friend.id === peer.value!.id) : false,
)

type MemberRow = {
	member: Member
	name: string
	color: string
	activity: string
	offline: boolean
}

/**
 * Список собирается один раз на изменение состава/статусов, а не на каждый
 * кадр: у больших серверов сотни участников, и считать имя, цвет роли и
 * активность прямо в шаблоне было слишком дорого.
 */
const groups = computed(() => {
	const server = activeServer.value
	if (!server) return []
	void state.presenceClock
	const hoisted = [...server.roles]
		.filter((role) => role.name)
		.sort((a, b) => b.position - a.position)
	const colored = server.roles.filter((role) => role.color).sort((a, b) => b.position - a.position)
	const online: MemberRow[] = []
	const offline: MemberRow[] = []
	for (const member of server.members) {
		const isOffline = presenceFor(member.id) === 'offline'
		const row: MemberRow = {
			member,
			name: member.nickname || nameOf(member.id) || member.username,
			color: colored.find((role) => member.roleIds.includes(role.id))?.color ?? '',
			activity: activityText(member.id),
			offline: isOffline,
		}
		if (isOffline) offline.push(row)
		else online.push(row)
	}
	const byName = (a: MemberRow, b: MemberRow) => a.name.localeCompare(b.name)
	const out: { id: string; label: string; members: MemberRow[] }[] = []
	const taken = new Set<string>()
	const staff = online.filter((row) => row.member.role === 'owner' || row.member.role === 'admin')
	if (staff.length) {
		out.push({
			id: 'staff',
			label: t('app.messenger.members.staff', 'Администрация'),
			members: staff.sort(byName),
		})
		staff.forEach((row) => taken.add(row.member.id))
	}
	for (const role of hoisted) {
		const members = online.filter(
			(row) => !taken.has(row.member.id) && row.member.roleIds.includes(role.id),
		)
		if (!members.length) continue
		members.forEach((row) => taken.add(row.member.id))
		out.push({ id: role.id, label: role.name, members: members.sort(byName) })
	}
	const rest = online.filter((row) => !taken.has(row.member.id))
	if (rest.length) {
		out.push({
			id: 'online',
			label: t('app.messenger.members.online', 'В сети'),
			members: rest.sort(byName),
		})
	}
	if (offline.length) {
		out.push({
			id: 'offline',
			label: t('app.messenger.members.offline', 'Не в сети'),
			members: offline.sort(byName),
		})
	}
	return out
})

function activityText(id: string): string {
	return activityLine(userOf(id)?.activity, t)
}

function statusText(id: string): string {
	switch (presenceFor(id)) {
		case 'online':
			return t('app.messenger.status.online', 'В сети')
		case 'busy':
			return t('app.messenger.status.busy', 'Отошёл')
		case 'dnd':
			return t('app.messenger.status.dnd', 'Не беспокоить')
		default:
			return t('app.messenger.status.offline', 'Не в сети')
	}
}
</script>

<template>
	<aside class="msgr-members">
		<template v-if="conv?.dm && peer">
			<div class="msgr-members__peer">
				<div class="msgr-members__banner" :style="peerBanner" />
				<button
					type="button"
					class="msgr-members__peer-avatar"
					@click="openProfile(peer.id, peer.username)"
				>
					<UserAvatar
						:user-id="peer.id"
						:name="peer.username"
						:size="80"
						status
						ring="var(--msgr-peer)"
					/>
				</button>
				<div class="msgr-members__peer-body">
					<h3 :style="peerCard?.accent ? { color: peerCard.accent } : undefined">
						{{ displayName(peer.id, peer.username) }}
					</h3>
					<span class="msgr-members__peer-handle">{{ peer.username }}</span>
					<span
						class="msgr-members__peer-status"
						:class="isInGame(peer) ? 'is-game' : `is-${presenceFor(peer.id)}`"
						>{{ activityText(peer.id) || statusText(peer.id) }}</span
					>
					<span v-if="peerCard?.pronouns" class="msgr-members__peer-handle">{{
						peerCard.pronouns
					}}</span>
					<div v-if="peerCard?.bio" class="msgr-members__peer-card">
						<div class="msgr-members__peer-label">
							{{ t('app.messenger.profile.about', 'Обо мне') }}
						</div>
						<p class="msgr-members__peer-bio">{{ peerCard.bio }}</p>
					</div>
					<div class="msgr-members__peer-card">
						<div v-if="peerCard?.accent || peerCard?.bannerColor" class="msgr-members__peer-row">
							<span>{{ t('app.messenger.peer.accent', 'Цвет профиля') }}</span>
							<b class="msgr-members__peer-swatch">
								<span :style="{ background: peerCard.accent || peerCard.bannerColor }" />
								{{ peerCard.accent || peerCard.bannerColor }}
							</b>
						</div>
						<div class="msgr-members__peer-row">
							<span>{{ t('app.messenger.peer.account', 'Аккаунт') }}</span>
							<b>{{ peer.provider === 'ely' ? 'Ely.by' : peer.bot ? 'Bot' : 'Microsoft' }}</b>
						</div>
						<div class="msgr-members__peer-row">
							<span>{{ t('app.messenger.peer.relation', 'Отношения') }}</span>
							<b>{{
								peerFriends
									? t('app.messenger.peer.friend', 'Друг')
									: t('app.messenger.peer.notFriend', 'Не в друзьях')
							}}</b>
						</div>
					</div>
					<div v-if="peerServers.length" class="msgr-members__peer-card">
						<div class="msgr-members__peer-label">
							{{
								t('app.messenger.peer.sharedServers', 'Общие серверы — {count}', {
									count: peerServers.length,
								})
							}}
						</div>
						<button
							v-for="server in peerServers"
							:key="server.id"
							type="button"
							class="msgr-members__shared"
							@click="openServer(server.id)"
						>
							<span class="msgr-members__shared-icon">
								<img v-if="server.avatarUrl" :src="server.avatarUrl" alt="" />
								<template v-else>{{ server.title.slice(0, 1) }}</template>
							</span>
							{{ server.title }}
						</button>
					</div>
					<button
						type="button"
						class="msgr-members__full"
						@click="openProfile(peer.id, peer.username)"
					>
						{{ t('app.messenger.peer.fullProfile', 'Открыть полный профиль') }}
					</button>
				</div>
			</div>
		</template>
		<template v-else-if="activeServer">
			<div class="msgr-members__scroll">
				<section v-for="group in groups" :key="group.id" class="msgr-members__group">
					<h4>{{ group.label }} — {{ group.members.length }}</h4>
					<button
						v-for="row in group.members"
						:key="row.member.id"
						type="button"
						class="msgr-members__item"
						:class="{ 'is-offline': row.offline }"
						@click="
							openPopover(row.member.id, row.member.username, $event.currentTarget as HTMLElement)
						"
					>
						<UserAvatar
							:user-id="row.member.id"
							:name="row.member.username"
							:size="32"
							status
							ring="var(--msgr-peer)"
						/>
						<span class="msgr-members__item-body">
							<span
								class="msgr-members__item-name"
								:style="row.color ? { color: row.color } : undefined"
							>
								{{ row.name }}
								<CrownIcon v-if="row.member.role === 'owner'" class="msgr-members__crown" />
								<ShieldIcon v-else-if="row.member.role === 'admin'" class="msgr-members__shield" />
							</span>
							<small v-if="row.activity">{{ row.activity }}</small>
						</span>
					</button>
				</section>
				<p v-if="!groups.length" class="msgr-members__empty">
					{{ t('app.messenger.members.loading', 'Загружаем участников…') }}
				</p>
			</div>
		</template>
	</aside>
</template>

<style scoped>
.msgr-members {
	display: flex;
	width: 16.5rem;
	flex-shrink: 0;
	flex-direction: column;
	border-left: 1px solid rgba(0, 0, 0, 0.3);
	background: var(--msgr-glass);
	backdrop-filter: blur(16px);
}

.msgr-members__scroll {
	min-height: 0;
	flex: 1;
	overflow-y: auto;
	padding: 0.5rem 0.5rem 1rem;
}

.msgr-members__group h4 {
	margin: 1rem 0.5rem 0.3rem;
	color: var(--color-secondary);
	font-size: 0.7rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.msgr-members__item {
	display: flex;
	content-visibility: auto;
	contain-intrinsic-size: auto 44px;
	width: 100%;
	align-items: center;
	gap: 0.6rem;
	padding: 0.3rem 0.5rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-base);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition:
		background 0.12s ease,
		opacity 0.12s ease;
}

.msgr-members__item:hover {
	background: rgba(255, 255, 255, 0.05);
}

.msgr-members__item.is-offline {
	opacity: 0.45;
}

.msgr-members__item.is-offline:hover {
	opacity: 1;
}

.msgr-members__item-body {
	display: flex;
	min-width: 0;
	flex-direction: column;
}

.msgr-members__item-name {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 0.9rem;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-members__item-body small {
	overflow: hidden;
	color: var(--color-secondary);
	font-size: 0.72rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-members__crown {
	width: 0.85rem;
	height: 0.85rem;
	color: #f0b232;
}

.msgr-members__shield {
	width: 0.85rem;
	height: 0.85rem;
	color: color-mix(in srgb, var(--color-brand) 70%, white);
}

.msgr-members__empty {
	padding: 1rem;
	color: var(--color-secondary);
	font-size: 0.85rem;
}

.msgr-members__peer {
	position: relative;
	min-height: 0;
	flex: 1;
	overflow-y: auto;
	background: var(--msgr-peer);
}

.msgr-members__banner {
	height: 6.5rem;
	background:
		radial-gradient(circle at 20% 0%, rgba(255, 255, 255, 0.2), transparent 60%),
		linear-gradient(135deg, var(--color-brand), #5b1a8a);
	background-position: center;
	background-size: cover;
}

.msgr-members__peer-avatar {
	position: absolute;
	left: 1rem;
	top: 2.4rem;
	padding: 6px;
	border: 0;
	border-radius: 50%;
	background: var(--msgr-peer);
	cursor: pointer;
	transition: transform 0.15s ease;
}

.msgr-members__peer-avatar:hover {
	transform: scale(1.03);
}

.msgr-members__peer-body {
	padding: 3.2rem 1rem 1rem;
}

.msgr-members__peer-body h3 {
	margin: 0;
	color: var(--color-contrast);
	font-size: 1.25rem;
	font-weight: 800;
}

.msgr-members__peer-handle {
	display: block;
	color: var(--color-base);
	font-size: 0.85rem;
}

.msgr-members__peer-status {
	display: block;
	margin-top: 0.5rem;
	color: var(--color-secondary);
	font-size: 0.8rem;
}

.msgr-members__peer-status.is-online,
.msgr-members__peer-status.is-game {
	color: #23a55a;
}

.msgr-members__peer-status.is-game {
	font-weight: 600;
}

.msgr-members__peer-bio {
	margin: 0.35rem 0 0;
	color: var(--color-text);
	font-size: 0.82rem;
	line-height: 1.4;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.msgr-members__peer-card {
	margin-top: 0.8rem;
	padding: 0.7rem;
	border-radius: 8px;
	background: var(--msgr-inset);
}

.msgr-members__peer-row {
	display: flex;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.15rem 0;
	font-size: 0.8rem;
}

.msgr-members__peer-row span {
	color: var(--color-secondary);
}

.msgr-members__peer-row b {
	color: var(--color-contrast);
}

.msgr-members__peer-swatch {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
}

.msgr-members__peer-swatch span {
	width: 0.9rem;
	height: 0.9rem;
	flex-shrink: 0;
	border-radius: 4px;
	box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
}

.msgr-members__peer-label {
	margin-bottom: 0.4rem;
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 700;
	text-transform: uppercase;
}

.msgr-members__shared {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 0.5rem;
	padding: 0.3rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: 0.85rem;
	text-align: left;
	cursor: pointer;
}

.msgr-members__shared:hover {
	background: rgba(255, 255, 255, 0.05);
}

.msgr-members__shared-icon {
	display: grid;
	width: 1.6rem;
	height: 1.6rem;
	overflow: hidden;
	place-items: center;
	border-radius: 8px;
	background: var(--msgr-btn);
	font-size: 0.7rem;
	font-weight: 700;
}

.msgr-members__shared-icon img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.msgr-members__full {
	width: 100%;
	margin-top: 0.9rem;
	padding: 0.6rem;
	border: 0;
	border-radius: 8px;
	background: var(--msgr-btn);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.85rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-members__full:hover {
	background: var(--color-brand);
}
</style>
