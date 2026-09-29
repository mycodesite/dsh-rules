import { Context } from "@deepseek-ai/cordis";
//#region src/host/index.d.ts
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    rulebase: {
      kind: 'rulebase-update';
    };
  }
}
declare const name = "rulebase";
declare const inject: string[];
/**
 * 全局规则目录解析：优先宿主 cordis 服务 dshHomePath（与 dsh 官方 resolveDshHome 完全一致，含 configured 覆盖），
 * 服务未提供 / 查询失败 / 非函数时回退 paths.globalRulesDir()（$DSH_HOME → ~/.dsh）。
 * 装配期解析一次并同时传给 store 与 injector，保证读、写、监听三处目录同源。
 */
declare function resolveGlobalRulesDir(ctx: Context): string;
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name, resolveGlobalRulesDir };
//# sourceMappingURL=index.d.mts.map