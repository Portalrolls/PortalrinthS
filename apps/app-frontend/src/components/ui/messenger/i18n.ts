import { useVIntl } from '@modrinth/ui'

export type Translate = (id: string, fallback: string, values?: Record<string, unknown>) => string

/** t('app.messenger.key', 'Русский текст') — как на остальных страницах мессенджера. */
export function useMessengerT(): Translate {
	const { formatMessage } = useVIntl()
	return (id, fallback, values) => formatMessage({ id, defaultMessage: fallback }, values as never)
}
