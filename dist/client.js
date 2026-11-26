window.__ModuleLoader__.load({
  id: "dsh-span-compaction",
  factory: (require) => {
    var module = { exports: {} };
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  BUNDLE_NAME: () => BUNDLE_NAME,
  ENTRY_ID: () => ENTRY_ID,
  FIELDS: () => FIELDS,
  LOCALE_NS: () => LOCALE_NS,
  SpanCardController: () => SpanCardController,
  SpanSettingsPage: () => SpanSettingsPage,
  apply: () => apply,
  dictionaryFor: () => dictionaryFor,
  en: () => en,
  formLabels: () => formLabels,
  mountSettingsPage: () => mountSettingsPage,
  settingsBooleanField: () => settingsBooleanField,
  zh: () => zh
});
module.exports = __toCommonJS(index_exports);

// src/client/locales.ts
var LOCALE_NS = "dsh-span-compaction";
var en = {
  title: "Span compaction",
  summary: "Replay budget, model compaction tools, and the context-pressure reminder.",
  budget: "Replay budget (tokens)",
  budgetHint: "Default 160,000. Limits the region one automatic summarization request replays; it is not the request's total token cap and does not limit manual /compact.",
  threshold: "Automatic compaction threshold",
  thresholdHint: "Default 0.8: share of the routed model window at which a step-boundary compaction runs. A model that declares a 1M-token window puts 0.8 near 840,000 tokens, so only a much smaller value fires on ordinary sessions.",
  tools: "Compaction tools",
  toolsHint: "Default on. Hiding the tools does not disable the automatic compaction fallback, and reminders pause while they are hidden.",
  nudge: "Context-pressure reminder",
  nudgeHint: "Default on. A reminder only suggests compaction; it never runs one by itself.",
  ratio: "Reminder context ratio",
  ratioHint: "Default 0.2. Above 0 and at most 1; the token floor must be reached as well.",
  minTokens: "Minimum tokens before a reminder",
  minTokensHint: "Default 100,000. With an unknown context window, twice this count is required.",
  everySteps: "Steps between reminders",
  everyStepsHint: "Default 10. Context must also grow by at least 2%.",
  approval: "Ask before compacting",
  approvalHint: "Default on. The model waits for your approval before compact replaces retained history; Full access never prompts.",
  targets: "Exempt the candidate list",
  targetsHint: "Default on. compact_targets skips downstream pre-execute policy, including Auto review, so listing adds no review request.",
  overridden: "Overridden",
  reset: "Reset to inherited value",
  invalid: "Enter a number, or leave blank to use the default.",
  unavailable: "This plugin is not loaded, so it cannot be configured right now.",
  readOnly: "This deployment stores settings read-only.",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  save: "Save",
  saving: "Saving…"
};
var zh = {
  title: "分段压缩",
  summary: "重放预算、模型压缩工具与上下文压力提醒。",
  budget: "重放预算（token）",
  budgetHint: "默认 160,000。仅限制单次自动摘要重放的历史长度，不是整个请求的 token 上限，也不限制手动 /compact。",
  threshold: "自动压缩阈值",
  thresholdHint: "默认 0.8：计费上下文达到所路由模型窗口的这个比例时，在步边界自动压缩。模型窗口声明为 1M 时，0.8 约等于 840,000 token，普通会话只有明显调小才会触发。",
  tools: "压缩工具",
  toolsHint: "默认开启。关闭工具不会停止自动压缩兜底；工具关闭期间提醒也会暂停。",
  nudge: "上下文压力提醒",
  nudgeHint: "默认开启。提醒只建议压缩，不会自行执行压缩。",
  ratio: "提醒上下文比例",
  ratioHint: "默认 0.2。大于 0 且不超过 1，并需同时达到最低 token 数。",
  minTokens: "触发提醒的最少 token",
  minTokensHint: "默认 100,000。模型窗口未知时，需达到该数值的两倍。",
  everySteps: "提醒间隔步数",
  everyStepsHint: "默认 10。上下文还须增长至少 2%。",
  approval: "压缩前请求确认",
  approvalHint: "默认开启。模型执行 compact 会先等你确认；“完全权限”档不弹窗。",
  targets: "候选列表免审查",
  targetsHint: "默认开启。compact_targets 跳过下游预执行策略（含自动审查），列候选不产生额外审查请求。",
  overridden: "已覆盖",
  reset: "恢复继承值",
  invalid: "请输入数字；留空表示使用默认值。",
  unavailable: "此插件当前未加载，无法配置。",
  readOnly: "此部署的配置为只读。",
  saveFailed: "部署没有接受这些值，已保留给你修改。",
  save: "保存",
  saving: "正在保存…"
};
function dictionaryFor(language) {
  return typeof language === "string" && language.toLowerCase().startsWith("zh") ? zh : en;
}
function formLabels(t) {
  return {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving")
  };
}

// src/client/settings-controller.ts
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/fields.ts
var FIELDS = [
  { field: "spanBudgetTokens", kind: "number", label: "budget", hint: "budgetHint" },
  { field: "thresholdRatio", kind: "number", label: "threshold", hint: "thresholdHint" },
  { field: "toolsEnabled", kind: "switch", label: "tools", hint: "toolsHint" },
  { field: "nudgeEnabled", kind: "switch", label: "nudge", hint: "nudgeHint" },
  { field: "nudgeRatio", kind: "number", label: "ratio", hint: "ratioHint" },
  { field: "nudgeMinTokens", kind: "number", label: "minTokens", hint: "minTokensHint" },
  { field: "nudgeEverySteps", kind: "number", label: "everySteps", hint: "everyStepsHint" },
  { field: "approveCompact", kind: "switch", label: "approval", hint: "approvalHint" },
  { field: "exemptTargets", kind: "switch", label: "targets", hint: "targetsHint" }
];
function settingsBooleanField(field) {
  return {
    field,
    format: (value) => value === true ? "on" : value === false ? "off" : "",
    parse: (text) => {
      if (text === "on") return { kind: "set", value: true };
      if (text === "off") return { kind: "set", value: false };
      return void 0;
    }
  };
}

// src/client/settings-controller.ts
var SPECS = FIELDS.map((field) => field.kind === "switch" ? settingsBooleanField(field.field) : (0, import_dsh_client_ui_primitives.settingsNumberField)(field.field));
var SpanCardController = class {
  form;
  store;
  /** @param scope - the shared configuration form of this bundle's Host entry. */
  constructor(scope) {
    this.form = new import_dsh_client_ui_primitives.SettingsFormModel(scope, SPECS);
    this.store = this.form.bind(() => this.projection());
  }
  /**
   * Project the form onto the page's state.
   *
   * Rebuilt from the scope and the local drafts together, so a Host write and a
   * staged edit both reach the page through one snapshot.
   * @returns the frame's state plus one state per control.
   */
  projection() {
    const states = {};
    for (const field of FIELDS) states[field.field] = this.form.field(field.field);
    return { ...this.form.shell(), ...states };
  }
  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and the form's own actions.
   */
  inject() {
    return { hooks: { spanCard: this.store }, ...this.form.actions() };
  }
  /** Release the form's accepted-value subscription. */
  dispose() {
    this.form.dispose();
  }
};

// src/client/settings-page.tsx
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
var STYLE = {
  field: { display: "flex", flexDirection: "column", gap: 6, padding: "12px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" },
  head: { display: "flex", alignItems: "center", gap: 8 },
  labelGroup: { display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 },
  label: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: "var(--dsw-alias-label-primary)" },
  badges: { display: "inline-flex", alignItems: "center", gap: 8 },
  reset: { border: "none", background: "none", padding: 0, font: "inherit", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary)", cursor: "pointer" },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" },
  tag: { padding: "0 6px", border: "0.5px solid var(--dsw-alias-border-l2)", borderRadius: "var(--dsw-radius-sm)", fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" }
};
function SwitchField(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: STYLE.field, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: STYLE.head, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: STYLE.labelGroup, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: STYLE.label, children: props.label }) }),
      props.state.overridden ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: STYLE.badges, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: STYLE.tag, children: props.overriddenLabel }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: STYLE.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_dsh_client_ui_primitives2.Switch,
        {
          checked: props.state.text === "on",
          label: props.label,
          disabled: props.disabled,
          onChange: props.onChange
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: STYLE.hint, children: props.hint })
  ] });
}
function SpanSettingsPage(props) {
  const state = props.useSpanCard((snapshot) => snapshot);
  const { t } = props;
  if (props.view === "summary") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: t("summary") });
  const disabled = !state.writable || state.saving;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.SettingsForm, { labels: formLabels(t), state, onSave: props.save, onDiscard: props.discard, children: FIELDS.map((field) => field.kind === "switch" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    SwitchField,
    {
      label: t(field.label),
      hint: t(field.hint),
      state: state[field.field],
      disabled,
      overriddenLabel: t("overridden"),
      resetLabel: t("reset"),
      onChange: (next) => {
        props.edit(field.field, next ? "on" : "off");
      },
      onReset: () => {
        props.resetField(field.field);
      }
    },
    field.field
  ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    ValueField,
    {
      field,
      state: state[field.field],
      t,
      disabled,
      onEdit: (text) => {
        props.edit(field.field, text);
      },
      onReset: () => {
        props.resetField(field.field);
      }
    },
    field.field
  )) });
}
function ValueField(props) {
  const { t, field } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives2.SettingsValueField,
    {
      id: `plugin-config-span-${field.field}`,
      label: t(field.label),
      hint: t(field.hint),
      overriddenLabel: t("overridden"),
      resetLabel: t("reset"),
      invalidLabel: t("invalid"),
      disabled: props.disabled,
      numeric: field.kind === "number",
      ...props.state,
      onEdit: props.onEdit,
      onReset: props.onReset
    }
  );
}

// src/client/index.ts
var BUNDLE_NAME = "dsh-span-compaction";
var ENTRY_ID = "span-compaction";
function apply(ctx) {
  try {
    mountSettingsPage(ctx);
  } catch (error) {
    console.error("dsh-span-compaction: settings page failed to mount", error);
  }
}
function mountSettingsPage(ctx) {
  ctx.inject(["slots", "configForms", "locale"], (inner) => inner.effect(() => {
    let releaseDicts;
    try {
      releaseDicts = inner.locale.register(LOCALE_NS, { en, zh });
    } catch (error) {
      console.warn("dsh-span-compaction: settings copy fell back to its own dictionaries", error);
    }
    const t = resolveCopy(inner);
    const disposePage = inner.configForms.whileServed([ENTRY_ID], () => {
      const controller = new SpanCardController(inner.configForms.get(ENTRY_ID));
      const disposeSlot = inner.slots.inject("plugins.bundle.config", () => inner.slots.register({
        name: "plugins.bundle.config",
        key: BUNDLE_NAME,
        locale: LOCALE_NS,
        inject: () => ({ t, ...controller.inject() })
      }, SpanSettingsPage));
      return () => {
        disposeSlot?.();
        controller.dispose();
      };
    });
    return () => {
      disposePage?.();
      releaseDicts?.();
    };
  }, "dsh-span-compaction: settings page"));
}
function resolveCopy(ctx) {
  try {
    const bound = ctx.locale.bind(LOCALE_NS);
    if (bound("title") !== "title") return (key) => bound(key);
  } catch {
  }
  return (key) => {
    let language;
    try {
      language = ctx.locale.getSnapshot().active;
    } catch {
    }
    return dictionaryFor(language)[key] ?? key;
  };
}

    return module.exports;
  }
});
