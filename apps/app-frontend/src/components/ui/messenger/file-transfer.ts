import { reactive } from 'vue'

import { serviceRequest } from '@/helpers/uprojects-service'

import { dmWith, myId } from './store'

/**
 * Большие файлы идут напрямую между клиентами Portalrinth, минуя тело
 * сообщения: сервер получает только маленькую обёртку-вложение (размер
 * честно «сплющен» до 11 МБ — настоящий размер видят только наши клиенты),
 * а сами байты едут по сигнальному каналу личного чата кусочками — тем же
 * путём, которым расходятся карточки профилей и ICE-кандидаты звонков.
 *
 * Протокол (candidate.portalrinth):
 *  - xfer_start { id, name, mime, size, total } — метаданные и число кусков;
 *  - xfer_chunk { id, i, d }                    — кусок base64;
 *  - xfer_end   { id }                          — передача окончена;
 *  - xfer_req   { id, missing? }                — запросить куски заново;
 *  - xfer_gone  { id }                          — у отправителя больше нет файла.
 */

/** Файлы больше этого размера едут через сигнальный канал, а не в теле сообщения. */
export const XFER_THRESHOLD = 10 * 1024 * 1024

/** Какой размер «видит» сервер и чужие клиенты. */
export const XFER_DISPLAY_CAP = 11 * 1024 * 1024

/** Кусок: 43680 символов base64 = 32760 байт файла на один сигнал. */
const CHUNK_QUAD = 43680
const MAX_RESEND = 400
const WAIT_STEP = 500
const WAIT_LIMIT = 120_000

export type IncomingXfer = {
	id: string
	name: string
	mime: string
	size: number
	total: number
	fromUserId: string
	got: number
	done: boolean
	failed: boolean
	url: string
	chunks: Map<number, string>
}

export type OutgoingXfer = {
	id: string
	name: string
	mime: string
	size: number
	base64: string
	total: number
	chunks: string[] | null
	done: boolean
	failed: boolean
}

export const xferState = reactive({
	incoming: {} as Record<string, IncomingXfer>,
	outgoing: {} as Record<string, OutgoingXfer>,
})

const KEEP_COMPLETED = 2

function prune(kind: 'incoming' | 'outgoing'): void {
	const store = xferState[kind]
	const ids = Object.keys(store)
	if (ids.length <= KEEP_COMPLETED + 2) return
	for (const id of ids) {
		const rec = store[id]
		const finished = kind === 'incoming' ? rec.done || rec.failed : rec.done || rec.failed
		if (finished && ids.length > KEEP_COMPLETED + 2) {
			if (kind === 'incoming' && rec.url) URL.revokeObjectURL(rec.url)
			Reflect.deleteProperty(store, id)
		}
	}
}

let seq = 0

function newId(): string {
	seq += 1
	return `x${Date.now().toString(36)}${seq.toString(36)}`
}

/** Регистрируем исходящий файл: режем base64 на куски, возвращаем id и «размер для сервера». */
export function registerOutgoing(
	base64: string,
	name: string,
	mime: string,
	size: number,
): { id: string; displaySize: number } {
	const chunks: string[] = []
	for (let i = 0; i < base64.length; i += CHUNK_QUAD) chunks.push(base64.slice(i, i + CHUNK_QUAD))
	const id = newId()
	xferState.outgoing[id] = {
		id,
		name: String(name || 'file').slice(0, 120),
		mime: String(mime || 'application/octet-stream'),
		size: Math.max(0, Math.round(size)),
		base64,
		total: chunks.length,
		chunks,
		done: false,
		failed: false,
	}
	prune('outgoing')
	return { id, displaySize: Math.min(Math.max(0, Math.round(size)), XFER_DISPLAY_CAP) }
}

function decodeChunk(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4)
	const bin = atob(s + pad)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return bytes
}

// --- IndexedDB: полученные файлы переживают перезапуск лаунчера ---

const DB_NAME = 'portalrinth-messenger-xfer'
const DB_STORE = 'files'

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1)
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE)
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('idb_open'))
	})
}

async function idbPut(id: string, blob: Blob): Promise<void> {
	try {
		const db = await openDb()
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(DB_STORE, 'readwrite')
			tx.objectStore(DB_STORE).put(blob, id)
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error ?? new Error('idb_put'))
		})
		db.close()
	} catch {
		/* без базы файл останется только в памяти текущей сессии */
	}
}

async function idbGet(id: string): Promise<Blob | null> {
	try {
		const db = await openDb()
		const blob = await new Promise<Blob | null>((resolve, reject) => {
			const tx = db.transaction(DB_STORE, 'readonly')
			const req = tx.objectStore(DB_STORE).get(id)
			req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
			req.onerror = () => reject(req.error ?? new Error('idb_get'))
		})
		db.close()
		return blob
	} catch {
		return null
	}
}

// --- отправка сигналов ---

async function sendSignal(peerId: string, payload: Record<string, unknown>): Promise<boolean> {
	const conv = dmWith(peerId)
	if (!conv) return false
	const res = await serviceRequest(`/conversations/${encodeURIComponent(conv.id)}/signals`, {
		method: 'POST',
		body: {
			type: 'call_ice',
			channelId: null,
			sdp: null,
			toUserId: peerId,
			candidate: payload,
		},
	}).catch(() => null)
	return Boolean(res?.ok)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Шлём куски параллельно в четыре потока, каждый с тремя попытками. */
async function pump(peerId: string, rec: OutgoingXfer, order?: number[]): Promise<void> {
	const chunks = rec.chunks
	if (!chunks || !order?.length) return
	let cursor = 0
	const missing: number[] = []
	const worker = async (): Promise<void> => {
		while (cursor < order.length) {
			const idx = order[cursor++]
			let ok = false
			for (let attempt = 0; attempt < 3 && !ok; attempt++) {
				ok = await sendSignal(peerId, {
					portalrinth: 'xfer_chunk',
					id: rec.id,
					i: idx,
					d: chunks[idx],
				})
				if (!ok) await sleep(400 * (attempt + 1))
			}
			if (!ok) missing.push(idx)
		}
	}
	await Promise.all([worker(), worker(), worker(), worker()])
	if (missing.length) await sendSignal(peerId, { portalrinth: 'xfer_gone', id: rec.id })
}

/** Запуск передачи другу: старт, куски, финиш. Ошибки сети не роняют чат. */
export async function startTransfer(peerId: string, id: string): Promise<void> {
	const rec = xferState.outgoing[id]
	if (!rec || !peerId || peerId === myId.value) return
	const started = await sendSignal(peerId, {
		portalrinth: 'xfer_start',
		id: rec.id,
		name: rec.name,
		mime: rec.mime,
		size: rec.size,
		total: rec.total,
	})
	if (!started) {
		rec.failed = true
		return
	}
	const order = rec.chunks ? rec.chunks.map((_, i) => i) : []
	await pump(peerId, rec, order)
	await sendSignal(peerId, { portalrinth: 'xfer_end', id: rec.id })
	rec.done = true
	prune('outgoing')
}

function parseCandidate(raw: unknown): Record<string, unknown> | null {
	if (raw && typeof raw === 'object') return raw as Record<string, unknown>
	if (typeof raw !== 'string') return null
	try {
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === 'object' ? parsed : null
	} catch {
		return null
	}
}

async function complete(rec: IncomingXfer): Promise<void> {
	const parts: Uint8Array[] = []
	for (let i = 0; i < rec.total; i++) {
		const chunk = rec.chunks.get(i)
		if (!chunk) return
		parts.push(decodeChunk(chunk))
	}
	const size = parts.reduce((sum, part) => sum + part.length, 0)
	const bytes = new Uint8Array(size)
	let offset = 0
	for (const part of parts) {
		bytes.set(part, offset)
		offset += part.length
	}
	const blob = new Blob([bytes], { type: rec.mime || 'application/octet-stream' })
	rec.url = URL.createObjectURL(blob)
	rec.chunks.clear()
	rec.done = true
	await idbPut(rec.id, blob)
	prune('incoming')
}

/** true — пакет наш и обработан, звонковому коду его передавать не нужно. */
export function handleXferSignal(data: Record<string, unknown>): boolean {
	if (data.type !== 'call_ice') return false
	const payload = parseCandidate(data.candidate)
	const kind = String(payload?.portalrinth ?? '')
	if (!payload || !kind.startsWith('xfer')) return false
	const from = String(data.fromUserId ?? '')
	if (!from || from === myId.value) return true
	const id = String(payload.id ?? '')

	if (kind === 'xfer_start') {
		xferState.incoming[id] = {
			id,
			name: String(payload.name ?? 'file').slice(0, 120),
			mime: String(payload.mime ?? 'application/octet-stream'),
			size: Number(payload.size) || 0,
			total: Math.max(1, Number(payload.total) || 1),
			fromUserId: from,
			got: 0,
			done: false,
			failed: false,
			url: '',
			chunks: new Map(),
		}
		prune('incoming')
		return true
	}

	if (kind === 'xfer_chunk') {
		const rec = xferState.incoming[id]
		const index = Number(payload.i)
		const chunk = typeof payload.d === 'string' ? payload.d : ''
		if (rec && Number.isInteger(index) && index >= 0 && index < rec.total && chunk) {
			if (!rec.chunks.has(index)) rec.got += 1
			rec.chunks.set(index, chunk)
			if (rec.got >= rec.total && !rec.done) void complete(rec)
		}
		return true
	}

	if (kind === 'xfer_end') {
		const rec = xferState.incoming[id]
		if (!rec) return true
		if (rec.got >= rec.total) {
			void complete(rec)
		} else {
			// Часть кусков не доехала — просим только недостающее.
			const missing: number[] = []
			for (let i = 0; i < rec.total && missing.length < MAX_RESEND; i++) {
				if (!rec.chunks.has(i)) missing.push(i)
			}
			void sendSignal(from, { portalrinth: 'xfer_req', id, missing })
		}
		return true
	}

	if (kind === 'xfer_req') {
		const rec = xferState.outgoing[id]
		if (!rec?.chunks) {
			void sendSignal(from, { portalrinth: 'xfer_gone', id })
			return true
		}
		const fresh = !Array.isArray(payload.missing)
		const raw = fresh
			? rec.chunks.map((_, i) => i)
			: payload.missing.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < rec.total)
		const order = raw.slice(0, MAX_RESEND)
		void (async () => {
			// Просьба «с нуля» бывает после перезапуска получателя — метаданных у него нет.
			if (fresh) {
				const ok = await sendSignal(from, {
					portalrinth: 'xfer_start',
					id: rec.id,
					name: rec.name,
					mime: rec.mime,
					size: rec.size,
					total: rec.total,
				})
				if (!ok) return
			}
			await pump(from, rec, order)
			await sendSignal(from, { portalrinth: 'xfer_end', id: rec.id })
		})()
		return true
	}

	if (kind === 'xfer_gone') {
		const rec = xferState.incoming[id]
		if (rec) rec.failed = true
		return true
	}

	return true
}

async function waitIncoming(id: string): Promise<IncomingXfer | null> {
	const deadline = Date.now() + WAIT_LIMIT
	while (Date.now() < deadline) {
		const rec = xferState.incoming[id]
		if (rec?.done) return rec
		if (rec?.failed) return null
		await sleep(WAIT_STEP)
	}
	return xferState.incoming[id]?.done ? (xferState.incoming[id] ?? null) : null
}

/** Собираем из своих же кусков (сам себе скачал), из готового входящего или просим у отправителя. */
export async function obtainXferBytes(id: string, senderId: string): Promise<Uint8Array | null> {
	const incoming = xferState.incoming[id]
	if (incoming?.done) {
		const blob = await idbGet(id)
		if (blob) return new Uint8Array(await blob.arrayBuffer())
	}
	const outgoing = xferState.outgoing[id]
	if (outgoing?.chunks) {
		const base = outgoing.chunks.join('')
		return decodeChunk(base)
	}
	if (!senderId || senderId === myId.value) return null
	if (!dmWith(senderId)) return null
	await sendSignal(senderId, { portalrinth: 'xfer_req', id })
	const rec = await waitIncoming(id)
	if (!rec) return null
	const blob = await idbGet(id)
	if (blob) return new Uint8Array(await blob.arrayBuffer())
	return null
}

/** Прогресс приёмки 0..1 — для полоски на карточке файла. */
export function xferProgress(id: string): number {
	const rec = xferState.incoming[id]
	if (!rec) return -1
	if (rec.done) return 1
	if (rec.total <= 0) return 0
	return Math.min(0.99, rec.got / rec.total)
}

/** Реактивная запись входящей передачи — карточка файла читает из неё статус. */
export function xferRecord(id: string): IncomingXfer | null {
	return xferState.incoming[id] ?? null
}

/** Локальный blob-адрес принятого файла — пусто, пока передача не доехала. */
export function xferUrl(id: string): string {
	return xferState.incoming[id]?.done ? (xferState.incoming[id]?.url ?? '') : ''
}

/** Настоящий размер: у получателя — из посылки, у отправителя — из своей регистрации. */
export function xferRealSize(id: string): number {
	const incoming = xferState.incoming[id]
	if (incoming?.size) return incoming.size
	const outgoing = xferState.outgoing[id]
	if (outgoing?.size) return outgoing.size
	return 0
}
