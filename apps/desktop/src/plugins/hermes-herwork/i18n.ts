/**
 * Plugin-scoped i18n for the HerWork workspace, registered under the plugin id
 * via `ctx.i18n.register` and never touching core locale files (the same shape
 * as `hermes-bots/i18n.ts`). Only strings this plugin owns live here; generic
 * verbs resolve against core.
 */

import { type PluginLocaleBundles, type PluginTranslate, usePluginI18n } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

export const HERWORK_PLUGIN_ID = 'hermes-herwork'

type HerworkMessages = {
  /** The sidebar tab beside Sessions and Bots. */
  pane: { title: string }
  /** What an empty HerWork chat shows before the first message. */
  empty: {
    title: string
    desk: string
    inbox: (count: number) => string
    output: (count: number) => string
    rule: string
  }
}

const en: HerworkMessages = {
  pane: { title: 'HerWork' },
  empty: {
    title: 'HerWork',
    desk: 'A shared desk. Hand over a job and get finished files back.',
    inbox: count => (count === 1 ? '1 file in inbox' : `${count} files in inbox`),
    output: count => (count === 1 ? '1 deliverable in output' : `${count} deliverables in output`),
    rule: 'Research first, draw the structure, verify by re-opening, deliver with a PDF sibling.'
  }
}

const ar: HerworkMessages = {
  pane: { title: 'هيرورك' },
  empty: {
    title: 'هيرورك',
    desk: 'مكتب مشترك. سلّم المهمة واستلم ملفات منجزة.',
    inbox: count => (count === 1 ? 'ملف واحد في الوارد' : `${count} ملفات في الوارد`),
    output: count => (count === 1 ? 'مخرج واحد في المخرجات' : `${count} مخرجات في المخرجات`),
    rule: 'ابحث أولًا، ارسم البنية، تحقق بإعادة الفتح، وسلّم مع نسخة PDF مرافقة.'
  }
}

export const HERWORK_LOCALES: PluginLocaleBundles = { ar, en } as unknown as PluginLocaleBundles

/** Typed access over the plugin translator; keys mirror `HerworkMessages`. */
export function useHerwork(): { t: PluginTranslate; m: HerworkMessages } {
  const t = usePluginI18n(HERWORK_PLUGIN_ID)

  const m = useMemo<HerworkMessages>(
    () => ({
      pane: { title: t('pane.title') },
      empty: {
        title: t('empty.title'),
        desk: t('empty.desk'),
        inbox: count => t('empty.inbox', count),
        output: count => t('empty.output', count),
        rule: t('empty.rule')
      }
    }),
    [t]
  )

  return { m, t }
}
