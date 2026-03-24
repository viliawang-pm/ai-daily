#!/usr/bin/env node
/**
 * AI 日报自动生成脚本
 * 用于 GitHub Actions 定时任务，每天自动搜索 AI 资讯并生成日报
 *
 * 环境变量：
 *   TAVILY_API_KEY  - Tavily 搜索 API Key
 *   ANTHROPIC_API_KEY - Claude API Key（二选一）
 *   OPENAI_API_KEY   - OpenAI API Key（二选一）
 *   LLM_PROVIDER     - 'anthropic' | 'openai'（默认 anthropic）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ISSUES_DIR = path.join(ROOT_DIR, 'issues');
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');

// ============ 配置 ============

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'anthropic';

// ============ 工具函数 ============

function getBeijingDate() {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: beijing.getUTCFullYear(),
    month: beijing.getUTCMonth() + 1,
    day: beijing.getUTCDate(),
    weekday: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][beijing.getUTCDay()],
    dateStr: `${beijing.getUTCFullYear()}-${String(beijing.getUTCMonth() + 1).padStart(2, '0')}-${String(beijing.getUTCDate()).padStart(2, '0')}`,
    displayDate: `${beijing.getUTCFullYear()} 年 ${beijing.getUTCMonth() + 1} 月 ${beijing.getUTCDate()} 日`,
  };
}

function getYesterdayBeijing() {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return `${beijing.getUTCFullYear()}-${String(beijing.getUTCMonth() + 1).padStart(2, '0')}-${String(beijing.getUTCDate()).padStart(2, '0')}`;
}

function countExistingIssues() {
  if (!fs.existsSync(ISSUES_DIR)) return 0;
  return fs.readdirSync(ISSUES_DIR).filter(f => f.endsWith('.html')).length;
}

function countTotalNews() {
  // 从 index.html 中读取当前累计资讯数
  if (!fs.existsSync(INDEX_PATH)) return 0;
  const html = fs.readFileSync(INDEX_PATH, 'utf-8');
  const match = html.match(/<span class="stat-num">(\d+)<\/span>\s*<span class="stat-label">累计资讯<\/span>/);
  return match ? parseInt(match[1]) : 0;
}

// ============ Tavily 搜索 ============

async function tavilySearch(query, maxResults = 10) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY 未设置');

  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: 'advanced',
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Tavily 搜索失败 (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return (data.results || []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));
}

async function searchAllNews(date) {
  const yesterday = getYesterdayBeijing();

  // 并行搜索 4 个维度
  const queries = [
    `AI breakthrough research paper ${date}`,
    `AI news funding product launch ${date}`,
    `AI 人工智能 突破 发布 ${date}`,
    `AI trending important ${yesterday}`,
  ];

  console.log('🔍 并行搜索中...');
  const results = await Promise.all(queries.map(q => tavilySearch(q, 10)));
  const allResults = results.flat();

  // 去重（按 URL）
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`📰 搜索到 ${unique.length} 条去重后的结果`);
  return unique;
}

// ============ LLM 调用 ============

async function callAnthropic(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未设置');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API 失败 (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.content[0].text;
}

async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 未设置');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 8192,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API 失败 (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callLLM(systemPrompt, userPrompt) {
  if (LLM_PROVIDER === 'openai') {
    return callOpenAI(systemPrompt, userPrompt);
  }
  return callAnthropic(systemPrompt, userPrompt);
}

// ============ AI 内容生成 ============

function buildSystemPrompt() {
  return `你是一位资深 AI 领域编辑，负责编写面向 AI 专业人士的每日资讯日报。

## 核心原则
这份日报的读者是深度理解 AI、科技与经济的专业人士。他们需要的是"少数人才能看到的前沿判断"，而非广撒网式新闻聚合。

## 留白原则（最高优先级）
没有就是没有。如果没有发现真正值得 BREAKTHROUGH 或 SIGNAL 标签的底层技术突破，就不要硬塞。
- BREAKTHROUGH 标签：只在确实出现了改变能力边界/成本结构的技术突破时使用
- SIGNAL 标签：只在出现了需要持续跟踪的异常信号时使用
- 总条目数不强制，通常 8-12 条，宁可短而精，不可长而水
- 绝不为了凑条目数而降低选题门槛

## 选题优先级（从高到低）
1. 底层技术突破（改变 AI 的能力边界或成本结构）
2. 产业结构性变化（改变"谁在赢、谁在输"的格局）
3. 关键人物的深度判断（只有"局中人"才能看到的信息）
4. 信号而非噪音（圈内人才能读懂的技术路线验证信号）

## 降低优先级或合并
- 连续多天未变的跟踪事件 → 合并
- 纯资本市场传导 → 除非结构性意义，否则合并
- 报告/榜单类 → 除非反直觉结论，否则降级

## 输出格式要求
你必须输出一个严格的 JSON 数组，每个元素代表一条新闻：
\`\`\`json
[
  {
    "rank": 1,
    "isTop3": true,
    "tags": [{"text": "SIGNAL", "class": "tag-signal"}, {"text": "产业结构", "class": "tag-industry"}],
    "title": "标题",
    "summary": "摘要（支持 <strong> 标签加粗关键词）",
    "whyImportant": "为什么这件事重要的分析",
    "publisher": "发布者",
    "platforms": "平台列表",
    "sourceUrl": "来源链接",
    "sectionDivider": null
  }
]
\`\`\`

可用的 tag class：tag-breakthrough, tag-signal, tag-product, tag-funding, tag-policy, tag-safety, tag-research, tag-newface, tag-industry

如果某条新闻前面需要插入分割线，设置 "sectionDivider" 为分割线文字（如"技术进展与开源生态"、"产业动态与地缘政治"）。

同时在 JSON 数组之前，先输出一行元数据（用 --- 分隔）：
\`\`\`
SUBTITLE: 简短的一行副标题
NEWS_COUNT: 数字
NEW_FACES: 数字
---
[JSON 数组]
\`\`\``;
}

function buildUserPrompt(searchResults, date) {
  const newsText = searchResults.map((r, i) =>
    `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}\n`
  ).join('\n');

  return `今天是 ${date.displayDate}（${date.weekday}）。

以下是今天搜索到的 AI 领域资讯原始素材（${searchResults.length} 条）。请根据你的编辑价值观，筛选、整理、深度分析，生成今天的 AI 日报内容。

注意：
1. 不是所有素材都值得入选，按选题优先级严格筛选
2. 每条必须有"为什么这件事重要"的深度分析
3. 合理使用 BREAKTHROUGH / SIGNAL 等标签（不要滥用）
4. 输出严格的 JSON 格式

---

原始素材：

${newsText}`;
}

function parseLLMResponse(response) {
  // 提取元数据
  const lines = response.split('\n');
  let subtitle = '';
  let newsCount = 0;
  let newFaces = 0;
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('SUBTITLE:')) subtitle = line.replace('SUBTITLE:', '').trim();
    if (line.startsWith('NEWS_COUNT:')) newsCount = parseInt(line.replace('NEWS_COUNT:', '').trim()) || 0;
    if (line.startsWith('NEW_FACES:')) newFaces = parseInt(line.replace('NEW_FACES:', '').trim()) || 0;
    if (line === '---') jsonStart = i + 1;
  }

  // 提取 JSON
  let jsonText = '';
  if (jsonStart >= 0) {
    jsonText = lines.slice(jsonStart).join('\n');
  } else {
    // 尝试直接找 JSON 数组
    const match = response.match(/\[[\s\S]*\]/);
    if (match) jsonText = match[0];
  }

  // 清理 markdown code fence
  jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  const news = JSON.parse(jsonText);
  if (newsCount === 0) newsCount = news.length;

  return { subtitle, newsCount, newFaces, news };
}

// ============ HTML 渲染 ============

function renderDailyHTML(date, data) {
  const { subtitle, newsCount, newFaces, news } = data;
  const issueNum = countExistingIssues() + 1;

  const newsCardsHTML = news.map(item => {
    const divider = item.sectionDivider
      ? `\n            <div class="section-divider"><span>${item.sectionDivider}</span></div>\n`
      : '';

    const tagsHTML = item.tags.map(t => `<span class="tag ${t.class}">${t.text}</span>`).join('\n                    ');

    return `${divider}
            <div class="news-card">
                <div class="card-header">
                    <span class="rank${item.isTop3 ? ' top3' : ''}">${item.rank}</span>
                    ${tagsHTML}
                </div>
                <h3>${item.title}</h3>
                <div class="summary">
                    ${item.summary}
                </div>
                <div class="why-important">
                    <div class="why-title">为什么这件事重要</div>
                    <p>${item.whyImportant}</p>
                </div>
                <div class="meta">
                    <span>发布者：${item.publisher}</span>
                    <span>平台：${item.platforms}</span>
                    ${item.sourceUrl ? `<span><a href="${item.sourceUrl}" target="_blank">查看来源 →</a></span>` : ''}
                </div>
            </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI 资讯日报 - ${date.year}年${date.month}月${date.day}日</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%); padding: 20px; line-height: 1.6; min-height: 100vh; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 20px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); overflow: hidden; }
        .header { background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%); color: white; padding: 50px 40px; text-align: center; position: relative; overflow: hidden; }
        .header::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(ellipse at center, rgba(99, 102, 241, 0.15) 0%, transparent 70%); animation: pulse 6s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.1); opacity: 1; } }
        .header h1 { font-size: 2.8em; font-weight: 800; margin-bottom: 10px; position: relative; z-index: 1; background: linear-gradient(90deg, #a78bfa, #818cf8, #6366f1, #818cf8, #a78bfa); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: gradient 4s linear infinite; }
        @keyframes gradient { 0% { background-position: 0% center; } 100% { background-position: 200% center; } }
        .header .date { font-size: 1.3em; opacity: 0.9; position: relative; z-index: 1; color: #c4b5fd; }
        .header .subtitle { font-size: 1em; opacity: 0.7; margin-top: 8px; position: relative; z-index: 1; color: #a5b4fc; }
        .stats-bar { display: flex; justify-content: center; gap: 40px; padding: 24px 40px; background: linear-gradient(90deg, #f5f3ff, #ede9fe, #f5f3ff); border-bottom: 1px solid #e5e7eb; flex-wrap: wrap; }
        .stat-item { text-align: center; }
        .stat-item .stat-num { font-size: 1.8em; font-weight: 800; color: #4f46e5; }
        .stat-item .stat-label { font-size: 0.8em; color: #6b7280; font-weight: 500; }
        .content { padding: 40px; }
        .news-card { background: #fafafa; border-radius: 16px; padding: 28px; margin-bottom: 24px; border: 1px solid #e5e7eb; transition: all 0.3s ease; position: relative; }
        .news-card:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(99, 102, 241, 0.1); border-color: #818cf8; }
        .news-card .card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
        .news-card .rank { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.85em; flex-shrink: 0; }
        .news-card .rank.top3 { background: linear-gradient(135deg, #f59e0b, #ef4444); }
        .news-card .tag { padding: 3px 10px; border-radius: 6px; font-size: 0.72em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .tag-breakthrough { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
        .tag-signal { background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; }
        .tag-product { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }
        .tag-funding { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
        .tag-policy { background: #fce7f3; color: #9d174d; border: 1px solid #f9a8d4; }
        .tag-safety { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
        .tag-research { background: #f0fdf4; color: #166534; border: 1px solid #86efac; }
        .tag-newface { background: #fff7ed; color: #c2410c; border: 1px solid #fdba74; }
        .tag-industry { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
        .news-card h3 { font-size: 1.2em; font-weight: 700; color: #1e1b4b; margin-bottom: 10px; line-height: 1.5; }
        .news-card .summary { color: #374151; font-size: 0.95em; line-height: 1.8; margin-bottom: 14px; }
        .news-card .why-important { background: linear-gradient(90deg, #f5f3ff, #ede9fe); border-left: 3px solid #7c3aed; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 14px; }
        .news-card .why-important .why-title { font-size: 0.78em; font-weight: 700; color: #7c3aed; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
        .news-card .why-important p { font-size: 0.88em; color: #4c1d95; line-height: 1.6; }
        .news-card .meta { display: flex; align-items: center; gap: 16px; font-size: 0.8em; color: #9ca3af; flex-wrap: wrap; }
        .news-card .meta a { color: #6366f1; text-decoration: none; font-weight: 500; }
        .news-card .meta a:hover { text-decoration: underline; }
        .section-divider { text-align: center; padding: 32px 0; color: #9ca3af; font-size: 0.85em; position: relative; }
        .section-divider::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: linear-gradient(90deg, transparent, #e5e7eb, transparent); }
        .section-divider span { background: white; padding: 0 20px; position: relative; z-index: 1; font-weight: 600; color: #6b7280; }
        .footer { text-align: center; padding: 30px 40px; background: #f9fafb; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 0.85em; }
        .footer a { color: #6366f1; text-decoration: none; }
        .back-link { display: inline-block; margin-bottom: 20px; color: #a5b4fc; text-decoration: none; font-size: 0.9em; position: relative; z-index: 1; }
        .back-link:hover { color: white; }
        @media (max-width: 768px) { body { padding: 10px; } .header { padding: 30px 20px; } .header h1 { font-size: 1.8em; } .content { padding: 20px; } .news-card { padding: 20px; } .stats-bar { gap: 20px; padding: 16px 20px; } }
    </style>
</head>

<body>
    <div class="container">
        <div class="header">
            <a href="https://viliawang-pm.github.io/ai-daily/" class="back-link">← 返回日报首页</a>
            <h1>AI 资讯日报</h1>
            <div class="date">${date.displayDate} · ${date.weekday}</div>
            <div class="subtitle">${subtitle}</div>
        </div>

        <div class="stats-bar">
            <div class="stat-item">
                <div class="stat-num">${newsCount}</div>
                <div class="stat-label">今日资讯</div>
            </div>
            <div class="stat-item">
                <div class="stat-num">10+</div>
                <div class="stat-label">覆盖平台</div>
            </div>
            <div class="stat-item">
                <div class="stat-num">${newFaces}</div>
                <div class="stat-label">新面孔</div>
            </div>
            <div class="stat-item">
                <div class="stat-num">第${issueNum}期</div>
                <div class="stat-label">连续发布</div>
            </div>
        </div>

        <div class="content">
${newsCardsHTML}
        </div>

        <div class="footer">
            <p><strong>AI 日报</strong> — 每日追踪全球 AI 领域重要动态</p>
            <p style="margin-top: 6px;">由 GitHub Actions 自动生成 · 数据来源：Tavily Search + Claude AI</p>
            <p style="margin-top: 8px;"><a href="https://viliawang-pm.github.io/ai-daily/">← 返回日报首页</a></p>
        </div>
    </div>
</body>

</html>`;
}

// ============ 更新 index.html ============

function updateIndexHTML(date, data) {
  const { subtitle, newsCount, newFaces, news } = data;
  let html = fs.readFileSync(INDEX_PATH, 'utf-8');

  const issueNum = countExistingIssues() + 1;
  const prevTotal = countTotalNews();
  const newTotal = prevTotal + newsCount;

  // 1. 更新已发布期数
  html = html.replace(
    /(<span class="stat-num">)\d+(<\/span>\s*<span class="stat-label">已发布期数<\/span>)/,
    `$1${issueNum}$2`
  );

  // 2. 更新累计资讯
  html = html.replace(
    /(<span class="stat-num">)\d+(<\/span>\s*<span class="stat-label">累计资讯<\/span>)/,
    `$1${newTotal}$2`
  );

  // 3. 更新 "共 X 期"
  html = html.replace(
    /(<span class="count">共 )\d+( 期<\/span>)/,
    `$1${issueNum}$2`
  );

  // 4. 生成 highlight tags（取前 5 条新闻的关键词）
  const hlTags = news.slice(0, 5).map(n => {
    // 从标题中提取短关键词
    const title = n.title;
    if (title.length <= 12) return title;
    // 尝试提取冒号前的部分或截取前12字
    const colonIdx = title.indexOf('：');
    if (colonIdx > 0 && colonIdx <= 15) return title.substring(0, colonIdx);
    return title.substring(0, 12);
  });

  // 5. 生成新的 issue card HTML
  const hlTagsHTML = hlTags.map(t => `                            <span class="hl-tag">${t}</span>`).join('\n');

  // 生成简短的 h3 标题（取前 3-5 条新闻用 / 连接）
  const h3Parts = news.slice(0, 5).map(n => {
    const t = n.title;
    const colonIdx = t.indexOf('：');
    if (colonIdx > 0 && colonIdx <= 20) return t.substring(0, colonIdx);
    return t.length > 18 ? t.substring(0, 18) : t;
  });

  const newCard = `
            <!-- ${date.dateStr} -->
            <a href="issues/${date.dateStr}.html" class="issue-card">
                <div class="issue-card-inner">
                    <div class="issue-date-block">
                        <span class="day">${date.day}</span>
                        <span class="month-year">${date.year}年${date.month}月</span>
                        <span class="weekday">${date.weekday}</span>
                    </div>
                    <div class="issue-body">
                        <div class="issue-subtitle">${subtitle}</div>
                        <h3>${h3Parts.join(' / ')}</h3>
                        <div class="issue-highlights">
${hlTagsHTML}
                        </div>
                        <div class="issue-meta">
                            <span>${newsCount} 条资讯</span>
                            <span>10+ 平台</span>
                            <span>${newFaces} 位新面孔</span>
                        </div>
                    </div>
                    <div class="read-arrow">&rarr;</div>
                </div>
            </a>`;

  // 插入到 issue-list 的最前面
  html = html.replace(
    '<div class="issue-list">',
    `<div class="issue-list">${newCard}`
  );

  fs.writeFileSync(INDEX_PATH, html, 'utf-8');
  console.log(`✅ index.html 已更新: 第${issueNum}期, 累计${newTotal}条资讯`);
}

// ============ 主流程 ============

async function main() {
  console.log('🚀 AI 日报自动生成开始\n');

  const date = getBeijingDate();
  console.log(`📅 日期: ${date.displayDate} ${date.weekday}`);
  console.log(`🤖 LLM: ${LLM_PROVIDER}\n`);

  // 检查是否已经生成过
  const targetFile = path.join(ISSUES_DIR, `${date.dateStr}.html`);
  if (fs.existsSync(targetFile)) {
    console.log(`⚠️ ${date.dateStr} 的日报已存在，跳过生成`);
    process.exit(0);
  }

  // Step 1: 搜索
  console.log('\n=== Step 1: 搜索 AI 资讯 ===');
  const searchResults = await searchAllNews(date.dateStr);
  if (searchResults.length === 0) {
    throw new Error('搜索结果为空，无法生成日报');
  }

  // Step 2: AI 筛选和生成
  console.log('\n=== Step 2: AI 内容生成 ===');
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(searchResults, date);
  console.log('🧠 调用 LLM 中...');
  const llmResponse = await callLLM(systemPrompt, userPrompt);
  console.log('✅ LLM 响应完成');

  // Step 3: 解析
  console.log('\n=== Step 3: 解析内容 ===');
  const data = parseLLMResponse(llmResponse);
  console.log(`📰 筛选出 ${data.newsCount} 条资讯, ${data.newFaces} 个新面孔`);

  // Step 4: 渲染 HTML
  console.log('\n=== Step 4: 渲染 HTML ===');
  if (!fs.existsSync(ISSUES_DIR)) {
    fs.mkdirSync(ISSUES_DIR, { recursive: true });
  }
  const html = renderDailyHTML(date, data);
  fs.writeFileSync(targetFile, html, 'utf-8');
  console.log(`✅ 日报已写入: ${targetFile}`);

  // Step 5: 更新 index.html
  console.log('\n=== Step 5: 更新首页 ===');
  updateIndexHTML(date, data);

  console.log('\n🎉 AI 日报生成完成！');
  console.log(`📄 文件: issues/${date.dateStr}.html`);
  console.log(`📊 内容: ${data.newsCount} 条资讯, ${data.newFaces} 个新面孔`);
}

main().catch(err => {
  console.error('\n❌ 生成失败:', err.message);
  process.exit(1);
});
