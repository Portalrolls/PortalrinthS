/**
 * Голосовые звонки MC Messenger поверх сигналинга сервиса.
 * Каждый собеседник — отдельное соединение со мной. Если в звонке больше
 * двух человек, я свожу голоса остальных в дорожку для каждого, поэтому
 * приглашённому не нужно соединяться со всеми: хватает связи со мной,
 * и так работает даже с обычным клиентом Undefined на той стороне.
 */
import {
	openMic,
	playSound,
	routeOutput,
	startLoop,
	stopLoop,
	voicePrefs,
} from '@/components/ui/messenger/devices'

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'

export type CallSignal = {
	conversationId: string
	fromUserId: string
	fromUsername?: string
	type: string
	toUserId?: string | null
	sdp?: RTCSessionDescriptionInit | null
	candidate?: RTCIceCandidateInit | Record<string, unknown> | null
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

type LegState = 'ringing' | 'incoming' | 'connecting' | 'active'

type Leg = {
	peerId: string
	peerName: string
	convId: string
	state: LegState
	caller: boolean
	pc: RTCPeerConnection | null
	sender: RTCRtpSender | null
	mix: MediaStreamAudioDestinationNode | null
	remote: MediaStream | null
	source: MediaStreamAudioSourceNode | null
	meter: AnalyserNode | null
	pendingIce: RTCIceCandidateInit[]
	restarting: boolean
	relayTried: boolean
	ringTimer: ReturnType<typeof setTimeout> | null
	connectTimer: ReturnType<typeof setTimeout> | null
	dropTimer: ReturnType<typeof setTimeout> | null
	roster: { id: string; name: string }[]
	relayedSpeaking: Record<string, boolean>
}

export type CallParticipant = {
	id: string
	name: string
	state: LegState
	speaking: boolean
	volume: number
	relayed: boolean
}

const ICE_FALLBACK: RTCConfiguration = {
	iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
}

const RING_TIMEOUT = 45_000
const CONNECT_TIMEOUT = 25_000
const DROP_GRACE = 6_000
const SPEAK_LEVEL = 0.035
const SPEAK_HOLD = 320

let host: CallHost | null = null
let ice: RTCConfiguration = ICE_FALLBACK
let iceAt = 0
let muted = false
let deafened = false
let startedAt = 0
let mic: MediaStream | null = null
let ctx: AudioContext | null = null
let micSource: MediaStreamAudioSourceNode | null = null
let micGain: GainNode | null = null
let micMeter: AnalyserNode | null = null
let meterTimer: ReturnType<typeof setInterval> | null = null
const legs = new Map<string, Leg>()
const speaking: Record<string, boolean> = {}
const speakingAt: Record<string, number> = {}
const volumes: Record<string, number> = {}

export function initMessengerCall(h: CallHost): void {
	host = h
}

function touch(): void {
	host?.onChange()
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
	if (timer) clearTimeout(timer)
	return null
}

function primaryLeg(): Leg | null {
	let best: Leg | null = null
	for (const leg of legs.values()) {
		if (leg.state === 'incoming' && legs.size === 1) return leg
		if (!best || rank(leg.state) > rank(best.state)) best = leg
	}
	return best
}

function rank(state: LegState): number {
	return state === 'active' ? 3 : state === 'connecting' ? 2 : state === 'ringing' ? 1 : 0
}

function phaseNow(): CallPhase {
	if (!legs.size) return 'idle'
	const states = [...legs.values()].map((leg) => leg.state)
	if (states.includes('active')) return 'active'
	if (states.includes('connecting')) return 'connecting'
	if (states.includes('ringing')) return 'outgoing'
	return 'incoming'
}

export function getCallState(): {
	phase: CallPhase
	muted: boolean
	deafened: boolean
	conversationId: string | null
	peerId: string | null
	peerName: string
	startedAt: number
	selfSpeaking: boolean
	participants: CallParticipant[]
	incoming: { peerId: string; peerName: string; convId: string } | null
} {
	const lead = primaryLeg()
	const participants: CallParticipant[] = []
	const seen = new Set<string>()
	const myId = host?.me()?.id || ''
	for (const leg of legs.values()) {
		if (leg.state === 'incoming') continue
		seen.add(leg.peerId)
		participants.push({
			id: leg.peerId,
			name: leg.peerName,
			state: leg.state,
			speaking: Boolean(speaking[leg.peerId]),
			volume: volumes[leg.peerId] ?? 100,
			relayed: false,
		})
	}
	for (const leg of legs.values()) {
		if (leg.state !== 'active') continue
		for (const entry of leg.roster) {
			if (!entry.id || entry.id === myId || seen.has(entry.id)) continue
			seen.add(entry.id)
			participants.push({
				id: entry.id,
				name: entry.name,
				state: 'active',
				speaking: Boolean(leg.relayedSpeaking[entry.id]),
				volume: 100,
				relayed: true,
			})
		}
	}
	const ringing = [...legs.values()].find((leg) => leg.state === 'incoming') ?? null
	return {
		phase: phaseNow(),
		muted,
		deafened,
		conversationId: lead?.convId ?? null,
		peerId: lead?.peerId ?? null,
		peerName: lead?.peerName ?? '',
		startedAt,
		selfSpeaking: Boolean(myId && speaking[myId]) && !muted,
		participants,
		incoming: ringing
			? { peerId: ringing.peerId, peerName: ringing.peerName, convId: ringing.convId }
			: null,
	}
}

export function isInCallWith(userId: string): boolean {
	const leg = legs.get(userId)
	return Boolean(leg && leg.state !== 'incoming')
}

export function asSdp(raw: unknown): RTCSessionDescriptionInit | null {
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

function parseObject(raw: unknown): Record<string, unknown> | null {
	if (typeof raw === 'string') {
		try {
			return parseObject(JSON.parse(raw))
		} catch {
			return null
		}
	}
	return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

export function asIce(raw: unknown): RTCIceCandidateInit | null {
	const obj = parseObject(raw)
	if (!obj) return null
	if (obj.candidate && typeof obj.candidate === 'object') return asIce(obj.candidate)
	const candidate = typeof obj.candidate === 'string' ? obj.candidate : ''
	if (!candidate) return null
	return {
		candidate,
		sdpMid: obj.sdpMid == null ? null : String(obj.sdpMid),
		sdpMLineIndex: obj.sdpMLineIndex == null ? null : Number(obj.sdpMLineIndex),
	}
}

export function audioRoot(): HTMLElement {
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

function remoteEl(userId: string): HTMLAudioElement | null {
	return document.getElementById(`portalrinth-call-audio-${userId}`) as HTMLAudioElement | null
}

function playRemote(userId: string, stream: MediaStream): void {
	let el = remoteEl(userId)
	if (!el) {
		el = document.createElement('audio')
		el.id = `portalrinth-call-audio-${userId}`
		el.autoplay = true
		el.dataset.msgrOutput = ''
		el.setAttribute('playsinline', '')
		audioRoot().appendChild(el)
	}
	if (el.srcObject !== stream) el.srcObject = stream
	el.muted = deafened
	const target = el
	void routeOutput(target).then(() => {
		target.volume = Math.min(1, ((volumes[userId] ?? 100) / 100) * (voicePrefs.outputVolume / 100))
		void target.play().catch(() => undefined)
	})
}

function stopRemote(userId: string): void {
	const el = remoteEl(userId)
	if (!el) return
	el.srcObject = null
	el.remove()
}

/** TURN-пароль живёт около часа, поэтому конфиг берём свежий на каждый звонок. */
async function ensureIce(force = false): Promise<void> {
	if (!force && iceAt && Date.now() - iceAt < 4 * 60 * 1000) return
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const res = await host?.req('/rtc-config')
			const data = res?.data as {
				iceServers?: RTCIceServer[]
				config?: { iceServers?: RTCIceServer[] }
			}
			const servers = data?.iceServers || data?.config?.iceServers
			if (res?.ok && Array.isArray(servers) && servers.length) {
				ice = {
					iceServers: [...servers, ...(ICE_FALLBACK.iceServers ?? [])],
					bundlePolicy: 'max-bundle',
					rtcpMuxPolicy: 'require',
					iceCandidatePoolSize: 2,
				}
				iceAt = Date.now()
				return
			}
		} catch {
			continue
		}
	}
	if (!iceAt) ice = ICE_FALLBACK
}

function audioContext(): AudioContext {
	if (!ctx || ctx.state === 'closed') ctx = new AudioContext()
	if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
	return ctx
}

async function ensureMic(): Promise<MediaStream> {
	if (mic) return mic
	try {
		mic = await openMic()
	} catch {
		host?.toast(host.micDeniedText())
		throw new Error('mic')
	}
	const audio = audioContext()
	micSource = audio.createMediaStreamSource(mic)
	micGain = audio.createGain()
	micMeter = audio.createAnalyser()
	micMeter.fftSize = 512
	micSource.connect(micGain)
	micGain.connect(micMeter)
	applyMute()
	startMeters()
	return mic
}

function applyMute(): void {
	if (micGain) micGain.gain.value = muted ? 0 : voicePrefs.inputGain / 100
	mic?.getAudioTracks().forEach((track) => {
		track.enabled = !muted
	})
}

const meterBuffer = new Uint8Array(512)

function levelOf(node: AnalyserNode): number {
	const buffer = meterBuffer
	node.getByteTimeDomainData(buffer)
	let sum = 0
	for (const value of buffer) {
		const centered = (value - 128) / 128
		sum += centered * centered
	}
	return Math.sqrt(sum / buffer.length)
}

function markSpeaking(id: string, level: number, now: number): boolean {
	if (level > SPEAK_LEVEL) speakingAt[id] = now
	const next = now - (speakingAt[id] ?? 0) < SPEAK_HOLD
	if (Boolean(speaking[id]) === next) return false
	speaking[id] = next
	return true
}

function startMeters(): void {
	if (meterTimer) return
	meterTimer = setInterval(() => {
		const now = Date.now()
		let changed = false
		const myId = host?.me()?.id || ''
		if (micMeter && myId) {
			if (markSpeaking(myId, muted ? 0 : levelOf(micMeter), now)) {
				changed = true
				shareSpeaking(myId)
			}
		}
		for (const leg of legs.values()) {
			if (!leg.meter) continue
			const level = deafened ? 0 : levelOf(leg.meter)
			if (markSpeaking(leg.peerId, level, now)) {
				changed = true
				shareSpeaking(leg.peerId)
			}
		}
		if (changed) touch()
	}, 90)
}

function stopMeters(): void {
	if (meterTimer) clearInterval(meterTimer)
	meterTimer = null
	for (const key of Object.keys(speaking)) Reflect.deleteProperty(speaking, key)
}

/** Сводим для каждого собеседника: мой голос и голоса остальных, кроме его собственного. */
function rewire(): void {
	if (!ctx || !micGain) return
	for (const leg of legs.values()) leg.source?.disconnect()
	micGain.disconnect()
	if (micMeter) micGain.connect(micMeter)
	for (const leg of legs.values()) {
		if (leg.source && leg.meter) leg.source.connect(leg.meter)
	}
	for (const leg of legs.values()) {
		if (!leg.mix) continue
		micGain.connect(leg.mix)
		for (const other of legs.values()) {
			if (other === leg || !other.source || other.state !== 'active') continue
			other.source.connect(leg.mix)
		}
	}
}

function attachRemote(leg: Leg, stream: MediaStream): void {
	leg.remote = stream
	playRemote(leg.peerId, stream)
	if (!ctx || !stream.getAudioTracks().length) return
	leg.source?.disconnect()
	leg.source = ctx.createMediaStreamSource(stream)
	leg.meter = ctx.createAnalyser()
	leg.meter.fftSize = 512
	rewire()
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
export function tuneOpus(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
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

async function flushIce(leg: Leg): Promise<void> {
	if (!leg.pc) return
	const queued = leg.pendingIce
	leg.pendingIce = []
	for (const candidate of queued) {
		await leg.pc.addIceCandidate(candidate).catch(() => undefined)
	}
}

async function signal(leg: Leg, body: Record<string, unknown>): Promise<boolean> {
	if (!host || !leg.convId) return false
	const res = await host
		.req(`/conversations/${encodeURIComponent(leg.convId)}/signals`, {
			method: 'POST',
			body: { channelId: null, sdp: null, candidate: null, toUserId: leg.peerId, ...body },
		})
		.catch(() => null)
	return Boolean(res?.ok)
}

/** Служебные пакеты едут в поле кандидата: чужой клиент такой кандидат просто пропускает. */
function shareRoster(): void {
	const me = host?.me()
	if (!me) return
	const active = [...legs.values()].filter((leg) => leg.state === 'active')
	for (const leg of active) {
		const members = [
			{ id: me.id, name: me.username },
			...active
				.filter((other) => other !== leg)
				.map((other) => ({ id: other.peerId, name: other.peerName })),
		]
		void signal(leg, { type: 'call_ice', candidate: { portalrinth: 'roster', members } })
	}
}

function shareSpeaking(id: string): void {
	if (legs.size < 2) return
	for (const leg of legs.values()) {
		if (leg.state !== 'active' || leg.peerId === id) continue
		void signal(leg, {
			type: 'call_ice',
			candidate: { portalrinth: 'speaking', id, on: Boolean(speaking[id]) },
		})
	}
}

function newLeg(
	peerId: string,
	peerName: string,
	convId: string,
	state: LegState,
	caller: boolean,
): Leg {
	return {
		peerId,
		peerName,
		convId,
		state,
		caller,
		pc: null,
		sender: null,
		mix: null,
		remote: null,
		source: null,
		meter: null,
		pendingIce: [],
		restarting: false,
		relayTried: false,
		ringTimer: null,
		connectTimer: null,
		dropTimer: null,
		roster: [],
		relayedSpeaking: {},
	}
}

function markActive(leg: Leg): void {
	leg.connectTimer = clearTimer(leg.connectTimer)
	leg.dropTimer = clearTimer(leg.dropTimer)
	leg.restarting = false
	if (leg.state === 'active') return
	leg.state = 'active'
	if (!startedAt) startedAt = Date.now()
	playSound('connect')
	rewire()
	shareRoster()
	touch()
}

function armConnectTimeout(leg: Leg): void {
	leg.connectTimer = clearTimer(leg.connectTimer)
	leg.connectTimer = setTimeout(() => {
		if (leg.state !== 'connecting') return
		host?.toast(host.failedText())
		void endLeg(leg.peerId, true)
	}, CONNECT_TIMEOUT)
}

async function restartIce(leg: Leg, relayOnly = false): Promise<void> {
	const pc = leg.pc
	if (!pc || leg.restarting || pc.signalingState !== 'stable') return
	leg.restarting = true
	try {
		await ensureIce(true)
		pc.setConfiguration(relayOnly ? { ...ice, iceTransportPolicy: 'relay' } : ice)
		const offer = tuneOpus(await pc.createOffer({ iceRestart: true }))
		await pc.setLocalDescription(offer)
		await signal(leg, { type: 'call_sdp_offer', sdp: offer })
	} catch {
		leg.restarting = false
	}
}

function onLinkState(leg: Leg, pc: RTCPeerConnection): void {
	if (leg.pc !== pc) return
	const state = pc.connectionState
	const iceState = pc.iceConnectionState
	if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
		markActive(leg)
		return
	}
	if (state === 'failed' || iceState === 'failed') {
		if (leg.caller && !leg.relayTried) {
			leg.relayTried = true
			leg.restarting = false
			void restartIce(leg, leg.state !== 'active')
			armConnectTimeout(leg)
			return
		}
		host?.toast(leg.state === 'active' ? host.lostText() : host.failedText())
		void endLeg(leg.peerId, true)
		return
	}
	if (state === 'disconnected' || iceState === 'disconnected') {
		if (leg.dropTimer) return
		leg.dropTimer = setTimeout(() => {
			leg.dropTimer = null
			if (!leg.pc || leg.pc.connectionState === 'connected') return
			if (leg.caller) void restartIce(leg)
			leg.dropTimer = setTimeout(() => {
				if (leg.pc?.connectionState === 'connected') return
				host?.toast(host.lostText())
				void endLeg(leg.peerId, true)
			}, DROP_GRACE * 2)
		}, DROP_GRACE)
	}
}

async function makePc(leg: Leg): Promise<RTCPeerConnection> {
	await ensureMic()
	const audio = audioContext()
	const pc = new RTCPeerConnection(ice)
	leg.mix = audio.createMediaStreamDestination()
	rewire()
	const track = leg.mix.stream.getAudioTracks()[0]
	leg.sender = pc.addTrack(track, leg.mix.stream)
	void tuneSender(leg.sender)
	pc.onicecandidate = (event) => {
		if (event.candidate) void signal(leg, { type: 'call_ice', candidate: event.candidate.toJSON() })
	}
	pc.ontrack = (event) => {
		attachRemote(leg, event.streams[0] || new MediaStream([event.track]))
	}
	pc.onconnectionstatechange = () => onLinkState(leg, pc)
	pc.oniceconnectionstatechange = () => onLinkState(leg, pc)
	leg.pc = pc
	return pc
}

function closeLeg(leg: Leg): void {
	leg.ringTimer = clearTimer(leg.ringTimer)
	leg.connectTimer = clearTimer(leg.connectTimer)
	leg.dropTimer = clearTimer(leg.dropTimer)
	if (leg.pc) {
		leg.pc.onicecandidate = null
		leg.pc.ontrack = null
		leg.pc.onconnectionstatechange = null
		leg.pc.oniceconnectionstatechange = null
		leg.pc.close()
	}
	leg.pc = null
	leg.source?.disconnect()
	leg.mix?.disconnect()
	leg.source = null
	leg.mix = null
	leg.meter = null
	stopRemote(leg.peerId)
	Reflect.deleteProperty(speaking, leg.peerId)
}

function shutdown(): void {
	for (const leg of legs.values()) closeLeg(leg)
	legs.clear()
	stopMeters()
	stopLoop()
	micSource?.disconnect()
	micGain?.disconnect()
	micSource = null
	micGain = null
	micMeter = null
	mic?.getTracks().forEach((track) => track.stop())
	mic = null
	if (ctx) void ctx.close().catch(() => undefined)
	ctx = null
	muted = false
	deafened = false
	startedAt = 0
}

async function endLeg(peerId: string, notify: boolean, reason?: string): Promise<void> {
	const leg = legs.get(peerId)
	if (!leg) return
	legs.delete(peerId)
	if (notify)
		await signal(leg, { type: leg.state === 'incoming' ? 'call_reject' : 'call_hangup', reason })
	closeLeg(leg)
	if (![...legs.values()].some((entry) => entry.state === 'ringing')) stopLoop('outgoing')
	if (![...legs.values()].some((entry) => entry.state === 'incoming')) stopLoop('incoming')
	if (![...legs.values()].some((entry) => entry.state !== 'incoming')) {
		const hadCall = leg.state === 'active' || startedAt > 0
		const pending = [...legs.values()].filter((entry) => entry.state === 'incoming')
		shutdown()
		for (const entry of pending) legs.set(entry.peerId, entry)
		if (pending.length) startLoop('incoming')
		playSound(hadCall ? 'hangup' : 'reject')
	} else {
		rewire()
		shareRoster()
	}
	touch()
}

async function ring(convId: string, targetId: string, name: string): Promise<boolean> {
	if (!host || legs.has(targetId)) return false
	const leg = newLeg(targetId, name, convId, 'ringing', true)
	legs.set(targetId, leg)
	touch()
	await ensureIce(true)
	try {
		await ensureMic()
	} catch {
		legs.delete(targetId)
		if (!legs.size) shutdown()
		touch()
		return false
	}
	const ok = await signal(leg, { type: 'call_ring', username: host.me()?.username })
	if (!ok || !legs.has(targetId)) {
		if (legs.has(targetId)) {
			host.toast(host.failedText())
			await endLeg(targetId, false)
		}
		return false
	}
	startLoop('outgoing')
	leg.ringTimer = setTimeout(() => {
		if (leg.state !== 'ringing') return
		host?.toast(host.noAnswerText())
		void endLeg(targetId, true)
	}, RING_TIMEOUT)
	return true
}

export async function startDmCall(convId: string, targetId: string, name: string): Promise<void> {
	if (phaseNow() !== 'idle') return
	await ring(convId, targetId, name)
}

/** Добавить друга в текущий звонок: звоним ему из нашей с ним переписки. */
export async function inviteToCall(
	convId: string,
	targetId: string,
	name: string,
): Promise<boolean> {
	const phase = phaseNow()
	if (phase === 'idle' || phase === 'incoming') return false
	return await ring(convId, targetId, name)
}

export async function acceptIncoming(): Promise<void> {
	const leg = [...legs.values()].find((entry) => entry.state === 'incoming')
	if (!host || !leg) return
	for (const other of [...legs.values()]) {
		if (other !== leg && other.state === 'incoming') await endLeg(other.peerId, true, 'busy')
	}
	leg.ringTimer = clearTimer(leg.ringTimer)
	stopLoop('incoming')
	leg.state = 'connecting'
	touch()
	await ensureIce(true)
	try {
		await makePc(leg)
	} catch {
		await endLeg(leg.peerId, true)
		return
	}
	armConnectTimeout(leg)
	const ok = await signal(leg, { type: 'call_answer' })
	if (!ok) {
		host.toast(host.failedText())
		await endLeg(leg.peerId, false)
	}
}

export async function declineIncoming(): Promise<void> {
	const leg = [...legs.values()].find((entry) => entry.state === 'incoming')
	if (leg) await endLeg(leg.peerId, true)
}

export async function hangupCall(): Promise<void> {
	const all = [...legs.values()]
	await Promise.all(
		all.map((leg) =>
			signal(leg, { type: leg.state === 'incoming' ? 'call_reject' : 'call_hangup' }),
		),
	)
	const hadCall = startedAt > 0
	shutdown()
	if (all.length) playSound(hadCall ? 'hangup' : 'reject')
	touch()
}

export async function dropFromCall(peerId: string): Promise<void> {
	await endLeg(peerId, true)
}

export async function toggleCallMute(): Promise<void> {
	const phase = phaseNow()
	if (phase === 'idle' || phase === 'incoming') return
	muted = !muted
	if (!muted && deafened) setDeafened(false)
	applyMute()
	touch()
}

function setDeafened(value: boolean): void {
	deafened = value
	for (const leg of legs.values()) {
		const el = remoteEl(leg.peerId)
		if (el) el.muted = deafened
	}
}

export function toggleCallDeafen(): void {
	if (phaseNow() === 'idle') return
	setDeafened(!deafened)
	if (deafened && !muted) {
		muted = true
		applyMute()
	} else if (!deafened && muted) {
		muted = false
		applyMute()
	}
	touch()
}

export function setPeerVolume(peerId: string, volume: number): void {
	volumes[peerId] = Math.max(0, Math.min(200, volume))
	const el = remoteEl(peerId)
	if (el) el.volume = Math.min(1, (volumes[peerId] / 100) * (voicePrefs.outputVolume / 100))
	touch()
}

/** Сменили микрофон в настройках посреди звонка — подменяем источник без пересоединения. */
export async function reopenMicrophone(): Promise<void> {
	if (!mic || !ctx || !micGain) return
	let next: MediaStream
	try {
		next = await openMic()
	} catch {
		return
	}
	mic.getTracks().forEach((track) => track.stop())
	micSource?.disconnect()
	mic = next
	micSource = ctx.createMediaStreamSource(next)
	micSource.connect(micGain)
	applyMute()
}

function handleService(leg: Leg, payload: Record<string, unknown>): void {
	if (payload.portalrinth === 'roster' && Array.isArray(payload.members)) {
		leg.roster = payload.members
			.map((entry) => parseObject(entry))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
			.map((entry) => ({ id: String(entry.id ?? ''), name: String(entry.name ?? '') }))
			.filter((entry) => entry.id)
		touch()
		return
	}
	if (payload.portalrinth === 'speaking' && payload.id) {
		leg.relayedSpeaking = { ...leg.relayedSpeaking, [String(payload.id)]: Boolean(payload.on) }
		touch()
	}
}

export async function handleCallSignal(
	msg: CallSignal & { reason?: string; username?: string },
): Promise<void> {
	if (!host || !msg?.type || !msg.fromUserId) return
	const mine = host.me()?.id || ''
	const from = String(msg.fromUserId)
	if (from === String(mine)) return
	if (msg.toUserId && mine && String(msg.toUserId) !== String(mine)) return
	const type = msg.type
	const leg = legs.get(from)

	if (type === 'call_ring') {
		if (leg) return
		const phase = phaseNow()
		if (phase !== 'idle') {
			const busy = newLeg(
				from,
				msg.fromUsername || msg.username || '',
				msg.conversationId,
				'incoming',
				false,
			)
			await signal(busy, { type: 'call_reject', reason: 'busy' })
			return
		}
		const incoming = newLeg(
			from,
			msg.fromUsername || msg.username || '',
			msg.conversationId,
			'incoming',
			false,
		)
		legs.set(from, incoming)
		startLoop('incoming')
		touch()
		incoming.ringTimer = setTimeout(() => {
			if (incoming.state === 'incoming') void endLeg(from, false)
		}, RING_TIMEOUT)
		return
	}

	if (!leg) return

	if (type === 'call_reject') {
		if (msg.reason === 'busy') host.toast(host.busyText())
		await endLeg(from, false)
		return
	}
	if (type === 'call_hangup') {
		await endLeg(from, false)
		return
	}

	if (type === 'call_answer' && leg.state === 'ringing') {
		leg.ringTimer = clearTimer(leg.ringTimer)
		if (![...legs.values()].some((entry) => entry !== leg && entry.state === 'ringing')) {
			stopLoop('outgoing')
		}
		leg.state = 'connecting'
		touch()
		armConnectTimeout(leg)
		try {
			const pc = await makePc(leg)
			const offer = tuneOpus(await pc.createOffer({ offerToReceiveAudio: true }))
			await pc.setLocalDescription(offer)
			await signal(leg, { type: 'call_sdp_offer', sdp: offer })
		} catch {
			host.toast(host.failedText())
			await endLeg(from, true)
		}
		return
	}

	if (type === 'call_sdp_offer') {
		const desc = asSdp(msg.sdp)
		if (!desc || !leg.pc) return
		try {
			await leg.pc.setRemoteDescription(desc)
			await flushIce(leg)
			const answer = tuneOpus(await leg.pc.createAnswer())
			await leg.pc.setLocalDescription(answer)
			await signal(leg, { type: 'call_sdp_answer', sdp: answer })
		} catch {
			host.toast(host.failedText())
			await endLeg(from, true)
		}
		return
	}

	if (type === 'call_sdp_answer' && leg.pc) {
		const desc = asSdp(msg.sdp)
		if (!desc || leg.pc.signalingState !== 'have-local-offer') return
		try {
			await leg.pc.setRemoteDescription(desc)
			await flushIce(leg)
			leg.restarting = false
		} catch {
			host.toast(host.failedText())
			await endLeg(from, true)
		}
		return
	}

	if (type === 'call_ice') {
		const payload = parseObject(msg.candidate)
		if (payload?.portalrinth) {
			handleService(leg, payload)
			return
		}
		const candidate = asIce(msg.candidate)
		if (!candidate) return
		if (!leg.pc || !leg.pc.remoteDescription) {
			leg.pendingIce.push(candidate)
			return
		}
		await leg.pc.addIceCandidate(candidate).catch(() => undefined)
	}
}
