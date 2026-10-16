import type { TranslationOverrides } from './define-locale'

/** Local-only strings: translations of the keys this fork adds on top of upstream,
 *  merged over the locale by `zh.ts`. Upstream copy lives in the sectioned files. */
export const zhLocal: TranslationOverrides = {
  sharedMetrics: {
    unavailable: '请更新 Sbar Rafiq 后端以更改此设置。'
  },
  connectors: {
    disclaimer: '连接为可选操作。请仅授权你希望 Sbar Rafiq 使用的应用。'
  },
  settings: {
    localModels: {
      runtimeInstalledDetail: (tag, backend) => `构建 ${tag}，${backend} 后端。Sbar Rafiq 会为您启动并管理服务器。`
    }
  },
  sidebar: {
    projects: {
      folderNeedsAttention: '请检查源文件夹',
      folderMissing: '未找到文件夹',
      folderUnavailable: '无法访问文件夹',
      folderNotDirectory: '此路径是文件，不是文件夹',
      reconnectFolder: '重新关联',
      editTitle: '编辑项目',
      editDesc: '管理源文件夹。更改路径会重新关联现有任务，不会移动文件。新任务使用主文件夹。',
      changeFolder: '更改文件夹路径',
      makePrimary: '设为主文件夹',
      readOnly: '只读',
      readOnlyHint: '在新的本地 Linux 终端中保护此文件夹。已运行的终端保留原有权限。',
      staleBackend: '请更新 Sbar Rafiq 后端以创建项目——当前后端比桌面应用旧（设置 → 更新 → 后端）。',
      deleteConfirm: '这会从 Sbar Rafiq 中移除已保存的项目。文件、git 仓库和工作树保持不变。',
      worktreeStaleBackend: '请更新 Sbar Rafiq 后端以在此远程连接上创建工作树 —— 该后端早于 git 工作树 API。'
    }
  },
  onboarding: {
    headerTitle: '开始设置 Sbar Rafiq Agent',
    preparingInstall: 'Sbar Rafiq 正在完成安装。首次运行通常不到一分钟。',
    starting: '正在启动 Sbar Rafiq…',
    featuredPitch: '一个订阅，300+ 前沿模型 — 运行 Sbar Rafiq 的推荐方式',
    apiKeyOptions: {
      local: {
        description: '将 Sbar Rafiq 指向本地或自托管的 OpenAI 兼容端点 (vLLM、llama.cpp、Ollama 等)。'
      }
    },
    flowSubtitles: {
      device_code: '在浏览器中打开验证页面 — Sbar Rafiq 会自动连接'
    },
    authorizeThere: '请在那里授权 Sbar Rafiq。'
  },
  assistant: {
    clarify: {
      gatewayDisconnected: 'Sbar Rafiq 网关未连接'
    }
  }
}
