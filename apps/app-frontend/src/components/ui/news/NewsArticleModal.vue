<script setup lang="ts">
import { CalendarIcon, ExternalIcon, EyeIcon, LinkIcon } from '@modrinth/assets'
import { Button, NewModal } from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, ref } from 'vue'

import {
	type FeedAttachment,
	resolveNewsAssetUrl,
	STUDIO_AVATAR,
	STUDIO_NAME,
	useNewsText,
} from './feed'
import { openLightbox } from './lightbox'
import NewsAvatar from './NewsAvatar.vue'
import NewsCarousel from './NewsCarousel.vue'
import NewsRichText from './NewsRichText.vue'
import {
	fetchOfficialNewsPost,
	noteOfficialNewsView,
	officialCover,
	officialDate,
	type OfficialNews,
	officialNewsUrl,
} from './official-news'

const emit = defineEmits<{
	viewed: [id: string, views: number]
	copied: []
}>()

const { t, longDate, locale } = useNewsText()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const article = ref<OfficialNews | null>(null)
const loadingFull = ref(false)
const viewed = new Set<string>()

const cover = computed(() => (article.value ? officialCover(article.value) : ''))
const body = computed(() => article.value?.content || article.value?.summary || '')
const media = computed<FeedAttachment[]>(() =>
	(article.value?.media ?? [])
		.filter((item) => item.url)
		.map((item) => ({ url: resolveNewsAssetUrl(item.url), type: item.type })),
)

async function show(item: OfficialNews) {
	article.value = { ...item }
	modal.value?.show()
	if (!viewed.has(item.id)) {
		viewed.add(item.id)
		void noteOfficialNewsView(item.id).then((views) => {
			if (views === null) {
				viewed.delete(item.id)
				return
			}
			if (article.value?.id === item.id) article.value.views = views
			emit('viewed', item.id, views)
		})
	}
	if (item.content) return
	loadingFull.value = true
	const full = await fetchOfficialNewsPost(item.id, locale.value).catch(() => null)
	loadingFull.value = false
	if (full && article.value?.id === item.id) {
		article.value = { ...full, views: article.value.views ?? full.views }
	}
}

async function copyLink() {
	if (!article.value) return
	await navigator.clipboard.writeText(officialNewsUrl(article.value.id)).catch(() => {})
	emit('copied')
}

defineExpose({ show })
</script>

<template>
	<NewModal
		ref="modal"
		:header="article?.title || t('app.news.article', 'Статья')"
		width="760px"
		max-width="calc(100vw - 48px)"
		scrollable
	>
		<article v-if="article" class="nf-art">
			<button
				v-if="cover"
				type="button"
				class="nf-art__cover"
				:aria-label="t('app.news.openImage', 'Открыть изображение')"
				@click="openLightbox([{ url: cover, video: false }])"
			>
				<img :src="cover" alt="" />
			</button>
			<div class="nf-art__meta">
				<NewsAvatar :source="{ direct: STUDIO_AVATAR }" :size="26" round />
				<b>{{ article.author || STUDIO_NAME }}</b>
				<span v-if="officialDate(article)" class="nf-art__chip">
					<CalendarIcon />
					{{ longDate(officialDate(article)) }}
				</span>
				<span class="nf-art__chip">
					<EyeIcon />
					{{ article.views || 0 }}
				</span>
			</div>
			<p v-if="article.summary && article.content" class="nf-art__lead">{{ article.summary }}</p>
			<div v-if="loadingFull && !article.content" class="nf-art__loading">
				<span v-for="n in 5" :key="n" class="nf-sk" :style="{ width: `${100 - n * 9}%` }" />
			</div>
			<NewsRichText
				v-else
				:text="body"
				article
				@image="(url) => openLightbox([{ url, video: false }])"
			/>
			<NewsCarousel v-if="media.length" :items="media" tall />
		</article>

		<template #actions>
			<div class="nf-art__actions">
				<Button type="quiet" @click="copyLink">
					<LinkIcon />
					{{ t('app.news.copyLink', 'Копировать ссылку') }}
				</Button>
				<Button
					v-if="article"
					type="colored"
					color="brand"
					@click="article && openUrl(officialNewsUrl(article.id))"
				>
					<ExternalIcon />
					{{ t('app.news.openOnSite', 'Открыть на сайте') }}
				</Button>
			</div>
		</template>
	</NewModal>
</template>

<style scoped>
.nf-art {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.nf-art__cover {
	display: block;
	overflow: hidden;
	padding: 0;
	border: 0;
	border-radius: 14px;
	background: var(--nf-inset);
	cursor: zoom-in;
}

.nf-art__cover img {
	display: block;
	width: 100%;
	max-height: 380px;
	object-fit: cover;
	transition: transform 0.4s ease;
}

.nf-art__cover:hover img {
	transform: scale(1.02);
}

.nf-art__meta {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	color: rgba(255, 255, 255, 0.55);
	font-size: 13px;
}

.nf-art__meta b {
	color: var(--color-contrast, #fff);
}

.nf-art__chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 2px 9px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.06);
}

.nf-art__chip svg {
	width: 13px;
	height: 13px;
}

.nf-art__lead {
	margin: 0;
	color: rgba(255, 255, 255, 0.75);
	font-size: 15px;
	font-weight: 500;
	line-height: 1.5;
}

.nf-art__loading {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.nf-sk {
	display: block;
	height: 11px;
	border-radius: 6px;
	background: linear-gradient(90deg, var(--nf-shimmer1) 0%, var(--nf-shimmer2) 50%, var(--nf-shimmer1) 100%);
	background-size: 200% 100%;
	animation: nf-shimmer 1.2s linear infinite;
}

.nf-art__actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}

@keyframes nf-shimmer {
	from {
		background-position: 200% 0;
	}
	to {
		background-position: -200% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.nf-sk {
		animation: none;
	}

	.nf-art__cover img {
		transition: none;
	}
}
</style>
