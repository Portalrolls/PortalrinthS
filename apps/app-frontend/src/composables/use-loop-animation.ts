import { ref, watch } from 'vue'

/**
 * Loop Animation: то, что под курсором, чуть вырастает, а соседи по той же
 * панели — кнопки, ссылки, вкладки — немного уходят назад. Сам эффект описан в
 * portalrinth-motion.css под классом на <html>; здесь только выбор игрока.
 */
const KEY = 'portalrinth.loop-animation'
const CLASS = 'pr-loop-anim'

function read(): boolean {
	try {
		return localStorage.getItem(KEY) === 'true'
	} catch {
		return false
	}
}

export const loopAnimation = ref(read())

export function setLoopAnimation(on: boolean): void {
	loopAnimation.value = on
	try {
		localStorage.setItem(KEY, on ? 'true' : 'false')
	} catch {
		// не сохранилось — работает до закрытия окна
	}
}

watch(loopAnimation, (on) => document.documentElement.classList.toggle(CLASS, on), {
	immediate: true,
})
