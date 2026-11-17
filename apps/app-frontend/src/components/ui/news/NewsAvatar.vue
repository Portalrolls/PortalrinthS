<script setup lang="ts">
import { ref, watch } from 'vue'

import { resolveAvatar } from '@/helpers/uprojects-service'

import type { AvatarSource } from './feed'

const props = withDefaults(
	defineProps<{
		source: AvatarSource
		size?: number
		round?: boolean
	}>(),
	{ size: 32, round: false },
)

const url = ref('')
const loaded = ref(false)

watch(
	() => [props.source.direct, props.source.skinUrl, props.source.uuid, props.source.username],
	async () => {
		loaded.value = false
		const source = props.source
		if (source.direct) {
			url.value = source.direct
			return
		}
		url.value = ''
		if (!source.skinUrl && !source.uuid && !source.username && !source.avatar) return
		const resolved = await resolveAvatar({
			skinUrl: source.skinUrl,
			avatar: source.avatar,
			uuid: source.uuid ?? undefined,
			username: source.username ?? undefined,
		})
		if (source === props.source) url.value = resolved
	},
	{ immediate: true },
)
</script>

<template>
	<span
		class="nf-ava"
		:class="{ 'is-round': round, 'is-loaded': loaded, 'is-direct': Boolean(source.direct) }"
		:style="{ width: `${size}px`, height: `${size}px` }"
	>
		<img v-if="url" :src="url" alt="" draggable="false" @load="loaded = true" @error="url = ''" />
	</span>
</template>

<style scoped>
.nf-ava {
	position: relative;
	display: inline-block;
	flex-shrink: 0;
	overflow: hidden;
	border-radius: 4px;
	background: linear-gradient(90deg, #2c2c30 0%, #38383d 50%, #2c2c30 100%);
	background-size: 200% 100%;
	animation: nf-ava-shimmer 1.4s ease-in-out infinite;
}

.nf-ava.is-loaded {
	animation: none;
	background: #2a2a2e;
}

.nf-ava.is-round {
	border-radius: 50%;
}

.nf-ava img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	image-rendering: pixelated;
	opacity: 0;
	transition: opacity 0.2s ease;
}

.nf-ava.is-direct img {
	image-rendering: auto;
}

.nf-ava.is-loaded img {
	opacity: 1;
}

@keyframes nf-ava-shimmer {
	from {
		background-position: 100% 0;
	}
	to {
		background-position: -100% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.nf-ava {
		animation: none;
	}

	.nf-ava img {
		transition: none;
	}
}
</style>
