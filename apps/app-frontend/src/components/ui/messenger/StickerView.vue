<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { mediaBlobUrl } from './media'
import ServiceImage from './ServiceImage.vue'
import { loadStickerJson, type StickerKind } from './stickers'

const props = withDefaults(defineProps<{ url: string; kind: StickerKind; size?: number }>(), {
	size: 160,
})

type Player = { destroy: () => void; play: () => void; pause: () => void }

const host = ref<HTMLElement | null>(null)
const visible = ref(false)
const failed = ref(false)

/** Видео-стикер с чужого домена вебвью не играет (CSP) — отдаём его как blob. */
const videoSrc = ref('')

async function loadVideo(): Promise<void> {
	if (props.kind !== 'video' || videoSrc.value) return
	const url = props.url
	if (/^(blob:|data:)/.test(url)) {
		videoSrc.value = url
		return
	}
	try {
		const blob = await mediaBlobUrl(url, 'video/webm')
		if (url === props.url) videoSrc.value = blob
	} catch {
		if (url === props.url) failed.value = true
	}
}

let player: Player | null = null
let observer: IntersectionObserver | null = null
let seq = 0

function release(): void {
	seq += 1
	player?.destroy()
	player = null
}

/** Lottie подключаем лениво и только для видимых стикеров — иначе лента начинает тормозить. */
async function mountLottie(): Promise<void> {
	const el = host.value
	if (!el || player || props.kind !== 'lottie') return
	const ticket = ++seq
	try {
		const [{ default: lottie }, data] = await Promise.all([
			import('lottie-web/build/player/lottie_light_canvas'),
			loadStickerJson(props.url),
		])
		if (ticket !== seq || !host.value || !visible.value) return
		player = lottie.loadAnimation({
			container: host.value,
			renderer: 'canvas',
			loop: true,
			autoplay: !document.hidden,
			animationData: data,
			rendererSettings: { clearCanvas: true },
		}) as Player
	} catch {
		if (ticket === seq) failed.value = true
	}
}

function onVisibility(): void {
	if (!player) return
	if (document.hidden) player.pause()
	else player.play()
}

onMounted(() => {
	observer = new IntersectionObserver(
		(entries) => {
			visible.value = entries.some((entry) => entry.isIntersecting)
			if (visible.value) {
				void mountLottie()
				void loadVideo()
			} else release()
		},
		{ rootMargin: '120px' },
	)
	if (host.value) observer.observe(host.value)
	document.addEventListener('visibilitychange', onVisibility)
})

watch(
	() => props.url,
	() => {
		failed.value = false
		videoSrc.value = ''
		release()
		if (visible.value) {
			void mountLottie()
			void loadVideo()
		}
	},
)

onBeforeUnmount(() => {
	observer?.disconnect()
	document.removeEventListener('visibilitychange', onVisibility)
	release()
})
</script>

<template>
	<span
		ref="host"
		class="msgr-sticker"
		:class="{ 'is-failed': failed }"
		:style="{ width: `${size}px`, height: `${size}px` }"
	>
		<ServiceImage v-if="kind === 'image' && visible" :src="url" @failed="failed = true" />
		<video
			v-else-if="kind === 'video' && visible && videoSrc"
			:src="videoSrc"
			muted
			playsinline
			loop
			autoplay
			preload="metadata"
		/>
		<span v-if="failed" class="msgr-sticker__fail">✦</span>
	</span>
</template>

<style scoped>
.msgr-sticker {
	position: relative;
	display: inline-grid;
	flex-shrink: 0;
	place-items: center;
	overflow: hidden;
}

.msgr-sticker img,
.msgr-sticker video,
.msgr-sticker :deep(canvas) {
	width: 100% !important;
	height: 100% !important;
	object-fit: contain;
}

.msgr-sticker__fail {
	color: var(--color-secondary);
	font-size: 1.4rem;
	opacity: 0.6;
}
</style>
