import type { TranslationOverrides } from './define-locale'

export const zhHantAssistant = {
  assistant: {
    catalogInstall: {
      preparing: '正在準備安裝…',
      install: '安裝',
      advanced: '進階',
      skip: '略過',
      installing: '正在安裝…',
      installed: '已安裝',
      notInstalled: '未安裝',
      failed: '失敗',
      showNames: '顯示名稱',
      hideNames: '隱藏名稱',
      skill: name => `技能 ${name}`,
      kind: { plugin: '外掛', skill: '技能' },
      tier: { official: '官方', community: '社群' },
      targetProfile: profile => `安裝到你的 ${profile} 設定檔`,
      sendFailed: '無法傳送你的回覆，請再試一次。',
      commitLabel: '提交',
      subdirLabel: '資料夾',
      securityHeading: '安全性',
      scan: { passed: '掃描通過', warnings: '掃描發現警告', failed: '掃描未通過' },
      requirementsLabel: '需求',
      credentialsHeading: '憑證'
    },
    thread: {
      loadingSession: '正在載入工作階段',
      showEarlier: '顯示較早的訊息',
      loadingResponse: 'Sbar Rafiq 正在載入回覆',
      resumeWhenBackgroundDone: count =>
        count === 1 ? '背景工作完成後將自動繼續' : `${count} 個背景工作完成後將自動繼續`,
      thinking: '思考中',
      thought: '已思考',
      thoughtBriefly: '思考了片刻',
      thoughtFor: duration => `思考了 ${duration}`,
      turnDuration: duration => `本輪耗時 ${duration}`,
      turnDigestNotes: count => `${count} 則說明`,
      turnOutcomeDelivered: '已交付',
      turnOutcomeFailed: '失敗',
      turnOutcomeOpen: '待處理',
      turnOutcomeTitle: '本輪結果',
      progressTitle: '任務進度',
      progressTask: '正在處理',
      progressEdit: '最近記錄的編輯',
      progressCheck: '最近通過的檢查',
      progressCheckOutdated: '檢查後發生了編輯',
      progressError: '最近回報的錯誤',
      progressRepeated: '重複操作',
      today: time => `今天，${time}`,
      yesterday: time => `昨天，${time}`,
      copy: '複製',
      refresh: '重新整理',
      moreActions: '更多動作',
      branchNewChat: '在新聊天中分支',
      react: '回應',
      dismissError: '关闭错误',
      errorGenericProvider: 'AI 服務',
      errorLayerBodies: {
        generic: 'Hermes 回覆時發生問題。請重試；若問題持續，請複製錯誤詳細資訊。',
        provider: 'AI 服務無法完成此請求。請稍後重試或切換服務商。',
        endpoint: 'Hermes 無法連線至你的自訂模型伺服器。請確認它正在執行，然後重新傳送訊息。',
        streaming: '回覆完成前連線已中斷。請重試以重新傳送。',
        auth: 'AI 服務拒絕了你的登入。請檢查此供應商的憑證，然後重新傳送訊息。',
        billing: '你在此供應商的帳戶已無剩餘額度。請儲值或切換供應商，然後重新傳送。',
        disk: '你的磁碟已滿，Sbar Rafiq 無法儲存此對話。請釋放一些空間後重試。',
        gateway: 'Sbar Rafiq 在開始回覆時遇到內部問題。請重新傳送訊息；如果問題持續發生，請傳送診斷資料。',
        runtime: 'Sbar Rafiq 在開始回覆時遇到內部問題。請重新傳送訊息；如果問題持續發生，請傳送診斷資料。'
      },
      errorCodes: {
        provider_policy_blocked: {
          title: '帳戶設定封鎖了此模型',
          body: provider => `${provider} 無法依你帳戶的資料或隱私設定路由此請求。請選擇其他模型或切換服務商。`
        },
        content_policy_blocked: {
          title: 'AI 服務拒絕回答此請求',
          body: provider => `${provider} 拒絕回答這則訊息。請修改後重新傳送。`
        },
        format_error: {
          title: 'AI 服務拒絕了請求格式',
          body: provider => `${provider} 不接受此請求的建構方式。請切換服務商，或傳送診斷資訊以便我們排查。`
        },
        invalid_response: {
          title: 'AI 服務傳回了無法讀取的回覆',
          body: provider => `${provider} 傳回了 Hermes 無法讀取的內容。請稍後重試。`
        },
        empty_response: {
          title: 'AI 服務傳回了空回覆',
          body: provider => `${provider} 沒有為此訊息傳回內容。請稍後重試。`
        },
        rate_limit: {
          title: 'AI 服務忙碌中',
          body: provider => `${provider} 正在限制請求數量。請稍等片刻後重試。`
        },
        upstream_rate_limit: {
          title: 'AI 服務忙碌中',
          body: provider => `${provider} 正在限制請求數量。請稍等片刻後重試。`
        },
        overloaded: {
          title: 'AI 服務負載過高',
          body: provider => `${provider} 目前遇到問題。請稍後重試或切換服務商。`
        },
        server_error: {
          title: 'AI 服務發生錯誤',
          body: provider => `${provider} 傳回了伺服器錯誤。請稍後重試或切換服務商。`
        },
        timeout: {
          title: '無法連線到 AI 服務',
          body: provider => `無法連線到 ${provider}，或其未及時回應。請檢查網路連線後重試。`
        },
        ssl_cert_verification: {
          title: '安全連線失敗',
          body: provider => `Hermes 無法驗證與 ${provider} 的安全連線。請檢查網路或代理設定，或切換服務商後重新傳送。`
        },
        billing: {
          title: '額度已用完',
          body: provider => `你的 ${provider} 帳戶已無剩餘額度。請儲值或切換供應商，然後重新傳送。`
        },
        stream_drop: {
          title: '回覆被中斷',
          body: '回覆完成前連線中斷了。請重試以重新傳送。'
        },
        upstream_blocked: {
          title: '防火牆封鎖了此請求',
          body: provider =>
            `${provider} 前方的防火牆或 CDN 在請求抵達模型前就將其封鎖，你的金鑰應該沒有問題。請在設定中透過供應商的 extra_headers 設定 User-Agent 標頭，或切換供應商，然後重新傳送訊息。`
        },
        context_overflow: {
          title: '此對話太長',
          body: '此對話已超出模型可容納的長度。請壓縮對話或開始新的聊天，然後重新傳送。'
        },
        payload_too_large: {
          title: '此訊息太大',
          body: '此請求對模型來說太大。請壓縮對話或開始新的聊天，然後重新傳送。'
        },
        model_not_found: {
          title: '無法使用此模型',
          body: provider =>
            `${provider} 未在你的帳戶上提供此模型。請選擇其他模型，然後重新傳送訊息。`
        },
        truncated: {
          title: '回覆提前結束',
          body: '模型在完成前就停止了。請重試以取得完整回覆。'
        },
        loop_error: {
          title: 'Sbar Rafiq 陷入迴圈',
          body: '回覆一直重複相同的步驟，因此 Sbar Rafiq 已將其停止。請重試；如果再次發生，請開始新的聊天。'
        },
        SESSION_NOT_OWNED: {
          title: '此聊天已在其他地方開啟',
          body: '此聊天目前已在另一個 Sbar Rafiq 視窗或終端機中開啟。請在那裡關閉後重新傳送訊息，或在這裡開始新的聊天。'
        },
        disk_full: {
          title: '磁碟已滿',
          body: '你的磁碟已滿，Sbar Rafiq 無法儲存此對話。請釋放一些空間後重試。'
        },
        free_tier_disabled: {
          title: '目前已關閉免登入使用 Sbar Rafiq',
          body: '使用 Nous 帳戶登入即可繼續聊天，完全免費。'
        },
        free_tier_rate_limited: {
          title: '你已用完免登入聊天的額度',
          body: '額度很快就會重置。使用 Nous 帳戶登入可獲得更多額度，完全免費。'
        },
        free_tier_at_capacity: {
          title: '目前免登入聊天非常繁忙',
          body: '登入即可略過排隊，完全免費；或稍後再試。'
        },
        free_tier_model_not_free: {
          title: '未登入時無法使用該模型',
          body: 'Sbar Rafiq 目前使用免費模型。使用 Nous 帳戶登入可使用更多模型，完全免費。'
        },
        free_tier_route: {
          title: 'Sbar Rafiq 無法透過此路由連上免費模型',
          body: '請使用 Nous 帳戶登入（完全免費），或檢查 NOUS_INFERENCE_BASE_URL 設定。'
        },
        free_tier_outage: {
          title: '免費模型目前回應有問題',
          body: '請稍候一分鐘再重新傳送訊息。'
        },
        free_tier_refused: {
          title: '未登入時 Sbar Rafiq 無法傳送此內容',
          body: '使用 Nous 帳戶登入是免費的。'
        },
        auth: {
          title: provider => `${provider} 拒絕了你的登入`,
          body: provider =>
            `${provider} 未接受已儲存的憑證。請在設定中修正或切換供應商，然後重新傳送訊息。`
        },
        auth_permanent: {
          title: provider => `${provider} 拒絕了你的登入`,
          body: provider =>
            `為 ${provider} 儲存的憑證無效或已被撤銷。請更新憑證或切換供應商，然後重新傳送訊息。`
        }
      },
      errorLayers: {
        auth: '認證錯誤',
        billing: '額度不足',
        disk: '磁碟已滿',
        endpoint: '自訂端點錯誤',
        gateway: '閘道錯誤',
        generic: '本輪失敗',
        provider: '模型服務商錯誤',
        runtime: '本機執行環境錯誤',
        streaming: '串流連線錯誤'
      },
      errorRetry: '重試',
      errorLimitResets: time => `限額將於 ${time} 重設`,
      errorRetryAtReset: time => `限額重設後重試（${time}）`,
      errorRetryScheduled: (time, wait) => `將於 ${time} 重試 — 還剩 ${wait}`,
      errorRetryScheduledCancel: '取消',
      errorStartNewSession: '開始新工作階段',
      errorSwitchProvider: '切換服務商',
      errorSignInAgain: provider => `重新登入 ${provider}`,
      errorOauthExpired: provider => `您的 ${provider} 登入已過期或被撤銷。請重新登入以繼續對話。`,
      errorOpenLogs: '開啟日誌',
      errorOpenLogsFailed: '無法開啟日誌資料夾',
      errorOpenDesktopLogs: '開啟桌面端日誌',
      errorCopyDiagnostics: '複製錯誤詳細資訊',
      errorSendDiagnostics: '傳送診斷資訊',
      filesChanged: count => `${count} 個檔案已變更`,
      reviewChanges: '檢視',
      readAloudFailed: '朗讀失敗',
      preparingAudio: '正在準備音訊...',
      stopReading: '停止朗讀',
      readAloud: '朗讀',
      copyFullResponse: '複製完整回覆',
      readAloudFullResponseHint: '按住 Shift 點擊：朗讀完整回覆',
      editMessage: '編輯訊息',
      stop: '停止',
      restorePrevious: '還原至上一個檢查點',
      restoreCheckpoint: '還原檢查點',
      restoreFromHere: '還原檢查點 — 從此提示重新執行',
      restoreTitle: '還原至此檢查點？',
      restoreBody: '此提示之後的所有訊息將從對話中移除，並從此處重新執行該提示。',
      restoreConfirm: '還原並重新執行',
      restoreNext: '還原至下一個檢查點',
      goForward: '前進',
      sendEdited: '傳送編輯後的訊息',
      attachingFile: '正在附加…',
      processingPrompt: '正在處理提示詞',
      errorDetails: '詳細資料',
      errorToastTitle: 'Hermes 無法完成回覆',
      errorChooseModel: '選擇模型',
      errorCompressConversation: '壓縮對話',
      errorCompressFailed: '無法壓縮對話',
      errorOpenHermesFolder: '開啟 Hermes 資料夾',
      errorOpenHermesFolderFailed: '無法開啟 Hermes 資料夾',
      errorUpdateApiKey: '更新 API 金鑰',
      errorSignInFreeTier: '使用 Nous 帳戶登入',
      expandMessage: '展開訊息',
      scrollToBottom: '捲動到底部',
      loadingLocalModel: model => `正在將 ${model} 載入記憶體`,
      errorAuthKinds: {
        api_key: {
          title: provider => `${provider} 拒絕了你的 API 金鑰`,
          body: provider => `為 ${provider} 儲存的金鑰無效或已被撤銷。請更新後重試。`
        },
        oauth: {
          title: provider => `你的 ${provider} 登入已過期`
        }
      }
    },
    approval: {
      gatewayDisconnected: 'Sbar Rafiq 閘道未連線',
      sendFailed: '無法傳送核准回應',
      run: '執行',
      command: '指令',
      moreOptions: '更多核准選項',
      allowSession: '允許本工作階段',
      alwaysAllowMenu: '一律允許…',
      jumpToApproval: '需要核准',
      reject: '拒絕',
      alwaysTitle: '一律允許此指令？',
      alwaysDescription: pattern =>
        `這會將「${pattern}」模式加入永久允許清單（~/.hermes/config.yaml）。Sbar Rafiq 對類似指令將不再詢問，包括目前工作階段和未來工作階段。`,
      alwaysAllow: '一律允許',
      reconnect: '重新連線',
      timedOutSystemLine: '批准已逾時，指令未執行。請要求 Sbar Rafiq 再試一次，或在「設定 → 安全性 → 批准逾時」中提高上限。',
      openSafetySettings: '開啟安全性設定'
    },
    clarify: {
      notReady: '澄清請求尚未就緒',
      gatewayDisconnected: 'Sbar Rafiq 閘道未連線',
      sendFailed: '無法傳送澄清回應',
      loadingQuestion: '正在載入問題…',
      other: '其他（輸入您的答案）',
      placeholder: '輸入您的答案…',
      skip: '略過',
      skipped: '已略過',
      noAnswer: '未回答',
      confirmAndContinueLabel: '確認並繼續',
      singleSelectHint: '選一個',
      multiSelectHint: '可多選',
      questionProgress: (answered, total) => `已回答 ${answered}/${total}`,
      notDelivered: '此問題未送達應用程式，無法在此回答。請按停止結束本輪，然後在聊天中回覆。'
    },
    tool: {
      copyCode: '複製程式碼',
      renderingImage: '正在渲染圖片',
      copyOutput: '複製輸出',
      copyCommand: '複製指令',
      copyContent: '複製內容',
      copyUrl: '複製 URL',
      copyResults: '複製結果',
      copyQuery: '複製查詢',
      copyFile: '複製檔案',
      copyPath: '複製路徑',
      failedCalls: (count: number) => `${count} 次工具呼叫失敗`,
      skillActivity: {
        loading: '正在載入技能',
        loaded: '已載入技能',
        loadFailed: '技能載入失敗',
        readingResource: '正在讀取技能資源',
        readResource: '已讀取技能資源',
        resourceFailed: '技能資源讀取失敗',
        listing: '正在列出技能',
        listed: '已列出技能',
        listFailed: '技能清單取得失敗',
        unavailable: '技能結果無法使用'
      },
      outputAlt: '工具輸出',
      rawResponse: '原始回應',
      copyActivity: '複製活動',
      recoveredOne: '在 1 個失敗步驟後已復原',
      recoveredMany: count => `在 ${count} 個失敗步驟後已復原`,
      failedOne: '1 個步驟失敗',
      failedMany: count => `${count} 個步驟失敗`,
      statusRunning: '執行中',
      statusError: '錯誤',
      statusRecovered: '已復原',
      statusDone: '完成',
      resultUnavailable: '結果無法使用',
      resultInterrupted: '已中斷',
      memoryWriteNoted: '已記下記憶寫入',
      actions: {
        read: '已讀取',
        reading: '正在讀取',
        opened: '已開啟',
        opening: '正在開啟',
        failedToOpen: '開啟失敗',
        searched: '已搜尋',
        searching: '正在搜尋',
        ran: '已執行',
        running: '正在執行',
        ranCode: '已執行程式碼',
        runningCode: '正在撰寫腳本'
      },
      prefixes: {
        browser: '瀏覽器',
        web: '網頁'
      },
      graft: {
        files: count => `${count} 個檔案`,
        freshness: { fresh: '圖已同步', missing: '尚未建立圖', stale: '圖已過期' },
        hits: count => `${count} 筆命中`,
        indexedFiles: count => `已索引 ${count} 個檔案`,
        saved: tokens => `節省 ≈ ${tokens} token`,
        savedPercent: (tokens, percent) => `節省 ≈ ${tokens} token (${percent}%)`,
        scope: path => `於 ${path}`,
        titles: {
          ask: { done: 'Graft: 已查詢程式碼圖', pending: 'Graft: 正在查詢程式碼圖', pendingAction: '查詢中' },
          callers: { done: 'Graft: 已追蹤呼叫', pending: 'Graft: 正在追蹤呼叫', pendingAction: '追蹤中' },
          check: { done: 'Graft: 已檢查圖的新鮮度', pending: 'Graft: 正在檢查圖的新鮮度', pendingAction: '檢查中' },
          grep: { done: 'Graft: 已搜尋索引', pending: 'Graft: 正在搜尋索引', pendingAction: '搜尋中' },
          map: { done: 'Graft: 已繪製儲存庫地圖', pending: 'Graft: 正在繪製儲存庫地圖', pendingAction: '繪製中' },
          skeleton: { done: 'Graft: 已讀取檔案 API', pending: 'Graft: 正在讀取檔案 API', pendingAction: '讀取中' }
        },
        titlesWithTarget: {
          ask: { done: target => `Graft: 已查詢「${target}」`, pending: target => `Graft: 正在查詢「${target}」` },
          callers: { done: target => `Graft: 已追蹤 ${target}`, pending: target => `Graft: 正在追蹤 ${target}` },
          grep: { done: target => `Graft: 已搜尋「${target}」`, pending: target => `Graft: 正在搜尋「${target}」` },
          skeleton: { done: target => `Graft: 已讀取 ${target} 的 API`, pending: target => `Graft: 正在讀取 ${target} 的 API` }
        }
      },
      titleTemplates: {
        actionCommand: (action, command) => `${action} ${command}`,
        actionQuoted: (action, value) => `${action}「${value}」`,
        actionTarget: (action, target) => `${action} ${target}`,
        prefixedDone: (prefix, action) => `${prefix}${action}`,
        runningPrefixedTool: (prefix, action) => `正在執行${prefix}${action}`,
        runningTool: action => `正在執行 ${action}`
      },
      titles: {
        browser_click: { done: '已點擊頁面元素', pending: '正在點擊頁面元素', pendingAction: '正在點擊' },
        browser_fill: { done: '已填寫表單欄位', pending: '正在填寫表單欄位', pendingAction: '正在填寫' },
        browser_navigate: { done: '已開啟頁面', pending: '正在開啟頁面', pendingAction: '正在開啟' },
        browser_snapshot: { done: '已擷取頁面快照', pending: '正在擷取頁面快照', pendingAction: '正在擷取' },
        browser_take_screenshot: { done: '已擷取截圖', pending: '正在擷取截圖', pendingAction: '正在擷取' },
        browser_type: { done: '已在頁面輸入', pending: '正在頁面輸入', pendingAction: '正在輸入' },
        clarify: { done: '已提問', pending: '正在提問', pendingAction: '正在提問' },
        cronjob: { done: 'Cron 工作', pending: '正在安排 Cron 工作', pendingAction: '正在安排' },
        edit_file: { done: '已編輯檔案', pending: '正在編輯檔案', pendingAction: '正在編輯' },
        execute_code: { done: '已執行程式碼', pending: '正在撰寫腳本', pendingAction: '正在撰寫腳本' },
        image_generate: { done: '已生成圖片', pending: '正在生成圖片', pendingAction: '正在生成' },
        list_files: { done: '已列出檔案', pending: '正在列出檔案', pendingAction: '正在列出' },
        memory: { done: '已儲存至記憶', pending: '正在儲存至記憶', pendingAction: '正在儲存' },
        patch: { done: '已修補檔案', pending: '正在修補檔案', pendingAction: '正在修補' },
        read_file: { done: '已讀取檔案', pending: '正在讀取檔案', pendingAction: '正在讀取' },
        search_files: { done: '已搜尋檔案', pending: '正在搜尋檔案', pendingAction: '正在搜尋' },
        session_search_recall: {
          done: '已搜尋工作階段歷史',
          pending: '正在搜尋工作階段歷史',
          pendingAction: '正在搜尋'
        },
        terminal: { done: '已執行指令', pending: '正在執行指令', pendingAction: '正在執行' },
        todo: { done: '已更新待辦', pending: '正在更新待辦', pendingAction: '正在更新' },
        vision_analyze: { done: '已分析圖片', pending: '正在分析圖片', pendingAction: '正在分析' },
        web_extract: { done: '已讀取網頁', pending: '正在讀取網頁', pendingAction: '正在讀取' },
        web_search: { done: '已搜尋網頁', pending: '正在搜尋網頁', pendingAction: '正在搜尋' },
        write_file: { done: '已編輯檔案', pending: '正在編輯檔案', pendingAction: '正在編輯' }
      }
    },
    mcpSetup: {
      installTitle: '新增 MCP 伺服器',
      enableTitle: '啟用 MCP 伺服器',
      authorizeTitle: '授權 MCP 伺服器',
      installAction: '安裝',
      enableAction: '啟用',
      authorizeAction: '授權',
      envRequired: '請先填寫必要的憑證',
      sendFailed: '無法傳送 MCP 設定回應',
      reloadFailed: '伺服器已儲存，但重新載入 MCP 工具失敗；它們會在下一個工作階段載入',
      gatewayDisconnected: 'Sbar Rafiq 目前離線。請重新連線後再傳送一次。',
      installed: server => `已安裝 ${server}`,
      enabled: server => `已啟用 ${server}`,
      authorized: server => `已授權 ${server}`,
      failed: server => `${server} 設定失敗`,
      toolCount: count => (count === 1 ? '1 個工具' : `${count} 個工具`)
    }
  }
} satisfies Pick<TranslationOverrides, 'assistant'>
