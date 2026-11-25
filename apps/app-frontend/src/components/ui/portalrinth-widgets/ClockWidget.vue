<template>
	<div
		v-tooltip="tooltip"
		class="flex cursor-default select-none items-center gap-1.5 rounded-xl border-none bg-transparent px-2 py-1 text-sm font-medium text-contrast"
	>
		<component :is="icon" class="portalrinth-accent-clock size-4 shrink-0" :class="iconClass" />
		<span class="tabular-nums">{{ timeLabel }}</span>
		<span v-if="pluginSafeMode" v-tooltip="safeModeTip" class="sm-badge" aria-label="Safe Mode">
			SM
		</span>
	</div>
</template>

<script setup lang="ts">
/**
 * The title-bar clock, standing at the top center the way a desktop
 * clock does. It shows the system timezone's own time - what the PC
 * shows - and picks its icon by the part of the day: a sunrise around
 * dawn, a sun through the day, a sunset in the evening, a moon at night.
 * While Safe Mode is on, a green SM badge stands right of the time: the
 * plugins' styles and the quick CSS are off until the hotkey brings
 * them back.
 */
import { MoonIcon, SunIcon, SunriseIcon, SunsetIcon } from '@modrinth/assets'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { pluginSafeMode } from '@/helpers/portalrinth-plugins'
import { systemTime, type TimeOfDay, timeOfDay } from '@/helpers/portalrinth-widgets'

const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
	timer = setInterval(() => {
		now.value = new Date()
	}, 10_000)
})

onBeforeUnmount(() => {
	if (timer) clearInterval(timer)
})

const part = computed<TimeOfDay>(() => timeOfDay(now.value))

const icon = computed(() => {
	if (part.value === 'sunrise') return SunriseIcon
	if (part.value === 'day') return SunIcon
	if (part.value === 'sunset') return SunsetIcon
	return MoonIcon
})

const iconClass = computed(() => (part.value === 'night' ? 'text-secondary' : 'text-orange'))

const timeLabel = computed(() => systemTime(now.value))

/** The colour is fixed green on purpose: it must not follow the accent. */
const safeModeTip = 'Safe Mode — стили плагинов и Быстрого CSS сняты. Ctrl+Shift+Alt+P — вернуть'

const tooltip = computed(() => {
	const full = now.value.toLocaleString([], {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		hour: '2-digit',
		minute: '2-digit',
	})
	const parts: Record<TimeOfDay, string> = {
		sunrise: 'Рассвет',
		day: 'День',
		sunset: 'Закат',
		night: 'Ночь',
	}
	return `${full} · ${parts[part.value]}`
})
</script>

<style scoped>
.sm-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.7rem;
	height: 1.15rem;
	padding: 0 0.3rem;
	border-radius: 999px;
	background: #23a55a;
	color: #ffffff;
	font-size: 0.62rem;
	font-weight: 800;
	letter-spacing: 0.06em;
	cursor: help;
}
</style>
