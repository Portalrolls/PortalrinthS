/**
 * Drop-in replacement for `fetch` from `@tauri-apps/plugin-http` that routes
 * requests through the proxy configured in Settings → Resource management
 * (`proxy_url`). Requests made from here pick a new proxy up at once; the
 * Rust side bakes it into its clients and needs an app restart.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { loggedFetch } from './portalrinth-connections'
import { get as getSettings } from './settings'

type TauriFetchInit = Parameters<typeof tauriFetch>[1] & {
	proxy?: { all: string }
}

let proxyUrlPromise: Promise<string | null> | null = null

function getProxyUrl(): Promise<string | null> {
	if (!proxyUrlPromise) {
		proxyUrlPromise = getSettings()
			.then((settings) => (settings as { proxy_url?: string | null }).proxy_url || null)
			.catch(() => null)
	}
	return proxyUrlPromise
}

/** Called by the settings page so a freshly typed proxy is used without a restart. */
export function applyProxyUrl(url: string | null): void {
	proxyUrlPromise = Promise.resolve(url?.trim() || null)
}

export async function currentProxyUrl(): Promise<string | null> {
	return getProxyUrl()
}

export async function proxiedFetch(
	input: Parameters<typeof tauriFetch>[0],
	init?: TauriFetchInit,
): Promise<Response> {
	const proxyUrl = await getProxyUrl()
	if (proxyUrl) {
		init = { ...init, proxy: { all: proxyUrl } }
	}
	return loggedFetch(input, init, () => tauriFetch(input, init))
}
