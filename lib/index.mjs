import { promises, watch } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
//#region src/host/paths.ts
/** 默认全局规则目录：~/.dsh/rules */
function globalRulesDir() {
	return path.join(os.homedir(), ".dsh", "rules");
}
/** 项目规则目录：<cwd>/.dsh/rules；无 cwd 时返回 undefined */
function projectRulesDir(cwd) {
	if (!cwd) return void 0;
	return path.join(cwd, ".dsh", "rules");
}
//#endregion
//#region src/host/store.ts
const MD_EXT = ".md";
/** 合成结果总量上限（字节），防单文件极大或文件数异常导致提示词暴涨。 */
const MAX_TOTAL_BYTES = 262144;
/** 统一换行为 \n */
function normalize(text) {
	return text.replace(/\r\n?/g, "\n");
}
/** 从正文提取标题：首个 H1 或首行，无则用 id */
function titleOf(id, content) {
	const first = content.trimStart().split("\n", 1)[0]?.trim() ?? "";
	if (first.startsWith("# ")) return first.slice(2).trim() || id;
	if (first.startsWith("#")) return first.slice(1).trim() || id;
	return first.length > 0 ? first.slice(0, 120) : id;
}
/** 原子写：临时文件 + rename，避免注入读到半写内容 */
async function atomicWrite(filePath, content) {
	const tmp = `${filePath}.${process.pid}.tmp`;
	await promises.writeFile(tmp, content, "utf8");
	await promises.rename(tmp, filePath);
}
var RuleStore = class {
	/** 可覆盖全局目录（测试用，缺省用 ~/.dsh/rules） */
	globalDir;
	constructor(globalDir) {
		this.globalDir = globalDir;
	}
	dirOf(level, cwd) {
		return level === "global" ? this.globalDir ?? globalRulesDir() : projectRulesDir(cwd ?? process.cwd());
	}
	/** 全量扫描某级规则目录的 *.md */
	async list(level, cwd) {
		const dir = this.dirOf(level, cwd);
		if (!dir) return [];
		let entries;
		try {
			entries = await promises.readdir(dir);
		} catch {
			return [];
		}
		const rules = [];
		for (const name of entries) {
			if (!name.endsWith(MD_EXT)) continue;
			const filePath = path.join(dir, name);
			let st;
			try {
				st = await promises.lstat(filePath);
			} catch {
				continue;
			}
			if (!st.isFile() || st.isSymbolicLink()) continue;
			const content = normalize(await promises.readFile(filePath, "utf8"));
			const id = name.slice(0, -3);
			rules.push({
				id,
				title: titleOf(id, content),
				content,
				level,
				filePath
			});
		}
		rules.sort((a, b) => a.id.localeCompare(b.id));
		return rules;
	}
	/** 保存（新建或覆盖）某级规则，返回其投影 */
	async save(level, id, content, cwd) {
		const dir = this.dirOf(level, cwd);
		if (!dir) throw new Error("无法解析规则目录（项目规则缺少 cwd）");
		await promises.mkdir(dir, { recursive: true });
		const filePath = path.join(dir, `${id}.md`);
		const normalized = normalize(content);
		await atomicWrite(filePath, normalized);
		return {
			id,
			title: titleOf(id, normalized),
			content: normalized,
			level,
			filePath
		};
	}
	/** 删除某级规则（不存在则幂等） */
	async remove(level, id, cwd) {
		const dir = this.dirOf(level, cwd);
		if (!dir) return;
		try {
			await promises.rm(path.join(dir, `${id}.md`));
		} catch {}
	}
};
//#endregion
//#region src/host/contract.ts
/**
* 深度冻结：与 @deepseek-ai/dsh-llm 的 deepFreeze 同语义
* （迭代式、WeakSet 环安全、Object.keys 遍历、跳过 AbortSignal）。
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [value];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		for (const key of Object.keys(node)) pending.push(node[key]);
	}
	return value;
}
/**
* 构造一条 user 角色消息 —— 与 dsh-llm 的 createUserMessage 逐字等价：
* 铸造 id → 固定 role → 结构化克隆脱钩 → 深度冻结后发布。
*
* 保持冻结语义是刻意的：宿主契约要求「freeze it before publication」，
* 下游（LLM 运行时 / 会话持久化）已在冻结对象上运行，偏离即改变行为。
*/
function createUserMessage(input) {
	const draft = {
		...input,
		role: "user",
		id: randomUUID()
	};
	return deepFreeze(structuredClone(draft));
}
/**
* 把异常折叠为 RpcResult 的错误分支 —— 与 dsh-host-apiproxy 的 transportError
* 逐字等价（'internal' 为兜底码，details 为 {}）。
*
* 不可改动 code / details：结果会经 serverResponseSchema 校验，
* 且 tests/smoke.test.ts L136 已断言 error.code === 'internal'。
*/
function transportError(error) {
	return {
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error),
			details: {}
		}
	};
}
//#endregion
//#region src/host/injector.ts
/** 稳定引导段：静态文本，保 KV Cache 前缀稳定 */
const GUIDANCE = `## 规则库（RuleBase）

本环境由 DSH 插件 rulebase 注入“规则”。下方【全局规则】/【项目规则】是当前生效的约束，请在对话与执行中严格遵守。`;
/** 全局缓存键（无 cwd 时） */
const GLOBAL_KEY = "__global__";
/** 合成全局+项目规则全文，超出总量则截断 */
function renderRules(global, project, cwd) {
	const parts = [];
	if (global.length > 0) parts.push("### 全局规则", ...global.map(ruleBlock));
	if (project.length > 0) parts.push(`### 项目规则${cwd ? `（cwd：${cwd}）` : ""}`, ...project.map(ruleBlock));
	if (parts.length === 0) return "";
	let text = parts.join("\n\n");
	if (Buffer.byteLength(text, "utf8") > 262144) text = `${Buffer.from(text, "utf8").subarray(0, MAX_TOTAL_BYTES).toString("utf8")}\n\n> …（规则总量超限，已截断）`;
	return text;
}
function ruleBlock(rule) {
	return `#### ${rule.title && rule.title !== rule.id ? rule.title : rule.id}\n\n${rule.content}`;
}
var RuleInjector = class {
	/** 合成字符串缓存：key = cwd（或 GLOBAL_KEY），value = 全量合成结果 */
	cache = /* @__PURE__ */ new Map();
	/** 活动 agent → cwd（供显式刷新） */
	activeAgents = /* @__PURE__ */ new Map();
	/** 见过的项目 cwd（reload 重算覆盖） */
	knownCwds = /* @__PURE__ */ new Set();
	watchers = /* @__PURE__ */ new Map();
	reloadPending = false;
	debounceTimer;
	ctx;
	store;
	constructor(ctx, store) {
		this.ctx = ctx;
		this.store = store;
	}
	/** 启动：预加载全局规则缓存 */
	async boot() {
		await this.refresh();
	}
	/** 异步读盘 + 合成 + 写缓存（cwd 为空 = 仅全局） */
	async refresh(cwd) {
		const global = await this.store.list("global");
		await this.renderToCache(global, cwd);
	}
	/** 用已读的全局规则合成并写缓存（复用全局，避免重复读盘） */
	async renderToCache(global, cwd) {
		const project = cwd ? await this.store.list("project", cwd) : [];
		this.cache.set(cwd ?? GLOBAL_KEY, renderRules(global, project, cwd));
	}
	/** 同步读缓存（供 systemPrompt 段 text 使用；未命中回退全局） */
	renderFromCache(cwd) {
		return this.cache.get(cwd ?? GLOBAL_KEY) ?? this.cache.get(GLOBAL_KEY) ?? "";
	}
	/** 当前项目 cwd：最近创建的活跃 agent 的 cwd；无活跃 agent 或无 cwd 返回 undefined */
	currentProjectCwd() {
		const values = [...this.activeAgents.values()];
		for (let i = values.length - 1; i >= 0; i--) if (typeof values[i] === "string" && values[i] !== "") return values[i];
	}
	/** 变更收敛：异步重算缓存 + 显式 agent.inject（不唤醒驱动） */
	async reload() {
		if (this.reloadPending) return;
		this.reloadPending = true;
		try {
			const global = await this.store.list("global");
			await this.renderToCache(global);
			for (const cwd of this.knownCwds) await this.renderToCache(global, cwd);
			for (const agent of this.activeAgents.keys()) try {
				agent.inject(createUserMessage({
					content: [{
						type: "text",
						text: "[规则已更新] 请按最新规则库继续。"
					}],
					source: { kind: "rulebase-update" }
				}));
			} catch (err) {
				console.warn("rulebase: agent.inject 失败", err);
			}
		} finally {
			this.reloadPending = false;
		}
	}
	/** 装配文件监听与会话生命周期钩子 */
	watch() {
		this.watchDir(globalRulesDir());
		this.ctx.on("agent/created", (payload) => {
			const agent = payload.agent;
			const cwd = agent.session.header.cwd;
			this.activeAgents.set(agent, cwd ?? "");
			if (cwd) {
				this.knownCwds.add(cwd);
				this.watchDir(projectRulesDir(cwd));
				this.refresh(cwd);
			}
		});
		this.ctx.on("agent/disposed", (payload) => {
			this.activeAgents.delete(payload.agent);
		});
		this.ctx.effect(() => {
			return () => {
				clearTimeout(this.debounceTimer);
				this.debounceTimer = void 0;
				for (const w of this.watchers.values()) w.close();
				this.watchers.clear();
			};
		}, "rulebase.watchers");
	}
	watchDir(dir) {
		if (!dir || this.watchers.has(dir)) return;
		try {
			const w = watch(dir, () => this.debounceReload());
			this.watchers.set(dir, w);
		} catch {}
	}
	debounceReload() {
		if (this.debounceTimer) return;
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = void 0;
			this.reload();
		}, 150);
		this.debounceTimer.unref?.();
	}
};
//#endregion
//#region src/host/service.ts
var RulesService = class {
	store;
	injector;
	constructor(store, injector) {
		this.store = store;
		this.injector = injector;
	}
	/** ConnectionRpcHandler：按 endpoint 分发；写操作成功后刷新注入 */
	dispatch = async (endpoint, payload) => {
		try {
			const value = await this.invoke(endpoint, payload);
			if (endpoint !== "list" && endpoint !== "reload" && endpoint !== "currentCwd") this.injector.reload();
			return this.ok(value);
		} catch (err) {
			return transportError(err);
		}
	};
	ok(value) {
		return {
			ok: true,
			value
		};
	}
	async invoke(endpoint, payload) {
		const p = payload ?? {};
		switch (endpoint) {
			case "currentCwd": return { cwd: this.injector.currentProjectCwd() ?? null };
			case "list": {
				const level = assertLevel(p.level);
				const cwd = this.resolveCwd(level, asString(p.cwd));
				if (level === "project" && !cwd) return [];
				return this.store.list(level, cwd);
			}
			case "create": {
				const level = assertLevel(p.level);
				const cwd = level === "project" ? this.requireProjectCwd(asString(p.cwd)) : void 0;
				const content = asString(p.content) ?? "";
				return this.store.save(level, newId(), content, cwd);
			}
			case "save": {
				const level = assertLevel(p.level);
				const id = asString(p.id) ?? "";
				if (!id) throw new Error("缺少规则 id");
				const cwd = level === "project" ? this.requireProjectCwd(asString(p.cwd)) : void 0;
				const content = asString(p.content) ?? "";
				return this.store.save(level, id, content, cwd);
			}
			case "remove": {
				const level = assertLevel(p.level);
				const id = asString(p.id) ?? "";
				if (!id) throw new Error("缺少规则 id");
				const cwd = this.resolveCwd(level, asString(p.cwd));
				if (level === "project" && !cwd) return void 0;
				await this.store.remove(level, id, cwd);
				return;
			}
			case "reload":
				await this.injector.reload();
				return { count: (await this.store.list("global")).length };
			default: throw new Error(`未知端点：${String(endpoint)}`);
		}
	}
	/** 项目级解析真实 cwd：client 传入优先，缺省用当前项目；全局级返回 undefined */
	resolveCwd(level, cwd) {
		return level === "project" ? cwd ?? this.injector.currentProjectCwd() : void 0;
	}
	/** 项目级写操作：解析真实 cwd，无则抛错提示先选定项目（调用方保证 level === 'project'） */
	requireProjectCwd(cwd) {
		const resolved = cwd ?? this.injector.currentProjectCwd();
		if (!resolved) throw new Error("当前未选定项目，无法保存项目规则，请先选定一个项目");
		return resolved;
	}
};
function assertLevel(v) {
	if (v === "global" || v === "project") return v;
	throw new Error(`非法 level：${String(v)}`);
}
function asString(v) {
	return typeof v === "string" && v.length > 0 ? v : void 0;
}
/** 生成新规则 id（时间戳 base36） */
function newId() {
	return `rule-${Date.now().toString(36)}`;
}
//#endregion
//#region src/host/index.ts
const name = "rulebase";
const inject = [];
function apply(ctx) {
	const store = new RuleStore();
	const injector = new RuleInjector(ctx, store);
	const service = new RulesService(store, injector);
	ctx.inject(["systemPrompt"], (scope) => {
		scope.systemPrompt.section({
			name: "rulebase:guidance",
			order: 160,
			text: GUIDANCE
		});
		injector.boot().then(() => {
			scope.systemPrompt.section({
				name: "rulebase:rules",
				order: 170,
				text: (assembleCtx) => injector.renderFromCache(assembleCtx.agent?.session.header.cwd ?? process.cwd())
			});
		});
	});
	ctx.inject(["connection"], (c) => {
		c.connection.rpc.handle("/rulebase", service.dispatch, { authority: "loopback" });
	});
	injector.watch();
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.mjs.map