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
	noAnswerText: () => string
	lostText: () => string
	busyText: () => string
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
let startedAt = 0
let localStream: MediaStream | null = null
let ice: RTCConfiguration = ICE_FALLBACK
let iceAt = 0
let dmPc: RTCPeerConnection | null = null
let pendingIce: RTCIceCandidateInit[] = []
let ringTimer: ReturnType<typeof setTimeout> | null = null
let connectTimer: ReturnType<typeof setTimeout> | null = null
let dropTimer: ReturnType<typeof setTimeout> | null = null
let restarting = false
let isCaller = false

const RING_TIMEOUT = 45_000
const CONNECT_TIMEOUT = 25_000
const DROP_GRACE = 6_000

export function initMessengerCall(h: CallHost): void {
	host = h
}

export function getCallState(): {
	phase: CallPhase
	muted: boolean
	conversationId: string | null
	peerId: string | null
	peerName: string
	startedAt: number
} {
	return { phase, muted, conversationId, peerId, peerName, startedAt }
}

function touch(): void {
	host?.onChange()
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
	if (timer) clearTimeout(timer)
	return null
}

function asSdp(raw: unknown): RTCSessionDescriptionInit | null {
	let value = raw
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value)
		} catch {
			return null
		}
	}
	if (!value || typeof value !== 'object') return null
	const obj = value as Record<string, unknown>
	const sdp = typeof obj.sdp === 'string' ? obj.sdp : ''
	const type =
		obj.type === 'offer' || obj.type === 'answer' || obj.type === 'pranswer' ? obj.type : null
	if (!sdp || !type) return null
	return { type, sdp }
}

function asIce(raw: unknown): RTCIceCandidateInit | null {
	if (typeof raw === 'string') {
		try {
			return asIce(JSON.parse(raw))
		} catch {
			return null
		}
	}
	if (!raw || typeof raw !== 'object') return null
	const obj = raw as Record<string, unknown>
	if (obj.candidate && typeof obj.candidate === 'object') return asIce(obj.candidate)
	const candidate = typeof obj.candidate === 'string' ? obj.candidate : ''
	if (!candidate) return null
	return {
		candidate,
		sdpMid: obj.sdpMid == null ? null : String(obj.sdpMid),
		sdpMLineIndex: obj.sdpMLineIndex == null ? null : Number(obj.sdpMLineIndex),
	}
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
	if (el.srcObject !== stream) el.srcObject = stream
	void el.play().catch(() => undefined)
}

function stopRemote(userId: string): void {
	const el = document.getElementById(`portalrinth-call-audio-${userId}`) as HTMLAudioElement | null
	if (!el) return
	el.srcObject = null
	el.remove()
}

/** TURN-пароль живёт около часа, поэтому конфиг берём свежий на каждый звонок. */
async function ensureIce(force = false): Promise<void> {
	if (!force && iceAt && Date.now() - iceAt < 4 * 60 * 1000) return
	try {
		const res = await host?.req('/rtc-config')
		const data = res?.data as {
			iceServers?: RTCIceServer[]
			config?: { iceServers?: RTCIceServer[] }
		}
		const servers = data?.iceServers || data?.config?.iceServers
		if (res?.ok && Array.isArray(servers) && servers.length) {
			ice = { iceServers: servers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' }
			iceAt = Date.now()
		}
	} catch {
		ice = ICE_FALLBACK
	}
}

async function ensureMic(): Promise<MediaStream> {
	if (localStream) return localStream
	const audio: MediaTrackConstraints = {
		echoCancellation: true,
		noiseSuppression: true,
		autoGainControl: true,
		channelCount: 1,
		sampleRate: 48000,
	}
	try {
		localStream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
	} catch {
		try {
			localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
		} catch {
			host?.toast(host.micDeniedText())
			throw new Error('mic')
		}
	}
	applyMute()
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

async function tuneSender(sender: RTCRtpSender): Promise<void> {
	try {
		const params = sender.getParameters()
		if (!params.encodings?.length) params.encodings = [{}]
		params.encodings[0].maxBitrate = 64_000
		params.encodings[0].priority = 'high'
		params.encodings[0].networkPriority = 'high'
		await sender.setParameters(params)
	} catch {
		return
	}
}

/** Opus с FEC и DTX держит голос при потерях пакетов вместо обрывов. */
function tuneOpus(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
	if (!desc.sdp) return desc
	const match = desc.sdp.match(/a=rtpmap:(\d+) opus\/48000/i)
	if (!match) return desc
	const pt = match[1]
	const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`)
	const extra = 'useinbandfec=1;usedtx=1;stereo=0;maxaveragebitrate=64000'
	let sdp = desc.sdp
	if (fmtp.test(sdp)) {
		sdp = sdp.replace(fmtp, (_line, current: string) => {
			const kept = current
				.split(';')
				.filter((part) => !/^(useinbandfec|usedtx|stereo|maxaveragebitrate)=/.test(part.trim()))
			return `a=fmtp:${pt} ${[...kept, extra].filter(Boolean).join(';')}`
		})
	} else {
		sdp = sdp.replace(match[0], `${match[0]}\r\na=fmtp:${pt} ${extra}`)
	}
	return { type: desc.type, sdp }
}

async function flushIce(pc: RTCPeerConnection): Promise<void> {
	const queued = pendingIce
	pendingIce = []
	for (const candidate of queued) {
		await pc.addIceCandidate(candidate).catch(() => undefined)
	}
}

function markActive(): void {
	connectTimer = clearTimer(connectTimer)
	dropTimer = clearTimer(dropTimer)
	restarting = false
	if (phase === 'active') return
	phase = 'active'
	startedAt = Date.now()
	touch()
}

function armConnectTimeout(): void {
	connectTimer = clearTimer(connectTimer)
	connectTimer = setTimeout(() => {
		if (phase !== 'connecting') return
		host?.toast(host.failedText())
		void hangupCall()
	}, CONNECT_TIMEOUT)
}

async function restartIce(): Promise<void> {
	const pc = dmPc
	const target = peerId
	if (!pc || !target || restarting || pc.signalingState !== 'stable') return
	restarting = true
	try {
		await ensureIce(true)
		pc.setConfiguration(ice)
		const offer = tuneOpus(await pc.createOffer({ iceRestart: true }))
		await pc.setLocalDescription(offer)
		await signal({ type: 'call_sdp_offer', toUserId: target, sdp: offer })
	} catch {
		restarting = false
	}
}

function onLinkState(pc: RTCPeerConnection): void {
	if (pc !== dmPc) return
	const state = pc.connectionState
	const iceState = pc.iceConnectionState
	if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
		markActive()
		return
	}
	if (state === 'failed' || iceState === 'failed') {
		if (phase === 'active' && isCaller) {
			void restartIce()
			dropTimer = clearTimer(dropTimer)
			dropTimer = setTimeout(() => {
				if (dmPc?.connectionState === 'connected') return
				host?.toast(host.lostText())
				void hangupCall()
			}, DROP_GRACE * 2)
			return
		}
		host?.toast(phase === 'active' ? host.lostText() : host.failedText())
		void hangupCall()
		return
	}
	if (state === 'disconnected' || iceState === 'disconnected') {
		if (dropTimer) return
		dropTimer = setTimeout(() => {
			dropTimer = null
			if (!dmPc || dmPc.connectionState === 'connected') return
			if (isCaller) void restartIce()
		}, DROP_GRACE)
	}
}

async function makePc(remoteId: string): Promise<RTCPeerConnection> {
	const pc = new RTCPeerConnection(ice)
	const mic = await ensureMic()
	for (const track of mic.getAudioTracks()) {
		void tuneSender(pc.addTrack(track, mic))
	}
	pc.onicecandidate = (event) => {
		if (event.candidate) {
			void signal({ type: 'call_ice', toUserId: remoteId, candidate: event.candidate.toJSON() })
		}
	}
	pc.ontrack = (event) => {
		playRemote(remoteId, event.streams[0] || new MediaStream([event.track]))
	}
	pc.onconnectionstatechange = () => onLinkState(pc)
	pc.oniceconnectionstatechange = () => onLinkState(pc)
	return pc
}

async function signal(body: Record<string, unknown>): Promise<boolean> {
	if (!host || !conversationId) return false
	const res = await host
		.req(`/conversations/${encodeURIComponent(conversationId)}/signals`, {
			method: 'POST',
			body: { channelId: null, sdp: null, candidate: null, ...body },
		})
		.catch(() => null)
	return Boolean(res?.ok)
}

function reset(): void {
	ringTimer = clearTimer(ringTimer)
	connectTimer = clearTimer(connectTimer)
	dropTimer = clearTimer(dropTimer)
	if (dmPc) {
		dmPc.onicecandidate = null
		dmPc.ontrack = null
		dmPc.onconnectionstatechange = null
		dmPc.oniceconnectionstatechange = null
		dmPc.close()
	}
	dmPc = null
	pendingIce = []
	restarting = false
	isCaller = false
	if (peerId) stopRemote(peerId)
	stopMic()
	phase = 'idle'
	muted = false
	startedAt = 0
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
	isCaller = true
	phase = 'outgoing'
	touch()
	await ensureIce(true)
	try {
		await ensureMic()
	} catch {
		reset()
		return
	}
	const ok = await signal({ type: 'call_ring', toUserId: targetId, username: host.me()?.username })
	if (!ok) {
		host.toast(host.failedText())
		reset()
		return
	}
	ringTimer = setTimeout(() => {
		if (phase !== 'outgoing') return
		host?.toast(host.noAnswerText())
		void hangupCall()
	}, RING_TIMEOUT)
}

export async function acceptIncoming(): Promise<void> {
	if (!host || phase !== 'incoming' || !peerId) return
	ringTimer = clearTimer(ringTimer)
	phase = 'connecting'
	touch()
	await ensureIce(true)
	try {
		dmPc = await makePc(peerId)
	} catch {
		await declineIncoming()
		return
	}
	armConnectTimeout()
	const ok = await signal({ type: 'call_answer', toUserId: peerId })
	if (!ok) {
		host.toast(host.failedText())
		reset()
	}
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

export async function handleCallSignal(
	msg: CallSignal & { reason?: string; username?: string },
): Promise<void> {
	if (!host || !msg?.type || !msg.fromUserId) return
	const mine = host.me()?.id || ''
	const from = String(msg.fromUserId)
	if (from === String(mine)) return
	const type = msg.type

	if (type === 'call_ring') {
		if (phase !== 'idle') {
			if (from === peerId) return
			const prev = conversationId
			conversationId = msg.conversationId
			await signal({ type: 'call_reject', toUserId: from, reason: 'busy' })
			conversationId = prev
			return
		}
		conversationId = msg.conversationId
		peerId = from
		peerName = msg.fromUsername || msg.username || ''
		isCaller = false
		phase = 'incoming'
		touch()
		ringTimer = setTimeout(() => {
			if (phase === 'incoming') reset()
		}, RING_TIMEOUT)
		return
	}

	if (from !== peerId) return

	if (type === 'call_reject') {
		if (msg.reason === 'busy') host.toast(host.busyText())
		reset()
		return
	}
	if (type === 'call_hangup') {
		reset()
		return
	}

	if (type === 'call_answer' && phase === 'outgoing') {
		ringTimer = clearTimer(ringTimer)
		phase = 'connecting'
		touch()
		armConnectTimeout()
		try {
			dmPc = await makePc(from)
			const offer = tuneOpus(await dmPc.createOffer({ offerToReceiveAudio: true }))
			await dmPc.setLocalDescription(offer)
			await signal({ type: 'call_sdp_offer', toUserId: from, sdp: offer })
		} catch {
			host.toast(host.failedText())
			await hangupCall()
		}
		return
	}

	if (type === 'call_sdp_offer') {
		const desc = asSdp(msg.sdp)
		if (!desc) return
		if (!dmPc) {
			if (phase === 'incoming') reset()
			return
		}
		try {
			await dmPc.setRemoteDescription(desc)
			await flushIce(dmPc)
			const answer = tuneOpus(await dmPc.createAnswer())
			await dmPc.setLocalDescription(answer)
			await signal({ type: 'call_sdp_answer', toUserId: from, sdp: answer })
		} catch {
			host.toast(host.failedText())
			await hangupCall()
		}
		return
	}

	if (type === 'call_sdp_answer' && dmPc) {
		const desc = asSdp(msg.sdp)
		if (!desc || dmPc.signalingState !== 'have-local-offer') return
		try {
			await dmPc.setRemoteDescription(desc)
			await flushIce(dmPc)
			restarting = false
		} catch {
			host.toast(host.failedText())
			await hangupCall()
		}
		return
	}

	if (type === 'call_ice') {
		const candidate = asIce(msg.candidate)
		if (!candidate) return
		if (!dmPc || !dmPc.remoteDescription) {
			pendingIce.push(candidate)
			return
		}
		await dmPc.addIceCandidate(candidate).catch(() => undefined)
	}
}
