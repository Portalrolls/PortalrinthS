<script setup lang="ts">
import { DownloadIcon, SaveIcon, TrashIcon, UndoIcon } from '@modrinth/assets'
import {
	Button,
	Combobox,
	type ComboboxOption,
	defineMessages,
	injectNotificationManager,
	Input,
	Slider,
	Toggle,
	useVIntl,
} from '@modrinth/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'

import useMemorySlider from '@/composables/useMemorySlider'
import {
	HOSTED_SOFTWARE,
	type HostedServer,
	type HostedServerView,
	type HostedSoftware,
	hosting_install_core,
	hosting_versions,
	isHostedActive,
	toHostedServer,
} from '@/helpers/hosting'

import { coreIconFor } from './core-icon'
import { softwareLabels } from './messages'
import { hostedServersKey } from './queries'
import type { useHostedServerActions } from './use-hosted-servers'

const props = defineProps<{
	server: HostedServerView
	actions: ReturnType<typeof useHostedServerActions>
}>()

const emit = defineEmits<{ removed: [] }>()

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const queryClient = useQueryClient()
const messages = defineMessages({
	general: { id: 'app.server-hosting.settings.general', defaultMessage: 'General' },
	name: { id: 'app.server-hosting.settings.name', defaultMessage: 'Name' },
	motd: { id: 'app.server-hosting.settings.motd', defaultMessage: 'Description (MOTD)' },
	motdHint: {
		id: 'app.server-hosting.settings.motd-hint',
		defaultMessage: 'Shown under the server name in the multiplayer list',
	},
	core: { id: 'app.server-hosting.settings.core', defaultMessage: 'Core' },
	version: { id: 'app.server-hosting.settings.version', defaultMessage: 'Minecraft version' },
	coreHint: {
		id: 'app.server-hosting.settings.core-hint',
		defaultMessage: 'Changing the core or version downloads it again on the next start',
	},
	coreLocked: {
		id: 'app.server-hosting.settings.core-locked',
		defaultMessage: 'Stop the server to change its core or version',
	},
	installCore: { id: 'app.server-hosting.settings.install-core', defaultMessage: 'Download core' },
	reinstallCore: {
		id: 'app.server-hosting.settings.reinstall-core',
		defaultMessage: 'Download again',
	},
	game: { id: 'app.server-hosting.settings.game', defaultMessage: 'Game' },
	gamemode: { id: 'app.server-hosting.settings.gamemode', defaultMessage: 'Game mode' },
	difficulty: { id: 'app.server-hosting.settings.difficulty', defaultMessage: 'Difficulty' },
	maxPlayers: { id: 'app.server-hosting.settings.max-players', defaultMessage: 'Player slots' },
	viewDistance: {
		id: 'app.server-hosting.settings.view-distance',
		defaultMessage: 'View distance',
	},
	levelName: { id: 'app.server-hosting.settings.level-name', defaultMessage: 'World folder' },
	world: { id: 'app.server-hosting.settings.world', defaultMessage: 'World' },
	seed: { id: 'app.server-hosting.settings.seed', defaultMessage: 'World seed' },
	seedHint: {
		id: 'app.server-hosting.settings.seed-hint',
		defaultMessage: 'Applies when the world is generated anew; empty lets the server pick one',
	},
	worldType: { id: 'app.server-hosting.settings.world-type', defaultMessage: 'World type' },
	simulationDistance: {
		id: 'app.server-hosting.settings.simulation-distance',
		defaultMessage: 'Simulation distance',
	},
	spawnProtection: {
		id: 'app.server-hosting.settings.spawn-protection',
		defaultMessage: 'Spawn protection',
	},
	spawnProtectionHint: {
		id: 'app.server-hosting.settings.spawn-protection-hint',
		defaultMessage: 'Blocks around the spawn only operators may change; 0 turns it off',
	},
	idleTimeout: {
		id: 'app.server-hosting.settings.idle-timeout',
		defaultMessage: 'Kick idle players (min)',
	},
	idleTimeoutHint: {
		id: 'app.server-hosting.settings.idle-timeout-hint',
		defaultMessage: '0 keeps idling players in',
	},
	rules: { id: 'app.server-hosting.settings.rules', defaultMessage: 'Rules' },
	onlineMode: {
		id: 'app.server-hosting.settings.online-mode',
		defaultMessage: 'Licensed accounts only',
	},
	onlineModeHint: {
		id: 'app.server-hosting.settings.online-mode-hint',
		defaultMessage: 'Turn off to let offline and Ely.by players join',
	},
	pvp: { id: 'app.server-hosting.settings.pvp', defaultMessage: 'PvP' },
	whiteList: { id: 'app.server-hosting.settings.white-list', defaultMessage: 'Whitelist' },
	whitelistNames: {
		id: 'app.server-hosting.settings.whitelist-names',
		defaultMessage: 'Whitelist nicknames',
	},
	whitelistNamesHint: {
		id: 'app.server-hosting.settings.whitelist-names-hint',
		defaultMessage: 'Separated by commas or spaces, for example: Steve, Alex',
	},
	enforceWhitelist: {
		id: 'app.server-hosting.settings.enforce-whitelist',
		defaultMessage: 'Kick players not on the whitelist',
	},
	allowFlight: { id: 'app.server-hosting.settings.allow-flight', defaultMessage: 'Allow flight' },
	commandBlocks: {
		id: 'app.server-hosting.settings.command-blocks',
		defaultMessage: 'Command blocks',
	},
	hardcore: { id: 'app.server-hosting.settings.hardcore', defaultMessage: 'Hardcore' },
	spawnMonsters: {
		id: 'app.server-hosting.settings.spawn-monsters',
		defaultMessage: 'Monsters',
	},
	spawnAnimals: { id: 'app.server-hosting.settings.spawn-animals', defaultMessage: 'Animals' },
	spawnVillagers: {
		id: 'app.server-hosting.settings.spawn-villagers',
		defaultMessage: 'Villagers',
	},
	allowNether: { id: 'app.server-hosting.settings.allow-nether', defaultMessage: 'Nether' },
	generateStructures: {
		id: 'app.server-hosting.settings.generate-structures',
		defaultMessage: 'Structures',
	},
	forceGamemode: {
		id: 'app.server-hosting.settings.force-gamemode',
		defaultMessage: 'Force game mode',
	},
	forceGamemodeHint: {
		id: 'app.server-hosting.settings.force-gamemode-hint',
		defaultMessage: 'Players join in the server mode, even in their own world',
	},
	enableStatus: {
		id: 'app.server-hosting.settings.enable-status',
		defaultMessage: 'Show in the server list',
	},
	hideOnline: {
		id: 'app.server-hosting.settings.hide-online',
		defaultMessage: 'Hide the player count',
	},
	network: { id: 'app.server-hosting.settings.network', defaultMessage: 'Network' },
	port: { id: 'app.server-hosting.settings.port', defaultMessage: 'Local port' },
	publicRelay: {
		id: 'app.server-hosting.settings.public-relay',
		defaultMessage: 'Public address',
	},
	publicRelayHint: {
		id: 'app.server-hosting.settings.public-relay-hint',
		defaultMessage: 'Friends join through a public address without opening ports on the router',
	},
	performance: { id: 'app.server-hosting.settings.performance', defaultMessage: 'Performance' },
	memory: { id: 'app.server-hosting.settings.memory', defaultMessage: 'Memory' },
	javaPath: { id: 'app.server-hosting.settings.java-path', defaultMessage: 'Java path' },
	javaPathHint: {
		id: 'app.server-hosting.settings.java-path-hint',
		defaultMessage: 'Leave empty and Java {version} is picked or installed automatically',
	},
	jvmArgs: { id: 'app.server-hosting.settings.jvm-args', defaultMessage: 'JVM arguments' },
	eula: { id: 'app.server-hosting.settings.eula', defaultMessage: 'I agree to the Minecraft EULA' },
	danger: { id: 'app.server-hosting.settings.danger', defaultMessage: 'Delete server' },
	dangerHint: {
		id: 'app.server-hosting.settings.danger-hint',
		defaultMessage: 'The server, its world and all of its files are deleted from this computer.',
	},
	remove: { id: 'app.server-hosting.settings.remove', defaultMessage: 'Delete' },
	confirmRemove: {
		id: 'app.server-hosting.settings.confirm-remove',
		defaultMessage: 'Delete for good',
	},
	unsaved: {
		id: 'app.server-hosting.settings.unsaved',
		defaultMessage: 'You have unsaved changes',
	},
	reset: { id: 'app.server-hosting.settings.reset', defaultMessage: 'Reset' },
	save: { id: 'app.server-hosting.settings.save', defaultMessage: 'Save' },
	survival: { id: 'app.server-hosting.gamemode.survival', defaultMessage: 'Survival' },
	creative: { id: 'app.server-hosting.gamemode.creative', defaultMessage: 'Creative' },
	adventure: { id: 'app.server-hosting.gamemode.adventure', defaultMessage: 'Adventure' },
	spectator: { id: 'app.server-hosting.gamemode.spectator', defaultMessage: 'Spectator' },
	peaceful: { id: 'app.server-hosting.difficulty.peaceful', defaultMessage: 'Peaceful' },
	easy: { id: 'app.server-hosting.difficulty.easy', defaultMessage: 'Easy' },
	normal: { id: 'app.server-hosting.difficulty.normal', defaultMessage: 'Normal' },
	hard: { id: 'app.server-hosting.difficulty.hard', defaultMessage: 'Hard' },
	worldTypeNormal: {
		id: 'app.server-hosting.world-type.normal',
		defaultMessage: 'Normal world',
	},
	worldTypeFlat: { id: 'app.server-hosting.world-type.flat', defaultMessage: 'Flat world' },
	worldTypeLargeBiomes: {
		id: 'app.server-hosting.world-type.large-biomes',
		defaultMessage: 'Large biomes',
	},
	worldTypeAmplified: {
		id: 'app.server-hosting.world-type.amplified',
		defaultMessage: 'Amplified',
	},
})

const draft = ref<HostedServer>(toHostedServer(props.server))
const snapshot = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== snapshot.value)

watch(
	() => JSON.stringify(toHostedServer(props.server)),
	(next, previous) => {
		const switched = previous !== undefined && JSON.parse(previous).id !== props.server.id
		if (dirty.value && !switched) {
			snapshot.value = next
			return
		}
		draft.value = JSON.parse(next)
		snapshot.value = next
	},
)

const active = computed(() => isHostedActive(props.server.status))

const versionsQuery = useQuery({
	queryKey: computed(() => ['server-hosting', 'versions', draft.value.software] as const),
	queryFn: () => hosting_versions(draft.value.software),
	staleTime: 10 * 60 * 1000,
})
const versionOptions = computed<ComboboxOption<string>[]>(() => {
	const list = versionsQuery.data.value ?? []
	const values = list.includes(draft.value.game_version)
		? list
		: [draft.value.game_version, ...list]
	return values.map((value) => ({ value, label: value }))
})

const coreOptions = computed<ComboboxOption<HostedSoftware>[]>(() =>
	HOSTED_SOFTWARE.map((value) => ({
		value,
		label: softwareLabels[value],
		icon: coreIconFor(value),
	})),
)

const worldTypeLabels = computed(() => ({
	normal: formatMessage(messages.worldTypeNormal),
	flat: formatMessage(messages.worldTypeFlat),
	large_biomes: formatMessage(messages.worldTypeLargeBiomes),
	amplified: formatMessage(messages.worldTypeAmplified),
}))
const worldTypeOptions = computed<ComboboxOption<HostedServer['world_type']>[]>(() =>
	(['normal', 'flat', 'large_biomes', 'amplified'] as const).map((value) => ({
		value,
		label: worldTypeLabels.value[value],
	})),
)

const gamemodeLabels = computed(() => ({
	survival: formatMessage(messages.survival),
	creative: formatMessage(messages.creative),
	adventure: formatMessage(messages.adventure),
	spectator: formatMessage(messages.spectator),
}))
const gamemodeOptions = computed<ComboboxOption<HostedServer['gamemode']>[]>(() =>
	(['survival', 'creative', 'adventure', 'spectator'] as const).map((value) => ({
		value,
		label: gamemodeLabels.value[value],
	})),
)

const difficultyLabels = computed(() => ({
	peaceful: formatMessage(messages.peaceful),
	easy: formatMessage(messages.easy),
	normal: formatMessage(messages.normal),
	hard: formatMessage(messages.hard),
}))
const difficultyOptions = computed<ComboboxOption<HostedServer['difficulty']>[]>(() =>
	(['peaceful', 'easy', 'normal', 'hard'] as const).map((value) => ({
		value,
		label: difficultyLabels.value[value],
	})),
)

watch(
	() => draft.value.software,
	(software, previous) => {
		if (software === previous) return
		const list = versionsQuery.data.value
		if (list && !list.includes(draft.value.game_version)) draft.value.game_version = list[0]
	},
)
watch(
	() => versionsQuery.data.value,
	(list) => {
		if (list && list.length > 0 && !list.includes(draft.value.game_version)) {
			draft.value.game_version = list[0]
		}
	},
)

const { maxMemory, snapPoints } = useMemorySlider()

const toggles = computed(
	() =>
		[
			{ key: 'online_mode', label: messages.onlineMode, hint: messages.onlineModeHint },
			{ key: 'pvp', label: messages.pvp },
			{ key: 'white_list', label: messages.whiteList },
			{ key: 'enforce_whitelist', label: messages.enforceWhitelist },
			{ key: 'allow_flight', label: messages.allowFlight },
			{ key: 'command_blocks', label: messages.commandBlocks },
			{ key: 'hardcore', label: messages.hardcore },
			{ key: 'spawn_monsters', label: messages.spawnMonsters },
			{ key: 'spawn_animals', label: messages.spawnAnimals },
			{ key: 'spawn_villagers', label: messages.spawnVillagers },
			{ key: 'allow_nether', label: messages.allowNether },
			{ key: 'generate_structures', label: messages.generateStructures },
			{ key: 'force_gamemode', label: messages.forceGamemode, hint: messages.forceGamemodeHint },
			{ key: 'enable_status', label: messages.enableStatus },
			{ key: 'hide_online', label: messages.hideOnline },
		] as const,
)

type NumberKey =
	| 'port'
	| 'max_players'
	| 'view_distance'
	| 'simulation_distance'
	| 'spawn_protection'
	| 'idle_timeout'

function setNumber(key: NumberKey, value: unknown, fallback: number) {
	const parsed = Number(value)
	draft.value[key] = Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

async function save() {
	await props.actions.save(props.server.id, {
		...draft.value,
		name: draft.value.name.trim() || props.server.name,
		level_seed: draft.value.level_seed.trim(),
	})
}

function reset() {
	draft.value = toHostedServer(props.server)
	snapshot.value = JSON.stringify(draft.value)
}

const installing = ref(false)
async function installCore() {
	if (installing.value) return
	installing.value = true
	try {
		await hosting_install_core(props.server.id)
	} catch (error) {
		handleError(error as Error)
	} finally {
		installing.value = false
		await queryClient.invalidateQueries({ queryKey: hostedServersKey })
	}
}

const confirmingRemove = ref(false)
async function remove() {
	if (!confirmingRemove.value) {
		confirmingRemove.value = true
		return
	}
	confirmingRemove.value = false
	if (await props.actions.remove(props.server.id)) emit('removed')
}
</script>

<template>
	<div class="flex flex-col gap-4 pb-2">
		<section class="hosting-panel">
			<h2 class="hosting-panel-title">{{ formatMessage(messages.general) }}</h2>
			<div class="grid gap-3 md:grid-cols-2">
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.name) }}</span>
					<Input v-model="draft.name" :maxlength="48" autocomplete="off" />
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.motd) }}</span>
					<Input v-model="draft.motd" :maxlength="120" autocomplete="off" />
					<span class="hosting-field-hint">{{ formatMessage(messages.motdHint) }}</span>
				</label>
			</div>
		</section>

		<section class="hosting-panel">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="hosting-panel-title">{{ formatMessage(messages.core) }}</h2>
				<Button
					type="outlined"
					:loading="installing || server.status === 'installing'"
					:disabled="active || dirty"
					@click="installCore"
				>
					<DownloadIcon />
					{{ formatMessage(server.core_ready ? messages.reinstallCore : messages.installCore) }}
				</Button>
			</div>
			<div class="grid gap-3 md:grid-cols-2">
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.core) }}</span>
					<Combobox
						v-model="draft.software"
						:options="coreOptions"
						:disabled="active"
						:aria-label="formatMessage(messages.core)"
					/>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.version) }}</span>
					<Combobox
						v-model="draft.game_version"
						:options="versionOptions"
						:disabled="active"
						searchable
					/>
				</label>
			</div>
			<span class="hosting-field-hint">
				{{ formatMessage(active ? messages.coreLocked : messages.coreHint) }}
			</span>
		</section>

		<section class="hosting-panel">
			<h2 class="hosting-panel-title">{{ formatMessage(messages.game) }}</h2>
			<div class="grid gap-3 md:grid-cols-2">
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.gamemode) }}</span>
					<Combobox
						v-model="draft.gamemode"
						:options="gamemodeOptions"
						:aria-label="formatMessage(messages.gamemode)"
					/>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.difficulty) }}</span>
					<Combobox
						v-model="draft.difficulty"
						:options="difficultyOptions"
						:aria-label="formatMessage(messages.difficulty)"
					/>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.maxPlayers) }}</span>
					<Input
						:model-value="draft.max_players"
						type="number"
						:min="1"
						:max="1000"
						@update:model-value="(value) => setNumber('max_players', value, 20)"
					/>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.viewDistance) }}</span>
					<Input
						:model-value="draft.view_distance"
						type="number"
						:min="2"
						:max="32"
						@update:model-value="(value) => setNumber('view_distance', value, 10)"
					/>
				</label>
			</div>
		</section>

		<section class="hosting-panel">
			<h2 class="hosting-panel-title">{{ formatMessage(messages.world) }}</h2>
			<div class="grid gap-3 md:grid-cols-2">
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.levelName) }}</span>
					<Input v-model="draft.level_name" :maxlength="64" autocomplete="off" />
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.worldType) }}</span>
					<Combobox
						v-model="draft.world_type"
						:options="worldTypeOptions"
						:aria-label="formatMessage(messages.worldType)"
					/>
				</label>
				<label class="hosting-field md:col-span-2">
					<span class="hosting-field-label">{{ formatMessage(messages.seed) }}</span>
					<Input
						v-model="draft.level_seed"
						:maxlength="64"
						autocomplete="off"
						:spellcheck="false"
					/>
					<span class="hosting-field-hint">{{ formatMessage(messages.seedHint) }}</span>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.simulationDistance) }}</span>
					<Input
						:model-value="draft.simulation_distance"
						type="number"
						:min="2"
						:max="32"
						@update:model-value="(value) => setNumber('simulation_distance', value, 10)"
					/>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.spawnProtection) }}</span>
					<Input
						:model-value="draft.spawn_protection"
						type="number"
						:min="0"
						:max="256"
						@update:model-value="(value) => setNumber('spawn_protection', value, 16)"
					/>
					<span class="hosting-field-hint">{{ formatMessage(messages.spawnProtectionHint) }}</span>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.idleTimeout) }}</span>
					<Input
						:model-value="draft.idle_timeout"
						type="number"
						:min="0"
						:max="60000"
						@update:model-value="(value) => setNumber('idle_timeout', value, 0)"
					/>
					<span class="hosting-field-hint">{{ formatMessage(messages.idleTimeoutHint) }}</span>
				</label>
			</div>
		</section>

		<section class="hosting-panel">
			<h2 class="hosting-panel-title">{{ formatMessage(messages.rules) }}</h2>
			<div class="grid gap-2 md:grid-cols-2">
				<label v-for="toggle in toggles" :key="toggle.key" class="hosting-toggle">
					<span class="flex min-w-0 flex-col">
						<span class="font-semibold text-contrast">{{ formatMessage(toggle.label) }}</span>
						<span v-if="'hint' in toggle" class="hosting-field-hint">
							{{ formatMessage(toggle.hint) }}
						</span>
					</span>
					<Toggle v-model="draft[toggle.key]" />
				</label>
			</div>
			<template v-if="draft.white_list">
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.whitelistNames) }}</span>
					<Input v-model="draft.whitelist_names" autocomplete="off" :spellcheck="false" />
					<span class="hosting-field-hint">{{ formatMessage(messages.whitelistNamesHint) }}</span>
				</label>
			</template>
		</section>

		<section class="hosting-panel">
			<h2 class="hosting-panel-title">{{ formatMessage(messages.network) }}</h2>
			<div class="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.port) }}</span>
					<Input
						:model-value="draft.port"
						type="number"
						:min="1024"
						:max="65535"
						@update:model-value="(value) => setNumber('port', value, server.port)"
					/>
				</label>
				<label class="hosting-toggle self-end">
					<span class="flex min-w-0 flex-col">
						<span class="font-semibold text-contrast">{{
							formatMessage(messages.publicRelay)
						}}</span>
						<span class="hosting-field-hint">{{ formatMessage(messages.publicRelayHint) }}</span>
					</span>
					<Toggle v-model="draft.public_relay" />
				</label>
			</div>
		</section>

		<section class="hosting-panel">
			<h2 class="hosting-panel-title">{{ formatMessage(messages.performance) }}</h2>
			<div class="hosting-field">
				<span class="hosting-field-label">{{ formatMessage(messages.memory) }}</span>
				<Slider
					v-if="maxMemory"
					v-model="draft.memory_mb"
					:aria-label="formatMessage(messages.memory)"
					:min="512"
					:max="maxMemory"
					:step="64"
					:snap-points="snapPoints"
					:snap-range="512"
					min-label="512 MB"
					:max-label="`${Number((maxMemory / 1024).toFixed(1))} GB`"
					unit="MB"
				/>
			</div>
			<div class="grid gap-3 md:grid-cols-2">
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.javaPath) }}</span>
					<Input v-model="draft.java_path" autocomplete="off" :spellcheck="false" />
					<span class="hosting-field-hint">
						{{ formatMessage(messages.javaPathHint, { version: server.java_need }) }}
					</span>
				</label>
				<label class="hosting-field">
					<span class="hosting-field-label">{{ formatMessage(messages.jvmArgs) }}</span>
					<Input v-model="draft.jvm_args" autocomplete="off" :spellcheck="false" />
				</label>
			</div>
			<label class="hosting-toggle">
				<span class="font-semibold text-contrast">{{ formatMessage(messages.eula) }}</span>
				<Toggle v-model="draft.eula_accepted" />
			</label>
		</section>

		<section class="hosting-panel hosting-panel--danger">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex min-w-0 flex-col gap-1">
					<h2 class="hosting-panel-title">{{ formatMessage(messages.danger) }}</h2>
					<span class="text-sm text-secondary">{{ formatMessage(messages.dangerHint) }}</span>
				</div>
				<Button
					:type="confirmingRemove ? 'colored' : 'outlined'"
					color="red"
					:loading="actions.isPending(server.id, 'remove')"
					@click="remove"
					@blur="confirmingRemove = false"
				>
					<TrashIcon />
					{{ formatMessage(confirmingRemove ? messages.confirmRemove : messages.remove) }}
				</Button>
			</div>
		</section>

		<Transition name="hosting-savebar">
			<div v-if="dirty" class="hosting-savebar">
				<span class="min-w-0 flex-1 truncate font-semibold text-contrast">
					{{ formatMessage(messages.unsaved) }}
				</span>
				<Button type="outlined" :disabled="actions.isPending(server.id, 'save')" @click="reset">
					<UndoIcon />
					{{ formatMessage(messages.reset) }}
				</Button>
				<Button
					type="colored"
					color="brand"
					:loading="actions.isPending(server.id, 'save')"
					@click="save"
				>
					<SaveIcon />
					{{ formatMessage(messages.save) }}
				</Button>
			</div>
		</Transition>
	</div>
</template>

<style scoped lang="scss">
.hosting-panel {
	display: flex;
	flex-direction: column;
	gap: 0.875rem;
	padding: 1rem;
	border-radius: var(--radius-lg, 0.75rem);
	border: 1px solid var(--surface-5);
	background: var(--surface-4);
	min-width: 0;

	&--danger {
		border-color: color-mix(in srgb, var(--color-red) 40%, var(--surface-5));
	}
}

.hosting-panel-title {
	margin: 0;
	color: var(--color-contrast);
	font-size: 1.125rem;
	font-weight: 700;
}

.hosting-field {
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
	min-width: 0;
}

.hosting-field-label {
	color: var(--color-secondary);
	font-size: 0.875rem;
	font-weight: 600;
}

.hosting-field-hint {
	color: var(--color-secondary);
	font-size: 0.8125rem;
}

.hosting-toggle {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	min-width: 0;
	padding: 0.625rem 0.875rem;
	border-radius: var(--radius-md, 0.5rem);
	border: 1px solid var(--surface-5);
	background: var(--surface-3);
	cursor: pointer;
}

.hosting-savebar {
	position: sticky;
	bottom: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.75rem 0.75rem 0.75rem 1rem;
	border-radius: var(--radius-lg, 0.75rem);
	border: 1px solid var(--color-brand);
	background: color-mix(in srgb, var(--surface-3) 75%, transparent);
	backdrop-filter: blur(14px) saturate(1.2);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.hosting-savebar-enter-active,
.hosting-savebar-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.hosting-savebar-enter-from,
.hosting-savebar-leave-to {
	opacity: 0;
	transform: translateY(0.5rem);
}
</style>
