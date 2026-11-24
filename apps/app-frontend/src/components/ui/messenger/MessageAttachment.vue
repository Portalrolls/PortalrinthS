<script setup lang="ts">
import {
	DownloadIcon,
	ExternalIcon,
	FileIcon,
	PackageIcon,
	PauseIcon,
	PlayIcon,
} from '@modrinth/assets'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { installBuild, isBuildFile } from './builds'
import { obtainXferBytes, xferProgress, xferRealSize, xferRecord, xferUrl } from './file-transfer'
import { useMessengerT } from './i18n'
import { downloadAttachment, mediaBlobUrl, saveBytesAs } from './media'
import MicIcon from './MicIcon.vue'
import { type Attachment, extensionOf, formatDuration, formatSize } from './model'
import ServiceImage from './ServiceImage.vue'
import { showToast } from './store'
import { openLightbox } from './ui-bus'

const props = defineProps<{
	attachment: Attachment
	xferId?: string
	xferSender?: string
}>()

const t = useMessengerT()

const imageFailed = ref(false)
const mediaUrl = ref('')
const mediaLoading = ref(false)
const mediaFailed = ref(false)
const downloading = ref(false)

const audio = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const position = ref(0)
const duration = ref(0)

/** Длительность, узнанная до первого прослушивания: метаданные голосового
    подтягиваются сразу при показе сообщения (файл кэширован на диске). */
const metaDuration = ref(0)
const totalDuration = computed(() => duration.value || metaDuration.value)

const isVisual = computed(
	() => props.attachment.kind === 'image' || props.attachment.kind === 'gif',
)
const isSound = computed(
	() => props.attachment.kind === 'audio' || props.attachment.kind === 'voice',
)

// --- Ленивая загрузка визуальных вложений: GIF весит десятки мегабайт,
// грузим только то, что в поле зрения, а из виду выгружаем — тогда
// сеть не замирает и ничего лишнего не качается. ---
const visHost = ref<HTMLElement | null>(null)
const visOn = ref(false)
const visW = ref(0)
const visH = ref(0)
let visObserver: IntersectionObserver | null = null

function measureVisual(): void {
	const img = visHost.value?.querySelector('.msgr-att__image') as HTMLElement | null
	if (!img) return
	const w = img.offsetWidth
	const h = img.offsetHeight
	if (w > 40 && h > 40) {
		visW.value = w
		visH.value = h
	}
}

onMounted(() => {
	visObserver = new IntersectionObserver(
		(entries) => {
			const on = entries.some((entry) => entry.isIntersecting)
			if (!on && visOn.value) measureVisual()
			visOn.value = on
		},
		{ rootMargin: '320px' },
	)
	if (visHost.value) visObserver.observe(visHost.value)
})

onBeforeUnmount(() => {
	visObserver?.disconnect()
	visObserver = null
})

onMounted(() => {
	if (!isSound.value || isXfer.value) return
	void (async () => {
		try {
			const url = await mediaBlobUrl(props.attachment.url, props.attachment.mime)
			const probe = new Audio()
			probe.preload = 'metadata'
			probe.src = url
			probe.addEventListener(
				'loadedmetadata',
				() => {
					if (Number.isFinite(probe.duration) && probe.duration > 0)
						metaDuration.value = probe.duration
					probe.removeAttribute('src')
				},
				{ once: true },
			)
			probe.addEventListener('error', () => probe.removeAttribute('src'), { once: true })
		} catch {
			/* не скачали — длительность появится после первого прослушивания, как раньше */
		}
	})()
})

const isBuild = computed(() => isBuildFile(props.attachment.name))
const fileExt = computed(() => extensionOf(props.attachment.name).toUpperCase())
const installing = ref(false)
const installed = ref(false)

// --- P2P-передача большого файла: маркер [[xfer:id]] связан с сообщением ---
const isXfer = computed(() => Boolean(props.xferId))
const xferRec = computed(() => (props.xferId ? xferRecord(props.xferId) : null))
const xferDone = computed(() => Boolean(xferRec.value?.done))
const xferFailed = computed(() => Boolean(xferRec.value?.failed))
const xferProg = computed(() => (props.xferId ? xferProgress(props.xferId) : -1))
/** Пока передача едет — адреса нет; после — локальный blob. */
const srcUrl = computed(() =>
	isXfer.value ? xferUrl(props.xferId ?? '') || '' : props.attachment.url,
)
const shownSize = computed(() =>
	isXfer.value ? xferRealSize(props.xferId ?? '') || props.attachment.size : props.attachment.size,
)

async function install(): Promise<void> {
	if (installing.value || installed.value) return
	installing.value = true
	const ok = await installBuild(props.attachment.url, props.attachment.name)
	installing.value = false
	installed.value = ok
	showToast(
		ok
			? t('app.messenger.build.installing', 'Сборка устанавливается — она появится в библиотеке')
			: t('app.messenger.build.installFailed', 'Не удалось установить сборку'),
	)
}

const progress = computed(() => (duration.value ? Math.min(1, position.value / duration.value) : 0))

async function loadMedia(): Promise<boolean> {
	if (mediaUrl.value) return true
	if (isXfer.value) {
		// blob-адрес принятого файла уже локален — не гоняем его через кэш сервиса
		if (!srcUrl.value) return false
		mediaUrl.value = srcUrl.value
		return true
	}
	mediaLoading.value = true
	mediaFailed.value = false
	try {
		mediaUrl.value = await mediaBlobUrl(props.attachment.url, props.attachment.mime)
		return true
	} catch {
		mediaFailed.value = true
		return false
	} finally {
		mediaLoading.value = false
	}
}

async function togglePlay(): Promise<void> {
	if (!(await loadMedia())) return
	await new Promise((resolve) => requestAnimationFrame(resolve))
	const el = audio.value
	if (!el) return
	if (el.paused) await el.play().catch(() => undefined)
	else el.pause()
}

function seek(event: MouseEvent): void {
	const el = audio.value
	if (!el || !duration.value) return
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
	el.currentTime = ((event.clientX - box.left) / box.width) * duration.value
}

function onMeta(): void {
	const el = audio.value
	if (el && Number.isFinite(el.duration)) duration.value = el.duration
}

async function download(): Promise<void> {
	if (downloading.value) return
	if (isXfer.value && props.xferId) {
		downloading.value = true
		try {
			const bytes = await obtainXferBytes(props.xferId, props.xferSender || '')
			if (!bytes) throw new Error('xfer_no_bytes')
			const result = await saveBytesAs(props.attachment.name, bytes)
			if (result === 'saved') showToast(t('app.messenger.file.saved', 'Файл сохранён'))
		} catch {
			showToast(t('app.messenger.xfer.downloadFailed', 'Не удалось получить файл'))
		} finally {
			downloading.value = false
		}
		return
	}
	downloading.value = true
	try {
		const result = await downloadAttachment(props.attachment.url, props.attachment.name)
		if (result === 'saved') showToast(t('app.messenger.file.saved', 'Файл сохранён'))
	} catch {
		showToast(t('app.messenger.file.downloadFailed', 'Не удалось скачать файл'))
	} finally {
		downloading.value = false
	}
}

function openExternal(): void {
	void openUrl(props.attachment.url)
}

onBeforeUnmount(() => audio.value?.pause())
</script>

<template>
	<div class="msgr-att" @click.stop>
		<div v-if="isVisual && srcUrl && !imageFailed" ref="visHost" class="msgr-att__vis">
			<button
				type="button"
				class="msgr-att__image"
				@click="openLightbox(srcUrl, attachment.name, attachment.mime)"
			>
				<ServiceImage
					v-if="visOn"
					:src="srcUrl"
					:mime="attachment.mime"
					:lazy="false"
					@loaded="measureVisual"
					@failed="imageFailed = true"
				/>
				<span
					v-else
					class="msgr-att__ghost"
					:style="visW ? { width: `${visW}px`, height: `${visH}px` } : undefined"
				/>
				<span v-if="attachment.kind === 'gif'" class="msgr-att__badge">GIF</span>
			</button>
			<button
				type="button"
				class="msgr-att__dl"
				:title="t('app.messenger.file.download', 'Скачать')"
				:disabled="downloading"
				@click="download"
			>
				<DownloadIcon />
			</button>
		</div>

		<div v-else-if="attachment.kind === 'video' && (srcUrl || !isXfer)" class="msgr-att__video">
			<video v-if="srcUrl" :src="srcUrl" controls autoplay preload="metadata" />
			<button
				v-else
				type="button"
				class="msgr-att__poster"
				:disabled="mediaLoading"
				@click="loadMedia"
			>
				<span class="msgr-att__play" :class="{ 'is-loading': mediaLoading }"><PlayIcon /></span>
				<span class="msgr-att__poster-name">{{ attachment.name }}</span>
				<span v-if="mediaFailed" class="msgr-att__error">
					{{ t('app.messenger.file.mediaFailed', 'Не удалось загрузить — нажмите ещё раз') }}
				</span>
			</button>
		</div>

		<div
			v-else-if="isSound && (srcUrl || !isXfer)"
			class="msgr-att__audio"
			:class="{ 'is-voice': attachment.kind === 'voice' }"
		>
			<button
				type="button"
				class="msgr-att__audio-btn"
				:class="{ 'is-loading': mediaLoading }"
				:aria-label="
					playing ? t('app.messenger.file.pause', 'Пауза') : t('app.messenger.file.play', 'Слушать')
				"
				@click="togglePlay"
			>
				<PauseIcon v-if="playing" />
				<PlayIcon v-else />
			</button>
			<div class="msgr-att__audio-body">
				<div class="msgr-att__audio-title">
					<MicIcon v-if="attachment.kind === 'voice'" class="msgr-att__mic" />
					<span>{{
						attachment.kind === 'voice'
							? t('app.messenger.file.voice', 'Голосовое сообщение')
							: attachment.name
					}}</span>
				</div>
				<div class="msgr-att__track" @click="seek">
					<span class="msgr-att__track-fill" :style="{ width: `${progress * 100}%` }" />
				</div>
				<div class="msgr-att__audio-time">
					{{ formatDuration(position) }} /
					{{ totalDuration ? formatDuration(totalDuration) : '--:--' }}
					<span v-if="mediaFailed" class="msgr-att__error">
						{{ t('app.messenger.file.mediaFailedShort', 'ошибка загрузки') }}
					</span>
				</div>
			</div>
			<button
				type="button"
				class="msgr-att__icon-btn"
				:title="t('app.messenger.file.download', 'Скачать')"
				:disabled="downloading"
				@click="download"
			>
				<DownloadIcon />
			</button>
			<audio
				v-if="mediaUrl"
				ref="audio"
				:src="mediaUrl"
				preload="metadata"
				@loadedmetadata="onMeta"
				@durationchange="onMeta"
				@timeupdate="position = audio?.currentTime ?? 0"
				@play="playing = true"
				@pause="playing = false"
				@ended="playing = false"
			/>
		</div>

		<div v-else class="msgr-att__file" :class="{ 'is-build': isBuild }">
			<span class="msgr-att__file-icon">
				<PackageIcon v-if="isBuild" />
				<FileIcon v-else />
			</span>
			<div class="msgr-att__file-body">
				<button
					type="button"
					class="msgr-att__file-name"
					:title="attachment.name"
					@click="download"
				>
					{{ attachment.name }}
				</button>
				<span class="msgr-att__file-meta">
					<span v-if="fileExt" class="msgr-att__file-ext">{{ fileExt }}</span>
					<span class="msgr-att__file-size">{{
						shownSize ? formatSize(shownSize) : attachment.mime
					}}</span>
				</span>
				<div v-if="isXfer && !xferDone" class="msgr-att__xfer">
					<div class="msgr-att__track">
						<span
							class="msgr-att__track-fill"
							:style="{ width: `${Math.max(4, xferProg * 100)}%` }"
						/>
					</div>
					<span v-if="xferFailed" class="msgr-att__error">
						{{ t('app.messenger.xfer.failed', 'Передача не удалась — нажмите «Скачать» ещё раз') }}
					</span>
					<span v-else class="msgr-att__xfer-status">
						{{ t('app.messenger.xfer.receiving', 'Получение файла…') }}
						{{ Math.round(xferProg * 100) }}%
					</span>
				</div>
			</div>
			<button
				v-if="!isXfer"
				type="button"
				class="msgr-att__icon-btn"
				:title="t('app.messenger.file.openBrowser', 'Открыть в браузере')"
				@click="openExternal"
			>
				<ExternalIcon />
			</button>
			<button
				v-if="isBuild"
				type="button"
				class="msgr-att__download is-install"
				:disabled="installing || installed"
				@click="install"
			>
				<PackageIcon />
				{{
					installed
						? t('app.messenger.build.installed', 'Установлено')
						: installing
							? t('app.messenger.build.installingShort', 'Установка…')
							: t('app.messenger.build.install', 'Установить')
				}}
			</button>
			<button
				v-if="!isBuild"
				type="button"
				class="msgr-att__download"
				:disabled="downloading"
				@click="download"
			>
				<DownloadIcon />
				{{
					downloading
						? t('app.messenger.file.downloading', 'Загрузка…')
						: t('app.messenger.file.download', 'Скачать')
				}}
			</button>
		</div>
	</div>
</template>

<style scoped>
.msgr-att {
	margin-top: 0.35rem;
	max-width: min(100%, 26rem);
}

.msgr-att__image {
	position: relative;
	display: block;
	padding: 0;
	border: 0;
	border-radius: 10px;
	overflow: hidden;
	background: rgba(0, 0, 0, 0.25);
	cursor: zoom-in;
}

.msgr-att__image img {
	display: block;
	max-width: 100%;
	max-height: 20rem;
	object-fit: contain;
	transition: transform 0.2s ease;
}

.msgr-att__image:hover img {
	transform: scale(1.015);
}

.msgr-att__ghost {
	display: block;
	min-width: 120px;
	min-height: 90px;
	border-radius: inherit;
	background: linear-gradient(
		100deg,
		rgba(255, 255, 255, 0.04) 20%,
		rgba(255, 255, 255, 0.09) 40%,
		rgba(255, 255, 255, 0.04) 60%
	);
	background-size: 220% 100%;
	animation: msgr-att-shimmer 1.3s linear infinite;
}

@keyframes msgr-att-shimmer {
	from {
		background-position: 120% 0;
	}
	to {
		background-position: -120% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-att__ghost {
		animation: none;
	}
}

.msgr-att__dl {
	position: absolute;
	right: 0.45rem;
	bottom: 0.45rem;
	display: grid;
	width: 2rem;
	height: 2rem;
	place-items: center;
	border: 0;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.62);
	color: white;
	cursor: pointer;
	opacity: 0;
	transition:
		opacity 0.15s ease,
		background 0.15s ease;
}

.msgr-att__vis:hover .msgr-att__dl {
	opacity: 1;
}

.msgr-att__dl:hover {
	background: var(--color-brand);
}

.msgr-att__dl svg {
	width: 1rem;
	height: 1rem;
}

.msgr-att__file-ext {
	padding: 0.05rem 0.3rem;
	border-radius: 4px;
	background: rgba(255, 255, 255, 0.09);
	font-size: 0.62rem;
	font-weight: 800;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	opacity: 0.85;
}

.msgr-att__file-meta {
	display: flex;
	align-items: center;
	gap: 0.4rem;
}

.msgr-att__file-meta .msgr-att__file-size {
	font-size: 0.72rem;
	opacity: 0.6;
}

.msgr-att__badge {
	position: absolute;
	left: 0.4rem;
	top: 0.4rem;
	padding: 0.05rem 0.35rem;
	border-radius: 4px;
	background: rgba(0, 0, 0, 0.7);
	color: white;
	font-size: 0.65rem;
	font-weight: 800;
	letter-spacing: 0.05em;
}

.msgr-att__video video {
	display: block;
	width: 100%;
	max-height: 22rem;
	border-radius: 10px;
	background: black;
}

.msgr-att__poster {
	display: flex;
	width: 22rem;
	max-width: 100%;
	aspect-ratio: 16 / 9;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 10px;
	background:
		radial-gradient(
			circle at 50% 40%,
			color-mix(in srgb, var(--color-brand) 25%, transparent),
			transparent 70%
		),
		#0d0e10;
	color: var(--color-base);
	cursor: pointer;
}

.msgr-att__play {
	display: grid;
	width: 3.2rem;
	height: 3.2rem;
	place-items: center;
	border-radius: 50%;
	background: var(--color-brand);
	color: white;
	transition: transform 0.15s ease;
}

.msgr-att__poster:hover .msgr-att__play {
	transform: scale(1.08);
}

.msgr-att__play.is-loading,
.msgr-att__audio-btn.is-loading {
	animation: msgr-att-pulse 0.9s ease-in-out infinite;
}

.msgr-att__poster-name {
	max-width: 90%;
	overflow: hidden;
	font-size: 0.8rem;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.75;
}

.msgr-att__audio,
.msgr-att__file {
	display: flex;
	align-items: center;
	gap: 0.7rem;
	width: 24rem;
	max-width: 100%;
	padding: 0.65rem 0.75rem;
	border: 1px solid rgba(255, 255, 255, 0.07);
	border-radius: 10px;
	background: var(--msgr-btn2);
}

.msgr-att__audio.is-voice {
	width: 19rem;
	border-color: color-mix(in srgb, var(--color-brand) 35%, transparent);
	background: color-mix(in srgb, var(--color-brand) 12%, var(--msgr-btn2));
}

.msgr-att__audio-btn {
	display: grid;
	width: 2.4rem;
	height: 2.4rem;
	flex-shrink: 0;
	place-items: center;
	border: 0;
	border-radius: 50%;
	background: var(--color-brand);
	color: white;
	cursor: pointer;
	transition: transform 0.12s ease;
}

.msgr-att__audio-btn:hover {
	transform: scale(1.06);
}

.msgr-att__audio-btn svg {
	width: 1.1rem;
	height: 1.1rem;
}

.msgr-att__audio-body,
.msgr-att__file-body {
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
	gap: 0.3rem;
}

.msgr-att__audio-title {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	overflow: hidden;
	font-size: 0.82rem;
	font-weight: 600;
	white-space: nowrap;
}

.msgr-att__audio-title span {
	overflow: hidden;
	text-overflow: ellipsis;
}

.msgr-att__mic {
	width: 0.85rem;
	height: 0.85rem;
	flex-shrink: 0;
	color: var(--color-brand);
}

.msgr-att__track {
	position: relative;
	height: 5px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.12);
	cursor: pointer;
}

.msgr-att__track-fill {
	position: absolute;
	inset: 0 auto 0 0;
	border-radius: inherit;
	background: var(--color-brand);
}

.msgr-att__audio-time {
	font-size: 0.7rem;
	font-variant-numeric: tabular-nums;
	opacity: 0.65;
}

.msgr-att__xfer {
	display: flex;
	align-items: center;
	gap: 0.4rem;
}

.msgr-att__xfer .msgr-att__track {
	flex: 1;
	min-width: 6rem;
	cursor: default;
}

.msgr-att__xfer-status {
	font-size: 0.7rem;
	font-variant-numeric: tabular-nums;
	opacity: 0.65;
	white-space: nowrap;
}

.msgr-att__error {
	margin-left: 0.3rem;
	color: #f87171;
	font-size: 0.72rem;
}

.msgr-att__file-icon {
	display: grid;
	width: 2.4rem;
	height: 2.4rem;
	flex-shrink: 0;
	place-items: center;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.07);
	color: #ffffff;
}

.msgr-att__file-name {
	overflow: hidden;
	padding: 0;
	border: 0;
	background: none;
	color: #7cc4ff;
	font: inherit;
	font-size: 0.875rem;
	font-weight: 600;
	text-align: left;
	text-overflow: ellipsis;
	white-space: nowrap;
	cursor: pointer;
}

.msgr-att__file-name:hover {
	text-decoration: underline;
}

.msgr-att__file-size {
	font-size: 0.72rem;
	opacity: 0.6;
}

.msgr-att__icon-btn {
	display: grid;
	width: 2rem;
	height: 2rem;
	flex-shrink: 0;
	place-items: center;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-base);
	cursor: pointer;
	opacity: 0.75;
	transition:
		background 0.12s ease,
		opacity 0.12s ease;
}

.msgr-att__icon-btn:hover {
	background: rgba(255, 255, 255, 0.08);
	opacity: 1;
}

.msgr-att__icon-btn svg {
	width: 1.05rem;
	height: 1.05rem;
}

.msgr-att__download {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.4rem 0.7rem;
	border: 0;
	border-radius: 6px;
	background: var(--color-brand);
	color: white;
	font: inherit;
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
	transition: filter 0.12s ease;
}

.msgr-att__file.is-build .msgr-att__file-icon {
	background: color-mix(in srgb, var(--color-brand) 18%, transparent);
	color: var(--color-brand);
}

.msgr-att__download.is-install {
	background: #23a55a;
}

.msgr-att__download.is-install:hover {
	background: var(--color-brand);
}

.msgr-att__download:hover {
	filter: brightness(1.12);
}

.msgr-att__download:disabled {
	opacity: 0.6;
	cursor: progress;
}

.msgr-att__download svg {
	width: 0.95rem;
	height: 0.95rem;
}

@keyframes msgr-att-pulse {
	50% {
		opacity: 0.55;
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-att__image img,
	.msgr-att__play,
	.msgr-att__audio-btn {
		transition: none;
		animation: none;
	}
}
</style>
