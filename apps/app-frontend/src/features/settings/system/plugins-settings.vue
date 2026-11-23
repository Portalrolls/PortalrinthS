<script setup lang="ts">
import {
	DownloadIcon,
	PlugIcon,
	PlusIcon,
	RefreshCwIcon,
	ShieldIcon,
	TrashIcon,
} from '@modrinth/assets'
import { Button, commonMessages, defineMessages, Toggle, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'

import {
	catalogFailed,
	catalogLoading,
	type CatalogPlugin,
	catalogPlugins,
	catalogStateOf,
	type InstalledPlugin,
	installFromCatalog,
	installPluginFiles,
	invokePluginAction,
	loadCatalog,
	pluginActions,
	pluginContentSources,
	plugins,
	pluginSafeMode,
	quickCss,
	removePlugin,
	setPluginSafeMode,
	setPluginSetting,
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
			'Темы, расширения и вкладки по формату Noctrinth. Сломалось — Безопасный режим всё снимет.',
	},
	install: {
		id: 'app.settings.plugins.install',
		defaultMessage: 'Установить из файла',
	},
	installHint: {
		id: 'app.settings.plugins.install-hint',
		defaultMessage: '.zip с plugin.json (или manifest.json) или отдельный .css файл.',
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
		defaultMessage: 'Отключает плагины, вкладки и Быстрый CSS до перезапуска. Ctrl+Shift+Alt+P.',
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
	catalogTitle: {
		id: 'app.settings.plugins.catalog.title',
		defaultMessage: 'Каталог Noctrinth',
	},
	catalogDescription: {
		id: 'app.settings.plugins.catalog.description',
		defaultMessage: 'Плагины сообщества: темы, расширения и источники контента.',
	},
	catalogRefresh: {
		id: 'app.settings.plugins.catalog.refresh',
		defaultMessage: 'Обновить',
	},
	catalogEmpty: {
		id: 'app.settings.plugins.catalog.empty',
		defaultMessage: 'Каталог пуст.',
	},
	catalogLoadFailed: {
		id: 'app.settings.plugins.catalog.load-failed',
		defaultMessage: 'Каталог не загрузился — проверьте соединение.',
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
	catalogDownloading: {
		id: 'app.settings.plugins.catalog.downloading',
		defaultMessage: 'Скачиваю…',
	},
	catalogFailed: {
		id: 'app.settings.plugins.catalog.failed',
		defaultMessage: 'Не получилось установить плагин из каталога',
	},
	catalogConfirmTitle: {
		id: 'app.settings.plugins.catalog.confirm-title',
		defaultMessage: 'Разрешения плагина',
	},
	catalogConfirmText: {
		id: 'app.settings.plugins.catalog.confirm-text',
		defaultMessage: 'Перед установкой посмотрите, что плагин просит:',
	},
	catalogConfirmAccept: {
		id: 'app.settings.plugins.catalog.confirm-accept',
		defaultMessage: 'Всё равно установить',
	},
	typeTheme: {
		id: 'app.settings.plugins.type.theme',
		defaultMessage: 'Тема',
	},
	typeExtension: {
		id: 'app.settings.plugins.type.extension',
		defaultMessage: 'Расширение',
	},
	typeContentSource: {
		id: 'app.settings.plugins.type.content-source',
		defaultMessage: 'Источник контента',
	},
	permissionDomains: {
		id: 'app.settings.plugins.permissions.domains',
		defaultMessage: 'Сеть: {domains}',
	},
	permissionEvents: {
		id: 'app.settings.plugins.permissions.events',
		defaultMessage: 'События: {events}',
	},
	permissionInstances: {
		id: 'app.settings.plugins.permissions.instances',
		defaultMessage: 'Инстансы: {levels}',
	},
	permissionUi: {
		id: 'app.settings.plugins.permissions.ui',
		defaultMessage: 'Интерфейс: {features}',
	},
	settingsTitle: {
		id: 'app.settings.plugins.settings.title',
		defaultMessage: 'Настройки плагина',
	},
	settingsEmpty: {
		id: 'app.settings.plugins.settings.empty',
		defaultMessage: 'Своих настроек у плагина нет.',
	},
	pagesTitle: {
		id: 'app.settings.plugins.pages.title',
		defaultMessage: 'Вкладки',
	},
	pagesHint: {
		id: 'app.settings.plugins.pages.hint',
		defaultMessage: 'Вкладки этого плагина — в боковой панели слева.',
	},
	actionsTitle: {
		id: 'app.settings.plugins.actions.title',
		defaultMessage: 'Действия',
	},
})

type PluginTypeBadge = 'theme' | 'extension' | 'content-source'

const installing = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function openPicker() {
	fileInput.value?.click()
}

const catalogBusy = ref('')
const catalogError = ref('')
const confirmEntry = ref<CatalogPlugin | null>(null)
const expandedId = ref<string | null>(null)

onMounted(() => {
	void loadCatalog()
})

async function refreshCatalog() {
	catalogError.value = ''
	await loadCatalog(true)
}

function typeLabel(type: PluginTypeBadge | undefined): string {
	if (type === 'extension') return formatMessage(messages.typeExtension)
	if (type === 'content-source') return formatMessage(messages.typeContentSource)
	return formatMessage(messages.typeTheme)
}

function permissionLines(entry: CatalogPlugin): string[] {
	const lines: string[] = []
	const perms = entry.permissions ?? {}
	if (perms.domains?.length) {
		lines.push(formatMessage(messages.permissionDomains, { domains: perms.domains.join(', ') }))
	}
	if (perms.events?.length) {
		lines.push(formatMessage(messages.permissionEvents, { events: perms.events.join(', ') }))
	}
	if (perms.instances?.length) {
		lines.push(formatMessage(messages.permissionInstances, { levels: perms.instances.join(', ') }))
	}
	if (perms.ui?.length) {
		lines.push(formatMessage(messages.permissionUi, { features: perms.ui.join(', ') }))
	}
	return lines
}

function hasPermissions(entry: CatalogPlugin): boolean {
	const perms = entry.permissions ?? {}
	return Boolean(
		perms.domains?.length || perms.events?.length || perms.instances?.length || perms.ui?.length,
	)
}

function beginCatalogInstall(entry: CatalogPlugin) {
	catalogError.value = ''
	if (hasPermissions(entry)) {
		confirmEntry.value = entry
	} else {
		void installCatalog(entry)
	}
}

async function installCatalog(entry: CatalogPlugin) {
	if (catalogBusy.value) return
	confirmEntry.value = null
	catalogBusy.value = entry.id
	catalogError.value = ''
	try {
		await installFromCatalog(entry)
	} catch (caught) {
		catalogError.value = caught instanceof Error ? caught.message : String(caught)
	}
	catalogBusy.value = ''
}

function actionsOf(plugin: InstalledPlugin) {
	return pluginActions.filter((action) => action.pluginId === plugin.manifest.id)
}

function contentSourcesOf(plugin: InstalledPlugin) {
	return pluginContentSources.filter((source) => source.pluginId === plugin.manifest.id)
}

function visibleFields(plugin: InstalledPlugin) {
	return (plugin.manifest.settings ?? []).filter(
		(field) => !field.when || plugin.values[field.when.key] === field.when.equals,
	)
}

function setField(plugin: InstalledPlugin, key: string, type: string, event: Event) {
	const target = event.target as HTMLInputElement | HTMLSelectElement
	let value: string | boolean | number = target.value
	if (type === 'number') value = target.value === '' ? '' : Number(target.value)
	if (type === 'boolean') value = (target as unknown as { checked: boolean }).checked
	setPluginSetting(plugin.manifest.id, key, value)
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

const catalogCount = computed(() => catalogPlugins.value.length)
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
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-baseline gap-2">
					<h3 class="m-0 text-base font-bold text-primary">
						{{ formatMessage(messages.catalogTitle) }}
					</h3>
					<p class="m-0 text-xs text-secondary">
						{{ formatMessage(messages.catalogDescription) }}
					</p>
				</div>
				<Button size="sm" type="outlined" :disabled="catalogLoading" @click="refreshCatalog">
					<RefreshCwIcon class="size-4" :class="{ 'animate-spin': catalogLoading }" />
					{{ formatMessage(messages.catalogRefresh) }}
				</Button>
			</div>
			<p v-if="catalogError" class="m-0 text-sm font-semibold text-red-500" role="alert">
				{{ formatMessage(messages.catalogFailed) }}: {{ catalogError }}
			</p>
			<div v-if="catalogLoading && catalogCount === 0" class="text-sm text-secondary">…</div>
			<p v-else-if="catalogFailed && catalogCount === 0" class="m-0 text-sm text-secondary">
				{{ formatMessage(messages.catalogLoadFailed) }}
			</p>
			<p v-else-if="catalogCount === 0" class="m-0 text-sm text-secondary">
				{{ formatMessage(messages.catalogEmpty) }}
			</p>
			<div v-else class="flex flex-col gap-2">
				<div
					v-for="entry in catalogPlugins"
					:key="entry.id"
					class="flex flex-col gap-2 rounded-xl border border-solid border-surface-5 bg-surface-2 p-3"
				>
					<div class="flex items-center gap-3">
						<img
							v-if="entry.icon_url"
							:src="entry.icon_url"
							alt=""
							class="size-10 shrink-0 rounded-lg object-cover"
						/>
						<div
							v-else
							class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-4"
						>
							<PlugIcon class="size-5 text-secondary" />
						</div>
						<div class="min-w-0 flex-1">
							<p
								class="m-0 flex flex-wrap items-center gap-x-2 truncate text-sm font-semibold text-primary"
							>
								{{ entry.name }}
								<span
									class="rounded-md bg-surface-4 px-1.5 py-0.5 text-[10px] font-semibold text-secondary"
								>
									{{ typeLabel(entry.type) }}
								</span>
								<span v-if="entry.version" class="font-normal text-secondary">
									{{ formatMessage(messages.versionLabel) }} {{ entry.version }}
								</span>
								<span v-if="entry.author" class="font-normal text-secondary">
									{{ formatMessage(messages.byLabel) }} {{ entry.author }}
								</span>
							</p>
							<p v-if="entry.description" class="m-0 truncate text-xs text-secondary">
								{{ entry.description }}
							</p>
							<div v-if="entry.tags?.length" class="mt-1 flex flex-wrap gap-1">
								<span
									v-for="tag in entry.tags.slice(0, 6)"
									:key="tag"
									class="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] text-secondary"
								>
									{{ tag }}
								</span>
							</div>
						</div>
						<Button
							size="sm"
							type="outlined"
							:disabled="catalogBusy === entry.id"
							@click="beginCatalogInstall(entry)"
						>
							<DownloadIcon v-if="catalogBusy === entry.id" class="size-4 animate-pulse" />
							{{
								catalogBusy === entry.id
									? formatMessage(messages.catalogDownloading)
									: catalogStateOf(entry) === 'installed'
										? formatMessage(messages.catalogInstalled)
										: catalogStateOf(entry) === 'update'
											? formatMessage(messages.catalogUpdate)
											: formatMessage(messages.catalogInstall)
							}}
						</Button>
					</div>
					<div
						v-if="confirmEntry?.id === entry.id"
						class="flex flex-col gap-2 rounded-lg border border-solid border-surface-5 p-2"
					>
						<p class="m-0 flex items-center gap-1 text-xs font-semibold text-primary">
							<ShieldIcon class="size-3.5 text-orange-500" />
							{{ formatMessage(messages.catalogConfirmTitle) }}
						</p>
						<p class="m-0 text-xs text-secondary">
							{{ formatMessage(messages.catalogConfirmText) }}
						</p>
						<ul class="m-0 flex flex-col gap-1 pl-0">
							<li
								v-for="line in permissionLines(entry)"
								:key="line"
								class="list-none rounded-md bg-surface-3 px-2 py-1 font-mono text-[11px] text-primary"
							>
								{{ line }}
							</li>
						</ul>
						<div class="flex justify-end gap-2">
							<Button size="sm" type="outlined" @click="confirmEntry = null">
								{{ formatMessage(commonMessages.cancelButton) }}
							</Button>
							<Button size="sm" type="colored" color="brand" @click="installCatalog(entry)">
								{{ formatMessage(messages.catalogConfirmAccept) }}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</section>

		<p v-if="plugins.length === 0" class="m-0 text-sm text-secondary">
			{{ formatMessage(messages.empty) }}
		</p>
		<div v-else class="flex flex-col gap-2 rounded-xl border border-solid border-surface-5 p-3">
			<div
				v-for="plugin in plugins"
				:key="plugin.manifest.id"
				class="flex flex-col gap-2 border-b border-solid border-surface-4 pb-2 last:border-b-0 last:pb-0"
			>
				<div class="flex items-center gap-3">
					<div class="min-w-0 flex-1">
						<p
							class="m-0 flex flex-wrap items-center gap-x-2 truncate text-sm font-semibold text-primary"
						>
							{{ plugin.manifest.name }}
							<span
								class="rounded-md bg-surface-4 px-1.5 py-0.5 text-[10px] font-semibold text-secondary"
							>
								{{ typeLabel(plugin.manifest.type) }}
							</span>
							<span v-if="plugin.manifest.version" class="font-normal text-secondary">
								{{ formatMessage(messages.versionLabel) }} {{ plugin.manifest.version }}
							</span>
						</p>
						<p class="m-0 truncate text-xs text-secondary">
							{{ formatMessage(messages.sizes, { size: sizeOf(plugin) }) }}
							<template v-if="plugin.manifest.author">
								· {{ formatMessage(messages.byLabel) }} {{ plugin.manifest.author }}
							</template>
							<template v-if="contentSourcesOf(plugin).length">
								·
								{{
									contentSourcesOf(plugin)
										.map((source) => source.label)
										.join(', ')
								}}
							</template>
						</p>
					</div>
					<Button
						v-if="plugin.manifest.settings?.length"
						size="sm"
						type="outlined"
						@click="expandedId = expandedId === plugin.manifest.id ? null : plugin.manifest.id"
					>
						{{ formatMessage(messages.settingsTitle) }}
					</Button>
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
				<div
					v-if="expandedId === plugin.manifest.id"
					class="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
				>
					<p v-if="visibleFields(plugin).length === 0" class="m-0 text-xs text-secondary">
						{{ formatMessage(messages.settingsEmpty) }}
					</p>
					<div
						v-for="field in visibleFields(plugin)"
						:key="field.key"
						class="flex items-center justify-between gap-3"
					>
						<div class="min-w-0">
							<p class="m-0 text-sm text-primary">{{ field.label }}</p>
							<p v-if="field.description" class="m-0 text-xs text-secondary">
								{{ field.description }}
							</p>
						</div>
						<Toggle
							v-if="field.type === 'boolean'"
							:model-value="plugin.values[field.key] === true"
							:aria-label="field.label"
							@update:model-value="
								(value: boolean) => setPluginSetting(plugin.manifest.id, field.key, value)
							"
						/>
						<select
							v-else-if="field.type === 'select'"
							class="w-56 rounded-lg border border-solid border-surface-5 bg-surface-3 px-2 py-1 text-sm text-primary"
							:value="String(plugin.values[field.key] ?? field.default ?? '')"
							@change="setField(plugin, field.key, 'select', $event)"
						>
							<option
								v-for="option in field.options ?? []"
								:key="option.value"
								:value="option.value"
							>
								{{ option.label || option.value }}
							</option>
						</select>
						<input
							v-else-if="field.type === 'color'"
							type="color"
							class="h-8 w-14 cursor-pointer rounded-lg border border-solid border-surface-5 bg-surface-3"
							:value="String(plugin.values[field.key] ?? field.default ?? '#000000')"
							@change="setField(plugin, field.key, 'color', $event)"
						/>
						<input
							v-else-if="field.type === 'number'"
							type="number"
							class="w-32 rounded-lg border border-solid border-surface-5 bg-surface-3 px-2 py-1 text-sm text-primary"
							:min="field.min"
							:max="field.max"
							:value="String(plugin.values[field.key] ?? field.default ?? '')"
							@change="setField(plugin, field.key, 'number', $event)"
						/>
						<input
							v-else
							type="text"
							class="w-56 rounded-lg border border-solid border-surface-5 bg-surface-3 px-2 py-1 text-sm text-primary"
							:placeholder="field.placeholder"
							:value="String(plugin.values[field.key] ?? field.default ?? '')"
							@change="setField(plugin, field.key, 'string', $event)"
						/>
					</div>
					<div v-if="actionsOf(plugin).length" class="flex flex-col gap-1">
						<p class="m-0 text-xs font-semibold text-secondary">
							{{ formatMessage(messages.actionsTitle) }}
						</p>
						<div class="flex flex-wrap gap-2">
							<Button
								v-for="action in actionsOf(plugin)"
								:key="action.id"
								size="sm"
								type="outlined"
								:disabled="!plugin.enabled"
								@click="invokePluginAction(action.pluginId, action.id)"
							>
								{{ action.label }}
							</Button>
						</div>
					</div>
					<p v-if="plugin.manifest.pages?.length" class="m-0 text-xs text-secondary">
						{{ formatMessage(messages.pagesTitle) }}:
						{{ plugin.manifest.pages.map((page) => page.title).join(', ') }} —
						{{ formatMessage(messages.pagesHint) }}
					</p>
				</div>
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
