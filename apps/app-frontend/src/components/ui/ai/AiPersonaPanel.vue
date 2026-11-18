<script setup lang="ts">
import { CheckIcon, UndoIcon, UserIcon } from '@modrinth/assets'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

import {
	agentDisplayName,
	type AiPersona,
	aiSettings,
	PERSONA_LIMITS,
	saveAiSettings,
} from '@/helpers/ai-assistant'

const ROLE_PRESETS = [
	{
		label: 'Напарник',
		text: 'Дружелюбный напарник по Minecraft, который сам берёт задачи и доводит их до конца.',
	},
	{
		label: 'Модмейкер',
		text: 'Опытный разработчик модов Fabric и NeoForge: пишет чистый код и объясняет решения.',
	},
	{
		label: 'Сборщик',
		text: 'Мастер сборок: подбирает совместимые моды, следит за версиями и производительностью.',
	},
	{ label: 'Учитель', text: 'Терпеливый наставник: объясняет просто, по шагам, с примерами.' },
]

const STYLE_PRESETS = [
	{ label: 'Коротко', text: 'Отвечай коротко и по делу, без вступлений.' },
	{
		label: 'Сначала план',
		text: 'Перед большой задачей коротко покажи план из 2–4 шагов, потом делай.',
	},
	{
		label: 'Спрашивай',
		text: 'Если в задаче не хватает важной детали — задай один уточняющий вопрос.',
	},
	{ label: 'Без сленга', text: 'Пиши нейтрально, без игрового сленга.' },
]

const draft = reactive<AiPersona>({ ...aiSettings.value.persona })
const saved = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined

watch(
	() => aiSettings.value.persona,
	(next) => {
		if (saveTimer) return
		Object.assign(draft, next)
	},
)

function commit() {
	saveTimer = undefined
	saveAiSettings({
		persona: {
			name: draft.name.trim().slice(0, PERSONA_LIMITS.name),
			role: draft.role.slice(0, PERSONA_LIMITS.role),
			style: draft.style.slice(0, PERSONA_LIMITS.style),
			callMe: draft.callMe.trim().slice(0, PERSONA_LIMITS.callMe),
		},
	})
	saved.value = true
	clearTimeout(flashTimer)
	flashTimer = setTimeout(() => (saved.value = false), 1400)
}

watch(draft, () => {
	clearTimeout(saveTimer)
	saveTimer = setTimeout(commit, 450)
})

onBeforeUnmount(() => {
	if (saveTimer) {
		clearTimeout(saveTimer)
		commit()
	}
	clearTimeout(flashTimer)
})

function addPreset(field: 'role' | 'style', text: string) {
	const current = draft[field].trim()
	if (current.includes(text)) return
	draft[field] = (field === 'role' || !current ? text : `${current}\n${text}`).slice(
		0,
		PERSONA_LIMITS[field],
	)
}

function reset() {
	Object.assign(draft, { name: '', role: '', style: '', callMe: '' })
}

const shownName = computed(() => draft.name.trim() || agentDisplayName())
const touched = computed(() => Boolean(draft.name || draft.role || draft.style || draft.callMe))
</script>

<template>
	<div class="persona">
		<div class="persona-card">
			<span class="persona-avatar"><UserIcon class="size-4" /></span>
			<span class="min-w-0 grow">
				<span class="persona-name">{{ shownName }}</span>
				<span class="persona-sub">
					{{ draft.callMe.trim() ? `зовёт тебя «${draft.callMe.trim()}»` : 'зовёт тебя по нику' }}
				</span>
			</span>
			<Transition name="persona-fade">
				<span v-if="saved" class="persona-saved"><CheckIcon class="size-3.5" />Сохранено</span>
			</Transition>
		</div>

		<label class="persona-field">
			<span class="persona-label">
				Имя агента
				<em>{{ draft.name.length }}/{{ PERSONA_LIMITS.name }}</em>
			</span>
			<input
				v-model="draft.name"
				class="persona-input"
				:maxlength="PERSONA_LIMITS.name"
				placeholder="Portalus"
				autocomplete="off"
				spellcheck="false"
			/>
		</label>

		<label class="persona-field">
			<span class="persona-label">
				Как обращаться к тебе
				<em>{{ draft.callMe.length }}/{{ PERSONA_LIMITS.callMe }}</em>
			</span>
			<input
				v-model="draft.callMe"
				class="persona-input"
				:maxlength="PERSONA_LIMITS.callMe"
				placeholder="Ник аккаунта"
				autocomplete="off"
			/>
		</label>

		<div class="persona-field">
			<span class="persona-label">
				Кто ты
				<em>{{ draft.role.length }}/{{ PERSONA_LIMITS.role }}</em>
			</span>
			<textarea
				v-model="draft.role"
				class="persona-input persona-area"
				rows="3"
				:maxlength="PERSONA_LIMITS.role"
				placeholder="Например: строгий ревьюер модов, который замечает каждую ошибку"
			/>
			<div class="persona-chips">
				<button
					v-for="preset in ROLE_PRESETS"
					:key="preset.label"
					type="button"
					class="persona-chip"
					:title="preset.text"
					@click="addPreset('role', preset.text)"
				>
					{{ preset.label }}
				</button>
			</div>
		</div>

		<div class="persona-field">
			<span class="persona-label">
				Как работать
				<em>{{ draft.style.length }}/{{ PERSONA_LIMITS.style }}</em>
			</span>
			<textarea
				v-model="draft.style"
				class="persona-input persona-area"
				rows="4"
				:maxlength="PERSONA_LIMITS.style"
				placeholder="Правила, которым агент следует в каждом ответе"
			/>
			<div class="persona-chips">
				<button
					v-for="preset in STYLE_PRESETS"
					:key="preset.label"
					type="button"
					class="persona-chip"
					:title="preset.text"
					@click="addPreset('style', preset.text)"
				>
					+ {{ preset.label }}
				</button>
			</div>
		</div>

		<button v-if="touched" type="button" class="persona-reset" @click="reset">
			<UndoIcon class="size-3.5" />
			Вернуть как было
		</button>
	</div>
</template>

<style scoped>
.persona {
	display: flex;
	flex-direction: column;
	gap: 0.7rem;
}

.persona-card {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	border: 1px solid var(--surface-5);
	border-radius: 0.8rem;
	background: var(--color-button-bg);
	padding: 0.55rem 0.65rem;
}

.persona-avatar {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 2rem;
	height: 2rem;
	border-radius: 0.6rem;
	background: color-mix(in srgb, var(--color-brand) 20%, transparent);
	color: var(--color-brand);
}

.persona-name,
.persona-sub {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.persona-name {
	color: var(--color-contrast);
	font-size: 0.85rem;
	font-weight: 700;
}

.persona-sub {
	color: var(--color-secondary);
	font-size: 0.7rem;
}

.persona-saved {
	display: inline-flex;
	align-items: center;
	gap: 0.2rem;
	flex-shrink: 0;
	color: var(--color-green);
	font-size: 0.68rem;
	font-weight: 600;
}

.persona-field {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
}

.persona-label {
	display: flex;
	justify-content: space-between;
	gap: 0.5rem;
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.persona-label em {
	font-style: normal;
	font-weight: 500;
	letter-spacing: 0;
	opacity: 0.7;
}

.persona-input {
	width: 100%;
	box-sizing: border-box;
	border: 1px solid var(--surface-5);
	border-radius: 0.65rem;
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.8rem;
	padding: 0.45rem 0.6rem;
	outline: none;
	transition:
		border-color 0.18s ease,
		box-shadow 0.18s ease;
}

.persona-input:focus {
	border-color: var(--color-brand);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand) 18%, transparent);
}

.persona-area {
	min-height: 4.5rem;
	resize: vertical;
	line-height: 1.35;
}

.persona-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
}

.persona-chip {
	border: 1px solid var(--surface-5);
	border-radius: 999px;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
	font: inherit;
	font-size: 0.7rem;
	padding: 0.2rem 0.55rem;
	transition:
		color 0.18s ease,
		border-color 0.18s ease,
		background 0.18s ease;
}

.persona-chip:hover {
	border-color: var(--color-brand);
	background: color-mix(in srgb, var(--color-brand) 12%, transparent);
	color: var(--color-contrast);
}

.persona-reset {
	display: inline-flex;
	align-items: center;
	align-self: flex-start;
	gap: 0.3rem;
	border: none;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
	font: inherit;
	font-size: 0.72rem;
	padding: 0.15rem 0;
}

.persona-reset:hover {
	color: var(--color-red);
}

.persona-fade-enter-active,
.persona-fade-leave-active {
	transition: opacity 0.25s ease;
}

.persona-fade-enter-from,
.persona-fade-leave-to {
	opacity: 0;
}
</style>
