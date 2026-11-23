<script setup lang="ts">
import { PlugIcon } from '@modrinth/assets'
import { defineMessages, useVIntl } from '@modrinth/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
	createPageSdk,
	type InstalledPlugin,
	plugins,
	pluginSafeMode,
} from '@/helpers/portalrinth-plugins'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	title: {
		id: 'app.plugins.page.title',
		defaultMessage: 'Вкладка плагина',
	},
	notFound: {
		id: 'app.plugins.page.not-found',
		defaultMessage: 'Плагин или вкладка не найдены.',
	},
	disabled: {
		id: 'app.plugins.page.disabled',
		defaultMessage:
			'Плагин выключен, либо включён Безопасный режим (Ctrl+Shift+Alt+P) — включите плагин в Настройках.',
	},
})

const route = useRoute()

const plugin = computed<InstalledPlugin | undefined>(() =>
	plugins.find((entry) => entry.manifest.id === String(route.params.pluginId ?? '')),
)

const page = computed(() =>
	plugin.value?.manifest.pages?.find((entry) => entry.id === String(route.params.pageId ?? '')),
)

const rootEl = ref<HTMLElement | null>(null)
let pageCleanups: (() => void)[] = []

function renderPage() {
	for (const cleanup of pageCleanups) cleanup()
	pageCleanups = []
	const root = rootEl.value
	if (!root) return
	root.innerHTML = ''
	const target = plugin.value
	const targetPage = page.value
	if (!target || !targetPage || !target.enabled || pluginSafeMode.value) return
	if (targetPage.html) root.innerHTML = targetPage.html
	const entryPath = targetPage.entry
	if (entryPath) {
		const code = target.files[entryPath]
		if (code) {
			const sdk = createPageSdk(target.manifest.id, pageCleanups)
			;(window as unknown as { noctrinth?: unknown }).noctrinth = sdk
			try {
				const factory = new Function('noctrinth', 'root', 'window', 'document', code)
				factory(sdk, root, window, document)
			} catch (error) {
				console.warn(`[plugin:${target.manifest.id}] page script error`, error)
			}
		}
	}
}

onMounted(renderPage)
watch([plugin, page, rootEl, () => pluginSafeMode.value], renderPage)
onBeforeUnmount(() => {
	for (const cleanup of pageCleanups) cleanup()
	pageCleanups = []
})
</script>

<template>
	<div class="page-container">
		<div class="flex flex-col gap-1 pb-4">
			<h1 class="m-0 flex items-center gap-2 text-2xl font-bold text-primary">
				<PlugIcon class="text-brand" />
				{{ page ? page.title : formatMessage(messages.title) }}
			</h1>
			<p v-if="plugin && page" class="m-0 text-sm text-secondary">
				{{ plugin.manifest.name }}
				<template v-if="plugin.manifest.author"> · {{ plugin.manifest.author }}</template>
			</p>
		</div>

		<div
			v-if="!plugin || !page"
			class="flex items-center gap-2 rounded-xl border border-solid border-surface-5 bg-surface-2 p-4 text-secondary"
		>
			<PlugIcon class="size-5" />
			<p class="m-0 text-sm">{{ formatMessage(messages.notFound) }}</p>
		</div>
		<div
			v-else-if="!plugin.enabled || pluginSafeMode"
			class="flex items-center gap-2 rounded-xl border border-solid border-surface-5 bg-surface-2 p-4 text-secondary"
		>
			<PlugIcon class="size-5" />
			<p class="m-0 text-sm">{{ formatMessage(messages.disabled) }}</p>
		</div>
		<div v-else ref="rootEl" class="plugin-page-root flex flex-col gap-2" />
	</div>
</template>
