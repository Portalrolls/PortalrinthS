import { reactive } from 'vue'

import type { Translate } from './i18n'
import { askPrompt } from './ui-bus'

/**
 * Свои имена для друзей. Видны только в этом лаунчере и только под этим
 * аккаунтом — на сервис ничего не уходит.
 */
const KEY = 'portalrinth-messenger-aliases:'
const MAX_LENGTH = 32

export const aliases = reactive<Record<string, string>>({})

let owner = ''

export function loadAliases(ownerId: string): void {
	owner = ownerId
	for (const id of Object.keys(aliases)) Reflect.deleteProperty(aliases, id)
	if (!ownerId) return
	try {
		const raw = JSON.parse(localStorage.getItem(KEY + ownerId) || '{}') as Record<string, unknown>
		for (const [id, name] of Object.entries(raw)) {
			if (typeof name === 'string' && name.trim()) aliases[id] = name.trim()
		}
	} catch {
		// Битая запись — просто начинаем с чистого списка.
	}
}

export function aliasOf(id: string): string {
	return (id && aliases[id]) || ''
}

export function setAlias(id: string, name: string): void {
	if (!id || !owner) return
	const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH)
	if (clean) aliases[id] = clean
	else Reflect.deleteProperty(aliases, id)
	try {
		localStorage.setItem(KEY + owner, JSON.stringify(aliases))
	} catch {
		// Хранилище переполнено — имя останется до перезапуска.
	}
}

export async function promptAlias(id: string, username: string, t: Translate): Promise<void> {
	const current = aliasOf(id)
	const value = await askPrompt({
		title: t('app.messenger.alias.title', 'Имя для {name}', { name: username }),
		text: t(
			'app.messenger.alias.text',
			'Это имя видите только вы. Оставьте поле пустым, чтобы вернуть ник.',
		),
		value: current,
		placeholder: username,
		confirm: t('app.messenger.alias.save', 'Сохранить'),
		input: true,
		allowEmpty: true,
	})
	if (value === null || value === current) return
	setAlias(id, value === username ? '' : value)
}
