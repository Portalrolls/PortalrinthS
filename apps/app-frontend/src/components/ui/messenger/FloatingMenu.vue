<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import type { Anchor } from './ui-bus'

const props = withDefaults(
	defineProps<{
		anchor: Anchor | null
		placement?:
			| 'bottom-start'
			| 'bottom-end'
			| 'top-start'
			| 'top-end'
			| 'right-start'
			| 'left-start'
		gap?: number
		width?: number
	}>(),
	{ placement: 'bottom-start', gap: 6, width: 0 },
)

const emit = defineEmits<{ close: [] }>()

const el = ref<HTMLElement | null>(null)
const pos = ref({ left: -9999, top: -9999 })
const ready = ref(false)

function place(): void {
	const anchor = props.anchor
	const box = el.value
	if (!anchor || !box) return
	const rect = box.getBoundingClientRect()
	const w = anchor.w ?? 0
	const h = anchor.h ?? 0
	const margin = 8
	let left = anchor.x
	let top = anchor.y + h + props.gap
	switch (props.placement) {
		case 'bottom-end':
			left = anchor.x + w - rect.width
			break
		case 'top-start':
			top = anchor.y - rect.height - props.gap
			break
		case 'top-end':
			left = anchor.x + w - rect.width
			top = anchor.y - rect.height - props.gap
			break
		case 'right-start':
			left = anchor.x + w + props.gap
			top = anchor.y
			break
		case 'left-start':
			left = anchor.x - rect.width - props.gap
			top = anchor.y
			break
	}
	if (top + rect.height > window.innerHeight - margin) {
		const above = anchor.y - rect.height - props.gap
		top = above >= margin ? above : window.innerHeight - margin - rect.height
	}
	if (top < margin) top = margin
	if (left + rect.width > window.innerWidth - margin) {
		left =
			props.placement === 'right-start'
				? anchor.x - rect.width - props.gap
				: window.innerWidth - margin - rect.width
	}
	if (left < margin) left = margin
	pos.value = { left: Math.round(left), top: Math.round(top) }
	ready.value = true
}

function onPointer(event: PointerEvent): void {
	if (el.value && event.target instanceof Node && el.value.contains(event.target)) return
	emit('close')
}

function onKey(event: KeyboardEvent): void {
	if (event.key === 'Escape') {
		event.stopPropagation()
		emit('close')
	}
}

function onScroll(event: Event): void {
	if (el.value && event.target instanceof Node && el.value.contains(event.target)) return
	emit('close')
}

function bind(): void {
	window.addEventListener('pointerdown', onPointer, true)
	window.addEventListener('keydown', onKey, true)
	window.addEventListener('scroll', onScroll, true)
	window.addEventListener('resize', place)
}

function unbind(): void {
	window.removeEventListener('pointerdown', onPointer, true)
	window.removeEventListener('keydown', onKey, true)
	window.removeEventListener('scroll', onScroll, true)
	window.removeEventListener('resize', place)
}

watch(
	() => props.anchor,
	async (anchor) => {
		unbind()
		ready.value = false
		if (!anchor) return
		await nextTick()
		place()
		setTimeout(bind, 0)
	},
	{ immediate: true },
)

onBeforeUnmount(unbind)

defineExpose({ place })
</script>

<template>
	<Teleport to="body">
		<Transition name="msgr-float">
			<div
				v-if="anchor"
				ref="el"
				class="msgr-float"
				:class="{ 'is-ready': ready }"
				:style="{
					left: `${pos.left}px`,
					top: `${pos.top}px`,
					width: width ? `${width}px` : undefined,
				}"
				@contextmenu.prevent
			>
				<slot />
			</div>
		</Transition>
	</Teleport>
</template>

<style>
.msgr-float {
	position: fixed;
	z-index: 400;
	min-width: 12rem;
	max-height: calc(100vh - 16px);
	overflow-y: auto;
	padding: 0.4rem;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 10px;
	background: #111214;
	box-shadow:
		0 12px 36px rgba(0, 0, 0, 0.55),
		0 0 0 1px rgba(0, 0, 0, 0.3);
	color: var(--color-base);
	visibility: hidden;
}

.msgr-float.is-ready {
	visibility: visible;
}

.msgr-float-enter-active {
	transition:
		opacity 0.14s ease,
		transform 0.14s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.msgr-float-leave-active {
	transition: opacity 0.1s ease;
}

.msgr-float-enter-from {
	opacity: 0;
	transform: scale(0.96) translateY(-4px);
}

.msgr-float-leave-to {
	opacity: 0;
}

.msgr-menu-item {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 0.6rem;
	padding: 0.45rem 0.6rem;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--color-base);
	font: inherit;
	font-size: 0.875rem;
	font-weight: 500;
	text-align: left;
	cursor: pointer;
	transition:
		background 0.12s ease,
		color 0.12s ease;
}

.msgr-menu-item svg {
	width: 1.05rem;
	height: 1.05rem;
	flex-shrink: 0;
	opacity: 0.85;
}

.msgr-menu-item:hover,
.msgr-menu-item:focus-visible {
	outline: none;
	background: var(--color-brand);
	color: white;
}

.msgr-menu-item.is-danger {
	color: #f87171;
}

.msgr-menu-item.is-danger:hover {
	background: #da373c;
	color: white;
}

.msgr-menu-item__hint {
	margin-left: auto;
	font-size: 0.75rem;
	opacity: 0.6;
}

.msgr-menu-sep {
	height: 1px;
	margin: 0.3rem 0.4rem;
	background: rgba(255, 255, 255, 0.07);
}

.msgr-menu-reactions {
	display: flex;
	gap: 0.25rem;
	padding: 0.2rem 0.2rem 0.35rem;
}

.msgr-menu-reactions button {
	flex: 1;
	padding: 0.35rem 0;
	border: 0;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.05);
	font-size: 1.15rem;
	cursor: pointer;
	transition:
		background 0.12s ease,
		transform 0.12s ease;
}

.msgr-menu-reactions button:hover {
	background: rgba(255, 255, 255, 0.12);
	transform: scale(1.12);
}

@media (prefers-reduced-motion: reduce) {
	.msgr-float-enter-active,
	.msgr-float-leave-active,
	.msgr-menu-item,
	.msgr-menu-reactions button {
		transition: none;
	}
}
</style>
