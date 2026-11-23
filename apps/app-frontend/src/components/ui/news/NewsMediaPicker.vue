<script setup lang="ts">
import { CheckIcon, PlusIcon, XIcon } from '@modrinth/assets'
import { readFile } from '@tauri-apps/plugin-fs'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { type InstanceScreenshot, list_all_screenshots } from '@/helpers/instance'
import { compressImageFile } from '@/helpers/uprojects-service'

import { useNewsText } from './feed'

/**
 * Большая центральная панель выбора картинок для поста: сверху — «плюс» и
 * зона перетаскивания (всегда наверху), ниже — скриншоты со страницы
 * «Скриншоты» лаунчера: нажал — картинка прикрепилась к посту. Вставка из
 * буфера (Ctrl+V) тоже работает, пока панель открыта.
 */
const props = defineProps<{
	open: boolean
	count: number
	maxImages: number
}>()

const emit = defineEmits<{
	close: []
	add: [urls: string[]]
	remove: [url: string]
}>()

const { t } = useNewsText()

const shots = ref<InstanceScreenshot[]>([])
const loading = ref(false)
const busy = ref(false)
const notice = ref('')
/** Путь скриншота → адрес картинки в посте: по второму клику снимаем. */
const added = ref(new Map<string, string>())
const dragDepth = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)

const atMax = computed(() => props.count >= props.maxImages)
const remaining = computed(() => Math.max(0, props.maxImages - props.count))
const dragOver = computed(() => dragDepth.value > 0)

function nameOf(path: string): string {
	const parts = path.split(/[\\/]/)
	return parts[parts.length - 1] || 'screenshot.png'
}

async function reload() {
	loading.value = true
	try {
		const all = await list_all_screenshots()
		shots.value = [...all].sort((a, b) => b.modified_at - a.modified_at)
	} catch {
		shots.value = []
	}
	loading.value = false
}

function onKey(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		event.stopPropagation()
		emit('close')
	}
}

function onPaste(event: ClipboardEvent) {
	const items = event.clipboardData?.items
	if (!items) return
	const files: File[] = []
	for (const item of items) {
		if (item.kind === 'file' && item.type.startsWith('image/')) {
			const file = item.getAsFile()
			if (file) files.push(file)
		}
	}
	if (!files.length) return
	event.preventDefault()
	void handleFiles(files)
}

async function handleFiles(list: File[]) {
	if (!remaining.value) {
		notice.value = t('app.news.imagesLimit', 'Можно прикрепить не больше {n} фото', {
			n: props.maxImages,
		})
		return
	}
	const room = remaining.value
	if (list.length > room) {
		notice.value = t('app.news.imagesLimit', 'Можно прикрепить не больше {n} фото', {
			n: props.maxImages,
		})
	}
	busy.value = true
	const urls: string[] = []
	for (const file of list.slice(0, room)) {
		try {
			urls.push(await compressImageFile(file))
		} catch {
			notice.value = t('app.news.imageBroken', 'Не получилось прочитать «{name}»', {
				name: file.name,
			})
		}
	}
	busy.value = false
	if (urls.length) {
		urls.forEach((url) => emit('add', [url]))
	}
}

function onDrop(event: DragEvent) {
	dragDepth.value = 0
	const files = Array.from(event.dataTransfer?.files ?? [])
	if (files.length) void handleFiles(files)
}

/** Повторный клик по применённому скриншоту убирает его из поста. */
function removeShot(shot: InstanceScreenshot) {
	const url = added.value.get(shot.path)
	if (!url) return
	added.value.delete(shot.path)
	emit('remove', url)
}

async function addShot(shot: InstanceScreenshot) {
	if (busy.value) return
	if (added.value.has(shot.path)) {
		removeShot(shot)
		return
	}
	if (atMax.value) {
		notice.value = t('app.news.imagesLimit', 'Можно прикрепить не больше {n} фото', {
			n: props.maxImages,
		})
		return
	}
	busy.value = true
	notice.value = ''
	try {
		const bytes = await readFile(shot.path)
		const file = new File([bytes], nameOf(shot.path), { type: 'image/png' })
		const url = await compressImageFile(file)
		added.value.set(shot.path, url)
		emit('add', [url])
	} catch {
		notice.value = t('app.news.imageBroken', 'Не получилось прочитать «{name}»', {
			name: nameOf(shot.path),
		})
	}
	busy.value = false
}

watch(
	() => props.open,
	(open) => {
		if (open) {
			notice.value = ''
			dragDepth.value = 0
			void reload()
			document.addEventListener('paste', onPaste)
			document.addEventListener('keydown', onKey)
		} else {
			document.removeEventListener('paste', onPaste)
			document.removeEventListener('keydown', onKey)
		}
	},
)

onBeforeUnmount(() => {
	document.removeEventListener('paste', onPaste)
	document.removeEventListener('keydown', onKey)
})
</script>

<template>
	<Teleport to="body">
		<Transition name="nf-picker">
			<div v-if="open" class="nf-picker">
				<div class="nf-picker__backdrop" @click="emit('close')" />
				<div class="nf-picker__panel" role="dialog" aria-modal="true">
					<header class="nf-picker__head">
						<h3>{{ t('app.news.pickImages', 'Выбрать изображения') }}</h3>
						<button
							type="button"
							class="nf-picker__close"
							:aria-label="t('app.news.pickClose', 'Закрыть')"
							:title="t('app.news.pickClose', 'Закрыть')"
							@click="emit('close')"
						>
							<XIcon />
						</button>
					</header>
					<div
						class="nf-picker__drop"
						:class="{ 'is-over': dragOver, 'is-max': atMax }"
						@click="!atMax && fileInput?.click()"
						@dragenter.prevent="dragDepth++"
						@dragover.prevent
						@dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)"
						@drop.prevent="onDrop"
					>
						<button
							type="button"
							class="nf-picker__plus"
							:disabled="atMax || busy"
							:aria-label="t('app.news.pickAdd', 'Добавить файлы')"
							:title="t('app.news.pickAdd', 'Добавить файлы')"
							@click.stop="!atMax && fileInput?.click()"
						>
							<PlusIcon />
						</button>
						<p>
							{{
								atMax
									? t('app.news.pickMax', 'Больше нельзя — убери лишнее из поста', {
											n: maxImages,
										})
									: dragOver
										? t('app.news.pickDropNow', 'Отпускай!')
										: t(
												'app.news.pickHint',
												'Перетащи картинки сюда, нажми «+» или вставь из буфера (Ctrl+V)',
											)
							}}
						</p>
					</div>
					<div class="nf-picker__body">
						<h4>{{ t('app.news.pickScreenshots', 'Скриншоты') }}</h4>
						<div v-if="loading" class="nf-picker__spinner" />
						<p v-else-if="!shots.length" class="nf-picker__state">
							{{
								t(
									'app.news.pickEmpty',
									'Скриншотов пока нет — сделай их в игре или перетащи файлы сюда.',
								)
							}}
						</p>
						<div v-else class="nf-picker__grid">
							<button
								v-for="shot in shots"
								:key="shot.path"
								type="button"
								class="nf-picker__tile"
								:class="{ 'is-added': added.has(shot.path) }"
								:disabled="busy"
								:title="shot.instance_name"
								@click="addShot(shot)"
							>
								<img :src="shot.url" loading="lazy" alt="" />
								<small>{{ shot.instance_name }}</small>
								<span v-if="added.has(shot.path)" class="nf-picker__check"><CheckIcon /></span>
							</button>
						</div>
					</div>
					<p v-if="notice" class="nf-picker__notice">{{ notice }}</p>
					<input
						ref="fileInput"
						type="file"
						accept="image/*"
						multiple
						hidden
						@change="
							(event) => {
								const target = event.target as HTMLInputElement
								const list = Array.from(target.files || [])
								target.value = ''
								if (list.length) void handleFiles(list)
							}
						"
					/>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.nf-picker {
	position: fixed;
	z-index: 70;
	display: grid;
	inset: 0;
	place-items: center;
}

.nf-picker__backdrop {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.62);
	backdrop-filter: blur(4px);
}

.nf-picker__panel {
	position: relative;
	z-index: 1;
	display: flex;
	width: min(920px, 94vw);
	height: min(86vh, 760px);
	flex-direction: column;
	gap: 12px;
	padding: 16px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 18px;
	background: var(--nf-card);
	box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
}

.nf-picker__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
}

.nf-picker__head h3 {
	margin: 0;
	color: var(--color-contrast, #fff);
	font-size: 17px;
	font-weight: 700;
}

.nf-picker__close {
	display: grid;
	place-items: center;
	width: 34px;
	height: 34px;
	padding: 0;
	border: 0;
	border-radius: 10px;
	background: transparent;
	color: rgba(255, 255, 255, 0.65);
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.nf-picker__close:hover {
	background: rgba(255, 255, 255, 0.08);
	color: #fff;
}

.nf-picker__close svg {
	width: 18px;
	height: 18px;
}

.nf-picker__drop {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	gap: 14px;
	padding: 14px 18px;
	border: 2px dashed rgba(255, 255, 255, 0.16);
	border-radius: 14px;
	background: var(--nf-inset);
	cursor: pointer;
	transition:
		border-color 0.15s ease,
		background-color 0.15s ease;
}

.nf-picker__drop:hover {
	border-color: rgba(255, 255, 255, 0.3);
}

.nf-picker__drop.is-over {
	border-color: var(--color-brand);
	background: color-mix(in srgb, var(--color-brand) 10%, transparent);
}

.nf-picker__drop.is-max {
	opacity: 0.55;
	cursor: default;
}

.nf-picker__plus {
	display: grid;
	place-items: center;
	width: 52px;
	height: 52px;
	flex-shrink: 0;
	padding: 0;
	border: 0;
	border-radius: 14px;
	background: var(--color-brand);
	color: #fff;
	cursor: pointer;
	transition:
		transform 0.15s ease,
		opacity 0.15s ease;
}

.nf-picker__plus:hover:not(:disabled) {
	transform: scale(1.05);
}

.nf-picker__plus:disabled {
	cursor: default;
	opacity: 0.45;
}

.nf-picker__plus svg {
	width: 24px;
	height: 24px;
}

.nf-picker__drop p {
	margin: 0;
	color: var(--color-secondary, rgba(255, 255, 255, 0.6));
	font-size: 13.5px;
	line-height: 1.4;
}

.nf-picker__body {
	display: flex;
	min-height: 0;
	flex: 1;
	flex-direction: column;
	overflow-y: auto;
}

.nf-picker__body h4 {
	margin: 2px 0 10px;
	color: var(--color-secondary, rgba(255, 255, 255, 0.45));
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
}

.nf-picker__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: 10px;
	align-content: start;
}

.nf-picker__tile {
	position: relative;
	aspect-ratio: 16 / 10;
	overflow: hidden;
	padding: 0;
	border: 2px solid transparent;
	border-radius: 12px;
	background: var(--nf-inset);
	cursor: pointer;
	transition:
		border-color 0.15s ease,
		transform 0.15s ease;
}

.nf-picker__tile:hover:not(:disabled) {
	border-color: var(--color-brand);
	transform: translateY(-1px);
}

.nf-picker__tile:disabled {
	cursor: default;
	opacity: 0.45;
}

.nf-picker__tile.is-added {
	border-color: #23a55a;
}

.nf-picker__tile img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.nf-picker__tile small {
	position: absolute;
	right: 8px;
	bottom: 8px;
	left: 8px;
	overflow: hidden;
	padding: 2px 7px;
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.68);
	color: #fff;
	font-size: 11px;
	text-align: left;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.nf-picker__check {
	position: absolute;
	top: 8px;
	right: 8px;
	display: grid;
	place-items: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: #23a55a;
	color: #fff;
}

.nf-picker__check svg {
	width: 14px;
	height: 14px;
}

.nf-picker__state {
	margin: 0;
	padding: 26px 10px;
	color: var(--color-secondary, rgba(255, 255, 255, 0.5));
	font-size: 13.5px;
	text-align: center;
}

.nf-picker__spinner {
	width: 26px;
	height: 26px;
	margin: 26px auto;
	border: 3px solid rgba(255, 255, 255, 0.14);
	border-top-color: var(--color-brand);
	border-radius: 50%;
	animation: nf-picker-spin 0.8s linear infinite;
}

@keyframes nf-picker-spin {
	to {
		transform: rotate(360deg);
	}
}

.nf-picker__notice {
	margin: 0;
	color: var(--color-orange);
	font-size: 12.5px;
}

.nf-picker-enter-active,
.nf-picker-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.nf-picker-enter-from,
.nf-picker-leave-to {
	opacity: 0;
}

.nf-picker-enter-from .nf-picker__panel,
.nf-picker-leave-to .nf-picker__panel {
	transform: scale(0.97);
}

@media (max-width: 720px) {
	.nf-picker__panel {
		width: 100vw;
		height: 100dvh;
		max-width: 100vw;
		border: 0;
		border-radius: 0;
	}

	.nf-picker__grid {
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
	}
}

@media (prefers-reduced-motion: reduce) {
	.nf-picker-enter-active,
	.nf-picker-leave-active,
	.nf-picker__tile,
	.nf-picker__plus {
		transition: none;
	}

	.nf-picker__spinner {
		animation: none;
	}
}
</style>
