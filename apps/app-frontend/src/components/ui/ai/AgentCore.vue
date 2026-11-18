<script setup lang="ts">
import { computed, useId } from 'vue'

import { corePalette, type CoreStyle, coreStyle, paletteById } from './agent-look'

export type CoreMode = 'idle' | 'thinking' | 'speaking' | 'notify' | 'alert'

const props = withDefaults(
	defineProps<{
		size?: number
		mode?: CoreMode
		/** Для превью в выборе облика: свой стиль/палитра вместо общего. */
		variant?: CoreStyle
		palette?: string
		still?: boolean
	}>(),
	{ size: 96, mode: 'idle', variant: undefined, palette: undefined, still: false },
)

const uid = useId()
const look = computed(() => props.variant ?? coreStyle.value)
const colors = computed(() =>
	props.mode === 'alert'
		? { a: '#ef4444', b: '#fca5a5' }
		: paletteById(props.palette ?? corePalette.value),
)

/** Шесть граней призмы — вершины правильного шестиугольника. */
function hexagon(radius: number, turn = 0): string {
	return Array.from({ length: 6 }, (_, index) => {
		const angle = (Math.PI / 3) * index + turn
		return `${(60 + radius * Math.cos(angle)).toFixed(2)},${(60 + radius * Math.sin(angle)).toFixed(2)}`
	}).join(' ')
}

const outerHex = hexagon(48, Math.PI / 6)
const midHex = hexagon(36)
const innerHex = hexagon(21, Math.PI / 6)
</script>

<template>
	<span
		class="core"
		:class="[`core--${look}`, `core--${mode}`, { 'core--still': still }]"
		:style="{ width: `${size}px`, height: `${size}px`, '--core-a': colors.a, '--core-b': colors.b }"
		role="img"
		aria-hidden="true"
	>
		<svg viewBox="0 0 120 120" class="core__svg">
			<defs>
				<radialGradient :id="`${uid}-fill`" cx="38%" cy="34%" r="70%">
					<stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
					<stop offset="28%" style="stop-color: var(--core-b)" />
					<stop offset="100%" style="stop-color: var(--core-a)" />
				</radialGradient>
				<linearGradient :id="`${uid}-stroke`" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" style="stop-color: var(--core-b)" />
					<stop offset="100%" style="stop-color: var(--core-a)" />
				</linearGradient>
				<radialGradient :id="`${uid}-glow`" cx="50%" cy="50%" r="50%">
					<stop offset="0%" style="stop-color: var(--core-a)" stop-opacity="0.55" />
					<stop offset="100%" style="stop-color: var(--core-a)" stop-opacity="0" />
				</radialGradient>
			</defs>

			<circle class="core__glow" cx="60" cy="60" r="58" :fill="`url(#${uid}-glow)`" />

			<g v-if="mode === 'notify'" class="core__ripples">
				<circle cx="60" cy="60" r="30" :stroke="`url(#${uid}-stroke)`" />
				<circle cx="60" cy="60" r="30" :stroke="`url(#${uid}-stroke)`" />
			</g>

			<template v-if="look === 'orbit'">
				<circle class="core__track core__spin-slow" cx="60" cy="60" r="54" />
				<circle
					class="core__arc core__spin-a"
					cx="60"
					cy="60"
					r="46"
					:stroke="`url(#${uid}-stroke)`"
					stroke-dasharray="74 215"
				/>
				<circle
					class="core__arc core__arc--thin core__spin-b"
					cx="60"
					cy="60"
					r="37"
					:stroke="`url(#${uid}-stroke)`"
					stroke-dasharray="38 195"
				/>
				<g class="core__spin-a">
					<circle class="core__moon" cx="60" cy="14" r="3.2" />
				</g>
				<circle class="core__heart" cx="60" cy="60" r="22" :fill="`url(#${uid}-fill)`" />
			</template>

			<template v-else-if="look === 'prism'">
				<polygon class="core__facet core__spin-slow" :points="outerHex" />
				<polygon
					class="core__facet core__facet--lit core__spin-b"
					:points="midHex"
					:stroke="`url(#${uid}-stroke)`"
				/>
				<polygon class="core__heart" :points="innerHex" :fill="`url(#${uid}-fill)`" />
				<polygon class="core__shine" :points="innerHex" />
			</template>

			<template v-else>
				<g class="core__waves">
					<circle cx="60" cy="60" r="24" :stroke="`url(#${uid}-stroke)`" />
					<circle cx="60" cy="60" r="24" :stroke="`url(#${uid}-stroke)`" />
					<circle cx="60" cy="60" r="24" :stroke="`url(#${uid}-stroke)`" />
				</g>
				<circle class="core__heart" cx="60" cy="60" r="24" :fill="`url(#${uid}-fill)`" />
			</template>

			<g v-if="mode === 'speaking'" class="core__voice">
				<rect x="49" y="55" width="4" height="10" rx="2" />
				<rect x="58" y="51" width="4" height="18" rx="2" />
				<rect x="67" y="55" width="4" height="10" rx="2" />
			</g>
			<ellipse v-else class="core__gleam" cx="53" cy="51" rx="7" ry="4.5" />
		</svg>
	</span>
</template>

<style scoped>
.core {
	--spin-a: 9s;
	--spin-b: 13s;
	--spin-slow: 40s;
	--breath: 4.2s;
	position: relative;
	display: inline-block;
	flex-shrink: 0;
}

.core__svg {
	display: block;
	width: 100%;
	height: 100%;
	overflow: visible;
}

.core--thinking {
	--spin-a: 1.5s;
	--spin-b: 2.2s;
	--spin-slow: 9s;
	--breath: 1.6s;
}

.core--speaking {
	--spin-a: 3.2s;
	--spin-b: 5s;
	--breath: 0.9s;
}

.core--alert {
	animation: core-shake 0.5s ease 1;
}

.core__glow {
	transform-origin: 60px 60px;
	animation: core-breath var(--breath) ease-in-out infinite;
}

.core__track {
	fill: none;
	stroke: var(--core-b);
	stroke-opacity: 0.32;
	stroke-width: 1.2;
	stroke-dasharray: 1.5 6;
}

.core__arc {
	fill: none;
	stroke-width: 3.2;
	stroke-linecap: round;
}

.core__arc--thin {
	stroke-width: 2;
	opacity: 0.75;
}

.core__moon {
	fill: var(--core-b);
	filter: drop-shadow(0 0 3px var(--core-b));
}

.core__heart {
	transform-origin: 60px 60px;
	filter: drop-shadow(0 0 8px color-mix(in srgb, var(--core-a) 70%, transparent));
	animation: core-heart var(--breath) ease-in-out infinite;
}

.core__gleam {
	fill: #ffffff;
	opacity: 0.45;
	pointer-events: none;
}

.core__facet {
	fill: none;
	stroke: var(--core-b);
	stroke-opacity: 0.35;
	stroke-width: 1.2;
	stroke-linejoin: round;
}

.core__facet--lit {
	stroke-opacity: 1;
	stroke-width: 2.6;
}

.core__shine {
	fill: none;
	stroke: #ffffff;
	stroke-opacity: 0.35;
	stroke-width: 1;
	transform-origin: 60px 60px;
	animation: core-heart var(--breath) ease-in-out infinite;
}

.core__spin-a,
.core__spin-b,
.core__spin-slow {
	transform-origin: 60px 60px;
}

.core__spin-a {
	animation: core-spin var(--spin-a) linear infinite;
}

.core__spin-b {
	animation: core-spin var(--spin-b) linear infinite reverse;
}

.core__spin-slow {
	animation: core-spin var(--spin-slow) linear infinite;
}

.core__waves circle,
.core__ripples circle {
	fill: none;
	stroke-width: 1.6;
	transform-origin: 60px 60px;
	animation: core-wave calc(var(--breath) * 0.8) ease-out infinite;
}

.core__waves circle:nth-child(2) {
	animation-delay: calc(var(--breath) * -0.27);
}

.core__waves circle:nth-child(3) {
	animation-delay: calc(var(--breath) * -0.54);
}

.core__ripples circle {
	stroke-width: 2.2;
	animation-duration: 1.6s;
}

.core__ripples circle:nth-child(2) {
	animation-delay: -0.8s;
}

.core__voice rect {
	fill: #ffffff;
	opacity: 0.9;
	transform-box: fill-box;
	transform-origin: center;
	animation: core-voice 0.7s ease-in-out infinite;
}

.core__voice rect:nth-child(2) {
	animation-delay: -0.23s;
}

.core__voice rect:nth-child(3) {
	animation-delay: -0.46s;
}

.core--still *,
.core--still {
	animation: none !important;
}

@keyframes core-spin {
	to {
		transform: rotate(360deg);
	}
}

@keyframes core-breath {
	0%,
	100% {
		opacity: 0.55;
		transform: scale(0.94);
	}
	50% {
		opacity: 1;
		transform: scale(1.04);
	}
}

@keyframes core-heart {
	0%,
	100% {
		transform: scale(1);
	}
	50% {
		transform: scale(1.06);
	}
}

@keyframes core-wave {
	from {
		opacity: 0.8;
		transform: scale(1);
	}
	to {
		opacity: 0;
		transform: scale(2.3);
	}
}

@keyframes core-voice {
	0%,
	100% {
		transform: scaleY(0.55);
	}
	50% {
		transform: scaleY(1.15);
	}
}

@keyframes core-shake {
	20%,
	60% {
		transform: translateX(-3px);
	}
	40%,
	80% {
		transform: translateX(3px);
	}
}

@media (prefers-reduced-motion: reduce) {
	.core,
	.core * {
		animation-duration: 0s !important;
		animation-iteration-count: 1 !important;
	}
}
</style>
