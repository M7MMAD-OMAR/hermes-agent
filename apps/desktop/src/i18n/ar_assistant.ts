import type { TranslationOverrides } from './define-locale'

export const arAssistant = {
  assistant: {
    catalogInstall: {
      preparing: 'جارٍ تجهيز التثبيت…',
      install: 'تثبيت',
      advanced: 'خيارات متقدمة',
      skip: 'تخطٍّ',
      installing: 'جارٍ التثبيت…',
      installed: 'مثبّت',
      notInstalled: 'غير مثبّت',
      failed: 'فشل',
      showNames: 'إظهار الأسماء',
      hideNames: 'إخفاء الأسماء',
      skill: name => `المهارة ${name}`,
      kind: { plugin: 'إضافة', skill: 'مهارة' },
      tier: { official: 'رسمي', community: 'مجتمعي' },
      targetProfile: profile => `يُثبَّت في ملفك الشخصي ${profile}`,
      sendFailed: 'تعذّر إرسال ردك. حاول مرة أخرى.',
      commitLabel: 'الإيداع',
      subdirLabel: 'المجلد',
      securityHeading: 'الأمان',
      scan: { passed: 'نجح الفحص', warnings: 'وجد الفحص تحذيرات', failed: 'فشل الفحص' },
      requirementsLabel: 'المتطلبات',
      credentialsHeading: 'بيانات الاعتماد'
    },
    thread: {
      loadingLocalModel: model => `جارٍ تحميل ${model} إلى الذاكرة`,
      loadingSession: 'جار تحميل الجلسة...',
      showEarlier: 'عرض الرسائل الأقدم',
      loadingResponse: 'جار تحميل الرد...',
      resumeWhenBackgroundDone: count =>
        count === 1 ? 'سيُستأنف عند انتهاء المهمة الخلفية' : `سيُستأنف عند انتهاء ${count} مهام خلفية`,
      thinking: 'يفكر...',
      thought: 'فكّر',
      thoughtBriefly: 'فكّر قليلاً',
      thoughtFor: duration => `فكّر لمدة ${duration}`,
      turnDuration: duration => `استغرقت هذه الجولة ${duration}`,
      turnDigestNotes: count => (count === 1 ? 'ملاحظة واحدة' : `${count} ملاحظات`),
      turnOutcomeDelivered: 'تم تسليمه',
      turnOutcomeFailed: 'تعذّر',
      turnOutcomeOpen: 'ما زال مفتوحاً',
      turnOutcomeTitle: 'نتيجة الدور',
      progressTitle: 'تقدّم المهمة',
      progressTask: 'يعمل على',
      progressEdit: 'آخر تعديل مسجّل',
      progressCheck: 'آخر فحص ناجح',
      progressCheckOutdated: 'الفحص أقدم من آخر تعديل',
      progressError: 'آخر خطأ مسجّل',
      progressRepeated: 'عملية متكررة',
      today: time => `اليوم ${time}`,
      yesterday: time => `أمس ${time}`,
      copy: 'نسخ',
      refresh: 'تحديث',
      moreActions: 'إجراءات إضافية',
      branchNewChat: 'تفريع إلى محادثة جديدة',
      react: 'تفاعل',
      dismissError: 'تجاهل الخطأ',
      errorLayers: {
        auth: 'خطأ في المصادقة',
        billing: 'نفاد الرصيد',
        disk: 'القرص ممتلئ',
        endpoint: 'خطأ في نقطة النهاية المخصصة',
        gateway: 'خطأ في البوابة',
        generic: 'فشلت الجولة',
        provider: 'خطأ من المزوّد',
        runtime: 'خطأ في بيئة التشغيل المحلية',
        streaming: 'خطأ في اتصال البث'
      },
      errorRetry: 'إعادة المحاولة',
      errorLimitResets: time => `يُعاد ضبط الحد عند ${time}`,
      errorRetryAtReset: time => `إعادة المحاولة عند إعادة ضبط الحد (${time})`,
      errorRetryScheduled: (time, wait) => `ستتم إعادة المحاولة عند ${time}، بعد ${wait}`,
      errorRetryScheduledCancel: 'إلغاء',
      errorStartNewSession: 'بدء جلسة جديدة',
      errorSwitchProvider: 'تبديل المزوّد',
      errorSignInAgain: provider => `تسجيل الدخول إلى ${provider} مجدداً`,
      errorOauthExpired: provider =>
        `انتهت صلاحية تسجيل دخولك إلى ${provider} أو تم إلغاؤه. سجّل الدخول مجدداً لمتابعة المحادثة.`,
      errorOpenLogs: 'فتح السجلات',
      errorOpenLogsFailed: 'تعذّر فتح مجلد السجلات',
      errorOpenDesktopLogs: 'فتح سجلات سطح المكتب',
      errorCopyDiagnostics: 'نسخ تفاصيل الخطأ',
      errorSendDiagnostics: 'إرسال التشخيصات',
      filesChanged: count => `${count} ملفات تم تغييرها`,
      reviewChanges: 'مراجعة',
      readAloudFailed: 'فشلت القراءة بصوت عال',
      preparingAudio: 'جار تجهيز الصوت',
      stopReading: 'إيقاف القراءة',
      readAloud: 'قراءة بصوت عال',
      copyFullResponse: 'نسخ الرد الكامل',
      readAloudFullResponseHint: 'انقر مع الضغط على Shift: قراءة الرد الكامل بصوت عال',
      editMessage: 'تحرير الرسالة',
      scrollToBottom: 'التمرير إلى الأسفل',
      stop: 'إيقاف',
      restorePrevious: 'استعادة السابق',
      restoreCheckpoint: 'استعادة النقطة',
      restoreFromHere: 'استعادة نقطة التحقق، إعادة التشغيل من هذا الموجّه',
      restoreTitle: 'الاستعادة إلى نقطة التحقق هذه؟',
      restoreBody: 'يُزال كل ما يلي هذا الموجّه من المحادثة، ويُعاد تشغيل الموجّه من هنا.',
      restoreConfirm: 'استعادة وإعادة تشغيل',
      restoreNext: 'استعادة التالي',
      goForward: 'تقدم',
      sendEdited: 'إرسال التعديل',
      attachingFile: 'جار إرفاق الملف',
      expandMessage: 'توسيع الرسالة',
      processingPrompt: 'جار معالجة الموجّه',
      errorLayerBodies: {
        auth: 'رفضت خدمة الذكاء الاصطناعي تسجيل دخولك. تحقق من بيانات الاعتماد لهذا المزوّد، ثم أرسل رسالتك مجددًا.',
        billing: 'نفد رصيد حسابك لدى هذا المزوّد. اشحن الرصيد أو بدّل المزوّد، ثم أرسل مجددًا.',
        disk: 'القرص ممتلئ، لذا تعذّر على Sbar Rafiq حفظ هذه المحادثة. حرّر بعض المساحة ثم أعد المحاولة.',
        endpoint: 'لا يستطيع Sbar Rafiq الوصول إلى خادم النموذج المخصص لديك. تأكد من أنه يعمل، ثم أرسل رسالتك مجددًا.',
        gateway: 'واجه Sbar Rafiq مشكلة داخلية عند بدء هذا الرد. أرسل رسالتك مجددًا، وإن تكرر ذلك فأرسل التشخيصات.',
        generic: 'حدث خطأ أثناء رد Sbar Rafiq. أعد المحاولة، أو انسخ التفاصيل إن تكرر ذلك.',
        provider: 'تعذّر على خدمة الذكاء الاصطناعي إكمال هذا الطلب. أعد المحاولة بعد لحظات أو بدّل المزوّد.',
        runtime: 'واجه Sbar Rafiq مشكلة داخلية عند بدء هذا الرد. أرسل رسالتك مجددًا، وإن تكرر ذلك فأرسل التشخيصات.',
        streaming: 'انقطع الاتصال قبل اكتمال الرد. أعد المحاولة لإرساله مجددًا.'
      },
      errorCodes: {
        billing: {
          title: 'نفد الرصيد',
          body: provider => `نفد الرصيد في حسابك لدى ${provider}. اشحن الرصيد أو بدّل المزوّد، ثم أرسل مجددًا.`
        },
        rate_limit: {
          title: 'خدمة الذكاء الاصطناعي مشغولة',
          body: provider => `يقيّد ${provider} الطلبات الآن. انتظر دقيقة ثم أعد المحاولة.`
        },
        upstream_rate_limit: {
          title: 'خدمة الذكاء الاصطناعي مشغولة',
          body: provider => `يقيّد ${provider} الطلبات الآن. انتظر دقيقة ثم أعد المحاولة.`
        },
        overloaded: {
          title: 'خدمة الذكاء الاصطناعي تحت ضغط كبير',
          body: provider => `يواجه ${provider} مشكلات الآن. أعد المحاولة بعد لحظات أو بدّل المزوّد.`
        },
        server_error: {
          title: 'واجهت خدمة الذكاء الاصطناعي مشكلة',
          body: provider => `أرجع ${provider} خطأ خادم. أعد المحاولة بعد لحظات أو بدّل المزوّد.`
        },
        timeout: {
          title: 'انتهت مهلة الرد',
          body: provider => `لم يستجب ${provider} في الوقت المحدد. أعد المحاولة لإرسالها مجددًا.`
        },
        stream_drop: {
          title: 'انقطع الرد',
          body: 'انقطع الاتصال قبل اكتمال الرد. أعد المحاولة لإرساله مجددًا.'
        },
        upstream_blocked: {
          title: 'حظر جدار حماية الطلب',
          body: provider =>
            `حظر جدار حماية أو شبكة CDN أمام ${provider} الطلب قبل وصوله إلى النموذج، ومفتاحك سليم على الأرجح. اضبط ترويسة User-Agent عبر extra_headers للمزوّد في الإعدادات، أو بدّل المزوّد، ثم أرسل رسالتك مجددًا.`
        },
        ssl_cert_verification: {
          title: 'فشل الاتصال الآمن',
          body: provider =>
            `تعذّر على Sbar Rafiq التحقق من الاتصال الآمن بـ ${provider}. تحقق من إعدادات الشبكة أو الوكيل، أو بدّل المزوّد، ثم أرسل رسالتك مجددًا.`
        },
        context_overflow: {
          title: 'هذه المحادثة طويلة جدًا',
          body: 'لم تعد المحادثة تتسع في النموذج. اضغطها أو ابدأ محادثة جديدة، ثم أرسل مجددًا.'
        },
        payload_too_large: {
          title: 'هذه الرسالة كبيرة جدًا',
          body: 'كان الطلب أكبر من أن يستوعبه النموذج. اضغط المحادثة أو ابدأ محادثة جديدة، ثم أرسل مجددًا.'
        },
        model_not_found: {
          title: 'هذا النموذج غير متاح',
          body: provider =>
            `لا يوفّر ${provider} هذا النموذج لحسابك. اختر نموذجًا آخر، ثم أرسل رسالتك مجددًا.`
        },
        provider_policy_blocked: {
          title: 'إعدادات حسابك تحظر هذا النموذج',
          body: provider =>
            `لم يوجّه ${provider} هذا الطلب بسبب إعدادات البيانات أو الخصوصية في حسابك. اختر نموذجًا آخر أو بدّل المزوّد.`
        },
        content_policy_blocked: {
          title: 'رفضت خدمة الذكاء الاصطناعي هذا الطلب',
          body: provider => `رفض ${provider} الرد على هذه الرسالة. عدّلها وأرسلها مجددًا.`
        },
        format_error: {
          title: 'رفضت خدمة الذكاء الاصطناعي الطلب',
          body: provider =>
            `لم يقبل ${provider} طريقة بناء هذا الطلب. بدّل المزوّد أو أرسل التشخيصات لنتمكن من فحص المشكلة.`
        },
        truncated: {
          title: 'توقف الرد قبل اكتماله',
          body: 'توقف النموذج قبل أن ينتهي. أعد المحاولة للحصول على رد كامل.'
        },
        invalid_response: {
          title: 'أرسلت خدمة الذكاء الاصطناعي ردًا غير مقروء',
          body: provider => `أرجع ${provider} ردًا لم يتمكن Sbar Rafiq من قراءته. أعد المحاولة بعد لحظات.`
        },
        empty_response: {
          title: 'أرسلت خدمة الذكاء الاصطناعي ردًا فارغًا',
          body: provider => `لم يُرجع ${provider} شيئًا لهذه الرسالة. أعد المحاولة بعد لحظات.`
        },
        loop_error: {
          title: 'علق Sbar Rafiq في حلقة متكررة',
          body: 'ظل الرد يكرر الخطوات نفسها، فأوقفه Sbar Rafiq. أعد المحاولة، أو ابدأ محادثة جديدة إن تكرر ذلك.'
        },
        SESSION_NOT_OWNED: {
          title: 'هذه المحادثة مفتوحة في مكان آخر',
          body: 'هذه المحادثة مفتوحة حاليًا في نافذة أو طرفية أخرى من Sbar Rafiq. أغلقها هناك وأرسل رسالتك مجددًا، أو ابدأ محادثة جديدة هنا.'
        },
        disk_full: {
          title: 'القرص ممتلئ',
          body: 'القرص ممتلئ، لذا تعذّر على Sbar Rafiq حفظ هذه المحادثة. حرّر بعض المساحة ثم أعد المحاولة.'
        },
        free_tier_disabled: {
          title: 'استخدام Sbar Rafiq دون تسجيل الدخول متوقف حاليًا',
          body: 'سجّل الدخول بحساب Nous لمواصلة المحادثة، فهو مجاني.'
        },
        free_tier_rate_limited: {
          title: 'استنفدت الحصة المتاحة للمحادثة دون تسجيل الدخول',
          body: 'تتجدد الحصة قريبًا. سجّل الدخول بحساب Nous للحصول على حصة أكبر، فهو مجاني.'
        },
        free_tier_at_capacity: {
          title: 'المحادثة دون تسجيل الدخول مزدحمة جدًا الآن',
          body: 'سجّل الدخول لتتجاوز الانتظار، فهو مجاني، أو أعد المحاولة بعد قليل.'
        },
        free_tier_model_not_free: {
          title: 'هذا النموذج غير متاح دون تسجيل الدخول',
          body: 'يستخدم Sbar Rafiq النموذج المجاني حاليًا. سجّل الدخول بحساب Nous لمزيد من النماذج، فهو مجاني.'
        },
        free_tier_route: {
          title: 'تعذّر على Sbar Rafiq الوصول إلى النموذج المجاني عبر هذا المسار',
          body: 'سجّل الدخول بحساب Nous، فهو مجاني، أو تحقق من إعداد NOUS_INFERENCE_BASE_URL.'
        },
        free_tier_outage: {
          title: 'يواجه النموذج المجاني صعوبة في الاستجابة الآن',
          body: 'حاول إرسال رسالتك مجددًا بعد دقيقة.'
        },
        free_tier_refused: {
          title: 'تعذّر على Sbar Rafiq إرسال ذلك دون تسجيل الدخول',
          body: 'تسجيل الدخول بحساب Nous مجاني.'
        },
        auth: {
          title: provider => `رفض ${provider} تسجيل دخولك`,
          body: provider =>
            `لم تُقبل بيانات الاعتماد المحفوظة لـ ${provider}. أصلحها في الإعدادات أو بدّل المزوّد، ثم أرسل رسالتك مجددًا.`
        },
        auth_permanent: {
          title: provider => `رفض ${provider} تسجيل دخولك`,
          body: provider =>
            `بيانات الاعتماد المحفوظة لـ ${provider} غير صالحة أو أُلغيت. حدّثها أو بدّل المزوّد، ثم أرسل رسالتك مجددًا.`
        }
      },
      errorDetails: 'التفاصيل',
      errorGenericProvider: 'خدمة الذكاء الاصطناعي',
      errorToastTitle: 'تعذّر على Sbar Rafiq إكمال الرد',
      errorChooseModel: 'اختيار نموذج',
      errorCompressConversation: 'ضغط المحادثة',
      errorCompressFailed: 'تعذّر ضغط المحادثة',
      errorOpenHermesFolder: 'فتح مجلد Hermes',
      errorOpenHermesFolderFailed: 'تعذّر فتح مجلد Hermes',
      errorUpdateApiKey: 'تحديث مفتاح API',
      errorSignInFreeTier: 'تسجيل الدخول بحساب Nous',
      errorAuthKinds: {
        api_key: {
          title: provider => `رفض ${provider} مفتاح API الخاص بك`,
          body: provider => `المفتاح المحفوظ لـ ${provider} غير صالح أو أُلغي. حدّثه ثم أعد المحاولة.`
        },
        oauth: {
          title: provider => `انتهت صلاحية تسجيل دخولك إلى ${provider}`
        }
      }
    },
    approval: {
      timedOutSystemLine:
        'انتهت مهلة الموافقة، فلم يُنفَّذ الأمر. اطلب من Sbar Rafiq المحاولة مجددا، أو ارفع الحد من الإعدادات ← الأمان ← مهلة الموافقة.',
      gatewayDisconnected: 'البوابة غير متصلة',
      sendFailed: 'فشل الإرسال',
      run: 'تشغيل',
      command: 'الأمر',
      moreOptions: 'خيارات إضافية',
      allowSession: 'السماح لهذه الجلسة',
      alwaysAllowMenu: 'السماح دائما',
      jumpToApproval: 'الموافقة مطلوبة',
      reject: 'رفض',
      alwaysTitle: 'السماح دائما',
      alwaysDescription: pattern => `السماح دائما بالأوامر المطابقة لـ ${pattern}`,
      alwaysAllow: 'السماح دائما',
      reconnect: 'إعادة الاتصال',
      openSafetySettings: 'فتح إعدادات الأمان'
    },
    clarify: {
      notReady: 'غير جاهز',
      gatewayDisconnected: 'البوابة غير متصلة',
      sendFailed: 'فشل الإرسال',
      loadingQuestion: 'جار تحميل السؤال...',
      other: 'غير ذلك',
      placeholder: 'اكتب إجابتك...',
      skip: 'تخطي',
      confirmAndContinueLabel: 'تأكيد ومتابعة',
      singleSelectHint: 'اختر واحدا',
      multiSelectHint: 'حدد كل ما ينطبق',
      questionProgress: (answered, total) => `تمت الإجابة على ${answered} من ${total}`,
      skipped: 'تم التخطي'
    },
    tool: {
      copyCode: 'نسخ الكود',
      renderingImage: 'جار عرض الصورة...',
      copyOutput: 'نسخ الإخراج',
      copyCommand: 'نسخ الأمر',
      copyContent: 'نسخ المحتوى',
      copyUrl: 'نسخ الرابط',
      copyResults: 'نسخ النتائج',
      copyQuery: 'نسخ الاستعلام',
      copyFile: 'نسخ الملف',
      copyPath: 'نسخ المسار',
      failedCalls: (count: number) => `عدد استدعاءات الأدوات الفاشلة: ${count}`,
      skillActivity: {
        loading: 'جارٍ تحميل المهارة',
        loaded: 'تم تحميل المهارة',
        loadFailed: 'تعذر تحميل المهارة',
        readingResource: 'جارٍ قراءة مورد المهارة',
        readResource: 'تمت قراءة مورد المهارة',
        resourceFailed: 'تعذرت قراءة مورد المهارة',
        listing: 'جارٍ عرض المهارات',
        listed: 'تم عرض المهارات',
        listFailed: 'تعذر عرض المهارات',
        unavailable: 'نتيجة المهارة غير متاحة'
      },
      outputAlt: 'إخراج الأداة',
      rawResponse: 'الرد الخام',
      copyActivity: 'نسخ النشاط',
      recoveredOne: 'تم الاسترداد',
      recoveredMany: count => `تم استرداد ${count}`,
      failedOne: 'فشل',
      failedMany: count => `فشل ${count}`,
      statusRunning: 'يعمل',
      statusError: 'خطأ',
      statusRecovered: 'تم الاسترداد',
      statusDone: 'تم',
      resultUnavailable: 'النتيجة غير متاحة',
      resultInterrupted: 'تمت المقاطعة',
      memoryWriteNoted: 'تم تسجيل كتابة الذاكرة',
      actions: {
        read: 'قراءة',
        reading: 'جار القراءة',
        opened: 'تم الفتح',
        opening: 'جار الفتح',
        searched: 'تم البحث',
        searching: 'جار البحث',
        ran: 'تم التشغيل',
        running: 'جار التشغيل',
        ranCode: 'تم تشغيل الكود',
        runningCode: 'جار البرمجة',
        failedToOpen: 'فشل الفتح'
      },
      prefixes: {
        browser: 'المتصفح',
        web: 'الويب'
      },
      graft: {
        files: count => (count === 1 ? 'ملف واحد' : `${count} ملفات`),
        freshness: { fresh: 'الرسم البياني محدّث', missing: 'لم يُبنَ رسم بياني', stale: 'الرسم البياني قديم' },
        hits: count => (count === 1 ? 'نتيجة واحدة' : `${count} نتائج`),
        indexedFiles: count => `${count} ملفات مفهرسة`,
        saved: tokens => `وفّر ≈ ${tokens} رمزًا`,
        savedPercent: (tokens, percent) => `وفّر ≈ ${tokens} رمزًا (${percent}%)`,
        scope: path => `ضمن ${path}`,
        titles: {
          ask: { done: 'Graft: سأل رسم الشيفرة', pending: 'Graft: يسأل رسم الشيفرة', pendingAction: 'يسأل' },
          callers: { done: 'Graft: تتبّع الاستدعاءات', pending: 'Graft: يتتبّع الاستدعاءات', pendingAction: 'يتتبّع' },
          check: {
            done: 'Graft: تحقّق من حداثة الرسم',
            pending: 'Graft: يتحقّق من حداثة الرسم',
            pendingAction: 'يتحقّق'
          },
          grep: { done: 'Graft: بحث في الفهرس', pending: 'Graft: يبحث في الفهرس', pendingAction: 'يبحث' },
          map: { done: 'Graft: رسم خريطة المستودع', pending: 'Graft: يرسم خريطة المستودع', pendingAction: 'يرسم' },
          skeleton: { done: 'Graft: قرأ واجهة الملف', pending: 'Graft: يقرأ واجهة الملف', pendingAction: 'يقرأ' }
        },
        titlesWithTarget: {
          ask: { done: target => `Graft: سأل عن «${target}»`, pending: target => `Graft: يسأل عن «${target}»` },
          callers: { done: target => `Graft: تتبّع ${target}`, pending: target => `Graft: يتتبّع ${target}` },
          grep: { done: target => `Graft: بحث عن «${target}»`, pending: target => `Graft: يبحث عن «${target}»` },
          skeleton: { done: target => `Graft: قرأ واجهة ${target}`, pending: target => `Graft: يقرأ واجهة ${target}` }
        }
      },
      titleTemplates: {
        actionCommand: (action, command) => `${action} ${command}`,
        actionQuoted: (action, value) => `${action} “${value}”`,
        actionTarget: (action, target) => `${action} ${target}`,
        prefixedDone: (prefix, action) => `${prefix} ${action}`,
        runningPrefixedTool: (prefix, action) => `جار تشغيل ${prefix.toLowerCase()} ${action.toLowerCase()}`,
        runningTool: action => `جار تشغيل ${action.toLowerCase()}`
      },
      titles: {
        browser_click: {
          done: 'تم النقر على عنصر الصفحة',
          pending: 'جار النقر على عنصر الصفحة',
          pendingAction: 'جار النقر'
        },
        browser_fill: {
          done: 'تم ملء حقل النموذج',
          pending: 'جار ملء حقل النموذج',
          pendingAction: 'جار الملء'
        },
        browser_navigate: {
          done: 'تم فتح الصفحة',
          pending: 'جار فتح الصفحة',
          pendingAction: 'جار الفتح'
        },
        browser_snapshot: {
          done: 'تم التقاط لقطة الصفحة',
          pending: 'جار التقاط لقطة الصفحة',
          pendingAction: 'جار الالتقاط'
        },
        browser_take_screenshot: {
          done: 'تم التقاط لقطة الشاشة',
          pending: 'جار التقاط لقطة الشاشة',
          pendingAction: 'جار الالتقاط'
        },
        browser_type: {
          done: 'تمت الكتابة على الصفحة',
          pending: 'جار الكتابة على الصفحة',
          pendingAction: 'جار الكتابة'
        },
        clarify: {
          done: 'تم طرح سؤال',
          pending: 'جار طرح سؤال',
          pendingAction: 'جار السؤال'
        },
        cronjob: {
          done: 'مهمة مجدولة',
          pending: 'جار جدولة المهمة',
          pendingAction: 'جار الجدولة'
        },
        edit_file: {
          done: 'تم تحرير الملف',
          pending: 'جار تحرير الملف',
          pendingAction: 'جار التحرير'
        },
        execute_code: {
          done: 'تم تشغيل الكود',
          pending: 'جار البرمجة',
          pendingAction: 'جار البرمجة'
        },
        image_generate: {
          done: 'تم إنشاء الصورة',
          pending: 'جار إنشاء الصورة',
          pendingAction: 'جار الإنشاء'
        },
        list_files: {
          done: 'تم سرد الملفات',
          pending: 'جار سرد الملفات',
          pendingAction: 'جار السرد'
        },
        memory: {
          done: 'تم الحفظ في الذاكرة',
          pending: 'جار الحفظ في الذاكرة',
          pendingAction: 'جار الحفظ'
        },
        patch: {
          done: 'تم تصحيح الملف',
          pending: 'جار تصحيح الملف',
          pendingAction: 'جار التصحيح'
        },
        read_file: {
          done: 'تمت قراءة الملف',
          pending: 'جار قراءة الملف',
          pendingAction: 'جار القراءة'
        },
        search_files: {
          done: 'تم البحث في الملفات',
          pending: 'جار البحث في الملفات',
          pendingAction: 'جار البحث'
        },
        session_search_recall: {
          done: 'تم البحث في سجل الجلسة',
          pending: 'جار البحث في سجل الجلسة',
          pendingAction: 'جار البحث'
        },
        terminal: {
          done: 'تم تشغيل الأمر',
          pending: 'جار تشغيل الأمر',
          pendingAction: 'جار التشغيل'
        },
        todo: {
          done: 'تم تحديث المهام',
          pending: 'جار تحديث المهام',
          pendingAction: 'جار التحديث'
        },
        vision_analyze: {
          done: 'تم تحليل الصورة',
          pending: 'جار تحليل الصورة',
          pendingAction: 'جار التحليل'
        },
        web_extract: {
          done: 'تمت قراءة صفحة الويب',
          pending: 'جار قراءة صفحة الويب',
          pendingAction: 'جار القراءة'
        },
        web_search: {
          done: 'تم البحث في الويب',
          pending: 'جار البحث في الويب',
          pendingAction: 'جار البحث'
        },
        write_file: {
          done: 'تم تحرير الملف',
          pending: 'جار تحرير الملف',
          pendingAction: 'جار التحرير'
        }
      }
    },
    mcpSetup: {
      toolCount: count => (count === 1 ? 'أداة واحدة' : `${count} أدوات`),
      installed: server => `تم تثبيت ${server}`,
      failed: server => `فشل إعداد ${server}`,
      authorizeTitle: 'هل تريد تفويض خوادم MCP؟',
      authorized: server => `تم تفويض ${server}`,
      enableTitle: 'هل تريد تفعيل خوادم MCP؟',
      enabled: server => `تم تفعيل ${server}`,
      installTitle: 'هل تريد إضافة خوادم MCP؟',
      authorizeAction: 'تفويض',
      enableAction: 'تفعيل',
      envRequired: 'أدخل بيانات الاعتماد المطلوبة أولا',
      gatewayDisconnected: 'بوابة Sbar Rafiq غير متصلة',
      installAction: 'تثبيت',
      reloadFailed: 'تم حفظ الخادم، لكن فشلت إعادة تحميل أدوات MCP: ستُحمّل في الجلسة القادمة',
      sendFailed: 'تعذر إرسال رد إعداد MCP'
    }
  }
} satisfies Pick<TranslationOverrides, 'assistant'>
