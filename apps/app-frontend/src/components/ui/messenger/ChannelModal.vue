<script setup lang="ts">
import { HashIcon } from '@modrinth/assets'
import { NewModal } from '@modrinth/ui'
import { computed, ref } from 'vue'

import HeadphonesIcon from './HeadphonesIcon.vue'
import { useMessengerT } from './i18n'
import type { Channel } from './model'
import { CHANNEL_ICON_PRESETS, channelIcon, setChannelIcon } from './channel-icons'
import { deleteChannel, saveChannel, state } from './store'
import { askConfirm } from './ui-bus'

const t = useMessengerT()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const convId = ref('')
const editing = ref<Channel | null>(null)
const name = ref('')
const topic = ref('')
const kind = ref<'text' | 'voice'>('text')
const categoryId = ref('')
const iconEmoji = ref('')
const busy = ref(false)

const categories = computed(() => state.structures[convId.value]?.categories ?? [])

const cleanName = computed(() =>
	kind.value === 'text'
		? name.value
				.trim()
				.toLowerCase()
				.replace(/\s+/g, '-')
				.replace(/[^\p{L}\p{N}_-]/gu, '')
		: name.value.trim(),
)

function show(
	server: string,
	channel: Channel | null,
	nextKind: 'text' | 'voice' = 'text',
	category = '',
): void {
	convId.value = server
	editing.value = channel
	name.value = channel?.name ?? ''
	topic.value = channel?.topic ?? ''
	kind.value = channel?.kind ?? nextKind
	categoryId.value = channel ? (channel.categoryId ?? '') : category
	iconEmoji.value = channel ? channelIcon(channel.id) : ''
	modal.value?.show()
}

async function save(): Promise<void> {
	if (!cleanName.value || busy.value) return
	busy.value = true
	const ok = await saveChannel(convId.value, editing.value?.id ?? null, {
		name: cleanName.value,
		topic: topic.value.trim(),
		kind: kind.value,
		categoryId: categoryId.value || null,
	})
	busy.value = false
	if (ok) {
		// Иконка — локальная: канал только что сохранён, он уже в структуре.
		const created = state.structures[convId.value]?.channels.find(
			(channel) => channel.name === cleanName.value,
		)
		if (created) setChannelIcon(created.id, iconEmoji.value.trim())
		modal.value?.hide()
	}
}

async function remove(): Promise<void> {
	const channel = editing.value
	if (!channel) return
	const ok = await askConfirm({
		title: t('app.messenger.channel.deleteTitle', 'Удалить канал'),
		text: t(
			'app.messenger.channel.deleteText',
			'Канал #{name} и все его сообщения будут удалены.',
			{
				name: channel.name,
			},
		),
		confirm: t('app.messenger.channel.delete', 'Удалить канал'),
		danger: true,
	})
	if (!ok) return
	if (await deleteChannel(convId.value, channel.id)) modal.value?.hide()
}

defineExpose({ show })
</script>

<template>
	<NewModal
		ref="modal"
		:header="
			editing
				? t('app.messenger.channel.editTitle', 'Настройки канала')
				: t('app.messenger.channel.createTitle', 'Создать канал')
		"
		max-width="460px"
		width="460px"
	>
		<div class="msgr-modal">
			<template v-if="!editing">
				<h4 class="msgr-modal__sub">{{ t('app.messenger.channel.type', 'Тип канала') }}</h4>
				<button
					type="button"
					class="msgr-choice is-radio"
					:class="{ 'is-on': kind === 'text' }"
					@click="kind = 'text'"
				>
					<span class="msgr-choice__icon"><HashIcon /></span>
					<span>
						<b>{{ t('app.messenger.channel.text', 'Текстовый') }}</b>
						<small>{{
							t('app.messenger.channel.textHint', 'Сообщения, изображения, GIF, эмодзи и файлы')
						}}</small>
					</span>
				</button>
				<button
					type="button"
					class="msgr-choice is-radio"
					:class="{ 'is-on': kind === 'voice' }"
					@click="kind = 'voice'"
				>
					<span class="msgr-choice__icon"><HeadphonesIcon /></span>
					<span>
						<b>{{ t('app.messenger.channel.voice', 'Голосовой') }}</b>
						<small>{{
							t('app.messenger.channel.voiceHint', 'Общайтесь голосом всей компанией')
						}}</small>
					</span>
				</button>
			</template>
			<label class="msgr-field">
				<span>{{ t('app.messenger.channel.name', 'Название канала') }}</span>
				<input
					v-model="name"
					type="text"
					maxlength="60"
					:placeholder="
						kind === 'text' ? 'новый-канал' : t('app.messenger.channel.voiceName', 'Голосовой')
					"
					@keydown.enter="save"
				/>
			</label>
			<div class="msgr-field">
				<span>{{ t('app.messenger.channel.icon', 'Иконка (эмодзи вместо решётки)') }}</span>
				<div class="msgr-icon-picker">
					<input
						v-model="iconEmoji"
						type="text"
						maxlength="4"
						class="msgr-icon-picker__input"
						placeholder="#"
					/>
					<div class="msgr-icon-picker__presets">
						<button
							v-for="emoji in CHANNEL_ICON_PRESETS"
							:key="emoji"
							type="button"
							class="msgr-icon-picker__preset"
							:class="{ 'is-on': iconEmoji === emoji }"
							@click="iconEmoji = iconEmoji === emoji ? '' : emoji"
						>
							{{ emoji }}
						</button>
					</div>
				</div>
			</div>
			<label v-if="kind === 'text'" class="msgr-field">
				<span>{{ t('app.messenger.channel.topic', 'Тема канала') }}</span>
				<input v-model="topic" type="text" maxlength="200" />
			</label>
			<label v-if="categories.length" class="msgr-field">
				<span>{{ t('app.messenger.channel.category', 'Категория') }}</span>
				<select v-model="categoryId">
					<option value="">{{ t('app.messenger.channel.noCategory', 'Без категории') }}</option>
					<option v-for="category in categories" :key="category.id" :value="category.id">
						{{ category.name }}
					</option>
				</select>
			</label>
			<div class="msgr-modal__foot">
				<button v-if="editing" type="button" class="msgr-btn is-danger-ghost" @click="remove">
					{{ t('app.messenger.channel.delete', 'Удалить канал') }}
				</button>
				<span class="msgr-modal__grow" />
				<button type="button" class="msgr-btn is-ghost" @click="modal?.hide()">
					{{ t('app.messenger.cancel', 'Отмена') }}
				</button>
				<button type="button" class="msgr-btn" :disabled="!cleanName || busy" @click="save">
					{{
						editing
							? t('app.messenger.save', 'Сохранить')
							: t('app.messenger.channel.create', 'Создать канал')
					}}
				</button>
			</div>
		</div>
	</NewModal>
</template>

<style scoped>
.msgr-icon-picker {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.msgr-icon-picker__input {
	width: 4rem;
	padding: 0.35rem 0.5rem;
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.3);
	color: var(--color-base);
	font-size: 1.1rem;
	text-align: center;
}

.msgr-icon-picker__presets {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
}

.msgr-icon-picker__preset {
	padding: 0.15rem 0.3rem;
	border: 0;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.05);
	font-size: 1rem;
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-icon-picker__preset:hover {
	background: rgba(255, 255, 255, 0.12);
}

.msgr-icon-picker__preset.is-on {
	background: color-mix(in srgb, var(--color-brand) 35%, transparent);
}
</style>
