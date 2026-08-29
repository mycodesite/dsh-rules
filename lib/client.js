window.__ModuleLoader__.load({ id: "rulebase", factory: (require) => {
var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
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
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/controller.ts
var RuleController = class {
  constructor(rpc) {
    this.rpc = rpc;
  }
  rpc;
  state = { status: "loading" };
  listeners = /* @__PURE__ */ new Set();
  getSnapshot = () => this.state;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  async load(level) {
    this.setState({ status: "loading" });
    const res = await this.rpc.call("list", { level });
    if (res.ok) this.setState({ status: "ready", rows: res.value });
    else this.setState({ status: "error", error: res.error.message });
  }
  /** 当前项目 cwd；未选定项目时返回 null */
  async currentCwd() {
    const res = await this.rpc.call("currentCwd", {});
    if (!res.ok) return null;
    const value = res.value;
    return value?.cwd ?? null;
  }
  async reload(level) {
    await this.rpc.call("reload", {});
    await this.load(level);
  }
  async create(level, content) {
    const res = await this.rpc.call("create", { level, content });
    if (res.ok) await this.load(level);
    return res.ok;
  }
  async save(level, id, content) {
    const res = await this.rpc.call("save", { level, id, content });
    if (res.ok) await this.load(level);
    return res.ok;
  }
  async remove(level, id) {
    const res = await this.rpc.call("remove", { level, id });
    if (res.ok) await this.load(level);
    return res.ok;
  }
  setState(next) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
};

// src/client/RuleSection.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var LEVELS = ["global", "project"];
var LABELS = { global: "\u5168\u5C40", project: "\u9879\u76EE" };
function useClickOutside(active, onClose) {
  const ref = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (!active) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [active, onClose]);
  return ref;
}
function RuleSection({ controller }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot);
  const [level, setLevel] = (0, import_react.useState)("global");
  const [editing, setEditing] = (0, import_react.useState)(null);
  const [confirmDeleteId, setConfirmDeleteId] = (0, import_react.useState)(null);
  const [createMenuOpen, setCreateMenuOpen] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const createWrapRef = useClickOutside(createMenuOpen, () => setCreateMenuOpen(false));
  const [projectCwd, setProjectCwd] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (level === "project") {
      void controller.currentCwd().then(setProjectCwd);
    } else {
      setProjectCwd(null);
    }
    void controller.load(level);
  }, [controller, level]);
  const rows = state.status === "ready" ? state.rows : [];
  const beginEdit = (rule) => setEditing({ id: rule.id, content: rule.content });
  const beginCreate = (target) => {
    setLevel(target);
    setCreateMenuOpen(false);
    setEditing({ id: null, content: "" });
  };
  const submitEdit = async () => {
    if (!editing) return;
    setBusy(true);
    if (level === "project") {
      const cwd = await controller.currentCwd();
      if (!cwd) {
        setBusy(false);
        window.alert("\u5F53\u524D\u672A\u9009\u5B9A\u9879\u76EE\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u9879\u76EE\u89C4\u5219\u3002\u8BF7\u5148\u9009\u5B9A\u4E00\u4E2A\u9879\u76EE\uFF08\u5F00\u542F\u4E00\u4E2A\u9879\u76EE\u5BF9\u8BDD\uFF09\u540E\u518D\u8BD5\u3002");
        return;
      }
    }
    const ok = editing.id === null ? await controller.create(level, editing.content) : await controller.save(level, editing.id, editing.content);
    setBusy(false);
    if (ok) setEditing(null);
  };
  const doRemove = async () => {
    if (!confirmDeleteId) return;
    setBusy(true);
    await controller.remove(level, confirmDeleteId);
    setBusy(false);
    setConfirmDeleteId(null);
  };
  const reload = async () => {
    setBusy(true);
    await controller.reload(level);
    setBusy(false);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.section, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.head, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.title, children: "\u89C4\u5219" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.headActions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.ghostButton, onClick: () => void reload(), disabled: busy, children: "\u5237\u65B0" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.createWrap, ref: createWrapRef, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              style: styles.primaryButton,
              onClick: () => setCreateMenuOpen((v) => !v),
              disabled: busy,
              children: "+ \u521B\u5EFA"
            }
          ),
          createMenuOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.menu, children: LEVELS.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.menuItem, onClick: () => beginCreate(l), children: LABELS[l] }, l)) })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.intro, children: "\u521B\u5EFA\u5E76\u7BA1\u7406\u89C4\u5219\uFF0C\u5728\u804A\u5929\u8FC7\u7A0B\u4E2D\u9075\u5FAA\u8FD9\u4E9B\u89C4\u5219\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.tabs, children: LEVELS.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        style: level === l ? styles.tabActive : styles.tab,
        onClick: () => setLevel(l),
        children: LABELS[l]
      },
      l
    )) }),
    state.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.muted, children: "\u52A0\u8F7D\u4E2D\u2026" }) : state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.error, role: "alert", children: state.error }) : rows.length === 0 ? level === "project" && projectCwd === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.warn, role: "alert", children: "\u672A\u9009\u5B9A\u9879\u76EE\uFF1A\u8BF7\u5148\u5F00\u542F\u4E00\u4E2A\u9879\u76EE\u5BF9\u8BDD\uFF08\u9009\u5B9A\u9879\u76EE\uFF09\u540E\uFF0C\u518D\u521B\u5EFA\u9879\u76EE\u89C4\u5219\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.muted, children: [
      "\u6682\u65E0",
      LABELS[level],
      "\u89C4\u5219\uFF0C\u70B9\u51FB\u201C+ \u521B\u5EFA\u201D\u6DFB\u52A0\u3002"
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: styles.list, children: rows.map((rule) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      RuleRow,
      {
        rule,
        onEdit: () => beginEdit(rule),
        onDelete: () => setConfirmDeleteId(rule.id)
      },
      rule.id
    )) }),
    editing && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.editor, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          style: styles.textarea,
          value: editing.content,
          disabled: busy,
          onChange: (e) => setEditing({ ...editing, content: e.target.value }),
          placeholder: "# \u89C4\u5219\u6807\u9898\n\n\u89C4\u5219\u5185\u5BB9\u2026"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.editorActions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.ghostButton, onClick: () => setEditing(null), disabled: busy, children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.primaryButton, onClick: () => void submitEdit(), disabled: busy, children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" })
      ] })
    ] }),
    confirmDeleteId && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.editor, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.intro, children: "\u786E\u5B9A\u5220\u9664\u8BE5\u89C4\u5219\uFF1F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.editorActions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.ghostButton, onClick: () => setConfirmDeleteId(null), disabled: busy, children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.dangerButton, onClick: () => void doRemove(), disabled: busy, children: busy ? "\u5220\u9664\u4E2D\u2026" : "\u5220\u9664" })
      ] })
    ] })
  ] });
}
function RuleRow({ rule, onEdit, onDelete }) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const actionsRef = useClickOutside(open, () => setOpen(false));
  const handleRowClick = (e) => {
    if (e.target.closest("[data-rule-actions]")) return;
    onEdit();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: styles.row, onClick: handleRowClick, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fileIcon }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.rowBody, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.rowTitle, children: rule.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.rowMeta, children: [
        rule.id,
        ".md"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.rowActions, "data-rule-actions": true, ref: actionsRef, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          style: styles.iconButton,
          "aria-label": "\u8BBE\u7F6E",
          onClick: () => setOpen((v) => !v),
          children: "\u22EE"
        }
      ),
      open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.menu, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.menuItem, onClick: () => {
          setOpen(false);
          onEdit();
        }, children: "\u7F16\u8F91" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.menuItem, onClick: () => {
          setOpen(false);
          onDelete();
        }, children: "\u5220\u9664" })
      ] })
    ] })
  ] });
}
var styles = {
  section: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { margin: 0, fontSize: 18 },
  headActions: { display: "flex", gap: 8, alignItems: "center" },
  intro: { margin: 0, color: "var(--dsw-alias-label-tertiary)", fontSize: 13 },
  createWrap: { position: "relative" },
  tabs: { display: "flex", gap: 4, borderBottom: "1px solid var(--dsw-alias-separator-primary)" },
  tab: { padding: "6px 12px", border: "none", background: "none", cursor: "pointer", borderBottom: "2px solid transparent", fontSize: 13 },
  tabActive: { padding: "6px 12px", border: "none", background: "none", cursor: "pointer", borderBottom: "2px solid var(--dsw-alias-brand-primary)", fontWeight: 600, fontSize: 13 },
  muted: { color: "var(--dsw-alias-label-tertiary)", fontSize: 13, margin: 0 },
  error: { color: "var(--dsw-alias-state-error-primary)", fontSize: 13, margin: 0 },
  warn: { color: "var(--dsw-alias-state-warn-primary)", fontSize: 13, margin: 0 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, cursor: "default" },
  fileIcon: { width: 12, height: 14, background: "var(--dsw-alias-brand-primary)", borderRadius: 2, flexShrink: 0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowMeta: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)" },
  rowActions: { position: "relative" },
  iconButton: { border: "none", background: "none", cursor: "pointer", padding: "4px 6px", fontSize: 16, color: "var(--dsw-alias-label-secondary)", lineHeight: 1 },
  menu: { position: "absolute", right: 0, top: "100%", background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", zIndex: 10, display: "flex", flexDirection: "column", minWidth: 88, marginTop: 2 },
  menuItem: { border: "none", background: "none", cursor: "pointer", textAlign: "left", padding: "6px 12px", fontSize: 13 },
  editor: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, padding: 10, background: "var(--dsw-alias-bg-layer-1)" },
  textarea: { width: "100%", minHeight: 160, fontFamily: "inherit", fontSize: 13, padding: 8, boxSizing: "border-box", resize: "vertical" },
  editorActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  ghostButton: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-button-ghost-active-fill)", color: "var(--dsw-alias-label-primary)", cursor: "pointer", padding: "4px 12px", borderRadius: 6, fontSize: 13 },
  primaryButton: { border: "none", background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-inverted)", cursor: "pointer", padding: "4px 12px", borderRadius: 6, fontSize: 13 },
  dangerButton: { border: "none", background: "var(--dsw-alias-state-error-primary)", color: "var(--dsw-alias-label-primary-inverted)", cursor: "pointer", padding: "4px 12px", borderRadius: 6, fontSize: 13 }
};

// src/client/index.ts
var name = "rulebase";
var inject = ["slots", "connection"];
function apply(ctx) {
  const ruleRpc = {
    call: (endpoint, payload) => ctx.connection.rpc.call("/rulebase", endpoint, payload)
  };
  const controller = new RuleController(ruleRpc);
  ctx.slots.inject("settings.section", () => ctx.slots.register(
    {
      name: "settings.section",
      id: "rulebase",
      order: 30,
      label: () => "\u89C4\u5219",
      inject: () => ({ controller })
    },
    RuleSection
  ));
}

return module.exports; } });
//# sourceMappingURL=client.js.map
