<template>
	<section class="flex flex-col gap-5 border-0 border-t border-solid border-divider pt-6">
		<div class="min-w-0">
			<h2 class="m-0 text-lg font-semibold text-contrast">
				{{ formatMessage(messages.title) }}
			</h2>
			<p class="m-0 mt-1 text-secondary">{{ formatMessage(messages.description) }}</p>
		</div>

		<p
			v-if="devices.denied"
			class="m-0 flex items-center gap-2 rounded-2xl bg-surface-2 p-3 text-sm font-semibold text-orange"
		>
			<MicIcon class="size-4 shrink-0" />
			{{ formatMessage(messages.denied) }}
		</p>

		<div class="grid gap-4 md:grid-cols-2">
			<div class="flex min-w-0 flex-col gap-2">
				<span id="voice-input-label" class="flex items-center gap-2 font-semibold text-contrast">
					<MicIcon class="size-4 text-secondary" />
					{{ formatMessage(messages.input) }}
				</span>
				<Combobox
					:model-value="voicePrefs.inputId"
					:options="inputOptions"
					:display-value="labelOf(inputOptions, voicePrefs.inputId)"
					listbox
					show-chevron
					aria-labelledby="voice-input-label"
					@update:model-value="onInput"
				/>
			</div>
			<div class="flex min-w-0 flex-col gap-2">
				<span id="voice-output-label" class="flex items-center gap-2 font-semibold text-contrast">
					<HeadphonesIcon class="size-4 text-secondary" />
					{{ formatMessage(messages.output) }}
				</span>
				<Combobox
					:model-value="voicePrefs.outputId"
					:options="outputOptions"
					:display-value="labelOf(outputOptions, voicePrefs.outputId)"
					listbox
					show-chevron
					aria-labelledby="voice-output-label"
					@update:model-value="onOutput"
				/>
			</div>
		</div>

		<div class="grid gap-4 md:grid-cols-2">
			<div class="flex flex-col gap-2.5">
				<h3 class="m-0 text-base font-semibold text-contrast">
					{{ formatMessage(messages.inputGain) }}
				</h3>
				<Slider
					v-model="voicePrefs.inputGain"
					:aria-label="formatMessage(messages.inputGain)"
					:min="0"
					:max="200"
					:step="5"
					unit="%"
				/>
			</div>
			<div class="flex flex-col gap-2.5">
				<h3 class="m-0 text-base font-semibold text-contrast">
					{{ formatMessage(messages.outputVolume) }}
				</h3>
				<Slider
					v-model="voicePrefs.outputVolume"
					:aria-label="formatMessage(messages.outputVolume)"
					:min="0"
					:max="100"
					:step="1"
					unit="%"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-0">
					<span class="font-semibold text-contrast">{{ formatMessage(messages.testTitle) }}</span>
					<p class="m-0 mt-0.5 text-sm text-secondary">{{ formatMessage(messages.testHint) }}</p>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox
						v-model="loopback"
						:label="formatMessage(messages.loopback)"
						:disabled="testing"
					/>
					<Button
						:type="testing ? 'standard' : 'colored'"
						:color="testing ? 'red' : 'brand'"
						:disabled="starting"
						@click="toggleTest"
					>
						<SpinnerIcon v-if="starting" class="animate-spin" aria-hidden="true" />
						<MicIcon v-else aria-hidden="true" />
						{{ testing ? formatMessage(messages.testStop) : formatMessage(messages.testStart) }}
					</Button>
				</div>
			</div>
			<div class="voice-meter" :class="{ 'is-live': testing }">
				<span v-for="index in 28" :key="index" :class="{ 'is-lit': index <= litBars }" />
			</div>
			<p v-if="testError" class="m-0 text-xs font-semibold text-red">{{ testError }}</p>
		</div>

		<div class="flex flex-col gap-4">
			<div v-for="row in toggles" :key="row.key" class="flex items-center justify-between gap-4">
				<div class="min-w-0">
					<h3 :id="`voice-${row.key}`" class="m-0 text-base font-semibold text-contrast">
						{{ row.title }}
					</h3>
					<p class="m-0 mt-0.5 text-sm text-secondary">{{ row.description }}</p>
				</div>
				<Toggle v-model="voicePrefs[row.key]" :aria-labelledby="`voice-${row.key}`" />
			</div>
			<div v-if="voicePrefs.notifySound" class="flex flex-col gap-2.5">
				<div class="flex items-center justify-between gap-3">
					<h3 class="m-0 text-base font-semibold text-contrast">
						{{ formatMessage(messages.notifyVolume) }}
					</h3>
					<Button type="transparent" @click="playSound('message')">
						<PlayIcon aria-hidden="true" />
						{{ formatMessage(messages.preview) }}
					</Button>
				</div>
				<Slider
					v-model="voicePrefs.notifyVolume"
					:aria-label="formatMessage(messages.notifyVolume)"
					:min="0"
					:max="100"
					:step="1"
					unit="%"
				/>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * Голос и уведомления мессенджера: микрофон и наушники для звонков,
 * проверка микрофона и звук всплывающих сообщений.
 */
import { MicrophoneIcon as MicIcon, PlayIcon, SpinnerIcon } from '@modrinth/assets'
import {
	Button,
	Checkbox,
	Combobox,
	type ComboboxOption,
	defineMessages,
	Slider,
	Toggle,
	useVIntl,
} from '@modrinth/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
	devices,
	type MicTest,
	playSound,
	refreshDevices,
	startMicTest,
	type VoicePrefs,
	voicePrefs,
} from '@/components/ui/messenger/devices'
import HeadphonesIcon from '@/components/ui/messenger/HeadphonesIcon.vue'
import { reopenMicrophone } from '@/helpers/messenger-call'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	title: { id: 'app.settings.voice.title', defaultMessage: 'Voice and notifications' },
	description: {
		id: 'app.settings.voice.description',
		defaultMessage:
			'Microphone and headphones for MC Messenger calls, and how new messages appear.',
	},
	denied: {
		id: 'app.settings.voice.denied',
		defaultMessage: 'No access to the microphone — device names are hidden until it is allowed.',
	},
	input: { id: 'app.settings.voice.input', defaultMessage: 'Microphone' },
	output: { id: 'app.settings.voice.output', defaultMessage: 'Headphones / speakers' },
	systemDefault: { id: 'app.settings.voice.default', defaultMessage: 'System default' },
	inputGain: { id: 'app.settings.voice.input-gain', defaultMessage: 'Microphone volume' },
	outputVolume: { id: 'app.settings.voice.output-volume', defaultMessage: 'Call volume' },
	testTitle: { id: 'app.settings.voice.test', defaultMessage: 'Microphone check' },
	testHint: {
		id: 'app.settings.voice.test-hint',
		defaultMessage: 'Say something — the bar shows how loud you are heard.',
	},
	loopback: { id: 'app.settings.voice.loopback', defaultMessage: 'Hear myself' },
	testStart: { id: 'app.settings.voice.test-start', defaultMessage: 'Check' },
	testStop: { id: 'app.settings.voice.test-stop', defaultMessage: 'Stop' },
	testFailed: {
		id: 'app.settings.voice.test-failed',
		defaultMessage: 'Could not open the microphone.',
	},
	noiseSuppression: { id: 'app.settings.voice.noise', defaultMessage: 'Noise suppression' },
	noiseSuppressionDesc: {
		id: 'app.settings.voice.noise-description',
		defaultMessage: 'Cuts keyboard clicks and background hum.',
	},
	echoCancellation: { id: 'app.settings.voice.echo', defaultMessage: 'Echo cancellation' },
	echoCancellationDesc: {
		id: 'app.settings.voice.echo-description',
		defaultMessage: 'Keeps the other side from hearing themselves through your speakers.',
	},
	callSounds: { id: 'app.settings.voice.call-sounds', defaultMessage: 'Call sounds' },
	callSoundsDesc: {
		id: 'app.settings.voice.call-sounds-description',
		defaultMessage: 'Ringing, connecting and hanging up.',
	},
	notifyToasts: { id: 'app.settings.voice.toasts', defaultMessage: 'Message pop-ups' },
	notifyToastsDesc: {
		id: 'app.settings.voice.toasts-description',
		defaultMessage: 'A card in the bottom-right corner with the nickname, avatar and text.',
	},
	notifySound: { id: 'app.settings.voice.notify-sound', defaultMessage: 'Message sound' },
	notifySoundDesc: {
		id: 'app.settings.voice.notify-sound-description',
		defaultMessage: 'A short chime when a new message arrives.',
	},
	notifyVolume: { id: 'app.settings.voice.notify-volume', defaultMessage: 'Notification volume' },
	preview: { id: 'app.settings.voice.preview', defaultMessage: 'Listen' },
})

type ToggleKey = keyof Pick<
	VoicePrefs,
	'noiseSuppression' | 'echoCancellation' | 'callSounds' | 'notifyToasts' | 'notifySound'
>

const toggles = computed<{ key: ToggleKey; title: string; description: string }[]>(() => [
	{
		key: 'noiseSuppression',
		title: formatMessage(messages.noiseSuppression),
		description: formatMessage(messages.noiseSuppressionDesc),
	},
	{
		key: 'echoCancellation',
		title: formatMessage(messages.echoCancellation),
		description: formatMessage(messages.echoCancellationDesc),
	},
	{
		key: 'callSounds',
		title: formatMessage(messages.callSounds),
		description: formatMessage(messages.callSoundsDesc),
	},
	{
		key: 'notifyToasts',
		title: formatMessage(messages.notifyToasts),
		description: formatMessage(messages.notifyToastsDesc),
	},
	{
		key: 'notifySound',
		title: formatMessage(messages.notifySound),
		description: formatMessage(messages.notifySoundDesc),
	},
])

function withDefault(list: { id: string; label: string }[]): ComboboxOption<string>[] {
	return [
		{ value: '', label: formatMessage(messages.systemDefault) },
		...list
			.filter((device) => device.id && device.id !== 'default' && device.id !== 'communications')
			.map((device) => ({ value: device.id, label: device.label })),
	]
}

const inputOptions = computed(() => withDefault(devices.inputs))
const outputOptions = computed(() => withDefault(devices.outputs))

function labelOf(options: ComboboxOption<string>[], id: string): string {
	return options.find((option) => option.value === id)?.label ?? options[0]?.label ?? ''
}

async function onInput(id: string): Promise<void> {
	voicePrefs.inputId = id ?? ''
	await reopenMicrophone()
	if (test) await restartTest()
}

function onOutput(id: string): void {
	voicePrefs.outputId = id ?? ''
}

const loopback = ref(false)
const testing = ref(false)
const starting = ref(false)
const level = ref(0)
const testError = ref('')
let test: MicTest | null = null

const litBars = computed(() => Math.round(Math.min(1, level.value * 1.6) * 28))

function stopTest(): void {
	test?.stop()
	test = null
	testing.value = false
	level.value = 0
}

async function restartTest(): Promise<void> {
	stopTest()
	await toggleTest()
}

async function toggleTest(): Promise<void> {
	if (testing.value) {
		stopTest()
		return
	}
	starting.value = true
	testError.value = ''
	try {
		test = await startMicTest((value) => {
			level.value = level.value * 0.6 + value * 0.4
		}, loopback.value)
		testing.value = true
		if (!devices.loaded || devices.denied) void refreshDevices(false)
	} catch {
		testError.value = formatMessage(messages.testFailed)
	} finally {
		starting.value = false
	}
}

onMounted(() => {
	void refreshDevices()
})

onBeforeUnmount(stopTest)
</script>

<style scoped>
.voice-meter {
	display: flex;
	height: 0.7rem;
	gap: 3px;
}

.voice-meter span {
	flex: 1;
	border-radius: 999px;
	background: var(--color-button-bg);
	transition:
		background-color 0.08s linear,
		opacity 0.2s ease;
	opacity: 0.55;
}

.voice-meter.is-live span {
	opacity: 1;
}

.voice-meter span.is-lit {
	background: var(--color-green);
}

.voice-meter span.is-lit:nth-child(n + 20) {
	background: var(--color-orange);
}

.voice-meter span.is-lit:nth-child(n + 25) {
	background: var(--color-red);
}
</style>
