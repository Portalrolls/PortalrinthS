import { curseforgeDownloadUrls, curseforgeGetFiles, curseforgeSearch } from '@/helpers/curseforge'
import {
        type HostedPlugin,
        type HostedServerView,
        type HostedSoftware,
        hosting_plugin_download,
} from '@/helpers/hosting'

export type HostedProjectType = 'plugin' | 'mod' | 'datapack'
export type HostedSource = 'modrinth' | 'curseforge' | 'all'
export type HostedSort = 'relevance' | 'downloads' | 'follows' | 'updated'

export interface HostedSearchHit {
        project_id: string
        slug: string
        title: string
        description: string
        author: string
        icon_url: string | null
        downloads: number
        follows: number
        source: 'modrinth' | 'curseforge'
        /** A CurseForge hit's own page; a Modrinth hit opens in the launcher. */
        website_url?: string | null
}

interface ModrinthVersion {
        id: string
        version_type: 'release' | 'beta' | 'alpha'
        date_published: string
        files: { url: string; filename: string; primary: boolean }[]
}

const MODRINTH_API = 'https://api.modrinth.com/v2'
/** CurseForge is asked through the same backend plugin the browse page uses,
 * with the very same key (the build's or the user's own) — a dead public
 * proxy can no longer take the whole source down. */

const LOADERS: Record<HostedSoftware, string[]> = {
        vanilla: ['datapack'],
        paper: ['paper', 'spigot', 'bukkit'],
        purpur: ['purpur', 'paper', 'spigot', 'bukkit'],
        folia: ['folia', 'paper', 'spigot', 'bukkit'],
        leaves: ['paper', 'spigot', 'bukkit'],
        spigot: ['spigot', 'bukkit'],
        craftbukkit: ['bukkit'],
        velocity: ['velocity'],
        waterfall: ['velocity'],
        fabric: ['fabric'],
        quilt: ['quilt', 'fabric'],
}

export function hostedProjectType(software: HostedSoftware): HostedProjectType {
        if (software === 'fabric' || software === 'quilt') return 'mod'
        if (software === 'vanilla') return 'datapack'
        return 'plugin'
}

export function hostedLoaders(software: HostedSoftware): string[] {
        return LOADERS[software] ?? []
}

/** A server can take a project when its core is one of the project's loaders. */
export function hostedServerFits(server: HostedServerView, loaders: string[]): boolean {
        const own = hostedLoaders(server.software)
        return loaders.some((loader) => own.includes(loader))
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
        const response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
        if (!response.ok) throw new Error(`Modrinth answered HTTP ${response.status}`)
        return (await response.json()) as T
}

/* --------------------------------------------------------------------- */
/* Modrinth                                                              */
/* --------------------------------------------------------------------- */

const SORT_INDEX: Record<HostedSort, string> = {
        relevance: 'relevance',
        downloads: 'downloads',
        follows: 'follows',
        updated: 'updated',
}

async function searchModrinth(
        server: HostedServerView,
        query: string,
        offset: number,
        sort: HostedSort,
        signal?: AbortSignal,
): Promise<{ hits: HostedSearchHit[]; total: number }> {
        const type = hostedProjectType(server.software)
        const facets = [
                [`project_type:${type}`],
                hostedLoaders(server.software).map((loader) => `categories:${loader}`),
                [`versions:${server.game_version}`],
        ]
        if (type === 'mod') facets.push(['server_side:required', 'server_side:optional'])
        const params = new URLSearchParams({
                query,
                limit: '20',
                offset: String(offset),
                index: !query.trim() && sort === 'relevance' ? 'downloads' : SORT_INDEX[sort],
                facets: JSON.stringify(facets),
        })
        const data = await getJson<{ hits: HostedSearchHit[]; total_hits: number }>(
                `${MODRINTH_API}/search?${params}`,
                signal,
        )
        return {
                hits: (data.hits ?? []).map((hit) => ({ ...hit, source: 'modrinth' })),
                total: data.total_hits ?? 0,
        }
}

/* --------------------------------------------------------------------- */
/* CurseForge                                                            */
/* --------------------------------------------------------------------- */

/** Loaders the backend can name to CurseForge; paper cores need none of it. */
const CF_BACKEND_LOADERS = ['forge', 'fabric', 'quilt', 'neoforge']

async function searchCurseForge(
        server: HostedServerView,
        query: string,
        offset: number,
        sort: HostedSort,
): Promise<{ hits: HostedSearchHit[]; total: number }> {
        const type = hostedProjectType(server.software)
        const results = await curseforgeSearch({
                query: query.trim() || null,
                project_type: type,
                game_versions: [server.game_version],
                loaders: hostedLoaders(server.software).filter((loader) => CF_BACKEND_LOADERS.includes(loader)),
                category_ids: [],
                sort,
                offset,
                limit: 20,
        })
        return {
                hits: results.hits.map((hit) => ({
                        project_id: hit.project_id,
                        slug: hit.slug ?? '',
                        title: hit.name,
                        description: hit.summary,
                        author: hit.author,
                        icon_url: hit.icon_url,
                        downloads: hit.downloads,
                        follows: hit.follows,
                        source: 'curseforge' as const,
                        website_url: hit.website_url,
                })),
                total: results.total_hits,
        }
}

async function installFromCurseForge(
        server: HostedServerView,
        projectId: number,
        iconUrl: string | null,
): Promise<HostedPlugin[]> {
        const loader = hostedLoaders(server.software).find((entry) => CF_BACKEND_LOADERS.includes(entry))
        // Datapacks ship as .zip, everything else as .jar.
        const wantsZip = hostedProjectType(server.software) === 'datapack'
        const files = (
                await curseforgeGetFiles(`cf-${projectId}`, server.game_version, loader ?? null)
        ).filter((file) => {
                const name = file.file_name.toLowerCase()
                return name.endsWith('.jar') || (wantsZip && name.endsWith('.zip'))
        })
        // Releases first, newest first — the same pick the Modrinth side makes.
        const rank = { release: 0, beta: 1, alpha: 2 }
        const file =
                [...files].sort(
                        (a, b) =>
                                rank[a.version_type] - rank[b.version_type] ||
                                Date.parse(b.date_published ?? '') - Date.parse(a.date_published ?? ''),
                )[0] ?? null
        if (!file) throw new NoFittingVersionError()
        const url = (await curseforgeDownloadUrls(projectId, Number(file.id))).find((entry) =>
                entry.startsWith('https://'),
        )
        if (!url) {
                throw new Error(`CurseForge did not give a download link for «${file.file_name}»`)
        }
        const plugins = await hosting_plugin_download(server.id, url, file.file_name)
        rememberIcon(server.id, file.file_name, iconUrl)
        return plugins
}

/* --------------------------------------------------------------------- */
/* Search / install facade                                               */
/* --------------------------------------------------------------------- */

export async function searchHostedContent(
        server: HostedServerView,
        query: string,
        offset: number,
        signal?: AbortSignal,
        source: HostedSource = 'modrinth',
        sort: HostedSort = 'relevance',
): Promise<{ hits: HostedSearchHit[]; total: number; curseforgeFailed?: boolean }> {
        if (source === 'curseforge') {
                return searchCurseForge(server, query, offset, sort)
        }
        if (source === 'modrinth') {
                return searchModrinth(server, query, offset, sort, signal)
        }
        // Both: Modrinth answers in the browser, CurseForge is asked through the
        // backend with the shared key and fails quietly when there is none.
        const modrinth = searchModrinth(server, query, offset, sort, signal)
        const curseforge = searchCurseForge(server, query, offset, sort)
        const [modrinthResult, curseforgeResult] = await Promise.allSettled([modrinth, curseforge])
        const hits: HostedSearchHit[] = []
        let total = 0
        let curseforgeFailed = false
        if (modrinthResult.status === 'fulfilled') {
                hits.push(...modrinthResult.value.hits)
                total += modrinthResult.value.total
        } else if (curseforgeResult.status === 'rejected') {
                throw modrinthResult.reason
        }
        if (curseforgeResult.status === 'fulfilled') {
                hits.push(...curseforgeResult.value.hits)
                total += curseforgeResult.value.total
        } else {
                curseforgeFailed = true
        }
        if (hits.length === 0 && modrinthResult.status === 'rejected' && curseforgeFailed) {
                throw modrinthResult.reason
        }
        hits.sort((a, b) => b.downloads - a.downloads || (query.trim() ? 0 : b.follows - a.follows))
        return { hits, total, curseforgeFailed }
}

export class NoFittingVersionError extends Error {}

export async function installToHostedServer(
        server: HostedServerView,
        projectId: string,
        iconUrl: string | null = null,
): Promise<HostedPlugin[]> {
        // «cf-…» comes from the backend's search, «cf:…» from older listings.
        const curseforgeId = /^(?:cf-|cf:)(\d+)$/.exec(projectId)
        if (curseforgeId) {
                return installFromCurseForge(server, Number(curseforgeId[1]), iconUrl)
        }
        const version = await pickModrinthVersion(server, projectId)
        const file = version?.files.find((entry) => entry.primary) ?? version?.files[0]
        if (!file) throw new NoFittingVersionError()
        const plugins = await hosting_plugin_download(server.id, file.url, file.filename)
        rememberIcon(server.id, file.filename, iconUrl)
        return plugins
}

/** Releases first, newest first; a beta only when nothing stable fits. */
async function pickModrinthVersion(
        server: HostedServerView,
        projectId: string,
): Promise<ModrinthVersion | null> {
        const params = new URLSearchParams({
                loaders: JSON.stringify(hostedLoaders(server.software)),
                game_versions: JSON.stringify([server.game_version]),
        })
        const versions = await getJson<ModrinthVersion[]>(
                `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params}`,
        )
        const rank = { release: 0, beta: 1, alpha: 2 }
        return (
                [...versions].sort(
                        (a, b) =>
                                rank[a.version_type] - rank[b.version_type] ||
                                Date.parse(b.date_published) - Date.parse(a.date_published),
                )[0] ?? null
        )
}

/* --------------------------------------------------------------------- */
/* Icons of installed content                                            */
/* --------------------------------------------------------------------- */

const ICON_STORE_KEY = 'portalrinth-hosted-content-icons'

type IconStore = Record<string, Record<string, string>>

function readIconStore(): IconStore {
        try {
                return JSON.parse(localStorage.getItem(ICON_STORE_KEY) ?? '{}') as IconStore
        } catch {
                return {}
        }
}

function writeIconStore(store: IconStore) {
        try {
                localStorage.setItem(ICON_STORE_KEY, JSON.stringify(store))
        } catch {
                /* the store is a nicety, losing it is fine */
        }
}

function iconKey(serverId: string, filename: string) {
        return `${serverId}/${filename}`
}

export function storedIcon(serverId: string, filename: string): string | null {
        return readIconStore()[serverId]?.[filename] ?? null
}

function rememberIcon(serverId: string, filename: string, url: string | null) {
        if (!url) return
        const store = readIconStore()
        store[serverId] = { ...(store[serverId] ?? {}), [filename]: url }
        writeIconStore(store)
}

const missingIcons = new Map<string, Promise<string | null>>()

/** Looks up an icon for a jar the server already had: the file name minus the
 * version tail is searched on Modrinth, and only an exact slug match counts. */
export function guessIcon(serverId: string, filename: string): Promise<string | null> {
        const known = storedIcon(serverId, filename)
        if (known) return Promise.resolve(known)
        const pending = missingIcons.get(iconKey(serverId, filename))
        if (pending) return pending
        const slug = filename
                .replace(/\.jar$/i, '')
                .split(/[-_.+]/)
                .filter((part) => part && !/^\d/.test(part))
                .join('-')
                .toLowerCase()
        if (!slug || slug.length < 3) return Promise.resolve(null)
        const task = (async () => {
                try {
                        const params = new URLSearchParams({
                                query: slug,
                                limit: '1',
                                index: 'relevance',
                        })
                        const data = await getJson<{
                                hits: { slug: string; title: string; icon_url: string | null }[]
                        }>(`${MODRINTH_API}/search?${params}`)
                        const hit = data.hits?.[0]
                        if (!hit?.icon_url) return null
                        const normalized = hit.slug.toLowerCase().replace(/[-_]/g, '')
                        if (normalized !== slug.replace(/-/g, '') && !normalized.startsWith(slug.replace(/-/g, ''))) {
                                return null
                        }
                        rememberIcon(serverId, filename, hit.icon_url)
                        return hit.icon_url
                } catch {
                        return null
                } finally {
                        missingIcons.delete(iconKey(serverId, filename))
                }
        })()
        missingIcons.set(iconKey(serverId, filename), task)
        return task
}
