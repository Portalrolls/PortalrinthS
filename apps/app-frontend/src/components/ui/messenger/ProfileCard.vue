<script setup lang="ts">
import { CheckIcon, UserIcon } from '@modrinth/assets'
import { computed, onMounted, ref } from 'vue'

import { useMessengerT } from './i18n'
import {
	displayName,
	joinGroupServer,
	openServer,
	requestFriend,
	showToast,
	state,
	userOf,
} from './store'
import { openProfile } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

/** Вложение-карточка: профиль игрока или группа — как визитка в чате.
    Получатель может добавить в друзья, открыть профиль или вступить. */
const props = defineProps<{ kind: 'user' | 'group'; id: string }>()

const t = useMessengerT()

const friendState = ref<'idle' | 'sent' | 'error'>('idle')
const joining = ref(false)
const joined = ref(false)

const peer = computed(() =>
	props.kind === 'user' ? (state.users[props.id] ?? userOf(props.id)) : null,
)
const conversation = computed(() =>
	props.kind === 'group'
		? (state.conversations.find((conv) => conv.id === props.id) ?? null)
		: null,
)

const isFriend = computed(() => {
	if (props.kind !== 'user') return false
	if (state.friends.some((friend) => friend.id === props.id)) return true
	return state.outgoing.some((friend) => friend.id === props.id)
})
const isMember = computed(() => Boolean(conversation.value))
const isSelf = computed(() => props.kind === 'user' && props.id === state.session?.user?.id)

const title = computed(() => {
	if (props.kind === 'user') {
		return (
			displayName(props.id, peer.value?.username || '') ||
			peer.value?.username ||
			t('app.messenger.card.unknownUser', 'Игрок')
		)
	}
	return conversation.value?.title || t('app.messenger.card.unknownGroup', 'Группа')
})

const subtitle = computed(() => {
	if (props.kind === 'user') {
		if (peer.value?.bot) return 'BOT'
		return peer.value?.provider === 'microsoft'
			? t('app.messenger.card.licensed', 'Лицензия Minecraft')
			: t('app.messenger.card.player', 'Игрок Portalrinth')
	}
	const members = conversation.value?.members.length ?? 0
	return members
		? t('app.messenger.card.members', '{n} участников', { n: members })
		: t('app.messenger.card.group', 'Групповой чат')
})

onMounted(() => {
	if (props.kind === 'group' && !conversation.value) {
		void (async () => {
			try {
				const { loadConversation } = await import('./store')
				await loadConversation(props.id)
			} catch {
				/* не достали группу — карточка останется с именем по умолчанию */
			}
		})()
	}
})

async function addFriend(): Promise<void> {
	if (friendState.value !== 'idle') return
	const ok = await requestFriend(props.id)
	friendState.value = ok ? 'sent' : 'error'
	if (ok) showToast(t('app.messenger.card.requestSent', 'Заявка в друзья отправлена'))
}

function openCard(): void {
	if (props.kind === 'user') {
		openProfile(props.id, displayName(props.id, peer.value?.username || ''))
	} else if (conversation.value) {
		openServer(conversation.value.id)
	}
}

async function join(): Promise<void> {
	if (joining.value || joined.value) return
	joining.value = true
	const ok = await joinGroupServer(props.id)
	joining.value = false
	joined.value = ok
	showToast(
		ok
			? t('app.messenger.card.joined', 'Вы вступили в группу')
			: t('app.messenger.card.joinFailed', 'Не удалось вступить — возможно, группа приватная'),
	)
}
</script>

<template>
	<div class="msgr-card" @click.stop>
		<button type="button" class="msgr-card__main" @click="openCard">
			<UserAvatar v-if="kind === 'user'" :user-id="id" :name="title" :size="44" />
			<span v-else class="msgr-card__avatar">
				<img
					v-if="conversation?.avatarUrl"
					:src="conversation.avatarUrl"
					alt=""
					draggable="false"
				/>
				<UserIcon v-else />
			</span>
			<span class="msgr-card__body">
				<b>{{ title }}</b>
				<small>{{ subtitle }}</small>
			</span>
		</button>
		<div v-if="!isSelf" class="msgr-card__actions">
			<template v-if="kind === 'user'">
				<button
					v-if="!isFriend"
					type="button"
					class="msgr-card__btn"
					:disabled="friendState === 'sent'"
					@click="addFriend"
				>
					<CheckIcon v-if="friendState === 'sent'" />
					{{
						friendState === 'sent'
							? t('app.messenger.card.requestSentShort', 'Заявка отправлена')
							: friendState === 'error'
								? t('app.messenger.card.retry', 'Повторить')
								: t('app.messenger.card.addFriend', 'Добавить в друзья')
					}}
				</button>
				<button type="button" class="msgr-card__btn is-ghost" @click="openCard">
					{{ t('app.messenger.card.profile', 'Профиль') }}
				</button>
			</template>
			<template v-else>
				<button
					v-if="!isMember"
					type="button"
					class="msgr-card__btn"
					:disabled="joining"
					@click="join"
				>
					{{
						joining
							? t('app.messenger.card.joining', 'Вступаем…')
							: t('app.messenger.card.join', 'Вступить')
					}}
				</button>
				<button v-else type="button" class="msgr-card__btn" @click="openCard">
					{{ t('app.messenger.card.open', 'Открыть') }}
				</button>
			</template>
		</div>
	</div>
</template>

<style scoped>
.msgr-card {
	margin-top: 0.35rem;
	max-width: min(100%, 24rem);
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 12px;
	background: color-mix(in srgb, var(--color-brand) 7%, #1b1c20);
	overflow: hidden;
}

.msgr-card__main {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 0.7rem;
	padding: 0.7rem 0.8rem;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.msgr-card__main:hover {
	background: rgba(255, 255, 255, 0.04);
}

.msgr-card__avatar {
	display: grid;
	width: 2.75rem;
	height: 2.75rem;
	flex-shrink: 0;
	place-items: center;
	border-radius: 10px;
	background: color-mix(in srgb, var(--color-brand) 22%, transparent);
	color: var(--color-brand);
	overflow: hidden;
}

.msgr-card__avatar img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.msgr-card__avatar svg {
	width: 1.4rem;
	height: 1.4rem;
}

.msgr-card__body {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 0.15rem;
}

.msgr-card__body b {
	overflow: hidden;
	font-size: 0.92rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-card__body small {
	opacity: 0.65;
	font-size: 0.75rem;
}

.msgr-card__actions {
	display: flex;
	gap: 0.45rem;
	padding: 0 0.8rem 0.7rem;
}

.msgr-card__btn {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.35rem 0.7rem;
	border: 0;
	border-radius: 8px;
	background: var(--color-brand);
	color: white;
	font: inherit;
	font-size: 0.78rem;
	font-weight: 600;
	cursor: pointer;
	transition: filter 0.12s ease;
}

.msgr-card__btn:hover {
	filter: brightness(1.12);
}

.msgr-card__btn:disabled {
	opacity: 0.7;
	cursor: default;
}

.msgr-card__btn.is-ghost {
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-base);
}

.msgr-card__btn svg {
	width: 0.9rem;
	height: 0.9rem;
}
</style>
