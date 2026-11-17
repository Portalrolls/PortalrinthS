<script setup lang="ts">
import { BanIcon, CopyIcon, MessageIcon, UserIcon, UserPlusIcon, UserXIcon } from '@modrinth/assets'
import { computed } from 'vue'

import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import PhoneIcon from './PhoneIcon.vue'
import {
	activeServer,
	callUser,
	canManage,
	displayName,
	isOwner,
	kickMember,
	memberOf,
	myId,
	presenceFor,
	relationOf,
	requestFriend,
	showToast,
	userOf,
	writeTo,
} from './store'
import { askConfirm, closePopover, openProfile, popover } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const user = computed(() => (popover.userId ? userOf(popover.userId) : null))
const name = computed(() => displayName(popover.userId, popover.name || user.value?.username || ''))
const member = computed(() => memberOf(activeServer.value, popover.userId))
const self = computed(() => popover.userId === myId.value)
const relation = computed(() => relationOf(popover.userId))

const roles = computed(() => {
	const server = activeServer.value
	if (!server || !member.value) return []
	return server.roles.filter((role) => member.value!.roleIds.includes(role.id))
})

const canKick = computed(() => {
	const server = activeServer.value
	if (!server || self.value || !canManage.value || !member.value) return false
	if (member.value.role === 'owner') return false
	return isOwner(server) || member.value.role !== 'admin'
})

const statusLabel = computed(() => {
	switch (presenceFor(popover.userId)) {
		case 'online':
			return t('app.messenger.status.online', 'В сети')
		case 'busy':
			return t('app.messenger.status.busy', 'Отошёл')
		case 'dnd':
			return t('app.messenger.status.dnd', 'Не беспокоить')
		default:
			return t('app.messenger.status.offline', 'Не в сети')
	}
})

function profile(): void {
	const id = popover.userId
	closePopover()
	openProfile(id, name.value)
}

async function write(): Promise<void> {
	const target = { id: popover.userId, username: user.value?.username || popover.name }
	closePopover()
	await writeTo(target)
}

async function call(): Promise<void> {
	const target = { id: popover.userId, username: user.value?.username || popover.name }
	closePopover()
	await callUser(target)
}

async function addFriend(): Promise<void> {
	const id = popover.userId
	if (await requestFriend(id)) showToast(t('app.messenger.friends.sent', 'Заявка отправлена'))
}

async function copyId(): Promise<void> {
	await navigator.clipboard.writeText(popover.userId).catch(() => undefined)
	showToast(t('app.messenger.copied.id', 'ID скопирован'))
}

async function kick(): Promise<void> {
	const server = activeServer.value
	const id = popover.userId
	const label = name.value
	closePopover()
	if (!server) return
	const ok = await askConfirm({
		title: t('app.messenger.members.kickTitle', 'Исключить {name}', { name: label }),
		text: t(
			'app.messenger.members.kickText',
			'{name} будет удалён с сервера «{server}». Его можно будет пригласить снова.',
			{
				name: label,
				server: server.title,
			},
		),
		confirm: t('app.messenger.members.kick', 'Исключить'),
		danger: true,
	})
	if (ok) await kickMember(server.id, id)
}
</script>

<template>
	<FloatingMenu :anchor="popover.anchor" placement="left-start" :width="300" @close="closePopover">
		<div v-if="popover.userId" class="msgr-pop">
			<div class="msgr-pop__banner" />
			<div class="msgr-pop__avatar">
				<UserAvatar :user-id="popover.userId" :name="name" :size="72" status ring="#111214" />
			</div>
			<div class="msgr-pop__body">
				<h3>{{ name }}</h3>
				<span class="msgr-pop__handle">{{ user?.username || popover.name }}</span>
				<span class="msgr-pop__status">{{ statusLabel }}</span>
				<div
					v-if="roles.length || member?.role === 'owner' || member?.role === 'admin'"
					class="msgr-pop__roles"
				>
					<span v-if="member?.role === 'owner'" class="msgr-pop__role">
						<i style="background: #f0b232" />{{ t('app.messenger.role.owner', 'Владелец') }}
					</span>
					<span v-else-if="member?.role === 'admin'" class="msgr-pop__role">
						<i style="background: var(--color-brand)" />{{
							t('app.messenger.role.admin', 'Администратор')
						}}
					</span>
					<span v-for="role in roles" :key="role.id" class="msgr-pop__role">
						<i :style="{ background: role.color || '#80848e' }" />{{ role.name }}
					</span>
				</div>
				<div class="msgr-pop__actions">
					<button type="button" class="msgr-pop__primary" @click="profile">
						<UserIcon /> {{ t('app.messenger.viewProfile', 'Посмотреть профиль') }}
					</button>
					<template v-if="!self && !user?.bot">
						<button type="button" @click="write">
							<MessageIcon /> {{ t('app.messenger.write', 'Написать') }}
						</button>
						<button type="button" @click="call">
							<PhoneIcon /> {{ t('app.messenger.call.action', 'Позвонить') }}
						</button>
					</template>
				</div>
				<div class="msgr-pop__links">
					<button
						v-if="relation === 'none' && !user?.bot"
						type="button"
						class="msgr-menu-item"
						@click="addFriend"
					>
						<UserPlusIcon /> {{ t('app.messenger.friends.add', 'Добавить в друзья') }}
					</button>
					<button type="button" class="msgr-menu-item" @click="copyId">
						<CopyIcon /> {{ t('app.messenger.copyUserId', 'Копировать ID пользователя') }}
					</button>
					<button v-if="canKick" type="button" class="msgr-menu-item is-danger" @click="kick">
						<UserXIcon /> {{ t('app.messenger.members.kick', 'Исключить') }}
					</button>
					<span v-if="relation === 'blocked'" class="msgr-pop__blocked">
						<BanIcon /> {{ t('app.messenger.friends.blockedBadge', 'Заблокирован') }}
					</span>
				</div>
			</div>
		</div>
	</FloatingMenu>
</template>

<style scoped>
.msgr-pop {
	position: relative;
	margin: -0.4rem;
	overflow: hidden;
	border-radius: 10px;
}

.msgr-pop__banner {
	height: 4.2rem;
	background: linear-gradient(135deg, var(--color-brand), #4a1572);
}

.msgr-pop__avatar {
	position: absolute;
	left: 0.9rem;
	top: 1.6rem;
	padding: 5px;
	border-radius: 50%;
	background: #111214;
}

.msgr-pop__body {
	padding: 2.6rem 0.9rem 0.8rem;
}

.msgr-pop__body h3 {
	margin: 0;
	color: var(--color-contrast);
	font-size: 1.15rem;
	font-weight: 800;
}

.msgr-pop__handle,
.msgr-pop__status {
	display: block;
	color: var(--color-secondary);
	font-size: 0.8rem;
}

.msgr-pop__roles {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
	margin-top: 0.6rem;
}

.msgr-pop__role {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.1rem 0.45rem;
	border-radius: 4px;
	background: rgba(255, 255, 255, 0.06);
	color: var(--color-contrast);
	font-size: 0.72rem;
}

.msgr-pop__role i {
	width: 0.6rem;
	height: 0.6rem;
	border-radius: 50%;
}

.msgr-pop__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	margin-top: 0.8rem;
}

.msgr-pop__actions button {
	display: inline-flex;
	flex: 1;
	align-items: center;
	justify-content: center;
	gap: 0.35rem;
	padding: 0.5rem 0.6rem;
	border: 0;
	border-radius: 6px;
	background: #2b2d31;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.8rem;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
	transition:
		background 0.12s ease,
		filter 0.12s ease;
}

.msgr-pop__actions button:hover {
	background: #383a40;
}

.msgr-pop__actions .msgr-pop__primary {
	flex-basis: 100%;
	background: var(--color-brand);
	color: white;
}

.msgr-pop__actions .msgr-pop__primary:hover {
	background: var(--color-brand);
	filter: brightness(1.12);
}

.msgr-pop__actions svg {
	width: 1rem;
	height: 1rem;
}

.msgr-pop__links {
	margin-top: 0.5rem;
	padding-top: 0.4rem;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.msgr-pop__blocked {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.4rem 0.6rem;
	color: #f87171;
	font-size: 0.8rem;
}

.msgr-pop__blocked svg {
	width: 1rem;
	height: 1rem;
}
</style>
