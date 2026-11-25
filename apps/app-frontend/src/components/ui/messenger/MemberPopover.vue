<script setup lang="ts">
import {
	BanIcon,
	CheckIcon,
	CopyIcon,
	EditIcon,
	MessageIcon,
	UserIcon,
	UserPlusIcon,
	UserXIcon,
} from '@modrinth/assets'
import { computed, ref, watch } from 'vue'

import { promptAlias } from './aliases'
import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import PhoneIcon from './PhoneIcon.vue'
import { cardOf, requestCard } from './profile-card'
import {
	activeServer,
	callUser,
	canManage,
	displayName,
	isOwner,
	kickMember,
	me,
	memberOf,
	myId,
	openServer,
	presenceFor,
	relationOf,
	requestFriend,
	showToast,
	state,
	toggleMemberRole,
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

function hasRole(roleId: string): boolean {
	return Boolean(member.value?.roleIds.includes(roleId))
}

/** Созданные роли сервера, которые можно выдать прямо отсюда. */
const assignable = computed(() => {
	if (!canManage.value || self.value || !member.value) return []
	if (member.value.role === 'owner') return []
	return activeServer.value?.roles ?? []
})

const roleBusy = ref<string | null>(null)

async function toggleRole(role: { id: string }): Promise<void> {
	const server = activeServer.value
	if (!server || roleBusy.value) return
	roleBusy.value = role.id
	try {
		await toggleMemberRole(server.id, popover.userId, role.id, !hasRole(role.id))
	} finally {
		roleBusy.value = null
	}
}

const canKick = computed(() => {
	const server = activeServer.value
	if (!server || self.value || !canManage.value || !member.value) return false
	if (member.value.role === 'owner') return false
	return isOwner(server) || member.value.role !== 'admin'
})

function rename(): void {
	const id = popover.userId
	const username = user.value?.username || popover.name
	closePopover()
	void promptAlias(id, username, t)
}

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

/* Карточка профиля: баннер, акцент и «Обо мне». Пока она не доехала — просим
   свежую; отвечает в течение секунды, поповер при этом не мигает. */
const card = computed(() => cardOf(popover.userId))
const accent = computed(() => card.value.accent || card.value.bannerColor || '')

const bannerStyle = computed(() => {
	if (card.value.bannerImage) {
		return { backgroundImage: `url("${card.value.bannerImage}")` }
	}
	const color = accent.value
	if (color) return { background: `linear-gradient(135deg, ${color}, ${color}99)` }
	return {}
})

watch(
	() => [popover.userId, popover.anchor] as const,
	([id, anchor]) => {
		if (id && anchor) requestCard(id)
	},
)

/** Тип аккаунта — как строка «Аккаунт: Ely.by» в Discord. */
const account = computed(() => {
	const u = popover.userId === myId.value ? me.value : user.value
	return u?.provider === 'ely' ? 'Ely.by' : 'Microsoft'
})

const relationLabel = computed(() => {
	switch (relationOf(popover.userId)) {
		case 'friend':
			return t('app.messenger.relation.friend', 'Друг')
		case 'incoming':
			return t('app.messenger.relation.incoming', 'Входящая заявка')
		case 'outgoing':
			return t('app.messenger.relation.outgoing', 'Исходящая заявка')
		default:
			return t('app.messenger.friends.blockedBadge', 'Заблокирован')
	}
})

const relationShown = computed(() => {
	const rel = relationOf(popover.userId)
	return rel !== 'none' && rel !== 'self'
})

/** Серверы, где состоят и этот игрок, и я — блок «Общие серверы» в Discord. */
const mutual = computed(() => {
	const id = popover.userId
	if (!id) return []
	return state.conversations.filter((conv) => !conv.dm && memberOf(conv, id))
})

function openShared(id: string): void {
	closePopover()
	openServer(id)
}

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
	<FloatingMenu
		:anchor="popover.anchor"
		placement="left-start"
		:width="300"
		variant="soft"
		@close="closePopover"
	>
		<div v-if="popover.userId" class="msgr-pop">
			<div
				class="msgr-pop__banner"
				:class="{ 'is-empty': !card.bannerImage && !accent }"
				:style="bannerStyle"
			/>
			<div class="msgr-pop__avatar">
				<UserAvatar
					:user-id="popover.userId"
					:name="name"
					:size="72"
					status
					ring="var(--msgr-inset)"
				/>
			</div>
			<div class="msgr-pop__body">
				<h3>{{ name }}</h3>
				<span class="msgr-pop__handle">{{ user?.username || popover.name }}</span>
				<span class="msgr-pop__status">{{ statusLabel }}</span>
				<div class="msgr-pop__meta">
					<div class="msgr-pop__meta-row">
						<span>{{ t('app.messenger.pop.account', 'Аккаунт') }}</span>
						<b>{{ account }}</b>
					</div>
					<div v-if="relationShown" class="msgr-pop__meta-row">
						<span>{{ t('app.messenger.pop.relation', 'Отношение') }}</span>
						<b>{{ relationLabel }}</b>
					</div>
				</div>
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
						<UserIcon /> {{ t('app.messenger.viewProfile', 'Открыть полный профиль') }}
					</button>
					<template v-if="!self && !user?.bot">
						<button type="button" @click="write">
							<MessageIcon /> {{ t('app.messenger.write', 'Написать') }}
						</button>
						<button v-if="relation === 'friend'" type="button" @click="call">
							<PhoneIcon /> {{ t('app.messenger.call.action', 'Позвонить') }}
						</button>
					</template>
				</div>
				<div v-if="assignable.length" class="msgr-pop__assign">
					<span class="msgr-pop__assign-title">{{ t('app.messenger.roles.assign', 'Роли') }}</span>
					<button
						v-for="role in assignable"
						:key="role.id"
						type="button"
						class="msgr-pop__assign-role"
						:class="{ 'is-on': hasRole(role.id), 'is-busy': roleBusy === role.id }"
						@click="toggleRole(role)"
					>
						<i :style="{ background: role.color || '#80848e' }" />
						<span class="msgr-pop__assign-name">{{ role.name }}</span>
						<CheckIcon v-if="hasRole(role.id)" />
					</button>
				</div>
				<div v-if="mutual.length" class="msgr-pop__mutual">
					<span class="msgr-pop__mutual-title">{{
						t('app.messenger.pop.mutual', 'Общие серверы ({n})', { n: mutual.length })
					}}</span>
					<button
						v-for="conv in mutual.slice(0, 6)"
						:key="conv.id"
						type="button"
						class="msgr-pop__mutual-item"
						@click="openShared(conv.id)"
					>
						<span class="msgr-pop__mutual-avatar">
							<img v-if="conv.avatarUrl" :src="conv.avatarUrl" alt="" draggable="false" />
							<UserIcon v-else />
						</span>
						<span class="msgr-pop__mutual-name">{{ conv.title }}</span>
					</button>
					<span v-if="mutual.length > 6" class="msgr-pop__mutual-more">{{
						t('app.messenger.pop.mutualMore', 'и ещё {n}…', { n: mutual.length - 6 })
					}}</span>
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
					<button v-if="!self && !user?.bot" type="button" class="msgr-menu-item" @click="rename">
						<EditIcon /> {{ t('app.messenger.alias.action', 'Изменить имя') }}
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
	background-size: cover;
	background-position: center;
}

.msgr-pop__banner.is-empty {
	background: linear-gradient(135deg, var(--color-brand), #4a1572);
}

.msgr-pop__avatar {
	position: absolute;
	left: 0.9rem;
	top: 1.6rem;
	padding: 5px;
	border-radius: 50%;
	background: var(--msgr-inset);
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

.msgr-pop__meta {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	margin-top: 0.55rem;
	padding: 0.5rem 0.6rem;
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.28);
}

.msgr-pop__meta-row {
	display: flex;
	justify-content: space-between;
	gap: 0.6rem;
	font-size: 0.78rem;
}

.msgr-pop__meta-row span {
	color: var(--color-secondary);
}

.msgr-pop__meta-row b {
	overflow: hidden;
	color: var(--color-contrast);
	font-weight: 600;
	text-align: right;
	text-overflow: ellipsis;
	white-space: nowrap;
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
	background: var(--msgr-btn);
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
	background: var(--msgr-btn3);
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

.msgr-pop__assign {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
	margin-top: 0.6rem;
	padding-top: 0.5rem;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.msgr-pop__assign-title {
	flex-basis: 100%;
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.msgr-pop__assign-role {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	max-width: 100%;
	padding: 0.15rem 0.5rem;
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.04);
	color: var(--color-secondary);
	font: inherit;
	font-size: 0.74rem;
	cursor: pointer;
	transition:
		background 0.12s ease,
		color 0.12s ease;
}

.msgr-pop__assign-role:hover {
	background: rgba(255, 255, 255, 0.1);
	color: var(--color-contrast);
}

.msgr-pop__assign-role.is-on {
	border-color: rgba(255, 255, 255, 0.18);
	background: rgba(255, 255, 255, 0.09);
	color: var(--color-contrast);
}

.msgr-pop__assign-role.is-busy {
	opacity: 0.55;
}

.msgr-pop__assign-role svg {
	width: 0.8rem;
	height: 0.8rem;
	flex-shrink: 0;
}

.msgr-pop__assign-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-pop__links {
	margin-top: 0.5rem;
	padding-top: 0.4rem;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.msgr-pop__mutual {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	margin-top: 0.6rem;
	padding-top: 0.5rem;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.msgr-pop__mutual-title {
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.msgr-pop__mutual-item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.25rem 0.35rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-base);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-pop__mutual-item:hover {
	background: var(--msgr-btn);
}

.msgr-pop__mutual-avatar {
	display: grid;
	width: 1.7rem;
	height: 1.7rem;
	flex-shrink: 0;
	place-items: center;
	border-radius: 50%;
	background: var(--msgr-btn2);
	color: var(--color-secondary);
	overflow: hidden;
}

.msgr-pop__mutual-avatar img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.msgr-pop__mutual-avatar svg {
	width: 0.85rem;
	height: 0.85rem;
}

.msgr-pop__mutual-name {
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 0.8rem;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-pop__mutual-more {
	padding-left: 0.35rem;
	color: var(--color-secondary);
	font-size: 0.72rem;
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
