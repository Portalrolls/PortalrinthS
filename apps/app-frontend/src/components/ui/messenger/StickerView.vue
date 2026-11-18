<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { loadStickerJson, type StickerKind } from './stickers'

const props = withDefaults(defineProps<{ url: string; kind: StickerKind; size?: number }>(), {
	size: 160,
})

type Player = { destroy: () => void; play: () => void; pause: () => void }

const host = ref<HTMLElement | null>(null)
const visible = ref(false)
const failed = ref(false)

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
			if (visible.value) void mountLottie()
			else release()
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
		release()
		if (visible.value) void mountLottie()
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
		<img
			v-if="kind === 'image' && visible"
			:src="url"
			alt=""
			draggable="false"
			loading="lazy"
			decoding="async"
		/>
		<video
			v-else-if="kind === 'video' && visible"
			:src="url"
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
