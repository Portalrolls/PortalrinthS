<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, ref } from 'vue'

import { parseRich } from './rich-text'
import { myId, state } from './store'

const props = defineProps<{ text: string }>()
const emit = defineEmits<{ mention: [name: string, el: HTMLElement] }>()

const nodes = computed(() => parseRich(props.text))
const revealed = ref(new Set<number>())

const myName = computed(() => String(state.session?.user?.username || '').toLowerCase())

function isSelf(name: string): boolean {
	return Boolean(myId.value) && name.toLowerCase() === myName.value
}

function open(href: string): void {
	void openUrl(href).catch(() => window.open(href, '_blank', 'noopener'))
}

function reveal(index: number): void {
	revealed.value = new Set([...revealed.value, index])
}
</script>

<template>
	<span class="msgr-rich">
		<template v-for="(node, index) in nodes" :key="index">
			<br v-if="node.type === 'br'" />
			<template v-else-if="node.type === 'text'">{{ node.text }}</template>
			<strong v-else-if="node.type === 'bold'">{{ node.text }}</strong>
			<em v-else-if="node.type === 'italic'">{{ node.text }}</em>
			<s v-else-if="node.type === 'strike'">{{ node.text }}</s>
			<code v-else-if="node.type === 'code'" class="msgr-rich__code">{{ node.text }}</code>
			<pre v-else-if="node.type === 'pre'" class="msgr-rich__pre">{{ node.text }}</pre>
			<button
				v-else-if="node.type === 'spoiler'"
				type="button"
				class="msgr-rich__spoiler"
				:class="{ 'is-open': revealed.has(index) }"
				@click.stop="reveal(index)"
			>
				{{ node.text }}
			</button>
			<a
				v-else-if="node.type === 'link'"
				class="msgr-rich__link"
				:href="node.href"
				@click.prevent.stop="open(node.href)"
				>{{ node.text }}</a
			>
			<button
				v-else-if="node.type === 'mention'"
				type="button"
				class="msgr-rich__mention"
				:class="{ 'is-self': isSelf(node.name) }"
				@click.stop="emit('mention', node.name, $event.currentTarget as HTMLElement)"
			>
				{{ node.text }}
			</button>
		</template>
	</span>
</template>

<style scoped>
.msgr-rich {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.msgr-rich__code {
	padding: 0.1em 0.35em;
	border-radius: 4px;
	background: rgba(0, 0, 0, 0.35);
	font-family: var(--mono-font, ui-monospace, monospace);
	font-size: 0.88em;
}

.msgr-rich__pre {
	margin: 0.35rem 0;
	padding: 0.6rem 0.75rem;
	max-width: 100%;
	overflow-x: auto;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.4);
	font-family: var(--mono-font, ui-monospace, monospace);
	font-size: 0.85em;
	white-space: pre;
}

.msgr-rich__link {
	color: #7cc4ff;
	text-decoration: none;
	cursor: pointer;
}

.msgr-rich__link:hover {
	text-decoration: underline;
}

.msgr-rich__mention {
	padding: 0 0.2em;
	border: 0;
	border-radius: 4px;
	background: color-mix(in srgb, var(--color-brand) 22%, transparent);
	color: color-mix(in srgb, var(--color-brand) 55%, white);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s ease;
}

.msgr-rich__mention:hover {
	background: color-mix(in srgb, var(--color-brand) 45%, transparent);
	color: white;
}

.msgr-rich__mention.is-self {
	background: rgba(240, 178, 50, 0.22);
	color: #f6cf72;
}

.msgr-rich__spoiler {
	padding: 0 0.25em;
	border: 0;
	border-radius: 4px;
	background: #1e1f22;
	color: transparent;
	font: inherit;
	cursor: pointer;
	transition:
		color 0.2s ease,
		background 0.2s ease;
}

.msgr-rich__spoiler.is-open {
	background: rgba(255, 255, 255, 0.08);
	color: inherit;
	cursor: text;
}
</style>
