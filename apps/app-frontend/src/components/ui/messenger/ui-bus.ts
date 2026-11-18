import { reactive } from 'vue'

import type { Msg } from './model'

export type Anchor = { x: number; y: number; w?: number; h?: number }

export type PromptOptions = {
	title: string
	text?: string
	label?: string
	value?: string
	placeholder?: string
	confirm?: string
	danger?: boolean
	input?: boolean
	multiline?: boolean
	choices?: { id: string; label: string; danger?: boolean }[]
}

type Handlers = {
	profile: (userId: string, fallbackName?: string) => void
	prompt: (opts: PromptOptions) => Promise<string | null>
	forward: (msg: Msg) => void
	lightbox: (url: string, name: string) => void
}

const handlers: Partial<Handlers> = {}

export const popover = reactive({
	userId: '',
	name: '',
	anchor: null as Anchor | null,
})

export function registerUi(next: Handlers): void {
	Object.assign(handlers, next)
}

export function openProfile(userId: string, fallbackName = ''): void {
	popover.userId = ''
	handlers.profile?.(userId, fallbackName)
}

export function openPopover(userId: string, name: string, el: Element | null): void {
	if (!userId) return
	const rect = el?.getBoundingClientRect()
	popover.userId = userId
	popover.name = name
	popover.anchor = rect
		? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
		: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

export function closePopover(): void {
	popover.userId = ''
	popover.anchor = null
}

export async function askPrompt(opts: PromptOptions): Promise<string | null> {
	return handlers.prompt ? handlers.prompt(opts) : null
}

export async function askConfirm(opts: Omit<PromptOptions, 'input'>): Promise<boolean> {
	return (await askPrompt({ ...opts, input: false })) !== null
}

/** Окно с несколькими вариантами: вернёт id выбранного или null при отмене. */
export async function askChoice(
	opts: Omit<PromptOptions, 'input' | 'choices'> & {
		choices: NonNullable<PromptOptions['choices']>
	},
): Promise<string | null> {
	return askPrompt({ ...opts, input: false })
}

export function openForward(msg: Msg): void {
	handlers.forward?.(msg)
}

export function openLightbox(url: string, name: string): void {
	handlers.lightbox?.(url, name)
}
