import type { CapabilityDef, ProofKit, ReadCtx } from "@pvx/sdk";

const ASTERISK_VERSION_TIMEOUT_MS = 5000;

const asteriskVersion = async (ctx: ReadCtx): Promise<string | undefined> => {
  const result = await ctx.exec("asterisk", ["-V"], { timeoutMs: ASTERISK_VERSION_TIMEOUT_MS }).catch(() => undefined);
  return result?.code === 0 ? result.stdout.trim() || "asterisk" : undefined;
};

const issabelVersion = async (ctx: ReadCtx): Promise<string | undefined> => {
  const result = await ctx.exec("rpm", ["-q", "--qf", "%{VERSION}-%{RELEASE}", "issabel"], { timeoutMs: ASTERISK_VERSION_TIMEOUT_MS }).catch(() => undefined);
  return result?.code === 0 ? result.stdout.trim() : undefined;
};

export function installedCapability(proof: ProofKit): CapabilityDef {
  const noAsterisk = async (ctx: ReadCtx) => ((await asteriskVersion(ctx)) ? undefined : proof.warn("o Asterisk não está instalado", { fix: "issabel netinstall" }));
  const noIssabel = async (ctx: ReadCtx) => ((await ctx.fs.exists("/etc/issabel.conf")) ? undefined : proof.warn("o Issabel não está instalado (sem /etc/issabel.conf)", { fix: "issabel netinstall" }));
  return {
    id: "issabel.installed",
    title: "Issabel instalado",
    goal: "A central tem o Asterisk e o Issabel instalados",
    fix: "issabel netinstall",
    optIn: true,
    prove: async (ctx) => {
      const problem = await proof.firstProblem(() => noAsterisk(ctx), () => noIssabel(ctx));
      if (problem) return problem;
      const [asterisk, issabel] = await Promise.all([asteriskVersion(ctx), issabelVersion(ctx)]);
      return proof.ok("Issabel instalado", { evidence: [asterisk, issabel && `issabel ${issabel}`].filter(Boolean).join(" · ") });
    },
  };
}
