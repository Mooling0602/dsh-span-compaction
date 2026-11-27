/**
 * The settings page's copy.
 *
 * The dictionaries are TypeScript constants rather than the `locale/*.json`
 * files in this repository, because the locale service's `register` takes
 * dictionaries by value and nothing in the client bundle reads a JSON file at
 * runtime. The JSON files stay the translator-facing source for the plugin
 * listing's `meta`, which the Host reads.
 *
 * @module dsh-span-compaction/client/locales
 */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale namespace this bundle owns. */
export const LOCALE_NS = 'dsh-span-compaction'

/** Locale keys the page renders. */
export type LocaleKey =
  | 'title' | 'summary'
  | 'budget' | 'budgetHint'
  | 'threshold' | 'thresholdHint'
  | 'tools' | 'toolsHint'
  | 'nudge' | 'nudgeHint'
  | 'ratio' | 'ratioHint'
  | 'strongRatio' | 'strongRatioHint'
  | 'minTokens' | 'minTokensHint'
  | 'everySteps' | 'everyStepsHint'
  | 'approval' | 'approvalHint' | 'targets' | 'targetsHint'
  | 'overridden' | 'reset' | 'invalid'
  | 'unavailable' | 'readOnly' | 'saveFailed' | 'save' | 'saving'

/** English copy. */
export const en: Record<LocaleKey, string> = {
  title: 'Span compaction',
  summary: 'Replay budget, model compaction tools, and the context-pressure reminder.',
  budget: 'Replay budget (tokens)',
  budgetHint: 'Default 160,000. Set 0 for unlimited replay on the first automatic compaction attempt. With 0 or a value above the default, a failure retries once at the default. Model and proxy limits still apply. This does not affect manual /compact.',
  threshold: 'Automatic compaction threshold',
  thresholdHint: 'Default 0.8: share of the routed model window at which a step-boundary compaction runs. A model that declares a 1M-token window puts 0.8 near 840,000 tokens, so only a much smaller value fires on ordinary sessions.',
  tools: 'Compaction tools',
  toolsHint: 'Default on. Hiding the tools does not disable the automatic compaction fallback, and reminders pause while they are hidden.',
  nudge: 'Context-pressure reminder',
  nudgeHint: 'Default on. A reminder only suggests compaction; it never runs one by itself.',
  ratio: 'Reminder context ratio',
  ratioHint: 'Default 0.2. Above 0 and at most 1; the token floor must be reached as well.',
  strongRatio: 'Strong reminder threshold',
  strongRatioHint: 'Default 0.25. At this share of the window every step carries a short reminder, and a new turn opens with the strong one; a declined compaction pauses it for the rest of that turn only.',
  minTokens: 'Minimum tokens before a reminder',
  minTokensHint: 'Default 100,000. With an unknown context window, twice this count is required.',
  everySteps: 'Steps between reminders',
  everyStepsHint: 'Default 10. Context must also grow by at least 2%.',
  approval: 'Ask before compacting',
  approvalHint: 'Default on. The model waits for your approval before compact replaces retained history; Full access still requires no confirmation.',
  targets: 'Exempt the candidate list',
  targetsHint: 'Default on. compact_targets skips downstream pre-execute policy, including Auto review, so listing adds no review request.',
  overridden: 'Overridden',
  reset: 'Reset to inherited value',
  invalid: 'Enter a number, or leave blank to use the default.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  save: 'Save',
  saving: 'Saving…',
}

/** Simplified Chinese copy. */
export const zh: Record<LocaleKey, string> = {
  title: '分段压缩',
  summary: '重放预算、模型压缩工具与上下文压力提醒。',
  budget: '重放预算（token）',
  budgetHint: '默认 160,000。设为 0 时，自动压缩不限制重放长度。预算为 0 或超过默认值时，失败后用默认预算重试一次。仍受模型和代理的请求上限约束，不影响手动 /compact。',
  threshold: '自动压缩阈值',
  thresholdHint: '默认 0.8：计费上下文达到所路由模型窗口的这个比例时，在步边界自动压缩。模型窗口声明为 1M 时，0.8 约等于 840,000 token，普通会话只有明显调小才会触发。',
  tools: '压缩工具',
  toolsHint: '默认开启。关闭工具不会停止自动压缩兜底；工具关闭期间提醒也会暂停。',
  nudge: '上下文压力提醒',
  nudgeHint: '默认开启。提醒只建议压缩，不会自行执行压缩。',
  ratio: '提醒上下文比例',
  ratioHint: '默认 0.2。大于 0 且不超过 1，并需同时达到最低 token 数。',
  strongRatio: '强提醒阈值',
  strongRatioHint: '默认 0.25。达到窗口该比例后每一步都附带简短提醒，新一轮开始也直接用强提醒；用户拒绝压缩只暂停当前轮次的强提醒。',
  minTokens: '触发提醒的最少 token',
  minTokensHint: '默认 100,000。模型窗口未知时，需达到该数值的两倍。',
  everySteps: '提醒间隔步数',
  everyStepsHint: '默认 10。上下文还须增长至少 2%。',
  approval: '压缩前请求确认',
  approvalHint: '默认开启。模型执行 compact 会先等你确认；“完全权限”档仍无需确认。',
  targets: '候选列表免审查',
  targetsHint: '默认开启。compact_targets 跳过下游预执行策略（含自动审查），列候选不产生额外审查请求。',
  overridden: '已覆盖',
  reset: '恢复继承值',
  invalid: '请输入数字；留空表示使用默认值。',
  unavailable: '此插件当前未加载，无法配置。',
  readOnly: '此部署的配置为只读。',
  saveFailed: '部署没有接受这些值，已保留给你修改。',
  save: '保存',
  saving: '正在保存…',
}

/**
 * Pick this bundle's dictionary for a language tag.
 * @param language - the client's active language tag.
 * @returns the dictionary to read.
 */
export function dictionaryFor(language: unknown): Record<string, string> {
  return typeof language === 'string' && language.toLowerCase().startsWith('zh') ? zh : en
}

/**
 * The form frame's copy.
 * @param t - the bound copy resolver.
 * @returns the labels `SettingsForm` renders.
 */
export function formLabels(t: (key: LocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}
