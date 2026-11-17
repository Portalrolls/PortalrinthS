<script setup lang="ts">
import { CrownIcon, ShieldIcon } from '@modrinth/assets'
import { computed } from 'vue'

import { useMessengerT } from './i18n'
import type { Member } from './model'
import {
	activeConversation,
	activeServer,
	displayName,
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
const peerServers = computed(() => (peer.value ? sharedServers(peer.value.id) : []))
const peerFriends = computed(() =>
	peer.value ? state.friends.some((friend) => friend.id === peer.value!.id) : false,
)

const groups = computed(() => {
	const server = activeServer.value
	if (!server) return []
	void state.clock
	const hoisted = [...server.roles]
		.filter((role) => role.name)
		.sort((a, b) => b.position - a.position)
	const online: Member[] = []
	const offline: Member[] = []
	for (const member of server.members) {
		if (presenceFor(member.id) === 'offline') offline.push(member)
		else online.push(member)
	}
	const byName = (a: Member, b: Member) =>
		displayName(a.id, a.username).localeCompare(displayName(b.id, b.username))
	const out: { id: string; label: string; color: string; members: Member[] }[] = []
	const taken = new Set<string>()
	const staff = online.filter((member) => member.role === 'owner' || member.role === 'admin')
	if (staff.length) {
		out.push({
			id: 'staff',
			label: t('app.messenger.members.staff', 'Администрация'),
			color: '',
			members: staff.sort(byName),
		})
		staff.forEach((member) => taken.add(member.id))
	}
	for (const role of hoisted) {
		const members = online.filter(
			(member) => !taken.has(member.id) && member.roleIds.includes(role.id),
		)
		if (!members.length) continue
		members.forEach((member) => taken.add(member.id))
		out.push({ id: role.id, label: role.name, color: role.color, members: members.sort(byName) })
	}
	const rest = online.filter((member) => !taken.has(member.id))
	if (rest.length) {
		out.push({
			id: 'online',
			label: t('app.messenger.members.online', 'В сети'),
			color: '',
			members: rest.sort(byName),
		})
	}
	if (offline.length) {
		out.push({
			id: 'offline',
			label: t('app.messenger.members.offline', 'Не в сети'),
			color: '',
			members: offline.sort(byName),
		})
	}
	return out
})

function roleColor(member: Member): string {
	const server = activeServer.value
	if (!server) return ''
	return (
		server.roles
			.filter((role) => member.roleIds.includes(role.id) && role.color)
			.sort((a, b) => b.position - a.position)[0]?.color ?? ''
	)
}

function activityText(id: string): string {
	const activity = userOf(id)?.activity
	if (!activity) return ''
	if (activity.hosting || activity.worldShare)
		return t('app.messenger.activity.hosting', 'Открыл мир по сети')
	if (activity.playing) {
		return activity.serverName
			? t('app.messenger.activity.server', 'Играет на {name}', { name: activity.serverName })
			: t('app.messenger.activity.playing', 'Играет в Minecraft')
	}
	return ''
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
				<div class="msgr-members__banner" />
				<button
					type="button"
					class="msgr-members__peer-avatar"
					@click="openProfile(peer.id, peer.username)"
				>
					<UserAvatar :user-id="peer.id" :name="peer.username" :size="80" status ring="#18191c" />
				</button>
				<div class="msgr-members__peer-body">
					<h3>{{ displayName(peer.id, peer.username) }}</h3>
					<span class="msgr-members__peer-handle">{{ peer.username }}</span>
					<span class="msgr-members__peer-status" :class="`is-${presenceFor(peer.id)}`">{{
						activityText(peer.id) || statusText(peer.id)
					}}</span>
					<div class="msgr-members__peer-card">
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
						v-for="member in group.members"
						:key="member.id"
						type="button"
						class="msgr-members__item"
						:class="{ 'is-offline': presenceFor(member.id) === 'offline' }"
						@click="openPopover(member.id, member.username, $event.currentTarget as HTMLElement)"
					>
						<UserAvatar
							:user-id="member.id"
							:name="member.username"
							:size="32"
							status
							ring="#18191c"
						/>
						<span class="msgr-members__item-body">
							<span
								class="msgr-members__item-name"
								:style="roleColor(member) ? { color: roleColor(member) } : undefined"
							>
								{{ displayName(member.id, member.username) }}
								<CrownIcon v-if="member.role === 'owner'" class="msgr-members__crown" />
								<ShieldIcon v-else-if="member.role === 'admin'" class="msgr-members__shield" />
							</span>
							<small v-if="activityText(member.id)">{{ activityText(member.id) }}</small>
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
	background: rgba(18, 19, 22, 0.6);
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
	background: #18191c;
}

.msgr-members__banner {
	height: 6.5rem;
	background:
		radial-gradient(circle at 20% 0%, rgba(255, 255, 255, 0.2), transparent 60%),
		linear-gradient(135deg, var(--color-brand), #5b1a8a);
}

.msgr-members__peer-avatar {
	position: absolute;
	left: 1rem;
	top: 2.4rem;
	padding: 6px;
	border: 0;
	border-radius: 50%;
	background: #18191c;
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

.msgr-members__peer-status.is-online {
	color: #23a55a;
}

.msgr-members__peer-card {
	margin-top: 0.8rem;
	padding: 0.7rem;
	border-radius: 8px;
	background: #111214;
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
	background: #2b2d31;
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
	background: #2b2d31;
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
