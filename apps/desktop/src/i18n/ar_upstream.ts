import type { TranslationOverrides } from './define-locale'
import { arPlural as plural } from './ar_plural'

/** Arabic for the strings that arrived with the upstream merge of October 2026.
 *  Kept apart from the sectioned files so the next merge can see at a glance
 *  what was translated here and fold it into its section. */
export const arUpstream: TranslationOverrides = {
  externalOpenFailed: {
    missing: {
      title: 'الملف غير موجود',
      message: 'هذا الملف غير موجود، فقد يكون حُذف أو نُقل، أو يكون على جهاز آخر.'
    }
  },
  connectorsPage: {
    add: {
      authOauth: 'تفويض OAuth'
    }
  },
  boot: {
    failure: {
      bundledReinstallHint: 'لا يستطيع هذا التثبيت المضمَّن إصلاح نفسه من داخل التطبيق، أعد تثبيت التطبيق لاستعادة خلفيته.',
      reinstallApp: 'أعد تثبيت التطبيق'
    }
  },
  notifications: {
    compressDeferredDone: 'اكتمل ضغط السياق',
    updateReadyMessageAppInstaller: 'إصدار جديد من Sbar Rafiq جاهز. حدّث الآن وسيتولى Windows إكمال التثبيت عنك.'
  },
  sendDiagnostics: { links: { discord: 'ديسكورد' } },
  keybinds: {
    clear: 'مسح',
    actions: {
      'view.tabSlot.1': 'الانتقال إلى التبويب 1',
      'view.tabSlot.2': 'الانتقال إلى التبويب 2',
      'view.tabSlot.3': 'الانتقال إلى التبويب 3',
      'view.tabSlot.4': 'الانتقال إلى التبويب 4',
      'view.tabSlot.5': 'الانتقال إلى التبويب 5',
      'view.tabSlot.6': 'الانتقال إلى التبويب 6',
      'view.tabSlot.7': 'الانتقال إلى التبويب 7',
      'view.tabSlot.8': 'الانتقال إلى التبويب 8',
      'view.tabSlot.9': 'الانتقال إلى التبويب 9'
    }
  },
  settings: {
    config: {
      keepAwakeOff: 'متوقف',
      keepAwakeWhileWorking: 'أثناء العمل',
      keepAwakeAlways: 'دائمًا',
      alwaysExternalLinksTitle: 'افتح الروابط دائمًا في متصفح خارجي',
      alwaysExternalLinksDesc:
        'افتح كل رابط تنقر عليه في متصفح النظام بدل المتصفح المدمج. يبقى خيار «فتح في المتصفح المدمج» في القائمة السياقية يعمل.'
    },
    model: {
      mainAppliedTitle: 'تم تحديث النموذج الرئيسي',
      mainAppliedMessage: model => `ستستخدم الجلسات الجديدة ${model}.`
    },
    localModels: {
      connectionChanged: 'تغيّر اتصال النماذج المحلية',
      downloadStatusRunning: 'جارٍ التنزيل',
      downloadSpeed: rate => `${rate}`,
      downloadEta: time => `متبقٍ نحو ${time}`,
      downloadEtaSeconds: count => `${count} ث`,
      downloadEtaMinutes: count => `${count} د`,
      downloadEtaHours: (hours, minutes) => (minutes ? `${hours} س ${minutes} د` : `${hours} س`),
      downloadPausedLabel: 'متوقف مؤقتًا',
      downloadPauseAction: 'إيقاف مؤقت',
      downloadResumeAction: 'استئناف',
      downloadPauseFailed: model => `تعذّر إيقاف تنزيل ${model} مؤقتًا`,
      downloadResumeFailed: model => `تعذّر استئناف تنزيل ${model}`
    },
    billing: { state: { notice: { openPortal: 'افتح البوابة ↗' } } }
  },
  skillDeepLink: {
    installTitle: name => `تثبيت «${name}»؟`,
    installDescription: 'ستتوفر هذه المهارة في الجلسات الجديدة. ثبّت من مصادر تثق بها فقط.',
    installTo: 'التثبيت في',
    thisComputer: 'هذا الحاسوب',
    installing: 'جارٍ التثبيت…',
    installComplete: name => `تم تثبيت «${name}»`,
    destinationChanged: 'تغيّرت الوجهة. أغلق هذا الحوار وافتح رابط التثبيت مرة أخرى.',
    installed: 'تم التثبيت',
    source: 'المصدر'
  },
  skills: {
    plugins: {
      toolsetOn: (name, profile) => `تم تفعيل أدوات الوكيل ${name} للملف ${profile}`,
      toolsetOff: (name, profile) => `تم تعطيل أدوات الوكيل ${name} للملف ${profile}`,
      toolsetToggleFailed: name => `تعذّر تبديل أدوات الوكيل ${name}، وتُركت لوحة سطح المكتب دون تغيير`,
      serverStates: {
        hermes_not_connected: 'اتصال MCP مفقود',
        unsupported_gpu: 'وحدة الرسوميات غير مدعومة'
      }
    }
  },
  webhooks: { deliverOptions: { telegram: 'تيليجرام', discord: 'ديسكورد', slack: 'سلاك' } },
  profiles: {
    status: {
      unread: count => (count === 1 ? 'جلسة واحدة غير مقروءة' : `${plural(count, '', '', 'جلسات', 'جلسة')} غير مقروءة`),
      needsInput: count =>
        count === 1 ? 'جلسة واحدة تنتظر إجابتك' : `${plural(count, '', '', 'جلسات', 'جلسة')} تنتظر إجابتك`,
      working: count => (count === 1 ? 'جلسة واحدة قيد التشغيل' : `${plural(count, '', '', 'جلسات', 'جلسة')} قيد التشغيل`)
    }
  },
  cron: { deliveryLabels: { telegram: 'تيليجرام', discord: 'ديسكورد', slack: 'سلاك' } },
  updates: {
    availableBodyAppInstaller:
      'إصدار جديد من Sbar Rafiq جاهز. سيُغلق Sbar Rafiq ويُكمل Windows التحديث ثم يُعاد فتح Sbar Rafiq تلقائيًا.',
    applyingBodyAppInstaller:
      'سيُغلق Sbar Rafiq ويُكمل Windows التحديث. سيُعاد فتح Sbar Rafiq عند الانتهاء، ولا حاجة إلى أي إجراء منك.',
    applyingCloseAppInstaller: 'ستُغلق هذه النافذة ويُكمل Windows التحديث ثم يُعاد فتح Sbar Rafiq تلقائيًا.',
    checkUnknownTitleAppInstaller: 'تعذّر التحقق من التحديثات',
    checkUnknownBodyAppInstaller:
      'تعذّر على Windows التحقق من التحديثات الآن. تُثبَّت التحديثات أيضًا تلقائيًا عند إعادة تشغيل Sbar Rafiq.',
    releaseAvailable: tag => `الإصدار ${tag} متاح.`,
    versionDetailsDistributionStore: 'متجر مايكروسوفت'
  },
  install: {
    setupChoiceDescLocal: 'ثبّت Sbar Rafiq على هذا الحاسوب، أو اتصل ببوابة Sbar Rafiq تشغّلها بالفعل.',
    useLocalTitle: 'استخدم Sbar Rafiq على هذا الحاسوب',
    useLocalDesc: 'بيئة تشغيل Sbar Rafiq مثبّتة هنا بالفعل، شغّلها بنقرة واحدة. لا شيء يُنزَّل.',
    bundledLocalDesc: 'استخدم بيئة تشغيل Sbar Rafiq المرفقة بهذا التطبيق، فالخلفية المضمَّنة هي التثبيت المحلي.'
  },
  preview: { missingTarget: 'هذا المسار غير موجود على هذا الحاسوب' },
  assistant: {
    thread: {
      responseStopped: 'توقفت الاستجابة',
      errorCodes: {
        no_reply: {
          title: 'لم يكتمل الرد',
          body: 'أنهى Sbar Rafiq هذا الدور دون رد. أعد المحاولة لإرساله مرة أخرى.'
        }
      }
    },
    approval: { commandDetails: 'تفاصيل الأمر' },
    clarify: {
      noAnswer: 'لا إجابة',
      notDelivered: 'لم يصل هذا السؤال إلى التطبيق فلا يمكن الإجابة عنه هنا. اضغط إيقاف لإنهاء الدور ثم ردّ في المحادثة.'
    }
  }
}
