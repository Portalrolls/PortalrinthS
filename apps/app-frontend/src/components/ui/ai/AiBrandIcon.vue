<script setup lang="ts">
import { ServerIcon } from '@modrinth/assets'
import { computed } from 'vue'

import { modelBrand, providerBrand } from '@/helpers/ai-brands'

const props = withDefaults(
	defineProps<{ provider: string; model?: string; label?: string; size?: 'sm' | 'md' }>(),
	{ model: '', label: '', size: 'sm' },
)

const brand = computed(() =>
	props.model
		? modelBrand(props.provider, props.model, props.label)
		: providerBrand(props.provider),
)
</script>

<template>
	<span
		class="brand"
		:class="`brand--${size}`"
		:style="{ '--brand': brand.color }"
		aria-hidden="true"
	>
		<svg v-if="brand.key === 'pixi'" viewBox="0 0 16 16" class="brand-glyph brand-pixi">
			<rect width="11" height="11" rx="1.5" />
			<rect x="11" y="11" width="5" height="5" rx="1" />
		</svg>
		<ServerIcon v-else-if="brand.key === 'custom'" class="brand-glyph" />
		<span v-else class="brand-mark" :class="{ 'brand-mark--wide': brand.mark.length > 1 }">
			{{ brand.mark }}
		</span>
	</span>
</template>

<style scoped>
.brand {
	display: inline-grid;
	place-items: center;
	flex-shrink: 0;
	border-radius: 0.45rem;
	background: color-mix(in srgb, var(--brand) 20%, transparent);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 38%, transparent);
	color: var(--brand);
	font-weight: 800;
	line-height: 1;
}

.brand--sm {
	width: 1.35rem;
	height: 1.35rem;
	font-size: 0.68rem;
}

.brand--md {
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 0.55rem;
	font-size: 0.82rem;
}

.brand-glyph {
	width: 58%;
	height: 58%;
}

.brand-pixi {
	fill: currentColor;
}

.brand-mark--wide {
	font-size: 0.82em;
	letter-spacing: -0.03em;
}
</style>
