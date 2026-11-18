<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { mediaBlobUrl, viaProxy } from './media'

/**
 * Картинка из сервиса. Сначала вебвью грузит её сам; если не вышло (или задан
 * прокси и напрямую сервис не открывается), качаем тем же клиентом, что и
 * API, и показываем как blob. Если и так не открылась — сообщаем наверх.
 */
const props = withDefaults(
	defineProps<{ src: string; mime?: string; lazy?: boolean; imgClass?: string | object }>(),
	{ mime: '', lazy: true, imgClass: '' },
)

const emit = defineEmits<{ failed: []; loaded: [] }>()

const shown = ref('')
const ready = ref(false)
let fellBack = false
let seq = 0
let stallTimer: ReturnType<typeof setTimeout> | null = null

/** Напрямую картинка может просто зависнуть без ошибки — тогда тоже идём запасным путём. */
const STALL_MS = 12000

function clearStall(): void {
	if (stallTimer) clearTimeout(stallTimer)
	stallTimer = null
	observer?.disconnect()
	observer = null
}

const el = ref<HTMLImageElement | null>(null)
let observer: IntersectionObserver | null = null

/** Отсчёт идёт, только когда картинку видно: ленивые за экраном и не должны грузиться. */
function armStall(ticket: number): void {
	requestAnimationFrame(() => {
		if (ticket !== seq || !el.value || ready.value) return
		observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return
			observer?.disconnect()
			observer = null
			stallTimer = setTimeout(() => {
				if (ticket === seq && !ready.value && !fellBack) void fallback(ticket)
			}, STALL_MS)
		})
		observer.observe(el.value)
	})
}

async function start(): Promise<void> {
	const ticket = ++seq
	clearStall()
	ready.value = false
	fellBack = false
	shown.value = ''
	if (!props.src) {
		emit('failed')
		return
	}
	if (/^(data:|blob:)/.test(props.src) || !(await viaProxy())) {
		if (ticket !== seq) return
		shown.value = props.src
		if (/^https?:/.test(props.src)) armStall(ticket)
		return
	}
	await fallback(ticket)
}

async function fallback(ticket = seq): Promise<void> {
	clearStall()
	fellBack = true
	try {
		const url = await mediaBlobUrl(props.src, props.mime)
		if (ticket === seq) shown.value = url
	} catch {
		if (ticket === seq) emit('failed')
	}
}

function onError(): void {
	if (fellBack) emit('failed')
	else void fallback()
}

function onLoad(): void {
	clearStall()
	ready.value = true
	emit('loaded')
}

watch(() => props.src, start, { immediate: true })

onBeforeUnmount(clearStall)
</script>

<template>
	<img
		v-if="shown"
		ref="el"
		:src="shown"
		alt=""
		draggable="false"
		:loading="lazy ? 'lazy' : 'eager'"
		decoding="async"
		:class="[imgClass, { 'svc-img--ready': ready }]"
		class="svc-img"
		@load="onLoad"
		@error="onError"
	/>
	<span v-else class="svc-img svc-img--wait" :class="imgClass" />
</template>

<style scoped>
.svc-img {
	opacity: 0;
	transition: opacity 0.22s ease;
}

.svc-img--ready {
	opacity: 1;
}

.svc-img--wait {
	display: block;
	min-width: 120px;
	min-height: 90px;
	opacity: 1;
	border-radius: inherit;
	background: linear-gradient(
		100deg,
		rgba(255, 255, 255, 0.04) 20%,
		rgba(255, 255, 255, 0.09) 40%,
		rgba(255, 255, 255, 0.04) 60%
	);
	background-size: 220% 100%;
	animation: svc-shimmer 1.3s linear infinite;
}

@keyframes svc-shimmer {
	from {
		background-position: 120% 0;
	}
	to {
		background-position: -120% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.svc-img--wait {
		animation: none;
	}
}
</style>
