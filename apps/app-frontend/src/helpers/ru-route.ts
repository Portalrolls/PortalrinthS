/**
 * Обход блокировки картинок Modrinth.
 *
 * Провайдеры РФ режут Cloudflare и с осени 2026 сам Modrinth: иконки
 * проектов, галереи и обложки с cdn.modrinth.com не открываются, и страницы
 * стоят с пустыми квадратами. Сервис uprojects доступен и умеет отдавать эти
 * картинки через себя — если CDN недоступен напрямую, все <img> с него
 * перенаправляются туда.
 */
import { proxiedFetch } from './proxy-fetch'
import { relayImageUrl } from './uprojects-service'

const CDN_KEY = 'portalrinth:modrinth-cdn-blocked'
const API_KEY = 'portalrinth:modrinth-api-blocked'
const CDN_PROBE = 'https://cdn.modrinth.com/data/AANobbMI/icon.png'
const API_PROBE = 'https://api.modrinth.com/'

let relaying = false
let apiBlocked = false
let installed = false

/** api.modrinth.com не ответил на последней проверке — поиск идёт через каталог. */
export function isModrinthBlocked(): boolean {
	return apiBlocked
}

function rewrite(value: string): string {
	return relaying && typeof value === 'string' ? relayImageUrl(value) : value
}

function patchImages(): void {
	if (installed) return
	installed = true
	const proto = HTMLImageElement.prototype
	const descriptor = Object.getOwnPropertyDescriptor(proto, 'src')
	if (descriptor?.set && descriptor.get) {
		const { get, set } = descriptor
		Object.defineProperty(proto, 'src', {
			configurable: true,
			enumerable: descriptor.enumerable,
			get() {
				return get.call(this)
			},
			set(value: string) {
				set.call(this, rewrite(value))
			},
		})
	}
	const setAttribute = Element.prototype.setAttribute
	Element.prototype.setAttribute = function (name: string, value: string) {
		if (this instanceof HTMLImageElement && name.toLowerCase() === 'src') value = rewrite(value)
		return setAttribute.call(this, name, value)
	}
}

/** Уже отрисованные картинки, которые успели упасть до проверки. */
function retryBroken(): void {
	for (const image of Array.from(document.images)) {
		const current = image.getAttribute('src') || ''
		const next = relayImageUrl(current)
		if (next !== current) image.setAttribute('src', next)
	}
}

async function reachable(url: string): Promise<boolean> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 7000)
	try {
		const response = await proxiedFetch(url, {
			method: 'HEAD',
			connectTimeout: 5000,
			signal: controller.signal,
		})
		return response.status > 0 && response.status < 500
	} catch {
		return false
	} finally {
		clearTimeout(timer)
	}
}

export function installModrinthImageRoute(): void {
	if (typeof window === 'undefined') return
	patchImages()
	// Прошлый результат применяем сразу, чтобы первый экран не ждал проверки.
	relaying = localStorage.getItem(CDN_KEY) === '1'
	apiBlocked = localStorage.getItem(API_KEY) === '1'
	void reachable(CDN_PROBE).then((ok) => {
		relaying = !ok
		localStorage.setItem(CDN_KEY, ok ? '0' : '1')
		if (!ok) retryBroken()
	})
	void reachable(API_PROBE).then((ok) => {
		apiBlocked = !ok
		localStorage.setItem(API_KEY, ok ? '0' : '1')
	})
}
