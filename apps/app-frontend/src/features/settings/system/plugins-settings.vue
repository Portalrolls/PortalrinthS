<script setup lang="ts">
import { PlugIcon, PlusIcon, ShieldIcon, TrashIcon } from '@modrinth/assets'
import { Button, defineMessages, Toggle, useVIntl } from '@modrinth/ui'
import { ref } from 'vue'

import {
	type InstalledPlugin,
	installPluginFiles,
	plugins,
	pluginSafeMode,
	quickCss,
	removePlugin,
	setPluginSafeMode,
	setQuickCss,
	togglePlugin,
} from '@/helpers/portalrinth-plugins'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	title: {
		id: 'app.settings.plugins.title',
		defaultMessage: 'Плагины',
	},
	description: {
		id: 'app.settings.plugins.description',
		defaultMessage:
			'Темы и стили поверх интерфейса: плагин — это CSS, который лаунчер применяет поверх текущей темы. Код не исполняется, поэтому сломанная тема может разве что выглядеть странно, но не сломать лаунчер.',
	},
	install: {
		id: 'app.settings.plugins.install',
		defaultMessage: 'Установить',
	},
	installHint: {
		id: 'app.settings.plugins.install-hint',
		defaultMessage:
			'Поддерживается .zip с manifest.json и CSS-файлами, отдельный .css файл или папка с манифестом. Повторная установка плагина с тем же id обновляет его.',
	},
	empty: {
		id: 'app.settings.plugins.empty',
		defaultMessage: 'Пока не установлено ни одного плагина.',
	},
	enabled: {
		id: 'app.settings.plugins.enabled',
		defaultMessage: 'Включён',
	},
	delete: {
		id: 'app.settings.plugins.delete',
		defaultMessage: 'Удалить',
	},
	quickCssTitle: {
		id: 'app.settings.plugins.quick-css.title',
		defaultMessage: 'Быстрый CSS',
	},
	quickCssDescription: {
		id: 'app.settings.plugins.quick-css.description',
		defaultMessage:
			'Свой стиль без упаковки: пишите CSS прямо здесь — он применяется на лету и лежит поверх всех плагинов.',
	},
	quickCssPlaceholder: {
		id: 'app.settings.plugins.quick-css.placeholder',
		defaultMessage: 'Например:\nbody {\n\tfilter: hue-rotate(30deg);\n}',
	},
	safeModeTitle: {
		id: 'app.settings.plugins.safe-mode.title',
		defaultMessage: 'Безопасный режим',
	},
	safeModeDescription: {
		id: 'app.settings.plugins.safe-mode.description',
		defaultMessage:
			'Полностью отключает все плагины и быстрый CSS до перезапуска лаунчера. Тот же переключатель — по Ctrl+Shift+Alt+P в любой момент.',
	},
	errorPrefix: {
		id: 'app.settings.plugins.error-prefix',
		defaultMessage: 'Не получилось установить:',
	},
	versionLabel: {
		id: 'app.settings.plugins.version-label',
		defaultMessage: 'версия',
	},
	byLabel: {
		id: 'app.settings.plugins.by-label',
		defaultMessage: 'автор',
	},
	sizes: {
		id: 'app.settings.plugins.sizes',
		defaultMessage: '{size} CSS',
	},
})

const installing = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function openPicker() {
	fileInput.value?.click()
}

function sizeOf(plugin: InstalledPlugin): string {
	const bytes = new TextEncoder().encode(plugin.css).length
	return bytes > 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
		: `${Math.max(1, Math.round(bytes / 1024))} КБ`
}

async function pickAndInstall(event: Event) {
	const input = event.target as HTMLInputElement
	const files = Array.from(input.files ?? [])
	input.value = ''
	if (files.length === 0) return
	installing.value = true
	error.value = ''
	try {
		await installPluginFiles(files)
	} catch (caught) {
		error.value = caught instanceof Error ? caught.message : String(caught)
	} finally {
		installing.value = false
	}
}

function toggleSafeMode(on: boolean) {
	setPluginSafeMode(on)
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<section class="flex flex-col gap-2">
			<h2 class="m-0 flex items-center gap-2 text-lg font-bold text-primary">
				<PlugIcon class="text-brand" />
				{{ formatMessage(messages.title) }}
			</h2>
			<p class="m-0 max-w-3xl text-sm text-secondary">
				{{ formatMessage(messages.description) }}
			</p>
			<div class="flex items-center gap-2">
				<Button size="sm" :disabled="installing" @click="openPicker">
					<PlusIcon class="size-4" />
					{{ installing ? '…' : formatMessage(messages.install) }}
				</Button>
				<input
					ref="fileInput"
					class="hidden"
					type="file"
					accept=".zip,.css,application/zip,text/css"
					multiple
					@change="pickAndInstall"
				/>
				<p class="m-0 text-xs text-secondary">
					{{ formatMessage(messages.installHint) }}
				</p>
			</div>
			<p v-if="error" class="m-0 text-sm font-semibold text-red-500" role="alert">
				{{ formatMessage(messages.errorPrefix) }} {{ error }}
			</p>
		</section>

		<p v-if="plugins.length === 0" class="m-0 text-sm text-secondary">
			{{ formatMessage(messages.empty) }}
		</p>
		<div v-else class="flex flex-col gap-2 rounded-xl border border-solid border-surface-5 p-3">
			<div v-for="plugin in plugins" :key="plugin.manifest.id" class="flex items-center gap-3">
				<div class="min-w-0 flex-1">
					<p class="m-0 truncate text-sm font-semibold text-primary">
						{{ plugin.manifest.name }}
						<span v-if="plugin.manifest.version" class="ml-1 font-normal text-secondary">
							{{ formatMessage(messages.versionLabel) }}
							{{ plugin.manifest.version }}
						</span>
					</p>
					<p class="m-0 truncate text-xs text-secondary">
						{{ formatMessage(messages.sizes, { size: sizeOf(plugin) }) }}
						<template v-if="plugin.manifest.author">
							· {{ formatMessage(messages.byLabel) }} {{ plugin.manifest.author }}
						</template>
						<template v-if="plugin.manifest.description">
							· {{ plugin.manifest.description }}
						</template>
					</p>
				</div>
				<Toggle
					:model-value="plugin.enabled"
					:aria-label="plugin.manifest.name"
					@update:model-value="(value: boolean) => togglePlugin(plugin.manifest.id, value)"
				/>
				<Button
					size="sm"
					:aria-label="formatMessage(messages.delete)"
					@click="removePlugin(plugin.manifest.id)"
				>
					<TrashIcon class="size-4" />
				</Button>
			</div>
		</div>

		<section class="flex flex-col gap-2">
			<div class="flex items-center justify-between gap-3">
				<div>
					<h3 class="m-0 text-base font-bold text-primary">
						{{ formatMessage(messages.quickCssTitle) }}
					</h3>
					<p class="m-0 max-w-3xl text-sm text-secondary">
						{{ formatMessage(messages.quickCssDescription) }}
					</p>
				</div>
				<Toggle
					:model-value="quickCss.enabled"
					:aria-label="formatMessage(messages.quickCssTitle)"
					@update:model-value="(value: boolean) => (quickCss.enabled = value)"
				/>
			</div>
			<textarea
				class="rounded-xl border border-solid border-surface-5 bg-surface-2 p-3 font-mono text-xs text-primary"
				rows="8"
				spellcheck="false"
				:placeholder="formatMessage(messages.quickCssPlaceholder)"
				:value="quickCss.css"
				@input="setQuickCss(($event.target as HTMLTextAreaElement).value)"
			/>
		</section>

		<section
			class="flex items-center justify-between gap-3 rounded-xl border border-solid border-surface-5 p-3"
		>
			<div>
				<h3 class="m-0 flex items-center gap-2 text-base font-bold text-primary">
					<ShieldIcon class="size-4 text-brand" />
					{{ formatMessage(messages.safeModeTitle) }}
				</h3>
				<p class="m-0 max-w-3xl text-sm text-secondary">
					{{ formatMessage(messages.safeModeDescription) }}
				</p>
			</div>
			<Toggle
				:model-value="pluginSafeMode"
				:aria-label="formatMessage(messages.safeModeTitle)"
				@update:model-value="toggleSafeMode"
			/>
		</section>
	</div>
</template>
