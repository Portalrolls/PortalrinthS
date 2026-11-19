<script setup lang="ts">
import { ReplyIcon, TrashIcon } from '@modrinth/assets'
import { computed } from 'vue'

import { type CommentNode, useNewsText, userAvatar } from './feed'
import { openLightbox } from './lightbox'
import NewsAvatar from './NewsAvatar.vue'
import NewsRichText from './NewsRichText.vue'

defineOptions({ name: 'NewsComment' })

const props = withDefaults(
	defineProps<{
		node: CommentNode
		depth?: number
		canReply: boolean
	}>(),
	{ depth: 0 },
)

const emit = defineEmits<{
	reply: [node: CommentNode]
	delete: [node: CommentNode]
	profile: [node: CommentNode]
	tag: [tag: string]
	mention: [username: string]
}>()

const { t, timeAgo } = useNewsText()

const name = computed(() => props.node.author?.username || t('app.news.someone', 'Игрок'))
const avatar = computed(() => userAvatar(props.node.author))
</script>

<template>
	<div class="nf-comment" :class="{ 'is-nested': depth > 0 }">
		<div class="nf-comment__row">
			<button
				type="button"
				class="nf-comment__avatar"
				:aria-label="t('app.news.openProfile', 'Открыть профиль')"
				@click="emit('profile', node)"
			>
				<NewsAvatar :source="avatar" :size="depth > 0 ? 24 : 28" />
			</button>
			<div class="nf-comment__main">
				<div class="nf-comment__head">
					<button type="button" class="nf-comment__name" @click="emit('profile', node)">
						{{ name }}
					</button>
					<span v-if="node.replyTo?.username" class="nf-comment__to">
						→ {{ node.replyTo.username }}
					</span>
					<span class="nf-comment__time">{{ timeAgo(node.createdAt) }}</span>
				</div>
				<NewsRichText
					class="nf-comment__body"
					:text="node.bodyMd"
					@tag="emit('tag', $event)"
					@mention="emit('mention', $event)"
					@image="(url) => openLightbox([{ url, video: false }])"
				/>
				<div class="nf-comment__actions">
					<button
						v-if="canReply"
						type="button"
						class="nf-comment__act"
						@click="emit('reply', node)"
					>
						<ReplyIcon />
						{{ t('app.news.reply', 'Ответить') }}
					</button>
					<button
						v-if="node.canDelete"
						type="button"
						class="nf-comment__act is-danger"
						@click="emit('delete', node)"
					>
						<TrashIcon />
						{{ t('app.news.delete', 'Удалить') }}
					</button>
				</div>
			</div>
		</div>
		<div
			v-if="node.children.length"
			class="nf-comment__children"
			:class="{ 'is-flat': depth >= 3 }"
		>
			<NewsComment
				v-for="child in node.children"
				:key="child.id"
				:node="child"
				:depth="depth + 1"
				:can-reply="canReply"
				@reply="emit('reply', $event)"
				@delete="emit('delete', $event)"
				@profile="emit('profile', $event)"
				@tag="emit('tag', $event)"
				@mention="emit('mention', $event)"
			/>
		</div>
	</div>
</template>

<style scoped>
.nf-comment {
	display: flex;
	flex-direction: column;
	gap: 8px;
	animation: nf-comment-in 0.3s ease both;
}

.nf-comment__row {
	display: flex;
	gap: 10px;
}

.nf-comment__avatar {
	flex-shrink: 0;
	height: fit-content;
	padding: 0;
	border: 0;
	background: none;
	cursor: pointer;
}

.nf-comment__main {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	flex: 1;
}

.nf-comment__head {
	display: flex;
	align-items: baseline;
	gap: 6px;
	flex-wrap: wrap;
}

.nf-comment__name {
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-contrast, #fff);
	font: inherit;
	font-size: 13px;
	font-weight: 700;
	cursor: pointer;
}

.nf-comment__name:hover {
	color: var(--color-brand);
}

.nf-comment__to,
.nf-comment__time {
	color: rgba(255, 255, 255, 0.4);
	font-size: 12px;
}

.nf-comment__body {
	font-size: 13.5px;
}

.nf-comment__actions {
	display: flex;
	gap: 10px;
}

.nf-comment__act {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 0;
	border: 0;
	background: none;
	color: rgba(255, 255, 255, 0.45);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	transition: color 0.15s ease;
}

.nf-comment__act svg {
	width: 13px;
	height: 13px;
}

.nf-comment__act:hover {
	color: #fff;
}

.nf-comment__act.is-danger:hover {
	color: var(--color-red);
}

.nf-comment__children {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-left: 13px;
	padding-left: 14px;
	border-left: 2px solid rgba(255, 255, 255, 0.07);
}

.nf-comment__children.is-flat {
	margin-left: 0;
	padding-left: 0;
	border-left: 0;
}

@keyframes nf-comment-in {
	from {
		opacity: 0;
		transform: translateY(4px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@media (prefers-reduced-motion: reduce) {
	.nf-comment {
		animation: none;
	}
}
</style>
