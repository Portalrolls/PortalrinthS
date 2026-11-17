<script setup lang="ts">
import { ImageIcon, LinkIcon, PlusIcon } from '@modrinth/assets'
import { NewModal } from '@modrinth/ui'
import { computed, ref } from 'vue'

import { compressImageFile } from '@/helpers/uprojects-service'

import { useMessengerT } from './i18n'
import { inviteCodeFrom } from './model'
import { createServer, joinInvite, me, openServer, previewInvite, showToast } from './store'

const t = useMessengerT()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const mode = ref<'choose' | 'create' | 'join'>('choose')
const title = ref('')
const description = ref('')
const avatar = ref('')
const invite = ref('')
const preview = ref<{ title: string; members: number } | null>(null)
const busy = ref(false)
const error = ref('')

const header = computed(() =>
	mode.value === 'join'
		? t('app.messenger.server.joinTitle', 'Присоединиться к серверу')
		: mode.value === 'create'
			? t('app.messenger.server.customize', 'Настройте свой сервер')
			: t('app.messenger.server.createTitle', 'Создайте сервер'),
)

function show(start: 'choose' | 'create' | 'join' = 'choose'): void {
	mode.value = start
	title.value = me.value
		? t('app.messenger.server.defaultName', 'Сервер {name}', { name: me.value.username })
		: ''
	description.value = ''
	avatar.value = ''
	invite.value = ''
	preview.value = null
	error.value = ''
	modal.value?.show()
}

async function pickAvatar(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	try {
		avatar.value = await compressImageFile(file, 512, 0.88)
	} catch {
		showToast(t('app.messenger.image.bad', 'Не удалось прочитать изображение'))
	}
}

async function create(): Promise<void> {
	if (!title.value.trim() || busy.value) return
	busy.value = true
	const server = await createServer(title.value.trim(), description.value.trim(), avatar.value)
	busy.value = false
	if (server) {
		modal.value?.hide()
		await openServer(server.id)
	}
}

async function checkInvite(): Promise<void> {
	error.value = ''
	preview.value = null
	const code = inviteCodeFrom(invite.value)
	if (!code) return
	const data = await previewInvite(code)
	if (!data) {
		error.value = t('app.messenger.server.inviteBad', 'Приглашение недействительно или истекло')
		return
	}
	const conv = data.conversation ?? data
	preview.value = {
		title: String(conv.title || conv.name || t('app.messenger.server.untitled', 'Сервер')),
		members: Number(
			conv.memberCount ??
				data.memberCount ??
				(Array.isArray(conv.members) ? conv.members.length : 0),
		),
	}
}

async function join(): Promise<void> {
	const code = inviteCodeFrom(invite.value)
	if (!code || busy.value) {
		error.value = t('app.messenger.server.inviteEmpty', 'Введите ссылку-приглашение или код')
		return
	}
	busy.value = true
	const server = await joinInvite(code)
	busy.value = false
	if (server) {
		modal.value?.hide()
		await openServer(server.id)
	} else {
		error.value = t('app.messenger.server.inviteBad', 'Приглашение недействительно или истекло')
	}
}

defineExpose({ show })
</script>

<template>
	<NewModal ref="modal" :header="header" max-width="460px" width="460px">
		<div class="msgr-modal">
			<template v-if="mode === 'choose'">
				<p class="msgr-modal__text is-center">
					{{
						t(
							'app.messenger.server.createText',
							'Сервер — место, где вы с друзьями общаетесь в текстовых и голосовых каналах.',
						)
					}}
				</p>
				<button type="button" class="msgr-choice" @click="mode = 'create'">
					<span class="msgr-choice__icon"><PlusIcon /></span>
					<b>{{ t('app.messenger.server.createOwn', 'Создать свой сервер') }}</b>
				</button>
				<h4 class="msgr-modal__sub">
					{{ t('app.messenger.server.haveInvite', 'Уже есть приглашение?') }}
				</h4>
				<button type="button" class="msgr-choice" @click="mode = 'join'">
					<span class="msgr-choice__icon"><LinkIcon /></span>
					<b>{{ t('app.messenger.server.join', 'Присоединиться к серверу') }}</b>
				</button>
			</template>

			<template v-else-if="mode === 'create'">
				<p class="msgr-modal__text is-center">
					{{
						t(
							'app.messenger.server.customizeText',
							'Дайте серверу имя и значок. Всё это можно изменить позже.',
						)
					}}
				</p>
				<button type="button" class="msgr-avatar-pick" @click="fileInput?.click()">
					<img v-if="avatar" :src="avatar" alt="" />
					<template v-else>
						<ImageIcon />
						<span>{{ t('app.messenger.server.upload', 'Загрузить') }}</span>
					</template>
				</button>
				<input ref="fileInput" type="file" accept="image/*" hidden @change="pickAvatar" />
				<label class="msgr-field">
					<span>{{ t('app.messenger.server.name', 'Название сервера') }}</span>
					<input v-model="title" type="text" maxlength="80" @keydown.enter="create" />
				</label>
				<label class="msgr-field">
					<span>{{ t('app.messenger.server.description', 'Описание') }}</span>
					<textarea v-model="description" rows="2" maxlength="500" />
				</label>
				<div class="msgr-modal__foot">
					<button type="button" class="msgr-btn is-ghost" @click="mode = 'choose'">
						{{ t('app.messenger.back', 'Назад') }}
					</button>
					<button type="button" class="msgr-btn" :disabled="!title.trim() || busy" @click="create">
						{{ t('app.messenger.server.create', 'Создать') }}
					</button>
				</div>
			</template>

			<template v-else>
				<p class="msgr-modal__text is-center">
					{{
						t(
							'app.messenger.server.joinText',
							'Введите приглашение, чтобы присоединиться к существующему серверу.',
						)
					}}
				</p>
				<label class="msgr-field">
					<span>{{ t('app.messenger.server.inviteLink', 'Ссылка-приглашение') }}</span>
					<input
						v-model="invite"
						type="text"
						placeholder="undefined://invite/a1b2c3"
						@change="checkInvite"
						@keydown.enter="join"
					/>
				</label>
				<p v-if="error" class="msgr-modal__error">{{ error }}</p>
				<div v-else-if="preview" class="msgr-modal__preview">
					<b>{{ preview.title }}</b>
					<small v-if="preview.members">
						{{
							t('app.messenger.server.membersCount', 'Участников: {count}', {
								count: preview.members,
							})
						}}
					</small>
				</div>
				<div class="msgr-modal__foot">
					<button type="button" class="msgr-btn is-ghost" @click="mode = 'choose'">
						{{ t('app.messenger.back', 'Назад') }}
					</button>
					<button type="button" class="msgr-btn" :disabled="!invite.trim() || busy" @click="join">
						{{ t('app.messenger.server.join', 'Присоединиться к серверу') }}
					</button>
				</div>
			</template>
		</div>
	</NewModal>
</template>
