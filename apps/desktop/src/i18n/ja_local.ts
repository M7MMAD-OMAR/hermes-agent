import type { TranslationOverrides } from './define-locale'

/** Local-only strings: translations of the keys this fork adds on top of upstream,
 *  merged over the locale by `ja.ts`. Upstream copy lives in the sectioned files. */
export const jaLocal: TranslationOverrides = {
  sharedMetrics: {
    unavailable: 'この設定を変更するには Sbar Rafiq バックエンドを更新してください。'
  },
  boot: {
    ready: 'Sbar Rafiq Desktop の準備ができました',
    steps: {
      loadingSettings: 'Sbar Rafiq の設定を読み込み中',
      retryingRemoteBackend: 'リモート Sbar Rafiq バックエンドに再接続中…',
      startingHermesDesktop: 'Sbar Rafiq Desktop を起動中…'
    },
    errors: {
      backgroundExited: 'Sbar Rafiq バックグラウンドプロセスが終了しました。',
      backgroundExitedDuringStartup: '起動中に Sbar Rafiq バックグラウンドプロセスが終了しました。',
      restartHermes: 'Hermes を再起動',
      openLogs: 'ログを開く',
      reconnectNow: '今すぐ再接続',
      connectionSettings: '接続設定',
      gatewaySignInRequiredDetail: '再接続するにはもう一度サインインしてください。チャットや設定は失われません。',
      signInAgain: '再度サインイン'
    },
    failure: {
      title: 'Sbar Rafiq を起動できませんでした',
      details: '詳細'
    },
    causes: {
      exitedEarly: 'Hermes のバックグラウンドサービスが起動直後に停止しました。',
      timedOut: 'Hermes のバックグラウンドサービスが時間内に応答しませんでした。',
      permission: 'Hermes はデータフォルダーに書き込めませんでした (権限の問題)。',
      diskFull: 'ディスクがいっぱいのため、Hermes を起動できませんでした。',
      portInUse: 'Hermes が必要とするネットワークポートを別のプログラムが使用しています。',
      installMissing: 'Hermes のインストールの一部が見つかりません。「インストールを修復」を選んで復元してください。'
    }
  },
  settings: {
    plugins: {
      installModal: {
        installUncertain:
          'Sbar Rafiq はインストール結果の待機を終了しましたが、プラグインのインストールはまだ進行中の可能性があります。この画面を閉じ、再インストールする前にプラグイン一覧を再スキャンしてください。'
      }
    },
    localModels: {
      runtimeInstalledDetail: (tag, backend) =>
        `ビルド ${tag}、${backend} バックエンド。サーバーは Sbar Rafiq が起動・管理します。`
    }
  },
  sidebar: {
    projects: {
      folderNeedsAttention: 'ソースフォルダーを確認してください',
      folderMissing: 'フォルダーが見つかりません',
      folderUnavailable: 'フォルダーにアクセスできません',
      folderNotDirectory: 'このパスはフォルダーではなくファイルです',
      reconnectFolder: '再接続',
      editTitle: 'プロジェクトを編集',
      editDesc:
        'ソースフォルダーを管理します。パスの変更で既存のタスクを再接続します。ファイルは移動しません。新しいタスクにはメインフォルダーを使用します。',
      changeFolder: 'フォルダーパスを変更',
      makePrimary: 'メインに設定',
      readOnly: '読み取り専用',
      readOnlyHint:
        '新しいローカル Linux ターミナルでこのフォルダを保護します。実行中のターミナルは元の権限を保持します。',
      staleBackend:
        'プロジェクトを作成するには Sbar Rafiq バックエンドを更新してください。バックエンドがこのデスクトップアプリより古いです（設定 → 更新 → バックエンド）。',
      deleteConfirm:
        'Sbar Rafiq から保存済みプロジェクトを削除します。ファイル・git リポジトリ・ワークツリーはそのまま残ります。',
      worktreeStaleBackend:
        'このリモート接続でワークツリーを作成するには Sbar Rafiq バックエンドを更新してください — git ワークツリー API 以前のバージョンです。',
      menuTransfer: 'プロファイルへ移動…',
      transferHint: 'フォルダーはディスク上の元の場所に残ります。移るのはプロジェクトとその会話です。',
      transferTarget: 'プロファイル',
      transferNoTargets: '移動先となる他のプロファイルがありません。',
      transferFoldersStay: 'ディスク上のフォルダーは移動、名前変更、削除されません。',
      transferMove: 'コピーではなく移動する',
      transferMoveHint:
        'ここにある会話はアーカイブされ、プロジェクトはこのサイドバーから消えます。この操作はアプリでは元に戻せません。',
      transferConfirmCopy: 'コピー',
      transferConfirmMove: '移動',
      moveToProject: 'プロジェクトへ移動',
      moveFailed: 'セッションを移動できませんでした',
      moveNoFolder: 'そのプロジェクトには移動先のフォルダーがありません',
      moveNoProjects: '他のプロジェクトはありません',
      back: 'すべてのプロジェクト',
      transferTitle: name => `「${name}」を別のプロファイルへ移動`,
      transferCarries: (sessions, messages) => `会話 ${sessions} 件、メッセージ ${messages} 件を移します。`,
      transferDone: (sessions, profile) => `会話 ${sessions} 件を ${profile} に移しました。`,
      transferWorking: sessions => `会話 ${sessions} 件を移しています…`,
      transferPartial: failed => `${failed} 件を移せませんでした。もう一度実行すると、不足分だけが移されます。`,
      movedTo: name => `${name} に移動しました`,
      reorder: label => `${label} を並べ替え`,
      toggle: (label, open) => `${label} のセッションを${open ? '表示' : '非表示'}`
    }
  },
  onboarding: {
    headerTitle: 'Sbar Rafiq Agent のセットアップをしましょう',
    preparingInstall: 'Sbar Rafiq はインストールを完了中です。初回実行では通常 1 分以内に完了します。',
    starting: 'Sbar Rafiq を起動中…',
    featuredPitch: '1 つのサブスクリプションで 300 以上の最先端モデル — Sbar Rafiq を実行するための推奨方法',
    apiKeyOptions: {
      local: {
        description:
          'ローカルまたはセルフホストの OpenAI 互換エンドポイント（vLLM、llama.cpp、Ollama など）に Sbar Rafiq を接続。'
      }
    },
    flowSubtitles: {
      device_code: 'ブラウザーで確認ページを開きます — Sbar Rafiq が自動接続します'
    },
    authorizeThere: 'そこで Sbar Rafiq を承認してください。',
    localApiKeyPlaceholder: 'API キー (任意、エンドポイントが必要とする場合のみ)',
    tryAgain: '再試行',
    useApiKeyInstead: 'API キーを使用',
    errorDetails: '詳細',
    signInDidNotFinish: provider =>
      `${provider} でのサインインが完了しませんでした。インターネット接続を確認して再試行するか、別のプロバイダーを選んでください。`
  },
  assistant: {
    clarify: {
      gatewayDisconnected: 'Sbar Rafiq ゲートウェイが接続されていません'
    }
  },
  connectors: {
    title: 'アプリを接続',
    connect: '接続',
    skip: '後で',
    cancel: '待機をやめる',
    retry: '再試行',
    grant: '再接続',
    connected: '接続済み',
    checking: 'アプリを確認中…',
    notConnected: '未接続',
    skipped: 'スキップ済み',
    disabled: '利用不可',
    failed: '接続できませんでした',
    needsAuth: 'アクセスの有効期限切れ',
    opening: 'サインインを開いています…',
    waiting: 'ブラウザーを待っています…',
    timeout: 'まだ認可を待っています。',
    refresh: '状態を更新',
    connectError: '認可を開始できませんでした。再試行してください。',
    unavailable: 'このセッションではコネクターを利用できません。',
    ownerMissing: '接続を管理するには、この会話を開き直してください。',
    search: 'アプリを検索',
    empty: '一致するアプリはありません',
    disclaimer: '接続は任意です。Sbar Rafiq に使わせたいアプリだけを認可してください。',
    execution: 'コネクターのツール',
    openInBrowser: 'ブラウザーで開く',
    setupCancel: 'キャンセル',
    authorizedToolsUnavailable: '認可済み。ツールは利用できません。',
    required: '必須',
    connectErrorFor: app => `${app} の認可を開始できませんでした。`,
    setup: server => `${server} をセットアップ`
  },
  connectorsPage: {
    title: 'コネクター',
    filterCategory: 'カテゴリー',
    categoryAll: 'すべてのカテゴリー',
    uncategorised: '未分類',
    residencyLocal: 'このデバイス上',
    segment: {
      all: 'すべて',
      available: '利用可能',
      connected: '接続済み',
      off: 'オフ'
    },
    group: {
      connected: '接続済み',
      connectedNote: '問題のある接続が先頭に表示されます。',
      available: '利用可能',
      off: 'オフ',
      offNote: 'サインイン情報は保持されます。'
    },
    card: {
      kindManaged: 'マネージド',
      kindCatalog: 'MCP · カタログ',
      kindCustom: 'MCP · カスタム',
      inCatalog: 'Sbar Rafiq カタログに掲載',
      hostedTwin: 'マネージド版を利用可能',
      alsoLocal: 'このデバイスでも実行中',
      state: {
        accessExpired: 'アクセスの有効期限切れ',
        available: '利用可能',
        connected: '接続済み',
        connecting: '接続中',
        connectionUnknown: '状態不明',
        couldNotConnect: '接続できませんでした',
        offByYourOrganisation: '組織によりオフ',
        offForYou: 'あなたはオフ',
        serverConnecting: '接続中…',
        serverError: 'エラー',
        serverNeedsAuth: '認証が必要',
        serverOff: 'オフ',
        serverOn: 'オン',
        serverOnUnused: 'オン、未使用'
      },
      verb: {
        authenticate: '認証',
        connect: '接続',
        install: 'インストール',
        openLogs: 'ログを開く',
        reconnect: '再接続',
        stopWaiting: '待機をやめる',
        tryAgain: '再試行',
        turnBackOn: '再びオンにする'
      },
      reason: {
        finishSignIn: 'ブラウザーでサインインを完了してください。',
        reconnect: 'このアプリを使い続けるには再接続してください。',
        serverError: 'サーバーが接続を拒否しました。',
        serverNeedsAuth: 'このサーバーが応答できるようにサインインしてください。'
      },
      kindPlugin: plugin => `MCP · プラグイン ${plugin}`,
      open: name => `${name} を開く`,
      turnServerOn: name => `${name} をオンにする`,
      turnServerOff: name => `${name} をオフにする`,
      fact: {
        tools: count => `ツール ${count} 個`,
        toolsOff: count => `ツール ${count} 個がオフ`,
        toolsOn: count => `ツール ${count} 個がオン`,
        toolsSomeOn: (total, on) => `ツール ${total} 個、${on} 個がオン`
      }
    },
    page: {
      loading: 'カタログとこのコンピューター上のサーバーを読み込み中',
      emptyTitle: 'まだアプリがありません。このコンピューターにサーバーを追加して始めましょう。',
      noMatchTitle: '一致するアプリはありません',
      noMatchBody: '一致するものがありません。独自の MCP サーバーを Sbar Rafiq に指定して追加できます。',
      clearSearch: '検索をクリア',
      hostedFailedTitle: 'ホスト型アプリに接続できませんでした。',
      hostedFailedBody:
        'このコンピューター上のサーバーは影響を受けず、引き続き動作しています。オフになったものはありません。',
      retry: '再試行',
      showAllMatches: '一致するものをすべて表示',
      freeTierNote: 'サインインするまで、接続はこのコンピューター内に保持されます。',
      signInLine: 'マネージドアプリを使うには Nous にサインインしてください。',
      signIn: 'サインイン',
      managedUnavailable: 'このアカウントではマネージドアプリをまだ利用できません。',
      writeFailed: '変更は保存されませんでした。',
      refreshFailed: 'ツール一覧を更新できませんでした。',
      disconnectNoAccount: 'Sbar Rafiq には切断するアカウントがありません。ページを更新して再試行してください。',
      disconnectRefused:
        '現在 Nous はこのサインインを削除できません。代わりにスイッチでアプリをオフにするか、後でもう一度お試しください。',
      matchesElsewhere: count => `他のグループにさらに ${count} 件の一致があります。`,
      segmentNoMatch: segment => `${segment} に一致するものがないため、すべての一致を表示しています。`
    },
    add: {
      action: '独自に追加',
      title: 'カスタム MCP に接続',
      hint: 'このデバイスの mcp.json に新しいエントリーを 1 件追加',
      pasteLabel: 'コマンドまたはスニペットを貼り付け',
      pastePlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/dir',
      pasteNoMatch: 'サーバーとして読み取れる内容がありません。代わりに下の項目を入力してください。',
      name: '名前',
      nameTaken: 'この名前はすでに使われています。',
      type: '種類',
      typeStdio: 'STDIO',
      typeHttp: 'Streamable HTTP',
      command: '起動コマンド',
      args: '引数',
      addArg: '+ 引数を追加',
      envVars: '環境変数',
      addEnvVar: '+ 環境変数を追加',
      passthrough: '環境変数のパススルー',
      addPassthrough: '+ 変数を追加',
      cwd: '作業ディレクトリ',
      url: 'URL',
      headers: 'ヘッダー',
      addHeader: '+ ヘッダーを追加',
      auth: '認証',
      authNone: 'なし',
      authOauth: 'OAuth',
      authBearer: 'Bearer トークン',
      keyPlaceholder: 'KEY',
      valuePlaceholder: '値',
      removeRow: 'この行を削除',
      editJson: 'mcp.json を編集',
      saveFailed: 'サーバーは保存されませんでした。'
    },
    dialog: {
      disconnect: '切断',
      disconnectBody: 'Sbar Rafiq はこのアカウントとしての操作を停止します。いつでも再接続できます。',
      menuRefreshTools: 'ツールを更新',
      moreActions: 'その他の操作',
      removeServerBody: 'このコンピューターの mcp.json からエントリーが削除されます。それ以外は何も削除されません。',
      wayHosted: 'マネージド',
      turnOffLocal: 'ローカルサーバーをオフにする',
      openPlugins: 'プラグインタブを開く',
      nousLine: 'Nous アプリはプロファイルではなくアカウントに紐づきます。',
      rulesReadOnly: '現在ルールは変更できません。',
      rulesSignIn: 'ここで Sbar Rafiq に許可する操作を変更するにはサインインしてください。',
      orgLink: 'コネクター管理画面を開く',
      connectEnded: 'サインインが完了しませんでした。',
      connectOpenAgain: 'もう一度リンクを開く',
      tokensPerCall: '呼び出しあたりのトークン',
      usesPerMonth: '30 日間の使用回数',
      advanced: '詳細',
      advancedHint: 'mcp.json のエントリーとログ',
      disconnectTitle: name => `${name} を切断しますか？`,
      removeServerTitle: name => `${name} を削除しますか？`,
      appSwitch: name => `Sbar Rafiq が ${name} を使用できる`,
      waysTitle: name => `${name} の実行場所`,
      wayNotConnected: name => `まだ接続されていません。ブラウザーで ${name} にサインインしてください。`,
      bothOn: name => `両方がオンのため、Sbar Rafiq には ${name} のツールがすべて 2 回ずつ表示されます。`,
      providedByPlugin: plugin => `プラグイン ${plugin} が提供`,
      rulesAppOff: name => `ツールを変更するには ${name} をオンにしてください。`,
      orgNote: count => `組織により ${count} 個のツールがオフになっています。`
    },
    tools: {
      title: 'ツール',
      notInstalledBody: '提供されるツールを確認するには、このデバイスにインストールしてください。',
      summaryAllTools: 'すべてのツール',
      summaryOther: 'その他',
      allToolsSwitch: 'すべてのツールをオン/オフ',
      summaryAllOn: 'すべてオン',
      summaryOff: 'オフ',
      showSummary: '概要を表示',
      staleSignIn: '最新のツール一覧を読み込むにはサインインしてください。',
      quickReadOnly: '読み取りのみ',
      quickNoDestructive: '破壊的な操作をオフ',
      quickEverythingOn: 'すべてオン',
      lockedHint: '組織によりオフ',
      noMatch: 'これらのフィルターに一致するツールはありません。',
      loading: 'ツール一覧を読み込み中',
      unavailableLine: 'ツール一覧を利用できません。',
      needsAuthBody: 'サインイン情報はこのコンピューター内に保持され、外部には送信されません。',
      retry: '再試行',
      goneBody: 'Sbar Rafiq はこれを呼び出せなくなりました。削除するまで行は残るため、何も消えることはありません。',
      remove: '削除',
      offBody: '提供されるツールを読み込むには、上のスイッチでオンにしてください。',
      signedOutTitle: 'ツール一覧を読み込むには Nous にサインインしてください。',
      signedOutBody: 'このコンピューター上のサーバーは影響を受けません。',
      conflictTitle: '編集中に他の人がこのルールを変更しました。',
      conflictReload: '相手の版を再読み込み',
      conflictSave: '相手の版を上書き保存',
      saveFailed: 'ツールのルールは保存されませんでした。',
      discard: '破棄',
      save: '変更を保存',
      saving: '保存中...',
      summaryTitle: name => `Sbar Rafiq が ${name} で行えること`,
      summaryPreviewTitle: name => `接続後に Sbar Rafiq が ${name} で行えること`,
      summaryCount: count => `ツール ${count} 個`,
      summarySomeOn: (on, total) => `${total} 個中 ${on} 個がオン`,
      showAllTools: count => `${count} 個のツールをすべて表示`,
      facetSwitch: facet => `${facet}ツールをオン/オフ`,
      moreHints: count => `+${count}`,
      searchCountPlaceholder: count => `${count} 個のツールを検索`,
      toolList: name => `${name} のツール`,
      categorySelect: count => `${count} 個のカテゴリー`,
      showDeprecated: count => `非推奨の ${count} 個を表示`,
      hideDeprecated: count => `非推奨の ${count} 個を非表示`,
      turnToolOn: tool => `${tool} をオンにする`,
      turnToolOff: tool => `${tool} をオフにする`,
      showDetails: tool => `${tool} の動作を表示`,
      hideDetails: tool => `${tool} の動作を非表示`,
      needsAuthTitle: name => `ツールを読み込むには ${name} にサインインしてください。`,
      goneTitle: name => `${name} はカタログから削除されました。`,
      offTitle: name => `${name} はオフです。`,
      conflictBody: (theyOff, theyOn) => {
        const they = [
          theyOff > 0 ? `あなたがオンにしているツール ${theyOff} 個をオフにしました` : '',
          theyOn > 0 ? `あなたがオフにしたツール ${theyOn} 個をオンのままにしました` : ''
        ].filter(Boolean)
        return `${they.length > 0 ? `相手は${they.join('。また、')}。` : ''}あなたの編集は画面に残っています。何も書き込まれていません。`
      },
      footerDirty: (off, backOn) =>
        `ツール ${off} 個がオフ、${backOn === 0 ? '再びオンにしたものはなし' : `${backOn} 個が再びオン`}`
    },
    vocabulary: {
      facetRead: {
        label: '読み取り',
        long: 'このアプリからデータを読み取ります。何も変更しません。'
      },
      facetWrite: {
        label: '書き込み',
        long: 'このアプリで何かを作成または変更します。'
      },
      facetDestructive: {
        label: '破壊的',
        long: 'このアプリの内容を完全に削除する可能性があります。'
      },
      facetUnclassified: {
        label: '効果不明',
        long: 'このツールの動作をアプリが示していません。'
      },
      hintReadOnly: {
        label: '読み取りのみ',
        long: 'このツールは読み取りのみを行うと宣言しています。'
      },
      hintCreate: {
        label: '作成',
        long: '新しいものを作成します。'
      },
      hintUpdate: {
        label: '更新',
        long: '既存のものを変更します。'
      },
      hintDelete: {
        label: '削除',
        long: '何かを削除します。'
      },
      hintDestructive: {
        label: '破壊的',
        long: 'この変更はここでは元に戻せません。'
      },
      hintIdempotent: {
        label: '反復可能',
        long: '2 回実行しても 1 回実行した場合と同じ結果になります。'
      },
      hintOpenWorld: {
        label: '外部',
        long: 'このアプリの外部にアクセスします。'
      }
    },
    searchPlaceholder: count => `${count} 件のアプリを検索`
  },
  freeTier: {
    providerRowTitle: 'Nous · 無料プラン',
    providerRowPitch: 'Nous アカウントでサインインすると、より多くのモデルとツールを利用できます。',
    readyTitle: 'Sbar Rafiq の準備ができました。',
    readyCaption: '無料 · コネクター付き',
    begin: '始める',
    signInInstead: '代わりに Nous アカウントでサインイン',
    otherProviders: 'その他のプロバイダー',
    stripTitle: '無料の Nous 推論とコネクターが利用可能になりました。',
    stripBody: 'モデルピッカーを開いて試すか、Nous アカウントでサインインしてください。',
    openModelPicker: 'モデルピッカーを開く',
    dismiss: '閉じる',
    signIn: 'サインイン',
    signInHeading: 'Nous アカウントでサインインすると、より多くのモデルとツールを利用できます。',
    settingUp: '無料推論をセットアップ中…',
    codeBody: 'サインインを完了するには、ブラウザーでこのコードを入力してください。',
    copyLink: 'リンクをコピー',
    doNotShare: 'このコードは共有しないでください。',
    waiting: 'サインインを待っています…',
    finishingHeading: 'サインインを完了中…',
    finishingBody: 'ブラウザーで承認されました。アカウントのトークンを取得しています。',
    signedIn: 'サインインしました。',
    completedBody: 'アカウントで推論とツールを利用できるようになりました。',
    defaultModel: '既定のモデル',
    change: '変更',
    done: '完了',
    notNow: '後で',
    tryAgain: '再試行',
    startAgain: '最初からやり直す',
    didNotComplete: 'サインインが完了しませんでした',
    rejectedBody:
      '問題ありません。引き続き無料の Nous サービスを利用できます。準備ができたらいつでもサインインしてください。',
    supersededBody:
      '新しいサインインコードがこのコードに置き換わりました。最新のコードを使うか、最初からやり直してください。',
    timedOutHeading: 'サインインリンクの有効期限が切れました',
    timedOutBody: '準備ができたらいつでもやり直してください。引き続き無料の Nous サービスを利用できます。',
    retiredBody:
      'サインインが完了する前にセッションが終了しました。Sbar Rafiq が新しいセッションを開始するので、準備ができたら再度サインインしてください。',
    errorBody: 'サインインが完了しませんでした。準備ができたらいつでも再試行してください。',
    busyHeading: 'あと少しです',
    unreachableBody:
      'Sbar Rafiq は Nous サービスに接続できず、サインインを完了できませんでした。インターネット接続を確認して再試行してください。セッションはそのまま残っています。',
    alreadySignedInHeading: 'すでにサインインしています。',
    alreadySignedInBody: 'この Sbar Rafiq はすでに Nous アカウントにサインインしています。',
    setupFailed: {
      gateClosed:
        'このバージョンの Sbar Rafiq は Nous アカウントなしでは起動できません。サインインまたはアカウントを作成してください。無料で、1 分ほどで完了します。',
      paused:
        'サインインなしでの Sbar Rafiq の利用は一時停止中です。Sbar Rafiq は引き続き確認します。サインインは無料で、すぐに使い始められます。',
      unreachable:
        'Sbar Rafiq は Nous サービスに接続できませんでした。インターネット接続を確認してから「再試行」をタップしてください。または、ひとまず別のプロバイダーを接続してください。',
      serverError:
        'Nous サービスで一時的な問題が発生しました。少し待ってから「再試行」をタップするか、ひとまず別のプロバイダーを接続してください。',
      powRequired:
        'Nous サーバーがプルーフ・オブ・ワークを要求しましたが、お使いのエージェントはまだ対応していません。続行するには、サインインするか無料の Nous アカウントを作成してください。',
      locked:
        'このセッションはサインインしないと続行できません。続けるには、サインインするか無料の Nous アカウントを作成してください。',
      generic:
        'Sbar Rafiq はサインインなしで無料アクセスをセットアップできませんでした。サインインは無料です。または別のプロバイダーを接続してください。',
      signInBelow: 'サインインは無料です。下で Nous を選んでください。',
      tryAgain: '再試行',
      retrying: '再試行中…',
      rateLimited: wait =>
        `現在多くの方が利用を開始しているため、Sbar Rafiq は ${wait}後に再試行します。サインインは無料で、待たずに利用できます。`
    },
    statusLabel: model => `Nous · ${model}`,
    signedInAs: email => `${email} としてサインイン中`,
    busyBody: wait =>
      `Nous サービスが混雑しているため、Sbar Rafiq はサインインを完了できませんでした。${wait}後に再試行してください。その間もセッションはそのまま残っています。`,
    providerName: 'Nous'
  }
}
