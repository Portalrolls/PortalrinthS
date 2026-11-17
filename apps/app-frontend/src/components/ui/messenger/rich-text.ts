export type RichNode =
	| { type: 'text'; text: string }
	| { type: 'bold' | 'italic' | 'strike' | 'code' | 'spoiler'; text: string }
	| { type: 'pre'; text: string }
	| { type: 'link'; text: string; href: string }
	| { type: 'mention'; text: string; name: string }
	| { type: 'br' }

const INLINE =
	/(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\|\|[^|\n]+\|\|)|(\*[^*\n]+\*)|(_[^_\n]+_)|(https?:\/\/[^\s<>"']+)|(@[A-Za-z0-9_]{2,32})/g

function trimLink(raw: string): { href: string; tail: string } {
	let href = raw
	let tail = ''
	while (/[.,!?:;)\]]$/.test(href)) {
		if (
			href.endsWith(')') &&
			(href.match(/\(/g)?.length ?? 0) >= (href.match(/\)/g)?.length ?? 0)
		) {
			break
		}
		tail = href.slice(-1) + tail
		href = href.slice(0, -1)
	}
	return { href, tail }
}

function pushText(nodes: RichNode[], text: string): void {
	if (!text) return
	const lines = text.split('\n')
	lines.forEach((line, index) => {
		if (index > 0) nodes.push({ type: 'br' })
		if (line) nodes.push({ type: 'text', text: line })
	})
}

function parseInline(nodes: RichNode[], source: string): void {
	let last = 0
	INLINE.lastIndex = 0
	for (let match = INLINE.exec(source); match; match = INLINE.exec(source)) {
		const [token] = match
		pushText(nodes, source.slice(last, match.index))
		last = match.index + token.length
		if (match[1]) nodes.push({ type: 'code', text: token.slice(1, -1) })
		else if (match[2] || match[3]) nodes.push({ type: 'bold', text: token.slice(2, -2) })
		else if (match[4]) nodes.push({ type: 'strike', text: token.slice(2, -2) })
		else if (match[5]) nodes.push({ type: 'spoiler', text: token.slice(2, -2) })
		else if (match[6] || match[7]) nodes.push({ type: 'italic', text: token.slice(1, -1) })
		else if (match[8]) {
			const { href, tail } = trimLink(token)
			nodes.push({ type: 'link', text: href, href })
			pushText(nodes, tail)
		} else if (match[9]) {
			const before = match.index > 0 ? source[match.index - 1] : ' '
			if (/[\w.]/.test(before)) pushText(nodes, token)
			else nodes.push({ type: 'mention', text: token, name: token.slice(1) })
		}
	}
	pushText(nodes, source.slice(last))
}

/**
 * Разметка сообщения в узлы без HTML: шаблон рисует их сам, поэтому
 * чужой текст никогда не попадает в innerHTML.
 */
export function parseRich(source: string): RichNode[] {
	const nodes: RichNode[] = []
	const parts = source.split(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/i)
	parts.forEach((part, index) => {
		if (index % 2 === 1) nodes.push({ type: 'pre', text: part.replace(/\n$/, '') })
		else parseInline(nodes, part)
	})
	return nodes
}

export function isOnlyEmoji(source: string): boolean {
	const trimmed = source.trim()
	if (!trimmed || trimmed.length > 24) return false
	if (!/\p{Extended_Pictographic}/u.test(trimmed)) return false
	return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(trimmed)
}
