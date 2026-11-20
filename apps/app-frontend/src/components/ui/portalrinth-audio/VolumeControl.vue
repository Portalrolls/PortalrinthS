<template>
	<div class="flex items-center gap-1.5">
		<button
			v-tooltip="label"
			class="grid size-8 shrink-0 place-items-center rounded-full border-0 bg-transparent text-secondary transition-colors hover:bg-surface-4 hover:text-contrast"
			:aria-label="label"
			@click="toggleMute"
		>
			<VolumeXIcon v-if="model === 0" class="size-5" />
			<Volume1Icon v-else-if="model < 50" class="size-5" />
			<Volume2Icon v-else class="size-5" />
		</button>
		<input
			v-model.number="model"
			class="portalrinth-range min-w-0 flex-1"
			type="range"
			min="0"
			max="100"
			step="1"
			:style="{ '--p': String(Math.min(100, Math.max(0, model)) / 100) }"
			:aria-label="label"
		/>
	</div>
</template>

<script setup lang="ts">
import { Volume1Icon, Volume2Icon, VolumeXIcon } from '@modrinth/assets'

defineProps<{ label: string }>()
const model = defineModel<number>({ required: true })

/** The volume before muting, so unmuting puts it back. */
let beforeMute = 60
function toggleMute() {
	if (model.value > 0) {
		beforeMute = model.value
		model.value = 0
	} else model.value = beforeMute || 60
}
</script>

<style>
/* A thin bar in the accent, filled up to where it is; shared by every audio
   control (volume and seek). The thumb is a vertical stick as tall as the
   input itself, so it cannot drift off the line vertically, and the fill is
   lengthened by half the stick's width so the bar ends exactly under the
   stick's centre - it never rides ahead of or behind it.

   The accent layer must always be an image: when the theme has no accent
   gradient the fallback wraps the solid colour in a gradient, because a bare
   colour with `center / 100% 0.375rem` sizing invalidates the whole
   declaration and the line disappears entirely. */
.portalrinth-range {
	--p: 0;
	--thumb-w: 0.25rem;
	--progress: calc(var(--thumb-w) / 2 + (100% - var(--thumb-w)) * var(--p));
	appearance: none;
	height: 1.1rem;
	margin: 0;
	border-radius: 999px;
	background-image:
		linear-gradient(
			to right,
			transparent var(--progress),
			var(--surface-5, rgb(255 255 255 / 25%)) var(--progress)
		),
		var(--portalrinth-accent-gradient, linear-gradient(var(--color-brand), var(--color-brand)));
	background-size:
		100% 0.375rem,
		100% 0.375rem;
	background-position: center;
	background-repeat: no-repeat;
	cursor: pointer;
	outline: none;
}

.portalrinth-range:disabled {
	cursor: default;
	opacity: 0.5;
}

.portalrinth-range::-webkit-slider-thumb {
	appearance: none;
	width: var(--thumb-w);
	height: 1.1rem;
	border-radius: 999px;
	background: var(--portalrinth-accent-gradient, var(--color-brand));
	box-shadow:
		0 0 0 1px rgb(0 0 0 / 25%),
		0 1px 4px rgb(0 0 0 / 40%);
	transition: transform 0.12s ease;
}

.portalrinth-range:hover::-webkit-slider-thumb,
.portalrinth-range:focus-visible::-webkit-slider-thumb,
.portalrinth-range:active::-webkit-slider-thumb {
	transform: scale(1.15);
}

.portalrinth-range::-moz-range-thumb {
	width: var(--thumb-w);
	height: 1.1rem;
	border: 0;
	border-radius: 999px;
	background: var(--portalrinth-accent-gradient, var(--color-brand));
}

.portalrinth-range::-moz-range-track {
	height: 0.375rem;
	border-radius: 999px;
	background-image:
		linear-gradient(
			to right,
			transparent var(--progress),
			var(--surface-5, rgb(255 255 255 / 25%)) var(--progress)
		),
		var(--portalrinth-accent-gradient, linear-gradient(var(--color-brand), var(--color-brand)));
	background-size: 100% 0.375rem;
	background-position: center;
	background-repeat: no-repeat;
}
</style>
