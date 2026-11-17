import { proxiedFetch } from '@/helpers/proxy-fetch'
import { UPROJECTS_BASE } from '@/helpers/uprojects-service'

import { resolveNewsAssetUrl } from './feed'

/** Статья с сайта Undefined: та же лента, что во вкладке новостей их клиента. */
export type OfficialNews = {
	id: string
	title: string
	summary?: string
	content?: string
	cover?: string | null
	media?: { url?: string; type?: string; alt?: string }[]
	date?: string
	publishedAt?: string
	author?: string
	views?: number
}

const NEWS_API = `${UPROJECTS_BASE}/api/news`

const HEADERS = { 'User-Agent': 'Undefined-Client', Accept: 'application/json' }

function newsLang(locale: string): 'ru' | 'en' {
	return locale.startsWith('en') ? 'en' : 'ru'
}

export async function fetchOfficialNews(locale: string): Promise<OfficialNews[]> {
	const response = await proxiedFetch(`${NEWS_API}?lang=${newsLang(locale)}&limit=50`, {
		headers: HEADERS,
		connectTimeout: 12000,
	})
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	const data = (await response.json().catch(() => ({}))) as { posts?: OfficialNews[] }
	return Array.isArray(data.posts) ? data.posts : []
}

export async function fetchOfficialNewsPost(
	id: string,
	locale: string,
): Promise<OfficialNews | null> {
	const response = await proxiedFetch(
		`${NEWS_API}/${encodeURIComponent(id)}?lang=${newsLang(locale)}`,
		{ headers: HEADERS, connectTimeout: 12000 },
	)
	if (!response.ok) return null
	const data = (await response.json().catch(() => ({}))) as { post?: OfficialNews }
	return data.post ?? null
}

export async function noteOfficialNewsView(id: string): Promise<number | null> {
	try {
		const response = await proxiedFetch(`${NEWS_API}/${encodeURIComponent(id)}/view`, {
			method: 'POST',
			headers: HEADERS,
			connectTimeout: 8000,
		})
		if (!response.ok) return null
		const data = (await response.json().catch(() => ({}))) as { views?: number }
		const views = Number(data.views)
		return Number.isFinite(views) ? views : null
	} catch {
		return null
	}
}

export function officialNewsUrl(id: string): string {
	return `${UPROJECTS_BASE}/news/${encodeURIComponent(id)}`
}

export function officialCover(item: OfficialNews): string {
	return resolveNewsAssetUrl(item.cover)
}

export function officialDate(item: OfficialNews): string {
	return item.publishedAt || item.date || ''
}
