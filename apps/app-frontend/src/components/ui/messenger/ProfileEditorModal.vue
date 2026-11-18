<script setup lang="ts">
import { CheckIcon, ImageIcon, PaletteIcon, TrashIcon, UploadIcon, XIcon } from '@modrinth/assets'
import { computed, reactive, ref, watch } from 'vue'

import { useMessengerT } from './i18n'
import {
	BANNER_COLORS,
	BIO_LIMIT,
	compressBanner,
	myCard,
	profileEditor,
	saveMyCard,
} from './profile-card'
import { me, presenceFor, showToast } from './store'
import UserAvatar from './UserAvatar.vue'

const t = useMessengerT()

const draft = reactive({
	bio: '',
	pronouns: '',
	bannerColor: '',
	bannerImage: '',
	accent: '',
})
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

watch(
	() => profileEditor.open,
	(open) => {
		if (!open) return
		const card = myCard()
		draft.bio = card.bio
		draft.pronouns = card.pronouns
		draft.bannerColor = card.bannerColor
		draft.bannerImage = card.bannerImage
		draft.accent = card.accent
	},
)

const dirty = computed(() => {
	const card = myCard()
	return (
		draft.bio !== card.bio ||
		draft.pronouns !== card.pronouns ||
		draft.bannerColor !== card.bannerColor ||
		draft.bannerImage !== card.bannerImage ||
		draft.accent !== card.accent
	)
})

const previewAccent = computed(() => draft.accent || draft.bannerColor || 'var(--color-brand)')

const bannerStyle = computed(() => {
	if (draft.bannerImage) return { backgroundImage: `url("${draft.bannerImage}")` }
	const color = draft.bannerColor || draft.accent
	return color ? { background: `linear-gradient(135deg, ${color}, ${color}99)` } : {}
})

const statusText = computed(() => {
	switch (me.value ? presenceFor(me.value.id) : 'offline') {
		case 'online':
			return t('app.messenger.status.online', 'В сети')
		case 'busy':
			return t('app.messenger.status.busy', 'Отошёл')
		case 'dnd':
			return t('app.messenger.status.dnd', 'Не беспокоить')
		default:
			return t('app.messenger.status.offline', 'Не в сети')
	}
})

function close(): void {
	profileEditor.open = false
}

function pickBanner(): void {
	fileInput.value?.click()
}

async function onBannerFile(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	if (!file.type.startsWith('image/')) {
		showToast(t('app.messenger.profile.bannerType', 'Нужна картинка: PNG, JPG, WebP или GIF'))
		return
	}
	uploading.value = true
	try {
		draft.bannerImage = await compressBanner(file)
	} catch {
		showToast(t('app.messenger.profile.bannerFailed', 'Не получилось прочитать картинку'))
	} finally {
		uploading.value = false
	}
}

function onColor(field: 'bannerColor' | 'accent', event: Event): void {
	draft[field] = (event.target as HTMLInputElement).value
}

function reset(): void {
	draft.bio = ''
	draft.pronouns = ''
	draft.bannerColor = ''
	draft.bannerImage = ''
	draft.accent = ''
}

async function save(): Promise<void> {
	if (saving.value) return
	saving.value = true
	try {
		await saveMyCard({ ...draft, bio: draft.bio.trim(), pronouns: draft.pronouns.trim() })
		showToast(t('app.messenger.profile.saved', 'Профиль обновлён'))
		close()
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<Teleport to="body">
		<Transition name="ped">
			<div v-if="profileEditor.open && me" class="ped msgr-root" @mousedown.self="close">
				<div class="ped__window" role="dialog" aria-modal="true">
					<header class="ped__head">
						<b>{{ t('app.messenger.profile.edit', 'Редактировать профиль') }}</b>
						<button
							type="button"
							class="ped__close"
							:aria-label="t('app.messenger.close', 'Закрыть')"
							@click="close"
						>
							<XIcon />
						</button>
					</header>

					<div class="ped__body">
						<div class="ped__form">
							<section class="ped__field">
								<span class="ped__label">{{
									t('app.messenger.profile.pronouns', 'Местоимения')
								}}</span>
								<input
									v-model="draft.pronouns"
									class="ped__input"
									maxlength="40"
									:placeholder="t('app.messenger.profile.pronounsHint', 'Например, он/его')"
								/>
							</section>

							<section class="ped__field">
								<span class="ped__label">{{ t('app.messenger.profile.banner', 'Баннер') }}</span>
								<div class="ped__row">
									<button
										type="button"
										class="ped__btn is-accent"
										:disabled="uploading"
										@click="pickBanner"
									>
										<span v-if="uploading" class="msgr-spinner" />
										<UploadIcon v-else />
										{{ t('app.messenger.profile.bannerUpload', 'Загрузить картинку') }}
									</button>
									<button
										v-if="draft.bannerImage"
										type="button"
										class="ped__btn"
										@click="draft.bannerImage = ''"
									>
										<TrashIcon />
										{{ t('app.messenger.profile.bannerRemove', 'Убрать') }}
									</button>
								</div>
								<input
									ref="fileInput"
									type="file"
									accept="image/png,image/jpeg,image/webp,image/gif"
									hidden
									@change="onBannerFile"
								/>
								<div class="ped__swatches">
									<button
										v-for="color in BANNER_COLORS"
										:key="color"
										type="button"
										class="ped__swatch"
										:class="{ 'is-on': draft.bannerColor === color }"
										:style="{ background: color }"
										:aria-label="color"
										@click="draft.bannerColor = color"
									>
										<CheckIcon v-if="draft.bannerColor === color" />
									</button>
									<label
										class="ped__swatch is-custom"
										:style="draft.bannerColor ? { background: draft.bannerColor } : undefined"
									>
										<PaletteIcon />
										<input
											type="color"
											:value="draft.bannerColor || '#5865f2'"
											@input="onColor('bannerColor', $event)"
										/>
									</label>
								</div>
							</section>

							<section class="ped__field">
								<span class="ped__label">{{
									t('app.messenger.profile.accent', 'Цвет акцента')
								}}</span>
								<div class="ped__row">
									<label class="ped__color">
										<input
											type="color"
											:value="draft.accent || '#5865f2'"
											@input="onColor('accent', $event)"
										/>
										<span>{{
											draft.accent || t('app.messenger.profile.accentAuto', 'Как у баннера')
										}}</span>
									</label>
									<button
										v-if="draft.accent"
										type="button"
										class="ped__btn"
										@click="draft.accent = ''"
									>
										{{ t('app.messenger.profile.accentReset', 'Сбросить') }}
									</button>
								</div>
							</section>

							<section class="ped__field">
								<span class="ped__label">
									{{ t('app.messenger.profile.bio', 'Обо мне') }}
									<small>{{ draft.bio.length }}/{{ BIO_LIMIT }}</small>
								</span>
								<textarea
									v-model="draft.bio"
									class="ped__input ped__textarea"
									:maxlength="BIO_LIMIT"
									rows="4"
									:placeholder="
										t('app.messenger.profile.bioHint', 'Пара слов о себе, любимые сборки, сервер…')
									"
								/>
							</section>

							<p class="ped__note">
								<ImageIcon />
								{{
									t(
										'app.messenger.profile.note',
										'Оформление видят игроки PortalrinthS, с которыми у вас есть личный чат.',
									)
								}}
							</p>
						</div>

						<aside class="ped__preview" :style="{ '--ped-accent': previewAccent }">
							<span class="ped__label">{{
								t('app.messenger.profile.preview', 'Предпросмотр')
							}}</span>
							<div class="ped__card">
								<div class="ped__banner" :style="bannerStyle" />
								<div class="ped__avatar">
									<UserAvatar
										:user-id="me.id"
										:name="me.username"
										:size="72"
										status
										ring="#111214"
									/>
								</div>
								<div class="ped__card-body">
									<b class="ped__name">{{ me.username }}</b>
									<small v-if="draft.pronouns">{{ draft.pronouns }}</small>
									<span class="ped__status">{{ statusText }}</span>
									<p v-if="draft.bio.trim()" class="ped__bio">{{ draft.bio }}</p>
									<span class="ped__fake-btn">{{
										t('app.messenger.profile.write', 'Написать')
									}}</span>
								</div>
							</div>
						</aside>
					</div>

					<footer class="ped__foot">
						<button type="button" class="ped__btn is-link" @click="reset">
							{{ t('app.messenger.profile.resetAll', 'Сбросить всё') }}
						</button>
						<div class="ped__row">
							<button type="button" class="ped__btn" @click="close">
								{{ t('app.messenger.cancel', 'Отмена') }}
							</button>
							<button
								type="button"
								class="ped__btn is-accent"
								:disabled="!dirty || saving"
								@click="save"
							>
								<span v-if="saving" class="msgr-spinner" />
								{{ t('app.messenger.save', 'Сохранить') }}
							</button>
						</div>
					</footer>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.ped {
	position: fixed;
	inset: 0;
	z-index: 125;
	display: grid;
	place-items: center;
	padding: 1.5rem;
	background: rgba(0, 0, 0, 0.55);
	backdrop-filter: blur(8px);
}

.ped__window {
	display: flex;
	width: min(820px, 100%);
	max-height: calc(100vh - 3rem);
	flex-direction: column;
	overflow: hidden;
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 18px;
	background: #18191c;
	box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}

.ped__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem 1.25rem 0.5rem;
	color: var(--color-contrast);
	font-size: 1.1rem;
}

.ped__close {
	display: grid;
	width: 2rem;
	height: 2rem;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.06);
	color: var(--color-secondary);
	cursor: pointer;
	transition:
		background 0.15s ease,
		color 0.15s ease,
		transform 0.15s ease;
}

.ped__close:hover {
	background: rgba(255, 255, 255, 0.12);
	color: var(--color-contrast);
	transform: rotate(90deg);
}

.ped__close svg {
	width: 1rem;
	height: 1rem;
}

.ped__body {
	display: grid;
	min-height: 0;
	flex: 1;
	grid-template-columns: 1fr 300px;
	gap: 1.25rem;
	overflow-y: auto;
	padding: 0.5rem 1.25rem 1rem;
	scrollbar-width: thin;
}

.ped__form {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 1.1rem;
}

.ped__field {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	padding-bottom: 1.1rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ped__label {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	color: var(--color-secondary);
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.02em;
	text-transform: uppercase;
}

.ped__label small {
	font-weight: 600;
	text-transform: none;
}

.ped__input {
	width: 100%;
	padding: 0.55rem 0.7rem;
	border: 1px solid transparent;
	border-radius: 9px;
	background: rgba(0, 0, 0, 0.35);
	box-shadow: none;
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.9rem;
	outline: none;
	transition: border-color 0.15s ease;
}

.ped__input:focus {
	border-color: var(--color-brand);
}

.ped__textarea {
	min-height: 6rem;
	resize: vertical;
}

.ped__row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.ped__btn {
	display: inline-flex;
	height: 2.1rem;
	align-items: center;
	gap: 0.4rem;
	padding: 0 0.85rem;
	border: 0;
	border-radius: 9px;
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-contrast);
	font: inherit;
	font-size: 0.85rem;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
	transition:
		background 0.15s ease,
		filter 0.15s ease,
		transform 0.12s ease;
}

.ped__btn:hover:not(:disabled) {
	background: rgba(255, 255, 255, 0.14);
}

.ped__btn:active:not(:disabled) {
	transform: scale(0.97);
}

.ped__btn:disabled {
	opacity: 0.5;
	cursor: default;
}

.ped__btn.is-accent {
	background: var(--color-brand);
	color: #fff;
}

.ped__btn.is-accent:hover:not(:disabled) {
	background: var(--color-brand);
	filter: brightness(1.12);
}

.ped__btn.is-link {
	padding: 0;
	background: none;
	color: var(--color-secondary);
}

.ped__btn.is-link:hover {
	background: none;
	color: var(--color-contrast);
	text-decoration: underline;
}

.ped__btn svg {
	width: 1rem;
	height: 1rem;
}

.ped__swatches {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.ped__swatch {
	position: relative;
	display: grid;
	width: 2.2rem;
	height: 2.2rem;
	place-items: center;
	padding: 0;
	border: 2px solid transparent;
	border-radius: 10px;
	color: #fff;
	cursor: pointer;
	transition:
		transform 0.15s ease,
		border-color 0.15s ease;
}

.ped__swatch:hover {
	transform: translateY(-2px);
}

.ped__swatch.is-on {
	border-color: #fff;
}

.ped__swatch.is-custom {
	background: conic-gradient(#f23f43, #f0b232, #23a55a, #3ba7ff, #9b59b6, #f23f43);
	overflow: hidden;
}

.ped__swatch svg {
	width: 1rem;
	height: 1rem;
	filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}

.ped__swatch input,
.ped__color input {
	position: absolute;
	inset: 0;
	opacity: 0;
	cursor: pointer;
}

.ped__color {
	position: relative;
	display: inline-flex;
	height: 2.1rem;
	align-items: center;
	gap: 0.5rem;
	padding: 0 0.75rem 0 0.35rem;
	border-radius: 9px;
	background: rgba(0, 0, 0, 0.35);
	color: var(--color-contrast);
	font-size: 0.85rem;
	cursor: pointer;
}

.ped__color::before {
	width: 1.5rem;
	height: 1.5rem;
	border-radius: 6px;
	background: v-bind('draft.accent || "#5865f2"');
	content: '';
}

.ped__note {
	display: flex;
	align-items: flex-start;
	gap: 0.5rem;
	margin: 0;
	color: var(--color-secondary);
	font-size: 0.78rem;
	line-height: 1.4;
}

.ped__note svg {
	width: 1rem;
	height: 1rem;
	flex-shrink: 0;
}

.ped__preview {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.ped__card {
	position: sticky;
	top: 0;
	overflow: hidden;
	border-radius: 14px;
	background: #111214;
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--ped-accent) 40%, transparent);
}

.ped__banner {
	height: 100px;
	background: linear-gradient(135deg, #2b2d31, #1d1e22);
	background-position: center;
	background-size: cover;
	transition: background 0.25s ease;
}

.ped__avatar {
	width: fit-content;
	margin: -38px 0 0 14px;
	border-radius: 50%;
	box-shadow: 0 0 0 5px #111214;
}

.ped__card-body {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	padding: 0.5rem 0.9rem 0.9rem;
}

.ped__name {
	overflow: hidden;
	color: var(--color-contrast);
	font-size: 1.1rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ped__card-body small,
.ped__status {
	color: var(--color-secondary);
	font-size: 0.8rem;
}

.ped__bio {
	margin: 0.4rem 0 0;
	padding: 0.5rem 0.6rem;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.04);
	color: var(--color-text);
	font-size: 0.82rem;
	line-height: 1.4;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.ped__fake-btn {
	display: grid;
	height: 2rem;
	margin-top: 0.6rem;
	place-items: center;
	border-radius: 8px;
	background: var(--ped-accent);
	color: #fff;
	font-size: 0.82rem;
	font-weight: 600;
}

.ped__foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.85rem 1.25rem;
	background: rgba(0, 0, 0, 0.25);
}

.ped-enter-active,
.ped-leave-active {
	transition: opacity 0.2s ease;
}

.ped-enter-active .ped__window,
.ped-leave-active .ped__window {
	transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.ped-enter-from,
.ped-leave-to {
	opacity: 0;
}

.ped-enter-from .ped__window,
.ped-leave-to .ped__window {
	transform: scale(0.95) translateY(10px);
}

@media (max-width: 760px) {
	.ped__body {
		grid-template-columns: 1fr;
	}
}
</style>
