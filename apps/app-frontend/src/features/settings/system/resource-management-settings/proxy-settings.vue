<script setup lang="ts">
/**
 * Прокси для всего лаунчера: Modrinth, CDN, сервис Undefined (MC Messenger,
 * новости, аватарки). В РФ Cloudflare часто душат — запросы к Modrinth
 * висят на подключении, а большие ответы (скины, картинки) обрываются.
 * Через прокси всё это идёт как обычно.
 */
import { CheckIcon, GlobeIcon, SpinnerIcon, UpdatedIcon, XIcon } from '@modrinth/assets'
import { Button, defineMessages, Input, useVIntl } from '@modrinth/ui'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { computed, ref } from 'vue'

import { applyProxyUrl } from '@/helpers/proxy-fetch'
import { get, setProxySetting } from '@/helpers/settings.ts'
import { restartApp } from '@/helpers/utils.js'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	title: { id: 'app.resource-settings.proxy.title', defaultMessage: 'Proxy' },
	description: {
		id: 'app.resource-settings.proxy.description',
		defaultMessage:
			'Routes all launcher network traffic through a proxy. Leave empty to connect directly.',
	},
	check: { id: 'app.resource-settings.proxy.check', defaultMessage: 'Check' },
	save: { id: 'app.resource-settings.proxy.save', defaultMessage: 'Save' },
	clear: { id: 'app.resource-settings.proxy.clear', defaultMessage: 'Connect directly' },
	invalid: {
		id: 'app.resource-settings.proxy.invalid',
		defaultMessage: 'The address must start with http://, https://, socks5:// or socks5h://',
	},
	ok: { id: 'app.resource-settings.proxy.ok', defaultMessage: '{target}: {ms} ms' },
	failed: { id: 'app.resource-settings.proxy.failed', defaultMessage: '{target}: no answer' },
	restart: {
		id: 'app.resource-settings.proxy.restart',
		defaultMessage:
			'Messenger and news already use the new proxy. Modrinth and downloads pick it up after a restart.',
	},
	restartNow: { id: 'app.resource-settings.proxy.restartNow', defaultMessage: 'Restart' },
})

const PROXY_RE = /^(https?|socks5h?):\/\/[^\s/]+/i

const TARGETS = [
	{ name: 'Modrinth', url: 'https://api.modrinth.com/v2/tag/loader' },
	{ name: 'Undefined', url: 'https://uprojects.site/client/api/messenger/health' },
	{ name: 'mc-heads', url: 'https://mc-heads.net/avatar/MHF_Steve/8' },
]

const settings = await get()
const startedWith = (settings as { proxy_url?: string | null }).proxy_url?.trim() || ''
const saved = ref(startedWith)
const draft = ref(startedWith)
const checking = ref(false)
const results = ref<{ name: string; ok: boolean; ms: number }[]>([])

const valid = computed(() => !draft.value.trim() || PROXY_RE.test(draft.value.trim()))
const needsRestart = computed(() => saved.value !== startedWith)

async function probe(target: { name: string; url: string }, proxy: string) {
	const started = performance.now()
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 12000)
	try {
		const response = await tauriFetch(target.url, {
			method: 'GET',
			connectTimeout: 10000,
			signal: controller.signal,
			...(proxy ? { proxy: { all: proxy } } : {}),
		})
		// Любой ответ сервера значит, что до него дошли: даже 404 у health.
		await response.arrayBuffer().catch(() => null)
		return {
			name: target.name,
			ok: response.status > 0,
			ms: Math.round(performance.now() - started),
		}
	} catch {
		return { name: target.name, ok: false, ms: 0 }
	} finally {
		clearTimeout(timer)
	}
}

async function check() {
	if (!valid.value || checking.value) return
	checking.value = true
	results.value = []
	try {
		const proxy = draft.value.trim()
		results.value = await Promise.all(TARGETS.map((target) => probe(target, proxy)))
	} finally {
		checking.value = false
	}
}

async function save(value: string) {
	const next = value.trim()
	await setProxySetting(next || null)
	applyProxyUrl(next || null)
	saved.value = next
	draft.value = next
}
</script>

<template>
	<div class="flex flex-col gap-2.5">
		<h2 class="m-0 text-lg font-semibold text-contrast">
			{{ formatMessage(messages.title) }}
		</h2>
		<p class="m-0 leading-tight text-secondary">
			{{ formatMessage(messages.description) }}
		</p>
		<Input
			id="launcher-proxy"
			v-model="draft"
			:icon="GlobeIcon"
			type="text"
			autocomplete="off"
			spellcheck="false"
			placeholder="socks5h://127.0.0.1:1080"
			wrapper-class="w-full"
			@update:model-value="results = []"
		/>
		<p v-if="!valid" class="m-0 text-sm text-red">{{ formatMessage(messages.invalid) }}</p>
		<div class="flex flex-wrap items-center gap-2">
			<Button :disabled="checking || !valid" @click="check">
				<SpinnerIcon v-if="checking" class="animate-spin" aria-hidden="true" />
				<CheckIcon v-else aria-hidden="true" />
				{{ formatMessage(messages.check) }}
			</Button>
			<Button color="primary" :disabled="!valid || draft.trim() === saved" @click="save(draft)">
				{{ formatMessage(messages.save) }}
			</Button>
			<Button v-if="saved" @click="save('')">
				<XIcon aria-hidden="true" />
				{{ formatMessage(messages.clear) }}
			</Button>
		</div>
		<div v-if="results.length" class="flex flex-wrap gap-2">
			<span
				v-for="row in results"
				:key="row.name"
				class="rounded-full px-3 py-1 text-sm font-semibold"
				:class="row.ok ? 'bg-brand-highlight text-brand' : 'bg-red/15 text-red'"
			>
				{{
					row.ok
						? formatMessage(messages.ok, { target: row.name, ms: row.ms })
						: formatMessage(messages.failed, { target: row.name })
				}}
			</span>
		</div>
		<div
			v-if="needsRestart"
			class="flex flex-wrap items-center gap-3 rounded-2xl border border-solid border-surface-5 bg-surface-2 p-3"
		>
			<span class="min-w-0 flex-1 text-sm text-secondary">{{
				formatMessage(messages.restart)
			}}</span>
			<Button @click="restartApp">
				<UpdatedIcon aria-hidden="true" />
				{{ formatMessage(messages.restartNow) }}
			</Button>
		</div>
	</div>
</template>
