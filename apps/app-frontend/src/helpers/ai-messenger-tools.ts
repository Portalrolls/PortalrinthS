/**
 * Руки агента в MC Messenger: чаты, группы, каналы, роли, участники,
 * сообщения, файлы и картинки. Всё через те же функции store, что и
 * интерфейс — никаких параллельных протоколов.
 */
import * as fs from '@tauri-apps/plugin-fs'

import { channelIcon, setChannelIcon } from '../components/ui/messenger/channel-icons'
import type { Conversation, Peer } from '../components/ui/messenger/model'
import { MAX_FILE_BYTES, mimeFor } from '../components/ui/messenger/model'
import type { PendingAttachment } from '../components/ui/messenger/store'
import {
	addMembers,
	blockUser,
	createInvite,
	createRole,
	createServer,
	deleteRole,
	dmWith,
	kickMember,
	loadConversation,
	loadStructure,
	requestFriend,
	saveChannel,
	sendMessage,
	startDm,
	state,
	toggleMemberRole,
	updateServer,
} from '../components/ui/messenger/store'
import { registerAiToolHandler } from './ai-assistant'
import { bytesToBase64, sandboxAbsolutePath } from './ai-sandbox'
import { proxiedFetch } from './proxy-fetch'

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i
const UA = 'Undefined-Client'

const COLORS: Record<string, string> = {
	красный: '#ed4245',
	оранжевый: '#e67e22',
	жёлтый: '#fee75c',
	зелёный: '#57f287',
	голубой: '#5ac8fa',
	синий: '#5865f2',
	фиолетовый: '#eb459e',
	розовый: '#eb459e',
	белый: '#ffffff',
	серый: '#99aab5',
	чёрный: '#23272a',
	золотой: '#faa61a',
}

function normalizeColor(value: string): string {
	const raw = value.trim()
	if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
	return COLORS[raw.toLowerCase()] || '#99aab5'
}

function normalize(value: string): string {
	return value.trim().toLowerCase().replace(/^@/, '')
}

/** Все знакомые люди: друзья, участники бесед, кэш пользователей. */
function people(): Peer[] {
	const map = new Map<string, Peer>()
	for (const peer of state.friends) if (peer.id) map.set(peer.id, peer)
	for (const conv of state.conversations) {
		if (conv.peer) map.set(conv.peer.id, conv.peer)
		for (const member of conv.members) if (member.id) map.set(member.id, member)
	}
	for (const peer of Object.values(state.users)) if (peer?.id) map.set(peer.id, peer)
	return [...map.values()]
}

function findUser(query: string): Peer | null {
	const needle = normalize(query)
	if (!needle) return null
	const pool = people()
	const exactId = pool.find((peer) => peer.id === needle)
	if (exactId) return exactId
	return (
		pool.find((peer) => normalize(peer.username) === needle) ||
		pool.find((peer) => normalize(peer.username).startsWith(needle)) ||
		pool.find((peer) => normalize(peer.username).includes(needle)) ||
		null
	)
}

function firstTextChannel(convId: string): string {
	const channels = state.structures[convId]?.channels ?? []
	return channels.find((channel) => channel.kind === 'text')?.id ?? ''
}

function targetChannel(conv: Conversation): string {
	if (conv.dm || conv.project) return ''
	const chosen = state.serverChannel[conv.id]
	if (chosen) return chosen
	return firstTextChannel(conv.id)
}

/** Куда писать: «@ник» — ЛС, «Название» — группа/сервер/ЛС по имени, «Название#канал» — канал сервера. */
async function findTarget(query: string): Promise<Conversation | null> {
	const raw = query.trim()
	if (!raw) return null
	if (raw.startsWith('@')) {
		const user = findUser(raw.slice(1))
		if (!user) return null
		return dmWith(user.id) ?? (await startDm(user))
	}
	let convQuery = raw
	let channelQuery = ''
	const hash = raw.indexOf('#')
	if (hash > 0) {
		convQuery = raw.slice(0, hash).trim()
		channelQuery = raw.slice(hash + 1).trim()
	}
	const needle = normalize(convQuery)
	const conv =
		state.conversations.find((entry) => normalize(entry.title) === needle && !entry.dm) ||
		state.conversations.find((entry) => normalize(entry.title).includes(needle) && !entry.dm) ||
		state.conversations.find((entry) => entry.peer && normalize(entry.peer.username) === needle) ||
		state.conversations.find(
			(entry) => entry.peer && normalize(entry.peer.username).includes(needle),
		) ||
		null
	if (!conv) return null
	if (channelQuery) {
		await loadStructure(conv.id)
		const channels = state.structures[conv.id]?.channels ?? []
		const channel =
			channels.find((entry) => normalize(entry.name) === normalize(channelQuery)) ||
			channels.find((entry) => normalize(entry.name).includes(normalize(channelQuery)))
		if (!channel) return null
		state.serverChannel[conv.id] = channel.id
	}
	return conv
}

async function attachmentFromBytes(
	name: string,
	mime: string,
	bytes: Uint8Array,
): Promise<PendingAttachment | string> {
	if (bytes.byteLength > MAX_FILE_BYTES) {
		return `«${name}» весит ${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ — больше лимита 1 ГБ`
	}
	const blob = new Blob([bytes], { type: mimeFor(name, mime) })
	return {
		name,
		mime: mimeFor(name, mime),
		size: bytes.byteLength,
		dataBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
		preview: '',
	}
}

/** Файл или картинка: из интернета (URL) или из песочницы (путь). */
async function attachmentFromSource(
	source: string,
	forcedName: string,
): Promise<PendingAttachment | string> {
	const raw = source.trim()
	if (/^https?:\/\//i.test(raw)) {
		const url = new URL(raw)
		let name =
			forcedName.trim() ||
			decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'file')
		if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
			const typeHint = raw.match(/\.(png|jpe?g|webp|gif|mp4|webm|pdf|zip|mrpack)(?:[?#]|$)/i)
			name += typeHint ? `.${typeHint[1]}` : '.bin'
		}
		const response = await proxiedFetch(raw, {
			headers: { 'User-Agent': UA },
			connectTimeout: 20000,
		})
		if (!response.ok) return `Скачивание не удалось: HTTP ${response.status}`
		const bytes = new Uint8Array(await response.arrayBuffer())
		const type = response.headers.get('content-type') || ''
		return attachmentFromBytes(
			name,
			IMAGE_EXT.test(name) || type.startsWith('image/') ? mimeFor(name, type) : type,
			bytes,
		)
	}
	const path = await sandboxAbsolutePath(raw)
	let name = forcedName.trim() || raw.split(/[\\/]/).pop() || 'file'
	if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += path.match(/(\.[a-z0-9]{1,8})$/i)?.[1] ?? ''
	const bytes = new Uint8Array(await fs.readFile(path))
	return attachmentFromBytes(name, '', bytes)
}

async function sendPayload(
	where: string,
	body: string,
	attachment: PendingAttachment | null,
): Promise<string> {
	const conv = await findTarget(where)
	if (!conv) {
		return `Не нашёл чат «${where}». Загляни в messenger_chats — там точные имена: «@ник» для ЛС, «Название» для группы/сервера, «Название#канал» для канала.`
	}
	const ok = await sendMessage({
		body,
		attachment,
		convId: conv.id,
		channelId: targetChannel(conv),
	})
	if (!ok) return `Не отправилось в «${conv.title || 'чат'}» — сервис отказал, попробуй ещё раз`
	return attachment
		? `Отправил вложение «${attachment.name}» в ${conv.dm ? 'ЛС' : 'чат'} «${conv.title}»`
		: `Отправил сообщение в ${conv.dm ? 'ЛС' : 'чат'} «${conv.title}»`
}

function conversationLine(conv: Conversation): string {
	if (conv.dm && conv.peer) return `- @${conv.peer.username} (ЛС, id: ${conv.id})`
	const kind = conv.project ? 'проект' : 'сервер/группа'
	const channels = (state.structures[conv.id]?.channels ?? [])
		.filter((channel) => channel.kind === 'text')
		.map(
			(channel) =>
				`#${channel.name}${channelIcon(channel.id) ? ` [${channelIcon(channel.id)}]` : ''}`,
		)
	return `- «${conv.title}» (${kind}, id: ${conv.id}, участников: ${conv.members.length}${
		channels.length ? `, каналы: ${channels.join(', ')}` : ''
	})`
}

registerAiToolHandler(async (tool, args) => {
	try {
		switch (tool) {
			case 'messenger_chats': {
				await loadLists()
				const lines = state.conversations.map(conversationLine)
				return lines.length
					? `Чаты игрока (для messenger_send: «@ник», «Название», «Название#канал»):\n${lines.join('\n')}`
					: 'Чатов нет — есть только окно друзей. Можно создать группу через messenger_group'
			}
			case 'messenger_channels': {
				const conv = await findTarget(args)
				if (!conv) return `Не нашёл сервер/группу «${args}» — точные имена в messenger_chats`
				await loadStructure(conv.id)
				const channels = (state.structures[conv.id]?.channels ?? []).map(
					(channel) =>
						`- ${channel.kind === 'voice' ? '🔊' : '#'}${channel.name}${
							channel.topic ? ` — ${channel.topic}` : ''
						}${channelIcon(channel.id) ? ` [иконка ${channelIcon(channel.id)}]` : ''} (id: ${channel.id})`,
				)
				return `Каналы «${conv.title}»:\n${channels.join('\n') || '(нет каналов)'}`
			}
			case 'messenger_send': {
				const separator = args.indexOf('::')
				if (separator < 0) return 'Формат: <<messenger_send|куда::текст>>'
				return await sendPayload(args.slice(0, separator), args.slice(separator + 2).trim(), null)
			}
			case 'messenger_group': {
				const [title, description = '', membersRaw = ''] = args
					.split('::')
					.map((part) => part.trim())
				if (!title) return 'Формат: <<messenger_group|Название::описание::ник1, ник2>>'
				const created = await createServer(title, description, '')
				if (!created) return 'Сервис не создал группу'
				const names = membersRaw
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean)
				const ids: string[] = []
				for (const name of names) {
					const user = findUser(name)
					if (user) ids.push(user.id)
				}
				if (ids.length) await addMembers(created.id, ids)
				return `Группа «${title}» создана${ids.length ? `, приглашены: ${names.join(', ')}` : ''}. Пиши туда: <<messenger_send|${title}::текст>>`
			}
			case 'messenger_channel': {
				const [server, name, topic = '', kindRaw = 'text'] = args
					.split('::')
					.map((part) => part.trim())
				const conv = await findTarget(server)
				if (!conv) return `Не нашёл сервер «${server}» — точные имена в messenger_chats`
				if (!name) return 'Формат: <<messenger_channel|сервер::название::тема::text|voice>>'
				const kind = kindRaw === 'voice' ? 'voice' : 'text'
				await loadStructure(conv.id)
				const existing = (state.structures[conv.id]?.channels ?? []).find(
					(channel) => normalize(channel.name) === normalize(name),
				)
				const ok = await saveChannel(conv.id, existing?.id ?? null, {
					name,
					topic,
					kind,
				})
				return ok
					? `${existing ? 'Обновил' : 'Создал'} канал ${kind === 'voice' ? '🔊' : '#'}${name} в «${conv.title}»`
					: 'Сервис не сохранил канал — проверь права (нужны права управления каналами)'
			}
			case 'messenger_icon': {
				const [server, channelName, emoji] = args.split('::').map((part) => part.trim())
				const conv = await findTarget(server)
				if (!conv) return `Не нашёл сервер «${server}»`
				if (!emoji)
					return 'Формат: <<messenger_icon|сервер::канал::эмодзи>> (пустой эмодзи — убрать иконку)'
				await loadStructure(conv.id)
				const channels = state.structures[conv.id]?.channels ?? []
				const channel =
					channels.find((entry) => normalize(entry.name) === normalize(channelName || '')) ||
					channels.find((entry) => normalize(entry.name).includes(normalize(channelName || '')))
				if (!channel)
					return `Канал «${channelName}» в «${conv.title}» не найден — список в messenger_channels`
				setChannelIcon(channel.id, emoji)
				return `Канал #${channel.name} теперь с иконкой ${emoji} (видна всем на этом устройстве)`
			}
			case 'messenger_role': {
				const [server, name, colorRaw = '', memberRaw = ''] = args
					.split('::')
					.map((part) => part.trim())
				const conv = await findTarget(server)
				if (!conv || !name)
					return 'Формат: <<messenger_role|сервер::имя роли::цвет::ник (ник и цвет необязательны)>>'
				const color = normalizeColor(colorRaw)
				const created = await createRole(conv.id, name, color)
				if (!created) return 'Сервис не создал роль — нужны права управления ролями'
				await loadConversation(conv.id)
				const fresh = state.conversations.find((entry) => entry.id === conv.id)
				const role = fresh?.roles.find((entry) => normalize(entry.name) === normalize(name))
				if (!role) return `Роль «${name}» создана (цвет ${color}), но найти её для выдачи не вышло`
				if (memberRaw) {
					const member = findUser(memberRaw)
					if (!member) return `Роль «${name}» создана, но игрока «${memberRaw}» не нашёл`
					const ok = await toggleMemberRole(conv.id, member.id, role.id, true)
					return ok
						? `Роль «${name}» (${color}) создана и выдана ${member.username}`
						: `Роль «${name}» создана, но выдать ${member.username} не вышло`
				}
				return `Роль «${name}» (${color}) создана в «${conv.title}»`
			}
			case 'messenger_role_off': {
				const [server, memberRaw, roleName] = args.split('::').map((part) => part.trim())
				const conv = await findTarget(server)
				const member = memberRaw ? findUser(memberRaw) : null
				if (!conv || !member || !roleName) return 'Формат: <<messenger_role_off|сервер::ник::роль>>'
				const role = conv.roles.find((entry) => normalize(entry.name) === normalize(roleName))
				if (!role) return `Роль «${roleName}» в «${conv.title}» не найдена`
				const ok = await toggleMemberRole(conv.id, member.id, role.id, false)
				return ok ? `Снял роль «${role.name}» с ${member.username}` : 'Сервис не снял роль'
			}
			case 'messenger_role_del': {
				const [server, roleName] = args.split('::').map((part) => part.trim())
				const conv = await findTarget(server)
				if (!conv || !roleName) return 'Формат: <<messenger_role_del|сервер::роль>>'
				const role = conv.roles.find((entry) => normalize(entry.name) === normalize(roleName))
				if (!role)
					return `Роль «${roleName}» не найдена — роли сервера: ${conv.roles.map((entry) => entry.name).join(', ') || 'нет'}`
				const ok = await deleteRole(conv.id, role.id)
				return ok ? `Роль «${role.name}» удалена` : 'Сервис не удалил роль'
			}
			case 'messenger_kick': {
				const [server, memberRaw] = args.split('::').map((part) => part.trim())
				const conv = await findTarget(server)
				const member = memberRaw ? findUser(memberRaw) : null
				if (!conv || !member) return 'Формат: <<messenger_kick|сервер::ник>>'
				const ok = await kickMember(conv.id, member.id)
				return ok
					? `${member.username} исключён из «${conv.title}»`
					: `Не вышло исключить ${member.username} — нужны права`
			}
			case 'messenger_ban': {
				const memberRaw = args.trim()
				const member = memberRaw ? findUser(memberRaw) : null
				if (!member)
					return 'Формат: <<messenger_ban|ник>> — вносит игрока в чёрный список (у серверов бан = кик + чёрный список)'
				const ok = await blockUser(member.id)
				return ok
					? `${member.username} в чёрном списке`
					: `Не вышло заблокировать ${member.username}`
			}
			case 'messenger_add': {
				const [server, membersRaw] = args.split('::').map((part) => part.trim())
				const conv = await findTarget(server)
				if (!conv || !membersRaw) return 'Формат: <<messenger_add|сервер::ник1, ник2>>'
				const ids: string[] = []
				const names: string[] = []
				for (const name of membersRaw
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean)) {
					const user = findUser(name)
					if (user) ids.push(user.id)
					names.push(user?.username ?? name)
				}
				if (!ids.length) return `Игроков «${membersRaw}» не нашёл`
				const ok = await addMembers(conv.id, ids)
				return ok
					? `Добавил в «${conv.title}»: ${names.join(', ')}`
					: 'Сервис не добавил участников'
			}
			case 'messenger_server_edit': {
				const [server, title = '', description = '', avatarRaw = ''] = args
					.split('::')
					.map((part) => part.trim())
				const conv = await findTarget(server)
				if (!conv) return `Не нашёл сервер «${server}»`
				const patch: Record<string, string> = {}
				if (title) patch.title = title
				if (description) patch.description = description
				if (avatarRaw) {
					const source = await attachmentFromSource(avatarRaw, 'avatar')
					if (typeof source === 'string') return source
					patch.avatarDataUrl = `data:${source.mime};base64,${source.dataBase64}`
				}
				if (!Object.keys(patch).length)
					return 'Формат: <<messenger_server_edit|сервер::новое название::описание::ссылка на аватарку (необяз)>>'
				const ok = await updateServer(conv.id, patch)
				return ok
					? `Обновил «${conv.title}»: ${Object.keys(patch).join(', ')}`
					: 'Сервис не применил изменения — нужны права'
			}
			case 'messenger_file': {
				const [where, source, name = ''] = args.split('::').map((part) => part.trim())
				if (!where || !source)
					return 'Формат: <<messenger_file|куда::путь-в-песочнице-или-URL::имя (необяз)>>'
				const attachment = await attachmentFromSource(source, name)
				if (typeof attachment === 'string') return attachment
				return await sendPayload(where, '', attachment)
			}
			case 'messenger_picture': {
				const [where, source] = args.split('::').map((part) => part.trim())
				if (!where || !source) return 'Формат: <<messenger_picture|куда::URL картинки>>'
				const attachment = await attachmentFromSource(source, '')
				if (typeof attachment === 'string') return attachment
				if (
					!/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(attachment.name) &&
					!attachment.mime.startsWith('image/')
				) {
					return `«${attachment.name}» не похожа на картинку — для файлов используй messenger_file`
				}
				return await sendPayload(where, '', attachment)
			}
			case 'messenger_card': {
				const [where, target] = args.split('::').map((part) => part.trim())
				if (!where || !target)
					return 'Формат: <<messenger_card|куда::user:id_или_ник>> или <<messenger_card|куда::group:id>>'
				if (/^(user|profile):/i.test(target)) {
					const id = target.slice(target.indexOf(':') + 1).trim()
					const user = findUser(id)
					return await sendPayload(where, `[[profile:${user?.id ?? id}]]`, null)
				}
				if (/^group:/i.test(target)) {
					return await sendPayload(
						where,
						`[[group:${target.slice(target.indexOf(':') + 1).trim()}]]`,
						null,
					)
				}
				return 'Кто: user:id (или ник) — карточка игрока, group:id — карточка группы'
			}
			case 'messenger_friend': {
				const member = findUser(args)
				if (!member) return `Игрока «${args}» не нашёл`
				const ok = await requestFriend(member.id)
				return ok
					? `Заявка в друзья отправлена: ${member.username}`
					: `Не вышло отправить заявку ${member.username}`
			}
			case 'messenger_invite': {
				const conv = await findTarget(args)
				if (!conv) return `Не нашёл сервер «${args}»`
				const invite = await createInvite(conv.id, 0, 0)
				return invite ? `Инвайт в «${conv.title}»: код ${invite.token}` : 'Сервис не выдал инвайт'
			}
		}
	} catch (error) {
		return `Не получилось: ${String(error).slice(0, 240)}`
	}
	return null
})
