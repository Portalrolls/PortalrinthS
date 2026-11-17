// Аватар агента на движке Bloub (MIT, jeremy-prt/bloub): форма, цвет и
// состояния живут в соседних файлах движка, этот адаптер следит за всеми
// [data-bloub]-элементами страницы и рисует в них кадры.
/* eslint-disable */

import { NOTIF_BLUE, type DotRender } from './decor'
import { BotEngine, type BotFrame } from './engine'
import { EXPRESSION_BY_ID, type ExpressionId } from './expressions'
import { RAYON } from './repere'
import { COLOR_BY_ID, SHAPE_BY_ID } from './skins'
import { STATE_BY_ID, type StateId } from './states'

const PAPER = '#121212'
const VIEW = 118

type Face = {
	el: HTMLElement
	engine: BotEngine
	svg: SVGSVGElement
	uid: string
	mode: string
	shape: string
	expr: string
	winkUntil: number
	aiming: boolean
	ink: string
	inkSign: string
}

const faces = new Set<Face>()
let frame = 0
let clock = 0
let serial = 0
let pointer: { x: number; y: number } | null = null

const reducedMotion =
	typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-reduced-motion: reduce)')
		: null

export function expressionFor(_id = ''): ExpressionId {
	return 'attentif'
}

export function setBloubGaze(x: number | null, y: number | null): void {
	pointer = x == null || y == null ? null : { x, y }
}

export function syncBloubFaces(root: ParentNode): void {
	const nodes = new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-bloub]')))
	for (const face of [...faces]) {
		if (!face.el.isConnected || !nodes.has(face.el)) {
			faces.delete(face)
		}
	}
	nodes.forEach((el) => {
		if ([...faces].some((face) => face.el === el)) return
		faces.add(createFace(el))
	})
	if (faces.size && !frame) frame = requestAnimationFrame(tick)
}

/** Отпускает лица внутри root: кадр больше не крутится по снятой странице. */
export function releaseBloubFaces(root: ParentNode): void {
	for (const face of [...faces]) {
		if (!face.el.isConnected || root.contains(face.el)) faces.delete(face)
	}
	if (!faces.size && frame) {
		cancelAnimationFrame(frame)
		frame = 0
	}
}

function createFace(el: HTMLElement): Face {
	const uid = `bloub${(serial += 1)}`
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.setAttribute('viewBox', `${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`)
	svg.setAttribute('width', '100%')
	svg.setAttribute('height', '100%')
	svg.setAttribute('aria-hidden', 'true')
	el.replaceChildren(svg)
	const shape = el.dataset.shape || 'cercle'
	const expr = el.dataset.expr || 'heureux'
	const engine = new BotEngine(
		RAYON,
		'idle',
		SHAPE_BY_ID.get(shape)?.radii ?? null,
		EXPRESSION_BY_ID.get(expr) ?? null,
	)
	const face: Face = {
		el,
		engine,
		svg,
		uid,
		mode: 'idle',
		shape,
		expr,
		winkUntil: 0,
		aiming: false,
		ink: '',
		inkSign: '',
	}
	applyMode(face, clock)
	paint(face, engine.sample(clock))
	return face
}

function applyMode(face: Face, now: number): void {
	const raw = face.el.dataset.mode || 'idle'
	const shape = face.el.dataset.shape || 'cercle'
	const expr = face.el.dataset.expr || 'heureux'
	if (shape !== face.shape) {
		face.engine.setShape(SHAPE_BY_ID.get(shape)?.radii ?? null, now)
		face.shape = shape
	}
	if (expr !== face.expr) {
		face.engine.setExpression(EXPRESSION_BY_ID.get(expr) ?? null, now)
		face.expr = expr
	}
	const next: StateId =
		raw === 'thinking' || raw === 'notify' || raw === 'alert'
			? raw
			: raw === 'speaking'
				? 'wide'
				: 'idle'
	if (next === face.mode) return
	if (face.mode === 'thinking' && next === 'idle') {
		face.engine.setState('wink', now)
		face.winkUntil = now + 0.9
	} else {
		face.engine.setState(next, now)
		face.winkUntil = 0
	}
	face.mode = next
}

function aim(face: Face, now: number): void {
	const posed = STATE_BY_ID.get(currentState(face))?.baseFace
	if (face.el.dataset.follow !== '1' || !pointer || !posed) {
		if (face.aiming) {
			face.engine.setLook(null, now)
			face.aiming = false
		}
		return
	}
	const box = face.el.getBoundingClientRect()
	if (!box.width || !box.height) return
	const nx = Math.max(
		-1,
		Math.min(1, (pointer.x - (box.left + box.width / 2)) / Math.max(1, window.innerWidth / 2)),
	)
	const ny = Math.max(
		-1,
		Math.min(1, (pointer.y - (box.top + box.height / 2)) / Math.max(1, window.innerHeight / 2)),
	)
	face.engine.setLook(
		{
			yaw: nx * 16,
			pitch: 10 + ny * 13,
			mix: 1,
			spin: 0,
			wander: 0,
		},
		now,
	)
	face.aiming = true
}

function currentState(face: Face): StateId {
	if (face.winkUntil && clock < face.winkUntil) return 'wink'
	if (
		face.mode === 'thinking' ||
		face.mode === 'notify' ||
		face.mode === 'alert' ||
		face.mode === 'wide'
	)
		return face.mode
	return 'idle'
}

function tick(nowMs: number): void {
	frame = 0
	clock = nowMs / 1000
	for (const face of faces) {
		if (!face.el.isConnected) {
			faces.delete(face)
			continue
		}
		if (face.el.dataset.still === '1' || reducedMotion?.matches) {
			const sign = `${face.el.dataset.shape}|${face.el.dataset.color}|${face.el.dataset.expr}|${face.el.dataset.mode}`
			if (face.el.dataset.drawn === sign) continue
			applyMode(face, 0.4)
			paint(face, face.engine.sample(0.4))
			face.el.dataset.drawn = sign
			continue
		}
		applyMode(face, clock)
		if (face.mode === 'idle' && face.winkUntil && clock >= face.winkUntil) {
			face.engine.setState('idle', clock)
			face.winkUntil = 0
		}
		if (!face.el.offsetWidth || !face.el.offsetHeight) continue
		aim(face, clock)
		paint(face, face.engine.sample(clock))
	}
	if (faces.size) frame = requestAnimationFrame(tick)
}

function dotFill(dot: DotRender, ink: string): string {
	if (dot.color) return dot.color
	if (dot.depth == null) return ink
	return mix(PAPER, ink, dot.depth)
}

function mix(from: string, to: string, t: number): string {
	const parse = (hex: string) => {
		const v = parseInt(hex.slice(1), 16)
		return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
	}
	const a = parse(from)
	const b = parse(to)
	const c = a.map((channel, i) => Math.round(channel + ((b[i] ?? channel) - channel) * t))
	return `#${c.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function dotMarkup(dot: DotRender, ink: string): string {
	const fill = dotFill(dot, ink)
	if (dot.d) {
		return `<path d="${dot.d}" fill="${fill}" opacity="${dot.opacity}" transform="translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})"/>`
	}
	return `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" fill="${fill}" opacity="${dot.opacity}"/>`
}

function toHex(value: string): string | null {
	const text = value.trim()
	if (/^#[0-9a-f]{6}$/i.test(text)) return text
	if (/^#[0-9a-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join('')}`
	const rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i)
	if (rgb) {
		return `#${rgb
			.slice(1, 4)
			.map((channel) => Math.min(255, Number(channel)).toString(16).padStart(2, '0'))
			.join('')}`
	}
	return null
}

/** Цвет лица: id палитры («bleu»), hex или «accent» — акцент лаунчера. */
function inkOf(face: Face): string {
	const raw = (face.el.dataset.color || '').trim()
	if (face.inkSign === raw && face.ink) return face.ink
	let ink = COLOR_BY_ID.get(raw)?.hex ?? toHex(raw)
	if (!ink) {
		const style = getComputedStyle(document.documentElement)
		ink =
			toHex(style.getPropertyValue('--color-brand')) ??
			toHex(style.getPropertyValue('--accent')) ??
			'#b000ff'
	}
	face.ink = ink
	face.inkSign = raw
	return ink
}

function paint(face: Face, picture: BotFrame): void {
	const ink = inkOf(face)
	const uid = face.uid
	const eyes = picture.eyes
		.map(
			(eye) => `<path d="${eye.d}" transform="${eye.matrix}" opacity="${eye.alpha}" fill="#000"/>`,
		)
		.join('')
	const notch = picture.notch
		? `<circle cx="${picture.notch.x}" cy="${picture.notch.y}" r="${picture.notch.r}" fill="#000"/>`
		: ''
	const grads = picture.arcs
		.map((arc) => {
			const stops = arc.grad.stops
				.map((color, i) => {
					const offset = arc.grad.stops.length <= 1 ? 0 : i / (arc.grad.stops.length - 1)
					return `<stop offset="${offset}" stop-color="${color}"/>`
				})
				.join('')
			return `<linearGradient id="${uid}-${arc.id}" gradientUnits="userSpaceOnUse" x1="${arc.grad.x1}" y1="${arc.grad.y1}" x2="${arc.grad.x2}" y2="${arc.grad.y2}">${stops}</linearGradient>`
		})
		.join('')
	const arc = (part: 'back' | 'front') =>
		picture.arcs
			.map(
				(item) =>
					`<path d="${item[part]}" stroke="url(#${uid}-${item.id})" stroke-width="${item.width}" opacity="${item.opacity}"/>`,
			)
			.join('')
	const dots = picture.dots.map((dot) => dotMarkup(dot, ink)).join('')
	const notif = picture.notif
		? `<circle cx="${picture.notif.x}" cy="${picture.notif.y}" r="${picture.notif.r}" fill="${NOTIF_BLUE}"/>`
		: ''
	face.svg.innerHTML = `<defs><mask id="${uid}" maskUnits="userSpaceOnUse" x="${-VIEW}" y="${-VIEW}" width="${VIEW * 2}" height="${VIEW * 2}"><path d="${picture.bodyPath}" fill="#fff"/>${eyes}${notch}</mask>${grads}</defs><g fill="none" stroke-linecap="round">${arc('back')}</g>${picture.dotsBehind ? dots : ''}<g opacity="${picture.bodyAlpha}"><path d="${picture.bodyPath}" fill="${PAPER}"/><g mask="url(#${uid})"><rect x="${-VIEW}" y="${-VIEW}" width="${VIEW * 2}" height="${VIEW * 2}" fill="${ink}"/></g></g>${picture.dotsBehind ? '' : dots}${notif}<g fill="none" stroke-linecap="round">${arc('front')}</g>`
}
