import { reactive } from 'vue'

import { getCallState, hangupCall } from '@/helpers/messenger-call'
import { type LooseRecord, serviceRequest } from '@/helpers/uprojects-service'

import { openMic, playSound, routeOutput } from './devices'

type VoiceMember = { userId: string; muted: boolean; deafened: boolean }

export const voice = reactive({
	convId: '',
	channelId: '',
	connecting: false,
	muted: false,
	deafened: false,
	joinedAt: 0,
	members: {} as Record<string, VoiceMember[]>,
	speaking: {} as Record<string, boolean>,
})

const FALLBACK_ICE: RTCConfiguration = {
	iceServers: [
		{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
		{ urls: 'stun:stun.cloudflare.com:3478' },
	],
}

let ice: RTCConfiguration = FALLBACK_ICE
let me = ''
let mic: MediaStream | null = null
const peers = new Map<string, RTCPeerConnection>()
const pendingIce = new Map<string, RTCIceCandidateInit[]>()
const audios = new Map<string, HTMLAudioElement>()
let vad: { ctx: AudioContext; raf: number } | null = null
let onError: (code: string) => void = () => undefined

export function initVoiceChannels(opts: { myId: string; error: (code: string) => void }): void {
	me = opts.myId
	onError = opts.error
}

function enc(value: string): string {
	return encodeURIComponent(value)
}

async function loadIce(): Promise<void> {
	const response = await serviceRequest('/rtc-config').catch(() => null)
	const servers = response?.data?.iceServers || response?.data?.config?.iceServers
	ice =
		Array.isArray(servers) && servers.length
			? { iceServers: [...servers, ...(FALLBACK_ICE.iceServers ?? [])] }
			: FALLBACK_ICE
}

function signal(to: string, type: string, extra: LooseRecord): void {
	if (!voice.convId || !voice.channelId) return
	void serviceRequest(`/conversations/${enc(voice.convId)}/signals`, {
		method: 'POST',
		body: { type, toUserId: to, channelId: voice.channelId, sdp: null, candidate: null, ...extra },
	}).catch(() => undefined)
}

function shouldOffer(other: string): boolean {
	return me < other
}

function applyTracks(): void {
	mic?.getAudioTracks().forEach((track) => {
		track.enabled = !voice.muted && !voice.deafened
	})
	for (const el of audios.values()) el.muted = voice.deafened
}

function dropPeer(uid: string): void {
	const pc = peers.get(uid)
	peers.delete(uid)
	pendingIce.delete(uid)
	try {
		pc?.close()
	} catch {
		/* уже закрыт */
	}
	const el = audios.get(uid)
	if (el) {
		el.pause()
		el.srcObject = null
		el.remove()
	}
	audios.delete(uid)
	Reflect.deleteProperty(voice.speaking, uid)
}

async function createPeer(uid: string, offerer: boolean): Promise<RTCPeerConnection | null> {
	const existing = peers.get(uid)
	if (existing) return existing
	if (!mic || uid === me || !voice.channelId) return null
	const pc = new RTCPeerConnection(ice)
	peers.set(uid, pc)
	mic.getTracks().forEach((track) => pc.addTrack(track, mic!))
	pc.onicecandidate = (event) => {
		if (event.candidate) signal(uid, 'vc_ice', { candidate: event.candidate.toJSON() })
	}
	pc.ontrack = (event) => {
		let el = audios.get(uid)
		if (!el) {
			el = document.createElement('audio')
			el.autoplay = true
			el.dataset.msgrOutput = ''
			el.style.display = 'none'
			document.body.appendChild(el)
			audios.set(uid, el)
		}
		el.srcObject = event.streams[0] || new MediaStream([event.track])
		el.muted = voice.deafened
		const target = el
		void routeOutput(target).then(() => target.play().catch(() => undefined))
	}
	pc.onconnectionstatechange = () => {
		if (pc.connectionState === 'failed') {
			dropPeer(uid)
			if (shouldOffer(uid)) void createPeer(uid, true)
		}
	}
	if (offerer) {
		const offer = await pc.createOffer({ offerToReceiveAudio: true })
		await pc.setLocalDescription(offer)
		signal(uid, 'vc_offer', { sdp: { type: offer.type, sdp: offer.sdp } })
	}
	return pc
}

async function flushIce(uid: string): Promise<void> {
	const pc = peers.get(uid)
	const queue = pendingIce.get(uid)
	if (!pc || !queue?.length || !pc.remoteDescription) return
	pendingIce.delete(uid)
	for (const candidate of queue) await pc.addIceCandidate(candidate).catch(() => undefined)
}

function startVad(): void {
	stopVad()
	if (!mic) return
	let ctx: AudioContext
	try {
		ctx = new AudioContext()
	} catch {
		return
	}
	const analyser = ctx.createAnalyser()
	analyser.fftSize = 512
	ctx.createMediaStreamSource(mic).connect(analyser)
	const buffer = new Uint8Array(analyser.fftSize)
	const state = { ctx, raf: 0 }
	let quiet = 0
	vad = state
	const tick = () => {
		if (vad !== state) return
		analyser.getByteTimeDomainData(buffer)
		let sum = 0
		for (const value of buffer) sum += ((value - 128) / 128) ** 2
		const loud = Math.sqrt(sum / buffer.length) > 0.04 && !voice.muted && !voice.deafened
		if (loud) quiet = 0
		const on = loud || (Boolean(voice.speaking[me]) && ++quiet < 15)
		if (on !== Boolean(voice.speaking[me])) voice.speaking[me] = on
		state.raf = requestAnimationFrame(tick)
	}
	void ctx.resume().catch(() => undefined)
	state.raf = requestAnimationFrame(tick)
}

function stopVad(): void {
	if (!vad) return
	cancelAnimationFrame(vad.raf)
	void vad.ctx.close().catch(() => undefined)
	vad = null
}

function publishState(): void {
	if (!voice.convId || !voice.channelId) return
	void serviceRequest(`/conversations/${enc(voice.convId)}/voice/${enc(voice.channelId)}/state`, {
		method: 'POST',
		body: { muted: voice.muted, deafened: voice.deafened },
	}).catch(() => undefined)
}

export async function joinVoice(convId: string, channelId: string): Promise<boolean> {
	if (voice.channelId === channelId) return true
	if (getCallState().phase !== 'idle') await hangupCall()
	if (voice.channelId) await leaveVoice()
	voice.connecting = true
	try {
		await loadIce()
		try {
			mic = await openMic()
		} catch {
			onError('mic')
			return false
		}
		const response = await serviceRequest(
			`/conversations/${enc(convId)}/voice/${enc(channelId)}/join`,
			{
				method: 'POST',
				body: {},
			},
		)
		if (!response.ok) {
			mic.getTracks().forEach((track) => track.stop())
			mic = null
			onError(String(response.error || response.code || 'voice_join'))
			return false
		}
		voice.convId = convId
		voice.channelId = channelId
		voice.joinedAt = Date.now()
		playSound('connect')
		applyTracks()
		const members = parseMembers(response.data?.members)
		if (members.length) setMembers(channelId, members)
		else
			setMembers(channelId, [
				...(voice.members[channelId] ?? []),
				{ userId: me, muted: false, deafened: false },
			])
		publishState()
		startVad()
		for (const member of voice.members[channelId] ?? []) {
			if (member.userId !== me && shouldOffer(member.userId)) await createPeer(member.userId, true)
		}
		return true
	} finally {
		voice.connecting = false
	}
}

export async function leaveVoice(): Promise<void> {
	const { convId, channelId } = voice
	if (!channelId) return
	for (const uid of [...peers.keys()]) dropPeer(uid)
	playSound('hangup')
	stopVad()
	mic?.getTracks().forEach((track) => track.stop())
	mic = null
	voice.channelId = ''
	voice.convId = ''
	voice.joinedAt = 0
	voice.speaking = {}
	setMembers(
		channelId,
		(voice.members[channelId] ?? []).filter((member) => member.userId !== me),
	)
	await serviceRequest(`/conversations/${enc(convId)}/voice/${enc(channelId)}/leave`, {
		method: 'POST',
		body: {},
	}).catch(() => undefined)
}

export function toggleVoiceMute(): void {
	if (voice.muted && voice.deafened) voice.deafened = false
	voice.muted = !voice.muted
	applyTracks()
	publishState()
}

export function toggleVoiceDeafen(): void {
	voice.deafened = !voice.deafened
	applyTracks()
	publishState()
}

function parseMembers(raw: unknown): VoiceMember[] {
	if (!Array.isArray(raw)) return []
	return raw
		.map((row: LooseRecord) => ({
			userId: String(row?.userId ?? row?.id ?? ''),
			muted: Boolean(row?.muted),
			deafened: Boolean(row?.deafened),
		}))
		.filter((member) => member.userId)
}

function setMembers(channelId: string, members: VoiceMember[]): void {
	const unique = new Map(members.map((member) => [member.userId, member]))
	voice.members[channelId] = [...unique.values()]
}

/** Событие «voice» из потока: актуальный состав канала. */
export async function handleVoiceEvent(data: LooseRecord): Promise<void> {
	const channelId = String(data.channelId || '')
	if (!channelId) return
	const members = parseMembers(data.members)
	const userId = String(data.userId || '')
	if (members.length || Array.isArray(data.members)) {
		if (userId) {
			for (const [id, list] of Object.entries(voice.members)) {
				if (id !== channelId && list.some((member) => member.userId === userId)) {
					setMembers(
						id,
						list.filter((member) => member.userId !== userId),
					)
				}
			}
		}
		setMembers(channelId, members)
	}
	if (channelId !== voice.channelId) return
	const present = new Set((voice.members[channelId] ?? []).map((member) => member.userId))
	for (const uid of [...peers.keys()]) if (!present.has(uid)) dropPeer(uid)
	for (const uid of present) {
		if (uid !== me && !peers.has(uid) && shouldOffer(uid)) await createPeer(uid, true)
	}
}

/** Сигналы vc_* приходят тем же событием «signal», что и личные звонки. */
export async function handleVoiceSignal(data: LooseRecord): Promise<void> {
	const type = String(data.type || '')
	const from = String(data.fromUserId || '')
	const channelId = String(data.channelId || '')
	if (!from || from === me) return
	if (type === 'vc_speaking') {
		if (channelId === voice.channelId) voice.speaking[from] = Boolean(data.speaking)
		return
	}
	if (!voice.channelId || (channelId && channelId !== voice.channelId)) return
	if (type === 'vc_offer' && data.sdp) {
		const prev = peers.get(from)
		if (prev && ['failed', 'disconnected', 'closed'].includes(prev.connectionState)) dropPeer(from)
		const pc = await createPeer(from, false)
		if (!pc) return
		await pc.setRemoteDescription(data.sdp as RTCSessionDescriptionInit)
		await flushIce(from)
		const answer = await pc.createAnswer()
		await pc.setLocalDescription(answer)
		signal(from, 'vc_answer', { sdp: { type: answer.type, sdp: answer.sdp } })
		return
	}
	if (type === 'vc_answer' && data.sdp) {
		const pc = peers.get(from)
		if (!pc) return
		await pc.setRemoteDescription(data.sdp as RTCSessionDescriptionInit)
		await flushIce(from)
		return
	}
	if (type === 'vc_ice' && data.candidate) {
		const candidate = data.candidate as RTCIceCandidateInit
		const pc = peers.get(from)
		if (!pc || !pc.remoteDescription) {
			pendingIce.set(from, [...(pendingIce.get(from) ?? []), candidate])
			return
		}
		await pc.addIceCandidate(candidate).catch(() => undefined)
	}
}

export function resetVoice(): void {
	void leaveVoice()
	voice.members = {}
}
