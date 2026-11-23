/**
 * Portalrinth plugins, compatible with the Noctrinth plugin format
 * (https://github.com/Everelsu/Noctrinth-Plugins).
 *
 * A plugin is a folder with `plugin.json` plus styles, an optional extension
 * entry and page files, packed into a .zip. The manifest follows the
 * Noctrinth plugin schema: `styles[]` are CSS files, `entry` is a JS file run
 * inside a sandboxed Web Worker with the `noctrinth` SDK, `pages[]` add
 * sidebar tabs, `settings[]` become live controls (boolean settings are
 * exposed as `data-plugin-<id>-<key>` attributes, `cssVar` fields as CSS
 * custom properties). Legacy manifests (`manifest.json` with `css[]`) keep
 * working and are treated as plain themes.
 *
 * The catalog is the published Noctrinth-Plugins index: it lists ready
 * archives with SHA-256 checksums, so installing is one click without
 * accounts.
 *
 * Safe Mode (Ctrl+Shift+Alt+P, or the switch in Settings → Plugins) turns
 * every plugin off for the current session: styles go away, extension
 * workers are terminated and plugin pages disappear. Quick CSS is a
 * scratchpad stylesheet that sits on top of all installed plugins.
 */
import { invoke } from '@tauri-apps/api/core'
import JSZip from 'jszip'
import { computed, reactive, ref, shallowRef, watch } from 'vue'

import { proxiedFetch } from '@/helpers/proxy-fetch'

export type PluginType = 'theme' | 'content-source' | 'extension'

export interface PluginPermissions {
	domains?: string[]
	events?: string[]
	instances?: string[]
	ui?: string[]
}

export interface PluginSettingField {
	key: string
	type: 'string' | 'boolean' | 'number' | 'select' | 'color'
	label: string
	description?: string
	placeholder?: string
	default?: string | boolean | number
	min?: number
	max?: number
	cssVar?: string
	options?: { value: string; label: string }[]
	group?: string
	when?: { key: string; equals: unknown }
}

export interface PluginPageDef {
	id: string
	title: string
	entry?: string
	html?: string
	tooltip?: string
}

export interface PluginManifest {
	id: string
	name: string
	version?: string
	apiVersion?: number
	type?: PluginType
	author?: string
	description?: string
	homepage?: string
	repository?: string
	tags?: string[]
	/** Legacy field: same meaning as `styles`. */
	css?: string[]
	/** Paths of the CSS files inside the archive, in apply order. */
	styles?: string[]
	/** Path of the extension entry, run in a sandboxed Web Worker. */
	entry?: string
	permissions?: PluginPermissions
	settings?: PluginSettingField[]
	pages?: PluginPageDef[]
}

export interface InstalledPlugin {
	manifest: PluginManifest
	/** Concatenated CSS of all the plugin's stylesheets. */
	css: string
	/** Text files of the plugin: the extension entry and page scripts. */
	files: Record<string, string>
	/** Live settings values (defaults come from the manifest). */
	values: Record<string, string | boolean | number>
	enabled: boolean
	installedAt: string
	source?: 'catalog' | 'file' | 'legacy'
}

/** One entry of the published Noctrinth catalog. */
export interface CatalogPlugin {
	id: string
	name: string
	version: string
	type: PluginType
	author?: string
	description?: string
	homepage?: string
	repository?: string
	icon_url?: string
	banner_url?: string
	tags?: string[]
	download_url: string
	sha256?: string
	permissions?: PluginPermissions
}

const PLUGINS_KEY = 'portalrinth-plugins'
const QUICK_CSS_KEY = 'portalrinth-quick-css'
const SAFE_MODE_KEY = 'portalrinth-plugin-safe-mode'
const STYLE_MARKER = 'data-pr-plugin'
const QUICK_CSS_ID = '__quick-css__'
const CATALOG_URL = 'https://everelsu.github.io/Noctrinth-Plugins/index.json'
/** Total text (CSS + scripts) kept per plugin in localStorage. */
const PLUGIN_TEXT_LIMIT = 4 * 1024 * 1024
/** Zip size caps: network catalog archives and picked files. */
const CATALOG_ZIP_LIMIT = 150 * 1024 * 1024
const FILE_ZIP_LIMIT = 50 * 1024 * 1024

function loadPlugins(): InstalledPlugin[] {
	try {
		const raw = localStorage.getItem(PLUGINS_KEY)
		const list = raw ? (JSON.parse(raw) as InstalledPlugin[]) : []
		return Array.isArray(list)
			? list.filter((plugin) => plugin?.manifest?.id && typeof plugin.css === 'string')
			: []
	} catch {
		return []
	}
}

function loadQuickCss(): { css: string; enabled: boolean } {
	try {
		const raw = localStorage.getItem(QUICK_CSS_KEY)
		if (raw) {
			const parsed = JSON.parse(raw) as { css?: string; enabled?: boolean }
			return { css: parsed.css ?? '', enabled: parsed.enabled !== false }
		}
	} catch {
		/* defaults below */
	}
	return { css: '', enabled: true }
}

export const plugins = reactive<InstalledPlugin[]>(loadPlugins())
export const quickCss = reactive(loadQuickCss())

export const isPluginSafeMode = () => sessionStorage.getItem(SAFE_MODE_KEY) === '1'

/** Reactive mirror, so the settings switch and the hotkey stay in sync. */
export const pluginSafeMode = ref(isPluginSafeMode())

/** Safe Mode lasts one session: the flag is cleared when it is turned off. */
export function setPluginSafeMode(on: boolean) {
	if (on) sessionStorage.setItem(SAFE_MODE_KEY, '1')
	else sessionStorage.removeItem(SAFE_MODE_KEY)
	pluginSafeMode.value = isPluginSafeMode()
	applyPlugins()
}

/* --------------------------------- styles -------------------------------- */

function injectStyle(id: string, css: string) {
	const style = document.createElement('style')
	style.setAttribute(STYLE_MARKER, id)
	style.textContent = css
	document.head.appendChild(style)
}

let appliedAttrs: string[] = []
let appliedVars: string[] = []

/** Settings become `data-plugin-<id>-<key>` attributes and `cssVar` properties. */
function applyPluginSettings() {
	const root = document.documentElement
	for (const name of appliedAttrs) root.removeAttribute(name)
	for (const cssVar of appliedVars) root.style.removeProperty(cssVar)
	appliedAttrs = []
	appliedVars = []
	if (pluginSafeMode.value) return
	for (const plugin of plugins) {
		if (!plugin.enabled) continue
		const idSlug = attrSlug(plugin.manifest.id)
		for (const field of plugin.manifest.settings ?? []) {
			const value = plugin.values[field.key]
			if (value === undefined || value === null) continue
			const attr = `data-plugin-${idSlug}-${attrSlug(field.key)}`
			try {
				root.setAttribute(attr, String(value))
			} catch {
				continue
			}
			appliedAttrs.push(attr)
			if (field.cssVar && /^--[a-zA-Z0-9-]+$/.test(field.cssVar)) {
				root.style.setProperty(field.cssVar, String(value))
				appliedVars.push(field.cssVar)
			}
		}
	}
}

function attrSlug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'x'
	)
}

/** Re-applies every enabled plugin, then Quick CSS on top of them. */
export function applyPlugins() {
	for (const style of document.querySelectorAll(`style[${STYLE_MARKER}]`)) {
		style.remove()
	}
	if (!pluginSafeMode.value) {
		for (const plugin of plugins) {
			if (plugin.enabled && plugin.css.trim()) {
				injectStyle(plugin.manifest.id, plugin.css)
			}
		}
	}
	if (quickCss.enabled && !pluginSafeMode.value && quickCss.css.trim()) {
		injectStyle(QUICK_CSS_ID, quickCss.css)
	}
	applyPluginSettings()
	restartRuntime()
}

let applyTimer: ReturnType<typeof setTimeout> | null = null

/** Saves and re-applies, throttled so a live editor can type through it. */
function scheduleSaveAndApply() {
	if (applyTimer) clearTimeout(applyTimer)
	applyTimer = setTimeout(() => {
		applyTimer = null
		try {
			localStorage.setItem(PLUGINS_KEY, JSON.stringify(plugins))
		} catch {
			/* a full quota keeps the session's styles but stops persisting */
		}
		try {
			localStorage.setItem(QUICK_CSS_KEY, JSON.stringify(quickCss))
		} catch {
			/* same as above */
		}
		applyPlugins()
	}, 200)
}

watch(plugins, scheduleSaveAndApply, { deep: true })
watch(quickCss, scheduleSaveAndApply, { deep: true })

export function togglePlugin(id: string, enabled: boolean) {
	const plugin = plugins.find((entry) => entry.manifest.id === id)
	if (plugin) plugin.enabled = enabled
}

export function removePlugin(id: string) {
	const index = plugins.findIndex((entry) => entry.manifest.id === id)
	if (index >= 0) plugins.splice(index, 1)
}

export function setPluginSetting(id: string, key: string, value: string | boolean | number) {
	const plugin = plugins.find((entry) => entry.manifest.id === id)
	if (plugin) plugin.values[key] = value
}

export function applyPluginPreset(id: string, values: Record<string, string | boolean | number>) {
	const plugin = plugins.find((entry) => entry.manifest.id === id)
	if (plugin) plugin.values = { ...plugin.values, ...values }
}

export function setQuickCss(css: string) {
	quickCss.css = css
}

/* ------------------------------ normalization ----------------------------- */

function sanitizeId(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 64) || 'plugin'
	)
}

function baseName(path: string): string {
	const tail = path.split(/[/\\]/).pop() ?? path
	return tail.replace(/\.(css|js|json)$/i, '') || path
}

const PLUGIN_TYPES: PluginType[] = ['theme', 'content-source', 'extension']
const SETTING_TYPES = ['string', 'boolean', 'number', 'select', 'color']

/** Validates and coerces a raw manifest; throws when it cannot be trusted. */
function normalizeManifest(raw: Record<string, unknown>, fallbackName: string): PluginManifest {
	if (raw.apiVersion !== undefined && raw.apiVersion !== 1) {
		throw new Error(
			`Плагин просит apiVersion ${String(raw.apiVersion)}, а этот лаунчер поддерживает 1`,
		)
	}
	const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackName
	const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName
	const stringList = (value: unknown): string[] | undefined =>
		Array.isArray(value)
			? value.filter((item): item is string => typeof item === 'string')
			: undefined
	const permissions: PluginPermissions = {}
	if (raw.permissions && typeof raw.permissions === 'object') {
		const source = raw.permissions as Record<string, unknown>
		permissions.domains = stringList(source.domains)
		permissions.events = stringList(source.events)
		permissions.instances = stringList(source.instances)
		permissions.ui = stringList(source.ui)
	}
	const settings = Array.isArray(raw.settings)
		? raw.settings
				.filter(
					(item): item is Record<string, unknown> =>
						!!item &&
						typeof item === 'object' &&
						typeof (item as Record<string, unknown>).key === 'string' &&
						SETTING_TYPES.includes(String((item as Record<string, unknown>).type)),
				)
				.map((item) => {
					const field = item as Record<string, unknown>
					const result: PluginSettingField = {
						key: String(field.key),
						type: String(field.type) as PluginSettingField['type'],
						label: typeof field.label === 'string' && field.label ? field.label : String(field.key),
					}
					if (typeof field.description === 'string') result.description = field.description
					if (typeof field.placeholder === 'string') result.placeholder = field.placeholder
					if (['string', 'boolean', 'number'].includes(typeof field.default))
						result.default = field.default as string | boolean | number
					if (typeof field.min === 'number') result.min = field.min
					if (typeof field.max === 'number') result.max = field.max
					if (typeof field.cssVar === 'string' && /^--[a-zA-Z0-9-]+$/.test(field.cssVar))
						result.cssVar = field.cssVar
					if (Array.isArray(field.options))
						result.options = field.options
							.filter(
								(option): option is { value: string; label: string } =>
									!!option &&
									typeof option === 'object' &&
									typeof (option as Record<string, unknown>).value === 'string',
							)
							.map((option) => ({
								value: String((option as Record<string, unknown>).value),
								label: String((option as Record<string, unknown>).label ?? ''),
							}))
					if (typeof field.group === 'string') result.group = field.group
					if (
						field.when &&
						typeof field.when === 'object' &&
						typeof (field.when as Record<string, unknown>).key === 'string'
					)
						result.when = field.when as { key: string; equals: unknown }
					return result
				})
		: undefined
	const pages = Array.isArray(raw.pages)
		? raw.pages
				.filter(
					(item): item is Record<string, unknown> =>
						!!item &&
						typeof item === 'object' &&
						typeof (item as Record<string, unknown>).id === 'string' &&
						typeof (item as Record<string, unknown>).title === 'string',
				)
				.map((item) => {
					const source = item as Record<string, unknown>
					const page: PluginPageDef = {
						id: String(source.id),
						title: String(source.title),
					}
					if (typeof source.entry === 'string') page.entry = source.entry
					if (typeof source.html === 'string') page.html = source.html
					if (typeof source.tooltip === 'string') page.tooltip = source.tooltip
					return page
				})
		: undefined
	const manifest: PluginManifest = {
		id: sanitizeId(id),
		name,
		version: typeof raw.version === 'string' ? raw.version : undefined,
		apiVersion: 1,
		type: PLUGIN_TYPES.includes(raw.type as PluginType) ? (raw.type as PluginType) : 'theme',
		author: typeof raw.author === 'string' ? raw.author : undefined,
		description: typeof raw.description === 'string' ? raw.description : undefined,
		homepage: typeof raw.homepage === 'string' ? raw.homepage : undefined,
		repository: typeof raw.repository === 'string' ? raw.repository : undefined,
		tags: stringList(raw.tags),
		css: stringList(raw.css),
		styles: stringList(raw.styles),
		entry: typeof raw.entry === 'string' ? raw.entry : undefined,
		permissions,
		settings,
		pages,
	}
	return manifest
}

function defaultValues(manifest: PluginManifest): Record<string, string | boolean | number> {
	const values: Record<string, string | boolean | number> = {}
	for (const field of manifest.settings ?? []) {
		if (field.default !== undefined) values[field.key] = field.default
	}
	return values
}

function upsertPlugin(plugin: InstalledPlugin) {
	const index = plugins.findIndex((entry) => entry.manifest.id === plugin.manifest.id)
	if (index >= 0) plugins.splice(index, 1, plugin)
	else plugins.push(plugin)
}

/* ------------------------------- installing ------------------------------- */

function assertTextLimit(files: Record<string, string>, css: string) {
	const total = css.length + Object.values(files).reduce((sum, text) => sum + text.length, 0)
	if (total > PLUGIN_TEXT_LIMIT) {
		throw new Error('Плагин слишком большой — хранится в настройках, лимит 4 МБ текста')
	}
}

async function installFromArchive(
	data: ArrayBuffer,
	source: InstalledPlugin['source'],
	fallbackName: string,
): Promise<void> {
	let archive: JSZip
	try {
		archive = await JSZip.loadAsync(data)
	} catch {
		throw new Error('Архив повреждён или это не zip')
	}
	const entries = Object.keys(archive.files).filter((name) => !archive.files[name].dir)
	const manifestPath =
		entries.find((name) => /(^|\/)plugin\.json$/i.test(name)) ??
		entries.find((name) => /(^|\/)manifest\.json$/i.test(name))
	let manifest: PluginManifest
	if (!manifestPath) {
		manifest = normalizeManifest({}, fallbackName)
	} else {
		let raw: Record<string, unknown>
		try {
			raw = JSON.parse((await archive.files[manifestPath].async('string')) || '{}')
		} catch {
			throw new Error(
				`${manifestPath.endsWith('plugin.json') ? 'plugin' : 'manifest'}.json не читается — проверьте JSON`,
			)
		}
		manifest = normalizeManifest(raw, fallbackName)
	}
	const base = manifestPath ? manifestPath.replace(/[^/]*$/, '') : ''
	const readText = async (path: string): Promise<string | null> => {
		const file = archive.files[base + path] ?? archive.files[path]
		if (!file) return null
		return (await file.async('string')) || ''
	}

	const files: Record<string, string> = {}
	const stylePaths =
		(manifest.styles?.length ?? manifest.css?.length)
			? (manifest.styles ?? manifest.css ?? [])
			: entries
					.filter((name) => name.startsWith(base) && /\.css$/i.test(name))
					.map((name) => name.slice(base.length))
	const chunks: string[] = []
	for (const path of stylePaths) {
		const text = await readText(path)
		if (text !== null) chunks.push(text)
	}
	const css = chunks.join('\n').trim()

	if (manifest.entry) {
		const entry = await readText(manifest.entry)
		if (entry === null) throw new Error(`Не найден entry-файл ${manifest.entry}`)
		if (!entry.trim()) throw new Error('entry-файл пуст')
		files[manifest.entry] = entry
	}
	for (const page of manifest.pages ?? []) {
		if (page.entry) {
			const code = await readText(page.entry)
			if (code === null) throw new Error(`Не найден файл вкладки ${page.entry}`)
			files[page.entry] = code
		}
	}
	if (!css && !manifest.entry && !(manifest.pages ?? []).length) {
		throw new Error('В архиве нет ни стилей, ни кода плагина')
	}
	assertTextLimit(files, css)
	upsertPlugin({
		manifest,
		css,
		files,
		values: defaultValues(manifest),
		enabled: true,
		installedAt: new Date().toISOString(),
		source,
	})
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Installs from picked files: a .zip with a manifest (root, or one folder
 * deep), a bare .css file, or a loose folder pick of manifest.json + css.
 * Re-installing a plugin id replaces it - that is how a plugin updates.
 */
export async function installPluginFiles(files: File[]): Promise<'zip' | 'css' | 'folder'> {
	const usable = files.filter((file) => file && file.size < FILE_ZIP_LIMIT)
	if (usable.length === 0) {
		throw new Error('Не удалось прочитать выбранные файлы')
	}

	const zip = usable.find((file) => /\.zip$/i.test(file.name))
	if (zip) {
		await installFromArchive(await zip.arrayBuffer(), 'file', baseName(zip.name))
		return 'zip'
	}

	const cssFiles = usable.filter((file) => /\.css$/i.test(file.name))
	if (cssFiles.length > 0) {
		for (const file of cssFiles) {
			const css = (await file.text()).trim()
			if (!css) throw new Error(`Файл ${file.name} пуст`)
			const manifest = normalizeManifest(
				{ id: baseName(file.name), name: baseName(file.name) },
				baseName(file.name),
			)
			upsertPlugin({
				manifest,
				css,
				files: {},
				values: defaultValues(manifest),
				enabled: true,
				installedAt: new Date().toISOString(),
				source: 'legacy',
			})
		}
		return 'css'
	}

	const manifestFile = usable.find((file) => /manifest\.json$/i.test(file.name))
	if (manifestFile) {
		let raw: Record<string, unknown>
		try {
			raw = JSON.parse((await manifestFile.text()) || '{}')
		} catch {
			throw new Error('manifest.json не читается — проверьте JSON')
		}
		const manifest = normalizeManifest(raw, baseName(manifestFile.name))
		const chunks: string[] = []
		for (const file of usable.filter((entry) => /\.css$/i.test(entry.name))) {
			chunks.push((await file.text()) || '')
		}
		const css = chunks.join('\n').trim()
		if (!css) throw new Error('Рядом с manifest.json нет .css файлов')
		upsertPlugin({
			manifest,
			css,
			files: {},
			values: defaultValues(manifest),
			enabled: true,
			installedAt: new Date().toISOString(),
			source: 'legacy',
		})
		return 'folder'
	}

	throw new Error('Поддерживаются .zip с plugin.json или .css файлы')
}

/* --------------------------------- catalog -------------------------------- */

interface CatalogIndex {
	schema_version?: number
	plugins?: Record<string, unknown>[]
}

export const catalogPlugins = ref<CatalogPlugin[]>([])
export const catalogLoading = ref(false)
export const catalogFailed = ref(false)

async function catalogFetch(url: string): Promise<Response> {
	try {
		return await proxiedFetch(url)
	} catch {
		return await fetch(url)
	}
}

/** Loads the published Noctrinth-Plugins index. */
export async function loadCatalog(force = false): Promise<CatalogPlugin[]> {
	if (catalogLoading.value) return catalogPlugins.value
	if (!force && catalogPlugins.value.length > 0) return catalogPlugins.value
	catalogLoading.value = true
	catalogFailed.value = false
	try {
		const response = await catalogFetch(CATALOG_URL)
		if (!response.ok) throw new Error(String(response.status))
		const data = (await response.json()) as CatalogIndex
		catalogPlugins.value = (Array.isArray(data?.plugins) ? data.plugins : [])
			.filter(
				(item): item is Record<string, unknown> =>
					!!item &&
					typeof item === 'object' &&
					typeof (item as Record<string, unknown>).id === 'string' &&
					typeof (item as Record<string, unknown>).name === 'string' &&
					typeof (item as Record<string, unknown>).download_url === 'string',
			)
			.map((item) => ({
				id: String(item.id),
				name: String(item.name),
				version: String(item.version ?? '1.0.0'),
				type: PLUGIN_TYPES.includes(item.type as PluginType) ? (item.type as PluginType) : 'theme',
				author: typeof item.author === 'string' ? item.author : undefined,
				description: typeof item.description === 'string' ? item.description : undefined,
				homepage: typeof item.homepage === 'string' ? item.homepage : undefined,
				repository: typeof item.repository === 'string' ? item.repository : undefined,
				icon_url: typeof item.icon_url === 'string' ? item.icon_url : undefined,
				banner_url: typeof item.banner_url === 'string' ? item.banner_url : undefined,
				tags: Array.isArray(item.tags)
					? item.tags.filter((tag): tag is string => typeof tag === 'string')
					: undefined,
				download_url: String(item.download_url),
				sha256: typeof item.sha256 === 'string' ? item.sha256.toLowerCase() : undefined,
				permissions:
					item.permissions && typeof item.permissions === 'object'
						? (item.permissions as PluginPermissions)
						: undefined,
			}))
	} catch {
		catalogPlugins.value = []
		catalogFailed.value = true
	}
	catalogLoading.value = false
	return catalogPlugins.value
}

export function catalogStateOf(entry: CatalogPlugin): 'none' | 'update' | 'installed' {
	const version = plugins.find((plugin) => plugin.manifest.id === entry.id)?.manifest.version
	if (version === undefined) return 'none'
	return version && entry.version && version !== entry.version ? 'update' : 'installed'
}

/** Downloads a catalog archive, verifies its checksum and installs it. */
export async function installFromCatalog(entry: CatalogPlugin): Promise<void> {
	const response = await catalogFetch(entry.download_url)
	if (!response.ok) throw new Error(`Каталог ответил ${response.status}`)
	const buffer = await response.arrayBuffer()
	if (buffer.byteLength > CATALOG_ZIP_LIMIT) throw new Error('Архив слишком большой')
	if (entry.sha256) {
		const hash = await sha256Hex(new Uint8Array(buffer))
		if (hash !== entry.sha256) throw new Error('Контрольная сумма архива не совпала')
	}
	await installFromArchive(buffer, 'catalog', entry.id)
}

/* ------------------------------- worker run ------------------------------- */

/**
 * The extension SDK, injected into each worker before the plugin's entry.
 * Every call is an RPC to the launcher window; the launcher enforces the
 * permissions declared in the manifest. `ui.registerAction` handlers live on
 * this side and are invoked by an `__action` message.
 */
const WORKER_SDK_SOURCE = `
(() => {
        const pending = new Map()
        const listeners = new Map()
        const actions = new Map()
        const sources = new Map()
        let seq = 1
        function call(method, args) {
                return new Promise((resolve, reject) => {
                        const id = seq++
                        pending.set(id, { resolve, reject })
                        self.postMessage({ __pr: 1, id, method, args })
                })
        }
        function failReply(data, error) {
                self.postMessage({ __prReply: 1, id: data.id, error })
        }
        function logError(where, error) {
                self.postMessage({ __log: 1, args: [where, String(error && error.message ? error.message : error)] })
        }
        const noctrinth = {
                id: __PR_PLUGIN_ID__,
                version: __PR_PLUGIN_VERSION__,
                fetch: (url, init) => call('fetch', { url, init }),
                storage: {
                        get: (key) => call('storage.get', { key }),
                        set: (key, value) => call('storage.set', { key, value: String(value) }),
                        remove: (key) => call('storage.remove', { key }),
                },
                settings: {
                        get: (key) => call('settings.get', { key }),
                        getAll: () => call('settings.getAll', {}),
                },
                notify: (opts) => call('notify', { opts }),
                ui: {
                        registerAction(action, handler) {
                                if (!action || typeof action.id !== 'string') return Promise.resolve()
                                actions.set(action.id, handler)
                                return call('ui.registerAction', {
                                        id: action.id,
                                        slot: String(action.slot || ''),
                                        label: String(action.label || action.id),
                                        tooltip: action.tooltip ? String(action.tooltip) : undefined,
                                })
                        },
                        showModal: (opts) => call('ui.showModal', { opts }),
                },
                instances: {
                        list: () => call('instances.list', {}),
                        get: (instanceId) => call('instances.get', { instanceId }),
                        getContent: (instanceId) => call('instances.getContent', { instanceId }),
                        launch: (instanceId) => call('instances.launch', { instanceId }),
                        removeContent: (instanceId, filePath) => call('instances.removeContent', { instanceId, filePath }),
                        toggleContent: (instanceId, filePath, enabled) =>
                                call('instances.toggleContent', { instanceId, filePath, enabled }),
                        getLogs: (instanceId) => call('instances.getLogs', { instanceId }),
                },
                contentSource: {
                        register(def) {
                                if (!def || typeof def.label !== 'string') return Promise.resolve()
                                sources.set(def.label, def)
                                return call('contentSource.register', {
                                        label: def.label,
                                        projectTypes: Array.isArray(def.projectTypes) ? def.projectTypes.map(String) : undefined,
                                })
                        },
                },
                on(event, handler) {
                        if (typeof event !== 'string' || typeof handler !== 'function') return
                        if (!listeners.has(event)) listeners.set(event, new Set())
                        listeners.get(event).add(handler)
                },
                log: (...args) => self.postMessage({ __log: 1, args }),
        }
        self.noctrinth = noctrinth
        self.addEventListener('message', (event) => {
                const data = event.data
                if (!data || typeof data !== 'object') return
                if (data.__prReply) {
                        const entry = pending.get(data.id)
                        if (!entry) return
                        pending.delete(data.id)
                        if (data.error) entry.reject(new Error(data.error))
                        else entry.resolve(data.result)
                        return
                }
                if (data.__event) {
                        const handlers = listeners.get(String(data.event))
                        if (handlers) for (const handler of Array.from(handlers)) {
                                try { handler(data.payload || {}) } catch (error) { logError('event handler', error) }
                        }
                        return
                }
                if (data.__action) {
                        const handler = actions.get(String(data.actionId))
                        if (handler) Promise.resolve().then(() => handler(data.context || {})).catch((error) => logError('action', error))
                        return
                }
                if (data.__csSearch) {
                        const def = sources.get(String(data.label))
                        if (!def || typeof def.search !== 'function') { failReply(data, 'content source not registered'); return }
                        Promise.resolve(def.search(data.params)).then(
                                (result) => self.postMessage({ __prReply: 1, id: data.id, result }),
                                (error) => failReply(data, String(error)),
                        )
                        return
                }
        })
})()
`

const workers = new Map<string, Worker>()
const workerBlobUrls = new Map<string, string>()

function stopWorkers() {
	for (const worker of workers.values()) {
		try {
			worker.terminate()
		} catch {
			/* already gone */
		}
	}
	workers.clear()
	for (const url of workerBlobUrls.values()) URL.revokeObjectURL(url)
	workerBlobUrls.clear()
	pluginActions.splice(0, pluginActions.length)
}

function sanitizeInstance(raw: Record<string, unknown>): Record<string, unknown> {
	const metadata = (raw.metadata ?? {}) as Record<string, unknown>
	return {
		id: raw.id,
		name: typeof metadata.name === 'string' ? metadata.name : undefined,
		loader: raw.loader,
		game_version: raw.game_version ?? metadata.game_version,
		path: raw.path,
	}
}

async function handlePluginRpc(
	pluginId: string,
	method: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const plugin = plugins.find((entry) => entry.manifest.id === pluginId)
	switch (method) {
		case 'fetch': {
			const url = String(args.url ?? '')
			if (!/^https?:\/\//i.test(url)) throw new Error('Только http(s)-адреса')
			const domains = plugin?.manifest.permissions?.domains ?? []
			if (!domains.length) throw new Error('Плагин не объявил домены в permissions.domains')
			let host = ''
			try {
				host = new URL(url).hostname
			} catch {
				throw new Error('Кривой адрес')
			}
			const allowed = domains.some((pattern) => {
				const clean = pattern.replace(/^\*\./, '.')
				return host === pattern || host === clean.slice(1) || host.endsWith(clean)
			})
			if (!allowed) throw new Error(`Домен ${host} не разрешён в permissions плагина`)
			const init = (args.init ?? {}) as {
				method?: string
				headers?: Record<string, string>
				body?: string
			}
			const response = await proxiedFetch(url, {
				method: init.method,
				headers: init.headers,
				body: init.body,
			})
			const headers: Record<string, string> = {}
			response.headers.forEach((value, key) => {
				headers[key] = value
			})
			return { status: response.status, ok: response.ok, headers, body: await response.text() }
		}
		case 'storage.get': {
			const key = storageKey(pluginId, String(args.key ?? ''))
			return localStorage.getItem(key)
		}
		case 'storage.set': {
			localStorage.setItem(storageKey(pluginId, String(args.key ?? '')), String(args.value ?? ''))
			return null
		}
		case 'storage.remove': {
			localStorage.removeItem(storageKey(pluginId, String(args.key ?? '')))
			return null
		}
		case 'settings.get': {
			const key = String(args.key ?? '')
			if (plugin?.values[key] !== undefined) return plugin.values[key]
			const field = plugin?.manifest.settings?.find((item) => item.key === key)
			return field?.default ?? null
		}
		case 'settings.getAll':
			return { ...(plugin?.values ?? {}) }
		case 'notify': {
			const opts = (args.opts ?? {}) as { title?: string; text?: string; type?: string }
			notifyHook?.({
				title: String(opts.title ?? 'Плагин'),
				text: opts.text ? String(opts.text) : undefined,
				type: ['info', 'success', 'warning', 'error'].includes(String(opts.type))
					? (String(opts.type) as 'info' | 'success' | 'warning' | 'error')
					: 'info',
			})
			return null
		}
		case 'ui.registerAction': {
			const actionId = String(args.id ?? '')
			if (!actionId) return null
			const existing = pluginActions.findIndex(
				(action) => action.pluginId === pluginId && action.id === actionId,
			)
			const registered: RegisteredAction = {
				pluginId,
				pluginName: plugin?.manifest.name ?? pluginId,
				id: actionId,
				slot: String(args.slot ?? ''),
				label: String(args.label ?? actionId),
				tooltip: typeof args.tooltip === 'string' ? args.tooltip : undefined,
			}
			if (existing >= 0) pluginActions.splice(existing, 1, registered)
			else pluginActions.push(registered)
			return null
		}
		case 'ui.showModal':
			return await requestPluginModal(
				pluginId,
				(args.opts ?? {}) as {
					title?: string
					description?: string
					blocks?: PluginModalBlock[]
					actions?: PluginModalAction[]
				},
			)
		case 'instances.list': {
			try {
				const list = await invoke<Record<string, unknown>[]>('plugin:instance|instance_list')
				return list.map(sanitizeInstance)
			} catch {
				return []
			}
		}
		case 'instances.get': {
			try {
				const raw = await invoke<Record<string, unknown> | null>('plugin:instance|instance_get', {
					instanceId: String(args.instanceId ?? ''),
				})
				return raw ? sanitizeInstance(raw) : null
			} catch {
				return null
			}
		}
		case 'contentSource.register': {
			const label = String(args.label ?? '')
			if (!label) return null
			const existing = pluginContentSources.findIndex(
				(source) => source.pluginId === pluginId && source.label === label,
			)
			const source: RegisteredContentSource = {
				pluginId,
				pluginName: plugin?.manifest.name ?? pluginId,
				label,
				projectTypes: Array.isArray(args.projectTypes)
					? (args.projectTypes as unknown[]).map(String)
					: undefined,
			}
			if (existing >= 0) pluginContentSources.splice(existing, 1, source)
			else pluginContentSources.push(source)
			return null
		}
		default:
			throw new Error(`Метод ${method} не поддерживается этим лаунчером`)
	}
}

function handleWorkerMessage(pluginId: string, worker: Worker, data: unknown) {
	if (!data || typeof data !== 'object') return
	const message = data as {
		__log?: unknown
		__pr?: unknown
		id?: number
		method?: string
		args?: Record<string, unknown>
	}
	if (message.__log) {
		console.info(
			`[plugin:${pluginId}]`,
			...(Array.isArray(message.args) ? message.args : [message.args]),
		)
		return
	}
	if (message.__pr) {
		handlePluginRpc(pluginId, String(message.method ?? ''), message.args ?? {})
			.then((result) => worker.postMessage({ __prReply: 1, id: message.id, result }))
			.catch((error) =>
				worker.postMessage({
					__prReply: 1,
					id: message.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			)
	}
}

/** Starts (or restarts) the extension workers of every enabled plugin. */
function restartRuntime() {
	stopWorkers()
	if (pluginSafeMode.value) return
	for (const plugin of plugins) {
		if (!plugin.enabled || plugin.manifest.type !== 'extension' || !plugin.manifest.entry) continue
		const code = plugin.files[plugin.manifest.entry]
		if (!code) continue
		try {
			const sdk = WORKER_SDK_SOURCE.replace(
				'__PR_PLUGIN_ID__',
				JSON.stringify(plugin.manifest.id),
			).replace('__PR_PLUGIN_VERSION__', JSON.stringify(plugin.manifest.version ?? ''))
			const blob = new Blob([sdk, '\n', code], { type: 'text/javascript' })
			const url = URL.createObjectURL(blob)
			const worker = new Worker(url)
			worker.onmessage = (event) => handleWorkerMessage(plugin.manifest.id, worker, event.data)
			worker.onerror = (event) => {
				console.warn(`[plugin:${plugin.manifest.id}] worker error`, event.message)
			}
			workers.set(plugin.manifest.id, worker)
			workerBlobUrls.set(plugin.manifest.id, url)
		} catch (error) {
			console.warn(`[plugin:${plugin.manifest.id}] failed to start`, error)
		}
	}
}

export function emitPluginEvent(name: string, payload: Record<string, unknown>) {
	if (pluginSafeMode.value) return
	for (const worker of workers.values()) {
		worker.postMessage({ __event: 1, event: name, payload })
	}
	for (const listener of pageEventListeners.get(name) ?? []) {
		try {
			listener(payload)
		} catch (error) {
			console.warn('[plugin-page] event handler error', error)
		}
	}
}

/* -------------------------------- actions --------------------------------- */

export interface RegisteredAction {
	pluginId: string
	pluginName: string
	id: string
	slot: string
	label: string
	tooltip?: string
}

export const pluginActions = reactive<RegisteredAction[]>([])
export const pluginContentSources = reactive<RegisteredContentSource[]>([])

interface RegisteredContentSource {
	pluginId: string
	pluginName: string
	label: string
	projectTypes?: string[]
}

/** Fires a registered plugin action: the handler lives in the worker. */
export function invokePluginAction(pluginId: string, actionId: string) {
	const worker = workers.get(pluginId)
	if (!worker) return
	worker.postMessage({ __action: 1, actionId, context: {} })
}

/* --------------------------------- modals --------------------------------- */

export interface PluginModalBlock {
	type: 'text' | 'code' | 'progress' | 'list'
	text?: string
	value?: number
	max?: number
	label?: string
	items?: { title: string; subtitle?: string }[]
}

export interface PluginModalAction {
	id: string
	label: string
	color?: 'brand' | 'red' | 'standard'
}

interface PluginModalRequest {
	pluginId: string
	pluginName: string
	title: string
	description?: string
	blocks?: PluginModalBlock[]
	actions?: PluginModalAction[]
	resolve: (value: string | null) => void
}

export const pluginModal = shallowRef<PluginModalRequest | null>(null)

function requestPluginModal(
	pluginId: string,
	opts: {
		title?: string
		description?: string
		blocks?: PluginModalBlock[]
		actions?: PluginModalAction[]
	},
): Promise<string | null> {
	return new Promise((resolve) => {
		pluginModal.value = {
			pluginId,
			pluginName:
				plugins.find((plugin) => plugin.manifest.id === pluginId)?.manifest.name ?? pluginId,
			title: String(opts.title ?? 'Плагин'),
			description: opts.description ? String(opts.description) : undefined,
			blocks: Array.isArray(opts.blocks) ? opts.blocks : undefined,
			actions: Array.isArray(opts.actions) ? opts.actions : undefined,
			resolve: (value) => {
				pluginModal.value = null
				resolve(value)
			},
		}
	})
}

export function resolvePluginModal(value: string | null) {
	pluginModal.value?.resolve(value)
}

/* ------------------------------ notifications ------------------------------ */

type PluginNotify = (opts: {
	title: string
	text?: string
	type?: 'info' | 'success' | 'warning' | 'error'
}) => void

let notifyHook: PluginNotify | null = null

/** Wired in App.vue so plugins reuse the launcher's notification UI. */
export function setPluginNotifyHook(hook: PluginNotify | null) {
	notifyHook = hook
}

/* ---------------------------- page SDK + tabs ------------------------------ */

const pageEventListeners = new Map<string, Set<(payload: Record<string, unknown>) => void>>()

export interface PluginPageTarget {
	pluginId: string
	pluginName: string
	pageId: string
	title: string
	tooltip?: string
}

/** Sidebar tabs contributed by enabled plugins (Safe Mode hides them all). */
export const pluginPages = computed<PluginPageTarget[]>(() => {
	if (pluginSafeMode.value) return []
	const out: PluginPageTarget[] = []
	for (const plugin of plugins) {
		if (!plugin.enabled) continue
		for (const page of plugin.manifest.pages ?? []) {
			out.push({
				pluginId: plugin.manifest.id,
				pluginName: plugin.manifest.name,
				pageId: page.id,
				title: page.title,
				tooltip: page.tooltip,
			})
		}
	}
	return out
})

/** A main-thread `noctrinth` SDK for plugin pages (real DOM access by design). */
export function createPageSdk(
	pluginId: string,
	disposeCallbacks: (() => void)[],
): Record<string, unknown> {
	const find = () => plugins.find((plugin) => plugin.manifest.id === pluginId)
	const sdk: Record<string, unknown> = {
		id: pluginId,
		version: find()?.manifest.version ?? '',
		fetch: (
			url: string,
			init?: { method?: string; headers?: Record<string, string>; body?: string },
		) => handlePluginRpc(pluginId, 'fetch', { url, init }),
		storage: {
			get: (key: string) => handlePluginRpc(pluginId, 'storage.get', { key }),
			set: (key: string, value: string) => handlePluginRpc(pluginId, 'storage.set', { key, value }),
			remove: (key: string) => handlePluginRpc(pluginId, 'storage.remove', { key }),
		},
		settings: {
			get: (key: string) => handlePluginRpc(pluginId, 'settings.get', { key }),
			getAll: () => handlePluginRpc(pluginId, 'settings.getAll', {}),
		},
		notify: (opts: { title: string; text?: string; type?: string }) =>
			handlePluginRpc(pluginId, 'notify', { opts }),
		ui: {
			registerAction: (action: { id: string; slot?: string; label: string; tooltip?: string }) =>
				handlePluginRpc(pluginId, 'ui.registerAction', {
					id: action.id,
					slot: action.slot,
					label: action.label,
					tooltip: action.tooltip,
				}),
			showModal: (opts: {
				title?: string
				description?: string
				blocks?: PluginModalBlock[]
				actions?: PluginModalAction[]
			}) => requestPluginModal(pluginId, opts),
		},
		instances: {
			list: () => handlePluginRpc(pluginId, 'instances.list', {}),
			get: (instanceId: string) => handlePluginRpc(pluginId, 'instances.get', { instanceId }),
		},
		contentSource: {
			register: (def: { label: string; projectTypes?: string[] }) =>
				handlePluginRpc(pluginId, 'contentSource.register', {
					label: def.label,
					projectTypes: def.projectTypes,
				}),
		},
		on(event: string, handler: (payload: Record<string, unknown>) => void) {
			if (!pageEventListeners.has(event)) pageEventListeners.set(event, new Set())
			pageEventListeners.get(event)!.add(handler)
			disposeCallbacks.push(() => {
				pageEventListeners.get(event)?.delete(handler)
			})
		},
		log: (...args: unknown[]) => console.info(`[plugin:${pluginId}]`, ...args),
	}
	return sdk
}

function storageKey(pluginId: string, key: string): string {
	return `portalrinth-plugin-storage:${pluginId}:${key}`
}
