<script setup lang="ts">
import { computed, watchEffect } from 'vue'

import { ensureAvatar, presenceFor, state } from './store'

const props = withDefaults(
	defineProps<{
		userId: string
		name?: string
		size?: number
		status?: boolean
		ring?: string
	}>(),
	{ name: '', size: 40, status: false, ring: 'var(--msgr-panel)' },
)

watchEffect(() => {
	const user = state.users[props.userId]
	if (user) void ensureAvatar(user)
})

const src = computed(() => state.avatars[props.userId] || '')
const letter = computed(() =>
	(props.name || state.users[props.userId]?.username || '?').slice(0, 1),
)
const presence = computed(() => presenceFor(props.userId))
</script>

<template>
	<span class="msgr-avatar" :style="{ width: `${size}px`, height: `${size}px` }">
		<img v-if="src" :src="src" alt="" draggable="false" />
		<span v-else class="msgr-avatar__letter" :style="{ fontSize: `${Math.round(size * 0.42)}px` }">
			{{ letter }}
		</span>
		<span
			v-if="status"
			class="msgr-avatar__dot"
			:class="`is-${presence}`"
			:style="{ boxShadow: `0 0 0 3px ${ring}` }"
		/>
	</span>
</template>

<style scoped>
.msgr-avatar {
	position: relative;
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	background: color-mix(in srgb, var(--color-brand) 30%, var(--color-raised-bg));
}

.msgr-avatar img {
	width: 100%;
	height: 100%;
	border-radius: 50%;
	object-fit: cover;
	image-rendering: pixelated;
}

.msgr-avatar__letter {
	font-weight: 800;
	text-transform: uppercase;
	color: var(--color-contrast);
}

.msgr-avatar__dot {
	position: absolute;
	right: -1px;
	bottom: -1px;
	width: 32%;
	height: 32%;
	min-width: 9px;
	min-height: 9px;
	border-radius: 50%;
	background: #80848e;
}

.msgr-avatar__dot.is-online {
	background: #23a55a;
}

.msgr-avatar__dot.is-busy {
	background: #f0b232;
}

.msgr-avatar__dot.is-dnd {
	background: #f23f43;
}
</style>
