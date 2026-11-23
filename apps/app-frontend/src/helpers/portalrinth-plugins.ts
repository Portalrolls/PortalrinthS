/**
 * Portalrinth plugins: CSS themes for the launcher.
 *
 * A plugin is a manifest.json plus one or more .css files packed into a .zip;
 * a bare .css file is accepted too and becomes a one-file theme. Only CSS is
 * ever applied - themes restyle the interface and no code is executed, so a
 * broken theme can at worst look wrong, never break the launcher.
 *
 * Safe Mode (Ctrl+Shift+Alt+P, or the switch in Settings → Plugins) turns
 * every plugin off for the current session, so a theme that paints everything
 * black is one hotkey away from being undone. Quick CSS is a scratchpad
 * stylesheet that sits on top of all installed plugins.
 */
import JSZip from 'jszip'
import { reactive, ref, watch } from 'vue'

export interface PluginManifest {
	/** Stable identifier, also used as the style tag marker. */
	id: string
	name: string
	version?: string
	author?: string
	description?: string
	/** Paths of the CSS files inside the archive, in apply order. */
	css?: string[]
}

export interface InstalledPlugin {
	manifest: PluginManifest
	/** Concatenated CSS of all the plugin's stylesheets. */
	css: string
	enabled: boolean
	installedAt: string
}

/** One entry of the bundled catalog: a theme ready to be installed in a click. */
export interface CatalogEntry {
	id: string
	name: string
	version?: string
	author?: string
	description?: string
	/** Path of the CSS file relative to the catalog folder. */
	file: string
	tags?: string[]
}

interface CatalogFile {
	version: number
	updated?: string
	plugins: CatalogEntry[]
}

const CATALOG_BASE = 'plugins-catalog/'
const catalog = ref<CatalogEntry[]>([])
const catalogLoading = ref(false)

/** The catalog ships with the launcher - no network, no accounts. */
export async function loadPluginCatalog(): Promise<CatalogEntry[]> {
	if (catalogLoading.value) return catalog.value
	catalogLoading.value = true
	try {
		const response = await fetch(`${CATALOG_BASE}catalog.json`, { cache: 'no-cache' })
		if (!response.ok) throw new Error(String(response.status))
		const data = (await response.json()) as CatalogFile
		catalog.value = Array.isArray(data?.plugins)
			? data.plugins.filter(
					(entry) =>
						entry &&
						typeof entry.id === 'string' &&
						typeof entry.name === 'string' &&
						typeof entry.file === 'string',
				)
			: []
	} catch {
		catalog.value = []
	}
	catalogLoading.value = false
	return catalog.value
}

export function catalogEntries(): CatalogEntry[] {
	return catalog.value
}

export function catalogLoadingState() {
	return catalogLoading
}

/** Installs a theme from the catalog: fetches its CSS and installs as a plugin. */
export async function installCatalogPlugin(entry: CatalogEntry): Promise<void> {
	const response = await fetch(`${CATALOG_BASE}${entry.file.replace(/^[/\\]+/, '')}`)
	if (!response.ok) throw new Error(String(response.status))
	const css = (await response.text()).trim()
	if (!css) throw new Error('Файл темы пуст')
	upsertPlugin(
		buildPlugin(
			{
				id: entry.id,
				name: entry.name,
				version: entry.version,
				author: entry.author,
				description: entry.description,
			},
			css,
		),
	)
}

const PLUGINS_KEY = 'portalrinth-plugins'
const QUICK_CSS_KEY = 'portalrinth-quick-css'
const SAFE_MODE_KEY = 'portalrinth-plugin-safe-mode'
const STYLE_MARKER = 'data-pr-plugin'
const QUICK_CSS_ID = '__quick-css__'

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

function injectStyle(id: string, css: string) {
	const style = document.createElement('style')
	style.setAttribute(STYLE_MARKER, id)
	style.textContent = css
	document.head.appendChild(style)
}

/** Re-applies every enabled plugin, then Quick CSS on top of them. */
export function applyPlugins() {
	for (const style of document.querySelectorAll(`style[${STYLE_MARKER}]`)) {
		style.remove()
	}
	if (pluginSafeMode.value) return
	for (const plugin of plugins) {
		if (plugin.enabled && plugin.css.trim()) {
			injectStyle(plugin.manifest.id, plugin.css)
		}
	}
	if (quickCss.enabled && quickCss.css.trim()) {
		injectStyle(QUICK_CSS_ID, quickCss.css)
	}
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

export function setQuickCss(css: string) {
	quickCss.css = css
}

function upsertPlugin(plugin: InstalledPlugin) {
	const index = plugins.findIndex((entry) => entry.manifest.id === plugin.manifest.id)
	if (index >= 0) plugins.splice(index, 1, plugin)
	else plugins.push(plugin)
}

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
	return tail.replace(/\.css$/i, '') || path
}

function buildPlugin(manifest: PluginManifest, css: string): InstalledPlugin {
	return {
		manifest: {
			...manifest,
			id: sanitizeId(manifest.id),
			name: manifest.name?.trim() || manifest.id,
		},
		css,
		enabled: true,
		installedAt: new Date().toISOString(),
	}
}

/**
 * Installs from picked files: a .zip with a manifest (root, or one folder
 * deep), a bare .css file, or a loose folder pick of manifest.json + css.
 * Re-installing a plugin id replaces it - that is how a theme updates.
 */
export async function installPluginFiles(files: File[]): Promise<'zip' | 'css' | 'folder'> {
	const usable = files.filter((file) => file && file.size < 20 * 1024 * 1024)
	if (usable.length === 0) {
		throw new Error('Не удалось прочитать выбранные файлы')
	}

	const zip = usable.find((file) => /\.zip$/i.test(file.name))
	if (zip) {
		let archive: JSZip
		try {
			archive = await JSZip.loadAsync(await zip.arrayBuffer())
		} catch {
			throw new Error('Архив повреждён или это не zip')
		}
		const entries = Object.keys(archive.files).filter((name) => !archive.files[name].dir)
		const manifestEntry = entries.find((name) => /(^|\/)manifest\.json$/i.test(name)) ?? null
		let manifest: PluginManifest = {
			id: baseName(zip.name),
			name: baseName(zip.name),
		}
		if (manifestEntry) {
			try {
				const parsed = JSON.parse(
					(await archive.files[manifestEntry].async('string')) || '{}',
				) as Partial<PluginManifest>
				manifest = {
					id: typeof parsed.id === 'string' && parsed.id ? parsed.id : manifest.id,
					name: typeof parsed.name === 'string' && parsed.name ? parsed.name : manifest.name,
					version: typeof parsed.version === 'string' ? parsed.version : undefined,
					author: typeof parsed.author === 'string' ? parsed.author : undefined,
					description: typeof parsed.description === 'string' ? parsed.description : undefined,
					css: Array.isArray(parsed.css)
						? parsed.css.filter((path): path is string => typeof path === 'string')
						: undefined,
				}
			} catch {
				throw new Error('manifest.json не читается — проверьте JSON')
			}
		}
		const manifestDir = manifestEntry ? manifestEntry.replace(/manifest\.json$/i, '') : ''
		let cssPaths: string[]
		if (manifest.css?.length) {
			cssPaths = manifest.css.map((path) => manifestDir + path)
		} else {
			cssPaths = entries
				.filter((name) => /\.css$/i.test(name))
				.sort((a, b) => a.length - b.length || a.localeCompare(b))
		}
		if (cssPaths.length === 0) {
			throw new Error('В архиве нет ни одного .css файла')
		}
		const chunks: string[] = []
		for (const path of cssPaths) {
			const file = archive.files[path]
			if (!file) continue
			chunks.push((await file.async('string')) || '')
		}
		const css = chunks.join('\n').trim()
		if (!css) throw new Error('CSS-файлы архива пусты')
		upsertPlugin(buildPlugin(manifest, css))
		return 'zip'
	}

	const cssFiles = usable.filter((file) => /\.css$/i.test(file.name))
	if (cssFiles.length > 0) {
		for (const file of cssFiles) {
			const css = (await file.text()).trim()
			if (!css) throw new Error(`Файл ${file.name} пуст`)
			const manifest: PluginManifest = {
				id: baseName(file.name),
				name: baseName(file.name),
			}
			upsertPlugin(buildPlugin(manifest, css))
		}
		return 'css'
	}

	const manifestFile = usable.find((file) => /manifest\.json$/i.test(file.name))
	if (manifestFile) {
		let manifest: PluginManifest
		try {
			const parsed = JSON.parse((await manifestFile.text()) || '{}') as Partial<PluginManifest>
			manifest = {
				id: typeof parsed.id === 'string' && parsed.id ? parsed.id : 'plugin',
				name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Плагин',
				version: typeof parsed.version === 'string' ? parsed.version : undefined,
				author: typeof parsed.author === 'string' ? parsed.author : undefined,
				description: typeof parsed.description === 'string' ? parsed.description : undefined,
			}
		} catch {
			throw new Error('manifest.json не читается — проверьте JSON')
		}
		const chunks: string[] = []
		for (const file of usable.filter((entry) => /\.css$/i.test(entry.name))) {
			chunks.push((await file.text()) || '')
		}
		const css = chunks.join('\n').trim()
		if (!css) throw new Error('Рядом с manifest.json нет .css файлов')
		upsertPlugin(buildPlugin(manifest, css))
		return 'folder'
	}

	throw new Error('Поддерживаются .zip с манифестом или .css файлы')
}
