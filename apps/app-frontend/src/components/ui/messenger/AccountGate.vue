<script setup lang="ts">
import { LogInIcon, MessageIcon, RefreshCwIcon, SettingsIcon } from '@modrinth/assets'
import { computed, ref } from 'vue'

import { injectMinecraftAccounts } from '@/features/minecraft-accounts/context'
import { injectSettingsActions } from '@/features/settings/settings-actions'

import { useMessengerT } from './i18n'
import { connect, state } from './store'

const props = defineProps<{ failed?: boolean }>()

const t = useMessengerT()
const accounts = injectMinecraftAccounts(null)
const settings = injectSettingsActions(null)
const busy = ref(false)
const actions = computed(() => accounts?.value ?? null)

const offlineName = computed(() => (state.account.kind === 'offline' ? state.account.name : ''))

async function run(action: () => unknown): Promise<void> {
	busy.value = true
	try {
		await action()
	} finally {
		busy.value = false
	}
}

function microsoft(): Promise<void> {
	return run(async () => {
		await actions.value?.login()
		await connect(true)
	})
}

function ely(): void {
	actions.value?.showElyLogin()
}
</script>

<template>
	<div class="msgr-gate">
		<div class="msgr-gate__card">
			<div class="msgr-gate__icon"><MessageIcon /></div>
			<template v-if="props.failed">
				<h2>{{ t('app.messenger.gate.failedTitle', 'Не удалось подключиться') }}</h2>
				<p>
					{{
						t(
							'app.messenger.gate.failedText',
							'Сервер Undefined не ответил. Проверьте интернет и попробуйте ещё раз.',
						)
					}}
				</p>
				<div class="msgr-gate__actions">
					<button type="button" class="msgr-btn" :disabled="state.loading" @click="connect(true)">
						<RefreshCwIcon /> {{ t('app.messenger.gate.retry', 'Повторить') }}
					</button>
				</div>
			</template>
			<template v-else>
				<h2>
					{{
						t('app.messenger.gate.title', 'Нужен вход в аккаунт Undefined (Microsoft или Ely.by)')
					}}
				</h2>
				<p v-if="offlineName">
					{{
						t(
							'app.messenger.gate.offline',
							'Сейчас выбран офлайн-аккаунт «{name}». В мессенджере пишут только лицензионные и Ely.by-аккаунты — выберите другой или войдите.',
							{ name: offlineName },
						)
					}}
				</p>
				<p v-else>
					{{
						t(
							'app.messenger.gate.text',
							'Войдите через Microsoft или Ely.by, чтобы переписываться с друзьями, создавать серверы и звонить.',
						)
					}}
				</p>
				<div class="msgr-gate__actions">
					<button v-if="actions" type="button" class="msgr-btn" :disabled="busy" @click="microsoft">
						<LogInIcon /> {{ t('app.messenger.gate.microsoft', 'Войти через Microsoft') }}
					</button>
					<button
						v-if="actions"
						type="button"
						class="msgr-btn is-secondary"
						:disabled="busy"
						@click="ely"
					>
						<LogInIcon /> {{ t('app.messenger.gate.ely', 'Войти через Ely.by') }}
					</button>
					<button
						v-if="settings"
						type="button"
						class="msgr-btn is-ghost"
						@click="settings.openSettings()"
					>
						<SettingsIcon /> {{ t('app.messenger.gate.settings', 'Настройки аккаунтов') }}
					</button>
					<button
						type="button"
						class="msgr-btn is-ghost"
						:disabled="state.loading"
						@click="connect(true)"
					>
						<RefreshCwIcon /> {{ t('app.messenger.gate.check', 'Проверить снова') }}
					</button>
				</div>
			</template>
		</div>
	</div>
</template>

<style scoped>
.msgr-gate {
	display: grid;
	flex: 1;
	place-items: center;
	padding: 2rem;
}

.msgr-gate__card {
	display: flex;
	max-width: 30rem;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	padding: 2rem 2.2rem;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 16px;
	background: #1e1f22;
	box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
	text-align: center;
	animation: msgr-gate-in 0.3s ease;
}

.msgr-gate__icon {
	display: grid;
	width: 4rem;
	height: 4rem;
	place-items: center;
	border-radius: 50%;
	background: color-mix(in srgb, var(--color-brand) 20%, transparent);
	color: var(--color-brand);
}

.msgr-gate__icon svg {
	width: 2rem;
	height: 2rem;
}

.msgr-gate__card h2 {
	margin: 0.3rem 0 0;
	color: var(--color-contrast);
	font-size: 1.15rem;
}

.msgr-gate__card p {
	margin: 0;
	color: var(--color-secondary);
	font-size: 0.9rem;
	line-height: 1.45;
}

.msgr-gate__actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 0.5rem;
	margin-top: 0.8rem;
}

@keyframes msgr-gate-in {
	from {
		opacity: 0;
		transform: translateY(10px) scale(0.98);
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-gate__card {
		animation: none;
	}
}
</style>
