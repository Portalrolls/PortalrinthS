<script setup lang="ts">
import { CopyIcon, ImageIcon, PlusIcon, TrashIcon, XIcon } from '@modrinth/assets'
import { NewModal } from '@modrinth/ui'
import { computed, ref } from 'vue'

import { compressImageFile } from '@/helpers/uprojects-service'

import { useMessengerT } from './i18n'
import { formatDate } from './model'
import {
	addMembers,
	canManageServer,
	createInvite,
	createRole,
	deleteInvite,
	deleteRole,
	deleteServer,
	displayName,
	hideConversation,
	type Invite,
	isOwner,
	kickMember,
	leaveServer,
	listInvites,
	myId,
	showToast,
	state,
	toggleMemberRole,
	updateServer,
} from './store'
import { askConfirm, openProfile } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

type Tab = 'overview' | 'invites' | 'members' | 'roles' | 'danger'

const t = useMessengerT()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const avatarInput = ref<HTMLInputElement | null>(null)
const coverInput = ref<HTMLInputElement | null>(null)
const convId = ref('')
const tab = ref<Tab>('overview')
const title = ref('')
const description = ref('')
const avatar = ref('')
const cover = ref('')
const avatarChanged = ref(false)
const coverChanged = ref(false)
const busy = ref(false)
const invites = ref<Invite[] | null>(null)
const inviteExpires = ref(7 * 24 * 3600 * 1000)
const inviteUses = ref(0)
const memberFilter = ref('')
const adding = ref<string[]>([])
const roleName = ref('')
const roleColor = ref('#9b59b6')
const roleFor = ref('')

const server = computed(() => state.conversations.find((conv) => conv.id === convId.value) ?? null)
const manage = computed(() => (server.value ? canManageServer(server.value) : false))
const owner = computed(() => (server.value ? isOwner(server.value) : false))

const tabs = computed(() => {
	const list: { id: Tab; label: string }[] = [
		{
			id: 'overview',
			label: manage.value
				? t('app.messenger.settings.overview', 'Обзор')
				: t('app.messenger.settings.about', 'О сервере'),
		},
		{ id: 'invites', label: t('app.messenger.settings.invites', 'Приглашения') },
		{ id: 'members', label: t('app.messenger.settings.members', 'Участники') },
	]
	if (manage.value) list.push({ id: 'roles', label: t('app.messenger.settings.roles', 'Роли') })
	list.push({
		id: 'danger',
		label: owner.value
			? t('app.messenger.settings.dangerOwner', 'Удаление')
			: t('app.messenger.settings.leave', 'Покинуть'),
	})
	return list
})

const dirty = computed(() => {
	const conv = server.value
	if (!conv) return false
	return (
		title.value.trim() !== conv.title ||
		description.value.trim() !== conv.description ||
		avatarChanged.value ||
		coverChanged.value
	)
})

const members = computed(() => {
	const lower = memberFilter.value.trim().toLowerCase()
	return (server.value?.members ?? [])
		.filter(
			(member) => !lower || displayName(member.id, member.username).toLowerCase().includes(lower),
		)
		.sort((a, b) => rank(a.role) - rank(b.role) || a.username.localeCompare(b.username))
})

const invitable = computed(() => {
	const inside = new Set((server.value?.members ?? []).map((member) => member.id))
	return state.friends.filter((friend) => !inside.has(friend.id))
})

const expiryOptions = computed(() => [
	{ value: 30 * 60 * 1000, label: t('app.messenger.invite.30m', '30 минут') },
	{ value: 3600 * 1000, label: t('app.messenger.invite.1h', '1 час') },
	{ value: 24 * 3600 * 1000, label: t('app.messenger.invite.1d', '1 день') },
	{ value: 7 * 24 * 3600 * 1000, label: t('app.messenger.invite.7d', '7 дней') },
	{ value: 0, label: t('app.messenger.invite.never', 'Бессрочно') },
])

function rank(role: string): number {
	return role === 'owner' ? 0 : role === 'admin' ? 1 : 2
}

function roleLabel(role: string): string {
	if (role === 'owner') return t('app.messenger.role.owner', 'Владелец')
	if (role === 'admin') return t('app.messenger.role.admin', 'Администратор')
	return t('app.messenger.role.member', 'Участник')
}

function reset(): void {
	const conv = server.value
	title.value = conv?.title ?? ''
	description.value = conv?.description ?? ''
	avatar.value = conv?.avatarUrl ?? ''
	cover.value = conv?.coverUrl ?? ''
	avatarChanged.value = false
	coverChanged.value = false
}

function show(id: string, start: string = 'overview'): void {
	convId.value = id
	tab.value = (
		['overview', 'invites', 'members', 'roles', 'danger'].includes(start) ? start : 'overview'
	) as Tab
	invites.value = null
	adding.value = []
	memberFilter.value = ''
	roleFor.value = ''
	reset()
	modal.value?.show()
	if (tab.value === 'invites') void refreshInvites()
}

function selectTab(next: Tab): void {
	tab.value = next
	if (next === 'invites' && invites.value === null) void refreshInvites()
}

async function refreshInvites(): Promise<void> {
	invites.value = (await listInvites(convId.value)) ?? []
}

async function pick(event: Event, kind: 'avatar' | 'cover'): Promise<void> {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	try {
		if (kind === 'avatar') {
			avatar.value = await compressImageFile(file, 512, 0.88)
			avatarChanged.value = true
		} else {
			cover.value = await compressImageFile(file, 1280, 0.85)
			coverChanged.value = true
		}
	} catch {
		showToast(t('app.messenger.image.bad', 'Не удалось прочитать изображение'))
	}
}

async function saveOverview(): Promise<void> {
	if (!title.value.trim() || busy.value) return
	busy.value = true
	const patch: Record<string, unknown> = {
		title: title.value.trim(),
		description: description.value.trim(),
	}
	if (avatarChanged.value) patch.avatarDataUrl = avatar.value || null
	if (coverChanged.value) patch.coverDataUrl = cover.value || null
	const ok = await updateServer(convId.value, patch)
	busy.value = false
	if (ok) {
		reset()
		showToast(t('app.messenger.settings.saved', 'Изменения сохранены'))
	}
}

function inviteLink(invite: Invite): string {
	return invite.link || `undefined://invite/${invite.token}`
}

async function copy(text: string): Promise<void> {
	await navigator.clipboard.writeText(text).catch(() => undefined)
	showToast(t('app.messenger.copied', 'Скопировано'))
}

async function newInvite(): Promise<void> {
	busy.value = true
	const invite = await createInvite(convId.value, inviteExpires.value, inviteUses.value)
	busy.value = false
	if (!invite) return
	await copy(inviteLink(invite))
	await refreshInvites()
	if (!invites.value?.some((row) => row.token === invite.token))
		invites.value = [invite, ...(invites.value ?? [])]
}

async function revoke(invite: Invite): Promise<void> {
	if (await deleteInvite(convId.value, invite.token)) {
		invites.value = (invites.value ?? []).filter((row) => row.token !== invite.token)
	}
}

function toggleAdd(id: string): void {
	adding.value = adding.value.includes(id)
		? adding.value.filter((x) => x !== id)
		: [...adding.value, id]
}

async function addPicked(): Promise<void> {
	if (!adding.value.length) return
	busy.value = true
	const ok = await addMembers(convId.value, adding.value)
	busy.value = false
	if (ok) {
		showToast(t('app.messenger.settings.added', 'Друзья добавлены на сервер'))
		adding.value = []
	}
}

async function kick(id: string, name: string): Promise<void> {
	const ok = await askConfirm({
		title: t('app.messenger.settings.kickTitle', 'Исключить {name}', { name }),
		text: t(
			'app.messenger.settings.kickText',
			'{name} будет удалён с сервера. Вернуться он сможет только по приглашению.',
			{
				name,
			},
		),
		confirm: t('app.messenger.settings.kick', 'Исключить'),
		danger: true,
	})
	if (ok) await kickMember(convId.value, id)
}

async function addRole(): Promise<void> {
	if (!roleName.value.trim()) return
	if (await createRole(convId.value, roleName.value.trim(), roleColor.value)) roleName.value = ''
}

async function leave(): Promise<void> {
	const conv = server.value
	if (!conv) return
	const ok = await askConfirm({
		title: t('app.messenger.settings.leaveTitle', 'Покинуть «{name}»', { name: conv.title }),
		text: t(
			'app.messenger.settings.leaveText',
			'Вы уверены? Вернуться можно будет только по новому приглашению.',
		),
		confirm: t('app.messenger.settings.leave', 'Покинуть'),
		danger: true,
	})
	if (ok && (await leaveServer(conv.id))) modal.value?.hide()
}

async function hide(): Promise<void> {
	await hideConversation(convId.value)
	modal.value?.hide()
}

async function destroy(): Promise<void> {
	const conv = server.value
	if (!conv) return
	const typed = await askConfirm({
		title: t('app.messenger.settings.deleteTitle', 'Удалить «{name}»', { name: conv.title }),
		text: t(
			'app.messenger.settings.deleteText',
			'Сервер, все каналы и сообщения будут удалены навсегда.',
		),
		confirm: t('app.messenger.settings.delete', 'Удалить сервер'),
		danger: true,
	})
	if (typed && (await deleteServer(conv.id))) modal.value?.hide()
}

defineExpose({ show })
</script>

<template>
	<NewModal
		ref="modal"
		:header="server?.title || t('app.messenger.settings.title', 'Настройки сервера')"
		max-width="760px"
		width="760px"
	>
		<div v-if="server" class="msgr-settings">
			<nav class="msgr-settings__nav">
				<button
					v-for="item in tabs"
					:key="item.id"
					type="button"
					:class="{ 'is-active': tab === item.id, 'is-danger': item.id === 'danger' }"
					@click="selectTab(item.id)"
				>
					{{ item.label }}
				</button>
			</nav>
			<div class="msgr-settings__body">
				<template v-if="tab === 'overview'">
					<div
						class="msgr-settings__banner"
						:style="cover ? { backgroundImage: `url(${cover})` } : undefined"
					>
						<button
							v-if="manage"
							type="button"
							class="msgr-settings__banner-edit"
							@click="coverInput?.click()"
						>
							<ImageIcon /> {{ t('app.messenger.settings.banner', 'Сменить баннер') }}
						</button>
						<button
							v-if="manage && cover"
							type="button"
							class="msgr-settings__banner-clear"
							:aria-label="t('app.messenger.settings.removeBanner', 'Убрать баннер')"
							@click="((cover = ''), (coverChanged = true))"
						>
							<XIcon />
						</button>
					</div>
					<div class="msgr-settings__identity">
						<button
							type="button"
							class="msgr-avatar-pick is-small"
							:disabled="!manage"
							@click="avatarInput?.click()"
						>
							<img v-if="avatar" :src="avatar" alt="" />
							<b v-else>{{ (title || server.title).slice(0, 2).toUpperCase() }}</b>
						</button>
						<div class="msgr-settings__identity-text">
							<b>{{ server.title }}</b>
							<small>{{
								t('app.messenger.server.membersCount', 'Участников: {count}', {
									count: server.members.length,
								})
							}}</small>
							<button
								v-if="manage && avatar"
								type="button"
								class="msgr-link"
								@click="((avatar = ''), (avatarChanged = true))"
							>
								{{ t('app.messenger.settings.removeIcon', 'Убрать значок') }}
							</button>
						</div>
					</div>
					<input
						ref="avatarInput"
						type="file"
						accept="image/*"
						hidden
						@change="pick($event, 'avatar')"
					/>
					<input
						ref="coverInput"
						type="file"
						accept="image/*"
						hidden
						@change="pick($event, 'cover')"
					/>
					<template v-if="manage">
						<label class="msgr-field">
							<span>{{ t('app.messenger.server.name', 'Название сервера') }}</span>
							<input v-model="title" type="text" maxlength="80" />
						</label>
						<label class="msgr-field">
							<span>{{ t('app.messenger.server.description', 'Описание') }}</span>
							<textarea v-model="description" rows="3" maxlength="500" />
						</label>
						<Transition name="msgr-pop">
							<div v-if="dirty" class="msgr-settings__save">
								<span>{{
									t('app.messenger.settings.unsaved', 'Есть несохранённые изменения')
								}}</span>
								<button type="button" class="msgr-btn is-ghost" @click="reset">
									{{ t('app.messenger.settings.reset', 'Сбросить') }}
								</button>
								<button
									type="button"
									class="msgr-btn is-ok"
									:disabled="busy || !title.trim()"
									@click="saveOverview"
								>
									{{ t('app.messenger.save', 'Сохранить') }}
								</button>
							</div>
						</Transition>
					</template>
					<p v-else class="msgr-modal__text">
						{{
							server.description || t('app.messenger.settings.noDescription', 'Описание не задано.')
						}}
					</p>
				</template>

				<template v-else-if="tab === 'invites'">
					<p class="msgr-modal__text">
						{{
							t(
								'app.messenger.invite.text',
								'Отправьте другу ссылку — по ней он сразу попадёт на сервер.',
							)
						}}
					</p>
					<div class="msgr-settings__row">
						<label class="msgr-field">
							<span>{{ t('app.messenger.invite.expires', 'Срок действия') }}</span>
							<select v-model.number="inviteExpires">
								<option v-for="option in expiryOptions" :key="option.value" :value="option.value">
									{{ option.label }}
								</option>
							</select>
						</label>
						<label class="msgr-field">
							<span>{{ t('app.messenger.invite.maxUses', 'Лимит использований') }}</span>
							<select v-model.number="inviteUses">
								<option :value="0">
									{{ t('app.messenger.invite.unlimited', 'Без ограничений') }}
								</option>
								<option v-for="n in [1, 5, 10, 25, 100]" :key="n" :value="n">{{ n }}</option>
							</select>
						</label>
						<button type="button" class="msgr-btn" :disabled="busy" @click="newInvite">
							<PlusIcon /> {{ t('app.messenger.invite.create', 'Создать ссылку') }}
						</button>
					</div>
					<div v-if="invites === null" class="msgr-settings__empty">
						<span class="msgr-spinner" />
					</div>
					<p v-else-if="!invites.length" class="msgr-settings__empty">
						{{ t('app.messenger.invite.none', 'Активных приглашений нет.') }}
					</p>
					<div v-for="invite in invites ?? []" :key="invite.token" class="msgr-settings__item">
						<code>{{ inviteLink(invite) }}</code>
						<small>
							{{
								t('app.messenger.invite.uses', 'Использований: {uses}', {
									uses: invite.maxUses ? `${invite.uses}/${invite.maxUses}` : invite.uses,
								})
							}}
							·
							{{
								invite.expiresAt
									? t('app.messenger.invite.until', 'до {date}', {
											date: formatDate(invite.expiresAt),
										})
									: t('app.messenger.invite.never', 'Бессрочно')
							}}
						</small>
						<button
							type="button"
							class="msgr-icon-btn"
							:aria-label="t('app.messenger.copy', 'Копировать')"
							@click="copy(inviteLink(invite))"
						>
							<CopyIcon />
						</button>
						<button
							v-if="manage"
							type="button"
							class="msgr-icon-btn is-danger"
							:aria-label="t('app.messenger.invite.revoke', 'Отозвать')"
							@click="revoke(invite)"
						>
							<TrashIcon />
						</button>
					</div>
				</template>

				<template v-else-if="tab === 'members'">
					<template v-if="invitable.length">
						<h4 class="msgr-modal__sub">
							{{ t('app.messenger.settings.addFriends', 'Добавить друзей') }}
						</h4>
						<div class="msgr-settings__chips">
							<button
								v-for="friend in invitable"
								:key="friend.id"
								type="button"
								class="msgr-chip"
								:class="{ 'is-on': adding.includes(friend.id) }"
								@click="toggleAdd(friend.id)"
							>
								<UserAvatar :user-id="friend.id" :name="friend.username" :size="20" />
								{{ displayName(friend.id, friend.username) }}
							</button>
						</div>
						<button
							v-if="adding.length"
							type="button"
							class="msgr-btn"
							:disabled="busy"
							@click="addPicked"
						>
							{{
								t('app.messenger.settings.addCount', 'Добавить ({count})', { count: adding.length })
							}}
						</button>
					</template>
					<label class="msgr-field is-search">
						<input
							v-model="memberFilter"
							type="search"
							:placeholder="t('app.messenger.settings.searchMembers', 'Поиск участников')"
						/>
					</label>
					<div v-for="member in members" :key="member.id" class="msgr-settings__member">
						<button
							type="button"
							class="msgr-settings__who"
							@click="openProfile(member.id, member.username)"
						>
							<UserAvatar
								:user-id="member.id"
								:name="member.username"
								:size="32"
								status
								ring="#1e1f22"
							/>
							<span>
								<b>{{ displayName(member.id, member.username) }}</b>
								<small>{{ roleLabel(member.role) }}</small>
							</span>
						</button>
						<span class="msgr-settings__roles">
							<i
								v-for="role in server.roles.filter((r) => member.roleIds.includes(r.id))"
								:key="role.id"
								:style="{ '--role': role.color || '#99aab5' }"
							>
								{{ role.name }}
							</i>
						</span>
						<template v-if="manage && member.role !== 'owner' && member.id !== myId">
							<button
								v-if="server.roles.length"
								type="button"
								class="msgr-btn is-ghost is-small"
								@click="roleFor = roleFor === member.id ? '' : member.id"
							>
								{{ t('app.messenger.settings.rolesBtn', 'Роли') }}
							</button>
							<button
								type="button"
								class="msgr-btn is-danger-ghost is-small"
								@click="kick(member.id, member.username)"
							>
								{{ t('app.messenger.settings.kick', 'Исключить') }}
							</button>
						</template>
						<div v-if="roleFor === member.id" class="msgr-settings__role-pick">
							<label v-for="role in server.roles" :key="role.id">
								<input
									type="checkbox"
									:checked="member.roleIds.includes(role.id)"
									@change="
										toggleMemberRole(
											server.id,
											member.id,
											role.id,
											($event.target as HTMLInputElement).checked,
										)
									"
								/>
								<i :style="{ background: role.color || '#99aab5' }" />
								{{ role.name }}
							</label>
						</div>
					</div>
				</template>

				<template v-else-if="tab === 'roles'">
					<p class="msgr-modal__text">
						{{
							t(
								'app.messenger.roles.text',
								'Роли подсвечивают участников цветом и группируют их в списке.',
							)
						}}
					</p>
					<div class="msgr-settings__row">
						<label class="msgr-field">
							<span>{{ t('app.messenger.roles.name', 'Название роли') }}</span>
							<input v-model="roleName" type="text" maxlength="40" @keydown.enter="addRole" />
						</label>
						<label class="msgr-field is-color">
							<span>{{ t('app.messenger.roles.color', 'Цвет') }}</span>
							<input v-model="roleColor" type="color" />
						</label>
						<button type="button" class="msgr-btn" :disabled="!roleName.trim()" @click="addRole">
							<PlusIcon /> {{ t('app.messenger.roles.create', 'Создать роль') }}
						</button>
					</div>
					<p v-if="!server.roles.length" class="msgr-settings__empty">
						{{ t('app.messenger.roles.none', 'Ролей пока нет.') }}
					</p>
					<div v-for="role in server.roles" :key="role.id" class="msgr-settings__item">
						<i class="msgr-settings__dot" :style="{ background: role.color || '#99aab5' }" />
						<b :style="{ color: role.color || undefined }">{{ role.name }}</b>
						<small>{{
							t('app.messenger.roles.count', 'Участников: {count}', {
								count: server.members.filter((member) => member.roleIds.includes(role.id)).length,
							})
						}}</small>
						<button
							type="button"
							class="msgr-icon-btn is-danger"
							:aria-label="t('app.messenger.roles.delete', 'Удалить роль')"
							@click="deleteRole(server.id, role.id)"
						>
							<TrashIcon />
						</button>
					</div>
				</template>

				<template v-else>
					<div v-if="!owner" class="msgr-settings__danger">
						<div>
							<b>{{ t('app.messenger.settings.leave', 'Покинуть') }}</b>
							<small>{{
								t(
									'app.messenger.settings.leaveHint',
									'Сервер пропадёт из списка, сообщения останутся у других участников.',
								)
							}}</small>
						</div>
						<button type="button" class="msgr-btn is-danger" @click="leave">
							{{ t('app.messenger.settings.leave', 'Покинуть') }}
						</button>
					</div>
					<div class="msgr-settings__danger">
						<div>
							<b>{{ t('app.messenger.settings.hide', 'Скрыть сервер') }}</b>
							<small>{{
								t(
									'app.messenger.settings.hideHint',
									'Сервер скроется из списка и вернётся при новом сообщении.',
								)
							}}</small>
						</div>
						<button type="button" class="msgr-btn is-ghost" @click="hide">
							{{ t('app.messenger.settings.hide', 'Скрыть сервер') }}
						</button>
					</div>
					<div v-if="owner" class="msgr-settings__danger">
						<div>
							<b>{{ t('app.messenger.settings.delete', 'Удалить сервер') }}</b>
							<small>{{
								t(
									'app.messenger.settings.deleteHint',
									'Удаляет сервер для всех участников без возможности восстановления.',
								)
							}}</small>
						</div>
						<button type="button" class="msgr-btn is-danger" @click="destroy">
							{{ t('app.messenger.settings.delete', 'Удалить сервер') }}
						</button>
					</div>
				</template>
			</div>
		</div>
	</NewModal>
</template>

<style scoped>
.msgr-settings {
	display: grid;
	min-height: 26rem;
	grid-template-columns: 10.5rem 1fr;
	gap: 1rem;
}

.msgr-settings__nav {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	padding-right: 0.8rem;
	border-right: 1px solid var(--color-divider, rgba(255, 255, 255, 0.08));
}

.msgr-settings__nav button {
	padding: 0.45rem 0.6rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: 0.9rem;
	font-weight: 600;
	text-align: left;
	cursor: pointer;
	transition:
		background 0.12s ease,
		color 0.12s ease;
}

.msgr-settings__nav button:hover {
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-contrast);
}

.msgr-settings__nav button.is-active {
	background: color-mix(in srgb, var(--color-brand) 22%, transparent);
	color: var(--color-contrast);
}

.msgr-settings__nav button.is-danger {
	margin-top: auto;
	color: #f23f43;
}

.msgr-settings__body {
	display: flex;
	min-width: 0;
	max-height: 64vh;
	flex-direction: column;
	gap: 0.8rem;
	overflow-y: auto;
	padding-right: 0.3rem;
}

.msgr-settings__banner {
	position: relative;
	height: 7.5rem;
	flex-shrink: 0;
	border-radius: 10px;
	background: linear-gradient(135deg, color-mix(in srgb, var(--color-brand) 70%, #000), #1e1f22)
		center / cover;
}

.msgr-settings__banner-edit,
.msgr-settings__banner-clear {
	position: absolute;
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	border: 0;
	background: rgba(0, 0, 0, 0.65);
	color: white;
	font: inherit;
	font-size: 0.8rem;
	cursor: pointer;
}

.msgr-settings__banner-edit {
	right: 0.6rem;
	bottom: 0.6rem;
	padding: 0.35rem 0.65rem;
	border-radius: 6px;
}

.msgr-settings__banner-clear {
	top: 0.5rem;
	right: 0.5rem;
	padding: 0.3rem;
	border-radius: 50%;
}

.msgr-settings__banner svg {
	width: 1rem;
	height: 1rem;
}

.msgr-settings__identity {
	display: flex;
	align-items: center;
	gap: 0.9rem;
	margin-top: -2.6rem;
	padding-left: 0.9rem;
}

.msgr-settings__identity-text {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	padding-top: 2.4rem;
}

.msgr-settings__identity-text b {
	color: var(--color-contrast);
	font-size: 1.05rem;
}

.msgr-settings__identity-text small {
	color: var(--color-secondary);
}

.msgr-settings__save {
	position: sticky;
	bottom: 0;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.6rem 0.8rem;
	border-radius: 8px;
	background: #111214;
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}

.msgr-settings__save span {
	flex: 1;
	color: var(--color-contrast);
	font-size: 0.88rem;
}

.msgr-settings__row {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 0.6rem;
}

.msgr-settings__row .msgr-field {
	min-width: 9rem;
	flex: 1;
}

.msgr-settings__row .msgr-field.is-color {
	min-width: 0;
	flex: 0 0 auto;
}

.msgr-settings__item {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.55rem 0.7rem;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.22);
}

.msgr-settings__item code {
	min-width: 0;
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 0.82rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-settings__item small {
	flex: 1;
	color: var(--color-secondary);
	font-size: 0.78rem;
	white-space: nowrap;
}

.msgr-settings__dot {
	width: 0.8rem;
	height: 0.8rem;
	flex-shrink: 0;
	border-radius: 50%;
}

.msgr-settings__empty {
	display: flex;
	justify-content: center;
	padding: 1.5rem 0;
	color: var(--color-secondary);
}

.msgr-settings__chips {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.msgr-settings__member {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
	padding: 0.4rem 0.5rem;
	border-radius: 8px;
	transition: background 0.12s ease;
}

.msgr-settings__member:hover {
	background: rgba(255, 255, 255, 0.04);
}

.msgr-settings__who {
	display: flex;
	min-width: 0;
	flex: 1;
	align-items: center;
	gap: 0.6rem;
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.msgr-settings__who span {
	display: flex;
	flex-direction: column;
}

.msgr-settings__who b {
	color: var(--color-contrast);
	font-size: 0.9rem;
}

.msgr-settings__who small {
	color: var(--color-secondary);
	font-size: 0.75rem;
}

.msgr-settings__roles {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
}

.msgr-settings__roles i {
	padding: 0.1rem 0.45rem;
	border: 1px solid var(--role);
	border-radius: 999px;
	color: var(--role);
	font-size: 0.72rem;
	font-style: normal;
}

.msgr-settings__role-pick {
	display: flex;
	width: 100%;
	flex-wrap: wrap;
	gap: 0.4rem 0.9rem;
	padding: 0.5rem 0.6rem;
	border-radius: 8px;
	background: #111214;
}

.msgr-settings__role-pick label {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.85rem;
	cursor: pointer;
}

.msgr-settings__role-pick i {
	width: 0.6rem;
	height: 0.6rem;
	border-radius: 50%;
}

.msgr-settings__danger {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.9rem 1rem;
	border: 1px solid rgba(242, 63, 67, 0.35);
	border-radius: 10px;
}

.msgr-settings__danger div {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.15rem;
}

.msgr-settings__danger b {
	color: var(--color-contrast);
}

.msgr-settings__danger small {
	color: var(--color-secondary);
	font-size: 0.8rem;
}

@media (max-width: 720px) {
	.msgr-settings {
		grid-template-columns: 1fr;
	}

	.msgr-settings__nav {
		flex-direction: row;
		flex-wrap: wrap;
		padding: 0 0 0.6rem;
		border-right: 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.msgr-settings__nav button.is-danger {
		margin-top: 0;
	}
}
</style>
