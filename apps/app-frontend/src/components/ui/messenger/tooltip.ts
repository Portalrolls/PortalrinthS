import type { Directive } from 'vue'

type Side = 'top' | 'right' | 'bottom'

type TipHost = HTMLElement & { __msgrTip?: { text: string; side: Side; off: () => void } }

let bubble: HTMLDivElement | null = null
let owner: TipHost | null = null

function ensureBubble(): HTMLDivElement {
	if (bubble) return bubble
	bubble = document.createElement('div')
	bubble.className = 'msgr-tooltip'
	bubble.setAttribute('role', 'tooltip')
	document.body.appendChild(bubble)
	return bubble
}

function show(el: TipHost): void {
	const data = el.__msgrTip
	if (!data?.text) return
	const tip = ensureBubble()
	owner = el
	tip.textContent = data.text
	tip.dataset.side = data.side
	tip.classList.remove('is-visible')
	const rect = el.getBoundingClientRect()
	const box = tip.getBoundingClientRect()
	let left = rect.left + rect.width / 2 - box.width / 2
	let top = rect.top - box.height - 8
	if (data.side === 'right') {
		left = rect.right + 10
		top = rect.top + rect.height / 2 - box.height / 2
	} else if (data.side === 'bottom' || top < 6) {
		top = rect.bottom + 8
	}
	left = Math.max(6, Math.min(window.innerWidth - box.width - 6, left))
	tip.style.left = `${Math.round(left)}px`
	tip.style.top = `${Math.round(top)}px`
	requestAnimationFrame(() => {
		if (owner === el) tip.classList.add('is-visible')
	})
}

function hide(el?: TipHost): void {
	if (el && owner !== el) return
	owner = null
	bubble?.classList.remove('is-visible')
}

/** v-tip="текст" или v-tip:right="текст" — подсказка как в Discord, не обрезается скроллом. */
export const vTip: Directive<TipHost, string> = {
	mounted(el, binding) {
		const enter = () => show(el)
		const leave = () => hide(el)
		el.addEventListener('mouseenter', enter)
		el.addEventListener('mouseleave', leave)
		el.addEventListener('pointerdown', leave)
		el.__msgrTip = {
			text: binding.value,
			side: (binding.arg as Side) || 'top',
			off: () => {
				el.removeEventListener('mouseenter', enter)
				el.removeEventListener('mouseleave', leave)
				el.removeEventListener('pointerdown', leave)
			},
		}
		if (!el.getAttribute('aria-label') && binding.value)
			el.setAttribute('aria-label', binding.value)
	},
	updated(el, binding) {
		if (!el.__msgrTip) return
		el.__msgrTip.text = binding.value
		if (owner === el) show(el)
	},
	beforeUnmount(el) {
		hide(el)
		el.__msgrTip?.off()
	},
}
