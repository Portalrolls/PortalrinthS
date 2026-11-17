<script setup lang="ts">
import {
	ChevronDownIcon,
	ChevronRightIcon,
	EditIcon,
	EyeOffIcon,
	FolderIcon,
	HashIcon,
	LogOutIcon,
	PlusIcon,
	SettingsIcon,
	TrashIcon,
	UserPlusIcon,
	Volume2Icon,
	XIcon,
} from '@modrinth/assets'
import { computed, ref } from 'vue'

import FloatingMenu from './FloatingMenu.vue'
import { useMessengerT } from './i18n'
import MicOffIcon from './MicOffIcon.vue'
import type { Category, Channel, Conversation } from './model'
import {
	activeChannel,
	activeServer,
	activeStructure,
	canManage,
	deleteCategory,
	deleteChannel,
	displayName,
	hideConversation,
	isOwner,
	openChannel,
	saveCategory,
	showToast,
	state,
} from './store'
import { vTip } from './tooltip'
import { type Anchor, askConfirm, askPrompt } from './ui-bus'
import UserAvatar from './UserAvatar.vue'
import { joinVoice, voice } from './voice-channel'

const emit = defineEmits<{
	settings: [conv: Conversation, tab?: string]
	channel: [channel: Channel | null, kind: 'text' | 'voice', categoryId: string]
	leave: [conv: Conversation]
}>()

const t = useMessengerT()

const headMenu = ref<Anchor | null>(null)
const channelMenu = ref<{ channel: Channel; anchor: Anchor } | null>(null)
const categoryMenu = ref<{ category: Category; anchor: Anchor } | null>(null)
const collapsed = ref(new Set<string>())

const server = computed(() => activeServer.value)

const groups = computed(() => {
	const structure = activeStructure.value
	if (!structure) return []
	const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position
	const channels = [...structure.channels].sort(byPosition)
	const known = new Set(structure.categories.map((category) => category.id))
	const loose = channels.filter((channel) => !channel.categoryId || !known.has(channel.categoryId))
	const out: { category: Category | null; channels: Channel[] }[] = []
	if (loose.length) out.push({ category: null, channels: loose })
	for (const category of [...structure.categories].sort(byPosition)) {
		out.push({
			category,
			channels: channels.filter((channel) => channel.categoryId === category.id),
		})
	}
	return out
})

function anchorOf(event: Event): Anchor {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

function toggleCategory(id: string): void {
	const next = new Set(collapsed.value)
	if (next.has(id)) next.delete(id)
	else next.add(id)
	collapsed.value = next
}

function visible(category: Category | null, channel: Channel): boolean {
	if (!category || !collapsed.value.has(category.id)) return true
	return activeChannel.value?.id === channel.id || (state.channelUnread[channel.id] ?? 0) > 0
}

async function pick(channel: Channel): Promise<void> {
	if (!server.value) return
	if (channel.kind === 'voice') {
		if (channel.local) {
			showToast(
				t('app.messenger.voice.needChannel', 'Создайте голосовой канал в настройках сервера'),
			)
			return
		}
		const ok = await joinVoice(server.value.id, channel.id)
		if (ok)
			showToast(
				t('app.messenger.voice.joined', 'Вы подключились к «{name}»', { name: channel.name }),
			)
		return
	}
	await openChannel(server.value.id, channel.id)
}

function act(fn: () => void): void {
	headMenu.value = null
	channelMenu.value = null
	categoryMenu.value = null
	fn()
}

async function newCategory(): Promise<void> {
	if (!server.value) return
	const name = await askPrompt({
		title: t('app.messenger.category.create', 'Создать категорию'),
		label: t('app.messenger.category.name', 'Название категории'),
		placeholder: t('app.messenger.category.placeholder', 'Новая категория'),
		confirm: t('app.messenger.create', 'Создать'),
		input: true,
	})
	if (name?.trim()) await saveCategory(server.value.id, null, name.trim())
}

async function renameCategory(category: Category): Promise<void> {
	if (!server.value) return
	const name = await askPrompt({
		title: t('app.messenger.category.rename', 'Переименовать категорию'),
		label: t('app.messenger.category.name', 'Название категории'),
		value: category.name,
		confirm: t('app.messenger.save', 'Сохранить'),
		input: true,
	})
	if (name?.trim() && name.trim() !== category.name)
		await saveCategory(server.value.id, category.id, name.trim())
}

async function removeCategory(category: Category): Promise<void> {
	if (!server.value) return
	const ok = await askConfirm({
		title: t('app.messenger.category.delete', 'Удалить категорию'),
		text: t(
			'app.messenger.category.deleteText',
			'Категория «{name}» будет удалена, каналы останутся.',
			{
				name: category.name,
			},
		),
		confirm: t('app.messenger.delete.confirm', 'Удалить'),
		danger: true,
	})
	if (ok) await deleteCategory(server.value.id, category.id)
}

async function removeChannel(channel: Channel): Promise<void> {
	if (!server.value) return
	const ok = await askConfirm({
		title: t('app.messenger.channel.delete', 'Удалить канал'),
		text: t(
			'app.messenger.channel.deleteText',
			'Канал #{name} и все его сообщения будут удалены.',
			{
				name: channel.name,
			},
		),
		confirm: t('app.messenger.delete.confirm', 'Удалить'),
		danger: true,
	})
	if (ok) await deleteChannel(server.value.id, channel.id)
}

function voiceMembers(channelId: string) {
	return voice.members[channelId] ?? []
}
</script>

<template>
	<div v-if="server" class="msgr-side msgr-side--server">
		<button
			type="button"
			class="msgr-side__server-head"
			:class="{ 'has-cover': server.coverUrl, 'is-open': headMenu }"
			@click.stop="headMenu = headMenu ? null : anchorOf($event)"
		>
			<img v-if="server.coverUrl" class="msgr-side__cover" :src="server.coverUrl" alt="" />
			<span class="msgr-side__server-title">{{ server.title }}</span>
			<XIcon v-if="headMenu" />
			<ChevronDownIcon v-else />
		</button>
		<div class="msgr-side__scroll">
			<p v-if="server.description" class="msgr-side__desc">{{ server.description }}</p>
			<div v-if="!activeStructure" class="msgr-side__loading"><span class="msgr-spinner" /></div>
			<div v-for="group in groups" :key="group.category?.id ?? 'loose'" class="msgr-side__category">
				<div
					v-if="group.category"
					class="msgr-side__category-head"
					@contextmenu.prevent="
						canManage && !group.category.id.startsWith('local:')
							? (categoryMenu = {
									category: group.category,
									anchor: { x: $event.clientX, y: $event.clientY },
								})
							: undefined
					"
				>
					<button type="button" @click="toggleCategory(group.category.id)">
						<ChevronRightIcon v-if="collapsed.has(group.category.id)" />
						<ChevronDownIcon v-else />
						<span>{{ group.category.name }}</span>
					</button>
					<button
						v-if="canManage"
						v-tip="t('app.messenger.channel.create', 'Создать канал')"
						type="button"
						class="msgr-side__category-add"
						@click="emit('channel', null, 'text', group.category.id)"
					>
						<PlusIcon />
					</button>
				</div>
				<template v-for="channel in group.channels" :key="channel.id">
					<div
						v-if="visible(group.category, channel)"
						class="msgr-side__channel"
						:class="{
							'is-active': channel.kind === 'text' && activeChannel?.id === channel.id,
							'is-unread': (state.channelUnread[channel.id] ?? 0) > 0,
							'is-voice-on': channel.kind === 'voice' && voice.channelId === channel.id,
						}"
						role="button"
						tabindex="0"
						@click="pick(channel)"
						@keydown.enter="pick(channel)"
						@contextmenu.prevent="
							canManage && !channel.local
								? (channelMenu = { channel, anchor: { x: $event.clientX, y: $event.clientY } })
								: undefined
						"
					>
						<Volume2Icon v-if="channel.kind === 'voice'" />
						<HashIcon v-else />
						<span class="msgr-side__channel-name">{{ channel.name }}</span>
						<b v-if="state.channelUnread[channel.id]" class="msgr-side__badge">{{
							state.channelUnread[channel.id]
						}}</b>
						<button
							v-if="canManage && channel.kind === 'text'"
							v-tip="t('app.messenger.server.invite', 'Пригласить людей')"
							type="button"
							class="msgr-side__channel-tool"
							@click.stop="emit('settings', server, 'invites')"
						>
							<UserPlusIcon />
						</button>
						<button
							v-if="canManage && !channel.local"
							v-tip="t('app.messenger.channel.edit', 'Настроить канал')"
							type="button"
							class="msgr-side__channel-tool"
							@click.stop="emit('channel', channel, channel.kind, channel.categoryId)"
						>
							<SettingsIcon />
						</button>
					</div>
					<div
						v-if="channel.kind === 'voice' && voiceMembers(channel.id).length"
						class="msgr-side__voice-list"
					>
						<div
							v-for="member in voiceMembers(channel.id)"
							:key="member.userId"
							class="msgr-side__voice-member"
							:class="{ 'is-speaking': voice.speaking[member.userId] }"
						>
							<UserAvatar :user-id="member.userId" :size="22" />
							<span>{{ displayName(member.userId) || member.userId }}</span>
							<MicOffIcon v-if="member.muted || member.deafened" class="msgr-side__voice-muted" />
						</div>
					</div>
				</template>
			</div>
			<button
				v-if="canManage"
				type="button"
				class="msgr-side__add-channel"
				@click="emit('channel', null, 'text', '')"
			>
				<PlusIcon /> {{ t('app.messenger.channel.create', 'Создать канал') }}
			</button>
		</div>

		<FloatingMenu :anchor="headMenu" placement="bottom-start" :width="224" @close="headMenu = null">
			<button
				type="button"
				class="msgr-menu-item"
				@click="act(() => emit('settings', server!, 'invites'))"
			>
				<UserPlusIcon /> {{ t('app.messenger.server.invite', 'Пригласить людей') }}
			</button>
			<button type="button" class="msgr-menu-item" @click="act(() => emit('settings', server!))">
				<SettingsIcon />
				{{
					canManage
						? t('app.messenger.server.settings', 'Настройки сервера')
						: t('app.messenger.server.about', 'О сервере')
				}}
			</button>
			<template v-if="canManage">
				<button
					type="button"
					class="msgr-menu-item"
					@click="act(() => emit('channel', null, 'text', ''))"
				>
					<PlusIcon /> {{ t('app.messenger.channel.create', 'Создать канал') }}
				</button>
				<button type="button" class="msgr-menu-item" @click="act(() => void newCategory())">
					<FolderIcon /> {{ t('app.messenger.category.create', 'Создать категорию') }}
				</button>
			</template>
			<div class="msgr-menu-sep" />
			<button
				type="button"
				class="msgr-menu-item"
				@click="act(() => void hideConversation(server!.id))"
			>
				<EyeOffIcon /> {{ t('app.messenger.server.hide', 'Скрыть сервер') }}
			</button>
			<button
				v-if="!isOwner(server) && !server.project"
				type="button"
				class="msgr-menu-item is-danger"
				@click="act(() => emit('leave', server!))"
			>
				<LogOutIcon /> {{ t('app.messenger.server.leave', 'Покинуть сервер') }}
			</button>
		</FloatingMenu>

		<FloatingMenu :anchor="channelMenu?.anchor ?? null" :width="210" @close="channelMenu = null">
			<template v-if="channelMenu">
				<button
					type="button"
					class="msgr-menu-item"
					@click="
						act(() =>
							emit(
								'channel',
								channelMenu!.channel,
								channelMenu!.channel.kind,
								channelMenu!.channel.categoryId,
							),
						)
					"
				>
					<EditIcon /> {{ t('app.messenger.channel.edit', 'Настроить канал') }}
				</button>
				<button
					type="button"
					class="msgr-menu-item is-danger"
					@click="act(() => void removeChannel(channelMenu!.channel))"
				>
					<TrashIcon /> {{ t('app.messenger.channel.delete', 'Удалить канал') }}
				</button>
			</template>
		</FloatingMenu>

		<FloatingMenu :anchor="categoryMenu?.anchor ?? null" :width="210" @close="categoryMenu = null">
			<template v-if="categoryMenu">
				<button
					type="button"
					class="msgr-menu-item"
					@click="act(() => emit('channel', null, 'text', categoryMenu!.category.id))"
				>
					<PlusIcon /> {{ t('app.messenger.channel.create', 'Создать канал') }}
				</button>
				<button
					type="button"
					class="msgr-menu-item"
					@click="act(() => void renameCategory(categoryMenu!.category))"
				>
					<EditIcon /> {{ t('app.messenger.category.rename', 'Переименовать категорию') }}
				</button>
				<button
					type="button"
					class="msgr-menu-item is-danger"
					@click="act(() => void removeCategory(categoryMenu!.category))"
				>
					<TrashIcon /> {{ t('app.messenger.category.delete', 'Удалить категорию') }}
				</button>
			</template>
		</FloatingMenu>
	</div>
</template>
