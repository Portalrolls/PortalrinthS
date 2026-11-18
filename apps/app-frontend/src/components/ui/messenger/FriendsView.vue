<script setup lang="ts">
import {
	BanIcon,
	CheckIcon,
	MessageIcon,
	MoreVerticalIcon,
	SearchIcon,
	UserIcon,
	UserPlusIcon,
	UsersIcon,
	UserXIcon,
	XIcon,
} from '@modrinth/assets'
import { computed, ref } from 'vue'

import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import type { Peer } from './model'
import PhoneIcon from './PhoneIcon.vue'
import {
	acceptFriend,
	blockUser,
	callUser,
	declineFriend,
	displayName,
	type FriendsTab,
	myId,
	presenceFor,
	relationOf,
	removeFriend,
	requestFriend,
	searchUsers,
	showToast,
	state,
	unblockUser,
	userOf,
	writeTo,
} from './store'
import { vTip } from './tooltip'
import { type Anchor, askConfirm, openProfile } from './ui-bus'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const filter = ref('')
const addQuery = ref('')
const addResults = ref<Peer[]>([])
const addBusy = ref(false)
const addDone = ref(false)
const menu = ref<{ peer: Peer; anchor: Anchor } | null>(null)

const tabs = computed<{ id: FriendsTab; label: string; count?: number }[]>(() => [
	{ id: 'online', label: t('app.messenger.friends.online', 'В сети') },
	{ id: 'all', label: t('app.messenger.friends.all', 'Все') },
	{
		id: 'pending',
		label: t('app.messenger.friends.pending', 'Ожидание'),
		count: state.incoming.length,
	},
	{ id: 'blocked', label: t('app.messenger.friends.blocked', 'Заблокированные') },
])

type Row = { peer: Peer; kind: 'friend' | 'incoming' | 'outgoing' | 'blocked' }

const rows = computed<Row[]>(() => {
	void state.presenceClock
	const lower = filter.value.trim().toLowerCase()
	const match = (peer: Peer) =>
		!lower || displayName(peer.id, peer.username).toLowerCase().includes(lower)
	const fresh = (peer: Peer) => userOf(peer.id) ?? peer
	let list: Row[] = []
	switch (state.friendsTab) {
		case 'online':
			list = state.friends
				.filter((peer) => presenceFor(peer.id) !== 'offline')
				.map((peer) => ({ peer: fresh(peer), kind: 'friend' }))
			break
		case 'all':
			list = state.friends.map((peer) => ({ peer: fresh(peer), kind: 'friend' }))
			break
		case 'pending':
			list = [
				...state.incoming.map((peer) => ({ peer: fresh(peer), kind: 'incoming' as const })),
				...state.outgoing.map((peer) => ({ peer: fresh(peer), kind: 'outgoing' as const })),
			]
			break
		case 'blocked':
			list = state.blocked.map((peer) => ({ peer: fresh(peer), kind: 'blocked' }))
			break
	}
	return list
		.filter((row) => match(row.peer))
		.sort((a, b) =>
			displayName(a.peer.id, a.peer.username).localeCompare(
				displayName(b.peer.id, b.peer.username),
			),
		)
})

/** Пустой «В сети»: кто из друзей заходил недавно — им можно сразу написать. */
const recentFriends = computed(() => {
	void state.presenceClock
	if (state.friendsTab !== 'online' || rows.value.length) return []
	return state.friends
		.map((peer) => userOf(peer.id) ?? peer)
		.filter((peer) => peer.lastSeenAt > 0)
		.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
		.slice(0, 5)
})

function seenAgo(at: number): string {
	const minutes = Math.max(1, Math.round((Date.now() - at) / 60000))
	if (minutes < 60) return t('app.messenger.friends.seenMin', '{n} мин назад', { n: minutes })
	const hours = Math.round(minutes / 60)
	if (hours < 24) return t('app.messenger.friends.seenHour', '{n} ч назад', { n: hours })
	return t('app.messenger.friends.seenDay', '{n} дн назад', { n: Math.round(hours / 24) })
}

const sectionTitle = computed(() => {
	const count = rows.value.length
	switch (state.friendsTab) {
		case 'online':
			return t('app.messenger.friends.onlineCount', 'В сети — {count}', { count })
		case 'all':
			return t('app.messenger.friends.allCount', 'Все друзья — {count}', { count })
		case 'pending':
			return t('app.messenger.friends.pendingCount', 'Ожидание — {count}', { count })
		default:
			return t('app.messenger.friends.blockedCount', 'Заблокированные — {count}', { count })
	}
})

function statusText(row: Row): string {
	if (row.kind === 'incoming') return t('app.messenger.friends.incoming', 'Входящий запрос дружбы')
	if (row.kind === 'outgoing') return t('app.messenger.friends.outgoing', 'Исходящий запрос дружбы')
	if (row.kind === 'blocked') return t('app.messenger.friends.blockedBadge', 'Заблокирован')
	const activity = row.peer.activity
	if (activity?.hosting || activity?.worldShare)
		return t('app.messenger.activity.hosting', 'Открыл мир по сети')
	if (activity?.playing) {
		return activity.serverName
			? t('app.messenger.activity.server', 'Играет на {name}', { name: activity.serverName })
			: t('app.messenger.activity.playing', 'Играет в Minecraft')
	}
	switch (presenceFor(row.peer.id)) {
		case 'online':
			return t('app.messenger.status.online', 'В сети')
		case 'busy':
			return t('app.messenger.status.busy', 'Отошёл')
		case 'dnd':
			return t('app.messenger.status.dnd', 'Не беспокоить')
		default:
			return t('app.messenger.status.offline', 'Не в сети')
	}
}

async function runAdd(): Promise<void> {
	const query = addQuery.value.trim()
	addDone.value = false
	if (query.length < 2) {
		addResults.value = []
		return
	}
	addBusy.value = true
	addResults.value = (await searchUsers(query, 12)).filter((peer) => peer.id !== myId.value)
	addBusy.value = false
	addDone.value = true
}

async function sendRequest(peer: Peer): Promise<void> {
	if (await requestFriend(peer.id)) {
		showToast(
			t('app.messenger.friends.sentTo', 'Заявка отправлена {name}', { name: peer.username }),
		)
	}
}

function openMenu(event: MouseEvent, peer: Peer): void {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	menu.value = { peer, anchor: { x: rect.left, y: rect.top, w: rect.width, h: rect.height } }
}

async function remove(peer: Peer): Promise<void> {
	menu.value = null
	const ok = await askConfirm({
		title: t('app.messenger.friends.removeTitle', 'Удалить «{name}»', { name: peer.username }),
		text: t(
			'app.messenger.friends.removeText',
			'Вы уверены, что хотите удалить {name} из друзей?',
			{
				name: peer.username,
			},
		),
		confirm: t('app.messenger.friends.remove', 'Удалить из друзей'),
		danger: true,
	})
	if (ok) await removeFriend(peer.id)
}

async function block(peer: Peer): Promise<void> {
	menu.value = null
	const ok = await askConfirm({
		title: t('app.messenger.friends.blockTitle', 'Заблокировать {name}?', { name: peer.username }),
		text: t(
			'app.messenger.friends.blockText',
			'Он не сможет писать вам и звонить. Разблокировать можно во вкладке «Заблокированные».',
		),
		confirm: t('app.messenger.friends.block', 'Заблокировать'),
		danger: true,
	})
	if (ok) await blockUser(peer.id)
}
</script>

<template>
	<section class="msgr-friends">
		<header class="msgr-friends__head">
			<span class="msgr-friends__title"
				><UsersIcon /> {{ t('app.messenger.friends.title', 'Друзья') }}</span
			>
			<span class="msgr-friends__sep" />
			<button
				v-for="tab in tabs"
				:key="tab.id"
				type="button"
				class="msgr-friends__tab"
				:class="{ 'is-active': state.friendsTab === tab.id }"
				@click="state.friendsTab = tab.id"
			>
				{{ tab.label }}
				<b v-if="tab.count" class="msgr-side__badge">{{ tab.count }}</b>
			</button>
			<button
				type="button"
				class="msgr-friends__tab msgr-friends__tab--add"
				:class="{ 'is-active': state.friendsTab === 'add' }"
				@click="state.friendsTab = 'add'"
			>
				{{ t('app.messenger.friends.add', 'Добавить в друзья') }}
			</button>
		</header>

		<Transition name="msgr-swap" mode="out-in">
			<div v-if="state.friendsTab === 'add'" key="add" class="msgr-friends__body">
				<h2>{{ t('app.messenger.friends.add', 'Добавить в друзья') }}</h2>
				<p class="msgr-friends__hint">
					{{
						t(
							'app.messenger.friends.addHint',
							'Вы можете добавить друга по нику Minecraft или Ely.by.',
						)
					}}
				</p>
				<form class="msgr-friends__add" @submit.prevent="runAdd">
					<input
						v-model="addQuery"
						type="text"
						:placeholder="t('app.messenger.friends.addPlaceholder', 'Введите ник игрока')"
						autocomplete="off"
						spellcheck="false"
					/>
					<button type="submit" :disabled="addQuery.trim().length < 2 || addBusy">
						{{ t('app.messenger.friends.find', 'Найти') }}
					</button>
				</form>
				<div class="msgr-friends__list">
					<div v-if="addBusy" class="msgr-friends__empty"><span class="msgr-spinner" /></div>
					<p v-else-if="addDone && !addResults.length" class="msgr-friends__empty">
						{{ t('app.messenger.friends.notFound', 'Никого не нашли. Проверьте ник.') }}
					</p>
					<div v-for="peer in addResults" :key="peer.id" class="msgr-friends__row">
						<button
							type="button"
							class="msgr-friends__who"
							@click="openProfile(peer.id, peer.username)"
						>
							<UserAvatar
								:user-id="peer.id"
								:name="peer.username"
								:size="36"
								status
								ring="#1a1b1e"
							/>
							<span>
								<b>{{ peer.username }}</b>
								<small>{{ peer.provider === 'ely' ? 'Ely.by' : 'Microsoft' }}</small>
							</span>
						</button>
						<div class="msgr-friends__actions">
							<button
								v-tip="t('app.messenger.write', 'Написать')"
								type="button"
								@click="writeTo(peer)"
							>
								<MessageIcon />
							</button>
							<button
								v-if="relationOf(peer.id) === 'none'"
								v-tip="t('app.messenger.friends.sendRequest', 'Отправить заявку')"
								type="button"
								class="is-accent"
								@click="sendRequest(peer)"
							>
								<UserPlusIcon />
							</button>
							<span v-else class="msgr-friends__tag">{{
								relationOf(peer.id) === 'friend'
									? t('app.messenger.peer.friend', 'Друг')
									: relationOf(peer.id) === 'blocked'
										? t('app.messenger.friends.blockedBadge', 'Заблокирован')
										: t('app.messenger.friends.pendingShort', 'Заявка')
							}}</span>
						</div>
					</div>
				</div>
			</div>
			<div v-else :key="state.friendsTab" class="msgr-friends__body">
				<label class="msgr-friends__filter">
					<input
						v-model="filter"
						type="search"
						:placeholder="t('app.messenger.search.people', 'Поиск')"
					/>
					<SearchIcon />
				</label>
				<h4 class="msgr-friends__section">{{ sectionTitle }}</h4>
				<TransitionGroup name="msgr-list" tag="div" class="msgr-friends__list">
					<div
						v-for="row in rows"
						:key="`${row.kind}${row.peer.id}`"
						class="msgr-friends__row"
						role="button"
						tabindex="0"
						@click="
							row.kind === 'friend'
								? writeTo(row.peer)
								: openProfile(row.peer.id, row.peer.username)
						"
					>
						<div class="msgr-friends__who">
							<UserAvatar
								:user-id="row.peer.id"
								:name="row.peer.username"
								:size="36"
								status
								ring="#1a1b1e"
							/>
							<span>
								<b>{{ displayName(row.peer.id, row.peer.username) }}</b>
								<small>{{ statusText(row) }}</small>
							</span>
						</div>
						<div class="msgr-friends__actions" @click.stop>
							<template v-if="row.kind === 'friend'">
								<button
									v-tip="t('app.messenger.write', 'Написать')"
									type="button"
									@click="writeTo(row.peer)"
								>
									<MessageIcon />
								</button>
								<button
									v-tip="t('app.messenger.call.action', 'Позвонить')"
									type="button"
									@click="callUser(row.peer)"
								>
									<PhoneIcon />
								</button>
								<button
									v-tip="t('app.messenger.more', 'Ещё')"
									type="button"
									@click="openMenu($event, row.peer)"
								>
									<MoreVerticalIcon />
								</button>
							</template>
							<template v-else-if="row.kind === 'incoming'">
								<button
									v-tip="t('app.messenger.friends.accept', 'Принять')"
									type="button"
									class="is-ok"
									@click="acceptFriend(row.peer.id)"
								>
									<CheckIcon />
								</button>
								<button
									v-tip="t('app.messenger.friends.decline', 'Отклонить')"
									type="button"
									class="is-bad"
									@click="declineFriend(row.peer.id)"
								>
									<XIcon />
								</button>
							</template>
							<button
								v-else-if="row.kind === 'outgoing'"
								v-tip="t('app.messenger.friends.cancel', 'Отменить заявку')"
								type="button"
								class="is-bad"
								@click="removeFriend(row.peer.id)"
							>
								<XIcon />
							</button>
							<button
								v-else
								v-tip="t('app.messenger.friends.unblock', 'Разблокировать')"
								type="button"
								class="is-bad"
								@click="unblockUser(row.peer.id)"
							>
								<UserXIcon />
							</button>
						</div>
					</div>
				</TransitionGroup>
				<div v-if="!rows.length" class="msgr-friends__empty">
					<UsersIcon />
					<p>
						{{
							state.friendsTab === 'online'
								? t(
										'app.messenger.friends.emptyOnline',
										'Никого из друзей нет в сети. Самое время позвать их поиграть.',
									)
								: state.friendsTab === 'pending'
									? t('app.messenger.friends.emptyPending', 'Нет заявок в друзья.')
									: state.friendsTab === 'blocked'
										? t('app.messenger.friends.emptyBlocked', 'Вы никого не заблокировали.')
										: t(
												'app.messenger.friends.empty',
												'Пока здесь пусто — добавьте друзей по нику.',
											)
						}}
					</p>
					<button
						v-if="state.friendsTab === 'online' || state.friendsTab === 'all'"
						type="button"
						class="msgr-friends__cta"
						@click="state.friendsTab = 'add'"
					>
						{{ t('app.messenger.friends.add', 'Добавить в друзья') }}
					</button>
					<div v-if="recentFriends.length" class="msgr-friends__recent">
						<small>{{ t('app.messenger.friends.recent', 'Недавно были в сети') }}</small>
						<div
							v-for="(peer, index) in recentFriends"
							:key="peer.id"
							class="msgr-friends__recent-row"
							:style="{ animationDelay: `${index * 45}ms` }"
						>
							<button
								type="button"
								class="msgr-friends__recent-who"
								@click="openProfile(peer.id, peer.username)"
							>
								<UserAvatar :user-id="peer.id" :name="peer.username" :size="32" />
								<span>
									<b>{{ displayName(peer.id, peer.username) }}</b>
									<em>{{ seenAgo(peer.lastSeenAt) }}</em>
								</span>
							</button>
							<button
								v-tip="t('app.messenger.friends.message', 'Написать')"
								type="button"
								class="msgr-friends__recent-act"
								@click="writeTo(peer)"
							>
								<MessageIcon />
							</button>
						</div>
					</div>
				</div>
			</div>
		</Transition>

		<FloatingMenu
			:anchor="menu?.anchor ?? null"
			placement="bottom-end"
			:width="210"
			@close="menu = null"
		>
			<template v-if="menu">
				<button
					type="button"
					class="msgr-menu-item"
					@click="(openProfile(menu.peer.id, menu.peer.username), (menu = null))"
				>
					<UserIcon /> {{ t('app.messenger.viewProfile', 'Посмотреть профиль') }}
				</button>
				<div class="msgr-menu-sep" />
				<button type="button" class="msgr-menu-item is-danger" @click="remove(menu.peer)">
					<UserXIcon /> {{ t('app.messenger.friends.remove', 'Удалить из друзей') }}
				</button>
				<button type="button" class="msgr-menu-item is-danger" @click="block(menu.peer)">
					<BanIcon /> {{ t('app.messenger.friends.block', 'Заблокировать') }}
				</button>
			</template>
		</FloatingMenu>
	</section>
</template>

<style scoped>
.msgr-friends {
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
}

.msgr-friends__head {
	display: flex;
	height: 3rem;
	flex-shrink: 0;
	align-items: center;
	gap: 0.4rem;
	padding: 0 1rem;
	border-bottom: 1px solid rgba(0, 0, 0, 0.35);
	overflow-x: auto;
}

.msgr-friends__title {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	color: var(--color-contrast);
	font-weight: 700;
	white-space: nowrap;
}

.msgr-friends__title svg {
	width: 1.3rem;
	height: 1.3rem;
	color: var(--color-secondary);
}

.msgr-friends__sep {
	width: 1px;
	height: 1.4rem;
	margin: 0 0.4rem;
	background: rgba(255, 255, 255, 0.1);
}

.msgr-friends__tab {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.2rem 0.6rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: 0.9rem;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
	transition:
		background 0.12s ease,
		color 0.12s ease;
}

.msgr-friends__tab:hover {
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-contrast);
}

.msgr-friends__tab.is-active {
	background: rgba(255, 255, 255, 0.1);
	color: var(--color-contrast);
}

.msgr-friends__tab--add {
	background: #248046;
	color: white;
}

.msgr-friends__tab--add:hover {
	background: #1a6334;
	color: white;
}

.msgr-friends__tab--add.is-active {
	background: transparent;
	color: #2dc770;
}

.msgr-friends__body {
	display: flex;
	min-height: 0;
	flex: 1;
	flex-direction: column;
	padding: 1rem 1.4rem 0;
}

.msgr-friends__body h2 {
	margin: 0.2rem 0 0.2rem;
	color: var(--color-contrast);
	font-size: 1rem;
	font-weight: 800;
	text-transform: uppercase;
}

.msgr-friends__hint {
	margin: 0 0 0.9rem;
	color: var(--color-secondary);
	font-size: 0.85rem;
}

.msgr-friends__add {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.4rem 0.4rem 0.4rem 0.9rem;
	border: 1px solid rgba(0, 0, 0, 0.4);
	border-radius: 10px;
	background: #111214;
	transition: border-color 0.15s ease;
}

.msgr-friends__add:focus-within {
	border-color: var(--color-brand);
}

.msgr-friends__add input {
	min-width: 0;
	flex: 1;
	border: 0;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	outline: none;
}

.msgr-friends__add button,
.msgr-friends__cta {
	padding: 0.5rem 1rem;
	border: 0;
	border-radius: 6px;
	background: var(--color-brand);
	color: white;
	font: inherit;
	font-size: 0.85rem;
	font-weight: 600;
	cursor: pointer;
}

.msgr-friends__add button:disabled {
	opacity: 0.5;
	cursor: default;
}

.msgr-friends__filter {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.4rem 0.6rem;
	border-radius: 6px;
	background: #111214;
}

.msgr-friends__filter input {
	min-width: 0;
	flex: 1;
	border: 0;
	background: transparent;
	color: var(--color-contrast);
	font: inherit;
	outline: none;
}

.msgr-friends__filter svg {
	width: 1rem;
	height: 1rem;
	color: var(--color-secondary);
}

.msgr-friends__section {
	margin: 1.2rem 0 0.4rem;
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.03em;
	text-transform: uppercase;
}

.msgr-friends__list {
	min-height: 0;
	flex: 1;
	overflow-y: auto;
	margin: 0 -0.6rem;
	padding: 0.4rem 0.6rem 1rem;
}

.msgr-friends__row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	padding: 0.55rem 0.6rem;
	border-top: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 8px;
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-friends__row:hover {
	border-top-color: transparent;
	background: rgba(255, 255, 255, 0.04);
}

.msgr-friends__who {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 0.7rem;
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.msgr-friends__who span {
	display: flex;
	min-width: 0;
	flex-direction: column;
}

.msgr-friends__who b {
	color: var(--color-contrast);
}

.msgr-friends__who small {
	overflow: hidden;
	color: var(--color-secondary);
	font-size: 0.78rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-friends__actions {
	display: flex;
	align-items: center;
	gap: 0.45rem;
}

.msgr-friends__actions button {
	display: grid;
	width: 2.25rem;
	height: 2.25rem;
	place-items: center;
	border: 0;
	border-radius: 50%;
	background: #1e1f23;
	color: var(--color-secondary);
	cursor: pointer;
	transition:
		color 0.12s ease,
		background 0.12s ease;
}

.msgr-friends__actions button:hover {
	color: var(--color-contrast);
	background: #111214;
}

.msgr-friends__actions button.is-ok:hover {
	color: #23a55a;
}

.msgr-friends__actions button.is-bad:hover {
	color: #f23f43;
}

.msgr-friends__actions button.is-accent {
	background: var(--color-brand);
	color: white;
}

.msgr-friends__actions svg {
	width: 1.1rem;
	height: 1.1rem;
}

.msgr-friends__tag {
	padding: 0.2rem 0.5rem;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.06);
	color: var(--color-secondary);
	font-size: 0.75rem;
}

.msgr-friends__empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	padding: 3rem 1rem;
	color: var(--color-secondary);
	text-align: center;
}

.msgr-friends__empty > svg {
	width: 3.5rem;
	height: 3.5rem;
	opacity: 0.3;
}

.msgr-friends__empty p {
	max-width: 22rem;
	margin: 0;
}

.msgr-friends__recent {
	display: flex;
	width: min(24rem, 100%);
	flex-direction: column;
	gap: 0.3rem;
	margin-top: 1.2rem;
	text-align: left;
}

.msgr-friends__recent small {
	padding: 0 0.4rem 0.2rem;
	font-size: 0.68rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.msgr-friends__recent-row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 10px;
	background: #2b2d31;
	padding: 0.35rem 0.4rem;
	animation: msgr-recent-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	transition: background 0.15s ease;
}

.msgr-friends__recent-row:hover {
	background: #313338;
}

.msgr-friends__recent-who {
	display: flex;
	min-width: 0;
	flex: 1;
	align-items: center;
	gap: 0.6rem;
	border: none;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font: inherit;
	padding: 0;
	text-align: left;
}

.msgr-friends__recent-who span {
	display: flex;
	min-width: 0;
	flex-direction: column;
}

.msgr-friends__recent-who b {
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 0.85rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-friends__recent-who em {
	font-size: 0.72rem;
	font-style: normal;
}

.msgr-friends__recent-act {
	display: grid;
	width: 2rem;
	height: 2rem;
	place-items: center;
	border: none;
	border-radius: 50%;
	background: #1e1f22;
	color: var(--color-secondary);
	cursor: pointer;
	transition:
		color 0.15s ease,
		transform 0.15s ease;
}

.msgr-friends__recent-act:hover {
	color: var(--color-contrast);
	transform: scale(1.06);
}

.msgr-friends__recent-act svg {
	width: 1rem;
	height: 1rem;
}

@keyframes msgr-recent-in {
	from {
		opacity: 0;
		transform: translateY(6px);
	}
}

.msgr-swap-enter-active,
.msgr-swap-leave-active {
	transition:
		opacity 0.14s ease,
		transform 0.14s ease;
}

.msgr-swap-enter-from {
	opacity: 0;
	transform: translateY(6px);
}

.msgr-swap-leave-to {
	opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
	.msgr-swap-enter-active,
	.msgr-swap-leave-active {
		transition: none;
	}

	.msgr-friends__recent-row {
		animation: none;
	}
}
</style>
