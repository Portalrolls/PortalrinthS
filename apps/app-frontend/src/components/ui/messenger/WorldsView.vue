<script setup lang="ts">
import { CopyIcon, GlobeIcon, MessageIcon, PlayIcon } from '@modrinth/assets'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { hostedAddress, type HostedServerView, hosting_list } from '@/helpers/hosting'
import { list } from '@/helpers/instance'
import type { GameInstance } from '@/helpers/types'
import { start_join_server } from '@/helpers/worlds'

import { useMessengerT } from './i18n'
import type { Peer } from './model'
import { buildLine, loaderName } from './model'
import {
	displayName,
	loadLists,
	requestWorldShares,
	showToast,
	state,
	userOf,
	writeTo,
} from './store'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

/** Друзья с открытым миром идут первыми, просто играющие — следом: в «Мирах
    по сети» видно всех, кто сейчас в игре, а не только расшаривших мир. */
const worlds = computed(() => {
	void state.presenceClock
	const rank = (peer: Peer): number =>
		peer.activity?.hosting || peer.activity?.serverHost ? 0 : peer.activity?.worldShare ? 1 : 2
	return state.friends
		.map((peer) => userOf(peer.id) ?? peer)
		.filter(
			(peer) =>
				peer.activity?.worldShare ||
				peer.activity?.hosting ||
				peer.activity?.serverHost ||
				peer.activity?.playing,
		)
		.sort((a, b) => rank(a) - rank(b))
})

/** Бейдж карточки: у кого свой сервер, у кого открытый мир, кто просто в игре. */
function worldBadge(peer: Peer): { text: string; kind: 'self' | 'lan' | 'game' } | null {
	const activity = peer.activity
	if (!activity) return null
	if (activity.hosting || activity.serverHost)
		return { text: t('app.messenger.worlds.badgeSelf', 'Self-Hosted'), kind: 'self' }
	if (activity.worldShare) return { text: t('app.messenger.worlds.badgeLan', 'LAN'), kind: 'lan' }
	if (activity.playing)
		return { text: t('app.messenger.worlds.badgePlaying', 'В игре'), kind: 'game' }
	return null
}

const CORE_NAMES: Record<string, string> = {
	paper: 'Paper',
	purpur: 'Purpur',
	vanilla: 'Vanilla',
	fabric: 'Fabric',
	quilt: 'Quilt',
	folia: 'Folia',
}

/** Запущенные собственные серверы (Self-Hosted) — обновляются раз в 10 секунд. */
const hosted = ref<HostedServerView[]>([])
let hostedTimer: number | undefined
let worldTimer: number | undefined

async function loadHosted(): Promise<void> {
	try {
		hosted.value = (await hosting_list()).filter((server) => server.status === 'running')
	} catch {
		hosted.value = []
	}
}

onMounted(() => {
	void loadHosted()
	hostedTimer = window.setInterval(() => void loadHosted(), 10000)
	// Свежие миры друзей: подписываемся на списки (там статусы активностей) и
	// просим друзей прислать их миры личным сигналом — ответ приходит моментально.
	void loadLists()
	void requestWorldShares()
	worldTimer = window.setInterval(() => void requestWorldShares(), 25000)
})

onBeforeUnmount(() => {
	if (hostedTimer !== undefined) window.clearInterval(hostedTimer)
	if (worldTimer !== undefined) window.clearInterval(worldTimer)
})

function hostedAddressOf(server: HostedServerView): string {
	return hostedAddress(server) ?? `127.0.0.1:${server.port}`
}

async function copyAddress(host: string): Promise<void> {
	await navigator.clipboard.writeText(host).catch(() => undefined)
	showToast(t('app.messenger.worlds.copied', 'Адрес скопирован — вставьте его в «Сетевая игра»'))
}

/* ─── Присоединиться: выбор сборки → запуск игры сразу на сервер ─── */

const joinTarget = ref<{ host: string; version: string; label: string } | null>(null)
const builds = ref<GameInstance[]>([])
const buildsLoading = ref(false)
const buildsError = ref(false)
const launchingId = ref('')

async function openJoin(host: string, version: string, label: string): Promise<void> {
	joinTarget.value = { host, version, label }
	builds.value = []
	buildsError.value = false
	buildsLoading.value = true
	try {
		builds.value = await list()
	} catch {
		builds.value = []
		buildsError.value = true
	} finally {
		buildsLoading.value = false
	}
}

function retryBuilds(): void {
	const target = joinTarget.value
	if (target) void openJoin(target.host, target.version, target.label)
}

/** Tauri отдаёт дату ISO-строкой, хотя тип объявляет Date — приводим оба варианта. */
function playedAt(value: unknown): number {
	if (value instanceof Date) return value.getTime()
	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value).getTime()
		if (!Number.isNaN(parsed)) return parsed
	}
	return 0
}

function closeJoin(): void {
	if (launchingId.value) return
	joinTarget.value = null
}

const sortedBuilds = computed(() => {
	const target = joinTarget.value
	return [...builds.value]
		.filter((build) => !build.quarantined)
		.sort((a, b) => {
			if (target?.version) {
				const fitA = a.game_version === target.version ? 0 : 1
				const fitB = b.game_version === target.version ? 0 : 1
				if (fitA !== fitB) return fitA - fitB
			}
			return playedAt(b.last_played) - playedAt(a.last_played)
		})
})

function isFit(build: GameInstance): boolean {
	return Boolean(joinTarget.value?.version) && build.game_version === joinTarget.value!.version
}

async function joinWith(build: GameInstance): Promise<void> {
	const target = joinTarget.value
	if (!target || launchingId.value) return
	launchingId.value = build.id
	try {
		await start_join_server(build.id, target.host)
		showToast(
			t('app.messenger.worlds.launching', 'Запускаем «{name}» — подключаемся к {host}', {
				name: build.name,
				host: target.host,
			}),
		)
		joinTarget.value = null
	} catch {
		showToast(t('app.messenger.worlds.joinFailed', 'Не удалось запустить подключение к серверу'))
	} finally {
		launchingId.value = ''
	}
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
						'Здесь появляются ваши запущенные серверы и миры, в которых сейчас играют ваши друзья. Скопируйте адрес или присоединяйтесь в один клик.',
					)
				}}
			</p>
			<TransitionGroup name="msgr-list" tag="div" class="msgr-worlds__grid">
				<article
					v-for="server in hosted"
					:key="`hosted-${server.id}`"
					class="msgr-worlds__card is-own"
				>
					<div class="msgr-worlds__top">
						<span class="msgr-worlds__own-icon"><GlobeIcon /></span>
						<div>
							<b>{{ server.name }} <span class="msgr-worlds__badge is-self">Self-Hosted</span></b>
							<small>{{ t('app.messenger.worlds.ownServer', 'Ваш сервер запущен') }}</small>
						</div>
					</div>
					<div class="msgr-worlds__meta">
						<span>
							<i>{{ t('app.messenger.worlds.core', 'Ядро') }}</i
							>{{ CORE_NAMES[server.software] ?? server.software }}
						</span>
						<span>
							<i>{{ t('app.messenger.worlds.version', 'Версия') }}</i
							>{{ server.game_version }}
						</span>
						<span>
							<i>{{ t('app.messenger.worlds.address', 'Адрес') }}</i
							><code>{{ hostedAddressOf(server) }}</code>
						</span>
					</div>
					<div class="msgr-worlds__actions">
						<button
							type="button"
							class="is-primary"
							@click="openJoin(hostedAddressOf(server), server.game_version, server.name)"
						>
							<PlayIcon /> {{ t('app.messenger.worlds.join', 'Присоединиться') }}
						</button>
						<button type="button" @click="copyAddress(hostedAddressOf(server))">
							<CopyIcon /> {{ t('app.messenger.worlds.copy', 'Копировать адрес') }}
						</button>
					</div>
				</article>
				<article v-for="peer in worlds" :key="peer.id" class="msgr-worlds__card">
					<div class="msgr-worlds__top">
						<UserAvatar :user-id="peer.id" :name="peer.username" :size="40" status ring="#1b1c20" />
						<div>
							<b>
								{{ displayName(peer.id, peer.username) }}
								<span
									v-if="worldBadge(peer)"
									class="msgr-worlds__badge"
									:class="`is-${worldBadge(peer)!.kind}`"
									>{{ worldBadge(peer)!.text }}</span
								>
							</b>
							<small>{{
								buildLine(peer.activity) ||
								(peer.activity?.hosting || peer.activity?.worldShare
									? t('app.messenger.activity.hosting', 'Открыл мир по сети')
									: t('app.messenger.activity.playing', 'Играет в Minecraft'))
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
						<span v-if="peer.activity?.loader">
							<i>{{ t('app.messenger.worlds.core', 'Ядро') }}</i
							>{{ loaderName(peer.activity.loader) }}
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
							@click="
								openJoin(
									peer.activity!.serverHost!,
									peer.activity?.gameVersion || '',
									peer.activity?.serverName || displayName(peer.id, peer.username),
								)
							"
						>
							<PlayIcon /> {{ t('app.messenger.worlds.join', 'Присоединиться') }}
						</button>
						<button
							v-if="peer.activity?.serverHost"
							type="button"
							@click="copyAddress(peer.activity!.serverHost!)"
						>
							<CopyIcon /> {{ t('app.messenger.worlds.copy', 'Копировать адрес') }}
						</button>
						<button v-if="!peer.activity?.serverHost" type="button" @click="writeTo(peer)">
							<MessageIcon /> {{ t('app.messenger.worlds.ask', 'Попросить приглашение') }}
						</button>
					</div>
				</article>
			</TransitionGroup>
			<div v-if="!hosted.length && !worlds.length" class="msgr-worlds__empty">
				<GlobeIcon />
				<p>
					{{
						t(
							'app.messenger.worlds.empty',
							'Сейчас никто из друзей не открыл мир по сети, и ваши серверы не запущены.',
						)
					}}
				</p>
			</div>
		</div>

		<Teleport to="body">
			<div v-if="joinTarget" class="msgr-worlds__overlay" @click.self="closeJoin">
				<div class="msgr-worlds__dialog">
					<header class="msgr-worlds__dialog-head">
						<b>{{ t('app.messenger.worlds.joinTitle', 'Выберите сборку') }}</b>
						<small>{{ joinTarget.label }} · {{ joinTarget.host }}</small>
					</header>
					<div class="msgr-worlds__builds">
						<p v-if="buildsLoading" class="msgr-worlds__builds-note">
							{{ t('app.messenger.worlds.loadingBuilds', 'Загружаем сборки…') }}
						</p>
						<p v-else-if="buildsError" class="msgr-worlds__builds-note">
							{{ t('app.messenger.worlds.buildsFailed', 'Не удалось загрузить список сборок') }}
							<button type="button" class="msgr-worlds__retry" @click="retryBuilds">
								{{ t('app.messenger.worlds.retry', 'Повторить') }}
							</button>
						</p>
						<p v-else-if="!sortedBuilds.length" class="msgr-worlds__builds-note">
							{{
								t(
									'app.messenger.worlds.noBuilds',
									'Сборок пока нет — создайте её на вкладке «Библиотека».',
								)
							}}
						</p>
						<button
							v-for="build in sortedBuilds"
							:key="build.id"
							type="button"
							class="msgr-worlds__build"
							:class="{ 'is-fit': isFit(build), 'is-busy': launchingId === build.id }"
							:disabled="Boolean(launchingId)"
							@click="joinWith(build)"
						>
							<span class="msgr-worlds__build-name">{{ build.name }}</span>
							<span class="msgr-worlds__build-meta">
								{{ build.game_version }} · {{ loaderName(build.loader) }}
							</span>
							<span v-if="isFit(build)" class="msgr-worlds__fit">
								{{ t('app.messenger.worlds.versionFit', 'совпадает с версией сервера') }}
							</span>
						</button>
					</div>
					<footer class="msgr-worlds__dialog-foot">
						<button type="button" class="msgr-worlds__cancel" @click="closeJoin">
							{{ t('app.messenger.worlds.cancel', 'Отмена') }}
						</button>
					</footer>
				</div>
			</div>
		</Teleport>
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

.msgr-worlds__card.is-own {
	border-color: color-mix(in srgb, var(--color-brand) 28%, transparent);
}

.msgr-worlds__own-icon {
	display: inline-flex;
	width: 2.5rem;
	height: 2.5rem;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	background: color-mix(in srgb, var(--color-brand) 20%, transparent);
	color: var(--color-brand);
}

.msgr-worlds__own-icon svg {
	width: 1.3rem;
	height: 1.3rem;
}

.msgr-worlds__badge {
	padding: 0.08rem 0.4rem;
	margin-left: 0.3rem;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.1);
	font-size: 0.62rem;
	font-weight: 800;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	vertical-align: middle;
	opacity: 0.9;
}

.msgr-worlds__badge.is-self {
	background: color-mix(in srgb, var(--color-brand) 30%, transparent);
	color: var(--color-brand);
}

.msgr-worlds__badge.is-lan {
	background: rgba(35, 165, 90, 0.25);
	color: #57f287;
}

.msgr-worlds__badge.is-game {
	background: rgba(255, 255, 255, 0.08);
	opacity: 0.7;
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
	background: var(--msgr-btn);
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

.msgr-worlds__overlay {
	position: fixed;
	inset: 0;
	z-index: 200;
	display: grid;
	place-items: center;
	padding: 1rem;
	background: rgba(0, 0, 0, 0.55);
}

.msgr-worlds__dialog {
	display: flex;
	width: min(28rem, 100%);
	max-height: min(30rem, 90vh);
	flex-direction: column;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 14px;
	background: #1b1c20;
	box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}

.msgr-worlds__dialog-head {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	padding: 1rem 1.1rem 0.8rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.msgr-worlds__dialog-head b {
	color: var(--color-contrast);
}

.msgr-worlds__dialog-head small {
	color: var(--color-secondary);
	font-size: 0.8rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-worlds__builds {
	min-height: 0;
	flex: 1;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	padding: 0.8rem 1.1rem;
}

.msgr-worlds__builds-note {
	margin: 1rem 0;
	color: var(--color-secondary);
	font-size: 0.85rem;
	text-align: center;
}

.msgr-worlds__retry {
	display: inline-block;
	margin-left: 0.4rem;
	padding: 0.25rem 0.7rem;
	border: 0;
	border-radius: 6px;
	background: var(--msgr-btn);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
}

.msgr-worlds__retry:hover {
	background: var(--msgr-btn3);
}

.msgr-worlds__build {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	padding: 0.6rem 0.75rem;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 8px;
	background: #232529;
	color: var(--color-contrast);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition:
		border-color 0.15s ease,
		background-color 0.15s ease;
}

.msgr-worlds__build:hover {
	border-color: color-mix(in srgb, var(--color-brand) 45%, transparent);
	background: #2a2c31;
}

.msgr-worlds__build.is-fit {
	border-color: color-mix(in srgb, var(--color-brand) 55%, transparent);
}

.msgr-worlds__build.is-busy {
	opacity: 0.6;
	cursor: wait;
}

.msgr-worlds__build:disabled {
	cursor: wait;
}

.msgr-worlds__build-name {
	font-weight: 600;
}

.msgr-worlds__build-meta {
	color: var(--color-secondary);
	font-size: 0.78rem;
}

.msgr-worlds__fit {
	color: var(--color-brand);
	font-size: 0.75rem;
	font-weight: 600;
}

.msgr-worlds__dialog-foot {
	display: flex;
	justify-content: flex-end;
	padding: 0.8rem 1.1rem 1rem;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.msgr-worlds__cancel {
	padding: 0.45rem 0.9rem;
	border: 0;
	border-radius: 6px;
	background: var(--msgr-btn);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.82rem;
	font-weight: 600;
	cursor: pointer;
}

.msgr-worlds__cancel:hover {
	background: var(--msgr-btn3);
}

@media (prefers-reduced-motion: reduce) {
	.msgr-worlds__card {
		transition: none;
	}
}
</style>
