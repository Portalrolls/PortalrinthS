<script setup lang="ts">
import { computed } from 'vue'

import {
	acceptIncoming,
	declineIncoming,
	getCallState,
	hangupCall,
	toggleCallMute,
} from '@/helpers/messenger-call'

import HeadphonesIcon from './HeadphonesIcon.vue'
import { useMessengerT } from './i18n'
import MicIcon from './MicIcon.vue'
import MicOffIcon from './MicOffIcon.vue'
import { formatDuration } from './model'
import PhoneIcon from './PhoneIcon.vue'
import PhoneOffIcon from './PhoneOffIcon.vue'
import { dmWith, openDm, openServer, state } from './store'
import { vTip } from './tooltip'
import UserAvatar from './UserAvatar.vue'
import { leaveVoice, toggleVoiceDeafen, toggleVoiceMute, voice } from './voice-channel'

const props = defineProps<{ mode: 'bar' | 'incoming' }>()

const t = useMessengerT()

const call = computed(() => {
	void state.callTick
	void state.clock
	return getCallState()
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

const timer = computed(() => {
	void state.clock
	const started = dmActive.value ? call.value.startedAt : voice.joinedAt
	return started ? formatDuration((Date.now() - started) / 1000) : ''
})

function openCallChat(): void {
	if (dmActive.value && call.value.conversationId) void openDm(call.value.conversationId)
	else if (voice.convId) void openServer(voice.convId)
}

async function bump(fn: () => Promise<void> | void): Promise<void> {
	await fn()
	state.callTick += 1
}

const incomingAvatar = computed(() => call.value.peerId || '')
const incomingConv = computed(() => (call.value.peerId ? dmWith(call.value.peerId) : null))
</script>

<template>
	<Transition name="msgr-call">
		<div
			v-if="props.mode === 'bar' && (dmActive || voice.channelId || voice.connecting)"
			class="msgr-callbar"
		>
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
						<template v-if="dmActive">{{ call.peerName }}</template>
						<template v-else-if="voiceChannel"
							>{{ voiceChannel.name }} / {{ voiceServer?.title }}</template
						>
						<template v-if="timer"> · {{ timer }}</template>
					</button>
				</div>
			</div>
			<div class="msgr-callbar__actions">
				<button
					v-if="dmActive"
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
	<Teleport to="body">
		<Transition name="msgr-incoming">
			<div v-if="props.mode === 'incoming' && call.phase === 'incoming'" class="msgr-incoming">
				<div class="msgr-incoming__card">
					<div class="msgr-incoming__avatar">
						<span class="msgr-incoming__ring" />
						<span class="msgr-incoming__ring is-late" />
						<UserAvatar :user-id="incomingAvatar" :name="call.peerName" :size="84" />
					</div>
					<b>{{ call.peerName || t('app.messenger.call.someone', 'Кто-то') }}</b>
					<span>{{ t('app.messenger.call.incoming', 'Входящий голосовой звонок…') }}</span>
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
							@click="
								bump(async () => {
									await acceptIncoming()
									if (incomingConv) await openDm(incomingConv.id)
								})
							"
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
	.msgr-incoming-enter-active .msgr-incoming__card {
		animation: none;
	}

	.msgr-call-enter-active,
	.msgr-call-leave-active,
	.msgr-incoming-enter-active,
	.msgr-incoming-leave-active {
		transition: none;
	}
}
</style>
