<script setup lang="ts">
import { DownloadIcon, ExternalIcon, XIcon } from '@modrinth/assets'
import { openUrl } from '@tauri-apps/plugin-opener'
import { onBeforeUnmount, ref, watch } from 'vue'

import { useMessengerT } from './i18n'
import { downloadAttachment } from './media'
import ServiceImage from './ServiceImage.vue'
import { showToast } from './store'
import { vTip } from './tooltip'

const t = useMessengerT()

const current = ref<{ url: string; name: string } | null>(null)
const zoomed = ref(false)

function show(url: string, name: string): void {
	current.value = { url, name }
	zoomed.value = false
}

function close(): void {
	current.value = null
}

function onKey(event: KeyboardEvent): void {
	if (event.key === 'Escape') {
		event.stopPropagation()
		close()
	}
}

watch(current, (value) => {
	if (value) window.addEventListener('keydown', onKey, true)
	else window.removeEventListener('keydown', onKey, true)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

async function download(): Promise<void> {
	if (!current.value) return
	const result = await downloadAttachment(current.value.url, current.value.name)
	if (result === 'saved') showToast(t('app.messenger.file.saved', 'Файл сохранён'))
}

defineExpose({ show })
</script>

<template>
	<Teleport to="body">
		<Transition name="msgr-lightbox">
			<div v-if="current" class="msgr-lightbox" @click.self="close">
				<div class="msgr-lightbox__bar">
					<span class="msgr-lightbox__spacer" />
					<button
						v-tip:bottom="t('app.messenger.file.download', 'Скачать')"
						type="button"
						@click="download"
					>
						<DownloadIcon />
					</button>
					<button
						v-tip:bottom="t('app.messenger.file.openBrowser', 'Открыть в браузере')"
						type="button"
						@click="openUrl(current.url)"
					>
						<ExternalIcon />
					</button>
					<button v-tip:bottom="t('app.messenger.close', 'Закрыть')" type="button" @click="close">
						<XIcon />
					</button>
				</div>
				<ServiceImage
					:src="current.url"
					:lazy="false"
					:img-class="['msgr-lightbox__img', { 'is-zoomed': zoomed }]"
					@click="zoomed = !zoomed"
				/>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.msgr-lightbox {
	position: fixed;
	inset: 0;
	z-index: 300;
	display: grid;
	place-items: center;
	overflow: auto;
	background: rgba(0, 0, 0, 0.86);
	backdrop-filter: blur(6px);
}

.msgr-lightbox__bar {
	position: fixed;
	top: 0.8rem;
	right: 1rem;
	left: 1rem;
	z-index: 1;
	display: flex;
	align-items: center;
	gap: 0.4rem;
	color: #dbdee1;
	font-size: 0.85rem;
}

.msgr-lightbox__bar span {
	min-width: 0;
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-lightbox__bar button {
	display: grid;
	width: 2.4rem;
	height: 2.4rem;
	place-items: center;
	border: 0;
	border-radius: 50%;
	background: rgba(30, 31, 34, 0.9);
	color: #dbdee1;
	cursor: pointer;
	transition: background 0.12s ease;
}

.msgr-lightbox__bar button:hover {
	background: var(--color-brand);
	color: white;
}

.msgr-lightbox__bar svg {
	width: 1.15rem;
	height: 1.15rem;
}

.msgr-lightbox__img {
	max-width: 90vw;
	max-height: 86vh;
	border-radius: 6px;
	box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
	cursor: zoom-in;
	image-rendering: auto;
	transition: transform 0.2s ease;
}

.msgr-lightbox__img.is-zoomed {
	max-width: none;
	max-height: none;
	cursor: zoom-out;
}

.msgr-lightbox-enter-active,
.msgr-lightbox-leave-active {
	transition: opacity 0.18s ease;
}

.msgr-lightbox-enter-active .msgr-lightbox__img {
	animation: msgr-lightbox-pop 0.22s ease;
}

.msgr-lightbox-enter-from,
.msgr-lightbox-leave-to {
	opacity: 0;
}

@keyframes msgr-lightbox-pop {
	from {
		transform: scale(0.94);
	}
}

@media (prefers-reduced-motion: reduce) {
	.msgr-lightbox-enter-active,
	.msgr-lightbox-leave-active {
		transition: none;
	}

	.msgr-lightbox-enter-active .msgr-lightbox__img {
		animation: none;
	}
}
</style>
