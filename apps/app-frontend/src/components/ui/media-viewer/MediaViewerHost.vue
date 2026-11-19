<script setup lang="ts">
import { DownloadIcon, ExternalIcon, ImageIcon, SpinnerIcon } from '@modrinth/assets'
import {
	Avatar,
	IconButton,
	ImageViewerEditor,
	type ImageViewerEditorItem,
	injectNotificationManager,
	useVIntl,
} from '@modrinth/ui'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { readSelectedBuild } from '@/helpers/ai-assistant'
import { add_screenshot, getInstanceIconUrl, list as listInstances } from '@/helpers/instance'
import { imageBytes, mediaViewer, pngBytes } from '@/helpers/media-viewer'

const { formatMessage } = useVIntl()
const { addNotification } = injectNotificationManager()

const t = (id: string, fallback: string, values?: Record<string, unknown>) =>
	formatMessage({ id, defaultMessage: fallback }, values as never)

const viewer = ref<InstanceType<typeof ImageViewerEditor>>()

const items = computed<ImageViewerEditorItem[]>(() =>
	mediaViewer.items.map((item, index) => ({
		id: `${mediaViewer.seq}:${index}`,
		src: item.src,
		alt: item.name || '',
		title: item.name || undefined,
	})),
)

function sourceOf(item: ImageViewerEditorItem) {
	const index = Number(item.id.split(':')[1])
	return mediaViewer.items[index] ?? null
}

watch(
	() => mediaViewer.seq,
	async () => {
		chooserOpen.value = false
		await nextTick()
		viewer.value?.show(mediaViewer.index)
	},
)

function baseName(item: ImageViewerEditorItem): string {
	const raw = (item.alt || '').replace(/\.[a-z0-9]{2,5}$/i, '')
	return raw.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'image'
}

// ---- Скачать ----------------------------------------------------------------

const downloading = ref(false)

async function download(item: ImageViewerEditorItem): Promise<void> {
	if (downloading.value) return
	const animated = Boolean(sourceOf(item)?.animated)
	const extension = animated ? 'gif' : /\.(jpe?g|webp)$/i.exec(item.alt)?.[1] || 'png'
	const path = await save({
		defaultPath: `${baseName(item)}.${extension}`,
		filters: [{ name: t('app.media-viewer.image', 'Изображение'), extensions: [extension] }],
	}).catch(() => null)
	if (!path) return
	downloading.value = true
	try {
		await writeFile(path, await imageBytes(item.src))
		addNotification({
			title: t('app.media-viewer.downloaded', 'Изображение сохранено'),
			text: path,
			type: 'success',
		})
	} catch (error) {
		addNotification({
			title: t('app.media-viewer.downloadFailed', 'Не удалось сохранить'),
			text: String(error),
			type: 'error',
		})
	} finally {
		downloading.value = false
	}
}

// ---- В скриншоты ------------------------------------------------------------

type Target = { id: string; name: string; icon?: string }

const targets = ref<Target[]>([])
const chooserOpen = ref(false)
const saving = ref(false)
let pending: ImageViewerEditorItem | null = null

async function loadTargets(): Promise<void> {
	try {
		const instances = await listInstances()
		targets.value = instances.map((instance) => ({
			id: instance.id,
			name: instance.name,
			icon: getInstanceIconUrl(instance.icon_path) ?? undefined,
		}))
	} catch {
		targets.value = []
	}
}

async function saveTo(target: Target): Promise<void> {
	const item = pending
	chooserOpen.value = false
	if (!item || saving.value) return
	saving.value = true
	try {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
		const saved = await add_screenshot(
			target.id,
			`${baseName(item)}-${stamp}.png`,
			await pngBytes(item.src),
		)
		addNotification({
			title: t('app.media-viewer.savedToScreens', 'Сохранено в скриншоты'),
			text: `«${target.name}» · ${saved.file_name}`,
			type: 'success',
		})
	} catch (error) {
		addNotification({
			title: t('app.media-viewer.saveToScreensFailed', 'Не удалось сохранить в скриншоты'),
			text: String(error),
			type: 'error',
		})
	} finally {
		saving.value = false
	}
}

async function toScreenshots(item: ImageViewerEditorItem): Promise<void> {
	if (saving.value) return
	if (chooserOpen.value) {
		chooserOpen.value = false
		return
	}
	pending = item
	await loadTargets()
	if (!targets.value.length) {
		addNotification({
			title: t('app.media-viewer.noInstances', 'Нет сборок'),
			text: t(
				'app.media-viewer.noInstancesText',
				'Скриншоты хранятся в сборках — создайте хотя бы одну.',
			),
			type: 'warn',
		})
		return
	}
	if (targets.value.length === 1) {
		await saveTo(targets.value[0])
		return
	}
	const selected = readSelectedBuild()?.id
	targets.value.sort((a, b) => Number(b.id === selected) - Number(a.id === selected))
	chooserOpen.value = true
}

function onOutside(event: PointerEvent): void {
	if (!chooserOpen.value) return
	const el = event.target as HTMLElement | null
	if (el?.closest('.mv-screens')) return
	chooserOpen.value = false
}

watch(chooserOpen, (open) => {
	if (open) document.addEventListener('pointerdown', onOutside, true)
	else document.removeEventListener('pointerdown', onOutside, true)
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

const isRemote = (src: string) => /^https?:\/\//.test(src)
</script>

<template>
	<ImageViewerEditor ref="viewer" :items="items" editor="disabled" @hide="chooserOpen = false">
		<template #actions="{ item }">
			<div v-if="!sourceOf(item)?.animated" class="mv-screens">
				<IconButton
					v-tooltip="t('app.media-viewer.toScreens', 'В скриншоты')"
					:label="t('app.media-viewer.toScreens', 'В скриншоты')"
					type="quiet"
					:disabled="saving"
					@click="toScreenshots(item)"
				>
					<SpinnerIcon v-if="saving" class="animate-spin" />
					<ImageIcon v-else />
				</IconButton>
				<div v-if="chooserOpen" class="mv-screens__menu">
					<p>{{ t('app.media-viewer.pickInstance', 'В какую сборку?') }}</p>
					<button
						v-for="target in targets"
						:key="target.id"
						type="button"
						class="mv-screens__option"
						@click="saveTo(target)"
					>
						<Avatar
							v-if="target.icon"
							:src="target.icon"
							size="22px"
							no-shadow
							class="!rounded-md"
						/>
						<span v-else class="mv-screens__stub">{{ target.name.slice(0, 1) }}</span>
						<span class="mv-screens__name">{{ target.name }}</span>
					</button>
				</div>
			</div>
			<IconButton
				v-tooltip="t('app.media-viewer.download', 'Скачать')"
				:label="t('app.media-viewer.download', 'Скачать')"
				type="quiet"
				:disabled="downloading"
				@click="download(item)"
			>
				<SpinnerIcon v-if="downloading" class="animate-spin" />
				<DownloadIcon v-else />
			</IconButton>
			<IconButton
				v-if="isRemote(item.src)"
				v-tooltip="t('app.media-viewer.openBrowser', 'Открыть в браузере')"
				:label="t('app.media-viewer.openBrowser', 'Открыть в браузере')"
				type="quiet"
				@click="openUrl(item.src)"
			>
				<ExternalIcon />
			</IconButton>
		</template>
	</ImageViewerEditor>
</template>

<style scoped>
.mv-screens {
	position: relative;
}

.mv-screens__menu {
	position: absolute;
	right: 50%;
	bottom: calc(100% + 0.75rem);
	z-index: 5;
	display: flex;
	min-width: 15rem;
	max-height: 18rem;
	flex-direction: column;
	gap: 0.1rem;
	overflow-y: auto;
	padding: 0.35rem;
	border: 1px solid rgb(255 255 255 / 10%);
	border-radius: 0.8rem;
	background: #16171b;
	box-shadow: 0 16px 40px rgb(0 0 0 / 55%);
	transform: translateX(50%);
}

.mv-screens__menu p {
	margin: 0;
	padding: 0.3rem 0.5rem 0.35rem;
	color: var(--color-secondary);
	font-size: 0.75rem;
	font-weight: 600;
}

.mv-screens__option {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.4rem 0.5rem;
	border: 0;
	border-radius: 0.55rem;
	background: transparent;
	color: var(--color-contrast);
	font-size: 0.85rem;
	text-align: left;
	cursor: pointer;
}

.mv-screens__option:hover {
	background: rgb(255 255 255 / 8%);
}

.mv-screens__stub {
	display: grid;
	width: 22px;
	height: 22px;
	flex-shrink: 0;
	place-items: center;
	border-radius: 6px;
	background: rgb(255 255 255 / 8%);
	font-size: 0.7rem;
	font-weight: 700;
	text-transform: uppercase;
}

.mv-screens__name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
