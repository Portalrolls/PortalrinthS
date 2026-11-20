import { proxiedFetch } from '@/helpers/proxy-fetch'

export type LiveHandler = (name: string, data: Record<string, unknown>) => void

/**
 * Поток событий мессенджера. Вебвью не пускает EventSource к сервису (CSP),
 * поэтому поток читаем через тот же fetch, что и API, и разбираем SSE сами.
 * Возвращает функцию, которая закрывает поток насовсем.
 */
const STALE_MS = 90000
/** Поток, проживший меньше этого, считаем обрывом — иначе переподключения шли бы без паузы. */
const STABLE_MS = 20000

export function openLiveStream(
	url: string,
	onEvent: LiveHandler,
	onState: (open: boolean) => void,
): () => void {
	let closed = false
	let controller: AbortController | null = null
	let retries = 0
	let retryTimer: ReturnType<typeof setTimeout> | null = null
	let lastByte = 0
	let openedAt = 0

	/** Прокси иногда держит соединение открытым, но молчит — тогда рвём его сами. */
	const watchdog = setInterval(() => {
		if (controller && lastByte && Date.now() - lastByte > STALE_MS) controller.abort()
	}, 10000)

	function dispatch(block: string): void {
		let name = 'message'
		const data: string[] = []
		for (const line of block.split('\n')) {
			if (!line || line.startsWith(':')) continue
			const colon = line.indexOf(':')
			const field = colon < 0 ? line : line.slice(0, colon)
			const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
			if (field === 'event') name = value
			else if (field === 'data') data.push(value)
		}
		if (!data.length) return
		try {
			const parsed = JSON.parse(data.join('\n'))
			if (parsed && typeof parsed === 'object') onEvent(name, parsed as Record<string, unknown>)
		} catch {
			/* событие без JSON — пропускаем */
		}
	}

	async function run(): Promise<void> {
		controller = new AbortController()
		try {
			const response = await proxiedFetch(url, {
				headers: { Accept: 'text/event-stream', 'User-Agent': 'Undefined-Client' },
				signal: controller.signal,
				connectTimeout: 15000,
			})
			if (!response.ok || !response.body) throw new Error(`stream_${response.status}`)
			openedAt = Date.now()
			lastByte = openedAt
			onState(true)
			const reader = response.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ''
			while (!closed) {
				const { value, done } = await reader.read()
				if (done) break
				lastByte = Date.now()
				buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
				let split = buffer.indexOf('\n\n')
				while (split >= 0) {
					dispatch(buffer.slice(0, split))
					buffer = buffer.slice(split + 2)
					split = buffer.indexOf('\n\n')
				}
			}
		} catch {
			/* переподключимся ниже */
		}
		if (openedAt && Date.now() - openedAt >= STABLE_MS) retries = 0
		openedAt = 0
		lastByte = 0
		onState(false)
		if (closed) return
		retries += 1
		const delay = Math.min(10000, 1000 * 2 ** Math.min(retries - 1, 4))
		retryTimer = setTimeout(() => void run(), delay + Math.random() * 500)
	}

	void run()

	return () => {
		closed = true
		clearInterval(watchdog)
		if (retryTimer) clearTimeout(retryTimer)
		controller?.abort()
		onState(false)
	}
}
