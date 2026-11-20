<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { EMOJI_GROUPS } from './emoji'

const emit = defineEmits<{ pick: [emoji: string] }>()

const RECENT_KEY = 'portalrinth-messenger-recent-emoji'
const RECENT_LIMIT = 24

const group = ref('recent')
const recents = ref<string[]>([])

onMounted(() => {
	try {
		const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
		recents.value = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
	} catch {
		recents.value = []
	}
})

watch(recents, (list) => {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)))
	} catch {
		/* без хранилища недавние живут до перезапуска */
	}
})

const groups = computed(() => [
	{ id: 'recent', label: '🕐', items: recents.value },
	...EMOJI_GROUPS,
])

function pick(emoji: string): void {
	recents.value = [emoji, ...recents.value.filter((item) => item !== emoji)].slice(0, RECENT_LIMIT)
	emit('pick', emoji)
}
</script>

<template>
	<div class="msgr-emoji">
		<div class="msgr-emoji__tabs">
			<button
				v-for="entry in groups"
				:key="entry.id"
				type="button"
				:class="{ 'is-active': group === entry.id }"
				:title="entry.id === 'recent' ? 'Недавние' : undefined"
				@click="group = entry.id"
			>
				{{ entry.label }}
			</button>
		</div>
		<p v-if="group === 'recent' && !recents.length" class="msgr-emoji__empty">
			Здесь появятся эмодзи, которыми ты пользуешься
		</p>
		<div v-else class="msgr-emoji__grid">
			<button
				v-for="emoji in groups.find((entry) => entry.id === group)?.items ?? []"
				:key="emoji"
				type="button"
				@click="pick(emoji)"
			>
				{{ emoji }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.msgr-emoji {
	width: 18.5rem;
}

.msgr-emoji__tabs {
	display: flex;
	gap: 0.25rem;
	padding-bottom: 0.35rem;
	margin-bottom: 0.35rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.msgr-emoji__tabs button {
	padding: 0.25rem 0.5rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	font-family:
		'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', sans-serif;
	font-size: 1.05rem;
	cursor: pointer;
	opacity: 0.55;
	transition:
		opacity 0.12s ease,
		background 0.12s ease;
}

.msgr-emoji__tabs button.is-active,
.msgr-emoji__tabs button:hover {
	background: rgba(255, 255, 255, 0.08);
	opacity: 1;
}

.msgr-emoji__empty {
	padding: 0.5rem 0.25rem;
	font-size: 0.78rem;
	opacity: 0.55;
}

.msgr-emoji__grid {
	display: grid;
	grid-template-columns: repeat(8, 1fr);
	gap: 0.1rem;
	max-height: 14rem;
	overflow-y: auto;
}

.msgr-emoji__grid button {
	aspect-ratio: 1;
	border: 0;
	border-radius: 6px;
	background: transparent;
	font-family:
		'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', sans-serif;
	font-size: 1.3rem;
	line-height: 1;
	cursor: pointer;
	transition:
		background 0.1s ease,
		transform 0.1s ease;
}

.msgr-emoji__grid button:hover {
	background: rgba(255, 255, 255, 0.1);
	transform: scale(1.15);
}

@media (prefers-reduced-motion: reduce) {
	.msgr-emoji__grid button {
		transition: none;
	}
}
</style>
