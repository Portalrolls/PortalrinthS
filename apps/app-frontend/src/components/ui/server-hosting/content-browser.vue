<script setup lang="ts">
import {
	CheckIcon,
	CurseForgeIcon,
	DownloadIcon,
	HeartIcon,
	ModrinthBrandIcon,
	PlusIcon,
	SearchIcon,
} from '@modrinth/assets'
import {
	Admonition,
	Avatar,
	Button,
	Combobox,
	type ComboboxOption,
	defineMessages,
	EmptyState,
	injectNotificationManager,
	Input,
	useCompactNumber,
	useVIntl,
} from '@modrinth/ui'
import { refDebounced } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import {
	type HostedSearchHit,
	type HostedSort,
	type HostedSource,
	installToHostedServer,
	NoFittingVersionError,
	searchHostedContent,
} from '@/helpers/hosted-content'
import type { HostedPlugin, HostedServerView } from '@/helpers/hosting'

import { softwareLabels } from './messages'

const props = defineProps<{ server: HostedServerView }>()
const emit = defineEmits<{ installed: [plugins: HostedPlugin[]] }>()

const { formatMessage } = useVIntl()
const { formatCompactNumber } = useCompactNumber()
const { addNotification, handleError } = injectNotificationManager()
const router = useRouter()
const messages = defineMessages({
	title: {
		id: 'app.server-hosting.browse.title',
		defaultMessage: 'Find on Modrinth and CurseForge',
	},
	search: { id: 'app.server-hosting.browse.search', defaultMessage: 'Search' },
	install: { id: 'app.server-hosting.browse.install', defaultMessage: 'Install' },
	installed: { id: 'app.server-hosting.browse.installed', defaultMessage: 'Installed' },
	more: { id: 'app.server-hosting.browse.more', defaultMessage: 'Show more' },
	by: { id: 'app.server-hosting.browse.by', defaultMessage: 'by {author}' },
	nothing: { id: 'app.server-hosting.browse.nothing', defaultMessage: 'Nothing found' },
	nothingHint: {
		id: 'app.server-hosting.browse.nothing-hint',
		defaultMessage: 'Nothing fits {core} {version}. Try another word.',
	},
	failed: {
		id: 'app.server-hosting.browse.failed',
		defaultMessage: 'Modrinth could not be reached',
	},
	cfFailed: {
		id: 'app.server-hosting.browse.cf-failed',
		defaultMessage:
			'CurseForge did not answer — a CurseForge API key is missing or disabled in settings; Modrinth results are shown',
	},
	cfOnlyFailed: {
		id: 'app.server-hosting.browse.cf-only-failed',
		defaultMessage: 'CurseForge did not answer — check the CurseForge API key in settings',
	},
	cfOnlyFailedHint: {
		id: 'app.server-hosting.browse.cf-only-failed-hint',
		defaultMessage: 'Try again, or pick Modrinth as the source',
	},
	noVersion: {
		id: 'app.server-hosting.browse.no-version',
		defaultMessage: 'No file of {name} fits this server',
	},
	installedToast: {
		id: 'app.server-hosting.browse.installed-toast',
		defaultMessage: '{name} is installed, restart the server to load it',
	},
})

const sourceMessages = defineMessages({
	both: {
		id: 'app.server-hosting.browse.source-both',
		defaultMessage: 'Modrinth and CurseForge',
	},
	modrinth: { id: 'app.server-hosting.browse.source-modrinth', defaultMessage: 'Modrinth' },
	curseforge: { id: 'app.server-hosting.browse.source-curseforge', defaultMessage: 'CurseForge' },
})
const sortMessages = defineMessages({
	relevance: { id: 'app.server-hosting.browse.sort-relevance', defaultMessage: 'Relevance' },
	downloads: { id: 'app.server-hosting.browse.sort-downloads', defaultMessage: 'Most downloads' },
	follows: { id: 'app.server-hosting.browse.sort-follows', defaultMessage: 'Most follows' },
	updated: { id: 'app.server-hosting.browse.sort-updated', defaultMessage: 'Recently updated' },
})

const source = ref<HostedSource>('all')
const sort = ref<HostedSort>('relevance')

const sourceOptions = computed<ComboboxOption<HostedSource>[]>(() => [
	{ value: 'all', label: formatMessage(sourceMessages.both) },
	{ value: 'modrinth', label: formatMessage(sourceMessages.modrinth) },
	{ value: 'curseforge', label: formatMessage(sourceMessages.curseforge) },
])
const sortOptions = computed<ComboboxOption<HostedSort>[]>(() => [
	{ value: 'relevance', label: formatMessage(sortMessages.relevance) },
	{ value: 'downloads', label: formatMessage(sortMessages.downloads) },
	{ value: 'follows', label: formatMessage(sortMessages.follows) },
	{ value: 'updated', label: formatMessage(sortMessages.updated) },
])

const query = ref('')
const debounced = refDebounced(query, 350)
const hits = ref<HostedSearchHit[]>([])
const total = ref(0)
const loading = ref(false)
const failed = ref(false)
const cfFailed = ref(false)
const installing = ref<string | null>(null)
const installed = ref(new Set<string>())
let controller: AbortController | null = null

async function load(append: boolean) {
	controller?.abort()
	const current = new AbortController()
	controller = current
	loading.value = true
	failed.value = false
	cfFailed.value = false
	try {
		const result = await searchHostedContent(
			props.server,
			debounced.value.trim(),
			append ? hits.value.length : 0,
			current.signal,
			source.value,
			sort.value,
		)
		if (current.signal.aborted) return
		hits.value = append ? [...hits.value, ...result.hits] : result.hits
		total.value = result.total
		cfFailed.value = result.curseforgeFailed === true
	} catch (error) {
		if (current.signal.aborted) return
		failed.value = true
		console.warn('Hosted content search failed', error)
	} finally {
		if (controller === current) loading.value = false
	}
}

watch(
	() => [
		debounced.value,
		props.server.id,
		props.server.software,
		props.server.game_version,
		source.value,
		sort.value,
	],
	() => void load(false),
	{ immediate: true },
)
onBeforeUnmount(() => controller?.abort())

const canLoadMore = computed(() => hits.value.length < total.value)

async function install(hit: HostedSearchHit) {
	if (installing.value) return
	installing.value = hit.project_id
	try {
		const plugins = await installToHostedServer(props.server, hit.project_id, hit.icon_url)
		installed.value = new Set([...installed.value, hit.project_id])
		emit('installed', plugins)
		addNotification({
			type: 'success',
			title: formatMessage(messages.installedToast, { name: hit.title }),
		})
	} catch (error) {
		if (error instanceof NoFittingVersionError) {
			addNotification({
				type: 'error',
				title: formatMessage(messages.noVersion, { name: hit.title }),
			})
		} else {
			handleError(error as Error)
		}
	} finally {
		installing.value = null
	}
}

function openProject(hit: HostedSearchHit) {
	if (hit.source === 'curseforge') {
		window.open(
			hit.website_url ||
				`https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(hit.title)}`,
		)
		return
	}
	void router.push(`/project/${hit.slug || hit.project_id}`)
}
</script>

<template>
	<section class="hosting-panel flex flex-col gap-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="m-0 text-lg font-bold text-contrast">{{ formatMessage(messages.title) }}</h2>
			<span class="text-sm text-secondary">{{ server.game_version }}</span>
		</div>
		<div class="grid gap-2 md:grid-cols-2">
			<Combobox v-model="source" :options="sourceOptions" :disabled="loading" />
			<Combobox v-model="sort" :options="sortOptions" :disabled="loading" />
		</div>
		<Input
			v-model="query"
			:icon="SearchIcon"
			autocomplete="off"
			:placeholder="formatMessage(messages.search)"
		/>

		<Admonition
			v-if="cfFailed && hits.length > 0"
			type="warning"
			:header="formatMessage(messages.cfFailed)"
		/>
		<EmptyState
			v-if="failed && hits.length === 0"
			type="no-connection"
			:heading="formatMessage(source === 'curseforge' ? messages.cfOnlyFailed : messages.failed)"
			:description="source === 'curseforge' ? formatMessage(messages.cfOnlyFailedHint) : undefined"
		/>
		<EmptyState
			v-else-if="!loading && hits.length === 0"
			type="no-search-result"
			:heading="formatMessage(messages.nothing)"
			:description="
				formatMessage(messages.nothingHint, {
					core: softwareLabels[server.software],
					version: server.game_version,
				})
			"
		/>
		<div v-else class="flex flex-col gap-2" :class="{ 'opacity-60': loading && !hits.length }">
			<div v-for="hit in hits" :key="hit.project_id" class="hosting-hit">
				<button
					type="button"
					class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
					@click="openProject(hit)"
				>
					<Avatar :src="hit.icon_url ?? undefined" alt="" size="3rem" no-shadow />
					<span class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="flex min-w-0 items-baseline gap-1.5">
							<span class="truncate font-bold text-contrast">{{ hit.title }}</span>
							<span class="shrink-0 truncate text-xs text-secondary">
								{{ formatMessage(messages.by, { author: hit.author }) }}
							</span>
						</span>
						<span class="line-clamp-2 text-sm text-secondary">{{ hit.description }}</span>
						<span class="flex items-center gap-3 text-xs text-secondary">
							<span
								class="flex items-center gap-1"
								:title="hit.source === 'curseforge' ? 'CurseForge' : 'Modrinth'"
							>
								<CurseForgeIcon v-if="hit.source === 'curseforge'" class="hosting-source-icon" />
								<ModrinthBrandIcon v-else class="hosting-source-icon" />
							</span>
							<span class="flex items-center gap-1">
								<DownloadIcon class="size-3.5" />
								{{ formatCompactNumber(hit.downloads) }}
							</span>
							<span v-if="hit.follows > 0" class="flex items-center gap-1">
								<HeartIcon class="size-3.5" />
								{{ formatCompactNumber(hit.follows) }}
							</span>
						</span>
					</span>
				</button>
				<Button
					class="shrink-0"
					type="outlined"
					:color="installed.has(hit.project_id) ? 'green' : 'brand'"
					:loading="installing === hit.project_id"
					:disabled="installing !== null || installed.has(hit.project_id)"
					@click="install(hit)"
				>
					<CheckIcon v-if="installed.has(hit.project_id)" />
					<PlusIcon v-else />
					{{ formatMessage(installed.has(hit.project_id) ? messages.installed : messages.install) }}
				</Button>
			</div>
			<Button
				v-if="canLoadMore"
				class="self-center"
				type="quiet"
				:loading="loading"
				@click="load(true)"
			>
				{{ formatMessage(messages.more) }}
			</Button>
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

.hosting-hit {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.625rem 0.75rem;
	border-radius: var(--radius-md, 0.5rem);
	border: 1px solid var(--surface-5);
	background: var(--surface-3);
	transition: border-color 0.15s ease;

	&:hover {
		border-color: var(--surface-6, var(--surface-5));
	}
}

.hosting-source-icon {
	width: 1rem;
	height: 1rem;
	flex-shrink: 0;
}
</style>
