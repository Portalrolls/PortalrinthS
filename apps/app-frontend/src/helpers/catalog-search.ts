/**
 * Поиск Modrinth через каталог uprojects.
 *
 * Когда api.modrinth.com у провайдера заблокирован, обзор проектов висел на
 * таймаутах. Каталог сервиса отдаёт тот же индекс Modrinth — переводим в
 * него строку запроса обзора и собираем ответ в форме поиска Labrinth v3,
 * чтобы карточки не заметили подмены.
 */
import type { Labrinth } from '@modrinth/api-client'

import { proxiedFetch } from './proxy-fetch'
import { UPROJECTS_BASE, UPROJECTS_BASE_EU } from './uprojects-service'

type Hit = Labrinth.Search.v3.ResultSearchProject
type CatalogHit = {
	project_id: string
	slug?: string | null
	project_type?: string
	title?: string
	description?: string
	author?: string
	icon_url?: string | null
	categories?: string[]
	downloads?: number
	follows?: number
	date_created?: string
	date_modified?: string
	gallery?: string[]
	featured_gallery?: string | null
	color?: number | null
	client_side?: string
	server_side?: string
}

const LOADERS = new Set([
	'fabric',
	'forge',
	'neoforge',
	'quilt',
	'liteloader',
	'babric',
	'rift',
	'modloader',
	'legacy-fabric',
	'ornithe',
	'nilloader',
	'bta-babric',
	'java-agent',
	'bukkit',
	'spigot',
	'paper',
	'purpur',
	'folia',
	'sponge',
	'velocity',
	'bungeecord',
	'waterfall',
	'iris',
	'optifine',
	'canvas',
	'vanilla',
	'minecraft',
	'datapack',
])

const CATALOG_TYPES = new Set(['mod', 'modpack', 'resourcepack', 'shader', 'datapack', 'plugin'])

/** Поля из new_filters: `field = \`v\`` и `field IN [\`a\`, \`b\`]`, без отрицаний. */
function readFilters(raw: string): Record<string, string[]> {
	const fields: Record<string, string[]> = {}
	const pattern = /(\w+)\s+(=|IN)\s+(\[[^\]]*\]|`[^`]*`|\S+)/g
	for (const match of raw.matchAll(pattern)) {
		if (match[1] === 'NOT') continue
		const values = (match[3].match(/`([^`]*)`/g) ?? [match[3]]).map((value) =>
			value.replace(/^`|`$/g, ''),
		)
		;(fields[match[1]] ??= []).push(...values)
	}
	return fields
}

export function catalogSearchParams(requestParams: string): URLSearchParams | null {
	const source = new URLSearchParams(requestParams.replace(/^\?/, ''))
	const filters = readFilters(source.get('new_filters') ?? '')
	const types = filters.project_types ?? []
	// Серверы и смешанные типы каталог не ищет — тут честно отказываемся.
	if (types.length > 1 || types.some((type) => !CATALOG_TYPES.has(type))) return null
	const params = new URLSearchParams({ source: 'modrinth' })
	const query = source.get('query')
	if (query) params.set('query', query)
	if (types[0]) params.set('type', types[0])
	const categories = filters.categories ?? []
	const loaders = categories.filter((name) => LOADERS.has(name))
	const tags = categories.filter((name) => !LOADERS.has(name))
	if (loaders.length) params.set('loaders', loaders.join(','))
	if (tags.length) params.set('categories', tags.join(','))
	if (filters.game_versions?.length) params.set('versions', filters.game_versions[0])
	params.set('index', source.get('index') || 'relevance')
	params.set('limit', source.get('limit') || '20')
	params.set('offset', source.get('offset') || '0')
	return params
}

function toV3(hit: CatalogHit): Hit {
	const categories = hit.categories ?? []
	const type = hit.project_type || 'mod'
	return {
		project_id: hit.project_id,
		project_types: [type],
		all_project_types: [type],
		slug: hit.slug ?? null,
		author: hit.author ?? '',
		author_id: null,
		organization: null,
		organization_id: null,
		name: hit.title ?? hit.slug ?? '',
		summary: hit.description ?? '',
		categories,
		display_categories: categories,
		downloads: hit.downloads ?? 0,
		follows: hit.follows ?? 0,
		icon_url: hit.icon_url ?? null,
		date_created: hit.date_created ?? '',
		date_modified: hit.date_modified ?? hit.date_created ?? '',
		license: '',
		gallery: hit.gallery ?? [],
		featured_gallery: hit.featured_gallery ?? null,
		color: hit.color ?? null,
		loaders: categories.filter((name) => LOADERS.has(name)),
		disclosure_types: [],
	}
}

async function askCatalog(base: string, params: URLSearchParams) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 20000)
	try {
		const response = await proxiedFetch(`${base}/api/catalog/search?${params}`, {
			connectTimeout: 8000,
			signal: controller.signal,
		})
		if (!response.ok) throw new Error(`catalog ${response.status}`)
		return (await response.json()) as { hits?: CatalogHit[]; total_hits?: number }
	} finally {
		clearTimeout(timer)
	}
}

export async function catalogSearchV3(
	requestParams: string,
): Promise<{ result: Labrinth.Search.v3.SearchResults } | null> {
	const params = catalogSearchParams(requestParams)
	if (!params) return null
	const data = await askCatalog(UPROJECTS_BASE, params).catch(() =>
		askCatalog(UPROJECTS_BASE_EU, params),
	)
	const limit = Number(params.get('limit')) || 20
	const offset = Number(params.get('offset')) || 0
	return {
		result: {
			hits: (data.hits ?? []).map(toV3),
			page: Math.floor(offset / limit) + 1,
			hits_per_page: limit,
			total_hits: data.total_hits ?? 0,
		},
	}
}
