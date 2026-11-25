<script setup lang="ts">
import {
	CheckIcon,
	CopyIcon,
	EditIcon,
	LogOutIcon,
	RefreshCwIcon,
	UserIcon,
} from '@modrinth/assets'
import { computed, ref } from 'vue'

import { backgroundUrl } from '@/helpers/portalrinth-background'

import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import type { PresenceStatus } from './model'
import { cardOf, profileEditor } from './profile-card'
import { connect, me, myId, setPresence, showToast, signOut, state } from './store'
import { vTip } from './tooltip'
import { type Anchor, askConfirm, openProfile } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const menu = ref<Anchor | null>(null)

const statuses = computed<{ id: PresenceStatus; label: string; hint: string }[]>(() => [
	{ id: 'online', label: t('app.messenger.status.online', 'В сети'), hint: '' },
	{
		id: 'busy',
		label: t('app.messenger.status.busy', 'Отошёл'),
		hint: t('app.messenger.status.busyHint', 'Вы на месте, но можете ответить не сразу'),
	},
	{
		id: 'dnd',
		label: t('app.messenger.status.dnd', 'Не беспокоить'),
		hint: t('app.messenger.status.dndHint', 'Звуки уведомлений приглушены'),
	},
	{
		id: 'offline',
		label: t('app.messenger.status.invisible', 'Невидимка'),
		hint: t('app.messenger.status.invisibleHint', 'Другие увидят вас «не в сети»'),
	},
])

const currentLabel = computed(
	() => statuses.value.find((entry) => entry.id === state.myStatus)?.label ?? '',
)

/** «Обо мне» из карточки профиля — как кастомный статус в Discord. */
const customStatus = computed(() => cardOf(me.value?.id ?? '').bio.trim())

/** Плашка снизу красится баннером своей карточки — как в Discord. Когда
 * за окном стоит картинка-фон, баннер убираем: поверх фона карточка
 * смотрится лишней, панель остаётся просто прозрачным стеклом. */
const panelStyle = computed(() => {
	if (backgroundUrl.value) return {}
	const card = cardOf(me.value?.id ?? '')
	const accent = card.accent || card.bannerColor || ''
	if (card.bannerImage) {
		return {
			backgroundImage: `linear-gradient(rgba(8, 9, 11, 0.62), rgba(8, 9, 11, 0.78)), url("${card.bannerImage}")`,
		}
	}
	if (accent) {
		return {
			backgroundImage: `linear-gradient(rgba(8, 9, 11, 0.68), rgba(8, 9, 11, 0.8)), linear-gradient(135deg, ${accent}, ${accent}99)`,
		}
	}
	return {}
})

function open(event: MouseEvent): void {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	menu.value = menu.value ? null : { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

async function pick(status: PresenceStatus): Promise<void> {
	menu.value = null
	await setPresence(status)
}

function profile(): void {
	menu.value = null
	if (me.value) openProfile(me.value.id, me.value.username)
}

function editProfile(): void {
	menu.value = null
	profileEditor.open = true
}

async function copyId(): Promise<void> {
	menu.value = null
	await navigator.clipboard.writeText(myId.value).catch(() => undefined)
	showToast(t('app.messenger.copied.id', 'ID скопирован'))
}

async function reconnect(): Promise<void> {
	menu.value = null
	await connect(true)
}

async function logout(): Promise<void> {
	menu.value = null
	const ok = await askConfirm({
		title: t('app.messenger.logout.title', 'Выйти из сессии'),
		text: t(
			'app.messenger.logout.text',
			'Сессия мессенджера будет сброшена. Аккаунт в лаунчере останется — мы войдём заново при следующем подключении.',
		),
		confirm: t('app.messenger.logout.confirm', 'Выйти'),
		danger: true,
	})
	if (ok) await signOut()
}
</script>

<template>
	<div v-if="me" class="msgr-user" :style="panelStyle">
		<button type="button" class="msgr-user__who" :class="{ 'is-open': menu }" @click.stop="open">
			<UserAvatar :user-id="me.id" :name="me.username" :size="34" status ring="var(--msgr-inset)" />
			<span class="msgr-user__text">
				<b>{{ me.username }}</b>
				<small v-if="customStatus" class="msgr-user__custom">{{ customStatus }}</small>
				<small v-else>{{ currentLabel }}</small>
			</span>
		</button>
		<button
			v-tip="t('app.messenger.myProfile', 'Мой профиль')"
			type="button"
			class="msgr-user__btn"
			@click="profile"
		>
			<UserIcon />
		</button>

		<FloatingMenu :anchor="menu" placement="top-start" :width="270" @close="menu = null">
			<div class="msgr-user__card">
				<UserAvatar
					:user-id="me.id"
					:name="me.username"
					:size="48"
					status
					ring="var(--msgr-inset)"
				/>
				<div>
					<b>{{ me.username }}</b>
					<small>{{ me.provider === 'ely' ? 'Ely.by' : 'Microsoft' }}</small>
				</div>
			</div>
			<div class="msgr-menu-sep" />
			<button
				v-for="entry in statuses"
				:key="entry.id"
				type="button"
				class="msgr-menu-item msgr-user__status"
				@click="pick(entry.id)"
			>
				<span class="msgr-user__dot" :class="`is-${entry.id}`" />
				<span class="msgr-user__status-text">
					<span>{{ entry.label }}</span>
					<small v-if="entry.hint">{{ entry.hint }}</small>
				</span>
				<CheckIcon v-if="state.myStatus === entry.id" class="msgr-user__check" />
			</button>
			<div class="msgr-menu-sep" />
			<button type="button" class="msgr-menu-item" @click="profile">
				<UserIcon /> {{ t('app.messenger.myProfile', 'Мой профиль') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="editProfile">
				<EditIcon /> {{ t('app.messenger.profile.edit', 'Редактировать профиль') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="copyId">
				<CopyIcon /> {{ t('app.messenger.copyUserId', 'Копировать ID пользователя') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="reconnect">
				<RefreshCwIcon /> {{ t('app.messenger.reconnect', 'Переподключиться') }}
			</button>
			<button type="button" class="msgr-menu-item is-danger" @click="logout">
				<LogOutIcon /> {{ t('app.messenger.logout.title', 'Выйти из сессии') }}
			</button>
		</FloatingMenu>
	</div>
</template>

<style scoped>
.msgr-user {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.45rem 0.5rem;
	background-color: var(--msgr-glass2);
	background-size: cover;
	background-position: center;
}

.msgr-user__who {
	display: flex;
	min-width: 0;
	flex: 1;
	align-items: center;
	gap: 0.55rem;
	padding: 0.2rem 0.3rem;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-user__who:hover,
.msgr-user__who.is-open {
	background: rgba(255, 255, 255, 0.06);
}

.msgr-user__text {
	display: flex;
	min-width: 0;
	flex-direction: column;
	line-height: 1.2;
}

.msgr-user__text b {
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 0.85rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-user__text small {
	color: var(--color-secondary);
	font-size: 0.72rem;
}

.msgr-user__custom {
	overflow: hidden;
	color: #2dc770;
	font-size: 0.72rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-user__btn {
	display: grid;
	width: 2rem;
	height: 2rem;
	place-items: center;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
}

.msgr-user__btn:hover {
	background: rgba(255, 255, 255, 0.07);
	color: var(--color-contrast);
}

.msgr-user__btn svg {
	width: 1.15rem;
	height: 1.15rem;
}

/* Фон стоит — панель просто прозрачная: никакой заливки и баннера, только
 * второй слой блюра поверх уже стеклянного сайдбара (первый — на панели
 * чата и списка участников), чтобы текст читался на любой картинке. */
html.portalrinth-backdrop-active .msgr-user {
	background-color: transparent;
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
}

.msgr-user__card {
	display: flex;
	align-items: center;
	gap: 0.7rem;
	padding: 0.5rem;
}

.msgr-user__card div {
	display: flex;
	flex-direction: column;
}

.msgr-user__card b {
	color: var(--color-contrast);
}

.msgr-user__card small {
	color: var(--color-secondary);
	font-size: 0.75rem;
}

.msgr-user__status {
	align-items: flex-start;
}

.msgr-user__status-text {
	display: flex;
	flex: 1;
	flex-direction: column;
}

.msgr-user__status-text small {
	font-size: 0.7rem;
	opacity: 0.7;
}

.msgr-user__dot {
	width: 0.7rem;
	height: 0.7rem;
	margin-top: 0.25rem;
	flex-shrink: 0;
	border-radius: 50%;
	background: #80848e;
}

.msgr-user__dot.is-online {
	background: #23a55a;
}

.msgr-user__dot.is-busy {
	background: #f0b232;
}

.msgr-user__dot.is-dnd {
	background: #f23f43;
}

.msgr-user__check {
	margin-left: auto;
}
</style>
