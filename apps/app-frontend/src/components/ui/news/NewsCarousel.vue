<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon } from '@modrinth/assets'
import { computed, ref, watch } from 'vue'

import { resolveServiceMedia } from '@/helpers/uprojects-service'

import { type FeedAttachment, mediaIsVideo, useNewsText } from './feed'
import { openLightbox } from './lightbox'

const props = withDefaults(defineProps<{ items: FeedAttachment[]; tall?: boolean }>(), {
	tall: false,
})

const { t } = useNewsText()

const slides = computed(() =>
	props.items
		.filter((item) => String(item?.url || '').trim())
		.map((item, index) => {
			const url = /^(https?:|data:)/.test(item.url) ? item.url : resolveServiceMedia(item.url)
			return { key: item.id || `${index}:${url}`, url, video: mediaIsVideo({ ...item, url }) }
		}),
)

const index = ref(0)

watch(
	() => slides.value.length,
	(count) => {
		if (index.value >= count) index.value = 0
	},
)

function go(delta: number) {
	const count = slides.value.length
	if (count < 2) return
	index.value = (((index.value + delta) % count) + count) % count
}

function zoom(at: number) {
	openLightbox(
		slides.value.map((slide) => ({ url: slide.url, video: slide.video })),
		at,
	)
}

let touchX = 0

function onTouchStart(event: TouchEvent) {
	touchX = event.touches[0]?.clientX ?? 0
}

function onTouchEnd(event: TouchEvent) {
	const delta = (event.changedTouches[0]?.clientX ?? 0) - touchX
	if (Math.abs(delta) > 40) go(delta < 0 ? 1 : -1)
}
</script>

<template>
	<div
		v-if="slides.length"
		class="nf-car"
		:class="{ 'is-multi': slides.length > 1, 'is-tall': tall }"
		@click.stop
		@keydown.left.stop="go(-1)"
		@keydown.right.stop="go(1)"
		@touchstart.passive="onTouchStart"
		@touchend="onTouchEnd"
	>
		<div class="nf-car__viewport">
			<div class="nf-car__track" :style="{ transform: `translateX(-${index * 100}%)` }">
				<div v-for="(slide, at) in slides" :key="slide.key" class="nf-car__slide">
					<button
						type="button"
						class="nf-car__open"
						:aria-label="t('app.news.openMedia', 'Открыть во весь экран')"
						:tabindex="at === index ? 0 : -1"
						@click="zoom(at)"
					>
						<video v-if="slide.video" :src="slide.url" muted preload="metadata" playsinline />
						<img v-else :src="slide.url" alt="" loading="lazy" draggable="false" />
					</button>
				</div>
			</div>
		</div>
		<template v-if="slides.length > 1">
			<button
				type="button"
				class="nf-car__nav nf-car__nav--prev"
				:aria-label="t('app.news.prevMedia', 'Предыдущее фото')"
				@click="go(-1)"
			>
				<ChevronLeftIcon />
			</button>
			<button
				type="button"
				class="nf-car__nav nf-car__nav--next"
				:aria-label="t('app.news.nextMedia', 'Следующее фото')"
				@click="go(1)"
			>
				<ChevronRightIcon />
			</button>
			<div class="nf-car__dots" role="tablist">
				<button
					v-for="(slide, at) in slides"
					:key="slide.key"
					type="button"
					class="nf-car__dot"
					:class="{ 'is-active': at === index }"
					role="tab"
					:aria-selected="at === index"
					:aria-label="t('app.news.mediaN', 'Фото {n}', { n: at + 1 })"
					@click="index = at"
				/>
			</div>
		</template>
	</div>
</template>

<style scoped>
.nf-car {
	position: relative;
	overflow: hidden;
	border-radius: 10px;
	background: #121214;
}

.nf-car__viewport {
	overflow: hidden;
}

.nf-car__track {
	display: flex;
	transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}

.nf-car__slide {
	flex: 0 0 100%;
	min-width: 0;
}

.nf-car__open {
	display: block;
	width: 100%;
	margin: 0;
	padding: 0;
	border: 0;
	background: none;
	cursor: zoom-in;
}

.nf-car__open img,
.nf-car__open video {
	display: block;
	width: 100%;
	height: 300px;
	object-fit: cover;
	background: #121214;
}

.nf-car.is-tall .nf-car__open img,
.nf-car.is-tall .nf-car__open video {
	height: auto;
	max-height: 62vh;
	object-fit: contain;
}

.nf-car__nav {
	position: absolute;
	top: 50%;
	display: grid;
	place-items: center;
	width: 30px;
	height: 30px;
	margin-top: -15px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: rgba(14, 14, 16, 0.86);
	color: #fff;
	cursor: pointer;
	opacity: 0.85;
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.nf-car__nav svg {
	width: 16px;
	height: 16px;
}

.nf-car__nav:hover {
	opacity: 1;
	transform: scale(1.08);
}

.nf-car__nav--prev {
	left: 10px;
}

.nf-car__nav--next {
	right: 10px;
}

.nf-car__dots {
	position: absolute;
	left: 50%;
	bottom: 8px;
	display: flex;
	gap: 5px;
	padding: 4px 6px;
	border-radius: 999px;
	background: rgba(14, 14, 16, 0.55);
	transform: translateX(-50%);
}

.nf-car__dot {
	width: 6px;
	height: 6px;
	padding: 0;
	border: 0;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.45);
	cursor: pointer;
	transition:
		width 0.2s ease,
		background-color 0.2s ease;
}

.nf-car__dot.is-active {
	width: 14px;
	background: #fff;
}

@media (prefers-reduced-motion: reduce) {
	.nf-car__track,
	.nf-car__nav,
	.nf-car__dot {
		transition: none;
	}
}
</style>
