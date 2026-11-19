<script setup lang="ts">
import { SearchIcon, UserPlusIcon } from '@modrinth/assets'
import { computed, ref } from 'vue'

import {
	acceptIncoming,
	type CallParticipant,
	declineIncoming,
	dropFromCall,
	getCallState,
	hangupCall,
	inviteToCall,
	setPeerVolume,
	toggleCallDeafen,
	toggleCallMute,
} from '@/helpers/messenger-call'

import FloatingMenu from './FloatingMenu.vue'
import HeadphonesIcon from './HeadphonesIcon.vue'
import { useMessengerT } from './i18n'
import MicIcon from './MicIcon.vue'
import MicOffIcon from './MicOffIcon.vue'
import { formatDuration, isOnline } from './model'
import PhoneIcon from './PhoneIcon.vue'
import PhoneOffIcon from './PhoneOffIcon.vue'
import { activeConversation, displayName, me, openDm, openServer, startDm, state } from './store'
import { vTip } from './tooltip'
import type { Anchor } from './ui-bus'
import UserAvatar from './UserAvatar.vue'
import { leaveVoice, toggleVoiceDeafen, toggleVoiceMute, voice } from './voice-channel'

const props = defineProps<{ mode: 'bar' | 'stage' | 'incoming' }>()

const t = useMessengerT()

const call = computed(() => {
	void state.callTick
	const snapshot = getCallState()
	if (snapshot.phase !== 'idle') void state.clock
	return snapshot
})

const voiceChannel = computed(() => {
	if (!voice.channelId) return null
	return (
		state.structures[voice.convId]?.channels.find((channel) => channel.id === voice.channelId) ??
		null
	)
})

const voiceServer = computed(
	() => state.conversations.find((conv) => conv.id === voice.convId) ?? null,
)

const dmActive = computed(() => call.value.phase !== 'idle' && call.value.phase !== 'incoming')

/** Открыт чат с тем, с кем идёт звонок: звонок рисуется сверху чата,
 * а нижняя плашка у профиля прячется, чтобы не было двух одинаковых. */
const onCallPage = computed(() => {
	if (!dmActive.value || state.section !== 'home' || state.homePage !== 'dm') return false
	const conv = activeConversation.value
	if (!conv?.dm) return false
	if (conv.id === call.value.conversationId) return true
	const peerId = conv.peer?.id
	return Boolean(peerId) && call.value.participants.some((entry) => entry.id === peerId)
})

const showBar = computed(() =>
	dmActive.value ? !onCallPage.value : Boolean(voice.channelId || voice.connecting),
)

const phaseLabel = computed(() => {
	switch (call.value.phase) {
		case 'outgoing':
			return t('app.messenger.call.calling', 'Вызов…')
		case 'connecting':
			return t('app.messenger.call.connecting', 'Соединение…')
		case 'active':
			return t('app.messenger.call.connected', 'Голосовая связь подключена')
		default:
			return ''
	}
})

const callTitle = computed(() => {
	const people = call.value.participants
	if (people.length > 1) {
		return t('app.messenger.call.group', 'Групповой звонок · {count}', { count: people.length + 1 })
	}
	return call.value.peerName
})

const timer = computed(() => {
	const started = dmActive.value ? call.value.startedAt : voice.joinedAt
	if (started) void state.clock
	return started ? formatDuration((Date.now() - started) / 1000) : ''
})

function openCallChat(): void {
	if (dmActive.value && call.value.conversationId) void openDm(call.value.conversationId)
	else if (voice.convId) void openServer(voice.convId)
}

async function bump(fn: () => Promise<unknown> | unknown): Promise<void> {
	await fn()
	state.callTick += 1
}

const incoming = computed(() => call.value.incoming)

async function accept(): Promise<void> {
	const convId = incoming.value?.convId || ''
	await bump(acceptIncoming)
	if (convId) await openDm(convId)
}

const peerAnchor = ref<Anchor | null>(null)
const peerMenu = ref<CallParticipant | null>(null)
const inviteAnchor = ref<Anchor | null>(null)
const inviteQuery = ref('')
const inviting = ref('')

function anchorOf(event: Event): Anchor {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

function openPeer(event: MouseEvent, peer: CallParticipant): void {
	inviteAnchor.value = null
	peerMenu.value = peer
	peerAnchor.value = anchorOf(event)
}

const peerVolume = computed(() => {
	const id = peerMenu.value?.id
	return call.value.participants.find((entry) => entry.id === id)?.volume ?? 100
})

function onVolume(event: Event): void {
	const id = peerMenu.value?.id
	if (!id) return
	setPeerVolume(id, Number((event.target as HTMLInputElement).value))
}

async function kick(): Promise<void> {
	const id = peerMenu.value?.id
	peerAnchor.value = null
	if (id) await bump(() => dropFromCall(id))
}

function openInvite(event: MouseEvent): void {
	peerAnchor.value = null
	inviteQuery.value = ''
	inviteAnchor.value = inviteAnchor.value ? null : anchorOf(event)
}

const inviteList = computed(() => {
	const inCall = new Set(call.value.participants.map((entry) => entry.id))
	const q = inviteQuery.value.trim().toLowerCase()
	return state.friends
		.filter((friend) => !inCall.has(friend.id) && friend.id !== me.value?.id)
		.filter((friend) => !q || friend.username.toLowerCase().includes(q))
		.sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)))
		.slice(0, 30)
})

async function invite(id: string, username: string): Promise<void> {
	if (inviting.value) return
	inviting.value = id
	try {
		const conv = await startDm({ id, username })
		if (conv) await bump(() => inviteToCall(conv.id, id, displayName(id, username)))
	} finally {
		inviting.value = ''
		inviteAnchor.value = null
	}
}
</script>

<template>
	<Transition name="msgr-call">
		<div v-if="props.mode === 'bar' && showBar" class="msgr-callbar">
			<div class="msgr-callbar__info">
				<span
					class="msgr-callbar__signal"
					:class="{ 'is-live': call.phase === 'active' || voice.channelId }"
				>
					<i /><i /><i />
				</span>
				<div class="msgr-callbar__text">
					<b>{{
						dmActive
							? phaseLabel
							: voice.connecting
								? t('app.messenger.call.connecting', 'Соединение…')
								: t('app.messenger.voice.connected', 'Голос подключён')
					}}</b>
					<button type="button" @click="openCallChat">
						<template v-if="dmActive">{{ callTitle }}</template>
						<template v-else-if="voiceChannel"
							>{{ voiceChannel.name }} / {{ voiceServer?.title }}</template
						>
						<template v-if="timer"> · {{ timer }}</template>
					</button>
				</div>
			</div>

			<div v-if="dmActive" class="msgr-callbar__people">
				<span
					v-if="me"
					v-tip="t('app.messenger.call.you', 'Вы')"
					class="msgr-callbar__person"
					:class="{ 'is-speaking': call.selfSpeaking && !call.muted, 'is-muted': call.muted }"
				>
					<UserAvatar :user-id="me.id" :name="me.username" :size="26" />
					<MicOffIcon v-if="call.muted" class="msgr-callbar__badge" />
				</span>
				<button
					v-for="peer in call.participants"
					:key="peer.id"
					v-tip="displayName(peer.id, peer.name)"
					type="button"
					class="msgr-callbar__person"
					:class="{
						'is-speaking': peer.speaking,
						'is-waiting': peer.state === 'ringing' || peer.state === 'connecting',
					}"
					@click="openPeer($event, peer)"
				>
					<UserAvatar :user-id="peer.id" :name="peer.name" :size="26" />
				</button>
				<button
					v-tip="t('app.messenger.call.invite', 'Добавить друга в звонок')"
					type="button"
					class="msgr-callbar__add"
					:class="{ 'is-on': inviteAnchor }"
					@click.stop="openInvite"
				>
					<UserPlusIcon />
				</button>
			</div>

			<div class="msgr-callbar__actions">
				<template v-if="dmActive">
					<button
						v-tip="
							call.muted
								? t('app.messenger.call.unmute', 'Включить микрофон')
								: t('app.messenger.call.mute', 'Выключить микрофон')
						"
						type="button"
						:class="{ 'is-off': call.muted }"
						@click="bump(toggleCallMute)"
					>
						<MicOffIcon v-if="call.muted" />
						<MicIcon v-else />
					</button>
					<button
						v-tip="
							call.deafened
								? t('app.messenger.voice.undeafen', 'Включить звук')
								: t('app.messenger.voice.deafen', 'Выключить звук')
						"
						type="button"
						:class="{ 'is-off': call.deafened }"
						@click="bump(toggleCallDeafen)"
					>
						<HeadphonesIcon :off="call.deafened" />
					</button>
				</template>
				<template v-else-if="voice.channelId">
					<button
						v-tip="
							voice.muted
								? t('app.messenger.call.unmute', 'Включить микрофон')
								: t('app.messenger.call.mute', 'Выключить микрофон')
						"
						type="button"
						:class="{ 'is-off': voice.muted }"
						@click="toggleVoiceMute"
					>
						<MicOffIcon v-if="voice.muted" />
						<MicIcon v-else />
					</button>
					<button
						v-tip="
							voice.deafened
								? t('app.messenger.voice.undeafen', 'Включить звук')
								: t('app.messenger.voice.deafen', 'Выключить звук')
						"
						type="button"
						:class="{ 'is-off': voice.deafened }"
						@click="toggleVoiceDeafen"
					>
						<HeadphonesIcon :off="voice.deafened" />
					</button>
				</template>
				<button
					v-tip="t('app.messenger.call.hangup', 'Отключиться')"
					type="button"
					class="is-hangup"
					@click="dmActive ? bump(hangupCall) : leaveVoice()"
				>
					<PhoneOffIcon />
				</button>
			</div>
		</div>
	</Transition>
	<Transition name="msgr-stage">
		<section v-if="props.mode === 'stage' && onCallPage" class="msgr-stage">
			<div class="msgr-stage__people">
				<div
					v-if="me"
					class="msgr-stage__person"
					:class="{ 'is-speaking': call.selfSpeaking && !call.muted }"
				>
					<span class="msgr-stage__avatar">
						<UserAvatar :user-id="me.id" :name="me.username" :size="72" />
						<MicOffIcon v-if="call.muted" class="msgr-stage__badge" />
					</span>
					<b>{{ t('app.messenger.call.you', 'Вы') }}</b>
				</div>
				<button
					v-for="peer in call.participants"
					:key="peer.id"
					type="button"
					class="msgr-stage__person"
					:class="{
						'is-speaking': peer.speaking,
						'is-waiting': peer.state === 'ringing' || peer.state === 'connecting',
					}"
					@click="openPeer($event, peer)"
				>
					<span class="msgr-stage__avatar">
						<UserAvatar :user-id="peer.id" :name="peer.name" :size="72" />
					</span>
					<b>{{ displayName(peer.id, peer.name) }}</b>
				</button>
			</div>
			<span class="msgr-stage__phase">
				{{ phaseLabel }}<template v-if="timer"> · {{ timer }}</template>
			</span>
			<div class="msgr-stage__controls">
				<button
					v-tip="
						call.muted
							? t('app.messenger.call.unmute', 'Включить микрофон')
							: t('app.messenger.call.mute', 'Выключить микрофон')
					"
					type="button"
					:class="{ 'is-off': call.muted }"
					@click="bump(toggleCallMute)"
				>
					<MicOffIcon v-if="call.muted" />
					<MicIcon v-else />
				</button>
				<button
					v-tip="
						call.deafened
							? t('app.messenger.voice.undeafen', 'Включить звук')
							: t('app.messenger.voice.deafen', 'Выключить звук')
					"
					type="button"
					:class="{ 'is-off': call.deafened }"
					@click="bump(toggleCallDeafen)"
				>
					<HeadphonesIcon :off="call.deafened" />
				</button>
				<button
					v-tip="t('app.messenger.call.invite', 'Добавить друга в звонок')"
					type="button"
					:class="{ 'is-on': inviteAnchor }"
					@click.stop="openInvite"
				>
					<UserPlusIcon />
				</button>
				<button
					v-tip="t('app.messenger.call.hangup', 'Отключиться')"
					type="button"
					class="is-hangup"
					@click="bump(hangupCall)"
				>
					<PhoneOffIcon />
				</button>
			</div>
		</section>
	</Transition>
	<FloatingMenu
		:anchor="peerAnchor"
		:placement="props.mode === 'stage' ? 'bottom-start' : 'top-start'"
		:width="230"
		@close="peerAnchor = null"
	>
		<div v-if="peerMenu" class="msgr-callpeer">
			<div class="msgr-callpeer__head">
				<UserAvatar :user-id="peerMenu.id" :name="peerMenu.name" :size="32" />
				<b>{{ displayName(peerMenu.id, peerMenu.name) }}</b>
			</div>
			<label class="msgr-callpeer__volume">
				<span>
					{{ t('app.messenger.call.volume', 'Громкость') }}
					<b>{{ peerVolume }}%</b>
				</span>
				<input
					type="range"
					min="0"
					max="200"
					step="5"
					:value="peerVolume"
					:disabled="peerMenu.relayed"
					@input="onVolume"
				/>
			</label>
			<p v-if="peerMenu.relayed" class="msgr-callpeer__hint">
				{{ t('app.messenger.call.relayed', 'Голос идёт через другого участника звонка') }}
			</p>
			<button v-else type="button" class="msgr-menu-item is-danger" @click="kick">
				<PhoneOffIcon /> {{ t('app.messenger.call.drop', 'Отключить от звонка') }}
			</button>
		</div>
	</FloatingMenu>

	<FloatingMenu
		:anchor="inviteAnchor"
		:placement="props.mode === 'stage' ? 'bottom-start' : 'top-start'"
		:width="260"
		@close="inviteAnchor = null"
	>
		<div class="msgr-invite">
			<label class="msgr-invite__search">
				<SearchIcon />
				<input
					v-model="inviteQuery"
					type="search"
					:placeholder="t('app.messenger.call.inviteSearch', 'Найти друга')"
					autocomplete="off"
				/>
			</label>
			<div class="msgr-invite__list">
				<button
					v-for="friend in inviteList"
					:key="friend.id"
					type="button"
					class="msgr-invite__item"
					:disabled="Boolean(inviting)"
					@click="invite(friend.id, friend.username)"
				>
					<UserAvatar
						:user-id="friend.id"
						:name="friend.username"
						:size="28"
						status
						ring="#1c1d22"
					/>
					<span>{{ displayName(friend.id, friend.username) }}</span>
					<span v-if="inviting === friend.id" class="msgr-spinner msgr-invite__spin" />
					<PhoneIcon v-else class="msgr-invite__call" />
				</button>
				<p v-if="!inviteList.length" class="msgr-invite__empty">
					{{ t('app.messenger.call.inviteEmpty', 'Некого добавить') }}
				</p>
			</div>
		</div>
	</FloatingMenu>
	<Teleport to="body">
		<Transition name="msgr-incoming">
			<div v-if="props.mode === 'incoming' && incoming" class="msgr-incoming msgr-root">
				<div class="msgr-incoming__card">
					<div class="msgr-incoming__avatar">
						<span class="msgr-incoming__ring" />
						<span class="msgr-incoming__ring is-late" />
						<UserAvatar :user-id="incoming.peerId" :name="incoming.peerName" :size="84" />
					</div>
					<b>{{
						displayName(incoming.peerId, incoming.peerName) ||
						t('app.messenger.call.someone', 'Кто-то')
					}}</b>
					<span>{{
						dmActive
							? t('app.messenger.call.incomingJoin', 'Зовёт вас в свой звонок…')
							: t('app.messenger.call.incoming', 'Входящий голосовой звонок…')
					}}</span>
					<div class="msgr-incoming__actions">
						<button
							v-tip="t('app.messenger.call.decline', 'Отклонить')"
							type="button"
							class="is-decline"
							@click="bump(declineIncoming)"
						>
							<PhoneOffIcon />
						</button>
						<button
							v-tip="t('app.messenger.call.accept', 'Принять')"
							type="button"
							class="is-accept"
							@click="accept"
						>
							<PhoneIcon />
						</button>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.msgr-callbar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
	padding: 0.55rem 0.6rem;
	border-top: 1px solid rgba(255, 255, 255, 0.05);
	border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	background: rgba(12, 12, 15, 0.85);
}

.msgr-callbar__info {
	display: flex;
	min-width: 0;
	flex: 1;
	align-items: center;
	gap: 0.5rem;
}

.msgr-callbar__signal {
	display: flex;
	height: 1rem;
	align-items: flex-end;
	gap: 2px;
}

.msgr-callbar__signal i {
	width: 3px;
	border-radius: 2px;
	background: #f0b232;
}

.msgr-callbar__signal i:nth-child(1) {
	height: 35%;
}

.msgr-callbar__signal i:nth-child(2) {
	height: 65%;
}

.msgr-callbar__signal i:nth-child(3) {
	height: 100%;
}

.msgr-callbar__signal.is-live i {
	background: #23a55a;
}

.msgr-callbar__signal:not(.is-live) i {
	animation: msgr-signal 1s ease-in-out infinite;
}

.msgr-callbar__signal:not(.is-live) i:nth-child(2) {
	animation-delay: 0.15s;
}

.msgr-callbar__signal:not(.is-live) i:nth-child(3) {
	animation-delay: 0.3s;
}

.msgr-callbar__text {
	display: flex;
	min-width: 0;
	flex-direction: column;
	line-height: 1.2;
}

.msgr-callbar__text b {
	color: #23a55a;
	font-size: 0.8rem;
}

.msgr-callbar__text button {
	overflow: hidden;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-secondary);
	font: inherit;
	font-size: 0.72rem;
	text-align: left;
	text-overflow: ellipsis;
	white-space: nowrap;
	cursor: pointer;
}

.msgr-callbar__text button:hover {
	color: var(--color-contrast);
	text-decoration: underline;
}

.msgr-callbar__actions {
	display: flex;
	gap: 0.2rem;
	margin-left: auto;
}

.msgr-callbar__people {
	display: flex;
	width: 100%;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem;
	order: 3;
	padding-top: 0.15rem;
}

.msgr-callbar__person {
	position: relative;
	display: grid;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: none;
	box-shadow: 0 0 0 2px transparent;
	cursor: pointer;
	transition:
		box-shadow 0.14s ease,
		opacity 0.2s ease;
}

.msgr-callbar__person.is-speaking {
	box-shadow:
		0 0 0 2px #111214,
		0 0 0 4px #23a55a;
}

.msgr-callbar__person.is-waiting {
	opacity: 0.45;
	animation: msgr-signal 1.2s ease-in-out infinite;
}

.msgr-callbar__badge {
	position: absolute;
	right: -3px;
	bottom: -3px;
	width: 0.85rem;
	height: 0.85rem;
	padding: 1px;
	border-radius: 50%;
	background: #111214;
	color: #f23f43;
}

.msgr-callbar__add {
	display: grid;
	width: 26px;
	height: 26px;
	place-items: center;
	padding: 0;
	border: 1px dashed rgba(255, 255, 255, 0.2);
	border-radius: 50%;
	background: none;
	color: var(--color-secondary);
	cursor: pointer;
	transition:
		border-color 0.14s ease,
		color 0.14s ease;
}

.msgr-callbar__add:hover,
.msgr-callbar__add.is-on {
	border-color: #23a55a;
	color: #23a55a;
}

.msgr-callbar__add svg {
	width: 0.85rem;
	height: 0.85rem;
}

.msgr-callpeer {
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
}

.msgr-callpeer__head {
	display: flex;
	align-items: center;
	gap: 0.55rem;
}

.msgr-callpeer__head b {
	overflow: hidden;
	color: var(--color-contrast);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-callpeer__volume {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	color: var(--color-secondary);
	font-size: 0.75rem;
	font-weight: 600;
	text-transform: uppercase;
}

.msgr-callpeer__volume span {
	display: flex;
	justify-content: space-between;
}

.msgr-callpeer__volume b {
	color: var(--color-contrast);
}

.msgr-callpeer__volume input {
	width: 100%;
	accent-color: #23a55a;
}

.msgr-callpeer__hint {
	margin: 0;
	color: var(--color-secondary);
	font-size: 0.75rem;
}

.msgr-invite {
	display: flex;
	max-height: 20rem;
	flex-direction: column;
	gap: 0.4rem;
}

.msgr-invite__search {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	padding: 0 0.6rem;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.28);
	color: var(--color-secondary);
}

.msgr-invite__search svg {
	width: 0.95rem;
	height: 0.95rem;
}

.msgr-invite__search input {
	min-width: 0;
	flex: 1;
	height: 2rem;
	border: 0;
	background: transparent;
	box-shadow: none;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.85rem;
	outline: none;
}

.msgr-invite__list {
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
	overflow-y: auto;
	scrollbar-width: thin;
}

.msgr-invite__item {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	padding: 0.35rem 0.45rem;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.86rem;
	text-align: left;
	cursor: pointer;
	transition: background 0.14s ease;
}

.msgr-invite__item:hover:not(:disabled) {
	background: rgba(255, 255, 255, 0.07);
}

.msgr-invite__item > span:nth-child(2) {
	overflow: hidden;
	flex: 1;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-invite__call {
	width: 0.95rem;
	height: 0.95rem;
	color: #23a55a;
	opacity: 0;
	transition: opacity 0.14s ease;
}

.msgr-invite__item:hover .msgr-invite__call {
	opacity: 1;
}

.msgr-invite__spin {
	width: 0.95rem;
	height: 0.95rem;
}

.msgr-invite__empty {
	margin: 0;
	padding: 0.8rem;
	color: var(--color-secondary);
	font-size: 0.82rem;
	text-align: center;
}

.msgr-callbar__actions button {
	display: grid;
	width: 2rem;
	height: 2rem;
	place-items: center;
	border: 0;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-contrast);
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-callbar__actions button:hover {
	background: rgba(255, 255, 255, 0.1);
}

.msgr-callbar__actions button.is-off {
	color: #f23f43;
}

.msgr-callbar__actions button.is-hangup:hover {
	background: #da373c;
}

.msgr-callbar__actions svg {
	width: 1.05rem;
	height: 1.05rem;
}

.msgr-stage {
	display: flex;
	flex-shrink: 0;
	flex-direction: column;
	align-items: center;
	gap: 0.7rem;
	padding: 1.4rem 1rem 1.1rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	background: #0e0f12;
}

.msgr-stage__people {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 1.4rem;
}

.msgr-stage__person {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.45rem;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-contrast);
	font: inherit;
	cursor: pointer;
}

div.msgr-stage__person {
	cursor: default;
}

.msgr-stage__person b {
	max-width: 7rem;
	overflow: hidden;
	font-size: 0.82rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-stage__avatar {
	position: relative;
	display: grid;
	border-radius: 50%;
	box-shadow: 0 0 0 3px transparent;
	transition: box-shadow 0.14s ease;
}

.msgr-stage__person.is-speaking .msgr-stage__avatar {
	box-shadow:
		0 0 0 3px #0e0f12,
		0 0 0 6px #23a55a;
}

.msgr-stage__person.is-waiting .msgr-stage__avatar {
	opacity: 0.45;
	animation: msgr-signal 1.2s ease-in-out infinite;
}

.msgr-stage__badge {
	position: absolute;
	right: 0;
	bottom: 0;
	width: 1.3rem;
	height: 1.3rem;
	padding: 3px;
	border-radius: 50%;
	background: #0e0f12;
	color: #f23f43;
}

.msgr-stage__phase {
	color: #23a55a;
	font-size: 0.8rem;
	font-weight: 600;
}

.msgr-stage__controls {
	display: flex;
	gap: 0.6rem;
}

.msgr-stage__controls button {
	display: grid;
	width: 2.75rem;
	height: 2.75rem;
	place-items: center;
	border: 0;
	border-radius: 50%;
	background: #26272d;
	color: var(--color-contrast);
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-stage__controls button:hover,
.msgr-stage__controls button.is-on {
	background: #34363d;
}

.msgr-stage__controls button.is-off {
	color: #f23f43;
}

.msgr-stage__controls button.is-hangup {
	background: #da373c;
	color: white;
}

.msgr-stage__controls button.is-hangup:hover {
	background: #b92f33;
}

.msgr-stage__controls svg {
	width: 1.2rem;
	height: 1.2rem;
}

.msgr-stage-enter-active,
.msgr-stage-leave-active {
	transition: opacity 0.2s ease;
}

.msgr-stage-enter-from,
.msgr-stage-leave-to {
	opacity: 0;
}

.msgr-incoming {
	position: fixed;
	inset: 0;
	z-index: 500;
	display: grid;
	place-items: center;
	background: rgba(5, 5, 8, 0.55);
	backdrop-filter: blur(6px);
}

.msgr-incoming__card {
	display: flex;
	width: 18rem;
	flex-direction: column;
	align-items: center;
	gap: 0.35rem;
	padding: 2rem 1.5rem 1.5rem;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 18px;
	background: #111214;
	box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
	color: var(--color-secondary);
	text-align: center;
}

.msgr-incoming__card b {
	margin-top: 0.8rem;
	color: var(--color-contrast);
	font-size: 1.2rem;
}

.msgr-incoming__avatar {
	position: relative;
	display: grid;
	place-items: center;
}

.msgr-incoming__ring {
	position: absolute;
	inset: -6px;
	border: 3px solid #23a55a;
	border-radius: 50%;
	animation: msgr-ring 1.6s ease-out infinite;
}

.msgr-incoming__ring.is-late {
	animation-delay: 0.8s;
}

.msgr-incoming__actions {
	display: flex;
	gap: 2.5rem;
	margin-top: 1.2rem;
}

.msgr-incoming__actions button {
	display: grid;
	width: 3.4rem;
	height: 3.4rem;
	place-items: center;
	border: 0;
	border-radius: 50%;
	color: white;
	cursor: pointer;
	transition: transform 0.12s ease;
}

.msgr-incoming__actions button:hover {
	transform: scale(1.08);
}

.msgr-incoming__actions svg {
	width: 1.5rem;
	height: 1.5rem;
}

.msgr-incoming__actions .is-accept {
	background: #23a55a;
	animation: msgr-shake 1.2s ease-in-out infinite;
}

.msgr-incoming__actions .is-decline {
	background: #da373c;
}

.msgr-call-enter-active,
.msgr-call-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.msgr-call-enter-from,
.msgr-call-leave-to {
	opacity: 0;
	transform: translateY(8px);
}

.msgr-incoming-enter-active,
.msgr-incoming-leave-active {
	transition: opacity 0.2s ease;
}

.msgr-incoming-enter-active .msgr-incoming__card {
	animation: msgr-card-in 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.msgr-incoming-enter-from,
.msgr-incoming-leave-to {
	opacity: 0;
}

@keyframes msgr-ring {
	from {
		opacity: 0.9;
		transform: scale(1);
	}

	to {
		opacity: 0;
		transform: scale(1.45);
	}
}

@keyframes msgr-shake {
	0%,
	60%,
	100% {
		transform: rotate(0);
	}

	10%,
	30%,
	50% {
		transform: rotate(-12deg);
	}

	20%,
	40% {
		transform: rotate(12deg);
	}
}

@keyframes msgr-signal {
	50% {
		opacity: 0.35;
	}
}

@keyframes msgr-card-in {
	from {
		transform: scale(0.85);
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-incoming__ring,
	.msgr-incoming__actions .is-accept,
	.msgr-callbar__signal i,
	.msgr-callbar__person.is-waiting,
	.msgr-stage__person.is-waiting .msgr-stage__avatar,
	.msgr-incoming-enter-active .msgr-incoming__card {
		animation: none;
	}

	.msgr-call-enter-active,
	.msgr-call-leave-active,
	.msgr-stage-enter-active,
	.msgr-stage-leave-active,
	.msgr-incoming-enter-active,
	.msgr-incoming-leave-active {
		transition: none;
	}
}
</style>
