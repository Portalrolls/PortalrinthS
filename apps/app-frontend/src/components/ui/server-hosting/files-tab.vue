<script setup lang="ts">
import {
	BanIcon,
	BoxIcon,
	CheckIcon,
	ChevronRightIcon,
	CoffeeIcon,
	DatabaseIcon,
	FileArchiveIcon,
	FileCodeIcon,
	FileCogIcon,
	FileIcon,
	FileImageIcon,
	FileTextIcon,
	FolderCogIcon,
	FolderIcon,
	FolderOpenIcon,
	FolderUpIcon,
	GlobeIcon,
	HistoryIcon,
	LibraryIcon,
	PlugIcon,
	RefreshCwIcon,
	ServerIcon,
	ShieldCheckIcon,
	TrashIcon,
	UploadIcon,
	UsersIcon,
} from '@modrinth/assets'
import { Button, defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { useQuery } from '@tanstack/vue-query'
import { open } from '@tauri-apps/plugin-dialog'
import { type Component, computed, ref, watch } from 'vue'

import {
	type HostedFile,
	type HostedServerView,
	hosting_file_delete,
	hosting_file_import,
	hosting_files,
} from '@/helpers/hosting'
import { openPath } from '@/helpers/utils.js'

import { formatSize } from './content-kind'

const props = defineProps<{ server: HostedServerView }>()

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const messages = defineMessages({
	root: { id: 'app.server-hosting.files.root', defaultMessage: 'Server' },
	up: { id: 'app.server-hosting.files.up', defaultMessage: 'Up a level' },
	refresh: { id: 'app.server-hosting.files.refresh', defaultMessage: 'Refresh' },
	upload: { id: 'app.server-hosting.files.upload', defaultMessage: 'Upload files' },
	openFolder: { id: 'app.server-hosting.files.open-folder', defaultMessage: 'Open folder' },
	remove: { id: 'app.server-hosting.files.remove', defaultMessage: 'Delete' },
	confirmRemove: {
		id: 'app.server-hosting.files.confirm-remove',
		defaultMessage: 'Delete for good',
	},
	empty: { id: 'app.server-hosting.files.empty', defaultMessage: 'This folder is empty' },
})

const path = ref<string[]>([])
const relative = computed(() => path.value.join('/'))

watch(
	() => props.server.id,
	() => {
		path.value = []
	},
)

const filesQuery = useQuery({
	queryKey: computed(() => ['server-hosting', 'files', props.server.id, relative.value] as const),
	queryFn: () => hosting_files(props.server.id, relative.value),
	refetchOnWindowFocus: false,
	retry: false,
})
const files = computed(() => filesQuery.data.value ?? [])

type FileTone =
	| 'folder'
	| 'world'
	| 'jar'
	| 'config'
	| 'text'
	| 'image'
	| 'archive'
	| 'data'
	| 'plain'

const FOLDER_LOOKS: Record<string, [Component, FileTone]> = {
	mods: [BoxIcon, 'jar'],
	plugins: [PlugIcon, 'jar'],
	config: [FolderCogIcon, 'config'],
	logs: [HistoryIcon, 'text'],
	'crash-reports': [HistoryIcon, 'text'],
	libraries: [LibraryIcon, 'data'],
	versions: [ServerIcon, 'data'],
	cache: [DatabaseIcon, 'data'],
}

const FILE_LOOKS: [RegExp, Component, FileTone][] = [
	[/^(banned-ips|banned-players)\.json$/i, BanIcon, 'config'],
	[/^(ops|whitelist)\.json$/i, ShieldCheckIcon, 'config'],
	[/^usercache\.json$/i, UsersIcon, 'config'],
	[/^eula\.txt$/i, ShieldCheckIcon, 'text'],
	[/\.jar$/i, CoffeeIcon, 'jar'],
	[/\.(properties|ya?ml|toml|cfg|conf|ini)$/i, FileCogIcon, 'config'],
	[/\.(json5?|mcmeta|nbt|dat|dat_old|mca)$/i, FileCodeIcon, 'data'],
	[/\.(log|txt|md|gz)$/i, FileTextIcon, 'text'],
	[/\.(png|jpe?g|gif|webp)$/i, FileImageIcon, 'image'],
	[/\.(zip|tar|7z|rar|mrpack)$/i, FileArchiveIcon, 'archive'],
]

/** Значок и цвет строки: известные папки и типы файлов узнаются по имени. */
function lookOf(file: HostedFile): { icon: Component; tone: FileTone } {
	if (file.dir) {
		if (/^world/i.test(file.name)) return { icon: GlobeIcon, tone: 'world' }
		const known = FOLDER_LOOKS[file.name.toLowerCase()]
		return known ? { icon: known[0], tone: known[1] } : { icon: FolderIcon, tone: 'folder' }
	}
	const match = FILE_LOOKS.find(([pattern]) => pattern.test(file.name))
	return match ? { icon: match[1], tone: match[2] } : { icon: FileIcon, tone: 'plain' }
}

function extOf(name: string): string {
	const dot = name.lastIndexOf('.')
	return dot > 0 && dot < name.length - 1
		? name
				.slice(dot + 1)
				.toUpperCase()
				.slice(0, 6)
		: ''
}

const folderCount = computed(() => files.value.filter((file) => file.dir).length)
const totalSize = computed(() =>
	files.value.reduce((sum, file) => sum + (file.dir ? 0 : file.size || 0), 0),
)
const busy = ref(false)
const confirming = ref<string | null>(null)

function enter(file: HostedFile) {
	if (!file.dir) return
	confirming.value = null
	path.value = [...path.value, file.name]
}

function goTo(depth: number) {
	confirming.value = null
	path.value = path.value.slice(0, depth)
}

async function remove(file: HostedFile) {
	if (confirming.value !== file.name) {
		confirming.value = file.name
		return
	}
	confirming.value = null
	busy.value = true
	try {
		await hosting_file_delete(props.server.id, [...path.value, file.name].join('/'))
	} catch (error) {
		handleError(error as Error)
	} finally {
		busy.value = false
		await filesQuery.refetch()
	}
}

async function upload() {
	const picked = await open({ multiple: true })
	if (!picked) return
	const paths = Array.isArray(picked) ? picked : [picked]
	if (paths.length === 0) return
	busy.value = true
	try {
		await hosting_file_import(props.server.id, relative.value, paths)
	} catch (error) {
		handleError(error as Error)
	} finally {
		busy.value = false
		await filesQuery.refetch()
	}
}

function openFolder() {
	const target = relative.value ? `${props.server.dir}/${relative.value}` : props.server.dir
	void openPath(target).catch(handleError)
}
</script>

<template>
	<section class="hosting-panel flex flex-col gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<nav class="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
				<button type="button" class="hosting-crumb" @click="goTo(0)">
					{{ formatMessage(messages.root) }}
				</button>
				<template v-for="(segment, index) in path" :key="`${index}:${segment}`">
					<ChevronRightIcon class="shrink-0 text-secondary" />
					<button type="button" class="hosting-crumb" @click="goTo(index + 1)">
						{{ segment }}
					</button>
				</template>
			</nav>
			<Button
				v-tooltip="formatMessage(messages.up)"
				type="outlined"
				:disabled="path.length === 0"
				:aria-label="formatMessage(messages.up)"
				@click="goTo(path.length - 1)"
			>
				<FolderUpIcon />
			</Button>
			<Button
				v-tooltip="formatMessage(messages.refresh)"
				type="outlined"
				:aria-label="formatMessage(messages.refresh)"
				@click="filesQuery.refetch()"
			>
				<RefreshCwIcon :class="{ 'animate-spin': filesQuery.isFetching.value }" />
			</Button>
			<Button type="outlined" @click="openFolder">
				<FolderOpenIcon />
				{{ formatMessage(messages.openFolder) }}
			</Button>
			<Button type="colored" color="brand" :loading="busy" @click="upload">
				<UploadIcon />
				{{ formatMessage(messages.upload) }}
			</Button>
		</div>

		<span v-if="filesQuery.isError.value" class="text-sm text-brand-red">
			{{ filesQuery.error.value?.message }}
		</span>
		<span
			v-else-if="!filesQuery.isPending.value && files.length === 0"
			class="hosting-files-empty text-sm text-secondary"
		>
			{{ formatMessage(messages.empty) }}
		</span>
		<div v-else class="hosting-files">
			<div class="hosting-files-head">
				<span>
					<FolderIcon class="size-3.5" />
					{{ folderCount }}
				</span>
				<span>
					<FileIcon class="size-3.5" />
					{{ files.length - folderCount }}
				</span>
				<span class="ml-auto">{{ formatSize(totalSize) }}</span>
			</div>
			<TransitionGroup name="hosting-row" tag="div" class="hosting-files-list">
				<div
					v-for="(file, index) in files"
					:key="`${relative}/${file.name}`"
					class="hosting-file"
					:class="{ 'is-dir': file.dir, 'is-confirming': confirming === file.name }"
					:data-tone="lookOf(file).tone"
					:style="{ '--row-delay': `${Math.min(index, 14) * 18}ms` }"
					@click="enter(file)"
				>
					<span class="hosting-file-icon">
						<component :is="lookOf(file).icon" />
					</span>
					<span class="min-w-0 flex-1 truncate text-contrast">{{ file.name }}</span>
					<span v-if="!file.dir && extOf(file.name)" class="hosting-file-ext">
						{{ extOf(file.name) }}
					</span>
					<span v-if="!file.dir" class="hosting-file-size">{{ formatSize(file.size) }}</span>
					<ChevronRightIcon v-else class="hosting-file-go" />
					<Button
						v-tooltip="
							formatMessage(confirming === file.name ? messages.confirmRemove : messages.remove)
						"
						size="sm"
						:type="confirming === file.name ? 'colored' : 'quiet'"
						color="red"
						class="hosting-file-remove"
						:disabled="busy"
						:aria-label="
							formatMessage(confirming === file.name ? messages.confirmRemove : messages.remove)
						"
						@click.stop="remove(file)"
					>
						<CheckIcon v-if="confirming === file.name" />
						<TrashIcon v-else />
					</Button>
				</div>
			</TransitionGroup>
		</div>
	</section>
</template>

<style scoped lang="scss">
.hosting-panel {
	padding: 1rem;
	border-radius: var(--radius-lg, 0.75rem);
	border: 1px solid var(--surface-5);
	background: var(--surface-4);
	min-width: 0;
}

.hosting-crumb {
	max-width: 12rem;
	overflow: hidden;
	padding: 0.125rem 0.375rem;
	border: none;
	border-radius: 0.375rem;
	background: transparent;
	color: var(--color-secondary);
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
	cursor: pointer;

	&:hover,
	&:last-of-type {
		color: var(--color-contrast);
	}

	&:hover {
		background: var(--surface-5);
	}
}

.hosting-files {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	border-radius: var(--radius-md, 0.5rem);
	border: 1px solid var(--surface-5);
	background: var(--surface-3);
}

.hosting-files-head {
	display: flex;
	align-items: center;
	gap: 0.9rem;
	padding: 0.45rem 0.875rem;
	border-bottom: 1px solid var(--surface-5);
	background: var(--surface-4);
	color: var(--color-secondary);
	font-size: 0.75rem;
	font-weight: 600;

	span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
}

.hosting-files-list {
	display: flex;
	flex-direction: column;
}

.hosting-files-empty {
	padding: 1.5rem;
	border-radius: var(--radius-md, 0.5rem);
	border: 1px dashed var(--surface-5);
	text-align: center;
}

.hosting-file {
	--tone: var(--color-secondary);
	display: flex;
	align-items: center;
	gap: 0.75rem;
	min-height: 2.6rem;
	padding: 0.3rem 0.5rem 0.3rem 0.7rem;
	font-size: 0.875rem;
	transition:
		background 0.18s ease,
		box-shadow 0.18s ease;

	& + & {
		border-top: 1px solid var(--surface-5);
	}

	&:hover {
		background: var(--surface-4);
		box-shadow: inset 2px 0 0 var(--tone);
	}

	&.is-dir {
		cursor: pointer;
	}

	&[data-tone='folder'] {
		--tone: var(--color-brand);
	}
	&[data-tone='world'] {
		--tone: #3fbf7f;
	}
	&[data-tone='jar'] {
		--tone: #f08c3c;
	}
	&[data-tone='config'] {
		--tone: #5aa2ff;
	}
	&[data-tone='data'] {
		--tone: #a78bfa;
	}
	&[data-tone='text'] {
		--tone: #cbd5e1;
	}
	&[data-tone='image'] {
		--tone: #f472b6;
	}
	&[data-tone='archive'] {
		--tone: #eab308;
	}
}

.hosting-file-icon {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 1.85rem;
	height: 1.85rem;
	border-radius: 0.5rem;
	background: color-mix(in srgb, var(--tone) 16%, transparent);
	color: var(--tone);
	transition: transform 0.2s ease;

	svg {
		width: 1rem;
		height: 1rem;
	}
}

.hosting-file:hover .hosting-file-icon {
	transform: scale(1.08);
}

.hosting-file-ext {
	flex-shrink: 0;
	border-radius: 0.3rem;
	background: color-mix(in srgb, var(--tone) 14%, transparent);
	color: var(--tone);
	font-size: 0.625rem;
	font-weight: 700;
	letter-spacing: 0.03em;
	padding: 0.1rem 0.35rem;
}

.hosting-file-size {
	flex-shrink: 0;
	min-width: 4rem;
	color: var(--color-secondary);
	font-size: 0.75rem;
	font-variant-numeric: tabular-nums;
	text-align: right;
}

.hosting-file-go {
	flex-shrink: 0;
	width: 1rem;
	height: 1rem;
	color: var(--color-secondary);
	opacity: 0;
	transform: translateX(-4px);
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.hosting-file:hover .hosting-file-go {
	opacity: 1;
	transform: none;
}

.hosting-file-remove {
	opacity: 0.45;
	transition: opacity 0.18s ease;
}

.hosting-file:hover .hosting-file-remove,
.hosting-file.is-confirming .hosting-file-remove {
	opacity: 1;
}

.hosting-row-enter-active {
	transition:
		opacity 0.28s ease,
		transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
	transition-delay: var(--row-delay, 0ms);
}

.hosting-row-enter-from {
	opacity: 0;
	transform: translateY(6px);
}

@media (prefers-reduced-motion: reduce) {
	.hosting-row-enter-active,
	.hosting-file-icon,
	.hosting-file-go {
		transition: none;
	}
}
</style>
