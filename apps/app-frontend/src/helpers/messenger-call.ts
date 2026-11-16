/**
 * Голос MC Messenger: личный звонок через сигналинг API сервиса.
 * Портировано с клиента Undefined Studio под наш serviceRequest.
 */

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'

export type CallSignal = {
	conversationId: string
	fromUserId: string
	fromUsername?: string
	type: string
	toUserId?: string | null
	sdp?: RTCSessionDescriptionInit | null
	candidate?: RTCIceCandidateInit | null
}

type ServiceResponse = {
	ok: boolean
	data?: Record<string, unknown>
}

type CallHost = {
	req: (path: string, opts?: { method?: string; body?: unknown }) => Promise<ServiceResponse>
	me: () => { id: string; username: string } | null
	onChange: () => void
	toast: (text: string) => void
	micDeniedText: () => string
	failedText: () => string
}

const ICE_FALLBACK: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

let host: CallHost | null = null
let phase: CallPhase = 'idle'
let muted = false
let conversationId: string | null = null
let peerId: string | null = null
let peerName = ''
let localStream: MediaStream | null = null
let ice: RTCConfiguration = ICE_FALLBACK
let dmPc: RTCPeerConnection | null = null
const pendingIce = new Map<string, RTCIceCandidateInit[]>()

export function initMessengerCall(h: CallHost): void {
	host = h
}

export function getCallState(): {
	phase: CallPhase
	muted: boolean
	conversationId: string | null
	peerId: string | null
	peerName: string
} {
	return { phase, muted, conversationId, peerId, peerName }
}

function touch(): void {
	host?.onChange()
}

function audioRoot(): HTMLElement {
	let root = document.getElementById('portalrinth-call-audio')
	if (!root) {
		root = document.createElement('div')
		root.id = 'portalrinth-call-audio'
		root.setAttribute('aria-hidden', 'true')
		root.style.position = 'fixed'
		root.style.left = '-9999px'
		root.style.width = '1px'
		root.style.height = '1px'
		document.body.appendChild(root)
	}
	return root
}

function playRemote(userId: string, stream: MediaStream): void {
	const id = `portalrinth-call-audio-${userId}`
	let el = document.getElementById(id) as HTMLAudioElement | null
	if (!el) {
		el = document.createElement('audio')
		el.id = id
		el.autoplay = true
		el.setAttribute('playsinline', '')
		audioRoot().appendChild(el)
	}
	el.srcObject = stream
	void el.play().catch(() => undefined)
}

function stopRemote(userId: string): void {
	const el = document.getElementById(`portalrinth-call-audio-${userId}`) as HTMLAudioElement | null
	if (!el) return
	el.srcObject = null
	el.remove()
}

async function ensureIce(): Promise<void> {
	try {
		const res = await host?.req('/rtc-config')
		const servers = (res?.data as { iceServers?: RTCIceServer[] } | undefined)?.iceServers
		if (res?.ok && Array.isArray(servers) && servers.length) ice = { iceServers: servers }
	} catch {
		ice = ICE_FALLBACK
	}
}

async function ensureMic(): Promise<MediaStream> {
	if (localStream) return localStream
	try {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
	} catch {
		host?.toast(host.micDeniedText())
		throw new Error('mic')
	}
	localStream.getAudioTracks().forEach((track) => {
		track.enabled = !muted
	})
	return localStream
}

function stopMic(): void {
	localStream?.getTracks().forEach((track) => track.stop())
	localStream = null
}

function applyMute(): void {
	localStream?.getAudioTracks().forEach((track) => {
		track.enabled = !muted
	})
}

async function flushIce(key: string, pc: RTCPeerConnection): Promise<void> {
	const queued = pendingIce.get(key) || []
	pendingIce.delete(key)
	for (const candidate of queued) {
		try {
			await pc.addIceCandidate(candidate)
		} catch {
			/* кандидат мог устареть */
		}
	}
}

function wirePc(
	pc: RTCPeerConnection,
	remoteId: string,
	sendIce: (candidate: RTCIceCandidateInit) => void,
): void {
	pc.onicecandidate = (event) => {
		if (event.candidate) sendIce(event.candidate.toJSON())
	}
	pc.ontrack = (event) => {
		const stream = event.streams[0]
		if (stream) playRemote(remoteId, stream)
		if (phase === 'connecting' || phase === 'outgoing') {
			phase = 'active'
			touch()
		}
	}
	pc.onconnectionstatechange = () => {
		if (pc.connectionState === 'connected' && (phase === 'connecting' || phase === 'outgoing')) {
			phase = 'active'
			touch()
		}
		if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
			stopRemote(remoteId)
		}
	}
}

async function makePc(
	remoteId: string,
	sendIce: (candidate: RTCIceCandidateInit) => void,
): Promise<RTCPeerConnection> {
	const pc = new RTCPeerConnection(ice)
	const mic = await ensureMic()
	mic.getTracks().forEach((track) => pc.addTrack(track, mic))
	wirePc(pc, remoteId, sendIce)
	return pc
}

async function signal(body: Record<string, unknown>): Promise<boolean> {
	if (!host || !conversationId) return false
	const res = await host.req(`/conversations/${encodeURIComponent(conversationId)}/signals`, {
		method: 'POST',
		body,
	})
	if (!res?.ok) {
		host.toast(host.failedText())
		return false
	}
	return true
}

function reset(): void {
	dmPc?.close()
	dmPc = null
	pendingIce.delete('dm')
	if (peerId) stopRemote(peerId)
	stopMic()
	phase = 'idle'
	muted = false
	conversationId = null
	peerId = null
	peerName = ''
	touch()
}

export async function startDmCall(convId: string, targetId: string, name: string): Promise<void> {
	if (!host || phase !== 'idle') return
	conversationId = convId
	peerId = targetId
	peerName = name
	phase = 'outgoing'
	touch()
	await ensureIce()
	const ok = await signal({ type: 'call_ring', toUserId: targetId })
	if (!ok) reset()
}

export async function acceptIncoming(): Promise<void> {
	if (!host || phase !== 'incoming' || !peerId) return
	phase = 'connecting'
	touch()
	await ensureIce()
	try {
		await ensureMic()
	} catch {
		await declineIncoming()
		return
	}
	const ok = await signal({ type: 'call_answer', toUserId: peerId })
	if (!ok) reset()
}

export async function declineIncoming(): Promise<void> {
	if (peerId && conversationId) await signal({ type: 'call_reject', toUserId: peerId })
	reset()
}

export async function hangupCall(): Promise<void> {
	if (peerId && conversationId && phase !== 'idle') {
		await signal({ type: 'call_hangup', toUserId: peerId })
	}
	reset()
}

export async function toggleCallMute(): Promise<void> {
	if (phase === 'idle' || phase === 'incoming') return
	muted = !muted
	applyMute()
	touch()
}

export async function handleCallSignal(msg: CallSignal): Promise<void> {
	if (!host || !msg?.type || !msg.fromUserId) return
	const mine = host.me()?.id || ''
	if (msg.fromUserId === mine) return
	const type = msg.type

	if (type === 'call_ring') {
		if (phase !== 'idle') {
			const prev = conversationId
			conversationId = msg.conversationId
			await signal({ type: 'call_reject', toUserId: msg.fromUserId })
			conversationId = prev
			return
		}
		conversationId = msg.conversationId
		peerId = msg.fromUserId
		peerName = msg.fromUsername || ''
		phase = 'incoming'
		touch()
		return
	}

	if (type === 'call_reject' || type === 'call_hangup') {
		if (peerId && msg.fromUserId !== peerId) return
		reset()
		return
	}

	if (type === 'call_answer' && phase === 'outgoing' && msg.fromUserId === peerId) {
		phase = 'connecting'
		touch()
		try {
			await ensureIce()
			const pc = await makePc(msg.fromUserId, (candidate) => {
				void signal({ type: 'call_ice', toUserId: msg.fromUserId, candidate })
			})
			dmPc = pc
			const offer = await pc.createOffer()
			await pc.setLocalDescription(offer)
			await signal({ type: 'call_sdp_offer', toUserId: msg.fromUserId, sdp: offer })
		} catch {
			await hangupCall()
		}
		return
	}

	if (type === 'call_sdp_offer' && msg.sdp && msg.fromUserId === peerId) {
		try {
			await ensureIce()
			if (!dmPc) {
				dmPc = await makePc(msg.fromUserId, (candidate) => {
					void signal({ type: 'call_ice', toUserId: msg.fromUserId, candidate })
				})
			}
			await dmPc.setRemoteDescription(msg.sdp)
			await flushIce('dm', dmPc)
			const answer = await dmPc.createAnswer()
			await dmPc.setLocalDescription(answer)
			await signal({ type: 'call_sdp_answer', toUserId: msg.fromUserId, sdp: answer })
			phase = 'connecting'
			touch()
		} catch {
			await hangupCall()
		}
		return
	}

	if (type === 'call_sdp_answer' && msg.sdp && dmPc && msg.fromUserId === peerId) {
		await dmPc.setRemoteDescription(msg.sdp)
		await flushIce('dm', dmPc)
		return
	}

	if (type === 'call_ice' && msg.candidate && msg.fromUserId === peerId) {
		if (!dmPc || !dmPc.remoteDescription) {
			const list = pendingIce.get('dm') || []
			list.push(msg.candidate)
			pendingIce.set('dm', list)
			return
		}
		try {
			await dmPc.addIceCandidate(msg.candidate)
		} catch {
			/* ignore */
		}
	}
}
