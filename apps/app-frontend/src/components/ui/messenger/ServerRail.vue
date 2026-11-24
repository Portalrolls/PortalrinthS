<script setup lang="ts">
import {
	CopyIcon,
	EyeOffIcon,
	LogOutIcon,
	MessageIcon,
	PlusIcon,
	SettingsIcon,
	UserPlusIcon,
} from '@modrinth/assets'
import { computed, ref } from 'vue'

import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import type { Conversation } from './model'
import {
	canManageServer,
	dms,
	hideConversation,
	importantIn,
	isOwner,
	openHome,
	openServer,
	servers,
	showToast,
	state,
} from './store'
import { vTip } from './tooltip'
import type { Anchor } from './ui-bus'

const emit = defineEmits<{
	create: []
	settings: [conv: Conversation, tab?: string]
	leave: [conv: Conversation]
}>()

const t = useMessengerT()

const menu = ref<{ conv: Conversation; anchor: Anchor } | null>(null)

const dmUnread = computed(
	() => dms.value.reduce((sum, conv) => sum + conv.unread, 0) + state.incoming.length,
)
const homeActive = computed(() => state.section === 'home')

const sortedServers = computed(() =>
	[...servers.value].sort(
		(a, b) => Number(b.project) - Number(a.project) || a.title.localeCompare(b.title),
	),
)

function initials(title: string): string {
	return (
		title
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 3)
			.map((word) => word[0])
			.join('')
			.toUpperCase() || '?'
	)
}

function context(event: MouseEvent, conv: Conversation): void {
	menu.value = { conv, anchor: { x: event.clientX, y: event.clientY } }
}

async function copyId(conv: Conversation): Promise<void> {
	menu.value = null
	await navigator.clipboard.writeText(conv.id).catch(() => undefined)
	showToast(t('app.messenger.copied.id', 'ID скопирован'))
}

function act(fn: () => void): void {
	menu.value = null
	fn()
}
</script>

<template>
	<nav class="msgr-rail" :aria-label="t('app.messenger.rail', 'Серверы')">
		<button
			v-tip:right="t('app.messenger.home', 'Личные сообщения')"
			type="button"
			class="msgr-rail__item msgr-rail__home"
			:class="{ 'is-active': homeActive }"
			@click="openHome(state.homePage === 'dm' && state.activeDmId ? 'dm' : 'friends')"
		>
			<span class="msgr-rail__pill" />
			<span class="msgr-rail__icon"><MessageIcon /></span>
			<span v-if="dmUnread" class="msgr-rail__badge">{{ dmUnread > 99 ? '99+' : dmUnread }}</span>
		</button>
		<span class="msgr-rail__sep" />
		<TransitionGroup name="msgr-rail" tag="div" class="msgr-rail__list">
			<button
				v-for="conv in sortedServers"
				:key="conv.id"
				v-tip:right="conv.title"
				type="button"
				class="msgr-rail__item"
				:class="{
					'is-active': state.section === 'server' && state.activeServerId === conv.id,
					'is-unread': conv.unread > 0 || importantIn(conv.id) > 0,
				}"
				@click="openServer(conv.id)"
				@contextmenu.prevent="context($event, conv)"
			>
				<span class="msgr-rail__pill" />
				<span class="msgr-rail__icon" :class="{ 'is-project': conv.project }">
					<img v-if="conv.avatarUrl" :src="conv.avatarUrl" alt="" />
					<template v-else>{{ initials(conv.title) }}</template>
				</span>
				<span v-if="importantIn(conv.id)" class="msgr-rail__badge">{{
					importantIn(conv.id) > 99 ? '99+' : importantIn(conv.id)
				}}</span>
			</button>
		</TransitionGroup>
		<button
			v-tip:right="t('app.messenger.server.add', 'Добавить сервер')"
			type="button"
			class="msgr-rail__item msgr-rail__add"
			@click="emit('create')"
		>
			<span class="msgr-rail__icon"><PlusIcon /></span>
		</button>

		<FloatingMenu
			:anchor="menu?.anchor ?? null"
			placement="right-start"
			:width="220"
			@close="menu = null"
		>
			<template v-if="menu">
				<button
					type="button"
					class="msgr-menu-item"
					@click="act(() => emit('settings', menu!.conv, 'invites'))"
				>
					<UserPlusIcon /> {{ t('app.messenger.server.invite', 'Пригласить людей') }}
				</button>
				<button
					type="button"
					class="msgr-menu-item"
					@click="act(() => emit('settings', menu!.conv))"
				>
					<SettingsIcon />
					{{
						canManageServer(menu.conv)
							? t('app.messenger.server.settings', 'Настройки сервера')
							: t('app.messenger.server.about', 'О сервере')
					}}
				</button>
				<button type="button" class="msgr-menu-item" @click="copyId(menu.conv)">
					<CopyIcon /> {{ t('app.messenger.server.copyId', 'Копировать ID сервера') }}
				</button>
				<div class="msgr-menu-sep" />
				<button
					type="button"
					class="msgr-menu-item"
					@click="act(() => void hideConversation(menu!.conv.id))"
				>
					<EyeOffIcon /> {{ t('app.messenger.server.hide', 'Скрыть сервер') }}
				</button>
				<button
					v-if="!isOwner(menu.conv) && !menu.conv.project"
					type="button"
					class="msgr-menu-item is-danger"
					@click="act(() => emit('leave', menu!.conv))"
				>
					<LogOutIcon /> {{ t('app.messenger.server.leave', 'Покинуть сервер') }}
				</button>
			</template>
		</FloatingMenu>
	</nav>
</template>

<style scoped>
.msgr-rail {
	display: flex;
	width: 4.5rem;
	flex-shrink: 0;
	flex-direction: column;
	align-items: center;
	gap: 0.5rem;
	padding: 0.75rem 0;
	overflow-y: auto;
	scrollbar-width: none;
	background: var(--msgr-rail);
	backdrop-filter: blur(18px);
}

.msgr-rail__list {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.5rem;
}

.msgr-rail__item {
	position: relative;
	display: flex;
	width: 4.5rem;
	justify-content: center;
	padding: 0;
	border: 0;
	background: none;
	cursor: pointer;
}

.msgr-rail__icon {
	display: grid;
	width: 3rem;
	height: 3rem;
	place-items: center;
	overflow: hidden;
	border-radius: 50%;
	background: var(--msgr-btn);
	color: var(--color-contrast);
	font-size: 0.95rem;
	font-weight: 700;
	transition:
		border-radius 0.2s ease,
		background 0.2s ease,
		color 0.2s ease,
		transform 0.15s ease;
}

.msgr-rail__icon.is-project {
	box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-brand) 60%, transparent);
}

.msgr-rail__icon img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.msgr-rail__icon svg {
	width: 1.5rem;
	height: 1.5rem;
}

.msgr-rail__item:hover .msgr-rail__icon,
.msgr-rail__item.is-active .msgr-rail__icon {
	border-radius: 16px;
	background: var(--color-brand);
	color: white;
}

.msgr-rail__item:active .msgr-rail__icon {
	transform: translateY(1px);
}

.msgr-rail__add .msgr-rail__icon {
	background: var(--msgr-btn);
	color: #23a55a;
}

.msgr-rail__add:hover .msgr-rail__icon {
	background: #23a55a;
	color: white;
}

.msgr-rail__pill {
	position: absolute;
	left: 0;
	top: 50%;
	width: 4px;
	height: 0;
	border-radius: 0 4px 4px 0;
	background: white;
	transform: translateY(-50%);
	transition: height 0.2s ease;
}

.msgr-rail__item.is-unread .msgr-rail__pill {
	height: 8px;
}

.msgr-rail__item:hover .msgr-rail__pill {
	height: 20px;
}

.msgr-rail__item.is-active .msgr-rail__pill {
	height: 40px;
}

.msgr-rail__badge {
	position: absolute;
	right: 0.7rem;
	bottom: -2px;
	min-width: 1.1rem;
	height: 1.1rem;
	padding: 0 0.3rem;
	border-radius: 999px;
	background: #f23f43;
	box-shadow: 0 0 0 3px var(--msgr-ring);
	color: white;
	font-size: 0.68rem;
	font-weight: 800;
	line-height: 1.1rem;
	text-align: center;
	animation: msgr-badge 0.25s ease-out;
}

.msgr-rail__sep {
	width: 2rem;
	height: 2px;
	flex-shrink: 0;
	border-radius: 2px;
	background: rgba(255, 255, 255, 0.08);
}

.msgr-rail-enter-active,
.msgr-rail-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.msgr-rail-enter-from,
.msgr-rail-leave-to {
	opacity: 0;
	transform: scale(0.6);
}

@keyframes msgr-badge {
	from {
		transform: scale(0.4);
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-rail__icon,
	.msgr-rail__pill,
	.msgr-rail-enter-active,
	.msgr-rail-leave-active {
		transition: none;
	}

	.msgr-rail__badge {
		animation: none;
	}
}
</style>
