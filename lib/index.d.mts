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
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };
//# sourceMappingURL=index.d.mts.map