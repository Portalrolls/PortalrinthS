<script setup lang="ts">
import { XIcon } from '@modrinth/assets'
import { defineMessages, useVIntl } from '@modrinth/ui'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { deleteDraft, type DraftKind, type SavedDraft } from '@/helpers/portalrinth-drafts'

/**
 * The floating "Draft" card: one click - the text returns to the field, the
 * cross deletes the draft, and silence makes it hide by itself. The hide
 * countdown (30 seconds) starts with the first move of the cursor: while the
 * cursor is still, the card waits as long as it takes.
 */
const props = defineProps<{
	kind: DraftKind
	/** Place id, the same one the draft was saved under. */
	id: string
	/** Name of the place, shown above the text. */
	label: string
	/** Called after the text has been put back into the field. */
	apply: (draft: SavedDraft) => void
}>()

const { formatMessage } = useVIntl()

const messages = defineMessages({
	title: { id: 'app.drafts.title', defaultMessage: 'Черновик' },
	restore: { id: 'app.drafts.restore', defaultMessage: 'Нажмите, чтобы вернуть текст' },
	remove: { id: 'app.drafts.remove', defaultMessage: 'Удалить черновик' },
})

const draft = ref<SavedDraft | null>(null)
const visible = ref(false)

const HIDE_DELAY = 30_000
let hideTimer: ReturnType<typeof setTimeout> | null = null
let countdownStarted = false

function onMove(): void {
	if (countdownStarted || !visible.value) return
	countdownStarted = true
	hideTimer = setTimeout(() => {
		hideTimer = null
		visible.value = false
	}, HIDE_DELAY)
}

function restore(): void {
	if (!draft.value) return
	props.apply(draft.value)
	deleteDraft(props.kind, props.id)
	draft.value = null
	visible.value = false
}

function discard(): void {
	deleteDraft(props.kind, props.id)
	draft.value = null
	visible.value = false
}

/** Убрать карточку, не трогая сохранённый текст. */
function hide(): void {
	draft.value = null
	visible.value = false
}

function show(saved: SavedDraft): void {
	draft.value = saved
	countdownStarted = false
	visible.value = true
	if (hideTimer) {
		clearTimeout(hideTimer)
		hideTimer = null
	}
}

onMounted(() => document.addEventListener('mousemove', onMove, { passive: true }))

onBeforeUnmount(() => {
	document.removeEventListener('mousemove', onMove)
	if (hideTimer) clearTimeout(hideTimer)
})

defineExpose({ show, hide })
</script>

<template>
	<Teleport to="body">
		<Transition name="draft-card">
			<div
				v-if="visible && draft"
				class="draft-card"
				role="status"
				:aria-label="formatMessage(messages.title)"
				@click="restore"
			>
				<div class="draft-card__head">
					<span class="draft-card__place">{{ label }}</span>
					<span class="draft-card__title">{{ formatMessage(messages.title) }}</span>
					<button
						type="button"
						class="draft-card__close"
						:aria-label="formatMessage(messages.remove)"
						:title="formatMessage(messages.remove)"
						@click.stop="discard"
					>
						<XIcon />
					</button>
				</div>
				<p class="draft-card__text">{{ draft.text }}</p>
				<span class="draft-card__hint">{{ formatMessage(messages.restore) }}</span>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.draft-card {
	position: fixed;
	right: 18px;
	bottom: 18px;
	z-index: 90;
	display: flex;
	width: min(340px, calc(100vw - 36px));
	flex-direction: column;
	gap: 6px;
	padding: 12px 14px;
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 14px;
	background: var(--color-raised-bg, #1c1c22);
	box-shadow: 0 14px 44px rgba(0, 0, 0, 0.45);
	cursor: pointer;
	transition:
		border-color 0.15s ease,
		transform 0.15s ease;
}

.draft-card:hover {
	border-color: var(--color-brand, #1bd96a);
	transform: translateY(-1px);
}

.draft-card__head {
	display: flex;
	align-items: center;
	gap: 8px;
}

.draft-card__place {
	overflow: hidden;
	color: var(--color-secondary, rgba(255, 255, 255, 0.55));
	font-size: 12px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.draft-card__title {
	flex-shrink: 0;
	margin-left: auto;
	color: var(--color-brand, #1bd96a);
	font-size: 12.5px;
	font-weight: 700;
}

.draft-card__close {
	display: grid;
	place-items: center;
	width: 24px;
	height: 24px;
	flex-shrink: 0;
	padding: 0;
	border: 0;
	border-radius: 7px;
	background: transparent;
	color: rgba(255, 255, 255, 0.55);
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.draft-card__close:hover {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}

.draft-card__close svg {
	width: 14px;
	height: 14px;
}

.draft-card__text {
	display: -webkit-box;
	margin: 0;
	overflow: hidden;
	color: var(--color-contrast, #fff);
	font-size: 13px;
	line-height: 1.4;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	word-break: break-word;
}

.draft-card__hint {
	color: var(--color-secondary, rgba(255, 255, 255, 0.45));
	font-size: 11.5px;
}

.draft-card-enter-active,
.draft-card-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.draft-card-enter-from,
.draft-card-leave-to {
	opacity: 0;
	transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
	.draft-card-enter-active,
	.draft-card-leave-active,
	.draft-card {
		transition: none;
	}
}
</style>
