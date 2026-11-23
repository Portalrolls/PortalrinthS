<script setup lang="ts">
import { Button, commonMessages, useVIntl } from '@modrinth/ui'

import { pluginModal, resolvePluginModal } from '@/helpers/portalrinth-plugins'

const { formatMessage } = useVIntl()
</script>

<template>
	<Teleport to="body">
		<div v-if="pluginModal" class="plugin-modal-overlay" @click.self="resolvePluginModal(null)">
			<div class="plugin-modal bg-raised">
				<div class="flex flex-col gap-1">
					<h3 class="m-0 text-lg font-bold text-primary">{{ pluginModal.title }}</h3>
					<p class="m-0 text-xs text-secondary">{{ pluginModal.pluginName }}</p>
				</div>
				<p v-if="pluginModal.description" class="m-0 text-sm text-secondary">
					{{ pluginModal.description }}
				</p>
				<template v-for="(block, index) in pluginModal.blocks ?? []" :key="index">
					<p v-if="block.type === 'text'" class="m-0 text-sm text-primary">{{ block.text }}</p>
					<pre
						v-else-if="block.type === 'code'"
						class="m-0 overflow-x-auto rounded-lg bg-surface-2 p-2 font-mono text-xs text-primary"
						>{{ block.text }}</pre
					>
					<div v-else-if="block.type === 'progress'" class="flex flex-col gap-1">
						<p class="m-0 text-xs text-secondary">{{ block.label }}</p>
						<div class="plugin-modal-progress">
							<div
								class="plugin-modal-progress-fill"
								:style="{
									width: `${Math.min(100, Math.max(0, ((block.value ?? 0) / (block.max || 100)) * 100))}%`,
								}"
							/>
						</div>
					</div>
					<ul
						v-else-if="block.type === 'list'"
						class="m-0 flex flex-col gap-1 pl-0 text-sm text-primary"
					>
						<li
							v-for="(item, itemIndex) in block.items ?? []"
							:key="itemIndex"
							class="list-none rounded-lg bg-surface-2 px-2 py-1"
						>
							<p class="m-0">{{ item.title }}</p>
							<p v-if="item.subtitle" class="m-0 text-xs text-secondary">{{ item.subtitle }}</p>
						</li>
					</ul>
				</template>
				<div class="flex flex-wrap justify-end gap-2">
					<Button size="sm" type="outlined" @click="resolvePluginModal(null)">
						{{ formatMessage(commonMessages.cancelButton) }}
					</Button>
					<Button
						v-for="action in pluginModal.actions ?? []"
						:key="action.id"
						size="sm"
						type="colored"
						:color="action.color === 'red' ? 'red' : 'brand'"
						@click="resolvePluginModal(action.id)"
					>
						{{ action.label }}
					</Button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped lang="scss">
.plugin-modal-overlay {
	position: fixed;
	inset: 0;
	z-index: 60;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.45);
	padding: 1rem;
}

.plugin-modal {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	width: min(30rem, 100%);
	max-height: 80vh;
	overflow-y: auto;
	border-radius: 1rem;
	padding: 1.25rem;
	box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.plugin-modal-progress {
	height: 0.5rem;
	border-radius: 999px;
	background: var(--color-bg);
	overflow: hidden;
}

.plugin-modal-progress-fill {
	height: 100%;
	border-radius: 999px;
	background: var(--color-brand);
}
</style>
