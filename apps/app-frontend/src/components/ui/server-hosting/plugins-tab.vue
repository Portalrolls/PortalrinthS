<script setup lang="ts">
import { BoxIcon, FolderOpenIcon, TrashIcon, UploadIcon } from '@modrinth/assets'
import {
	Admonition,
	Button,
	defineMessages,
	EmptyState,
	injectNotificationManager,
	Toggle,
	useVIntl,
} from '@modrinth/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { open } from '@tauri-apps/plugin-dialog'
import { computed, ref, watch } from 'vue'

import { guessIcon, storedIcon } from '@/helpers/hosted-content'
import {
	type HostedPlugin,
	type HostedServerView,
	hosting_plugin_import,
	hosting_plugin_remove,
	hosting_plugin_toggle,
	hosting_plugins,
	hosting_restore_mods,
} from '@/helpers/hosting'
import { openPath } from '@/helpers/utils.js'

import ContentBrowser from './content-browser.vue'
import { contentFolder, contentKind, contentMessages, formatSize } from './content-kind'

const props = defineProps<{ server: HostedServerView }>()

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const queryClient = useQueryClient()
const messages = defineMessages({
	importButton: { id: 'app.server-hosting.content.import', defaultMessage: 'Add from file' },
	openFolder: { id: 'app.server-hosting.content.open-folder', defaultMessage: 'Open folder' },
	remove: { id: 'app.server-hosting.content.remove', defaultMessage: 'Delete' },
	empty: { id: 'app.server-hosting.content.empty', defaultMessage: 'Nothing is installed yet' },
	emptyHint: {
		id: 'app.server-hosting.content.empty-hint',
		defaultMessage: 'Add files from your computer, they take effect after a restart.',
	},
	restartHint: {
		id: 'app.server-hosting.content.restart-hint',
		defaultMessage: 'Changes take effect after the server restarts.',
	},
	tabInstalled: {
		id: 'app.server-hosting.content.tab-installed',
		defaultMessage: 'Installed',
	},
	tabCatalog: {
		id: 'app.server-hosting.content.tab-catalog',
		defaultMessage: 'Catalog of {kind}',
	},
	installedHint: {
		id: 'app.server-hosting.content.installed-hint',
		defaultMessage: 'Files from this computer or a catalog, active after a restart',
	},
	catalogHint: {
		id: 'app.server-hosting.content.catalog-hint',
		defaultMessage: 'Search Modrinth and CurseForge and install with one click',
	},
	modsOffTitle: {
		id: 'app.server-hosting.content.mods-off-title',
		defaultMessage: 'Mods are set aside',
	},
	modsOffHint: {
		id: 'app.server-hosting.content.mods-off-hint',
		defaultMessage:
			'The mods folder is parked as mods.disabled, so the server starts without them. Bring them back when the problem is fixed.',
	},
	modsRestore: {
		id: 'app.server-hosting.content.mods-restore',
		defaultMessage: 'Restore mods',
	},
})

/** Моды сняты после «запустить без модов» — вернём их одной кнопкой. */
const modsDisabled = computed(() => props.server.mods_disabled)
const modsBusy = ref(false)

async function restoreMods() {
	if (modsBusy.value) return
	modsBusy.value = true
	try {
		await hosting_restore_mods(props.server.id)
		await queryClient.invalidateQueries({ queryKey: ['server-hosting'] })
	} catch (error) {
		handleError(error as Error)
	} finally {
		modsBusy.value = false
	}
}

const kind = computed(() => contentKind(props.server))
const kindLabel = computed(() => formatMessage(contentMessages[kind.value]))
const subTab = ref<'installed' | 'catalog'>('installed')

const queryKey = computed(() => ['server-hosting', 'plugins', props.server.id] as const)
const pluginsQuery = useQuery({
	queryKey,
	queryFn: () => hosting_plugins(props.server.id),
	refetchOnWindowFocus: false,
})
const plugins = computed(() => pluginsQuery.data.value ?? [])
const busy = ref<string | null>(null)

async function apply(key: string, task: () => Promise<HostedPlugin[]>) {
	if (busy.value) return
	busy.value = key
	try {
		queryClient.setQueryData(queryKey.value, await task())
	} catch (error) {
		handleError(error as Error)
		await pluginsQuery.refetch()
	} finally {
		busy.value = null
	}
}

async function importFiles() {
	const picked = await open({
		multiple: true,
		filters: [
			kind.value === 'datapacks'
				? { name: 'Datapack', extensions: ['zip'] }
				: { name: 'Java', extensions: ['jar'] },
		],
	})
	if (!picked) return
	const paths = Array.isArray(picked) ? picked : [picked]
	if (paths.length === 0) return
	await apply('import', () => hosting_plugin_import(props.server.id, paths))
}

function onInstalled(list: HostedPlugin[]) {
	queryClient.setQueryData(queryKey.value, list)
}

function openFolder() {
	void openPath(`${props.server.dir}/${contentFolder(props.server)}`).catch(handleError)
}

/* Иконки уже скачанного: сначала то, что запомнилось при установке,
 * для остального — точная догадка по имени файла на Modrinth. */
const icons = ref<Record<string, string | null>>({})

watch(
	() => [props.server.id, plugins.value.map((plugin) => plugin.name).join('\n')] as const,
	() => {
		for (const plugin of plugins.value) {
			if (icons.value[plugin.name] !== undefined) continue
			const known = storedIcon(props.server.id, plugin.name)
			if (known) {
				icons.value[plugin.name] = known
				continue
			}
			icons.value[plugin.name] = null
			void guessIcon(props.server.id, plugin.name).then((url) => {
				if (url) icons.value[plugin.name] = url
			})
		}
	},
	{ immediate: true },
)
</script>

<template>
	<div class="flex flex-col gap-4">
		<Admonition v-if="modsDisabled" type="warning" :header="formatMessage(messages.modsOffTitle)">
			{{ formatMessage(messages.modsOffHint) }}
			<Button class="mt-2" type="outlined" :loading="modsBusy" @click="restoreMods">
				{{ formatMessage(messages.modsRestore) }}
			</Button>
		</Admonition>
		<section class="hosting-panel flex flex-col gap-3">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="m-0 flex items-center gap-2 text-lg font-bold text-contrast">
					{{ kindLabel }}
					<span v-if="plugins.length > 0" class="text-secondary">{{ plugins.length }}</span>
				</h2>
				<div class="flex items-center gap-2">
					<Button type="outlined" @click="openFolder">
						<FolderOpenIcon />
						{{ formatMessage(messages.openFolder) }}
					</Button>
					<Button type="colored" color="brand" :loading="busy === 'import'" @click="importFiles">
						<UploadIcon />
						{{ formatMessage(messages.importButton) }}
					</Button>
				</div>
			</div>

			<nav class="hosting-subtabs" role="tablist">
				<button
					type="button"
					role="tab"
					:aria-selected="subTab === 'installed'"
					:class="{ 'is-active': subTab === 'installed' }"
					@click="subTab = 'installed'"
				>
					{{ formatMessage(messages.tabInstalled) }}
				</button>
				<button
					type="button"
					role="tab"
					:aria-selected="subTab === 'catalog'"
					:class="{ 'is-active': subTab === 'catalog' }"
					@click="subTab = 'catalog'"
				>
					{{ formatMessage(messages.tabCatalog) }}
				</button>
			</nav>
			<p class="m-0 text-sm text-secondary">
				{{
					subTab === 'installed'
						? formatMessage(messages.installedHint)
						: formatMessage(messages.catalogHint)
				}}
			</p>

			<template v-if="subTab === 'installed'">
				<EmptyState
					v-if="!pluginsQuery.isPending.value && plugins.length === 0"
					type="empty"
					:heading="formatMessage(messages.empty)"
					:description="formatMessage(messages.emptyHint)"
				/>
				<template v-else>
					<div class="flex flex-col gap-2">
						<div
							v-for="plugin in plugins"
							:key="plugin.name"
							class="hosting-item"
							:class="{ 'is-off': !plugin.enabled }"
						>
							<img
								v-if="icons[plugin.name]"
								:src="icons[plugin.name]"
								alt=""
								class="hosting-item-icon"
							/>
							<BoxIcon v-else class="shrink-0 text-secondary" />
							<span class="min-w-0 flex-1 truncate font-semibold text-contrast">{{
								plugin.name
							}}</span>
							<span class="shrink-0 text-sm text-secondary">{{ formatSize(plugin.size) }}</span>
							<Toggle
								:model-value="plugin.enabled"
								:disabled="busy !== null"
								@update:model-value="
									apply(`toggle:${plugin.name}`, () =>
										hosting_plugin_toggle(server.id, plugin.name),
									)
								"
							/>
							<Button
								v-tooltip="formatMessage(messages.remove)"
								size="sm"
								type="quiet"
								color="red"
								:disabled="busy !== null"
								:aria-label="formatMessage(messages.remove)"
								@click="
									apply(`remove:${plugin.name}`, () =>
										hosting_plugin_remove(server.id, plugin.name),
									)
								"
							>
								<TrashIcon />
							</Button>
						</div>
					</div>
					<span v-if="plugins.length > 0" class="text-sm text-secondary">
						{{ formatMessage(messages.restartHint) }}
					</span>
				</template>
			</template>
			<ContentBrowser v-else :server="server" @installed="onInstalled" />
		</section>
	</div>
</template>

<style scoped lang="scss">
.hosting-panel {
	padding: 1rem;
	border-radius: var(--radius-lg, 0.75rem);
	border: 1px solid var(--surface-5);
	background: var(--surface-4);
	min-width: 0;
}

.hosting-item {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.5rem 0.5rem 0.5rem 0.875rem;
	border-radius: var(--radius-md, 0.5rem);
	border: 1px solid var(--surface-5);
	background: var(--surface-3);
	transition: opacity 0.2s ease;

	&.is-off {
		opacity: 0.6;
	}
}

.hosting-item-icon {
	width: 1.5rem;
	height: 1.5rem;
	flex-shrink: 0;
	border-radius: 0.375rem;
	object-fit: cover;
}

.hosting-subtabs {
	display: flex;
	gap: 1.25rem;
	border-bottom: 1px solid var(--surface-5);

	button {
		position: relative;
		padding: 0.375rem 0.125rem 0.5rem;
		border: none;
		background: transparent;
		color: var(--color-secondary);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: color 0.15s ease;

		&:hover {
			color: var(--color-contrast);
		}

		&.is-active {
			color: var(--color-contrast);
		}

		&.is-active::after {
			content: '';
			position: absolute;
			inset-inline: 0;
			bottom: -1px;
			height: 2px;
			border-radius: 1px;
			background: var(--color-brand);
		}
	}
}
</style>
