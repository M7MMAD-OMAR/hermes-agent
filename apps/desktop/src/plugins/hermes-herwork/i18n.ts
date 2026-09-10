/**
 * Plugin-scoped i18n for the HerWork workspace, registered under the plugin id
 * via `ctx.i18n.register` and never touching core locale files (the same shape
 * as `hermes-bots/i18n.ts`). Only strings this plugin owns live here; generic
 * verbs resolve against core.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

export const HERWORK_PLUGIN_ID = 'hermes-herwork'

export type HerworkMessages = {
  /** The sidebar tab beside Sessions and Bots. */
  pane: { title: string }
  /** What an empty HerWork chat shows before the first message. */
  empty: {
    title: string
    desk: string
    rule: string
  }
  /** The desk panel's own sections. */
  desk: {
    newChat: string
    chats: string
    noChats: string
    files: string
    noFiles: string
    filesUnavailable: string
    openFolder: string
    deliverables: string
    noDeliverables: string
    preview: string
    folders: string
    tasks: string
    noTasks: string
    retry: string
  }
}

const en: HerworkMessages = {
  pane: { title: 'HerWork' },
  empty: {
    title: 'HerWork',
    desk: 'A shared desk. Hand over a job and get finished files back.',
    rule: 'Research first, draw the structure, verify by re-opening, deliver with a PDF sibling.'
  },
  desk: {
    newChat: 'New job',
    chats: 'Jobs',
    noChats: 'No jobs yet. Start one above.',
    files: 'Desk',
    noFiles: 'The desk is empty.',
    filesUnavailable: 'The desk folder is not readable yet.',
    openFolder: 'Show in file manager',
    deliverables: 'Delivered',
    noDeliverables: 'Nothing delivered yet. Finished files appear here.',
    preview: 'Preview',
    folders: 'Folders',
    tasks: 'Steps',
    noTasks: 'No steps on the open job.',
    retry: 'Try again'
  }
}

const ar: HerworkMessages = {
  pane: { title: 'هيرورك' },
  empty: {
    title: 'هيرورك',
    desk: 'مكتب مشترك. سلّم المهمة واستلم ملفات منجزة.',
    rule: 'ابحث أولًا، ارسم البنية، تحقق بإعادة الفتح، وسلّم مع نسخة PDF مرافقة.'
  },
  desk: {
    newChat: 'مهمة جديدة',
    chats: 'المهمات',
    noChats: 'ما في مهمات بعد. ابدأ وحدة من فوق.',
    files: 'المكتب',
    noFiles: 'المكتب فاضي.',
    filesUnavailable: 'مجلد المكتب غير متاح للقراءة.',
    openFolder: 'افتح في مدير الملفات',
    deliverables: 'المسلَّمات',
    noDeliverables: 'ما في شي مسلَّم بعد. الملفات المنجزة بتظهر هون.',
    preview: 'معاينة',
    folders: 'المجلدات',
    tasks: 'الخطوات',
    noTasks: 'ما في خطوات على المهمة المفتوحة.',
    retry: 'أعد المحاولة'
  }
}

export const HERWORK_LOCALES: PluginLocaleBundles = { ar, en } as unknown as PluginLocaleBundles

/** Typed access over the plugin translator; keys mirror `HerworkMessages`. */
export function useHerwork(): HerworkMessages {
  const t = usePluginI18n(HERWORK_PLUGIN_ID)

  return useMemo<HerworkMessages>(
    () => ({
      pane: { title: t('pane.title') },
      empty: { title: t('empty.title'), desk: t('empty.desk'), rule: t('empty.rule') },
      desk: {
        newChat: t('desk.newChat'),
        chats: t('desk.chats'),
        noChats: t('desk.noChats'),
        files: t('desk.files'),
        noFiles: t('desk.noFiles'),
        filesUnavailable: t('desk.filesUnavailable'),
        openFolder: t('desk.openFolder'),
        deliverables: t('desk.deliverables'),
        noDeliverables: t('desk.noDeliverables'),
        preview: t('desk.preview'),
        folders: t('desk.folders'),
        tasks: t('desk.tasks'),
        noTasks: t('desk.noTasks'),
        retry: t('desk.retry')
      }
    }),
    [t]
  )
}
