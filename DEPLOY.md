# AI 日报 - GitHub Actions 自动化部署指南

## 架构概述

```
GitHub Actions (每天 UTC 00:00 = 北京 08:00)
  → Tavily API 搜索 AI 资讯（4 个并行查询）
  → Claude API 筛选 + 生成结构化 JSON
  → 基于 HTML 模板渲染最终页面
  → 更新 index.html（期数、累计资讯、新卡片）
  → git commit + push → GitHub Pages 自动部署
```

## 配置步骤

### 1. 获取 API Keys

你需要两个 API Key：

| API | 用途 | 获取方式 | 预估成本 |
|-----|------|---------|---------|
| **Tavily** | 搜索 AI 资讯 | https://tavily.com → 注册 → Dashboard → API Key | 免费 1000 次/月 |
| **Claude** | AI 内容生成 | https://console.anthropic.com → API Keys | ~$0.3-0.5/天 |

> 💡 Tavily 免费额度每月 1000 次搜索。日报每天消耗 4 次，一个月约 120 次，完全够用。
>
> 💡 如果你更想用 OpenAI，也可以换成 OpenAI API Key，见下方配置。

### 2. 在 GitHub 仓库配置 Secrets

进入你的仓库：https://github.com/viliawang-pm/ai-daily

1. 点击 **Settings** → 左侧 **Secrets and variables** → **Actions**
2. 点击 **New repository secret**，添加以下 Secrets：

| Secret 名称 | 值 | 必填 |
|-------------|---|------|
| `TAVILY_API_KEY` | 你的 Tavily API Key | ✅ |
| `ANTHROPIC_API_KEY` | 你的 Claude API Key | ✅（用 Claude 时） |
| `OPENAI_API_KEY` | 你的 OpenAI API Key | ✅（用 OpenAI 时） |
| `LLM_PROVIDER` | `anthropic` 或 `openai` | ❌ 默认 anthropic |

### 3. 推送代码到 GitHub

```bash
cd deploy-site
git add -A
git commit -m "feat: 添加 GitHub Actions 自动生成日报"
git push origin main
```

### 4. 验证

推送后，你可以：

- **手动触发测试**：仓库 → Actions → "AI 日报自动生成" → Run workflow → Run
- **等待定时触发**：每天北京时间 08:00 自动执行

### 5. 确认 GitHub Pages 设置

确保仓库的 GitHub Pages 已启用：
- Settings → Pages → Source 设置为 `Deploy from a branch`
- Branch 设置为 `main`，文件夹选 `/ (root)`

---

## 切换 LLM 提供商

### 使用 Claude（默认，推荐）

```
ANTHROPIC_API_KEY = sk-ant-xxx
LLM_PROVIDER = anthropic
```

### 使用 OpenAI

```
OPENAI_API_KEY = sk-xxx
LLM_PROVIDER = openai
```

在 Settings → Secrets → Actions 中修改即可，无需改代码。

---

## 手动触发选项

在 Actions 页面手动触发时，可以勾选 **force = true** 强制重新生成当天日报（会覆盖已有文件）。

---

## 失败通知

如果生成失败（API 超时、Key 过期等），Actions 会自动在仓库创建一个 Issue 通知你，标题为"🚨 AI 日报生成失败 - 日期"。

---

## 文件结构

```
deploy-site/
├── .github/
│   └── workflows/
│       └── generate-daily.yml    ← GitHub Actions 配置
├── scripts/
│   └── generate-daily.mjs        ← 日报生成脚本
├── issues/
│   ├── 2026-03-12.html
│   ├── 2026-03-13.html
│   └── ...
├── index.html                     ← 首页（自动更新）
└── DEPLOY.md                      ← 本文档
```

---

## 成本估算

| 项目 | 月度成本 |
|------|---------|
| Tavily 搜索 | 免费（1000 次/月，实际用 ~120 次） |
| Claude API | ~$9-15/月（每天 ~4K output tokens） |
| GitHub Actions | 免费（公开仓库无限额，私有仓库 2000 min/月） |
| **总计** | **~$9-15/月** |

---

## 常见问题

**Q: 如果某天没有搜到什么有价值的新闻怎么办？**
A: AI 会遵循"留白原则"——宁可当天只产出 6-8 条精选内容，也不注水。

**Q: 可以修改搜索关键词吗？**
A: 可以，编辑 `scripts/generate-daily.mjs` 中的 `searchAllNews` 函数的 `queries` 数组。

**Q: 可以修改 AI 的编辑价值观吗？**
A: 可以，编辑 `scripts/generate-daily.mjs` 中的 `buildSystemPrompt` 函数。

**Q: 生成的内容质量不满意怎么办？**
A: 调整 system prompt，或升级 LLM 模型（改为 claude-opus-4-20250514 等）。注意更高端的模型会增加 API 成本。
