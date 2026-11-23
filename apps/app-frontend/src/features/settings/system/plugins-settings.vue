<script setup lang="ts">
import { PlugIcon, PlusIcon, ShieldIcon, TrashIcon } from '@modrinth/assets'
import { Button, defineMessages, Toggle, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import {
	type CatalogEntry,
	catalogLoadingState,
	installCatalogPlugin,
	type InstalledPlugin,
	installPluginFiles,
	loadPluginCatalog,
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
		defaultMessage: 'CSS-темы поверх интерфейса. Код не исполняется — сломать лаунчер ими нельзя.',
	},
	install: {
		id: 'app.settings.plugins.install',
		defaultMessage: 'Установить',
	},
	installHint: {
		id: 'app.settings.plugins.install-hint',
		defaultMessage: '.zip с manifest.json или отдельный .css файл.',
	},
	catalogTitle: {
		id: 'app.settings.plugins.catalog.title',
		defaultMessage: 'Каталог',
	},
	catalogDescription: {
		id: 'app.settings.plugins.catalog.description',
		defaultMessage: 'Готовые темы — установите одним нажатием.',
	},
	catalogEmpty: {
		id: 'app.settings.plugins.catalog.empty',
		defaultMessage: 'Каталог пока пуст.',
	},
	catalogInstall: {
		id: 'app.settings.plugins.catalog.install',
		defaultMessage: 'Установить',
	},
	catalogInstalled: {
		id: 'app.settings.plugins.catalog.installed',
		defaultMessage: 'Установлено',
	},
	catalogUpdate: {
		id: 'app.settings.plugins.catalog.update',
		defaultMessage: 'Обновить',
	},
	catalogFailed: {
		id: 'app.settings.plugins.catalog.failed',
		defaultMessage: 'Не получилось установить тему из каталога',
	},
	empty: {
		id: 'app.settings.plugins.empty',
		defaultMessage: 'Пока не установлено ни одного плагина.',
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
		defaultMessage: 'Свой CSS прямо здесь — применяется на лету.',
	},
	quickCssPlaceholder: {
		id: 'app.settings.plugins.quick-css.placeholder',
		// Фигурные скобки экранированы по правилам ICU ('{' и '}'), иначе
		// парсер сообщений считает их аргументами и падает с MALFORMED_ARGUMENT.
		defaultMessage: "Например:\nbody '{'\n\tfilter: hue-rotate(30deg);\n'}'",
	},
	safeModeTitle: {
		id: 'app.settings.plugins.safe-mode.title',
		defaultMessage: 'Безопасный режим',
	},
	safeModeDescription: {
		id: 'app.settings.plugins.safe-mode.description',
		defaultMessage: 'Отключает плагины и Быстрый CSS до перезапуска. Ctrl+Shift+Alt+P.',
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

const catalogEntries = ref<CatalogEntry[]>([])
const catalogLoading = catalogLoadingState()
const catalogBusy = ref('')
const catalogError = ref('')

const installedVersions = computed(() => {
	const map = new Map<string, string>()
	for (const plugin of plugins) map.set(plugin.manifest.id, plugin.manifest.version ?? '')
	return map
})

onMounted(async () => {
	catalogEntries.value = await loadPluginCatalog()
})

function catalogStateOf(entry: CatalogEntry): 'none' | 'update' | 'installed' {
	const version = installedVersions.value.get(entry.id)
	if (version === undefined) return 'none'
	return version && entry.version && version !== entry.version ? 'update' : 'installed'
}

async function installFromCatalog(entry: CatalogEntry) {
	if (catalogBusy.value) return
	catalogBusy.value = entry.id
	catalogError.value = ''
	try {
		await installCatalogPlugin(entry)
	} catch {
		catalogError.value = formatMessage(messages.catalogFailed)
	}
	catalogBusy.value = ''
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

		<section class="flex flex-col gap-2">
			<div class="flex items-baseline gap-2">
				<h3 class="m-0 text-base font-bold text-primary">
					{{ formatMessage(messages.catalogTitle) }}
				</h3>
				<p class="m-0 text-xs text-secondary">
					{{ formatMessage(messages.catalogDescription) }}
				</p>
			</div>
			<p v-if="catalogError" class="m-0 text-sm font-semibold text-red-500" role="alert">
				{{ catalogError }}
			</p>
			<div v-if="catalogLoading" class="text-sm text-secondary">…</div>
			<p v-else-if="catalogEntries.length === 0" class="m-0 text-sm text-secondary">
				{{ formatMessage(messages.catalogEmpty) }}
			</p>
			<div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<div
					v-for="entry in catalogEntries"
					:key="entry.id"
					class="flex items-center gap-3 rounded-xl border border-solid border-surface-5 bg-surface-2 p-3"
				>
					<div class="min-w-0 flex-1">
						<p class="m-0 truncate text-sm font-semibold text-primary">
							{{ entry.name }}
							<span v-if="entry.version" class="ml-1 font-normal text-secondary">
								{{ formatMessage(messages.versionLabel) }}
								{{ entry.version }}
							</span>
						</p>
						<p v-if="entry.description" class="m-0 truncate text-xs text-secondary">
							{{ entry.description }}
						</p>
					</div>
					<Button
						size="sm"
						type="outlined"
						:disabled="catalogBusy === entry.id"
						@click="installFromCatalog(entry)"
					>
						{{
							catalogStateOf(entry) === 'installed'
								? formatMessage(messages.catalogInstalled)
								: catalogStateOf(entry) === 'update'
									? formatMessage(messages.catalogUpdate)
									: formatMessage(messages.catalogInstall)
						}}
					</Button>
				</div>
			</div>
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
				<h3 class="m-0 text-base font-bold text-primary">
					{{ formatMessage(messages.quickCssTitle) }}
				</h3>
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
