<script setup lang="ts">
import type { EditingFile, FileItem, UploadState } from '@modrinth/ui'
import {
	commonMessages,
	defineMessages,
	FilePageLayout,
	injectNotificationManager,
	provideFileManager,
	useVIntl,
} from '@modrinth/ui'
import { computed, ref, watch } from 'vue'

import {
	type HostedServerView,
	hosting_file_create_dir,
	hosting_file_delete,
	hosting_file_items,
	hosting_file_read,
	hosting_file_rename,
	hosting_file_save_as,
	hosting_file_write,
} from '@/helpers/hosting'
import { highlightInFolder } from '@/helpers/utils'

const props = defineProps<{ server: HostedServerView }>()

const { formatMessage } = useVIntl()
const { addNotification } = injectNotificationManager()
const messages = defineMessages({
	saveAs: { id: 'app.server-hosting.files.save-as', defaultMessage: 'Save as…' },
	addingFiles: {
		id: 'app.server-hosting.files.adding',
		defaultMessage: 'Adding files ({completed}/{total})',
	},
})

const serverId = computed(() => props.server.id)
const serverDir = computed(() => props.server.dir)
const items = ref<FileItem[]>([])
const loading = ref(true)
const error = ref<Error | null>(null)
const currentPath = ref('')
const editingFile = ref<EditingFile | null>(null)

// Ответ на старую папку не должен лечь поверх новой, если кликают быстро.
let listing = 0

async function refresh() {
	const ticket = ++listing
	loading.value = true
	try {
		const found = await hosting_file_items(serverId.value, currentPath.value)
		if (ticket !== listing) return
		items.value = found
		error.value = null
	} catch (e) {
		if (ticket !== listing) return
		items.value = []
		error.value =
			e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? e))
	} finally {
		if (ticket === listing) loading.value = false
	}
}

watch(
	serverId,
	() => {
		currentPath.value = ''
		editingFile.value = null
		void refresh()
	},
	{ immediate: true },
)

function joined(name: string) {
	return currentPath.value ? `${currentPath.value}/${name}` : name
}

function errorText(e: unknown) {
	if (e instanceof Error) return e.message
	return String((e as { message?: string })?.message ?? e ?? '')
}

function failed(title: string, e: unknown) {
	addNotification({ title, text: errorText(e), type: 'error' })
}

function navigateTo(path: string) {
	currentPath.value = path.replace(/^\/+/, '')
	void refresh()
}

async function createItem(name: string, type: 'file' | 'directory') {
	try {
		if (type === 'directory') await hosting_file_create_dir(serverId.value, joined(name))
		else await hosting_file_write(serverId.value, joined(name), new Uint8Array(), true)
		await refresh()
	} catch (e) {
		failed(formatMessage(commonMessages.createFailedLabel), e)
	}
}

async function renameItem(path: string, newName: string) {
	const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
	try {
		await hosting_file_rename(serverId.value, path, parent ? `${parent}/${newName}` : newName)
		await refresh()
	} catch (e) {
		failed(formatMessage(commonMessages.renameFailedLabel), e)
	}
}

async function moveItem(source: string, destination: string) {
	try {
		await hosting_file_rename(serverId.value, source, destination)
		await refresh()
	} catch (e) {
		failed(formatMessage(commonMessages.moveFailedLabel), e)
	}
}

async function deleteItem(path: string) {
	try {
		await hosting_file_delete(serverId.value, path)
		await refresh()
	} catch (e) {
		failed(formatMessage(commonMessages.deleteFailedLabel), e)
	}
}

async function readFile(path: string) {
	const bytes = await hosting_file_read(serverId.value, path)
	return new TextDecoder().decode(new Uint8Array(bytes))
}

async function readFileAsBlob(path: string) {
	const bytes = await hosting_file_read(serverId.value, path)
	return new Blob([new Uint8Array(bytes)])
}

async function writeFile(path: string, content: string) {
	await hosting_file_write(serverId.value, path, new TextEncoder().encode(content))
}

async function downloadFile(path: string) {
	try {
		await hosting_file_save_as(serverId.value, path)
	} catch (e) {
		failed(formatMessage(commonMessages.downloadFailedLabel), e)
	}
}

const uploadState = ref<UploadState>({
	isUploading: false,
	currentFileName: null,
	currentFileProgress: 0,
	uploadedBytes: 0,
	totalBytes: 0,
	completedFiles: 0,
	totalFiles: 0,
})

async function uploadFiles(files: File[]) {
	if (files.length === 0) return
	uploadState.value = {
		isUploading: true,
		currentFileName: '',
		currentFileProgress: 0,
		uploadedBytes: 0,
		totalBytes: files.reduce((sum, file) => sum + file.size, 0),
		completedFiles: 0,
		totalFiles: files.length,
	}
	try {
		for (const file of files) {
			uploadState.value.currentFileName = file.name
			const bytes = new Uint8Array(await file.arrayBuffer())
			await hosting_file_write(serverId.value, joined(file.name), bytes)
			uploadState.value.completedFiles++
			uploadState.value.uploadedBytes += file.size
			uploadState.value.currentFileProgress = 1
		}
	} catch (e) {
		failed(formatMessage(commonMessages.uploadFailedLabel), e)
	} finally {
		uploadState.value.isUploading = false
		await refresh()
	}
}

provideFileManager({
	items,
	loading,
	error,
	currentPath,
	navigateTo,
	editingFile,
	startEditing: (file) => {
		editingFile.value = file
	},
	stopEditing: () => {
		editingFile.value = null
	},
	createItem,
	renameItem,
	moveItem,
	deleteItem,
	readFile,
	readFileAsBlob,
	writeFile,
	downloadFile,
	uploadFiles,
	uploadState,
	refresh: () => void refresh(),
	basePath: serverDir,
	openInFolder: (path: string) => highlightInFolder(path),
	downloadButtonLabel: formatMessage(messages.saveAs),
	uploadingLabel: (completed, total) => formatMessage(messages.addingFiles, { completed, total }),
})
</script>

<template>
	<FilePageLayout :show-refresh-button="true" />
</template>
