<script setup lang="ts">
import { CheckIcon, SearchIcon } from '@modrinth/assets'
import { NewModal } from '@modrinth/ui'
import { computed, ref } from 'vue'

import { useMessengerT } from './i18n'
import type { Msg } from './model'
import { previewOf } from './model'
import { displayName, forwardMessage, showToast, state } from './store'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const msg = ref<Msg | null>(null)
const query = ref('')
const picked = ref<string[]>([])
const busy = ref(false)

const targets = computed(() => {
	const lower = query.value.trim().toLowerCase()
	return state.conversations
		.map((conv) => ({
			conv,
			name: conv.dm && conv.peer ? displayName(conv.peer.id, conv.peer.username) : conv.title,
		}))
		.filter((row) => !lower || row.name.toLowerCase().includes(lower))
		.sort((a, b) => b.conv.updatedAt - a.conv.updatedAt)
})

function show(next: Msg): void {
	msg.value = next
	query.value = ''
	picked.value = []
	modal.value?.show()
}

function toggle(id: string): void {
	picked.value = picked.value.includes(id)
		? picked.value.filter((x) => x !== id)
		: [...picked.value, id]
}

async function send(): Promise<void> {
	if (!msg.value || !picked.value.length) return
	busy.value = true
	const sent = await forwardMessage(msg.value, picked.value)
	busy.value = false
	if (sent) {
		showToast(t('app.messenger.forward.done', 'Переслано в чатов: {count}', { count: sent }))
		modal.value?.hide()
	}
}

defineExpose({ show })
</script>

<template>
	<NewModal
		ref="modal"
		:header="t('app.messenger.forward.title', 'Переслать сообщение')"
		max-width="460px"
		width="460px"
	>
		<div class="msgr-modal">
			<blockquote v-if="msg" class="msgr-modal__quote">
				<b>{{ displayName(msg.senderId, msg.senderName) }}</b>
				{{ previewOf(msg) }}
			</blockquote>
			<label class="msgr-field is-search">
				<input
					v-model="query"
					type="search"
					:placeholder="t('app.messenger.forward.search', 'Найти чат или сервер')"
				/>
				<SearchIcon />
			</label>
			<div class="msgr-pick-list">
				<button
					v-for="row in targets"
					:key="row.conv.id"
					type="button"
					class="msgr-pick"
					:class="{ 'is-on': picked.includes(row.conv.id) }"
					@click="toggle(row.conv.id)"
				>
					<UserAvatar
						v-if="row.conv.dm && row.conv.peer"
						:user-id="row.conv.peer.id"
						:name="row.name"
						:size="32"
					/>
					<span v-else class="msgr-pick__server">
						<img v-if="row.conv.avatarUrl" :src="row.conv.avatarUrl" alt="" />
						<template v-else>{{ row.name.slice(0, 2).toUpperCase() }}</template>
					</span>
					<span class="msgr-pick__name">
						{{ row.name }}
						<small>{{
							row.conv.dm
								? t('app.messenger.forward.dm', 'Личные сообщения')
								: t('app.messenger.forward.server', 'Сервер')
						}}</small>
					</span>
					<span class="msgr-pick__check"><CheckIcon /></span>
				</button>
				<p v-if="!targets.length" class="msgr-modal__text">
					{{ t('app.messenger.forward.empty', 'Ничего не нашлось') }}
				</p>
			</div>
			<div class="msgr-modal__foot">
				<button type="button" class="msgr-btn is-ghost" @click="modal?.hide()">
					{{ t('app.messenger.cancel', 'Отмена') }}
				</button>
				<button type="button" class="msgr-btn" :disabled="!picked.length || busy" @click="send">
					{{ t('app.messenger.forward.send', 'Отправить') }}
					<template v-if="picked.length">({{ picked.length }})</template>
				</button>
			</div>
		</div>
	</NewModal>
</template>
