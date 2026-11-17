/**
 * Pixi Agent — модели Undefined Client (uprojects.site), отдельный провайдер
 * ассистента. Сервер тот же, что у их лаунчера: вход по сессии сервиса
 * (аккаунт Microsoft или Ely.by), ответ приходит потоком SSE с событиями
 * delta / done / error. Все четыре модели доступны в выборе без ограничений;
 * если сервер Undefined сам не выдал доступ, игрок видит причину словами.
 */
import { ref } from 'vue'

import { proxiedFetch } from './proxy-fetch'
import {
	ensureServiceSession,
	forgetServiceSession,
	onServiceAccountChange,
	readAccountState,
	UPROJECTS_BASE,
	UPROJECTS_BASE_EU,
} from './uprojects-service'

/** Версия клиента Undefined, с которой сервер принимает запросы Pixi. */
const PIXI_CLIENT_VERSION = '1.0.9-beta'

export type PixiTone = 'lite' | 'pro' | 'ultra' | 'flash'

export interface PixiModel {
	id: string
	tier: string
	family: string
	tone: PixiTone
	description: string
	/** Модель смотрит приложенные картинки. */
	vision: boolean
	/** Pro, Ultra и Flash у Undefined живут на европейском входе. */
	edge: 'main' | 'eu'
}

export const PIXI_MODELS: PixiModel[] = [
	{
		id: 'pixi-2.0-lite',
		tier: 'Lite',
		family: 'Pixi 2.0',
		tone: 'lite',
		description: 'Быстрые ответы и повседневные задачи, видит картинки',
		vision: true,
		edge: 'main',
	},
	{
		id: 'pixi-2.0-pro',
		tier: 'Pro',
		family: 'Pixi 2.0',
		tone: 'pro',
		description: 'Умнее и внимательнее к деталям, видит картинки',
		vision: true,
		edge: 'eu',
	},
	{
		id: 'pixi-2.0-ultra',
		tier: 'Ultra',
		family: 'Pixi 2.0',
		tone: 'ultra',
		description: 'Самая сильная: длинные сборки и сложные разборы',
		vision: false,
		edge: 'eu',
	},
	{
		id: 'pixi-2.1-flash',
		tier: 'Flash',
		family: 'Pixi 2.1',
		tone: 'flash',
		description: 'Новая быстрая модель для коротких вопросов',
		vision: false,
		edge: 'eu',
	},
]

export function pixiModelById(id: string | undefined): PixiModel | undefined {
	return PIXI_MODELS.find((model) => model.id === id)
}

export type PixiAccess =
	| { state: 'checking' }
	| { state: 'open' }
	| { state: 'no_account'; offline: boolean }
	| { state: 'denied'; application: 'none' | 'pending' | 'rejected' }
	| { state: 'error'; message: string }

/** Последний известный доступ к Pixi: панель моделей показывает его словами. */
export const pixiAccess = ref<PixiAccess>({ state: 'checking' })

interface PixiStatusResponse {
	configured?: boolean
	access?: boolean
	reason?: string
	models?: string[]
	application?: { status?: string }
	error?: string
}

function baseFor(model: PixiModel | undefined): string {
	return model?.edge === 'eu' ? UPROJECTS_BASE_EU : UPROJECTS_BASE
}

function pixiHeaders(token: string | null, accept: string): Record<string, string> {
	const headers: Record<string, string> = {
		'User-Agent': 'Undefined-Client',
		Accept: accept,
		'Content-Type': 'application/json',
		'X-Client-Version': PIXI_CLIENT_VERSION,
	}
	if (token) headers.Authorization = `Bearer ${token}`
	return headers
}

async function noAccountAccess(): Promise<PixiAccess> {
	const state = await readAccountState().catch(() => ({ kind: 'none' as const }))
	return { state: 'no_account', offline: state.kind === 'offline' }
}

function applicationOf(status: PixiStatusResponse): 'none' | 'pending' | 'rejected' {
	const raw = String(status.application?.status || 'none')
	return raw === 'pending' ? 'pending' : raw === 'rejected' ? 'rejected' : 'none'
}

/** Спрашивает сервер Undefined, пускает ли он текущий аккаунт к Pixi. */
export async function refreshPixiAccess(): Promise<PixiAccess> {
	pixiAccess.value = { state: 'checking' }
	const session = await ensureServiceSession()
	if (!session) {
		pixiAccess.value = await noAccountAccess()
		return pixiAccess.value
	}
	try {
		const response = await proxiedFetch(`${UPROJECTS_BASE}/api/ai/status`, {
			headers: pixiHeaders(session.token, 'application/json'),
			connectTimeout: 12000,
		})
		const data = (await response.json().catch(() => ({}))) as PixiStatusResponse
		if (!response.ok) {
			pixiAccess.value = { state: 'error', message: data.error || `HTTP ${response.status}` }
		} else if (data.access) {
			pixiAccess.value = { state: 'open' }
		} else if (data.reason === 'missing_auth' || data.reason === 'auth_unavailable') {
			forgetServiceSession()
			pixiAccess.value = await noAccountAccess()
		} else {
			pixiAccess.value = { state: 'denied', application: applicationOf(data) }
		}
	} catch (error) {
		pixiAccess.value = {
			state: 'error',
			message: error instanceof Error ? error.message : String(error),
		}
	}
	return pixiAccess.value
}

/** Заявка на доступ к Pixi — тот же путь, что у кнопки в Undefined Client. */
export async function applyForPixi(reason: string): Promise<{ ok: boolean; message?: string }> {
	const session = await ensureServiceSession()
	if (!session) {
		pixiAccess.value = await noAccountAccess()
		return { ok: false, message: 'Нужен вход в аккаунт Undefined (Microsoft или Ely.by)' }
	}
	try {
		const response = await proxiedFetch(`${UPROJECTS_BASE}/api/ai/apply`, {
			method: 'POST',
			headers: pixiHeaders(session.token, 'application/json'),
			body: JSON.stringify({ reason: reason.slice(0, 1000) }),
			connectTimeout: 12000,
		})
		const data = (await response.json().catch(() => ({}))) as { reason?: string; error?: string }
		if (!response.ok)
			return { ok: false, message: data.reason || data.error || `HTTP ${response.status}` }
		await refreshPixiAccess()
		return { ok: true }
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) }
	}
}

onServiceAccountChange(() => {
	pixiAccess.value = { state: 'checking' }
})

export interface PixiPayloadMessage {
	role: 'system' | 'user' | 'assistant'
	content: string | unknown[]
}

interface PixiWireMessage {
	role: 'user' | 'assistant'
	content: string
	images?: { mime: string; data: string }[]
}

const PIXI_MESSAGE_LIMIT = 7800
const PIXI_HISTORY_LIMIT = 46

function partsText(content: string | unknown[]): string {
	if (typeof content === 'string') return content
	return (content as { type?: string; text?: string }[])
		.filter((part) => part?.type === 'text')
		.map((part) => part.text ?? '')
		.join('\n')
}

function partsImages(content: string | unknown[]): { mime: string; data: string }[] {
	if (typeof content === 'string') return []
	const images: { mime: string; data: string }[] = []
	for (const part of content as { type?: string; image_url?: { url?: string } }[]) {
		const url = part?.type === 'image_url' ? String(part.image_url?.url || '') : ''
		const match = url.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i)
		if (!match) continue
		images.push({ mime: match[1] === 'image/png' ? 'image/png' : 'image/jpeg', data: match[2] })
		if (images.length >= 4) break
	}
	return images
}

function chunks(text: string, size: number): string[] {
	const out: string[] = []
	for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size))
	return out
}

/**
 * Сервер Pixi принимает только реплики игрока и ассистента и режет каждую до
 * восьми тысяч символов. Системная часть нашего промпта (инструменты
 * лаунчера, контекст сборки) поэтому уходит вводными репликами в начале, а
 * длинные сообщения делятся на куски, а не обрезаются молча.
 */
export function toPixiMessages(payload: PixiPayloadMessage[], vision: boolean): PixiWireMessage[] {
	const system = payload
		.filter((message) => message.role === 'system')
		.map((message) => partsText(message.content))
		.join('\n\n')
		.trim()
	const intro: PixiWireMessage[] = []
	if (system) {
		const parts = chunks(system, PIXI_MESSAGE_LIMIT - 64)
		parts.forEach((part, index) => {
			intro.push({
				role: 'user',
				content: `[Инструкции лаунчера Portalrinth ${index + 1}/${parts.length}]\n${part}`,
			})
		})
		intro.push({ role: 'assistant', content: 'Понял. Работаю по этим инструкциям.' })
	}
	const dialog: PixiWireMessage[] = []
	for (const message of payload) {
		if (message.role === 'system') continue
		const text = partsText(message.content).trim()
		const images = vision && message.role === 'user' ? partsImages(message.content) : []
		if (!text && !images.length) continue
		const pieces = text ? chunks(text, PIXI_MESSAGE_LIMIT) : ['']
		pieces.forEach((piece, index) => {
			const wire: PixiWireMessage = { role: message.role as 'user' | 'assistant', content: piece }
			if (images.length && index === pieces.length - 1) wire.images = images
			dialog.push(wire)
		})
	}
	const room = Math.max(8, PIXI_HISTORY_LIMIT - intro.length)
	let tail = dialog.slice(-room)
	while (tail.length > 1 && tail[0].role !== 'user') tail = tail.slice(1)
	return [...intro.slice(0, PIXI_HISTORY_LIMIT - tail.length), ...tail]
}

export class PixiError extends Error {
	status?: number
	code?: string
	partial?: string
	constructor(message: string, status?: number, code?: string) {
		super(message)
		this.name = 'PixiError'
		this.status = status
		this.code = code
	}
}

function deniedMessage(model: PixiModel | undefined, reason: string | undefined): string {
	const name = model ? `${model.family} ${model.tier}` : 'Pixi'
	if (reason === 'missing_auth' || reason === 'auth_unavailable') {
		return 'Pixi: нужен вход в аккаунт Undefined — выберите аккаунт Microsoft или Ely.by в карточке аккаунтов'
	}
	if (reason === 'model_locked' || reason === 'model_unavailable') {
		return `Pixi: сервер Undefined сейчас не отдаёт модель ${name} — выберите другую модель Pixi`
	}
	return `Pixi: сервер Undefined не выдал доступ к ${name} для этого аккаунта — подайте заявку в панели моделей`
}

async function readPixiStream(
	response: Response,
	onDelta: (chunk: string, full: string) => void,
	onActivity: () => void,
): Promise<{ reply: string; model?: string }> {
	const reader = response.body!.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let full = ''
	let done: { reply?: string; model?: string } | null = null
	const handle = (block: string) => {
		const line = block
			.split('\n')
			.map((row) => row.trim())
			.find((row) => row.startsWith('data:'))
		if (!line) return
		let event: {
			type?: string
			text?: string
			error?: string
			reply?: string
			model?: string
		} | null = null
		try {
			event = JSON.parse(line.slice(5).trim())
		} catch {
			return
		}
		if (!event) return
		if (event.type === 'delta' && event.text) {
			full += String(event.text)
			onDelta(String(event.text), full)
		} else if (event.type === 'done') {
			done = event
		} else if (event.type === 'error') {
			const failure = new PixiError(`Pixi: ${event.error || 'ошибка модели'}`)
			failure.partial = full
			throw failure
		}
	}
	for (;;) {
		const chunk = await reader.read()
		if (chunk.done) break
		onActivity()
		buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n')
		const blocks = buffer.split('\n\n')
		buffer = blocks.pop() ?? ''
		for (const block of blocks) handle(block)
	}
	if (buffer.trim()) handle(buffer)
	const finished = done as { reply?: string; model?: string } | null
	const reply = String(finished?.reply || full)
	if (!finished && full) {
		const cut = new PixiError('Pixi: поток оборвался до конца ответа')
		cut.partial = full
		throw cut
	}
	return { reply, model: finished?.model }
}

/**
 * Один запрос к Pixi. Возвращает текст ответа; дельты рисуются по мере
 * прихода. 401 один раз пересоздаёт сессию, остальные отказы сервера
 * превращаются в понятную фразу для чата.
 */
export async function callPixi(
	modelId: string,
	payload: PixiPayloadMessage[],
	options: {
		signal?: AbortSignal
		onDelta?: (chunk: string, full: string) => void
		onActivity?: () => void
	} = {},
): Promise<string> {
	const model = pixiModelById(modelId) ?? PIXI_MODELS[0]
	let session = await ensureServiceSession()
	if (!session) {
		pixiAccess.value = await noAccountAccess()
		throw new PixiError(deniedMessage(model, 'missing_auth'), 403, 'no_account')
	}
	const body = JSON.stringify({
		messages: toPixiMessages(payload, model.vision),
		model: model.id,
		clientVersion: PIXI_CLIENT_VERSION,
	})
	let response: Response | null = null
	for (let attempt = 0; attempt < 2; attempt++) {
		response = await proxiedFetch(`${baseFor(model)}/api/ai/chat/stream`, {
			method: 'POST',
			headers: pixiHeaders(session.token, 'text/event-stream'),
			body,
			signal: options.signal,
		})
		if (response.status !== 401 || attempt > 0) break
		forgetServiceSession()
		session = await ensureServiceSession(true)
		if (!session) {
			pixiAccess.value = await noAccountAccess()
			throw new PixiError(deniedMessage(model, 'missing_auth'), 401, 'no_account')
		}
	}
	if (!response) throw new PixiError('Pixi: сервер не ответил')
	const type = response.headers.get('content-type') || ''
	if (response.ok && type.includes('text/event-stream') && response.body) {
		const streamed = await readPixiStream(
			response,
			options.onDelta ?? (() => {}),
			options.onActivity ?? (() => {}),
		)
		pixiAccess.value = { state: 'open' }
		if (!streamed.reply.trim()) throw new PixiError('Pixi: пустой ответ')
		return streamed.reply
	}
	const data = (await response.json().catch(() => ({}))) as {
		reply?: string
		error?: string
		code?: string
		reason?: string
	}
	if (!response.ok) {
		if (response.status === 403 || data.code === 'access_denied') {
			if (data.reason === 'missing_auth' || data.reason === 'auth_unavailable') {
				forgetServiceSession()
				pixiAccess.value = await noAccountAccess()
			} else {
				void refreshPixiAccess()
			}
			throw new PixiError(deniedMessage(model, data.reason), 403, data.code || 'access_denied')
		}
		throw new PixiError(
			`Pixi: HTTP ${response.status}${data.error ? ` — ${String(data.error).slice(0, 200)}` : ''}`,
			response.status,
			data.code,
		)
	}
	const reply = String(data.reply || '')
	if (!reply.trim()) throw new PixiError('Pixi: пустой ответ')
	options.onDelta?.(reply, reply)
	return reply
}
