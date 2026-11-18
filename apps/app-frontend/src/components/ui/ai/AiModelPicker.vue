<script setup lang="ts">
import {
	CheckIcon,
	ExternalIcon,
	EyeIcon,
	EyeOffIcon,
	KeyIcon,
	SearchIcon,
	ServerIcon,
	SettingsIcon,
	SignalIcon,
	SpinnerIcon,
	XIcon,
} from '@modrinth/assets'
import { Input, Toggle, useVIntl } from '@modrinth/ui'
import { computed, ref, watch } from 'vue'

import AiBrandIcon from '@/components/ui/ai/AiBrandIcon.vue'
import {
	AI_PROVIDERS,
	type AiProvider,
	aiSettings,
	chosenModel,
	isModelEnabled,
	saveAiSettings,
	testProvider,
	zaiPeakHoursLabel,
	zaiPeakHoursNow,
} from '@/helpers/ai-assistant'
import { useAiCatalogText } from '@/helpers/ai-catalog-text'
import {
	applyForPixi,
	isPixiModelOpen,
	PIXI_MODELS,
	pixiAccess,
	refreshPixiAccess,
} from '@/helpers/pixi-agent'

const emit = defineEmits<{ picked: [] }>()

const { formatMessage } = useVIntl()
const catalog = useAiCatalogText()
const messages = {
	search: { id: 'app.ai.picker.search', defaultMessage: 'Найти модель' },
	providers: { id: 'app.ai.picker.providers', defaultMessage: 'Провайдеры' },
	models: { id: 'app.ai.picker.models', defaultMessage: 'Модели' },
	active: { id: 'app.ai.picker.active', defaultMessage: 'Сейчас отвечает' },
	needKey: { id: 'app.ai.picker.need-key', defaultMessage: 'нужен ключ' },
	free: { id: 'app.ai.picker.free', defaultMessage: 'free' },
	russia: { id: 'app.ai.picker.russia', defaultMessage: 'РФ' },
	key: { id: 'app.ai.picker.key', defaultMessage: 'API-ключ' },
	keyPlaceholder: { id: 'app.ai.picker.key.placeholder', defaultMessage: 'Вставьте ключ' },
	keyMissing: {
		id: 'app.ai.picker.key.missing',
		defaultMessage: 'Без ключа модели этого провайдера не отвечают.',
	},
	getKey: { id: 'app.ai.picker.get-key', defaultMessage: 'Получить на {domain}' },
	showKey: { id: 'app.ai.picker.show-key', defaultMessage: 'Показать ключ' },
	hideKey: { id: 'app.ai.picker.hide-key', defaultMessage: 'Скрыть ключ' },
	customBase: { id: 'app.ai.picker.custom-base', defaultMessage: 'Адрес (OpenAI-совместимый)' },
	customModel: { id: 'app.ai.picker.custom-model', defaultMessage: 'Имя модели' },
	customUse: { id: 'app.ai.picker.custom-use', defaultMessage: 'Использовать свой сервер' },
	customInUse: { id: 'app.ai.picker.custom-in-use', defaultMessage: 'Используется' },
	allOff: {
		id: 'app.ai.picker.all-off',
		defaultMessage: 'Все модели скрыты — включите нужные в управлении.',
	},
	nothing: { id: 'app.ai.picker.nothing', defaultMessage: 'Ничего не нашлось' },
	manage: { id: 'app.ai.picker.manage', defaultMessage: 'Управление' },
	manageDone: { id: 'app.ai.picker.manage-done', defaultMessage: 'Готово' },
	manageHint: {
		id: 'app.ai.picker.manage-hint',
		defaultMessage: 'Выключенные модели не показываются в выборе',
	},
	test: { id: 'app.ai.picker.test', defaultMessage: 'Проверить связь' },
	testRunning: { id: 'app.ai.picker.test.running', defaultMessage: 'Проверяю…' },
	testFail: { id: 'app.ai.picker.test.fail', defaultMessage: 'Не отвечает' },
	peakBusy: { id: 'app.ai.picker.peak-busy', defaultMessage: 'Z.AI: часы пик' },
	peakFree: { id: 'app.ai.picker.peak-free', defaultMessage: 'Z.AI: свободно' },
	picked: { id: 'app.ai.picker.picked', defaultMessage: 'Выбрана' },
	pixiChecking: { id: 'app.ai.picker.pixi.checking', defaultMessage: 'Проверяю доступ к Pixi…' },
	pixiOpen: {
		id: 'app.ai.picker.pixi.open',
		defaultMessage: 'Pixi работает бесплатно через аккаунт Undefined',
	},
	pixiNoAccount: {
		id: 'app.ai.picker.pixi.no-account',
		defaultMessage:
			'Нужен вход в аккаунт Undefined (Microsoft или Ely.by) — выберите его в карточке аккаунтов',
	},
	pixiOffline: {
		id: 'app.ai.picker.pixi.offline',
		defaultMessage:
			'Офлайн-аккаунт не входит в Undefined — выберите аккаунт Microsoft или Ely.by в карточке аккаунтов',
	},
	pixiDenied: {
		id: 'app.ai.picker.pixi.denied',
		defaultMessage:
			'Undefined пока не открыл Pixi этому аккаунту — вместо него бесплатно ответят модели каталога',
	},
	pixiPending: {
		id: 'app.ai.picker.pixi.pending',
		defaultMessage: 'Заявка отправлена — ожидайте решения Undefined',
	},
	pixiRejected: {
		id: 'app.ai.picker.pixi.rejected',
		defaultMessage: 'Заявка отклонена — можно подать её повторно',
	},
	pixiError: {
		id: 'app.ai.picker.pixi.error',
		defaultMessage: 'Сервер Undefined не ответил: {error}',
	},
	pixiReason: {
		id: 'app.ai.picker.pixi.reason',
		defaultMessage: 'Зачем вам Pixi (необязательно)',
	},
	pixiApply: { id: 'app.ai.picker.pixi.apply', defaultMessage: 'Подать заявку' },
	pixiRetry: { id: 'app.ai.picker.pixi.retry', defaultMessage: 'Проверить снова' },
	pixiLocked: { id: 'app.ai.picker.pixi.locked', defaultMessage: 'Закрыта — ответит открытая' },
}

const viewedId = ref(aiSettings.value.provider)

const pixiReason = ref('')
const pixiApplying = ref(false)
const pixiApplyError = ref('')

watch(
	viewedId,
	(id) => {
		if (id === 'pixi' && pixiAccess.value.state === 'checking') void refreshPixiAccess()
	},
	{ immediate: true },
)

const pixiLine = computed(() => {
	const access = pixiAccess.value
	if (access.state === 'checking') return formatMessage(messages.pixiChecking)
	if (access.state === 'open') return formatMessage(messages.pixiOpen)
	if (access.state === 'no_account')
		return formatMessage(access.offline ? messages.pixiOffline : messages.pixiNoAccount)
	if (access.state === 'denied') {
		if (access.application === 'pending') return formatMessage(messages.pixiPending)
		if (access.application === 'rejected') return formatMessage(messages.pixiRejected)
		return formatMessage(messages.pixiDenied)
	}
	return formatMessage(messages.pixiError, { error: access.message })
})

const pixiCanApply = computed(
	() => pixiAccess.value.state === 'denied' && pixiAccess.value.application !== 'pending',
)

async function sendPixiApplication() {
	if (pixiApplying.value) return
	pixiApplying.value = true
	pixiApplyError.value = ''
	const result = await applyForPixi(pixiReason.value.trim())
	pixiApplying.value = false
	if (result.ok) pixiReason.value = ''
	else pixiApplyError.value = result.message ?? ''
}

const query = ref('')
const managing = ref(false)
const keyVisible = ref(false)

const viewed = computed<AiProvider>(
	() => AI_PROVIDERS.find((p) => p.id === viewedId.value) ?? AI_PROVIDERS[0],
)

watch(viewedId, () => {
	keyVisible.value = false
})

function keyOf(id: string): string {
	return aiSettings.value.keys[id] ?? ''
}

function setKeyOf(id: string, value: string) {
	aiSettings.value.keys = { ...aiSettings.value.keys, [id]: value }
	saveAiSettings()
}

function hasKey(p: AiProvider): boolean {
	return !p.needsKey || keyOf(p.id).trim().length > 0
}

function providerTags(p: AiProvider): { label: string; warn?: boolean }[] {
	if (p.needsKey && !hasKey(p)) return [{ label: formatMessage(messages.needKey), warn: true }]
	const tags: { label: string }[] = []
	if (p.fromRussia) tags.push({ label: formatMessage(messages.russia) })
	if (!p.needsKey) tags.push({ label: formatMessage(messages.free) })
	return tags
}

function modelOn(p: AiProvider, modelId: string): boolean {
	return isModelEnabled(aiSettings.value, p.id, modelId)
}

function toggleModel(p: AiProvider, modelId: string) {
	saveAiSettings({
		disabledModels: {
			...aiSettings.value.disabledModels,
			[`${p.id}::${modelId}`]: modelOn(p, modelId),
		},
	})
}

function isCurrent(p: AiProvider, modelId: string): boolean {
	return aiSettings.value.provider === p.id && chosenModel(aiSettings.value, p.id) === modelId
}

function selectModel(p: AiProvider, modelId: string) {
	saveAiSettings({
		provider: p.id,
		models: { ...aiSettings.value.models, [p.id]: modelId },
	})
	if (hasKey(p)) {
		emit('picked')
	} else {
		viewedId.value = p.id
		query.value = ''
	}
}

function useCustom() {
	saveAiSettings({ provider: 'custom' })
	emit('picked')
}

const visibleModels = computed(() =>
	managing.value
		? viewed.value.models
		: viewed.value.models.filter((m) => modelOn(viewed.value, m.id)),
)

const searchResults = computed(() => {
	const needle = query.value.trim().toLowerCase()
	if (!needle) return []
	return AI_PROVIDERS.map((p) => ({
		provider: p,
		models: p.models.filter(
			(m) =>
				modelOn(p, m.id) &&
				(m.label.toLowerCase().includes(needle) ||
					m.id.toLowerCase().includes(needle) ||
					p.label.toLowerCase().includes(needle)),
		),
	})).filter((group) => group.models.length > 0)
})

const keyDomain = computed(() => {
	const url = viewed.value.keyUrl
	if (!url) return ''
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
})

function openKeyPage() {
	const url = viewed.value.keyUrl
	if (!url) return
	void (async () => {
		try {
			const { openUrl } = await import('@tauri-apps/plugin-opener')
			await openUrl(url)
		} catch {
			console.error('Страница ключа не открылась', url)
		}
	})()
}

const customBase = computed({
	get: () => aiSettings.value.customBaseUrl,
	set: (value: string) => saveAiSettings({ customBaseUrl: value }),
})

const customModelName = computed({
	get: () => aiSettings.value.customModel,
	set: (value: string) => saveAiSettings({ customModel: value }),
})

const testState = ref<'idle' | 'running' | 'ok' | 'fail'>('idle')
const testResult = ref('')

watch(
	() => aiSettings.value.provider,
	() => {
		testState.value = 'idle'
		testResult.value = ''
	},
)

async function runTest() {
	if (testState.value === 'running') return
	testState.value = 'running'
	testResult.value = ''
	try {
		testResult.value = await testProvider()
		testState.value = 'ok'
	} catch (error) {
		testResult.value = String((error as Error)?.message ?? error).slice(0, 240)
		testState.value = 'fail'
	}
}
</script>

<template>
	<div class="ai-picker">
		<div class="ai-picker-top">
			<Input
				v-model="query"
				:icon="SearchIcon"
				size="small"
				clearable
				autocomplete="off"
				:placeholder="formatMessage(messages.search)"
				wrapper-class="min-w-0 grow"
			/>
			<span
				v-if="aiSettings.provider === 'zai'"
				class="ai-picker-peak"
				:class="{ 'ai-picker-peak--busy': zaiPeakHoursNow() }"
				:title="zaiPeakHoursLabel()"
			>
				{{ formatMessage(zaiPeakHoursNow() ? messages.peakBusy : messages.peakFree) }}
			</span>
		</div>

		<div v-if="query.trim()" class="ai-picker-results">
			<template v-for="group in searchResults" :key="group.provider.id">
				<p class="ai-picker-caption ai-picker-caption--brand">
					<AiBrandIcon :provider="group.provider.id" />
					{{ catalog.label(group.provider.label) }}
				</p>
				<button
					v-for="model in group.models"
					:key="model.id"
					type="button"
					class="ai-picker-model"
					:class="{ 'ai-picker-model--on': isCurrent(group.provider, model.id) }"
					@click="selectModel(group.provider, model.id)"
				>
					<AiBrandIcon :provider="group.provider.id" :model="model.id" :label="model.label" />
					<span class="min-w-0 grow">
						<span class="ai-picker-model-name">{{ catalog.label(model.label) }}</span>
						<span class="ai-picker-model-id">{{ model.id }}</span>
					</span>
					<CheckIcon
						v-if="isCurrent(group.provider, model.id)"
						class="size-4 shrink-0 text-brand"
					/>
				</button>
			</template>
			<p v-if="searchResults.length === 0" class="ai-picker-empty">
				{{ formatMessage(messages.nothing) }}
			</p>
		</div>

		<div v-else class="ai-picker-panes">
			<nav class="ai-picker-rail" :aria-label="formatMessage(messages.providers)">
				<button
					v-for="p in AI_PROVIDERS"
					:key="p.id"
					type="button"
					class="ai-picker-provider"
					:class="{ 'ai-picker-provider--on': viewedId === p.id }"
					@click="viewedId = p.id"
				>
					<span class="ai-picker-provider-row">
						<AiBrandIcon :provider="p.id" />
						<span class="ai-picker-provider-name">{{ catalog.label(p.label) }}</span>
						<span
							v-if="aiSettings.provider === p.id"
							v-tooltip="formatMessage(messages.active)"
							class="ai-picker-dot"
						/>
					</span>
					<span class="ai-picker-tags">
						<span
							v-for="tag in providerTags(p)"
							:key="tag.label"
							class="ai-picker-tag"
							:class="{ 'ai-picker-tag--warn': tag.warn }"
						>
							{{ tag.label }}
						</span>
					</span>
				</button>
			</nav>

			<section class="ai-picker-detail">
				<div class="ai-picker-detail-head">
					<span class="ai-picker-detail-title">
						<AiBrandIcon :provider="viewed.id" size="md" />
						<span class="min-w-0 truncate">{{ catalog.label(viewed.label) }}</span>
					</span>
					<p v-if="viewed.note" class="ai-picker-note">{{ catalog.note(viewed) }}</p>
				</div>

				<div v-if="viewed.needsKey" class="ai-picker-key">
					<div class="flex items-center gap-1.5">
						<Input
							:model-value="keyOf(viewed.id)"
							:type="keyVisible ? 'text' : 'password'"
							:icon="KeyIcon"
							size="small"
							autocomplete="off"
							:spellcheck="false"
							:placeholder="formatMessage(messages.keyPlaceholder)"
							:error="!hasKey(viewed)"
							wrapper-class="min-w-0 grow"
							@update:model-value="(value) => setKeyOf(viewed.id, String(value))"
						/>
						<button
							v-tooltip="formatMessage(keyVisible ? messages.hideKey : messages.showKey)"
							type="button"
							class="ai-picker-icon-btn"
							:aria-label="formatMessage(keyVisible ? messages.hideKey : messages.showKey)"
							@click="keyVisible = !keyVisible"
						>
							<EyeOffIcon v-if="keyVisible" class="size-4" />
							<EyeIcon v-else class="size-4" />
						</button>
					</div>
					<div class="flex items-center justify-between gap-2">
						<span v-if="!hasKey(viewed)" class="ai-picker-warn">
							{{ formatMessage(messages.keyMissing) }}
						</span>
						<button v-if="viewed.keyUrl" type="button" class="ai-picker-link" @click="openKeyPage">
							<span class="truncate">{{
								formatMessage(messages.getKey, { domain: keyDomain })
							}}</span>
							<ExternalIcon class="size-3.5 shrink-0" />
						</button>
					</div>
				</div>

				<div v-if="viewed.id === 'custom'" class="ai-picker-custom">
					<label class="ai-picker-field">
						<span>{{ formatMessage(messages.customBase) }}</span>
						<Input
							v-model="customBase"
							size="small"
							autocomplete="off"
							placeholder="http://localhost:1234/v1/chat/completions"
						/>
					</label>
					<label class="ai-picker-field">
						<span>{{ formatMessage(messages.customModel) }}</span>
						<Input
							v-model="customModelName"
							size="small"
							autocomplete="off"
							placeholder="my-model"
						/>
					</label>
					<button
						type="button"
						class="ai-picker-use"
						:class="{ 'ai-picker-use--on': aiSettings.provider === 'custom' }"
						:disabled="!aiSettings.customBaseUrl.trim()"
						@click="useCustom"
					>
						<ServerIcon class="size-4" />
						{{
							formatMessage(
								aiSettings.provider === 'custom' ? messages.customInUse : messages.customUse,
							)
						}}
					</button>
				</div>

				<div v-else class="ai-picker-list">
					<p class="ai-picker-caption">
						{{ formatMessage(managing ? messages.manageHint : messages.models) }}
					</p>
					<template v-if="managing">
						<label v-for="model in visibleModels" :key="model.id" class="ai-picker-model">
							<AiBrandIcon :provider="viewed.id" :model="model.id" :label="model.label" />
							<span class="min-w-0 grow">
								<span class="ai-picker-model-name">{{ catalog.label(model.label) }}</span>
								<span class="ai-picker-model-id">{{ model.id }}</span>
							</span>
							<Toggle
								small
								:model-value="modelOn(viewed, model.id)"
								@update:model-value="toggleModel(viewed, model.id)"
							/>
						</label>
					</template>
					<template v-else-if="viewed.id === 'pixi'">
						<div
							class="ai-picker-pixi-access"
							:data-state="pixiAccess.state"
							role="status"
							aria-live="polite"
						>
							<SpinnerIcon
								v-if="pixiAccess.state === 'checking'"
								class="size-4 shrink-0 animate-spin"
							/>
							<span class="min-w-0 grow">{{ pixiLine }}</span>
							<button
								v-if="pixiAccess.state !== 'checking' && pixiAccess.state !== 'open'"
								type="button"
								class="ai-picker-link"
								@click="refreshPixiAccess"
							>
								{{ formatMessage(messages.pixiRetry) }}
							</button>
						</div>
						<form
							v-if="pixiCanApply"
							class="ai-picker-pixi-apply"
							@submit.prevent="sendPixiApplication"
						>
							<Input
								v-model="pixiReason"
								size="small"
								autocomplete="off"
								:placeholder="formatMessage(messages.pixiReason)"
								wrapper-class="min-w-0 grow"
							/>
							<button type="submit" class="ai-picker-use" :disabled="pixiApplying">
								<SpinnerIcon v-if="pixiApplying" class="size-4 animate-spin" />
								{{ formatMessage(messages.pixiApply) }}
							</button>
							<span v-if="pixiApplyError" class="ai-picker-warn basis-full">
								{{ pixiApplyError }}
							</span>
						</form>
						<button
							v-for="pixi in PIXI_MODELS.filter((row) => modelOn(viewed, row.id))"
							:key="pixi.id"
							type="button"
							class="ai-picker-pixi"
							:data-tone="pixi.tone"
							:class="{
								'ai-picker-pixi--on': isCurrent(viewed, pixi.id),
								'ai-picker-pixi--locked': !isPixiModelOpen(pixi.id),
							}"
							:aria-pressed="isCurrent(viewed, pixi.id)"
							@click="selectModel(viewed, pixi.id)"
						>
							<svg class="ai-picker-pixi-mark" viewBox="0 0 16 16" aria-hidden="true">
								<rect width="11" height="11" rx="1.5" />
								<rect x="11" y="11" width="5" height="5" rx="1" />
							</svg>
							<span class="ai-picker-pixi-tier">{{ pixi.tier }}</span>
							<span class="min-w-0 grow">
								<span class="ai-picker-model-name">{{ pixi.family }}</span>
								<span class="ai-picker-pixi-desc">{{ pixi.description }}</span>
							</span>
							<span
								v-if="!isPixiModelOpen(pixi.id)"
								class="ai-picker-pixi-state ai-picker-pixi-state--locked"
							>
								{{ formatMessage(messages.pixiLocked) }}
							</span>
							<span v-else-if="isCurrent(viewed, pixi.id)" class="ai-picker-pixi-state">
								{{ formatMessage(messages.picked) }}
							</span>
						</button>
						<p v-if="visibleModels.length === 0" class="ai-picker-empty">
							{{ formatMessage(messages.allOff) }}
						</p>
					</template>
					<template v-else>
						<button
							v-for="model in visibleModels"
							:key="model.id"
							type="button"
							class="ai-picker-model"
							:class="{ 'ai-picker-model--on': isCurrent(viewed, model.id) }"
							@click="selectModel(viewed, model.id)"
						>
							<AiBrandIcon :provider="viewed.id" :model="model.id" :label="model.label" />
							<span class="min-w-0 grow">
								<span class="ai-picker-model-name">{{ catalog.label(model.label) }}</span>
								<span class="ai-picker-model-id">{{ model.id }}</span>
							</span>
							<CheckIcon v-if="isCurrent(viewed, model.id)" class="size-4 shrink-0 text-brand" />
						</button>
						<p v-if="visibleModels.length === 0" class="ai-picker-empty">
							{{ formatMessage(messages.allOff) }}
						</p>
					</template>
				</div>
			</section>
		</div>

		<footer class="ai-picker-foot">
			<button
				type="button"
				class="ai-picker-foot-btn"
				:class="{
					'ai-picker-foot-btn--ok': testState === 'ok',
					'ai-picker-foot-btn--fail': testState === 'fail',
				}"
				:disabled="testState === 'running'"
				@click="runTest"
			>
				<SpinnerIcon v-if="testState === 'running'" class="size-4 animate-spin" />
				<CheckIcon v-else-if="testState === 'ok'" class="size-4" />
				<XIcon v-else-if="testState === 'fail'" class="size-4" />
				<SignalIcon v-else class="size-4" />
				<span class="truncate">
					{{
						testState === 'running'
							? formatMessage(messages.testRunning)
							: testState === 'fail'
								? formatMessage(messages.testFail)
								: testState === 'ok'
									? testResult
									: formatMessage(messages.test)
					}}
				</span>
			</button>
			<span
				v-if="testState === 'fail' && testResult"
				v-tooltip="testResult"
				class="ai-picker-foot-error"
			>
				{{ testResult }}
			</span>
			<button
				v-if="!query.trim() && viewed.id !== 'custom'"
				type="button"
				class="ai-picker-foot-btn ml-auto"
				:class="{ 'ai-picker-foot-btn--active': managing }"
				@click="managing = !managing"
			>
				<CheckIcon v-if="managing" class="size-4" />
				<SettingsIcon v-else class="size-4" />
				{{ formatMessage(managing ? messages.manageDone : messages.manage) }}
			</button>
		</footer>
	</div>
</template>

<style scoped>
@keyframes ai-mode-pop {
	from {
		opacity: 0;
		transform: scale(0.85);
	}
}

.ai-picker {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	height: min(28rem, calc(100vh - 16rem));
	min-height: 16rem;
}

.ai-picker-top {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.ai-picker-peak {
	flex-shrink: 0;
	padding: 0.2rem 0.55rem;
	border-radius: 999px;
	background: color-mix(in srgb, var(--color-green) 14%, transparent);
	color: var(--color-green);
	font-size: 0.6875rem;
	font-weight: 600;
	white-space: nowrap;
}

.ai-picker-peak--busy {
	background: color-mix(in srgb, var(--color-orange) 14%, transparent);
	color: var(--color-orange);
}

.ai-picker-panes {
	display: grid;
	flex: 1;
	grid-template-columns: 11.5rem minmax(0, 1fr);
	gap: 0.5rem;
	min-height: 0;
}

.ai-picker-rail,
.ai-picker-detail,
.ai-picker-results {
	min-height: 0;
	overflow-y: auto;
}

.ai-picker-results {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.125rem;
}

.ai-picker-rail {
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	padding-right: 0.5rem;
	border-right: 1px solid var(--surface-5);
}

.ai-picker-provider {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	width: 100%;
	padding: 0.45rem 0.55rem;
	border: 0;
	border-radius: 0.6rem;
	background: transparent;
	color: var(--color-primary);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.ai-picker-provider:hover {
	background: var(--color-button-bg);
}

.ai-picker-provider--on {
	background: color-mix(in srgb, var(--color-brand) 12%, transparent);
}

.ai-picker-provider--on:hover {
	background: color-mix(in srgb, var(--color-brand) 16%, transparent);
}

.ai-picker-provider-row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	min-width: 0;
}

.ai-picker-provider-name {
	display: -webkit-box;
	overflow: hidden;
	font-size: 0.8125rem;
	font-weight: 600;
	line-height: 1.25;
	color: var(--color-contrast);
	overflow-wrap: anywhere;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
}

.ai-picker-dot {
	flex-shrink: 0;
	width: 0.45rem;
	height: 0.45rem;
	border-radius: 999px;
	background: var(--color-brand);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand) 22%, transparent);
}

.ai-picker-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 0.2rem;
}

.ai-picker-tag {
	padding: 0 0.35rem;
	border-radius: 0.3rem;
	background: var(--surface-4);
	color: var(--color-secondary);
	font-size: 0.625rem;
	font-weight: 600;
	line-height: 1.1rem;
}

.ai-picker-tag--warn {
	background: color-mix(in srgb, var(--color-orange) 16%, transparent);
	color: var(--color-orange);
}

.ai-picker-detail {
	display: flex;
	flex-direction: column;
	gap: 0.625rem;
	padding-right: 0.125rem;
}

.ai-picker-detail-head {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	padding: 0.25rem 0.25rem 0;
}

.ai-picker-detail-title {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	min-width: 0;
	font-size: 0.9375rem;
	font-weight: 700;
	color: var(--color-contrast);
}

.ai-picker-note {
	margin: 0;
	font-size: 0.75rem;
	line-height: 1.35;
	color: var(--color-secondary);
}

.ai-picker-key,
.ai-picker-custom {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	padding: 0.5rem;
	border: 1px solid var(--surface-5);
	border-radius: 0.7rem;
	background: color-mix(in srgb, var(--color-button-bg) 60%, transparent);
}

.ai-picker-custom {
	gap: 0.55rem;
}

.ai-picker-field {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--color-secondary);
}

.ai-picker-icon-btn {
	display: grid;
	flex-shrink: 0;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border: 0;
	border-radius: 0.55rem;
	background: var(--color-button-bg);
	color: var(--color-secondary);
	cursor: pointer;
}

.ai-picker-icon-btn:hover {
	color: var(--color-contrast);
}

.ai-picker-warn {
	font-size: 0.6875rem;
	line-height: 1.3;
	color: var(--color-orange);
}

.ai-picker-link {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	min-width: 0;
	margin-left: auto;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--color-brand);
	font: inherit;
	font-size: 0.75rem;
	font-weight: 600;
	cursor: pointer;
}

.ai-picker-link:hover {
	text-decoration: underline;
}

.ai-picker-use {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.4rem;
	padding: 0.45rem 0.75rem;
	border: 0;
	border-radius: 0.6rem;
	background: var(--color-brand);
	color: var(--color-accent-contrast, #000);
	font: inherit;
	font-size: 0.8125rem;
	font-weight: 700;
	cursor: pointer;
	transition: filter 0.15s ease;
}

.ai-picker-use:hover:not(:disabled) {
	filter: brightness(1.08);
}

.ai-picker-use:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.ai-picker-use--on {
	background: color-mix(in srgb, var(--color-brand) 16%, transparent);
	color: var(--color-brand);
}

.ai-picker-list {
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
}

.ai-picker-caption {
	margin: 0.25rem 0.375rem 0.125rem;
	font-size: 0.6875rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-secondary);
}

.ai-picker-model {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	width: 100%;
	padding: 0.45rem 0.55rem;
	border: 1px solid transparent;
	border-radius: 0.6rem;
	background: transparent;
	color: var(--color-primary);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		border-color 0.15s ease;
}

.ai-picker-model:hover {
	background: var(--color-button-bg);
}

.ai-picker-model--on {
	border-color: color-mix(in srgb, var(--color-brand) 45%, transparent);
	background: color-mix(in srgb, var(--color-brand) 10%, transparent);
}

.ai-picker-model-name {
	display: block;
	overflow: hidden;
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--color-contrast);
	white-space: nowrap;
	text-overflow: ellipsis;
}

.ai-picker-model-id {
	display: block;
	overflow: hidden;
	font-family: var(--mono-font, ui-monospace, monospace);
	font-size: 0.6875rem;
	color: var(--color-secondary);
	white-space: nowrap;
	text-overflow: ellipsis;
}

.ai-picker-empty {
	margin: 0;
	padding: 1rem 0.5rem;
	font-size: 0.8125rem;
	text-align: center;
	color: var(--color-secondary);
}

.ai-picker-foot {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	min-width: 0;
	padding-top: 0.5rem;
	border-top: 1px solid var(--surface-5);
}

.ai-picker-foot-btn {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 0.375rem;
	max-width: 15rem;
	padding: 0.35rem 0.65rem;
	border: 0;
	border-radius: 999px;
	background: var(--color-button-bg);
	color: var(--color-primary);
	font: inherit;
	font-size: 0.75rem;
	font-weight: 600;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.ai-picker-foot-btn:hover:not(:disabled) {
	color: var(--color-contrast);
}

.ai-picker-foot-btn:disabled {
	cursor: progress;
}

.ai-picker-foot-btn--ok {
	background: color-mix(in srgb, var(--color-green) 14%, transparent);
	color: var(--color-green);
}

.ai-picker-foot-btn--fail {
	background: color-mix(in srgb, var(--color-red) 14%, transparent);
	color: var(--color-red);
}

.ai-picker-foot-btn--active {
	background: color-mix(in srgb, var(--color-brand) 14%, transparent);
	color: var(--color-brand);
}

.ai-picker-pixi-access {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-bottom: 0.25rem;
	padding: 0.5rem 0.65rem;
	border: 1px solid var(--surface-5);
	border-radius: 0.7rem;
	background: var(--surface-3, var(--color-button-bg));
	font-size: 0.75rem;
	line-height: 1.35;
	color: var(--color-secondary);
}

.ai-picker-pixi-access[data-state='open'] {
	border-color: color-mix(in srgb, var(--color-green) 40%, transparent);
	color: var(--color-green);
}

.ai-picker-pixi-access[data-state='no_account'],
.ai-picker-pixi-access[data-state='denied'] {
	border-color: color-mix(in srgb, var(--color-orange) 40%, transparent);
	color: var(--color-orange);
}

.ai-picker-pixi-access[data-state='error'] {
	border-color: color-mix(in srgb, var(--color-red) 40%, transparent);
	color: var(--color-red);
}

.ai-picker-pixi-apply {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
	margin-bottom: 0.25rem;
}

.ai-picker-pixi {
	--pixi-tone: #9ca3af;
	display: flex;
	align-items: center;
	gap: 0.6rem;
	width: 100%;
	padding: 0.5rem 0.6rem;
	border: 1px solid transparent;
	border-radius: 0.6rem;
	background: transparent;
	color: var(--color-primary);
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		border-color 0.15s ease;
}

.ai-picker-pixi[data-tone='pro'] {
	--pixi-tone: #7fb069;
}

.ai-picker-pixi[data-tone='ultra'] {
	--pixi-tone: #3b82f6;
}

.ai-picker-pixi[data-tone='flash'] {
	--pixi-tone: #a066d3;
}

.ai-picker-pixi:hover {
	background: var(--color-button-bg);
}

.ai-picker-pixi--on {
	border-color: color-mix(in srgb, var(--color-brand) 45%, transparent);
	background: color-mix(in srgb, var(--color-brand) 10%, transparent);
}

.ai-picker-pixi-mark {
	flex-shrink: 0;
	width: 1rem;
	height: 1rem;
	fill: var(--pixi-tone);
}

.ai-picker-pixi-tier {
	flex-shrink: 0;
	min-width: 3.1rem;
	padding: 0.1rem 0.45rem;
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--pixi-tone) 30%, transparent);
	color: var(--color-contrast);
	font-size: 0.75rem;
	font-weight: 800;
	text-align: center;
}

.ai-picker-pixi-desc {
	display: block;
	overflow: hidden;
	font-size: 0.6875rem;
	color: var(--color-secondary);
	white-space: nowrap;
	text-overflow: ellipsis;
}

.ai-picker-caption--brand {
	display: flex;
	align-items: center;
	gap: 0.4rem;
}

.ai-picker-pixi--locked {
	opacity: 0.62;
}

.ai-picker-pixi-state--locked {
	color: var(--color-secondary);
	font-weight: 600;
}

.ai-picker-pixi-state {
	flex-shrink: 0;
	font-size: 0.6875rem;
	font-weight: 700;
	color: var(--color-brand);
}

.ai-picker-foot-error {
	min-width: 0;
	overflow: hidden;
	font-size: 0.6875rem;
	color: var(--color-red);
	white-space: nowrap;
	text-overflow: ellipsis;
}
</style>
