<script setup lang="ts">
import { CopyIcon, GlobeIcon, MessageIcon } from '@modrinth/assets'
import { computed } from 'vue'

import { useMessengerT } from './i18n'
import { displayName, showToast, state, userOf, writeTo } from './store'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const worlds = computed(() => {
	void state.clock
	return state.friends
		.map((peer) => userOf(peer.id) ?? peer)
		.filter(
			(peer) => peer.activity?.worldShare || peer.activity?.hosting || peer.activity?.serverHost,
		)
})

async function copyAddress(host: string): Promise<void> {
	await navigator.clipboard.writeText(host).catch(() => undefined)
	showToast(t('app.messenger.worlds.copied', 'Адрес скопирован — вставьте его в «Сетевая игра»'))
}
</script>

<template>
	<section class="msgr-worlds">
		<header class="msgr-worlds__head">
			<GlobeIcon />
			<b>{{ t('app.messenger.worlds.title', 'Миры по сети') }}</b>
		</header>
		<div class="msgr-worlds__body">
			<p class="msgr-worlds__hint">
				{{
					t(
						'app.messenger.worlds.hint',
						'Здесь появляются миры и серверы, в которых сейчас играют ваши друзья. Скопируйте адрес и подключайтесь.',
					)
				}}
			</p>
			<TransitionGroup name="msgr-list" tag="div" class="msgr-worlds__grid">
				<article v-for="peer in worlds" :key="peer.id" class="msgr-worlds__card">
					<div class="msgr-worlds__top">
						<UserAvatar :user-id="peer.id" :name="peer.username" :size="40" status ring="#1b1c20" />
						<div>
							<b>{{ displayName(peer.id, peer.username) }}</b>
							<small>{{
								peer.activity?.hosting || peer.activity?.worldShare
									? t('app.messenger.activity.hosting', 'Открыл мир по сети')
									: t('app.messenger.activity.playing', 'Играет в Minecraft')
							}}</small>
						</div>
					</div>
					<div class="msgr-worlds__meta">
						<span v-if="peer.activity?.serverName">
							<i>{{ t('app.messenger.worlds.world', 'Мир') }}</i
							>{{ peer.activity.serverName }}
						</span>
						<span v-if="peer.activity?.buildName">
							<i>{{ t('app.messenger.worlds.build', 'Сборка') }}</i
							>{{ peer.activity.buildName }}
						</span>
						<span v-if="peer.activity?.gameVersion">
							<i>{{ t('app.messenger.worlds.version', 'Версия') }}</i
							>{{ peer.activity.gameVersion }}
						</span>
						<span v-if="peer.activity?.serverHost">
							<i>{{ t('app.messenger.worlds.address', 'Адрес') }}</i
							><code>{{ peer.activity.serverHost }}</code>
						</span>
					</div>
					<div class="msgr-worlds__actions">
						<button
							v-if="peer.activity?.serverHost"
							type="button"
							class="is-primary"
							@click="copyAddress(peer.activity!.serverHost!)"
						>
							<CopyIcon /> {{ t('app.messenger.worlds.copy', 'Копировать адрес') }}
						</button>
						<button type="button" @click="writeTo(peer)">
							<MessageIcon /> {{ t('app.messenger.worlds.ask', 'Попросить приглашение') }}
						</button>
					</div>
				</article>
			</TransitionGroup>
			<div v-if="!worlds.length" class="msgr-worlds__empty">
				<GlobeIcon />
				<p>
					{{ t('app.messenger.worlds.empty', 'Сейчас никто из друзей не открыл мир по сети.') }}
				</p>
			</div>
		</div>
	</section>
</template>

<style scoped>
.msgr-worlds {
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
}

.msgr-worlds__head {
	display: flex;
	height: 3rem;
	flex-shrink: 0;
	align-items: center;
	gap: 0.5rem;
	padding: 0 1rem;
	border-bottom: 1px solid rgba(0, 0, 0, 0.35);
	color: var(--color-contrast);
}

.msgr-worlds__head svg {
	width: 1.3rem;
	height: 1.3rem;
	color: var(--color-secondary);
}

.msgr-worlds__body {
	min-height: 0;
	flex: 1;
	overflow-y: auto;
	padding: 1rem 1.4rem;
}

.msgr-worlds__hint {
	margin: 0 0 1rem;
	color: var(--color-secondary);
	font-size: 0.88rem;
}

.msgr-worlds__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
	gap: 0.8rem;
}

.msgr-worlds__card {
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	padding: 1rem;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 12px;
	background: #1b1c20;
	transition:
		transform 0.15s ease,
		border-color 0.15s ease;
}

.msgr-worlds__card:hover {
	border-color: color-mix(in srgb, var(--color-brand) 50%, transparent);
	transform: translateY(-2px);
}

.msgr-worlds__top {
	display: flex;
	align-items: center;
	gap: 0.7rem;
}

.msgr-worlds__top div {
	display: flex;
	flex-direction: column;
}

.msgr-worlds__top b {
	color: var(--color-contrast);
}

.msgr-worlds__top small {
	color: #23a55a;
	font-size: 0.78rem;
}

.msgr-worlds__meta {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.82rem;
}

.msgr-worlds__meta i {
	display: inline-block;
	width: 4.5rem;
	color: var(--color-secondary);
	font-style: normal;
}

.msgr-worlds__meta code {
	padding: 0.05rem 0.3rem;
	border-radius: 4px;
	background: rgba(0, 0, 0, 0.35);
}

.msgr-worlds__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.msgr-worlds__actions button {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.45rem 0.7rem;
	border: 0;
	border-radius: 6px;
	background: #2b2d31;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
}

.msgr-worlds__actions button.is-primary {
	background: var(--color-brand);
	color: white;
}

.msgr-worlds__actions svg {
	width: 1rem;
	height: 1rem;
}

.msgr-worlds__empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	padding: 4rem 1rem;
	color: var(--color-secondary);
	text-align: center;
}

.msgr-worlds__empty svg {
	width: 3.5rem;
	height: 3.5rem;
	opacity: 0.3;
}

@media (prefers-reduced-motion: reduce) {
	.msgr-worlds__card {
		transition: none;
	}
}
</style>
