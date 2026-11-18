import { reactive, watch } from 'vue'

import connectSound from '@/assets/sounds/messenger/connect.mp3'
import hangupSound from '@/assets/sounds/messenger/hangup.mp3'
import incomingSound from '@/assets/sounds/messenger/incoming.mp3'
import messageSound from '@/assets/sounds/messenger/message.mp3'
import outgoingSound from '@/assets/sounds/messenger/outgoing.mp3'
import rejectSound from '@/assets/sounds/messenger/reject.mp3'
import sendSound from '@/assets/sounds/messenger/send.mp3'

export type VoicePrefs = {
	inputId: string
	outputId: string
	inputGain: number
	outputVolume: number
	noiseSuppression: boolean
	echoCancellation: boolean
	notifyToasts: boolean
	notifySound: boolean
	notifyVolume: number
	callSounds: boolean
}

const PREFS_KEY = 'portalrinth.messenger.voice'

const DEFAULTS: VoicePrefs = {
	inputId: '',
	outputId: '',
	inputGain: 100,
	outputVolume: 100,
	noiseSuppression: true,
	echoCancellation: true,
	notifyToasts: true,
	notifySound: true,
	notifyVolume: 70,
	callSounds: true,
}

function readPrefs(): Partial<VoicePrefs> {
	try {
		const raw = localStorage.getItem(PREFS_KEY)
		return raw ? (JSON.parse(raw) as Partial<VoicePrefs>) : {}
	} catch {
		return {}
	}
}

export const voicePrefs = reactive<VoicePrefs>({ ...DEFAULTS, ...readPrefs() })

watch(
	voicePrefs,
	() => {
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify(voicePrefs))
		} catch {
			return
		}
	},
	{ deep: true },
)

export type DeviceOption = { id: string; label: string }

export const devices = reactive({
	inputs: [] as DeviceOption[],
	outputs: [] as DeviceOption[],
	loaded: false,
	denied: false,
})

function labelOf(device: MediaDeviceInfo, index: number, kind: 'input' | 'output'): string {
	if (device.label) return device.label
	return kind === 'input' ? `Микрофон ${index + 1}` : `Динамики ${index + 1}`
}

/** Без разрешения на микрофон браузер отдаёт устройства без имён — спрашиваем один раз. */
export async function refreshDevices(askPermission = true): Promise<void> {
	if (!navigator.mediaDevices?.enumerateDevices) return
	let list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
	const unnamed = list.some((device) => device.kind === 'audioinput' && !device.label)
	if (unnamed && askPermission) {
		try {
			const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
			probe.getTracks().forEach((track) => track.stop())
			list = await navigator.mediaDevices.enumerateDevices()
			devices.denied = false
		} catch {
			devices.denied = true
		}
	}
	const inputs = list.filter((device) => device.kind === 'audioinput')
	const outputs = list.filter((device) => device.kind === 'audiooutput')
	devices.inputs = inputs.map((device, index) => ({
		id: device.deviceId,
		label: labelOf(device, index, 'input'),
	}))
	devices.outputs = outputs.map((device, index) => ({
		id: device.deviceId,
		label: labelOf(device, index, 'output'),
	}))
	devices.loaded = true
	if (voicePrefs.inputId && !inputs.some((device) => device.deviceId === voicePrefs.inputId)) {
		voicePrefs.inputId = ''
	}
	if (voicePrefs.outputId && !outputs.some((device) => device.deviceId === voicePrefs.outputId)) {
		voicePrefs.outputId = ''
	}
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
	navigator.mediaDevices.addEventListener('devicechange', () => {
		if (devices.loaded) void refreshDevices(false)
	})
}

export function micConstraints(): MediaTrackConstraints {
	const audio: MediaTrackConstraints = {
		echoCancellation: voicePrefs.echoCancellation,
		noiseSuppression: voicePrefs.noiseSuppression,
		autoGainControl: true,
		channelCount: 1,
	}
	if (voicePrefs.inputId && voicePrefs.inputId !== 'default') {
		audio.deviceId = { exact: voicePrefs.inputId }
	}
	return audio
}

/** Микрофон по настройкам; если выбранного устройства уже нет — системный по умолчанию. */
export async function openMic(): Promise<MediaStream> {
	try {
		return await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: false })
	} catch (error) {
		if (!voicePrefs.inputId) throw error
		return await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
	}
}

type SinkElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }

export async function routeOutput(el: HTMLMediaElement): Promise<void> {
	const sink = el as SinkElement
	el.volume = Math.min(1, Math.max(0, voicePrefs.outputVolume / 100))
	if (typeof sink.setSinkId !== 'function') return
	const target = voicePrefs.outputId && voicePrefs.outputId !== 'default' ? voicePrefs.outputId : ''
	await sink.setSinkId(target).catch(() => undefined)
}

export function routeAllOutputs(): void {
	document
		.querySelectorAll<HTMLMediaElement>('[data-msgr-output]')
		.forEach((el) => void routeOutput(el))
}

watch(
	() => [voicePrefs.outputId, voicePrefs.outputVolume],
	() => routeAllOutputs(),
)

const SOUNDS = {
	message: messageSound,
	incoming: incomingSound,
	outgoing: outgoingSound,
	connect: connectSound,
	hangup: hangupSound,
	reject: rejectSound,
	send: sendSound,
} as const

export type MessengerSound = keyof typeof SOUNDS

const loops = new Map<MessengerSound, HTMLAudioElement>()

function makeSound(kind: MessengerSound, volume: number, loop: boolean): HTMLAudioElement {
	const audio = new Audio(SOUNDS[kind])
	audio.volume = Math.min(1, Math.max(0, volume))
	audio.loop = loop
	audio.dataset.msgrOutput = ''
	void routeOutput(audio).then(() => {
		audio.volume = Math.min(1, Math.max(0, volume))
	})
	return audio
}

export function playSound(kind: MessengerSound): void {
	const isNotify = kind === 'message'
	if (isNotify ? !voicePrefs.notifySound : !voicePrefs.callSounds) return
	const volume = (isNotify ? voicePrefs.notifyVolume : 70) / 100
	try {
		void makeSound(kind, volume, false)
			.play()
			.catch(() => undefined)
	} catch {
		return
	}
}

export function startLoop(kind: 'incoming' | 'outgoing'): void {
	if (!voicePrefs.callSounds || loops.has(kind)) return
	const audio = makeSound(kind, kind === 'incoming' ? 0.7 : 0.5, true)
	loops.set(kind, audio)
	void audio.play().catch(() => undefined)
}

export function stopLoop(kind?: 'incoming' | 'outgoing'): void {
	for (const [key, audio] of loops) {
		if (kind && key !== kind) continue
		audio.pause()
		audio.src = ''
		loops.delete(key)
	}
}

export type MicTest = {
	stop: () => void
}

/** Проверка микрофона: уровень сигнала и, по желанию, свой голос в наушниках. */
export async function startMicTest(
	onLevel: (level: number) => void,
	loopback: boolean,
): Promise<MicTest> {
	const stream = await openMic()
	const ctx = new AudioContext()
	const source = ctx.createMediaStreamSource(stream)
	const gain = ctx.createGain()
	gain.gain.value = voicePrefs.inputGain / 100
	const analyser = ctx.createAnalyser()
	analyser.fftSize = 512
	source.connect(gain)
	gain.connect(analyser)
	let echo: HTMLAudioElement | null = null
	if (loopback) {
		const dest = ctx.createMediaStreamDestination()
		gain.connect(dest)
		echo = new Audio()
		echo.dataset.msgrOutput = ''
		echo.srcObject = dest.stream
		await routeOutput(echo)
		void echo.play().catch(() => undefined)
	}
	const data = new Uint8Array(analyser.fftSize)
	let frame = 0
	const tick = () => {
		analyser.getByteTimeDomainData(data)
		let peak = 0
		for (const value of data) peak = Math.max(peak, Math.abs(value - 128))
		onLevel(Math.min(1, peak / 90))
		frame = requestAnimationFrame(tick)
	}
	tick()
	return {
		stop: () => {
			cancelAnimationFrame(frame)
			onLevel(0)
			if (echo) {
				echo.pause()
				echo.srcObject = null
			}
			stream.getTracks().forEach((track) => track.stop())
			void ctx.close().catch(() => undefined)
		},
	}
}
