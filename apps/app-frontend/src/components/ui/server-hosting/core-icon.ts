import { getLoaderIcon } from '@modrinth/assets'
import type { Component } from 'vue'

import type { HostedSoftware } from '@/helpers/hosting'

/** Cores whose logo lives under another loader tag. */
const ALIASES: Partial<Record<HostedSoftware, string>> = {
	craftbukkit: 'bukkit',
	leaves: 'paper',
}

/** The core's icon from the same tag set the modpack creation shows. */
export function coreIconFor(software: HostedSoftware): Component | undefined {
	return getLoaderIcon(ALIASES[software] ?? software)
}
