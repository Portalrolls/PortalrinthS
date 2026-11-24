<script setup lang="ts">
import '@/components/ui/messenger/messenger.css'

import { MessageIcon } from '@modrinth/assets'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AccountGate from '@/components/ui/messenger/AccountGate.vue'
import CallBar from '@/components/ui/messenger/CallBar.vue'
import ChannelModal from '@/components/ui/messenger/ChannelModal.vue'
import ChannelSidebar from '@/components/ui/messenger/ChannelSidebar.vue'
import ChatView from '@/components/ui/messenger/ChatView.vue'
import CreateServerModal from '@/components/ui/messenger/CreateServerModal.vue'
import ForwardModal from '@/components/ui/messenger/ForwardModal.vue'
import FriendsView from '@/components/ui/messenger/FriendsView.vue'
import HomeSidebar from '@/components/ui/messenger/HomeSidebar.vue'
import { useMessengerT } from '@/components/ui/messenger/i18n'
import MemberPanel from '@/components/ui/messenger/MemberPanel.vue'
import MemberPopover from '@/components/ui/messenger/MemberPopover.vue'
import type { Channel, Conversation } from '@/components/ui/messenger/model'
import ProfileEditorModal from '@/components/ui/messenger/ProfileEditorModal.vue'
import PromptModal from '@/components/ui/messenger/PromptModal.vue'
import ServerRail from '@/components/ui/messenger/ServerRail.vue'
import ServerSettingsModal from '@/components/ui/messenger/ServerSettingsModal.vue'
import {
	activeConversation,
	connect,
	leaveServer,
	myId,
	pageVisible,
	state,
	userOf,
	writeTo,
} from '@/components/ui/messenger/store'
import { askConfirm, registerUi } from '@/components/ui/messenger/ui-bus'
import UserPanel from '@/components/ui/messenger/UserPanel.vue'
import UserProfileModal from '@/components/ui/messenger/UserProfileModal.vue'
import WorldsView from '@/components/ui/messenger/WorldsView.vue'
import { useRootBreadcrumb } from '@/shared/breadcrumbs'

defineOptions({ name: 'MessengerPage' })

const t = useMessengerT()
const route = useRoute()
const router = useRouter()

const breadcrumb = useRootBreadcrumb({
	slot: 'root',
	id: 'messenger',
	label: () => t('app.messenger.heading', 'MC Messenger'),
	to: '/messenger',
	visual: { type: 'icon', component: MessageIcon },
})

const profileModal = ref<InstanceType<typeof UserProfileModal> | null>(null)
const promptModal = ref<InstanceType<typeof PromptModal> | null>(null)
const forwardModal = ref<InstanceType<typeof ForwardModal> | null>(null)
const createModal = ref<InstanceType<typeof CreateServerModal> | null>(null)
const channelModal = ref<InstanceType<typeof ChannelModal> | null>(null)
const settingsModal = ref<InstanceType<typeof ServerSettingsModal> | null>(null)

const sidePanel = ref(true)
const pendingDm = ref<{ id: string; username: string } | null>(null)

const ready = computed(() => Boolean(state.session) && state.account.kind === 'ready')
const showGate = computed(
	() => !state.loading && (state.account.kind === 'offline' || state.account.kind === 'none'),
)
const showFailed = computed(() => !state.loading && state.failed && !showGate.value)
const view = computed(() => {
	if (state.section === 'server') return 'chat'
	if (state.homePage === 'dm' && activeConversation.value) return 'chat'
	return state.homePage === 'worlds' ? 'worlds' : 'friends'
})
const showMembers = computed(
	() => view.value === 'chat' && sidePanel.value && Boolean(activeConversation.value),
)

registerUi({
	profile: (userId, fallbackName) => {
		const user = userOf(userId)
		void profileModal.value?.show(
			{ id: userId, username: user?.username || fallbackName, uuid: user?.uuid },
			{ canWrite: userId !== myId.value, self: userId === myId.value },
		)
	},
	prompt: (opts) => promptModal.value?.ask(opts) ?? Promise.resolve(null),
	forward: (msg) => forwardModal.value?.show(msg),
})

function onProfileWrite(user: { id: string; username?: string; name?: string }): void {
	void writeTo({ id: String(user.id), username: user.username || user.name || '' })
}

function openSettings(conv: Conversation, tab?: string): void {
	settingsModal.value?.show(conv.id, tab)
}

function openChannelModal(
	channel: Channel | null,
	kind: 'text' | 'voice',
	categoryId: string,
): void {
	if (!state.activeServerId) return
	channelModal.value?.show(state.activeServerId, channel, kind, categoryId)
}

async function confirmLeave(conv: Conversation): Promise<void> {
	const ok = await askConfirm({
		title: t('app.messenger.settings.leaveTitle', 'Покинуть «{name}»', { name: conv.title }),
		text: t(
			'app.messenger.settings.leaveText',
			'Вы уверены? Вернуться можно будет только по новому приглашению.',
		),
		confirm: t('app.messenger.settings.leave', 'Покинуть'),
		danger: true,
	})
	if (ok) await leaveServer(conv.id)
}

function readQuery(): void {
	const id = route.query.user
	if (typeof id !== 'string' || !id) return
	const name = route.query.username
	pendingDm.value = { id, username: typeof name === 'string' ? name : '' }
	void router.replace({ path: '/messenger' })
}

watch([pendingDm, ready, () => state.loading], async ([target, isReady, loading]) => {
	if (!target || !isReady || loading) return
	pendingDm.value = null
	if (target.id !== myId.value) await writeTo(target)
})

watch(() => route.query.user, readQuery)

function onVisibility(): void {
	pageVisible.value = document.visibilityState === 'visible'
}

onMounted(() => {
	readQuery()
	document.addEventListener('visibilitychange', onVisibility)
	if (!state.session) void connect()
})

onActivated(() => {
	breadcrumb.reset()
	pageVisible.value = document.visibilityState === 'visible'
	readQuery()
	if (!state.session && !state.loading) void connect()
})

onDeactivated(() => {
	pageVisible.value = false
})

onUnmounted(() => {
	pageVisible.value = false
	document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
	<div class="msgr-root msgr-page">
		<div v-if="state.loading && !state.session" class="msgr-page__loading">
			<span class="msgr-spinner" />
			<p>{{ t('app.messenger.loading', 'Подключаемся к мессенджеру…') }}</p>
		</div>
		<AccountGate v-else-if="showGate" />
		<AccountGate v-else-if="showFailed" failed :reason="state.failureReason" />
		<div v-else-if="state.session" class="msgr-page__layout">
			<ServerRail @create="createModal?.show()" @settings="openSettings" @leave="confirmLeave" />
			<aside class="msgr-page__side">
				<ChannelSidebar
					v-if="state.section === 'server'"
					@settings="openSettings"
					@channel="openChannelModal"
					@leave="confirmLeave"
				/>
				<HomeSidebar v-else />
				<CallBar mode="bar" />
				<UserPanel />
			</aside>
			<main class="msgr-page__main">
				<Transition name="msgr-view" mode="out-in">
					<FriendsView v-if="view === 'friends'" key="friends" />
					<WorldsView v-else-if="view === 'worlds'" key="worlds" />
					<ChatView v-else :key="state.section" v-model:side-panel="sidePanel" />
				</Transition>
			</main>
			<Transition name="msgr-members">
				<MemberPanel v-if="showMembers" />
			</Transition>
		</div>

		<MemberPopover />
		<UserProfileModal ref="profileModal" @write="onProfileWrite" />
		<ProfileEditorModal />
		<PromptModal ref="promptModal" />
		<ForwardModal ref="forwardModal" />
		<CreateServerModal ref="createModal" />
		<ChannelModal ref="channelModal" />
		<ServerSettingsModal ref="settingsModal" />
	</div>
</template>

<style scoped>
.msgr-page {
	display: flex;
	height: 100%;
	min-height: 0;
	flex-direction: column;
	overflow: hidden;
	color: var(--color-base);
}

.msgr-page__loading {
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.8rem;
	color: var(--color-secondary);
}

.msgr-page__layout {
	display: flex;
	min-height: 0;
	flex: 1;
	overflow: hidden;
	border-radius: var(--radius-lg, 12px) 0 0 0;
}

.msgr-page__side {
	display: flex;
	width: 15rem;
	flex-shrink: 0;
	flex-direction: column;
	border-right: 1px solid rgba(0, 0, 0, 0.3);
	background: var(--msgr-side-bg);
	backdrop-filter: blur(18px);
}

.msgr-page__main {
	position: relative;
	display: flex;
	min-width: 0;
	flex: 1;
	background: var(--msgr-main-bg);
	backdrop-filter: blur(14px);
}

.msgr-view-enter-active,
.msgr-view-leave-active {
	transition: opacity 0.12s ease;
}

.msgr-view-enter-from,
.msgr-view-leave-to {
	opacity: 0;
}

.msgr-members-enter-active,
.msgr-members-leave-active {
	transition:
		margin-right 0.2s ease,
		opacity 0.2s ease;
}

.msgr-members-enter-from,
.msgr-members-leave-to {
	margin-right: -16.5rem;
	opacity: 0;
}

@media (max-width: 900px) {
	.msgr-page__side {
		width: 13rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-view-enter-active,
	.msgr-view-leave-active,
	.msgr-members-enter-active,
	.msgr-members-leave-active {
		transition: none;
	}
}
</style>
