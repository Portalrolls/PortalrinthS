<script setup lang="ts">
import { NewModal } from '@modrinth/ui'
import { nextTick, ref } from 'vue'

import { useMessengerT } from './i18n'
import type { PromptOptions } from './ui-bus'

const t = useMessengerT()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const field = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const opts = ref<PromptOptions>({ title: '' })
const value = ref('')
let resolver: ((result: string | null) => void) | null = null

function finish(result: string | null): void {
	const done = resolver
	resolver = null
	done?.(result)
}

function ask(next: PromptOptions): Promise<string | null> {
	finish(null)
	opts.value = next
	value.value = next.value ?? ''
	modal.value?.show()
	void nextTick(() => setTimeout(() => field.value?.focus(), 60))
	return new Promise((resolve) => {
		resolver = resolve
	})
}

function submit(): void {
	if (opts.value.input && !value.value.trim()) return
	finish(opts.value.input ? value.value.trim() : '')
	modal.value?.hide()
}

function cancel(): void {
	finish(null)
	modal.value?.hide()
}

function onKey(event: KeyboardEvent): void {
	if (event.key === 'Enter' && (!opts.value.multiline || event.ctrlKey)) {
		event.preventDefault()
		submit()
	}
}

defineExpose({ ask })
</script>

<template>
	<NewModal
		ref="modal"
		:header="opts.title"
		max-width="440px"
		width="440px"
		:on-hide="() => finish(null)"
	>
		<div class="msgr-modal">
			<p v-if="opts.text" class="msgr-modal__text">{{ opts.text }}</p>
			<label v-if="opts.input" class="msgr-field">
				<span v-if="opts.label">{{ opts.label }}</span>
				<textarea
					v-if="opts.multiline"
					ref="field"
					v-model="value"
					rows="4"
					:placeholder="opts.placeholder"
					@keydown="onKey"
				/>
				<input
					v-else
					ref="field"
					v-model="value"
					type="text"
					:placeholder="opts.placeholder"
					@keydown="onKey"
				/>
			</label>
			<div class="msgr-modal__foot">
				<button type="button" class="msgr-btn is-ghost" @click="cancel">
					{{ t('app.messenger.cancel', 'Отмена') }}
				</button>
				<button
					type="button"
					class="msgr-btn"
					:class="{ 'is-danger': opts.danger }"
					:disabled="opts.input && !value.trim()"
					@click="submit"
				>
					{{ opts.confirm || t('app.messenger.ok', 'Готово') }}
				</button>
			</div>
		</div>
	</NewModal>
</template>
