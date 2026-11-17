export type ActiveProvider = 'microsoft' | 'ely_by' | 'offline'

export type ActiveAccountRef = {
	provider: ActiveProvider
	id: string
}

const STORE_KEY = 'portalrinth-active-account'
export const ACTIVE_ACCOUNT_EVENT = 'portalrinth:active-account'

export function readActiveAccount(): ActiveAccountRef | null {
	try {
		const raw = localStorage.getItem(STORE_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw) as ActiveAccountRef
		if (!parsed?.id) return null
		if (!['microsoft', 'ely_by', 'offline'].includes(parsed.provider)) return null
		return parsed
	} catch {
		return null
	}
}

export function writeActiveAccount(next: ActiveAccountRef | null): void {
	const prev = readActiveAccount()
	try {
		if (next) localStorage.setItem(STORE_KEY, JSON.stringify(next))
		else localStorage.removeItem(STORE_KEY)
	} catch {
		return
	}
	if (prev?.provider === next?.provider && prev?.id === next?.id) return
	window.dispatchEvent(new CustomEvent(ACTIVE_ACCOUNT_EVENT, { detail: next }))
}

export function sameUuid(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false
	return a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase()
}
