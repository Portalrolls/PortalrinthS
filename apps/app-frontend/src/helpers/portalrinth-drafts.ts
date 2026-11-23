/**
 * Portalrinth drafts: an unsent message survives leaving the page.
 *
 * Whoever starts writing a post, a question for the assistant or a chat
 * message and then goes to another tab - or closes the launcher - gets the
 * text back as a small floating "Draft" card when the place returns. The
 * card applies the text back with one click, a cross deletes it, and if
 * nobody reacts, it hides itself: the countdown starts with the first move
 * of the cursor and lasts 30 seconds; while the cursor is still, the card
 * waits. The text itself stays saved either way until it is sent.
 */

export type DraftKind = 'ai' | 'messenger' | 'news'

export interface SavedDraft {
	kind: DraftKind
	id: string
	text: string
	/** Attached pictures of a news post (data URLs), when there were any. */
	images?: string[]
	savedAt: number
}

const KEY = 'portalrinth-drafts'
const SAVE_DELAY = 300

function loadAll(): Record<string, SavedDraft> {
	try {
		const raw = localStorage.getItem(KEY)
		const parsed = raw ? (JSON.parse(raw) as Record<string, SavedDraft>) : {}
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

function persistAll(all: Record<string, SavedDraft>): boolean {
	try {
		localStorage.setItem(KEY, JSON.stringify(all))
		return true
	} catch {
		/* the quota is full - keep only the text, without pictures */
		return false
	}
}

function draftKey(kind: DraftKind, id: string): string {
	return `${kind}:${id}`
}

export function saveDraft(kind: DraftKind, id: string, text: string, images?: string[]): void {
	const trimmed = text.trim()
	if (!trimmed && !(images && images.length)) {
		deleteDraft(kind, id)
		return
	}
	const all = loadAll()
	const draft: SavedDraft = {
		kind,
		id,
		text: trimmed,
		savedAt: Date.now(),
	}
	if (images && images.length) draft.images = images
	all[draftKey(kind, id)] = draft
	if (!persistAll(all) && images && images.length) {
		// Pictures did not fit into the quota - the text matters more.
		const lighter: SavedDraft = { kind, id, text: trimmed, savedAt: draft.savedAt }
		all[draftKey(kind, id)] = lighter
		persistAll(all)
	}
}

export function loadDraft(kind: DraftKind, id: string): SavedDraft | null {
	const draft = loadAll()[draftKey(kind, id)] ?? null
	if (!draft || (!draft.text && !(draft.images && draft.images.length))) return null
	return draft
}

export function deleteDraft(kind: DraftKind, id: string): void {
	const key = draftKey(kind, id)
	const all = loadAll()
	const rest: Record<string, SavedDraft> = {}
	for (const entry of Object.entries(all)) {
		if (entry[0] !== key) rest[entry[0]] = entry[1]
	}
	persistAll(rest)
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Debounced auto-save: the draft survives even an abrupt launcher close.
 * The values are captured at call time - by the time the timer fires the
 * user may already be typing in a different conversation.
 */
export function autosaveDraft(kind: DraftKind, id: string, text: string, images?: string[]): void {
	const key = draftKey(kind, id)
	const timer = timers.get(key)
	if (timer) clearTimeout(timer)
	const savedText = text
	const savedImages = images ? [...images] : undefined
	timers.set(
		key,
		setTimeout(() => {
			timers.delete(key)
			saveDraft(kind, id, savedText, savedImages)
		}, SAVE_DELAY),
	)
}
