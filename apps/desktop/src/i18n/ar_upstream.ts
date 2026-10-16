import type { TranslationOverrides } from './define-locale'
import { arPlural as plural } from './ar_plural'

/** Local-only strings: translations of the keys this fork adds on top of upstream,
 *  merged over the locale by `ar.ts`. Upstream copy lives in the sectioned files. */
export const arUpstream: TranslationOverrides = {
  statusStack: {
    control: {
      dueWaitingForIdle: 'حان موعده، في انتظار الخمول'
    }
  },
  externalOpenFailed: {
    missing: {
      title: 'الملف غير موجود',
      message: 'هذا الملف غير موجود، فقد يكون حُذف أو نُقل، أو يكون على جهاز آخر.'
    }
  },
  sendDiagnostics: {
    links: {
      discord: 'ديسكورد'
    }
  },
  boot: {
    failure: {
      bundledReinstallHint:
        'لا يستطيع هذا التثبيت المضمَّن إصلاح نفسه من داخل التطبيق، أعد تثبيت التطبيق لاستعادة خلفيته.',
      reinstallApp: 'أعد تثبيت التطبيق'
    }
  },
  notifications: {
    native: {
      inputTitleNamed: session => `مطلوب إدخال: ${session}`
    },
    compressDeferredDone: 'اكتمل ضغط السياق',
    updateReadyMessageAppInstaller: 'إصدار جديد من Sbar Rafiq جاهز. حدّث الآن وسيتولى Windows إكمال التثبيت عنك.'
  },
  keybinds: {
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
    },
    clear: 'مسح'
  },
  settings: {
    nav: {
      billing: 'الفوترة',
      providerCustomEndpoints: 'نقاط النهاية المخصصة',
      providerLocalModels: 'النماذج المحلية'
    },
    plugins: {
      installModal: {
        profileLabel: 'التثبيت للملف الشخصي'
      }
    },
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
    customEndpoints: {
      endpointReachableModels: (reachable, count) =>
        `${reachable} عُثر على ${plural(count, 'نموذج واحد', 'نموذجين', 'نماذج', 'نموذجًا')}.`
    },
    billing: {
      state: {
        notice: {
          openPortal: 'افتح البوابة ↗'
        }
      }
    }
  },
  skills: {
    plugins: {
      serverStates: {
        hermes_not_connected: 'اتصال MCP مفقود',
        unsupported_gpu: 'وحدة الرسوميات غير مدعومة'
      },
      toolsetOn: (name, profile) => `تم تفعيل أدوات الوكيل ${name} للملف ${profile}`,
      toolsetOff: (name, profile) => `تم تعطيل أدوات الوكيل ${name} للملف ${profile}`,
      toolsetToggleFailed: name => `تعذّر تبديل أدوات الوكيل ${name}، وتُركت لوحة سطح المكتب دون تغيير`
    }
  },
  profiles: {
    status: {
      unread: count => (count === 1 ? 'جلسة واحدة غير مقروءة' : `${plural(count, '', '', 'جلسات', 'جلسة')} غير مقروءة`),
      needsInput: count =>
        count === 1 ? 'جلسة واحدة تنتظر إجابتك' : `${plural(count, '', '', 'جلسات', 'جلسة')} تنتظر إجابتك`,
      working: count =>
        count === 1 ? 'جلسة واحدة قيد التشغيل' : `${plural(count, '', '', 'جلسات', 'جلسة')} قيد التشغيل`
    }
  },
  cron: {
    deliveryLabels: {
      telegram: 'تيليجرام',
      discord: 'ديسكورد',
      slack: 'سلاك'
    }
  },
  updates: {
    versionDetailsDistributionStore: 'متجر مايكروسوفت',
    availableBodyAppInstaller:
      'إصدار جديد من Sbar Rafiq جاهز. سيُغلق Sbar Rafiq ويُكمل Windows التحديث ثم يُعاد فتح Sbar Rafiq تلقائيًا.',
    applyingBodyAppInstaller:
      'سيُغلق Sbar Rafiq ويُكمل Windows التحديث. سيُعاد فتح Sbar Rafiq عند الانتهاء، ولا حاجة إلى أي إجراء منك.',
    applyingCloseAppInstaller: 'ستُغلق هذه النافذة ويُكمل Windows التحديث ثم يُعاد فتح Sbar Rafiq تلقائيًا.',
    checkUnknownTitleAppInstaller: 'تعذّر التحقق من التحديثات',
    checkUnknownBodyAppInstaller:
      'تعذّر على Windows التحقق من التحديثات الآن. تُثبَّت التحديثات أيضًا تلقائيًا عند إعادة تشغيل Sbar Rafiq.',
    releaseAvailable: tag => `الإصدار ${tag} متاح.`
  },
  install: {
    setupChoiceDescLocal: 'ثبّت Sbar Rafiq على هذا الحاسوب، أو اتصل ببوابة Sbar Rafiq تشغّلها بالفعل.',
    useLocalTitle: 'استخدم Sbar Rafiq على هذا الحاسوب',
    useLocalDesc: 'بيئة تشغيل Sbar Rafiq مثبّتة هنا بالفعل، شغّلها بنقرة واحدة. لا شيء يُنزَّل.',
    bundledLocalDesc: 'استخدم بيئة تشغيل Sbar Rafiq المرفقة بهذا التطبيق، فالخلفية المضمَّنة هي التثبيت المحلي.'
  },
  preview: {
    missingTarget: 'هذا المسار غير موجود على هذا الحاسوب'
  },
  assistant: {
    thread: {
      errorCodes: {
        no_reply: {
          title: 'لم يكتمل الرد',
          body: 'أنهى Sbar Rafiq هذا الدور دون رد. أعد المحاولة لإرساله مرة أخرى.'
        }
      },
      responseStopped: 'توقفت الاستجابة'
    },
    approval: {
      commandDetails: 'تفاصيل الأمر'
    },
    clarify: {
      skipped: 'تم التخطي',
      noAnswer: 'لا إجابة',
      notDelivered:
        'لم يصل هذا السؤال إلى التطبيق فلا يمكن الإجابة عنه هنا. اضغط إيقاف لإنهاء الدور ثم ردّ في المحادثة.'
    }
  },
  threads: {
    close: 'إغلاق المسارات',
    title: 'المسارات',
    subtitle: 'عمل تابع بعد انتهاء الدور.',
    emptyTitle: 'لا توجد مسارات بعد',
    emptyDesc: 'عندما تفوّض هذه المحادثة عملاً في الخلفية، يظهر كل مسار هنا بنصه الخاص.',
    working: 'قيد العمل',
    workingDesc: 'يعمل الآن.',
    resolved: 'منتهية',
    resolvedDesc: 'المسارات المكتملة تُحفظ هنا.',
    failed: 'متعثرة',
    failedDesc: 'توقفت قبل أن تكتمل.',
    waiting: 'بانتظارك',
    waitingDesc: 'قرارات ومراجعات وأذونات لا يعطيها غيرك.',
    live: 'حي',
    subagents: 'وكلاء فرعيون',
    messages: 'الرسائل',
    tools: 'استدعاءات الأدوات',
    model: 'النموذج',
    started: 'البداية',
    openThread: 'فتح المسار',
    backToThreads: 'العودة إلى المسارات',
    transcript: 'النص',
    transcriptTail: 'تُعرض أحدث الرسائل.',
    transcriptEmpty: 'لم يكتب هذا المسار شيئاً بعد.',
    transcriptFailed: 'تعذّرت قراءة هذا المسار.',
    steerPlaceholder: 'وجّه هذا المسار...',
    steerSend: 'أرسل إلى المسار',
    steerSent: 'أُرسلت إلى المسار.',
    steerFailed: 'تعذّر الوصول إلى هذا المسار.',
    steerUnavailable: 'انتهى هذا المسار، فلا شيء لتوجيهه.',
    routedTo: 'أُرسلت إلى المسار',
    routeUndo: 'تراجع',
    refresh: 'تحديث المسارات',
    loading: 'تجري قراءة المسارات...'
  },
  projectWorkflows: {
    title: 'قوالب عمل المشروع',
    hint: 'جهّز مسودة مهمة جديدة ضمن المشروع، ثم راجعها وأرسلها من المحادثة.',
    workflow: 'نوع العمل',
    approach: 'طريقة التنفيذ',
    approachHint: 'تحدد نطاق العمل والفحوصات، دون تغيير إعدادات النموذج أو إيقاف المهمة بمؤقت.',
    task: 'صف النتيجة التي تحتاجها',
    preparing: 'جارٍ تجهيز المسودة…',
    openDraft: 'فتح مسودة المهمة',
    names: {
      'quick-ui': 'تعديل واجهة سريع',
      'client-delivery': 'تسليم للعميل',
      research: 'بحث للمشروع',
      'weekly-review': 'مراجعة أسبوعية'
    },
    descriptions: {
      'quick-ui': 'عدّل الواجهة المطلوبة وتحقق منها في المتصفح.',
      'client-delivery': 'جهّز ملفات التسليم وتحقق منها قبل المشاركة.',
      research: 'ابحث بمصادر واضحة وبيّن ما لم يتم التأكد منه.',
      'weekly-review': 'راجع هذا المشروع واقترح أولويات الأسبوع القادم.'
    },
    approaches: {
      quick: 'سريعة',
      standard: 'متوازنة',
      thorough: 'معمقة'
    }
  },
  projectActions: {
    title: 'إجراءات المستندات',
    hint: 'راجع الاقتراحات الموثقة قبل حفظ المهام. المهام المقبولة تنتظر الجدولة اليدوية على اللوحة المشتركة.',
    source: 'اختر مستنداً مفهرساً',
    extract: 'تحضير مهمة الاستخراج',
    refresh: 'تحديث الاقتراحات',
    empty: 'لا توجد اقتراحات بعد',
    owner: 'المسؤول، إن كان معروفاً',
    due: 'الموعد كما ورد، إن كان معروفاً',
    save: 'حفظ التعديلات',
    accept: 'حفظ كمهمة',
    dismiss: 'تجاهل',
    pending: 'بانتظار المراجعة',
    accepting: 'إعادة محاولة حفظ المهمة',
    accepted: 'مهمة محفوظة',
    dismissed: 'تم التجاهل',
    task: 'المهمة',
    board: 'اللوحة المشتركة',
    edited: 'حقول عدّلتها أنت',
    quote: 'اقتباس المصدر'
  },
  projectBrief: {
    retry: 'إعادة المحاولة',
    openSource: 'فتح ملف المصدر الحالي',
    title: 'ملخص المشروع والمراجع',
    hint: 'ابحث في مستندات المشروع مع اقتباسات محفوظة من المصدر. حدّث الفهرس بعد تغيير الملفات.',
    summary: 'ملخص المشروع',
    save: 'حفظ الملخص',
    sources: 'مجلدات المصادر',
    unavailable: 'غير متاح',
    refresh: 'تحديث المراجع',
    scanLimit: 'بلغ الفحص حد الملفات. حدّد مجلدات المصادر بشكل أدق لتغطية البقية.',
    approved: 'النتائج المعتمدة',
    search: 'ابحث في المراجع بالعربي أو الإنكليزي',
    history: 'تضمين النسخ السابقة',
    noMatches: 'لا توجد مراجع مفهرسة مطابقة. جرّب كلمات محددة أو حدّث المصادر.',
    page: 'صفحة',
    paragraph: 'فقرة',
    comment: 'تعليق',
    line: 'الأسطر',
    current: 'النسخة المفهرسة الحالية',
    previous: 'نسخة سابقة أو مصدر غير متاح',
    copy: 'نسخ الاقتباس',
    indexed: (ready, total) => `تمت فهرسة ${ready} من ${total} ملف`,
    pending: count => `${count} ملف بانتظار الفهرسة`,
    issues: count => `${count} ملف يحتاج مراجعة`
  },
  device: {
    live: 'الجهاز',
    pause: 'إيقاف مؤقت',
    resume: 'استئناف',
    screen: 'شاشة الجهاز',
    waiting: 'بانتظار الجهاز...'
  },
  billingBlock: {
    titleProvider: provider => `نفد الرصيد: ${provider}`,
    addCredits: 'إضافة رصيد',
    dismiss: 'تجاهل',
    fallbackMessage: 'نفد الرصيد من حسابك. أضف رصيدا للمتابعة.',
    openBilling: 'فتح الفوترة',
    titleNous: 'نفد رصيد Nous'
  },
  findInPage: {
    next: 'المطابقة التالية',
    previous: 'المطابقة السابقة'
  },
  starmap: {
    importSuccess: nodes => `تم تحميل خريطة تضم ${nodes} ${nodes === 1 ? 'عقدة' : 'عقد'}.`,
    subtitle: (nodes, clusters) => `${nodes} مهارة ضمن ${clusters} فئة`,
    close: 'إغلاق خريطة الذاكرة',
    copied: 'تم النسخ!',
    copy: 'نسخ رمز الخريطة',
    emptyDesc: 'مع بناء Sbar Rafiq مهارات وذاكرة لعملك، ستظهر هنا.',
    emptyTitle: 'لم يُكتسب شيء بعد',
    filterAll: 'الكل',
    filterLearned: 'مكتسبة',
    filterUsed: 'مستخدمة',
    importBtn: 'تحميل',
    importEmpty: 'الصق رمز خريطة لتحميلها.',
    importMap: 'استيراد خريطة',
    importedBadge: 'خريطة مستوردة',
    loadFailed: 'تعذر تحميل خريطة الذاكرة',
    loading: 'جار التحميل…',
    memory: 'الذاكرة',
    refresh: 'تحديث',
    resetToMine: 'العودة إلى خريطتي',
    share: 'مشاركة الخريطة',
    shareHint: 'انسخ الرمز لمشاركة هذه الخريطة، أو الصق رمزا لتحميله. يتضمن التخطيط فقط، لا نص ذاكرتك أو مهاراتك.',
    sharePlaceholder: 'الصق رمز خريطة…',
    shareTitle: 'استيراد / تصدير الخريطة',
    title: 'خريطة الذاكرة',
    viewGraph: 'الرسم'
  },
  webhooks: {
    deleteFailed: name => `تعذّر حذف "${name}"`,
    createFailed: detail => `تعذّر الإنشاء: ${detail}`,
    disabled: name => `معطّل: "${name}"`,
    restartFailed: detail => `تعذّرت إعادة تشغيل البوابة${detail}`,
    enabled: name => `مُفعَّل: "${name}"`,
    toggleFailed: (name, enabled) => `فشل ${enabled ? 'تشغيل' : 'إيقاف'} "${name}"`,
    subscriptions: count => `الاشتراكات (${count})`,
    all: '(الكل)',
    copy: 'نسخ',
    create: 'إنشاء',
    created: 'تم الإنشاء',
    createdSecretHint: 'انسخ السر الآن، فهو يُعرض مرة واحدة فقط.',
    createdTitle: 'تم إنشاء الاشتراك',
    creating: 'جار الإنشاء...',
    delete: 'حذف',
    deleteDescPrefix: 'سيؤدي هذا إلى حذف ',
    deleteDescSuffix: ' نهائيا. لا يمكن التراجع عن هذا.',
    deleteTitle: 'حذف Webhook',
    deleted: 'تم حذف Webhook',
    deleting: 'جار الحذف...',
    deliverOnly: 'التسليم فقط',
    deliverOptions: {
      email: 'البريد الإلكتروني',
      github_comment: 'تعليق GitHub',
      log: 'السجل',
      telegram: 'تيليجرام',
      discord: 'ديسكورد',
      slack: 'سلاك'
    },
    disableRow: 'تعطيل',
    disabledBody:
      'Webhooks منصة بوابة قائمة بذاتها. فعّلها هنا لقبول أحداث HTTP الواردة؛ ولا تلزم قنوات المحادثة إلا عندما يسلّم الاشتراك إلى Telegram أو Discord أو Slack أو قناة أخرى.',
    disabledTitle: 'مستقبِل Webhook معطل',
    done: 'تم',
    empty: 'لا توجد اشتراكات Webhook بعد.',
    enable: 'تفعيل Webhooks',
    enableRow: 'تفعيل',
    enabledRestarting: 'تم تفعيل Webhooks؛ جار إعادة تشغيل البوابة...',
    enabling: 'جار التفعيل...',
    fieldDeliver: 'التسليم إلى',
    fieldDeliverOnly: 'تسليم الحمولة فقط',
    fieldDescription: 'الوصف',
    fieldDescriptionPlaceholder: 'ماذا يفعل هذا الـWebhook (اختياري)',
    fieldEvents: 'الأحداث',
    fieldEventsPlaceholder: 'مفصولة بفواصل، اتركها فارغة للكل',
    fieldName: 'الاسم',
    fieldNamePlaceholder: 'مثال: github-push',
    fieldPrompt: 'الموجه',
    fieldPromptPlaceholder: 'تعليمات للوكيل عند انطلاق هذا الـWebhook (اختياري)',
    fieldSkills: 'المهارات',
    fieldSkillsPlaceholder: 'أسماء مهارات مفصولة بفواصل (اختياري)',
    hint: 'تُطبَّق تغييرات الاشتراكات فورا ما دام المستقبِل يعمل. والاشتراكات المعطلة ترفض الأحداث الواردة.',
    loadFailed: 'فشل تحميل Webhooks',
    loading: 'جار تحميل Webhooks...',
    nameRequired: 'الاسم مطلوب',
    newSubscription: 'اشتراك جديد',
    restartGateway: 'إعادة تشغيل البوابة',
    restartNeeded: 'تم تفعيل Webhooks، لكن البوابة ما زالت تحتاج إعادة تشغيل قبل أن يعمل المستقبِل.',
    restarting: 'جار إعادة تشغيل البوابة...',
    restartingGateway: 'جار إعادة التشغيل...',
    search: 'البحث في Webhooks...',
    secretOnce: 'السر (يُعرض مرة واحدة)',
    webhookUrl: 'رابط Webhook'
  },
  connectors: {
    title: 'اربط تطبيقاتك',
    connect: 'اربط',
    skip: 'ليس الآن',
    cancel: 'أوقف الانتظار',
    retry: 'أعد المحاولة',
    grant: 'أعد الربط',
    connected: 'متصل',
    checking: 'جارٍ فحص تطبيقاتك…',
    notConnected: 'لم يتم الاتصال',
    skipped: 'تم التخطي',
    disabled: 'غير متاح',
    failed: 'تعذر الاتصال',
    needsAuth: 'انتهت صلاحية الوصول',
    opening: 'جارٍ فتح تسجيل الدخول…',
    waiting: 'أكمل الربط في المتصفح…',
    timeout: 'ما زال بانتظار التفويض.',
    refresh: 'حدّث الحالة',
    connectError: 'تعذر بدء التفويض. أعد المحاولة.',
    unavailable: 'الموصّلات غير متاحة لهذه الجلسة.',
    ownerMissing: 'أعد فتح هذه المحادثة لإدارة اتصالاتها.',
    search: 'ابحث عن تطبيق',
    empty: 'لا توجد تطبيقات مطابقة',
    disclaimer: 'الربط اختياري. فوّض فقط التطبيقات التي تريد أن يستخدمها Sbar Rafiq.',
    execution: 'أدوات الموصّلات',
    openInBrowser: 'فتح في المتصفح',
    setupCancel: 'إلغاء',
    authorizedToolsUnavailable: 'تم التفويض، لكن الأدوات غير متاحة.',
    required: 'مطلوب',
    connectErrorFor: app => `تعذّر بدء التفويض لـ ${app}.`,
    setup: server => `إعداد ${server}`
  },
  freeTier: {
    providerRowPitch: 'سجّل الدخول بحساب Nous لفتح المزيد من النماذج والأدوات.',
    readyTitle: '‏Sbar Rafiq جاهز.',
    begin: 'ابدأ',
    signInInstead: 'سجّل الدخول بحساب Nous بدلًا من ذلك',
    otherProviders: 'مزودون آخرون',
    stripTitle: 'الاستدلال المجاني من Nous والموصّلات متاحة الآن.',
    stripBody: 'افتح منتقي النماذج لتجربتها، أو سجّل الدخول بحساب Nous.',
    openModelPicker: 'افتح منتقي النماذج',
    dismiss: 'إخفاء',
    signIn: 'تسجيل الدخول',
    signInHeading: 'سجّل الدخول بحساب Nous لفتح المزيد من النماذج والأدوات.',
    settingUp: 'جارٍ تجهيز الاستدلال المجاني…',
    codeBody: 'أدخل هذا الرمز في متصفحك لإتمام تسجيل الدخول.',
    copyLink: 'انسخ الرابط',
    doNotShare: 'لا تشارك هذا الرمز.',
    waiting: 'بانتظار تسجيل الدخول…',
    finishingHeading: 'جارٍ إنهاء تسجيل الدخول…',
    finishingBody: 'تمت الموافقة في المتصفح. جارٍ جمع رموز حسابك.',
    signedIn: 'تم تسجيل الدخول.',
    completedBody: 'حسابك الآن يحمل الاستدلال والأدوات.',
    defaultModel: 'النموذج الافتراضي',
    change: 'تغيير',
    done: 'تم',
    notNow: 'ليس الآن',
    tryAgain: 'أعد المحاولة',
    startAgain: 'ابدأ من جديد',
    didNotComplete: 'لم يكتمل تسجيل الدخول',
    rejectedBody: 'رُفض تسجيل الدخول في المتصفح. ما زلت على الطبقة المجانية.',
    supersededBody: 'حلّ رمز تسجيل دخول أحدث محل هذا الرمز.',
    timedOutHeading: 'انتهت مهلة تسجيل الدخول',
    timedOutBody: 'لم يُستخدم الرمز في الوقت المحدد. ما زلت على الطبقة المجانية.',
    retiredBody: 'هذه الهوية المجانية استُخدمت أو انتهت صلاحيتها، وستُجهَّز واحدة جديدة عند التشغيل التالي.',
    errorBody: 'لم يكتمل تسجيل الدخول، أعد تشغيله.',
    alreadySignedInHeading: 'تم تسجيل الدخول مسبقًا.',
    alreadySignedInBody: 'هذا التطبيق مسجّل دخوله بالفعل إلى حساب Nous.',
    providerRowTitle: '‏Nous · الطبقة المجانية',
    readyCaption: 'مجاني · الموصّلات مضمّنة',
    statusLabel: model => `Nous · ${model}`,
    signedInAs: email => `مسجّل الدخول باسم ${email}`,
    busyHeading: 'أوشكنا على الانتهاء',
    unreachableBody:
      'تعذّر على Sbar Rafiq الوصول إلى خدمة Nous لإكمال تسجيل دخولك. تحقق من اتصالك بالإنترنت وأعد المحاولة. جلستك ما زالت هنا.',
    setupFailed: {
      gateClosed:
        'لا يمكن لهذا الإصدار من Sbar Rafiq أن يعمل دون حساب Nous. سجّل الدخول أو أنشئ حسابًا، فهو مجاني ولا يستغرق سوى دقيقة.',
      paused:
        'استخدام Sbar Rafiq دون تسجيل الدخول متوقف مؤقتًا، وسيواصل Sbar Rafiq التحقق. تسجيل الدخول مجاني ويتيح لك البدء فورًا.',
      unreachable:
        'تعذّر على Sbar Rafiq الوصول إلى خدمة Nous. تحقق من اتصالك بالإنترنت، ثم اضغط «أعد المحاولة». أو اربط مزوّدًا آخر مؤقتًا.',
      serverError: 'واجهت خدمة Nous عطلًا عابرًا. اضغط «أعد المحاولة» بعد لحظات، أو اربط مزوّدًا آخر مؤقتًا.',
      powRequired:
        'طلب خادم Nous إثبات عمل، وهذا غير مدعوم في الوكيل لديك بعد. سجّل الدخول أو أنشئ حساب Nous مجانيًا للمتابعة.',
      locked: 'لا يمكن متابعة هذه الجلسة دون تسجيل الدخول. سجّل الدخول أو أنشئ حساب Nous مجانيًا للمتابعة.',
      generic:
        'تعذّر على Sbar Rafiq تجهيز الوصول المجاني دون تسجيل الدخول. تسجيل الدخول مجاني، أو يمكنك ربط مزوّد آخر.',
      signInBelow: 'تسجيل الدخول مجاني. اختر Nous أدناه.',
      tryAgain: 'أعد المحاولة',
      retrying: 'جارٍ إعادة المحاولة…',
      rateLimited: wait =>
        `كثيرون يبدؤون الآن، لذا سيعيد Sbar Rafiq المحاولة بعد ${wait}. تسجيل الدخول مجاني ويختصر الانتظار.`
    },
    busyBody: wait =>
      `تعذّر على Sbar Rafiq إكمال تسجيل دخولك لأن خدمة Nous مشغولة. أعد المحاولة بعد ${wait}. جلستك باقية هنا في الأثناء.`
  },
  connectorsPage: {
    title: 'الموصّلات',
    filterCategory: 'الفئة',
    categoryAll: 'كل الفئات',
    uncategorised: 'بلا فئة',
    residencyLocal: 'على هذا الجهاز',
    segment: {
      all: 'الكل',
      available: 'المتاحة',
      connected: 'المتصلة',
      off: 'المتوقفة'
    },
    group: {
      connected: 'المتصلة',
      connectedNote: 'الاتصالات المعطلة أولًا.',
      available: 'المتاحة',
      off: 'المتوقفة',
      offNote: 'تسجيلات الدخول محفوظة.'
    },
    card: {
      kindManaged: 'مُدار',
      kindCatalog: 'MCP · من الكتالوج',
      kindCustom: 'MCP · مخصص',
      inCatalog: 'ضمن كتالوج Sbar Rafiq',
      hostedTwin: 'تتوفر نسخة مُدارة',
      alsoLocal: 'يعمل أيضًا على هذا الجهاز',
      state: {
        accessExpired: 'انتهت صلاحية الوصول',
        available: 'متاح',
        connected: 'متصل',
        connecting: 'جارٍ الاتصال',
        connectionUnknown: 'الحالة غير معروفة',
        couldNotConnect: 'تعذّر الاتصال',
        offByYourOrganisation: 'أوقفته مؤسستك',
        offForYou: 'متوقف لديك',
        serverConnecting: 'جارٍ الاتصال…',
        serverError: 'خطأ',
        serverNeedsAuth: 'يحتاج إلى مصادقة',
        serverOff: 'متوقف',
        serverOn: 'يعمل',
        serverOnUnused: 'يعمل، غير مستخدم'
      },
      verb: {
        authenticate: 'مصادقة',
        connect: 'اتصال',
        install: 'تثبيت',
        openLogs: 'فتح السجلات',
        reconnect: 'إعادة الاتصال',
        stopWaiting: 'إيقاف الانتظار',
        tryAgain: 'أعد المحاولة',
        turnBackOn: 'إعادة التشغيل'
      },
      reason: {
        finishSignIn: 'أكمل تسجيل الدخول في متصفحك.',
        reconnect: 'أعد الاتصال ليبقى هذا التطبيق عاملًا.',
        serverError: 'رفض الخادم الاتصال.',
        serverNeedsAuth: 'سجّل الدخول ليتمكن هذا الخادم من الرد.'
      },
      kindPlugin: plugin => `MCP · الإضافة ${plugin}`,
      open: name => `فتح ${name}`,
      turnServerOn: name => `تشغيل ${name}`,
      turnServerOff: name => `إيقاف ${name}`,
      fact: {
        tools: count => plural(count, 'أداة واحدة', 'أداتان', 'أدوات', 'أداة'),
        toolsOff: count => `${plural(count, 'أداة واحدة', 'أداتان', 'أدوات', 'أداة')} متوقفة`,
        toolsOn: count => `${plural(count, 'أداة واحدة', 'أداتان', 'أدوات', 'أداة')} تعمل`,
        toolsSomeOn: (total, on) => `${plural(total, 'أداة واحدة', 'أداتان', 'أدوات', 'أداة')}، ${on} منها تعمل`
      }
    },
    page: {
      loading: 'جارٍ قراءة الكتالوج والخوادم الموجودة على هذا الكمبيوتر',
      emptyTitle: 'لا توجد تطبيقات هنا بعد. أضف خادمًا على هذا الكمبيوتر للبدء.',
      noMatchTitle: 'لا توجد تطبيقات مطابقة',
      noMatchBody: 'لا شيء هنا يطابق بحثك. وجّه Sbar Rafiq إلى خادم MCP الخاص بك لإضافته.',
      clearSearch: 'مسح البحث',
      hostedFailedTitle: 'تعذّر الوصول إلى التطبيقات المستضافة.',
      hostedFailedBody: 'لم تتأثر الخوادم الموجودة على هذا الكمبيوتر وما زالت تعمل. لم يُوقَف أي شيء.',
      retry: 'إعادة المحاولة',
      showAllMatches: 'عرض كل النتائج المطابقة',
      freeTierNote: 'تبقى الاتصالات على هذا الكمبيوتر حتى تسجّل الدخول.',
      signInLine: 'سجّل الدخول إلى Nous لاستخدام التطبيقات المُدارة.',
      signIn: 'تسجيل الدخول',
      managedUnavailable: 'التطبيقات المُدارة غير متاحة لهذا الحساب بعد.',
      writeFailed: 'لم يُحفظ هذا التغيير.',
      refreshFailed: 'لم تُحدَّث قائمة الأدوات.',
      disconnectNoAccount: 'لا يوجد حساب لدى Sbar Rafiq لقطع اتصاله هنا. حدّث الصفحة وأعد المحاولة.',
      disconnectRefused:
        'تعذّر على Nous إزالة تسجيل الدخول هذا الآن. أوقف التطبيق بالمفتاح بدلًا من ذلك، أو أعد المحاولة لاحقًا.',
      matchesElsewhere: count =>
        `${plural(count, 'نتيجة مطابقة أخرى', 'نتيجتان مطابقتان أخريان', 'نتائج مطابقة أخرى', 'نتيجة مطابقة أخرى')} في مجموعات أخرى.`,
      segmentNoMatch: segment => `لا نتائج في ${segment}، لذا تُعرض كل النتائج المطابقة.`
    },
    add: {
      action: 'إضافة موصّل خاص بك',
      title: 'الاتصال بخادم MCP مخصص',
      hint: 'إدخال واحد جديد في mcp.json على هذا الجهاز',
      pasteLabel: 'الصق أمرًا أو مقتطفًا',
      pasteNoMatch: 'لا يبدو أن ما لصقته يصف خادمًا. املأ الحقول أدناه بدلًا من ذلك.',
      name: 'الاسم',
      nameTaken: 'هذا الاسم مستخدم بالفعل.',
      type: 'النوع',
      command: 'أمر التشغيل',
      args: 'الوسائط',
      addArg: '+ إضافة وسيط',
      envVars: 'متغيرات البيئة',
      addEnvVar: '+ إضافة متغير بيئة',
      passthrough: 'تمرير متغيرات البيئة',
      addPassthrough: '+ إضافة متغير',
      cwd: 'مجلد العمل',
      url: 'الرابط',
      headers: 'الترويسات',
      addHeader: '+ إضافة ترويسة',
      auth: 'المصادقة',
      authNone: 'بلا مصادقة',
      authBearer: 'رمز Bearer',
      keyPlaceholder: 'المفتاح',
      valuePlaceholder: 'القيمة',
      removeRow: 'إزالة هذا الصف',
      editJson: 'تحرير mcp.json',
      saveFailed: 'لم يُحفظ هذا الخادم.',
      typeHttp: 'HTTP قابل للبث',
      authOauth: 'تفويض OAuth'
    },
    dialog: {
      disconnect: 'قطع الاتصال',
      disconnectBody: 'سيتوقف Sbar Rafiq عن العمل باسم هذا الحساب. يمكنك الاتصال مجددًا في أي وقت.',
      menuRefreshTools: 'تحديث الأدوات',
      moreActions: 'إجراءات أخرى',
      removeServerBody: 'سيُزال الإدخال من mcp.json على هذا الكمبيوتر. لن يُحذف أي شيء آخر.',
      wayHosted: 'مُدار',
      turnOffLocal: 'إيقاف الخادم المحلي',
      openPlugins: 'فتح تبويب الإضافات',
      nousLine: 'تتبع تطبيقات Nous حسابك، لا الملف الشخصي.',
      rulesReadOnly: 'لا يمكن تغيير القواعد الآن.',
      rulesSignIn: 'سجّل الدخول لتغيير ما يُسمح لـ Sbar Rafiq بفعله هنا.',
      orgLink: 'فتح إدارة الموصّلات',
      connectEnded: 'لم يكتمل تسجيل الدخول.',
      connectOpenAgain: 'افتح الرابط مجددًا',
      tokensPerCall: 'رمز لكل استدعاء',
      usesPerMonth: 'استخدام خلال 30 يومًا',
      advanced: 'متقدم',
      advancedHint: 'إدخال mcp.json والسجلات',
      disconnectTitle: name => `قطع الاتصال بـ ${name}؟`,
      removeServerTitle: name => `إزالة ${name}؟`,
      appSwitch: name => `يمكن لـ Sbar Rafiq استخدام ${name}`,
      waysTitle: name => `أين يعمل ${name}`,
      wayNotConnected: name => `لم يتصل بعد. سجّل الدخول إلى ${name} في متصفحك.`,
      bothOn: name => `النسختان تعملان، لذا يرى Sbar Rafiq كل أداة من ${name} مرتين.`,
      providedByPlugin: plugin => `مقدَّم من الإضافة ${plugin}`,
      rulesAppOff: name => `شغّل ${name} لتغيير أدواته.`,
      orgNote: count => `أوقفت مؤسستك ${plural(count, 'أداة واحدة', 'أداتين', 'أدوات', 'أداة')}.`
    },
    tools: {
      title: 'الأدوات',
      notInstalledBody: 'ثبّته على هذا الجهاز لترى الأدوات التي يوفرها.',
      summaryAllTools: 'كل الأدوات',
      summaryOther: 'أخرى',
      allToolsSwitch: 'تشغيل كل الأدوات أو إيقافها',
      summaryAllOn: 'كلها تعمل',
      summaryOff: 'متوقفة',
      showSummary: 'عرض الملخص',
      staleSignIn: 'سجّل الدخول لقراءة أحدث قائمة للأدوات.',
      quickReadOnly: 'للقراءة فقط',
      quickNoDestructive: 'إيقاف الأدوات المدمّرة',
      quickEverythingOn: 'تشغيل الكل',
      lockedHint: 'أوقفته مؤسستك',
      noMatch: 'لا توجد أداة تطابق عوامل التصفية هذه.',
      loading: 'جارٍ قراءة قائمة الأدوات',
      unavailableLine: 'قائمة الأدوات غير متاحة.',
      needsAuthBody: 'يبقى تسجيل الدخول على هذا الكمبيوتر ولا يغادره أي شيء.',
      retry: 'إعادة المحاولة',
      goneBody: 'لم يعد بإمكان Sbar Rafiq استدعاؤه. يبقى الصف ظاهرًا حتى تزيله، فلا يختفي شيء فجأة.',
      remove: 'إزالة',
      offBody: 'شغّله بالمفتاح أعلاه لقراءة الأدوات التي يوفرها.',
      signedOutTitle: 'سجّل الدخول إلى Nous لقراءة قائمة الأدوات.',
      signedOutBody: 'لم تتأثر خوادمك الموجودة على هذا الكمبيوتر.',
      conflictTitle: 'غيّر شخص آخر هذه القاعدة أثناء تحريرك لها.',
      conflictReload: 'تحميل نسخته',
      conflictSave: 'الحفظ فوق نسخته',
      saveFailed: 'لم تُحفظ قواعد الأدوات هذه.',
      discard: 'تجاهل',
      save: 'حفظ التغييرات',
      saving: 'جارٍ الحفظ...',
      summaryTitle: name => `ما يُسمح لـ Sbar Rafiq بفعله في ${name}`,
      summaryPreviewTitle: name => `ما يمكن لـ Sbar Rafiq فعله في ${name} بعد الاتصال`,
      summaryCount: count => plural(count, 'أداة واحدة', 'أداتان', 'أدوات', 'أداة'),
      summarySomeOn: (on, total) => `${on} من ${total} تعمل`,
      showAllTools: count => (count === 1 ? 'عرض الأداة' : `عرض كل الأدوات (${count})`),
      facetSwitch: facet => `تشغيل أدوات ${facet} أو إيقافها`,
      searchCountPlaceholder: count => `ابحث في ${plural(count, 'أداة واحدة', 'أداتين', 'أدوات', 'أداة')}`,
      toolList: name => `أدوات ${name}`,
      categorySelect: count => plural(count, 'فئة واحدة', 'فئتان', 'فئات', 'فئة'),
      showDeprecated: count => `عرض المهملة (${count})`,
      hideDeprecated: count => `إخفاء المهملة (${count})`,
      turnToolOn: tool => `تشغيل ${tool}`,
      turnToolOff: tool => `إيقاف ${tool}`,
      showDetails: tool => `عرض ما تفعله ${tool}`,
      hideDetails: tool => `إخفاء ما تفعله ${tool}`,
      needsAuthTitle: name => `سجّل الدخول إلى ${name} لقراءة أدواته.`,
      goneTitle: name => `غادر ${name} الكتالوج.`,
      offTitle: name => `${name} متوقف.`,
      conflictBody: (theyOff, theyOn) => {
        const they = [
          theyOff > 0 ? `أوقف ${plural(theyOff, 'أداة واحدة', 'أداتين', 'أدوات', 'أداة')} كانت تعمل لديك` : '',
          theyOn > 0 ? `أبقى ${plural(theyOn, 'أداة واحدة', 'أداتين', 'أدوات', 'أداة')} تعمل بعد أن أوقفتها` : ''
        ].filter(Boolean)
        return `${they.length > 0 ? `${they.join('، و')}. ` : ''}تبقى تعديلاتك على الشاشة، ولم يُكتب أي شيء.`
      },
      footerDirty: (off, backOn) =>
        `${plural(off, 'أداة واحدة', 'أداتان', 'أدوات', 'أداة')} متوقفة، ${backOn === 0 ? 'ولا شيء أُعيد تشغيله' : `و${backOn} أُعيد تشغيلها`}`,
      moreHints: count => `+${count}`
    },
    vocabulary: {
      facetRead: {
        label: 'قراءة',
        long: 'تقرأ بيانات من هذا التطبيق دون أن تغيّر شيئًا.'
      },
      facetWrite: {
        label: 'كتابة',
        long: 'تُنشئ شيئًا في هذا التطبيق أو تغيّره.'
      },
      facetDestructive: {
        label: 'مدمّرة',
        long: 'قد تزيل شيئًا من هذا التطبيق نهائيًا.'
      },
      facetUnclassified: {
        label: 'أثر غير معروف',
        long: 'لم يوضّح التطبيق ما تفعله هذه الأداة.'
      },
      hintReadOnly: {
        label: 'للقراءة فقط',
        long: 'تعلن الأداة أنها تقرأ فقط.'
      },
      hintCreate: {
        label: 'تُنشئ',
        long: 'تُنشئ شيئًا جديدًا.'
      },
      hintUpdate: {
        label: 'تُحدّث',
        long: 'تغيّر شيئًا موجودًا بالفعل.'
      },
      hintDelete: {
        label: 'تحذف',
        long: 'تزيل شيئًا.'
      },
      hintDestructive: {
        label: 'مدمّرة',
        long: 'لا يمكن التراجع هنا عن التغيير الذي تُجريه.'
      },
      hintIdempotent: {
        label: 'قابلة للتكرار',
        long: 'تشغيلها مرتين يعطي نتيجة تشغيلها مرة واحدة.'
      },
      hintOpenWorld: {
        label: 'خارجية',
        long: 'تصل إلى شيء خارج هذا التطبيق.'
      }
    },
    searchPlaceholder: count => `ابحث في ${plural(count, 'تطبيق واحد', 'تطبيقين', 'تطبيقات', 'تطبيقًا')}`
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
  }
}
