<script setup lang="ts">
import {
	DownloadIcon,
	ExternalIcon,
	PaintbrushIcon,
	PlugIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
	SettingsIcon,
	ShieldIcon,
	SpinnerIcon,
	TrashIcon,
} from '@modrinth/assets'
import {
	Button,
	commonMessages,
	defineMessages,
	EmptyState,
	Input,
	NewModal,
	Toggle,
	useVIntl,
} from '@modrinth/ui'
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
	type PluginType,
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
		defaultMessage: "Например:\nbody '{'\n\tfilter: hue-rotate(30deg);\n}'",
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
	authorLabel: {
		id: 'app.settings.plugins.author',
		defaultMessage: 'Автор',
	},
	enabledLabel: {
		id: 'app.settings.plugins.enabled',
		defaultMessage: 'Включён',
	},
	sizes: {
		id: 'app.settings.plugins.sizes',
		defaultMessage: '{size} CSS',
	},
	apply: {
		id: 'app.settings.plugins.apply',
		defaultMessage: 'Применить',
	},
	close: {
		id: 'app.settings.plugins.close',
		defaultMessage: 'Закрыть',
	},
	catalog: {
		id: 'app.settings.plugins.catalog.button',
		defaultMessage: 'Каталог',
	},
	catalogTitle: {
		id: 'app.settings.plugins.catalog.title',
		defaultMessage: 'Каталог Noctrinth',
	},
	catalogSubtitle: {
		id: 'app.settings.plugins.catalog.description',
		defaultMessage: 'Плагины сообщества: темы, расширения и источники контента.',
	},
	catalogRefresh: {
		id: 'app.settings.plugins.catalog.refresh',
		defaultMessage: 'Обновить',
	},
	catalogSearch: {
		id: 'app.settings.plugins.catalog.search',
		defaultMessage: 'Поиск плагинов…',
	},
	catalogFilterAll: {
		id: 'app.settings.plugins.catalog.filter.all',
		defaultMessage: 'Все',
	},
	catalogFilterTheme: {
		id: 'app.settings.plugins.catalog.filter.theme',
		defaultMessage: 'Темы',
	},
	catalogFilterExtension: {
		id: 'app.settings.plugins.catalog.filter.extension',
		defaultMessage: 'Расширения',
	},
	catalogFilterContent: {
		id: 'app.settings.plugins.catalog.filter.content',
		defaultMessage: 'Источники',
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
	catalogNoResults: {
		id: 'app.settings.plugins.catalog.no-results',
		defaultMessage: 'Ничего не найдено',
	},
	catalogNoResultsDescription: {
		id: 'app.settings.plugins.catalog.no-results.description',
		defaultMessage: 'Попробуйте другой запрос — или обновите каталог.',
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

type CatalogFilter = 'all' | PluginType

const installing = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function openPicker() {
	fileInput.value?.click()
}

const catalogModal = ref<InstanceType<typeof NewModal> | null>(null)
const settingsModal = ref<InstanceType<typeof NewModal> | null>(null)

function openCatalog() {
	void loadCatalog()
	catalogModal.value?.show()
}

onMounted(() => {
	void loadCatalog()
})

const catalogSearch = ref('')
const catalogFilter = ref<CatalogFilter>('all')

const filterOptions = computed(() => [
	{ id: 'all' as const, label: formatMessage(messages.catalogFilterAll) },
	{ id: 'theme' as const, label: formatMessage(messages.catalogFilterTheme) },
	{ id: 'extension' as const, label: formatMessage(messages.catalogFilterExtension) },
	{ id: 'content-source' as const, label: formatMessage(messages.catalogFilterContent) },
])

const filteredCatalog = computed(() => {
	const query = catalogSearch.value.trim().toLowerCase()
	return catalogPlugins.value.filter((entry) => {
		if (catalogFilter.value !== 'all' && entry.type !== catalogFilter.value) return false
		if (!query) return true
		const haystack = [entry.name, entry.description, entry.author, ...(entry.tags ?? [])]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()
		return haystack.includes(query)
	})
})

async function refreshCatalog() {
	await loadCatalog(true)
}

const catalogBusy = ref('')
const catalogError = ref('')
const confirmEntry = ref<CatalogPlugin | null>(null)

function typeLabel(type: PluginType | undefined): string {
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

function hostLabel(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

function actionsOf(plugin: InstalledPlugin) {
	return pluginActions.filter((action) => action.pluginId === plugin.manifest.id)
}

function contentSourcesOf(plugin: InstalledPlugin) {
	return pluginContentSources.filter((source) => source.pluginId === plugin.manifest.id)
}

/* ------------------------------ settings modal ----------------------------- */

const settingsTarget = ref<InstalledPlugin | null>(null)
const settingsDraft = ref<Record<string, string | boolean | number>>({})

function visibleFields(plugin: InstalledPlugin) {
	return (plugin.manifest.settings ?? []).filter(
		(field) => !field.when || plugin.values[field.when.key] === field.when.equals,
	)
}

function openSettings(plugin: InstalledPlugin) {
	settingsTarget.value = plugin
	settingsDraft.value = { ...plugin.values }
	settingsModal.value?.show()
}

function setDraft(key: string, type: string, event: Event) {
	const target = event.target as HTMLInputElement | HTMLSelectElement
	let value: string | boolean | number = target.value
	if (type === 'number') value = target.value === '' ? '' : Number(target.value)
	if (type === 'boolean') value = (target as unknown as { checked: boolean }).checked
	settingsDraft.value[key] = value
	// Условные поля («когда включён X — показать Y») пересматриваются сразу.
	settingsTarget.value = settingsTarget.value
		? { ...settingsTarget.value, values: { ...settingsDraft.value } }
		: null
}

async function saveSettings() {
	const plugin = settingsTarget.value
	if (!plugin) return
	for (const [key, value] of Object.entries(settingsDraft.value)) {
		if (plugin.values[key] !== value) setPluginSetting(plugin.manifest.id, key, value)
	}
	settingsModal.value?.hide()
}

function invokeAction(actionId: string) {
	if (!settingsTarget.value) return
	void invokePluginAction(settingsTarget.value.manifest.id, actionId)
}

/* --------------------------------- helpers --------------------------------- */

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
			<div class="flex flex-wrap items-center gap-2">
				<Button size="sm" type="colored" color="brand" @click="openCatalog">
					<DownloadIcon class="size-4" />
					{{ formatMessage(messages.catalog) }}
				</Button>
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

		<EmptyState v-if="plugins.length === 0" type="empty" :heading="formatMessage(messages.empty)">
			<template #actions>
				<Button type="colored" color="brand" size="sm" @click="openCatalog">
					<DownloadIcon class="size-4" />
					{{ formatMessage(messages.catalog) }}
				</Button>
			</template>
		</EmptyState>
		<div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
			<div
				v-for="plugin in plugins"
				:key="plugin.manifest.id"
				class="plugin-card group flex flex-col overflow-hidden rounded-2xl border border-solid border-surface-5 bg-surface-2 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg"
			>
				<div
					class="relative aspect-[2/1] w-full overflow-hidden border-0 border-b border-solid border-surface-5 bg-surface-3"
				>
					<img
						v-if="plugin.manifest.banner"
						:src="plugin.manifest.banner"
						alt=""
						class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
					/>
					<div
						v-else
						class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-4 to-surface-3"
					>
						<PaintbrushIcon class="size-10 text-secondary" aria-hidden="true" />
					</div>
					<span
						class="absolute right-2 top-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-secondary"
					>
						{{ typeLabel(plugin.manifest.type) }}
					</span>
				</div>
				<div class="flex grow flex-col gap-2 p-4">
					<div class="flex gap-3">
						<img
							v-if="plugin.manifest.icon"
							:src="plugin.manifest.icon"
							alt=""
							class="-mt-9 size-14 shrink-0 rounded-xl border-2 border-solid border-surface-2 bg-surface-3 object-cover shadow-md"
						/>
						<span
							v-else
							class="-mt-9 flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-solid border-surface-2 bg-surface-4 shadow-md"
						>
							<PlugIcon class="size-6 text-secondary" aria-hidden="true" />
						</span>
						<div class="flex min-w-0 flex-col gap-0.5 pt-1">
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
								<span class="truncate text-lg font-bold text-primary">
									{{ plugin.manifest.name }}
								</span>
								<span
									v-if="plugin.manifest.version"
									class="rounded-full bg-surface-4 px-2 py-0.5 text-xs font-medium text-secondary"
								>
									v{{ plugin.manifest.version }}
								</span>
							</div>
							<span v-if="plugin.manifest.author" class="truncate text-sm text-secondary">
								{{ formatMessage(messages.authorLabel) }}: {{ plugin.manifest.author }}
							</span>
						</div>
					</div>
					<p v-if="plugin.manifest.description" class="m-0 line-clamp-2 text-sm text-secondary">
						{{ plugin.manifest.description }}
					</p>
					<div v-if="plugin.manifest.tags?.length" class="flex flex-wrap gap-1.5">
						<span
							v-for="tag in plugin.manifest.tags.slice(0, 4)"
							:key="tag"
							class="rounded-full bg-surface-4 px-2.5 py-0.5 text-xs text-secondary"
						>
							{{ tag }}
						</span>
					</div>
					<div class="flex items-center gap-2 text-xs text-secondary">
						{{ formatMessage(messages.sizes, { size: sizeOf(plugin) }) }}
						<template v-if="contentSourcesOf(plugin).length">
							·
							{{
								contentSourcesOf(plugin)
									.map((source) => source.label)
									.join(', ')
							}}
						</template>
					</div>
					<p v-if="plugin.manifest.pages?.length" class="m-0 text-xs text-secondary">
						{{ formatMessage(messages.pagesTitle) }}:
						{{ plugin.manifest.pages.map((page) => page.title).join(', ') }} —
						{{ formatMessage(messages.pagesHint) }}
					</p>
					<div class="mt-auto flex items-center justify-between gap-2 pt-1">
						<div class="flex items-center gap-2">
							<Toggle
								:model-value="plugin.enabled"
								:aria-label="plugin.manifest.name"
								@update:model-value="(value: boolean) => togglePlugin(plugin.manifest.id, value)"
							/>
							<span class="text-sm text-secondary">
								{{ formatMessage(messages.enabledLabel) }}
							</span>
						</div>
						<div class="flex gap-1">
							<button
								v-if="plugin.manifest.settings?.length || actionsOf(plugin).length"
								v-tooltip="formatMessage(messages.settingsTitle)"
								type="button"
								class="plugin-icon-btn"
								:aria-label="formatMessage(messages.settingsTitle)"
								@click="openSettings(plugin)"
							>
								<SettingsIcon class="size-4" aria-hidden="true" />
							</button>
							<button
								v-tooltip="formatMessage(messages.delete)"
								type="button"
								class="plugin-icon-btn plugin-icon-btn-danger"
								:aria-label="formatMessage(messages.delete)"
								@click="removePlugin(plugin.manifest.id)"
							>
								<TrashIcon class="size-4" aria-hidden="true" />
							</button>
						</div>
					</div>
				</div>
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

		<NewModal
			ref="catalogModal"
			:header="formatMessage(messages.catalogTitle)"
			max-width="56rem"
			scrollable
			max-content-height="70vh"
		>
			<div class="flex flex-col gap-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="m-0 text-sm text-secondary">
						{{ formatMessage(messages.catalogSubtitle) }}
					</p>
					<Button type="quiet" size="sm" :disabled="catalogLoading" @click="refreshCatalog">
						<SpinnerIcon v-if="catalogLoading" class="size-4 animate-spin" />
						<RefreshCwIcon v-else class="size-4" aria-hidden="true" />
						{{ formatMessage(messages.catalogRefresh) }}
					</Button>
				</div>
				<Input
					v-model="catalogSearch"
					:icon="SearchIcon"
					:placeholder="formatMessage(messages.catalogSearch)"
					autocomplete="off"
				/>
				<div class="flex flex-wrap gap-2">
					<button
						v-for="option in filterOptions"
						:key="option.id"
						type="button"
						class="catalog-chip"
						:class="{ selected: catalogFilter === option.id }"
						@click="catalogFilter = option.id"
					>
						{{ option.label }}
					</button>
				</div>

				<p v-if="catalogError" class="m-0 rounded-xl bg-surface-4 px-3 py-2 text-sm text-secondary">
					{{ formatMessage(messages.catalogFailed) }}: {{ catalogError }}
				</p>

				<SpinnerIcon
					v-if="catalogLoading && catalogPlugins.length === 0"
					class="mx-auto size-8 animate-spin text-contrast"
				/>

				<p
					v-else-if="catalogFailed && catalogPlugins.length === 0"
					class="m-0 text-sm text-secondary"
				>
					{{ formatMessage(messages.catalogLoadFailed) }}
				</p>
				<p v-else-if="catalogPlugins.length === 0" class="m-0 text-sm text-secondary">
					{{ formatMessage(messages.catalogEmpty) }}
				</p>

				<div v-else-if="filteredCatalog.length" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<div
						v-for="entry in filteredCatalog"
						:key="entry.id"
						class="plugin-card group flex flex-col overflow-hidden rounded-2xl border border-solid border-surface-5 bg-surface-2 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg"
					>
						<div
							class="relative aspect-[2/1] w-full overflow-hidden border-0 border-b border-solid border-surface-5 bg-surface-3"
						>
							<img
								v-if="entry.banner_url"
								:src="entry.banner_url"
								alt=""
								loading="lazy"
								class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
							/>
							<div
								v-else
								class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-4 to-surface-3"
							>
								<PaintbrushIcon class="size-10 text-secondary" aria-hidden="true" />
							</div>
							<span
								class="absolute right-2 top-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-secondary"
							>
								{{ typeLabel(entry.type) }}
							</span>
						</div>
						<div class="flex grow flex-col gap-2 p-4">
							<div class="flex gap-3">
								<img
									v-if="entry.icon_url"
									:src="entry.icon_url"
									alt=""
									loading="lazy"
									class="-mt-9 size-14 shrink-0 rounded-xl border-2 border-solid border-surface-2 bg-surface-3 object-cover shadow-md"
								/>
								<span
									v-else
									class="-mt-9 flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-solid border-surface-2 bg-surface-4 shadow-md"
								>
									<PlugIcon class="size-6 text-secondary" aria-hidden="true" />
								</span>
								<div class="flex min-w-0 flex-col gap-0.5 pt-1">
									<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
										<span class="truncate text-lg font-bold text-primary">{{ entry.name }}</span>
										<span
											v-if="entry.version"
											class="rounded-full bg-surface-4 px-2 py-0.5 text-xs font-medium text-secondary"
										>
											v{{ entry.version }}
										</span>
									</div>
									<span v-if="entry.author" class="truncate text-sm text-secondary">
										{{ formatMessage(messages.authorLabel) }}: {{ entry.author }}
									</span>
								</div>
							</div>
							<p v-if="entry.description" class="m-0 line-clamp-3 text-sm text-secondary">
								{{ entry.description }}
							</p>
							<div v-if="entry.tags?.length" class="flex flex-wrap gap-1.5">
								<span
									v-for="tag in entry.tags.slice(0, 5)"
									:key="tag"
									class="rounded-full bg-surface-4 px-2.5 py-0.5 text-xs text-secondary"
								>
									{{ tag }}
								</span>
							</div>
							<div
								v-if="confirmEntry?.id === entry.id"
								class="flex flex-col gap-2 rounded-xl border border-solid border-surface-5 p-3"
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
							<div class="mt-auto flex items-center justify-between gap-2 pt-1">
								<Button
									size="sm"
									:type="catalogStateOf(entry) === 'installed' ? 'outlined' : 'colored'"
									:color="catalogStateOf(entry) === 'installed' ? undefined : 'brand'"
									:disabled="catalogBusy === entry.id || catalogStateOf(entry) === 'installed'"
									@click="beginCatalogInstall(entry)"
								>
									<SpinnerIcon v-if="catalogBusy === entry.id" class="size-4 animate-spin" />
									<DownloadIcon v-else class="size-4" aria-hidden="true" />
									{{
										formatMessage(
											catalogBusy === entry.id
												? messages.catalogDownloading
												: catalogStateOf(entry) === 'installed'
													? messages.catalogInstalled
													: catalogStateOf(entry) === 'update'
														? messages.catalogUpdate
														: messages.catalogInstall,
										)
									}}
								</Button>
								<a
									v-if="entry.homepage || entry.repository"
									:href="entry.homepage ?? entry.repository"
									target="_blank"
									rel="noopener noreferrer"
									class="flex items-center gap-1 text-sm text-secondary underline hover:text-contrast"
								>
									<ExternalIcon class="size-3.5" aria-hidden="true" />
									{{ hostLabel(entry.homepage ?? entry.repository ?? '') }}
								</a>
							</div>
						</div>
					</div>
				</div>

				<EmptyState
					v-else
					type="no-search-result"
					:heading="formatMessage(messages.catalogNoResults)"
					:description="formatMessage(messages.catalogNoResultsDescription)"
				/>
			</div>
		</NewModal>

		<NewModal
			ref="settingsModal"
			:header="
				settingsTarget
					? formatMessage(messages.settingsTitle) + ' — ' + settingsTarget.manifest.name
					: formatMessage(messages.settingsTitle)
			"
			max-width="32rem"
		>
			<div v-if="settingsTarget" class="flex flex-col gap-4">
				<template v-if="visibleFields(settingsTarget).length">
					<div
						v-for="field in visibleFields(settingsTarget)"
						:key="field.key"
						class="flex flex-col gap-1.5"
					>
						<div v-if="field.type === 'boolean'" class="flex items-center justify-between gap-4">
							<div class="min-w-0">
								<span class="text-base text-primary">{{ field.label }}</span>
								<p v-if="field.description" class="m-0 text-xs text-secondary">
									{{ field.description }}
								</p>
							</div>
							<Toggle
								:model-value="settingsDraft[field.key] === true"
								:aria-label="field.label"
								@update:model-value="(value: boolean) => (settingsDraft[field.key] = value)"
							/>
						</div>
						<template v-else>
							<label class="text-base text-primary" :for="`plugin-setting-${field.key}`">
								{{ field.label }}
							</label>
							<p v-if="field.description" class="m-0 text-xs text-secondary">
								{{ field.description }}
							</p>
							<select
								v-if="field.type === 'select' && field.options?.length"
								:id="`plugin-setting-${field.key}`"
								class="rounded-xl border border-solid border-surface-5 bg-surface-2 px-3 py-2 text-primary"
								:value="String(settingsDraft[field.key] ?? field.default ?? '')"
								@change="setDraft(field.key, 'select', $event)"
							>
								<option v-for="option in field.options" :key="option.value" :value="option.value">
									{{ option.label || option.value }}
								</option>
							</select>
							<div v-else-if="field.type === 'color'" class="flex items-center gap-2">
								<input
									:id="`plugin-setting-${field.key}`"
									type="color"
									class="h-9 w-14 cursor-pointer rounded-lg border border-solid border-surface-5 bg-surface-3"
									:value="String(settingsDraft[field.key] ?? field.default ?? '#000000')"
									@change="setDraft(field.key, 'color', $event)"
								/>
								<span class="font-mono text-xs text-secondary">
									{{ String(settingsDraft[field.key] ?? field.default ?? '#000000') }}
								</span>
							</div>
							<input
								v-else-if="field.type === 'number'"
								:id="`plugin-setting-${field.key}`"
								type="number"
								class="rounded-xl border border-solid border-surface-5 bg-surface-2 px-3 py-2 text-primary"
								:min="field.min"
								:max="field.max"
								:placeholder="field.placeholder"
								:value="String(settingsDraft[field.key] ?? field.default ?? '')"
								@change="setDraft(field.key, 'number', $event)"
							/>
							<input
								v-else
								:id="`plugin-setting-${field.key}`"
								type="text"
								class="rounded-xl border border-solid border-surface-5 bg-surface-2 px-3 py-2 text-primary"
								:placeholder="field.placeholder"
								:value="String(settingsDraft[field.key] ?? field.default ?? '')"
								@change="setDraft(field.key, 'string', $event)"
							/>
						</template>
					</div>
				</template>
				<p v-else class="m-0 text-sm text-secondary">
					{{ formatMessage(messages.settingsEmpty) }}
				</p>
				<div v-if="actionsOf(settingsTarget).length" class="flex flex-col gap-2">
					<p class="m-0 text-xs font-semibold text-secondary">
						{{ formatMessage(messages.actionsTitle) }}
					</p>
					<div class="flex flex-wrap gap-2">
						<Button
							v-for="action in actionsOf(settingsTarget)"
							:key="action.id"
							size="sm"
							type="outlined"
							:disabled="!settingsTarget.enabled"
							@click="invokeAction(action.id)"
						>
							{{ action.label }}
						</Button>
					</div>
				</div>
				<div class="flex justify-end gap-2">
					<Button @click="settingsModal?.hide()">
						{{ formatMessage(messages.close) }}
					</Button>
					<Button type="colored" color="brand" @click="saveSettings">
						{{ formatMessage(messages.apply) }}
					</Button>
				</div>
			</div>
		</NewModal>
	</div>
</template>

<style scoped>
.plugin-card {
	container-type: inline-size;
}

.plugin-icon-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border-radius: 0.75rem;
	color: var(--color-secondary);
	transition:
		background-color 0.15s ease,
		color 0.15s ease,
		transform 0.15s ease;
}

.plugin-icon-btn:hover {
	background: var(--color-surface-4);
	color: var(--color-contrast);
	transform: scale(1.05);
}

.plugin-icon-btn:active {
	transform: scale(0.95);
}

.plugin-icon-btn-danger:hover {
	color: var(--color-red);
}

.catalog-chip {
	border-radius: 9999px;
	padding: 0.25rem 0.75rem;
	font-size: 0.875rem;
	color: var(--color-secondary);
	background: var(--color-surface-3);
	border: 1px solid var(--color-surface-5);
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.catalog-chip:hover {
	color: var(--color-contrast);
}

.catalog-chip.selected {
	background: var(--color-brand);
	color: var(--color-accent-contrast);
	border-color: var(--color-brand);
}
</style>
