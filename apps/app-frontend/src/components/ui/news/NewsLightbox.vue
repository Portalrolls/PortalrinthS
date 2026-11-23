<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon, ExternalIcon, XIcon } from '@modrinth/assets'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, onBeforeUnmount, onMounted } from 'vue'

import { useNewsText } from './feed'
import { closeLightbox, lightbox, stepLightbox } from './lightbox'

const { t } = useNewsText()

const current = computed(() => lightbox.items[lightbox.index])

function onKey(event: KeyboardEvent) {
	if (!lightbox.open) return
	if (event.key === 'Escape') {
		event.stopPropagation()
		closeLightbox()
	} else if (event.key === 'ArrowLeft') stepLightbox(-1)
	else if (event.key === 'ArrowRight') stepLightbox(1)
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey, true)
	closeLightbox()
})
</script>

<template>
	<Teleport to="body">
		<Transition name="nf-lb">
			<div
				v-if="lightbox.open && current"
				class="nf-lb"
				role="dialog"
				aria-modal="true"
				@click.self="closeLightbox"
			>
				<div class="nf-lb__bar">
					<span v-if="lightbox.items.length > 1" class="nf-lb__count">
						{{ lightbox.index + 1 }} / {{ lightbox.items.length }}
					</span>
					<span class="nf-lb__gap" />
					<button
						type="button"
						class="nf-lb__btn"
						:aria-label="t('app.news.openInBrowser', 'Открыть в браузере')"
						@click="openUrl(current.url)"
					>
						<ExternalIcon />
					</button>
					<button
						type="button"
						class="nf-lb__btn"
						:aria-label="t('app.news.close', 'Закрыть')"
						@click="closeLightbox"
					>
						<XIcon />
					</button>
				</div>
				<Transition name="nf-lb-img" mode="out-in">
					<video
						v-if="current.video"
						:key="current.url"
						class="nf-lb__media"
						:src="current.url"
						controls
						autoplay
						playsinline
					/>
					<img v-else :key="current.url" class="nf-lb__media" :src="current.url" alt="" />
				</Transition>
				<template v-if="lightbox.items.length > 1">
					<button
						type="button"
						class="nf-lb__nav nf-lb__nav--prev"
						:aria-label="t('app.news.prevMedia', 'Предыдущее фото')"
						@click="stepLightbox(-1)"
					>
						<ChevronLeftIcon />
					</button>
					<button
						type="button"
						class="nf-lb__nav nf-lb__nav--next"
						:aria-label="t('app.news.nextMedia', 'Следующее фото')"
						@click="stepLightbox(1)"
					>
						<ChevronRightIcon />
					</button>
				</template>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.nf-lb {
	position: fixed;
	inset: 0;
	z-index: 400;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 56px 72px 32px;
	background: rgba(6, 6, 8, 0.86);
	backdrop-filter: blur(14px);
	-webkit-backdrop-filter: blur(14px);
}

.nf-lb__bar {
	position: absolute;
	top: 12px;
	left: 16px;
	right: 16px;
	display: flex;
	align-items: center;
	gap: 8px;
}

.nf-lb__count {
	color: rgba(255, 255, 255, 0.75);
	font-size: 13px;
	font-variant-numeric: tabular-nums;
}

.nf-lb__gap {
	flex: 1;
}

.nf-lb__btn,
.nf-lb__nav {
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: var(--nf-lb);
	color: #fff;
	cursor: pointer;
	transition:
		background-color 0.18s ease,
		transform 0.18s ease;
}

.nf-lb__btn:hover,
.nf-lb__nav:hover {
	background: var(--nf-lb2);
	transform: scale(1.06);
}

.nf-lb__btn svg,
.nf-lb__nav svg {
	width: 18px;
	height: 18px;
}

.nf-lb__nav {
	position: absolute;
	top: 50%;
	margin-top: -18px;
}

.nf-lb__nav--prev {
	left: 18px;
}

.nf-lb__nav--next {
	right: 18px;
}

.nf-lb__media {
	max-width: 100%;
	max-height: 100%;
	border-radius: 10px;
	box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
	object-fit: contain;
}

.nf-lb-enter-active,
.nf-lb-leave-active {
	transition: opacity 0.2s ease;
}

.nf-lb-enter-from,
.nf-lb-leave-to {
	opacity: 0;
}

.nf-lb-img-enter-active,
.nf-lb-img-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.nf-lb-img-enter-from,
.nf-lb-img-leave-to {
	opacity: 0;
	transform: scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
	.nf-lb-enter-active,
	.nf-lb-leave-active,
	.nf-lb-img-enter-active,
	.nf-lb-img-leave-active,
	.nf-lb__btn,
	.nf-lb__nav {
		transition: none;
	}
}
</style>
