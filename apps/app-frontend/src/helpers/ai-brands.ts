/**
 * Значки провайдеров и семейств моделей для выбора модели: цветная плашка с
 * монограммой. Логотипы компаний не копируем — у каждого бренда свой цвет и
 * короткая метка, этого хватает, чтобы глаз находил модель с первого взгляда.
 */
export interface AiBrand {
	key: string
	mark: string
	color: string
}

const PROVIDER_BRANDS: Record<string, AiBrand> = {
	pixi: { key: 'pixi', mark: '', color: '#7c5cff' },
	zai: { key: 'zai', mark: 'Z', color: '#3d7bff' },
	genapi: { key: 'genapi', mark: 'G', color: '#f2793a' },
	kilo: { key: 'kilo', mark: 'K', color: '#e9b422' },
	ovh: { key: 'ovh', mark: 'O', color: '#4b6bff' },
	nvidia: { key: 'nvidia', mark: 'N', color: '#76b900' },
	pollinations: { key: 'pollinations', mark: 'P', color: '#2fbf71' },
	llm7: { key: 'llm7', mark: '7', color: '#a35bf0' },
	openrouter: { key: 'openrouter', mark: 'OR', color: '#6467f2' },
	custom: { key: 'custom', mark: '', color: '#8a94a6' },
}

const MODEL_BRANDS: [RegExp, AiBrand][] = [
	[/glm/i, { key: 'glm', mark: 'Z', color: '#3d7bff' }],
	[/deepseek/i, { key: 'deepseek', mark: 'DS', color: '#4d6bfe' }],
	[/claude/i, { key: 'claude', mark: 'C', color: '#d97757' }],
	[/gemini/i, { key: 'gemini', mark: 'G', color: '#4c8df6' }],
	[/gemma/i, { key: 'gemma', mark: 'Gm', color: '#3f8cf0' }],
	[/gpt|openai/i, { key: 'openai', mark: 'AI', color: '#10a37f' }],
	[/nemotron/i, { key: 'nemotron', mark: 'N', color: '#76b900' }],
	[/qwen/i, { key: 'qwen', mark: 'Q', color: '#615ced' }],
	[/llama/i, { key: 'llama', mark: 'L', color: '#0866ff' }],
	[/mistral|codestral/i, { key: 'mistral', mark: 'M', color: '#fa520f' }],
	[/kimi|moonshot/i, { key: 'kimi', mark: 'K', color: '#5b6b85' }],
	[/minimax/i, { key: 'minimax', mark: 'MM', color: '#e2167e' }],
	[/north|cohere/i, { key: 'cohere', mark: 'Co', color: '#39886b' }],
	[/laguna|poolside/i, { key: 'poolside', mark: 'Ps', color: '#0ea5e9' }],
	[/inkling/i, { key: 'inkling', mark: 'In', color: '#8b5cf6' }],
	[/xing/i, { key: 'xing', mark: 'X', color: '#ef4444' }],
	[/flint/i, { key: 'flint', mark: 'F', color: '#f59e0b' }],
]

const FALLBACK: AiBrand = { key: 'model', mark: '·', color: '#8a94a6' }

export function providerBrand(providerId: string): AiBrand {
	return PROVIDER_BRANDS[providerId] ?? FALLBACK
}

/** Семейство модели по её id и подписи; неизвестная модель берёт значок провайдера. */
export function modelBrand(providerId: string, modelId: string, label = ''): AiBrand {
	if (providerId === 'pixi') return PROVIDER_BRANDS.pixi
	const haystack = `${modelId} ${label}`
	for (const [pattern, brand] of MODEL_BRANDS) if (pattern.test(haystack)) return brand
	return providerBrand(providerId)
}
