<script setup lang="ts">
import { GlobeIcon, PlusIcon, SearchIcon, UsersIcon, XIcon } from '@modrinth/assets'
import { computed, ref } from 'vue'

import { useMessengerT } from './i18n'
import type { Peer } from './model'
import {
	displayName,
	dms,
	hideConversation,
	openDm,
	openHome,
	presenceFor,
	searchUsers,
	state,
	userOf,
	writeTo,
} from './store'
import { vTip } from './tooltip'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const query = ref('')
const found = ref<Peer[]>([])
const searching = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const worldsCount = computed(
	() => state.friends.filter((peer) => peer.activity?.worldShare || peer.activity?.hosting).length,
)

const list = computed(() => {
	const lower = query.value.trim().toLowerCase()
	return dms.value.filter((conv) => {
		if (!lower) return true
		const name = conv.peer ? displayName(conv.peer.id, conv.peer.username) : conv.title
		return name.toLowerCase().includes(lower)
	})
})

function onQuery(): void {
	if (timer) clearTimeout(timer)
	const value = query.value.trim()
	if (value.length < 2) {
		found.value = []
		return
	}
	timer = setTimeout(async () => {
		searching.value = true
		const users = await searchUsers(value, 6)
		searching.value = false
		if (query.value.trim() === value) {
			const known = new Set(list.value.map((conv) => conv.peer?.id))
			found.value = users.filter(
				(user) => !known.has(user.id) && user.id !== String(state.session?.user?.id),
			)
		}
	}, 300)
}

async function start(peer: Peer): Promise<void> {
	query.value = ''
	found.value = []
	await writeTo(peer)
}

function activityOf(id: string): string {
	const activity = userOf(id)?.activity
	if (!activity) return ''
	if (activity.hosting || activity.worldShare) {
		return t('app.messenger.activity.hosting', 'Открыл мир по сети')
	}
	if (activity.playing) {
		return activity.serverName
			? t('app.messenger.activity.server', 'Играет на {name}', { name: activity.serverName })
			: t('app.messenger.activity.playing', 'Играет в Minecraft')
	}
	return ''
}
</script>

<template>
	<div class="msgr-side">
		<div class="msgr-side__search">
			<label>
				<input
					v-model="query"
					type="search"
					:placeholder="t('app.messenger.findOrStart', 'Найти или начать беседу')"
					@input="onQuery"
					@keydown.esc="query = ''"
				/>
				<SearchIcon />
			</label>
		</div>
		<div class="msgr-side__scroll">
			<button
				type="button"
				class="msgr-side__nav"
				:class="{ 'is-active': state.homePage === 'friends' }"
				@click="openHome('friends')"
			>
				<UsersIcon />
				<span>{{ t('app.messenger.friends.title', 'Друзья') }}</span>
				<b v-if="state.incoming.length" class="msgr-side__badge">{{ state.incoming.length }}</b>
			</button>
			<button
				type="button"
				class="msgr-side__nav"
				:class="{ 'is-active': state.homePage === 'worlds' }"
				@click="openHome('worlds')"
			>
				<GlobeIcon />
				<span>{{ t('app.messenger.worlds.title', 'Миры по сети') }}</span>
				<b v-if="worldsCount" class="msgr-side__badge is-soft">{{ worldsCount }}</b>
			</button>

			<div v-if="found.length || searching" class="msgr-side__group">
				<span>{{ t('app.messenger.searchPeople', 'Игроки') }}</span>
			</div>
			<button
				v-for="peer in found"
				:key="`f${peer.id}`"
				type="button"
				class="msgr-side__dm"
				@click="start(peer)"
			>
				<UserAvatar :user-id="peer.id" :name="peer.username" :size="32" status ring="#16171a" />
				<span class="msgr-side__dm-body">
					<b>{{ peer.username }}</b>
					<small>{{ t('app.messenger.startChat', 'Начать беседу') }}</small>
				</span>
			</button>

			<div class="msgr-side__group">
				<span>{{ t('app.messenger.dms', 'Личные сообщения') }}</span>
				<button
					v-tip="t('app.messenger.newDm', 'Создать ЛС')"
					type="button"
					@click="(openHome('friends'), (state.friendsTab = 'add'))"
				>
					<PlusIcon />
				</button>
			</div>
			<TransitionGroup name="msgr-list" tag="div">
				<div
					v-for="conv in list"
					:key="conv.id"
					class="msgr-side__dm"
					:class="{
						'is-active': state.homePage === 'dm' && state.activeDmId === conv.id,
						'is-unread': conv.unread > 0,
					}"
					role="button"
					tabindex="0"
					@click="openDm(conv.id)"
					@keydown.enter="openDm(conv.id)"
				>
					<UserAvatar
						v-if="conv.peer"
						:user-id="conv.peer.id"
						:name="conv.peer.username"
						:size="32"
						status
						ring="#16171a"
					/>
					<span class="msgr-side__dm-body">
						<b>{{ conv.peer ? displayName(conv.peer.id, conv.peer.username) : conv.title }}</b>
						<small v-if="conv.peer && activityOf(conv.peer.id)" class="is-activity">{{
							activityOf(conv.peer.id)
						}}</small>
						<small v-else-if="conv.lastPreview">{{ conv.lastPreview }}</small>
						<small v-else-if="conv.peer && presenceFor(conv.peer.id) !== 'offline'">{{
							t('app.messenger.status.online', 'В сети')
						}}</small>
					</span>
					<b v-if="conv.unread" class="msgr-side__badge">{{
						conv.unread > 99 ? '99+' : conv.unread
					}}</b>
					<button
						v-tip="t('app.messenger.closeDm', 'Закрыть ЛС')"
						type="button"
						class="msgr-side__close"
						@click.stop="hideConversation(conv.id)"
					>
						<XIcon />
					</button>
				</div>
			</TransitionGroup>
			<p v-if="!list.length && !found.length" class="msgr-side__empty">
				{{
					query
						? t('app.messenger.nothingFound', 'Ничего не найдено')
						: t('app.messenger.noDms', 'Здесь появятся ваши личные беседы')
				}}
			</p>
		</div>
	</div>
</template>
