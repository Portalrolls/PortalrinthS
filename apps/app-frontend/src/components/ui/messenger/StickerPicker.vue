<script setup lang="ts">
import {
	ArrowLeftIcon,
	PlusIcon,
	SearchIcon,
	StickyNotePlusIcon,
	TrashIcon,
	XIcon,
} from '@modrinth/assets'
import { computed, onMounted, ref } from 'vue'

import EmojiPicker from './EmojiPicker.vue'
import { useMessengerT } from './i18n'
import {
	addOwnSticker,
	groupMine,
	loadPacks,
	loadStickers,
	type OwnSticker,
	removeOwnSticker,
	setPackOwned,
	stickers,
} from './stickers'
import StickerView from './StickerView.vue'
import { showToast } from './store'

const props = withDefaults(defineProps<{ tab?: 'emoji' | 'stickers' }>(), { tab: 'stickers' })

const emit = defineEmits<{
	emoji: [emoji: string]
	sticker: [id: number]
	own: [sticker: OwnSticker]
}>()

const t = useMessengerT()

const tab = ref(props.tab)
const view = ref<'list' | 'catalog'>('list')
const query = ref('')
const catalogQuery = ref('')
const catalogBusy = ref('')
const catalogLoading = ref(false)
const stage = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const activeSection = ref('own')

const groups = computed(() => groupMine(stickers.mine))

const shownGroups = computed(() => {
	const q = query.value.trim().toLowerCase()
	if (!q) return groups.value
	return groups.value
		.map((group) => ({
			...group,
			items: group.items.filter(
				(item) => item.emoji.includes(q) || group.name.toLowerCase().includes(q),
			),
		}))
		.filter((group) => group.items.length)
})

const shownOwn = computed(() => {
	const q = query.value.trim().toLowerCase()
	return q ? stickers.own.filter((item) => item.name.toLowerCase().includes(q)) : stickers.own
})

const shownPacks = computed(() => {
	const q = catalogQuery.value.trim().toLowerCase()
	return q ? stickers.packs.filter((pack) => pack.name.toLowerCase().includes(q)) : stickers.packs
})

function stickerWord(count: number): string {
	const n10 = count % 10
	const n100 = count % 100
	if (n10 === 1 && n100 !== 11) return t('app.messenger.stickers.one', '{n} стикер', { n: count })
	if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) {
		return t('app.messenger.stickers.few', '{n} стикера', { n: count })
	}
	return t('app.messenger.stickers.many', '{n} стикеров', { n: count })
}

function scrollTo(key: string): void {
	activeSection.value = key
	stage.value
		?.querySelector(`[data-section="${CSS.escape(key)}"]`)
		?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onStageScroll(): void {
	const root = stage.value
	if (!root) return
	const top = root.getBoundingClientRect().top + 8
	let current = 'own'
	root.querySelectorAll<HTMLElement>('[data-section]').forEach((section) => {
		if (section.getBoundingClientRect().top <= top) current = section.dataset.section || current
	})
	activeSection.value = current
}

async function openCatalog(): Promise<void> {
	view.value = 'catalog'
	catalogLoading.value = true
	const ok = await loadPacks()
	catalogLoading.value = false
	if (!ok) showToast(t('app.messenger.stickers.catalogFailed', 'Не удалось открыть каталог'))
}

async function togglePack(pack: string, add: boolean): Promise<void> {
	if (catalogBusy.value) return
	catalogBusy.value = pack
	const ok = await setPackOwned(pack, add)
	catalogBusy.value = ''
	if (!ok) showToast(t('app.messenger.stickers.packFailed', 'Не удалось изменить набор'))
}

function pickFiles(): void {
	fileInput.value?.click()
}

async function onFiles(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement
	const files = [...(input.files ?? [])]
	input.value = ''
	for (const file of files) {
		if (!file.type.startsWith('image/')) continue
		const result = await addOwnSticker(file, file.name)
		if (result === 'ok') continue
		showToast(
			result === 'full'
				? t('app.messenger.stickers.full', 'Своих стикеров уже 60 — удалите лишние')
				: result === 'storage'
					? t('app.messenger.stickers.storage', 'Не хватает места для стикера')
					: t('app.messenger.stickers.bad', 'Эту картинку не получилось превратить в стикер'),
		)
		break
	}
}

onMounted(() => {
	void loadStickers()
	if (!stickers.packs.length) void loadPacks()
})
</script>

<template>
	<div class="msgr-stk">
		<div class="msgr-stk__tabs">
			<button type="button" :class="{ 'is-on': tab === 'emoji' }" @click="tab = 'emoji'">
				{{ t('app.messenger.stickers.tabEmoji', 'Эмодзи') }}
			</button>
			<button type="button" :class="{ 'is-on': tab === 'stickers' }" @click="tab = 'stickers'">
				{{ t('app.messenger.stickers.tabStickers', 'Стикеры') }}
			</button>
		</div>

		<EmojiPicker v-if="tab === 'emoji'" class="msgr-stk__emoji" @pick="emit('emoji', $event)" />

		<template v-else-if="view === 'list'">
			<label class="msgr-stk__search">
				<SearchIcon />
				<input
					v-model="query"
					type="search"
					:placeholder="t('app.messenger.stickers.search', 'Поиск')"
					autocomplete="off"
				/>
			</label>
			<div ref="stage" class="msgr-stk__stage" @scroll.passive="onStageScroll">
				<section data-section="own">
					<header class="msgr-stk__head">
						<span>{{ t('app.messenger.stickers.own', 'Мои стикеры') }}</span>
					</header>
					<div class="msgr-stk__grid">
						<button
							v-if="!query"
							type="button"
							class="msgr-stk__add"
							:title="t('app.messenger.stickers.create', 'Создать стикер из картинки')"
							@click="pickFiles"
						>
							<StickyNotePlusIcon />
						</button>
						<div v-for="item in shownOwn" :key="item.id" class="msgr-stk__cell">
							<button type="button" :title="item.name" @click="emit('own', item)">
								<img :src="item.dataUrl" alt="" draggable="false" />
							</button>
							<button
								type="button"
								class="msgr-stk__remove"
								:title="t('app.messenger.stickers.remove', 'Удалить стикер')"
								@click.stop="removeOwnSticker(item.id)"
							>
								<TrashIcon />
							</button>
						</div>
					</div>
				</section>
				<section v-for="group in shownGroups" :key="group.key" :data-section="group.key">
					<header class="msgr-stk__head">
						<span>{{ group.name || t('app.messenger.stickers.noPack', 'Без набора') }}</span>
						<button
							type="button"
							class="msgr-stk__x"
							:title="t('app.messenger.stickers.removePack', 'Убрать набор')"
							:disabled="Boolean(catalogBusy)"
							@click="togglePack(group.key, false)"
						>
							<XIcon />
						</button>
					</header>
					<div class="msgr-stk__grid">
						<button
							v-for="item in group.items"
							:key="item.id"
							type="button"
							class="msgr-stk__cell"
							:title="item.emoji"
							@click="emit('sticker', item.id)"
						>
							<StickerView :url="item.url" :kind="item.kind" :size="64" />
						</button>
					</div>
				</section>
				<div v-if="stickers.loading && !stickers.mine.length" class="msgr-stk__empty">
					<span class="msgr-spinner" />
				</div>
				<div v-else-if="!stickers.mine.length && !query" class="msgr-stk__empty">
					<p>
						{{
							t('app.messenger.stickers.emptyServer', 'Наборы стикеров можно добавить из каталога')
						}}
					</p>
					<button type="button" class="msgr-stk__primary" @click="openCatalog">
						{{ t('app.messenger.stickers.toCatalog', 'Перейти в каталог') }}
					</button>
				</div>
			</div>
			<nav class="msgr-stk__rail">
				<button
					type="button"
					:class="{ 'is-on': activeSection === 'own' }"
					:title="t('app.messenger.stickers.own', 'Мои стикеры')"
					@click="scrollTo('own')"
				>
					<img v-if="stickers.own[0]" :src="stickers.own[0].dataUrl" alt="" />
					<StickyNotePlusIcon v-else />
				</button>
				<button
					v-for="group in groups"
					:key="group.key"
					type="button"
					:class="{ 'is-on': activeSection === group.key }"
					:title="group.name"
					@click="scrollTo(group.key)"
				>
					<StickerView
						v-if="group.items[0]"
						:url="group.items[0].url"
						:kind="group.items[0].kind"
						:size="26"
					/>
				</button>
				<button
					type="button"
					class="msgr-stk__plus"
					:title="t('app.messenger.stickers.catalog', 'Каталог')"
					@click="openCatalog"
				>
					<PlusIcon />
				</button>
			</nav>
		</template>

		<template v-else>
			<div class="msgr-stk__catalog-head">
				<button
					type="button"
					class="msgr-stk__back"
					:aria-label="t('app.messenger.back', 'Назад')"
					@click="view = 'list'"
				>
					<ArrowLeftIcon />
				</button>
				<b>{{ t('app.messenger.stickers.catalog', 'Каталог') }}</b>
			</div>
			<label class="msgr-stk__search">
				<SearchIcon />
				<input
					v-model="catalogQuery"
					type="search"
					:placeholder="t('app.messenger.stickers.searchPacks', 'Поиск наборов')"
					autocomplete="off"
				/>
			</label>
			<div class="msgr-stk__stage">
				<div v-if="catalogLoading && !stickers.packs.length" class="msgr-stk__empty">
					<span class="msgr-spinner" />
				</div>
				<div v-else-if="!shownPacks.length" class="msgr-stk__empty">
					<p>
						{{
							stickers.packs.length
								? t('app.messenger.stickers.nothing', 'Ничего не найдено')
								: t('app.messenger.stickers.noPacks', 'На сервере пока нет наборов')
						}}
					</p>
				</div>
				<div v-for="pack in shownPacks" :key="pack.pack" class="msgr-stk__pack">
					<span class="msgr-stk__cover">
						<StickerView
							v-if="pack.cover"
							:url="pack.cover.url"
							:kind="pack.cover.kind"
							:size="42"
						/>
					</span>
					<div class="msgr-stk__meta">
						<b>{{ pack.name }}</b>
						<span>{{ stickerWord(pack.count) }}</span>
					</div>
					<button
						type="button"
						:class="pack.owned ? 'msgr-stk__ghost' : 'msgr-stk__primary'"
						:disabled="catalogBusy === pack.pack"
						@click="togglePack(pack.pack, !pack.owned)"
					>
						{{
							pack.owned
								? t('app.messenger.stickers.removeShort', 'Убрать')
								: t('app.messenger.stickers.add', 'Добавить')
						}}
					</button>
				</div>
			</div>
		</template>
		<input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles" />
	</div>
</template>

<style scoped>
.msgr-stk {
	display: flex;
	width: 21rem;
	height: 26rem;
	flex-direction: column;
	gap: 0.45rem;
}

.msgr-stk__tabs {
	display: flex;
	gap: 0.25rem;
	padding: 0.2rem;
	border-radius: 9px;
	background: rgba(0, 0, 0, 0.25);
}

.msgr-stk__tabs button {
	flex: 1;
	padding: 0.4rem 0;
	border: 0;
	border-radius: 7px;
	background: transparent;
	color: var(--color-secondary);
	font: inherit;
	font-size: 0.85rem;
	font-weight: 600;
	cursor: pointer;
	transition:
		background 0.15s ease,
		color 0.15s ease;
}

.msgr-stk__tabs button.is-on {
	background: rgba(255, 255, 255, 0.09);
	color: var(--color-contrast);
}

.msgr-stk__emoji {
	overflow: auto;
	width: auto;
	flex: 1;
}

.msgr-stk__search {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	padding: 0 0.6rem;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.28);
	color: var(--color-secondary);
}

.msgr-stk__search svg {
	width: 0.95rem;
	height: 0.95rem;
	flex-shrink: 0;
}

.msgr-stk__search input {
	min-width: 0;
	flex: 1;
	height: 2rem;
	border: 0;
	background: transparent;
	box-shadow: none;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.85rem;
	outline: none;
}

.msgr-stk__stage {
	display: flex;
	min-height: 0;
	flex: 1;
	flex-direction: column;
	gap: 0.6rem;
	overflow-y: auto;
	padding-right: 0.15rem;
	scrollbar-width: thin;
}

.msgr-stk__head {
	position: sticky;
	top: 0;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.2rem 0.15rem 0.3rem;
	background: var(--msgr-inset);
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.msgr-stk__head span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-stk__x {
	display: grid;
	width: 1.3rem;
	height: 1.3rem;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 5px;
	background: none;
	color: var(--color-secondary);
	cursor: pointer;
	opacity: 0;
	transition: opacity 0.15s ease;
}

section:hover .msgr-stk__x {
	opacity: 1;
}

.msgr-stk__x svg {
	width: 0.8rem;
	height: 0.8rem;
}

.msgr-stk__grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 0.3rem;
}

.msgr-stk__cell,
.msgr-stk__add {
	position: relative;
	display: grid;
	aspect-ratio: 1;
	place-items: center;
	padding: 0.2rem;
	border: 0;
	border-radius: 10px;
	background: transparent;
	cursor: pointer;
	transition:
		background 0.15s ease,
		transform 0.15s ease;
}

.msgr-stk__cell > button:first-child {
	display: grid;
	width: 100%;
	height: 100%;
	place-items: center;
	padding: 0;
	border: 0;
	background: none;
	cursor: pointer;
}

.msgr-stk__cell img {
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
}

.msgr-stk__cell:hover {
	background: rgba(255, 255, 255, 0.07);
	transform: scale(1.06);
}

.msgr-stk__add {
	border: 1px dashed rgba(255, 255, 255, 0.18);
	color: var(--color-secondary);
}

.msgr-stk__add:hover {
	border-color: var(--color-brand);
	color: var(--color-brand);
}

.msgr-stk__add svg {
	width: 1.5rem;
	height: 1.5rem;
}

.msgr-stk__remove {
	position: absolute;
	top: 0.1rem;
	right: 0.1rem;
	display: grid;
	width: 1.3rem;
	height: 1.3rem;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.65);
	color: #f2f3f5;
	cursor: pointer;
	opacity: 0;
	transition: opacity 0.15s ease;
}

.msgr-stk__cell:hover .msgr-stk__remove {
	opacity: 1;
}

.msgr-stk__remove:hover {
	background: #da373c;
}

.msgr-stk__remove svg {
	width: 0.75rem;
	height: 0.75rem;
}

.msgr-stk__empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	padding: 1.2rem 0.5rem;
	color: var(--color-secondary);
	font-size: 0.85rem;
	text-align: center;
}

.msgr-stk__empty p {
	margin: 0;
}

.msgr-stk__rail {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	overflow-x: auto;
	padding-top: 0.4rem;
	border-top: 1px solid rgba(255, 255, 255, 0.07);
	scrollbar-width: none;
}

.msgr-stk__rail button {
	display: grid;
	width: 2.1rem;
	height: 2.1rem;
	flex-shrink: 0;
	place-items: center;
	overflow: hidden;
	padding: 0.15rem;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--color-secondary);
	cursor: pointer;
	transition: background 0.15s ease;
}

.msgr-stk__rail button.is-on,
.msgr-stk__rail button:hover {
	background: rgba(255, 255, 255, 0.09);
}

.msgr-stk__rail img {
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
}

.msgr-stk__rail svg {
	width: 1.1rem;
	height: 1.1rem;
}

.msgr-stk__plus {
	margin-left: auto;
}

.msgr-stk__catalog-head {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	color: var(--color-contrast);
}

.msgr-stk__back {
	display: grid;
	width: 1.8rem;
	height: 1.8rem;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 7px;
	background: rgba(255, 255, 255, 0.06);
	color: inherit;
	cursor: pointer;
}

.msgr-stk__back svg {
	width: 1rem;
	height: 1rem;
}

.msgr-stk__pack {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.45rem;
	border-radius: 10px;
	transition: background 0.15s ease;
}

.msgr-stk__pack:hover {
	background: rgba(255, 255, 255, 0.05);
}

.msgr-stk__cover {
	display: grid;
	width: 2.8rem;
	height: 2.8rem;
	flex-shrink: 0;
	place-items: center;
	border-radius: 10px;
	background: rgba(0, 0, 0, 0.25);
}

.msgr-stk__meta {
	display: flex;
	min-width: 0;
	flex: 1;
	flex-direction: column;
}

.msgr-stk__meta b {
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 0.88rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.msgr-stk__meta span {
	color: var(--color-secondary);
	font-size: 0.75rem;
}

.msgr-stk__primary,
.msgr-stk__ghost {
	flex-shrink: 0;
	padding: 0.35rem 0.8rem;
	border: 0;
	border-radius: 7px;
	font: inherit;
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	transition: filter 0.15s ease;
}

.msgr-stk__primary {
	background: var(--color-brand);
	color: var(--color-accent-contrast, #fff);
}

.msgr-stk__ghost {
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-contrast);
}

.msgr-stk__primary:hover,
.msgr-stk__ghost:hover {
	filter: brightness(1.12);
}

.msgr-stk__primary:disabled,
.msgr-stk__ghost:disabled {
	cursor: default;
	opacity: 0.6;
}
</style>
