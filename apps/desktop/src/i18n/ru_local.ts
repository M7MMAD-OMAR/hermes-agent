import type { TranslationOverrides } from './define-locale'

// RU_PLURAL: (count, one, few, many) — русские формы сущ. падежа
// RU_NOUN: (count, one, few, many) — формы род. множественного
// count может быть number или string (часть подписей en.ts передаёт строки)
const ruNum = (count: number | string) => (typeof count === 'string' ? Number(count) || 0 : count)

const RU_PLURAL = (count: number | string, one: string, few: string, many: string) => {
  const c = ruNum(count)
  const n = Math.abs(c) % 10
  const nn = Math.abs(c) % 100

  return n === 1 && nn !== 11 ? one : n >= 2 && n <= 4 && (nn < 12 || nn > 14) ? few : many
}

const RU_NOUN = (count: number | string, one: string, few: string, many: string) => {
  const c = ruNum(count)
  const n = Math.abs(c) % 10
  const nn = Math.abs(c) % 100

  return n === 1 && nn !== 11 ? one : n >= 2 && n <= 4 && (nn < 12 || nn > 14) ? few : many
}

/** Local-only strings: translations of the keys this fork adds on top of upstream,
 *  merged over the locale by `ru.ts`. Upstream copy lives in the sectioned files. */
export const ruLocal: TranslationOverrides = {
  sharedMetrics: {
    unavailable: 'Обновите бэкенд Sbar Rafiq, чтобы изменить этот параметр.'
  },
  sessionImport: {
    subtitle: 'Перенесите разговор в Sbar Rafiq и продолжите с того места, где остановились.',
    chooseHelp: 'Выберите сессию, чтобы прочитать историю перед импортом в Sbar Rafiq.',
    snapshot: 'Этот разговор уже есть в Sbar Rafiq. Откройте существующую копию, чтобы продолжить.',
    open: 'Открыть в Sbar Rafiq',
    continue: 'Продолжить в Sbar Rafiq'
  },
  boot: {
    ready: 'Sbar Rafiq Desktop готов',
    steps: {
      loadingSettings: 'Загрузка настроек Sbar Rafiq',
      retryingRemoteBackend: 'Переподключение к удалённому бэкенду Sbar Rafiq…',
      startingHermesDesktop: 'Запуск Sbar Rafiq Desktop…'
    },
    errors: {
      backgroundExited: 'Фоновый процесс Sbar Rafiq завершён.',
      backgroundExitedDuringStartup: 'Фоновый процесс Sbar Rafiq завершился при запуске.',
      restartHermes: 'Перезапустить Hermes',
      openLogs: 'Открыть журналы',
      gatewayConnectionLostDetail:
        'Всё ещё пытаемся переподключиться. Вы можете продолжать читать и писать черновики. Если это затянется, переподключитесь сейчас или проверьте настройки подключения.',
      reconnectNow: 'Переподключиться сейчас',
      connectionSettings: 'Настройки подключения',
      gatewaySignInRequiredDetail: 'Войдите снова, чтобы переподключиться. Ваши чаты и настройки в безопасности.',
      signInAgain: 'Войти снова'
    },
    failure: {
      title: 'Sbar Rafiq не удалось запустить',
      details: 'Подробности',
      cloudDownTitle: 'Облачный агент Nous Cloud недоступен',
      cloudDownDescription:
        'Облачный агент под управлением Nous, к которому подключается этот шлюз, возвращает ошибку сервера. Перезапустить его отсюда нельзя: проверьте его статус, переключитесь на локальный шлюз или обратитесь в поддержку.',
      cloudDownHint: 'Кнопки ниже открывают Nous Portal (статус и управление экземпляром) и наш Discord для поддержки.',
      cloudDownCheckPortal: 'Проверить статус в Portal',
      cloudDownDiscord: 'Получить помощь в Discord'
    },
    causes: {
      exitedEarly: 'Фоновая служба Hermes остановилась сразу после запуска.',
      timedOut: 'Фоновая служба Hermes не ответила вовремя.',
      permission: 'Hermes не смог записать в свою папку данных (проблема с правами доступа).',
      diskFull: 'Диск заполнен, поэтому Hermes не смог запуститься.',
      portInUse: 'Нужный Hermes сетевой порт занят другой программой.',
      installMissing: 'Часть установки Hermes отсутствует. Выберите «Восстановить установку», чтобы вернуть её.'
    }
  },
  settings: {
    plugins: {
      installModal: {
        installUncertain:
          'Sbar Rafiq перестал ждать результат установки, но плагин может всё ещё устанавливаться. Закройте это окно и обновите список плагинов перед повторной установкой.'
      }
    }
  },
  sidebar: {
    projects: {
      readOnly: 'Только чтение',
      readOnlyHint:
        'Защищает папку в новых локальных терминалах Linux. Уже работающие терминалы сохраняют прежние разрешения.',
      staleBackend:
        'Обновите бэкенд Sbar Rafiq, чтобы создавать проекты — ваш бэкенд старше этого desktop-приложения (Настройки → Обновления → Бэкенд).',
      deleteConfirm: 'Это удалит сохранённый проект из Sbar Rafiq. Файлы, git-репозитории и worktrees не пострадают.',
      worktreeStaleBackend:
        'Обновите бэкенд Sbar Rafiq, чтобы создавать worktrees по этому удалённому соединению — он старше git worktree API.',
      folderNeedsAttention: 'Папки с исходниками требуют внимания',
      folderMissing: 'Папка не найдена',
      folderUnavailable: 'Папка недоступна',
      folderNotDirectory: 'Этот путь ведёт к файлу, а не к папке',
      reconnectFolder: 'Переподключить',
      editTitle: 'Изменить проект',
      editDesc:
        'Управляйте папками с исходниками. Изменение пути переподключает существующие задачи без перемещения файлов. Основная папка используется для новых задач.',
      changeFolder: 'Изменить путь к папке',
      makePrimary: 'Сделать основной',
      autoDiscovered: 'Найдено автоматически',
      menuTransfer: 'Переместить в профиль…',
      transferHint: 'Папки остаются на своих местах на диске. Переносятся проект и его разговоры.',
      transferTarget: 'Профиль',
      transferNoTargets: 'Нет другого профиля, куда можно это переместить.',
      transferFoldersStay: 'Ни одна папка на диске не перемещается, не переименовывается и не удаляется.',
      transferMove: 'Переместить вместо копирования',
      transferMoveHint:
        'Разговоры здесь будут архивированы, а проект исчезнет из этой боковой панели. Приложение не сможет это отменить.',
      transferConfirmCopy: 'Копировать',
      transferConfirmMove: 'Переместить',
      transferTitle: name => `Переместить «${name}» в другой профиль`,
      transferCarries: (sessions, messages) =>
        `Переносится ${sessions} ${RU_NOUN(sessions, 'разговор', 'разговора', 'разговоров')}, ${messages} ${RU_NOUN(messages, 'сообщение', 'сообщения', 'сообщений')}.`,
      transferDone: (sessions, profile) =>
        `Перенесено в ${profile}: ${sessions} ${RU_NOUN(sessions, 'разговор', 'разговора', 'разговоров')}.`,
      transferWorking: sessions =>
        `Переносим ${sessions} ${RU_NOUN(sessions, 'разговор', 'разговора', 'разговоров')}\u2026`,
      transferPartial: failed => `Не удалось перенести: ${failed}. Повторный запуск перенесёт только недостающее.`
    }
  },
  onboarding: {
    headerTitle: 'Настроим для вас Sbar Rafiq Agent',
    preparingInstall: 'Sbar Rafiq завершает установку. Обычно это занимает меньше минуты при первом запуске.',
    starting: 'Запускаем Sbar Rafiq…',
    featuredPitch: 'Одна подписка, 300+ передовых моделей — рекомендуемый способ запускать Sbar Rafiq',
    apiKeyOptions: {
      local: {
        short: 'свой сервер',
        description:
          'Укажите Sbar Rafiq локальный или self-hosted OpenAI-совместимый endpoint (vLLM, llama.cpp, Ollama и т.д.).'
      }
    },
    flowSubtitles: {
      device_code: 'Откроет страницу подтверждения в браузере — Sbar Rafiq подключится автоматически'
    },
    authorizeThere: 'Авторизуйте Sbar Rafiq там.',
    free: 'Бесплатно',
    localModelsTitle: 'Запускать модели локально',
    localModelsPitch: 'Аккаунт не нужен: скачайте модель и запустите её на этом компьютере',
    signInExpired:
      'Время страницы входа истекло до того, как вы закончили. Попробуйте снова и завершите шаг в браузере в течение нескольких минут или используйте API-ключ.',
    tryAgain: 'Повторить',
    useApiKeyInstead: 'Использовать API-ключ',
    errorDetails: 'Подробности',
    signInDidNotFinish: provider =>
      `Вход через ${provider} не завершён. Проверьте подключение к интернету и повторите попытку или выберите другого провайдера.`
  },
  assistant: {
    clarify: {
      gatewayDisconnected: 'Шлюз Sbar Rafiq не подключён'
    }
  },
  connectorsPage: {
    title: 'Коннекторы',
    filterCategory: 'Категория',
    categoryAll: 'Все категории',
    uncategorised: 'Без категории',
    residencyLocal: 'На этом устройстве',
    segment: {
      all: 'Все',
      available: 'Доступные',
      connected: 'Подключённые',
      off: 'Выключенные'
    },
    group: {
      connected: 'Подключённые',
      connectedNote: 'Сначала сломанные подключения.',
      available: 'Доступные',
      off: 'Выключенные',
      offNote: 'Входы в аккаунты сохраняются.'
    },
    card: {
      kindManaged: 'Управляемый',
      kindCatalog: 'MCP · Каталог',
      kindCustom: 'MCP · Свой',
      inCatalog: 'В каталоге Sbar Rafiq',
      hostedTwin: 'Доступна управляемая версия',
      alsoLocal: 'Также работает на этом устройстве',
      state: {
        accessExpired: 'Доступ истёк',
        available: 'Доступно',
        connected: 'Подключено',
        connecting: 'Подключение',
        connectionUnknown: 'Состояние неизвестно',
        couldNotConnect: 'Не удалось подключиться',
        offByYourOrganisation: 'Выключено вашей организацией',
        offForYou: 'Выключено для вас',
        serverConnecting: 'Подключение…',
        serverError: 'Ошибка',
        serverNeedsAuth: 'Нужна аутентификация',
        serverOff: 'Выкл.',
        serverOn: 'Вкл.',
        serverOnUnused: 'Вкл., не используется'
      },
      verb: {
        authenticate: 'Войти',
        connect: 'Подключить',
        install: 'Установить',
        openLogs: 'Открыть журналы',
        reconnect: 'Переподключить',
        stopWaiting: 'Перестать ждать',
        tryAgain: 'Повторить',
        turnBackOn: 'Снова включить'
      },
      reason: {
        finishSignIn: 'Завершите вход в браузере.',
        reconnect: 'Переподключитесь, чтобы приложение продолжало работать.',
        serverError: 'Сервер отклонил подключение.',
        serverNeedsAuth: 'Войдите, чтобы этот сервер мог отвечать.'
      },
      kindPlugin: plugin => `MCP · Плагин ${plugin}`,
      open: name => `Открыть ${name}`,
      turnServerOn: name => `Включить ${name}`,
      turnServerOff: name => `Выключить ${name}`,
      fact: {
        tools: count => `${count} ${RU_PLURAL(count, 'инструмент', 'инструмента', 'инструментов')}`,
        toolsOff: count =>
          `${count} ${RU_PLURAL(count, 'инструмент выключен', 'инструмента выключено', 'инструментов выключено')}`,
        toolsOn: count =>
          `${count} ${RU_PLURAL(count, 'инструмент включён', 'инструмента включено', 'инструментов включено')}`,
        toolsSomeOn: (total, on) =>
          `${total} ${RU_PLURAL(total, 'инструмент', 'инструмента', 'инструментов')}, включено ${on}`
      }
    },
    page: {
      loading: 'Читаем каталог и серверы на этом компьютере',
      emptyTitle: 'Здесь пока нет приложений. Добавьте сервер на этом компьютере, чтобы начать.',
      noMatchTitle: 'Подходящих приложений нет',
      noMatchBody: 'Ничего не найдено. Укажите Sbar Rafiq свой MCP-сервер, чтобы добавить его.',
      clearSearch: 'Очистить поиск',
      hostedFailedTitle: 'Не удалось связаться с облачными приложениями.',
      hostedFailedBody: 'Серверы на этом компьютере не затронуты и продолжают работать. Ничего не было выключено.',
      retry: 'Повторить',
      showAllMatches: 'Показать все совпадения',
      freeTierNote: 'Подключения остаются на этом компьютере, пока вы не войдёте.',
      signInLine: 'Войдите в Nous, чтобы пользоваться управляемыми приложениями.',
      signIn: 'Войти',
      managedUnavailable: 'Управляемые приложения пока недоступны для этого аккаунта.',
      writeFailed: 'Это изменение не сохранено.',
      refreshFailed: 'Список инструментов не обновлён.',
      disconnectNoAccount:
        'У Sbar Rafiq нет аккаунта, который можно здесь отключить. Обновите страницу и попробуйте снова.',
      disconnectRefused:
        'Nous сейчас не может удалить этот вход. Выключите приложение переключателем или попробуйте позже.',
      matchesElsewhere: count =>
        `Ещё ${count} ${RU_PLURAL(count, 'совпадение', 'совпадения', 'совпадений')} в других группах.`,
      segmentNoMatch: segment => `В разделе «${segment}» совпадений нет, поэтому показаны все совпадения.`
    },
    add: {
      action: 'Добавить свой',
      title: 'Подключить свой MCP',
      hint: 'одна новая запись в mcp.json на этом устройстве',
      pasteLabel: 'Вставьте команду или фрагмент',
      pastePlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/dir',
      pasteNoMatch: 'Здесь не удалось распознать сервер. Заполните поля ниже.',
      name: 'Имя',
      nameTaken: 'Это имя уже занято.',
      type: 'Тип',
      typeStdio: 'STDIO',
      typeHttp: 'Streamable HTTP',
      command: 'Команда запуска',
      args: 'Аргументы',
      addArg: '+ Добавить аргумент',
      envVars: 'Переменные окружения',
      addEnvVar: '+ Добавить переменную окружения',
      passthrough: 'Проброс переменных окружения',
      addPassthrough: '+ Добавить переменную',
      cwd: 'Рабочий каталог',
      url: 'URL',
      headers: 'Заголовки',
      addHeader: '+ Добавить заголовок',
      auth: 'Аутентификация',
      authNone: 'Нет',
      authOauth: 'OAuth',
      authBearer: 'Bearer-токен',
      keyPlaceholder: 'КЛЮЧ',
      valuePlaceholder: 'значение',
      removeRow: 'Удалить эту строку',
      editJson: 'Редактировать mcp.json',
      saveFailed: 'Сервер не сохранён.'
    },
    dialog: {
      disconnect: 'Отключить',
      disconnectBody:
        'Sbar Rafiq перестанет действовать от имени этого аккаунта. Подключиться снова можно в любой момент.',
      menuRefreshTools: 'Обновить инструменты',
      moreActions: 'Другие действия',
      removeServerBody: 'Запись будет удалена из mcp.json на этом компьютере. Больше ничего не удаляется.',
      wayHosted: 'Управляемый',
      turnOffLocal: 'Выключить локальный сервер',
      openPlugins: 'Открыть вкладку «Плагины»',
      nousLine: 'Приложения Nous привязаны к вашему аккаунту, а не к профилю.',
      rulesReadOnly: 'Правила сейчас нельзя изменить.',
      rulesSignIn: 'Войдите, чтобы изменить, что Sbar Rafiq может здесь делать.',
      orgLink: 'Открыть управление коннекторами',
      connectEnded: 'Вход не был завершён.',
      connectOpenAgain: 'Открыть ссылку снова',
      tokensPerCall: 'токенов за вызов',
      usesPerMonth: 'использований за 30 дней',
      advanced: 'Дополнительно',
      advancedHint: 'запись в mcp.json и журналы',
      disconnectTitle: name => `Отключить ${name}?`,
      removeServerTitle: name => `Удалить ${name}?`,
      appSwitch: name => `Sbar Rafiq может использовать ${name}`,
      waysTitle: name => `Где работает ${name}`,
      wayNotConnected: name => `Ещё не подключено. Войдите в ${name} в браузере.`,
      bothOn: name => `Включены оба, поэтому Sbar Rafiq видит каждый инструмент ${name} дважды.`,
      providedByPlugin: plugin => `Предоставлено плагином ${plugin}`,
      rulesAppOff: name => `Включите ${name}, чтобы изменить его инструменты.`,
      orgNote: count =>
        `Ваша организация выключила ${count} ${RU_NOUN(count, 'инструмент', 'инструмента', 'инструментов')}.`
    },
    tools: {
      title: 'Инструменты',
      notInstalledBody: 'Установите его на этом устройстве, чтобы увидеть его инструменты.',
      summaryAllTools: 'Все инструменты',
      summaryOther: 'Прочее',
      allToolsSwitch: 'Включить или выключить все инструменты',
      summaryAllOn: 'все включены',
      summaryOff: 'выкл.',
      showSummary: 'Показать сводку',
      staleSignIn: 'Войдите, чтобы получить актуальный список инструментов.',
      quickReadOnly: 'Только чтение',
      quickNoDestructive: 'Выключить разрушающие',
      quickEverythingOn: 'Всё включено',
      lockedHint: 'выключено вашей организацией',
      noMatch: 'Под эти фильтры не подходит ни один инструмент.',
      loading: 'Читаем список инструментов',
      unavailableLine: 'Список инструментов недоступен.',
      needsAuthBody: 'Вход остаётся на этом компьютере. Ничего не покидает его.',
      retry: 'Повторить',
      goneBody:
        'Sbar Rafiq больше не может его вызывать. Строка останется, пока вы её не удалите, чтобы ничего не исчезало.',
      remove: 'Удалить',
      offBody: 'Включите его переключателем выше, чтобы увидеть его инструменты.',
      signedOutTitle: 'Войдите в Nous, чтобы увидеть список инструментов.',
      signedOutBody: 'Ваши серверы на этом компьютере не затронуты.',
      conflictTitle: 'Кто-то изменил это правило, пока вы его редактировали.',
      conflictReload: 'Загрузить их версию',
      conflictSave: 'Сохранить поверх их версии',
      saveFailed: 'Правила инструментов не сохранены.',
      discard: 'Отменить',
      save: 'Сохранить изменения',
      saving: 'Сохранение...',
      summaryTitle: name => `Что Sbar Rafiq может делать с ${name}`,
      summaryPreviewTitle: name => `Что Sbar Rafiq сможет делать с ${name} после подключения`,
      summaryCount: count => `${count} ${RU_PLURAL(count, 'инструмент', 'инструмента', 'инструментов')}`,
      summarySomeOn: (on, total) => `Включено ${on} из ${total}`,
      showAllTools: count => `Показать все инструменты (${count})`,
      facetSwitch: facet => `Включить или выключить инструменты категории «${facet}»`,
      moreHints: count => `+${count}`,
      searchCountPlaceholder: count =>
        `Поиск среди ${count} ${RU_NOUN(count, 'инструмента', 'инструментов', 'инструментов')}`,
      toolList: name => `Инструменты ${name}`,
      categorySelect: count => `${count} ${RU_PLURAL(count, 'категория', 'категории', 'категорий')}`,
      showDeprecated: count => `Показать устаревшие (${count})`,
      hideDeprecated: count => `Скрыть устаревшие (${count})`,
      turnToolOn: tool => `Включить ${tool}`,
      turnToolOff: tool => `Выключить ${tool}`,
      showDetails: tool => `Показать, что делает ${tool}`,
      hideDetails: tool => `Скрыть, что делает ${tool}`,
      needsAuthTitle: name => `Войдите в ${name}, чтобы увидеть его инструменты.`,
      goneTitle: name => `${name} удалён из каталога.`,
      offTitle: name => `${name} выключен.`,
      conflictBody: (theyOff, theyOn) => {
        const they = [
          theyOff > 0
            ? `выключил ${theyOff} ${RU_NOUN(theyOff, 'инструмент', 'инструмента', 'инструментов')}, которые у вас включены`
            : '',
          theyOn > 0
            ? `оставил включёнными ${theyOn} ${RU_NOUN(theyOn, 'инструмент', 'инструмента', 'инструментов')}, которые вы выключили`
            : ''
        ].filter(Boolean)
        return `${they.length > 0 ? `Другой пользователь ${they.join(' и ')}. ` : ''}Ваши правки остаются на экране, ничего не записано.`
      },
      footerDirty: (off, backOn) => `Выключено: ${off}, снова включено: ${backOn === 0 ? 'ни одного' : backOn}`
    },
    vocabulary: {
      facetRead: {
        label: 'Чтение',
        long: 'Читает данные из этого приложения. Ничего не меняет.'
      },
      facetWrite: {
        label: 'Запись',
        long: 'Создаёт или изменяет что-то в этом приложении.'
      },
      facetDestructive: {
        label: 'Разрушающее',
        long: 'Может безвозвратно удалить что-то в этом приложении.'
      },
      facetUnclassified: {
        label: 'Неизвестное действие',
        long: 'Приложение не сообщило, что делает этот инструмент.'
      },
      hintReadOnly: {
        label: 'Только чтение',
        long: 'Инструмент заявляет, что только читает.'
      },
      hintCreate: {
        label: 'Создаёт',
        long: 'Создаёт что-то новое.'
      },
      hintUpdate: {
        label: 'Изменяет',
        long: 'Изменяет что-то уже существующее.'
      },
      hintDelete: {
        label: 'Удаляет',
        long: 'Удаляет что-то.'
      },
      hintDestructive: {
        label: 'Разрушающее',
        long: 'Сделанное им изменение здесь нельзя отменить.'
      },
      hintIdempotent: {
        label: 'Повторяемое',
        long: 'Два запуска дают тот же результат, что и один.'
      },
      hintOpenWorld: {
        label: 'Внешнее',
        long: 'Обращается к чему-то за пределами этого приложения.'
      }
    },
    searchPlaceholder: count => `Поиск среди ${count} ${RU_NOUN(count, 'приложения', 'приложений', 'приложений')}`
  },
  freeTier: {
    providerRowTitle: 'Nous · бесплатный тариф',
    providerRowPitch: 'Войдите с аккаунтом Nous, чтобы открыть больше моделей и инструментов.',
    readyTitle: 'Sbar Rafiq готов.',
    readyCaption: 'Бесплатно · коннекторы включены',
    begin: 'Начать',
    signInInstead: 'Войти с аккаунтом Nous',
    otherProviders: 'Другие провайдеры',
    stripTitle: 'Теперь доступны бесплатный инференс Nous и коннекторы.',
    stripBody: 'Откройте выбор модели, чтобы попробовать их, или войдите с аккаунтом Nous.',
    openModelPicker: 'Открыть выбор модели',
    dismiss: 'Скрыть',
    signIn: 'Войти',
    signInHeading: 'Войдите с аккаунтом Nous, чтобы открыть больше моделей и инструментов.',
    settingUp: 'Настраиваем бесплатный инференс…',
    codeBody: 'Введите этот код в браузере, чтобы завершить вход.',
    copyLink: 'Копировать ссылку',
    doNotShare: 'Никому не сообщайте этот код.',
    waiting: 'Ожидание входа…',
    finishingHeading: 'Завершаем вход…',
    finishingBody: 'Подтверждено в браузере. Получаем токены вашего аккаунта.',
    signedIn: 'Вход выполнен.',
    completedBody: 'Теперь ваш аккаунт даёт доступ к инференсу и инструментам.',
    defaultModel: 'Модель по умолчанию',
    change: 'Изменить',
    done: 'Готово',
    notNow: 'Не сейчас',
    tryAgain: 'Повторить',
    startAgain: 'Начать заново',
    didNotComplete: 'Вход не завершён',
    rejectedBody:
      'Ничего страшного, вы по-прежнему пользуетесь бесплатным сервисом Nous. Войдите, когда будете готовы.',
    supersededBody: 'Этот код входа заменён более новым. Используйте самый новый или начните заново.',
    timedOutHeading: 'Срок действия ссылки для входа истёк',
    timedOutBody: 'Начните заново, когда будете готовы. Вы по-прежнему пользуетесь бесплатным сервисом Nous.',
    retiredBody:
      'Ваша сессия завершилась до окончания входа. Sbar Rafiq начнёт новую, после чего войдите снова, когда будете готовы.',
    errorBody: 'Вход не завершён. Повторите попытку, когда будете готовы.',
    busyHeading: 'Почти готово',
    unreachableBody:
      'Sbar Rafiq не удалось связаться с сервисом Nous, чтобы завершить вход. Проверьте подключение к интернету и повторите попытку. Ваша сессия сохранена.',
    alreadySignedInHeading: 'Вход уже выполнен.',
    alreadySignedInBody: 'Этот Sbar Rafiq уже вошёл в аккаунт Nous.',
    setupFailed: {
      gateClosed:
        'Эта версия Sbar Rafiq не запускается без аккаунта Nous. Войдите или создайте аккаунт, это бесплатно и займёт минуту.',
      paused:
        'Использование Sbar Rafiq без входа ненадолго приостановлено. Sbar Rafiq продолжит проверять. Вход бесплатный и позволит начать прямо сейчас.',
      unreachable:
        'Sbar Rafiq не удалось связаться с сервисом Nous. Проверьте подключение к интернету и нажмите «Повторить». Или пока подключите другого провайдера.',
      serverError:
        'В сервисе Nous произошёл сбой. Нажмите «Повторить» чуть позже или пока подключите другого провайдера.',
      powRequired:
        'Сервер Nous запросил доказательство работы (proof of work), но в вашем агенте это пока не реализовано. Войдите или создайте бесплатный аккаунт Nous, чтобы продолжить.',
      locked: 'Эту сессию нельзя продолжить без входа. Войдите или создайте бесплатный аккаунт Nous, чтобы продолжить.',
      generic:
        'Sbar Rafiq не удалось настроить бесплатный доступ без входа. Вход бесплатный, или подключите другого провайдера.',
      signInBelow: 'Вход бесплатный. Выберите Nous ниже.',
      tryAgain: 'Повторить',
      retrying: 'Повторяем…',
      rateLimited: wait =>
        `Сейчас начинают работу очень многие, поэтому Sbar Rafiq повторит попытку через ${wait}. Вход бесплатный и позволяет не ждать.`
    },
    statusLabel: model => `Nous · ${model}`,
    signedInAs: email => `Вход выполнен как ${email}`,
    busyBody: wait =>
      `Sbar Rafiq не удалось завершить вход, потому что сервис Nous перегружен. Повторите через ${wait}. Ваша сессия пока сохранена.`
  },
  connectors: {
    title: 'Подключите свои приложения',
    connect: 'Подключить',
    skip: 'Не сейчас',
    cancel: 'Перестать ждать',
    retry: 'Повторить',
    grant: 'Переподключить',
    connected: 'Подключено',
    checking: 'Проверяем ваши приложения…',
    notConnected: 'Не подключено',
    skipped: 'Пропущено',
    disabled: 'Недоступно',
    failed: 'Не удалось подключиться',
    needsAuth: 'Доступ истёк',
    opening: 'Открываем вход…',
    waiting: 'Ожидаем ваш браузер…',
    timeout: 'Всё ещё ждём авторизации.',
    refresh: 'Обновить статус',
    connectError: 'Не удалось начать авторизацию. Повторите попытку.',
    unavailable: 'Коннекторы недоступны для этой сессии.',
    ownerMissing: 'Откройте этот разговор заново, чтобы управлять его подключениями.',
    search: 'Найти приложение',
    empty: 'Подходящих приложений нет',
    disclaimer: 'Подключение необязательно. Авторизуйте только те приложения, которыми Sbar Rafiq должен пользоваться.',
    execution: 'Инструменты коннекторов',
    openInBrowser: 'Открыть в браузере',
    setupCancel: 'Отмена',
    authorizedToolsUnavailable: 'Авторизовано. Инструменты недоступны.',
    required: 'Обязательно',
    connectErrorFor: app => `Не удалось начать авторизацию для ${app}.`,
    setup: server => `Настроить ${server}`
  },
  sendDiagnostics: {
    title: 'Отправить диагностику в Nous',
    privacyNotice:
      'Будет загружен отладочный пакет во внутреннее хранилище Nous (не публичная вставка). Он содержит сведения о системе (ОС, версии, провайдер, какие API-ключи настроены, но никогда сами ключи) и полные журналы агента, шлюза и приложения (до 512 КБ каждый), которые, скорее всего, содержат содержимое разговоров, результаты инструментов и пути к файлам. Секреты удаляются перед загрузкой. Пакет доступен только сотрудникам Nous и разрешённым модераторам Discord и автоматически удаляется через 14 дней.',
    upload: 'Загрузить',
    uploading: 'Загрузка…',
    cancel: 'Отмена',
    close: 'Закрыть',
    copyLink: 'Копировать ссылку',
    doneTitle: 'Диагностика отправлена',
    doneDescription:
      'Ваш пакет загружен приватно. Поделитесь ссылкой ниже в своей теме поддержки, чтобы команда могла посмотреть журналы.',
    failedTitle: 'Загрузка не удалась',
    failedHint:
      'Также можно выполнить `hermes debug share --nous` в терминале или `hermes debug share --local`, чтобы вывести отчёт без загрузки.',
    handoffLead: 'Продолжите обсуждение в:',
    links: {
      portal: 'Поддержка Nous Portal'
    },
    uploadIdFallback: id => `Ссылка для просмотра не получена. Сообщите в поддержку ID загрузки ${id}`
  }
}
