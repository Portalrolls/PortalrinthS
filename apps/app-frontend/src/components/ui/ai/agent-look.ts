import { ref, watch } from 'vue'

/**
 * Облик агента: вместо блоба — «ядро» портала. Стиль задаёт, как оно
 * собрано (орбиты, призма, волны), палитра — его цвета. Выбор общий для
 * всей страницы и хранится локально.
 */
export type CoreStyle = 'orbit' | 'prism' | 'pulse'

export type CorePalette = {
	id: string
	label: string
	/** Два цвета градиента; `accent` берёт цвет темы лаунчера. */
	a: string
	b: string
}

export const CORE_STYLES: { id: CoreStyle; label: string; hint: string }[] = [
	{ id: 'orbit', label: 'Орбита', hint: 'Кольца вращаются вокруг ядра' },
	{ id: 'prism', label: 'Призма', hint: 'Грани поворачиваются, пока агент думает' },
	{ id: 'pulse', label: 'Волна', hint: 'Ядро расходится кругами' },
]

export const CORE_PALETTES: CorePalette[] = [
	{
		id: 'accent',
		label: 'Тема',
		a: 'var(--color-brand)',
		b: 'color-mix(in srgb, var(--color-brand) 45%, #ffffff)',
	},
	{ id: 'aurora', label: 'Сияние', a: '#7c5cff', b: '#22d3ee' },
	{ id: 'ember', label: 'Угли', a: '#ff6b4a', b: '#ffc94d' },
	{ id: 'mint', label: 'Мята', a: '#10b981', b: '#a3e635' },
	{ id: 'rose', label: 'Роза', a: '#ec4899', b: '#c084fc' },
	{ id: 'ice', label: 'Лёд', a: '#3b82f6', b: '#bae6fd' },
]

const STYLE_KEY = 'portalrinth-ai-core-style'
const PALETTE_KEY = 'portalrinth-ai-core-palette'

function readStyle(): CoreStyle {
	const stored = localStorage.getItem(STYLE_KEY)
	return CORE_STYLES.some((style) => style.id === stored) ? (stored as CoreStyle) : 'orbit'
}

function readPalette(): string {
	const stored = localStorage.getItem(PALETTE_KEY) || ''
	return CORE_PALETTES.some((palette) => palette.id === stored) ? stored : 'accent'
}

export const coreStyle = ref<CoreStyle>(readStyle())
export const corePalette = ref<string>(readPalette())

watch(coreStyle, (value) => localStorage.setItem(STYLE_KEY, value))
watch(corePalette, (value) => localStorage.setItem(PALETTE_KEY, value))

export function paletteById(id: string): CorePalette {
	return CORE_PALETTES.find((palette) => palette.id === id) ?? CORE_PALETTES[0]
}
