<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed } from 'vue'

import { renderArticle, renderRich } from './feed'

const props = withDefaults(defineProps<{ text: string; article?: boolean }>(), {
	article: false,
})

const emit = defineEmits<{
	tag: [tag: string]
	mention: [username: string]
	image: [url: string]
}>()

const html = computed(() => (props.article ? renderArticle(props.text) : renderRich(props.text)))

function onClick(event: MouseEvent) {
	const target = event.target as HTMLElement | null
	if (!target) return
	const tag = target.closest<HTMLElement>('[data-nf-tag]')
	if (tag) {
		event.preventDefault()
		event.stopPropagation()
		emit('tag', tag.dataset.nfTag || '')
		return
	}
	const mention = target.closest<HTMLElement>('[data-nf-user]')
	if (mention) {
		event.preventDefault()
		event.stopPropagation()
		emit('mention', mention.dataset.nfUser || '')
		return
	}
	const link = target.closest<HTMLAnchorElement>('a[href]')
	if (link) {
		event.preventDefault()
		event.stopPropagation()
		const href = link.getAttribute('href') || ''
		if (/^https?:\/\//i.test(href)) void openUrl(href)
		return
	}
	if (target instanceof HTMLImageElement && target.src) {
		event.stopPropagation()
		emit('image', target.src)
	}
}
</script>

<template>
	<!-- eslint-disable-next-line vue/no-v-html -->
	<div class="nf-rich" :class="{ 'is-article': article }" @click="onClick" v-html="html" />
</template>

<style scoped>
.nf-rich {
	color: var(--color-text-default, rgba(255, 255, 255, 0.86));
	font-size: 14px;
	line-height: 1.5;
	overflow-wrap: anywhere;
}

.nf-rich :deep(p) {
	margin: 0 0 0.5em;
}

.nf-rich :deep(p:last-child) {
	margin-bottom: 0;
}

.nf-rich :deep(a) {
	color: var(--color-brand);
	text-decoration: none;
}

.nf-rich :deep(a:hover) {
	text-decoration: underline;
}

.nf-rich :deep(.nf-tag),
.nf-rich :deep(.nf-mention) {
	display: inline;
	margin: 0;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-brand);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
}

.nf-rich :deep(.nf-tag:hover),
.nf-rich :deep(.nf-mention:hover) {
	text-decoration: underline;
}

.nf-rich :deep(h1),
.nf-rich :deep(h2),
.nf-rich :deep(h3),
.nf-rich :deep(h4) {
	margin: 0.9em 0 0.4em;
	color: var(--color-contrast, #fff);
	line-height: 1.3;
}

.nf-rich :deep(h1) {
	font-size: 1.35em;
}

.nf-rich :deep(h2) {
	font-size: 1.2em;
}

.nf-rich :deep(h3),
.nf-rich :deep(h4) {
	font-size: 1.05em;
}

.nf-rich :deep(ul),
.nf-rich :deep(ol) {
	margin: 0 0 0.6em;
	padding-left: 1.3em;
}

.nf-rich :deep(blockquote) {
	margin: 0 0 0.6em;
	padding: 6px 12px;
	border-left: 3px solid var(--color-brand);
	border-radius: 0 8px 8px 0;
	background: rgba(176, 0, 255, 0.08);
	color: var(--color-text-secondary, rgba(255, 255, 255, 0.7));
}

.nf-rich :deep(code) {
	padding: 1px 5px;
	border-radius: 5px;
	background: rgba(255, 255, 255, 0.08);
	font-size: 0.9em;
}

.nf-rich :deep(pre) {
	overflow-x: auto;
	padding: 10px 12px;
	border-radius: 8px;
	background: #161618;
}

.nf-rich :deep(pre code) {
	padding: 0;
	background: none;
}

.nf-rich :deep(hr) {
	margin: 1em 0;
	border: 0;
	border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.nf-rich :deep(img) {
	display: block;
	max-width: 100%;
	margin: 0.6em 0;
	border-radius: 10px;
	cursor: zoom-in;
}

.nf-rich :deep(table) {
	width: 100%;
	margin: 0 0 0.6em;
	border-collapse: collapse;
	font-size: 0.92em;
}

.nf-rich :deep(th),
.nf-rich :deep(td) {
	padding: 6px 8px;
	border: 1px solid rgba(255, 255, 255, 0.1);
	text-align: left;
}

.nf-rich.is-article {
	font-size: 15px;
	line-height: 1.6;
}
</style>
