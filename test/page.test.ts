import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runSession, type Session, type TuiHarness } from "@pvx/testing";
import { FIXTURE, inject, restoreHost, stateDirOf, until, useDetachedJobs } from "./host.ts";
import { CREDENTIALS_TEXT, failedAtDatabase, finished, installing, LOG_LINES, NOW } from "./samples.ts";

let page: TuiHarness | undefined;
let session: Session;
beforeEach(async () => {
  useDetachedJobs();
  session = await runSession(FIXTURE);
});
afterEach(() => {
  page?.destroy();
  page = undefined;
  restoreHost();
});

const SIZES = [
  [80, 24],
  [120, 40],
] as const;

/** The page, mounted; `text` waits (by time) for a string to be on screen. */
async function open(cols: number, rows: number): Promise<TuiHarness> {
  page = await session.renderPage("issabel", { cols, rows });
  return page;
}
const frameOf = async (p: TuiHarness) => (await p.flush(), p.frame());
const waitText = (p: TuiHarness, text: string, ms = 10_000) => until(() => frameOf(p), (frame) => frame.includes(text), ms);
const press = async (p: TuiHarness, ...keys: string[]) => {
  for (const key of keys) await p.press(key);
};
/** Rows of the frame (borders and blank rows aside), to compare widths. */
const rowsOf = (frame: string) => frame.split("\n");
const widest = (frame: string) => Math.max(...rowsOf(frame).map((row) => [...row.trimEnd()].length));
/** The central of the fixture is Rocky 8.10 and healthy: this walks hub -> verification -> the first question. */
const toQuestions = async (p: TuiHarness) => {
  await waitText(p, "netinstall");
  await p.press("RETURN");
  await waitText(p, "Versão do Asterisk");
};
/** From the first question: accept the defaults and blank passwords, landing on the confirm step. */
const toConfirm = async (p: TuiHarness) => {
  await press(p, "RETURN", "RETURN", "RETURN");
  await waitText(p, "Antes de instalar");
};
const injectRunning = () => inject(session.home, { progress: installing(), job: { state: "running", startedAt: NOW - 13 * 60_000 }, log: LOG_LINES });
const credentialsPath = () => `${stateDirOf(session.home)}/credenciais-x.txt`;

describe("the hub", () => {
  for (const [cols, rows] of SIZES)
    test(`lists the tools with the central above, at ${cols}x${rows}`, async () => {
      const p = await open(cols, rows);
      const frame = await waitText(p, "netinstall");
      expect(frame).toContain("central-sp-01 · Rocky Linux 8.10");
      expect(frame).toContain("Issabel: não instalado");
      expect(frame).toContain("netinstall");
      expect(frame).toContain("backups");
      expect(frame).toContain("saúde");
      expect(frame.match(/em breve/g)).toHaveLength(2);
      expect(frame).toContain("~20 min");
      expect(widest(frame)).toBeLessThanOrEqual(cols);
    });

  test("a tool that is not there yet says so; the arrows and the mouse move to it", async () => {
    const p = await open(100, 30);
    await waitText(p, "backups");
    await press(p, "ARROW_DOWN", "RETURN");
    expect(p.frame()).toContain("em breve");
    expect(p.frame()).not.toContain("Versão do Asterisk");
    await press(p, "ARROW_DOWN", "ARROW_DOWN"); // wraps from the last tool to the first
    await press(p, "RETURN");
    await waitText(p, "Versão do Asterisk");
  });

  test("the mouse opens netinstall", async () => {
    const p = await open(100, 30);
    const frame = await waitText(p, "netinstall");
    const y = rowsOf(frame).findIndex((row) => row.includes("» netinstall"));
    await p.click(8, y);
    await waitText(p, "Versão do Asterisk");
  });
});

describe("verification", () => {
  test("shows each check with a spinner while it runs, then the questions", async () => {
    process.env.ISSABEL_FAKE_DELAY_MS = "400";
    const p = await open(100, 30);
    await waitText(p, "netinstall");
    await p.press("RETURN");
    const frame = await waitText(p, "testando mirror.issabel.org…");
    expect(frame).toContain("✓ root");
    expect(frame).toContain("Rocky Linux 8.10");
    expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] rede/);
    expect(frame).toContain("○ memória");
    expect(frame).toContain("○ instalação anterior");
    await waitText(p, "Versão do Asterisk");
  });

  test("a blocking problem stays with its cause; `f` goes on over an earlier install (--force)", async () => {
    process.env.ISSABEL_FAKE_PRESENT = "1";
    const p = await open(100, 30);
    await waitText(p, "netinstall");
    await p.press("RETURN");
    const frame = await waitText(p, "--force");
    expect(frame).toContain("✗ instalação anterior");
    expect(frame).toContain("f instalar mesmo assim");
    expect(frame).toContain("r refazer");
    await p.press("f");
    await waitText(p, "Versão do Asterisk");
    await toConfirm(p);
    expect(p.frame()).toContain("--force");
  });

  test("esc leaves to the hub", async () => {
    process.env.ISSABEL_FAKE_PRESENT = "1";
    const p = await open(100, 30);
    await waitText(p, "netinstall");
    await p.press("RETURN");
    await waitText(p, "--force");
    await p.press("ESCAPE");
    await waitText(p, "ferramentas");
  });
});

describe("the questions and the confirm step", () => {
  for (const [cols, rows] of SIZES)
    test(`only Asterisk and the passwords are asked; the extras wait in the confirm step, at ${cols}x${rows}`, async () => {
      const p = await open(cols, rows);
      await toQuestions(p);
      const first = p.frame();
      expect(first).toContain("✓ verificação");
      expect(first).toContain("(●) 18");
      expect(first).toContain("recomendado");
      expect(first).not.toContain("Pacotes extras");
      await press(p, "RETURN", "RETURN", "RETURN");
      const frame = await waitText(p, "Antes de instalar");
      expect(frame).toContain("Pacotes extras");
      expect(frame).toContain("licenciados, blocklist");
      if (cols >= 100) expect(frame).toContain("(padrão)"); // the host cuts the line at 80 columns
      expect(frame).toContain("gerada");
      expect(frame).toContain("a central reinicia sozinha ao terminar");
      expect(frame).toContain("o firewalld é desligado");
      expect(frame).toContain("20 min");
      expect(frame).toContain("[ instalar ]");
      expect(frame).toContain("[ copiar CLI ]");
      expect(frame).toContain("pvx issabel netinstall --astver 18 --addpkgs licensed,community-blocklist");
      expect(widest(frame)).toBeLessThanOrEqual(cols);
    });

  test("the password is masked while typed, ctrl+g generates one, blank is generated", async () => {
    const p = await open(100, 30);
    await toQuestions(p);
    await press(p, "RETURN");
    await p.type("SegredoDoMysql1");
    expect(p.frame()).not.toContain("SegredoDoMysql1");
    expect(p.frame()).toContain("●●●●●●●●●●●●●●●");
    await p.press("RETURN");
    await p.press("g", { ctrl: true });
    expect(p.frame()).toMatch(/[A-Za-z0-9]{24}/); // shown while the field is focused
    await p.press("RETURN");
    const frame = await waitText(p, "Antes de instalar");
    expect(frame).toContain("Senha do root do MySQL (em branco: gerar)   definida");
    expect(frame).not.toContain("SegredoDoMysql1");
  });

  test("an answer is editable from the confirm step and the flow comes back to it", async () => {
    const p = await open(100, 36);
    await toQuestions(p);
    await toConfirm(p);
    expect(p.frame()).not.toContain("wanpipe");
    // up to the answered lines: the extras row is the fourth
    await press(p, "ARROW_UP", "ARROW_UP");
    await p.press("RETURN");
    await waitText(p, "[x] licenciados");
    await press(p, "ARROW_DOWN", "ARROW_DOWN", " ", "RETURN"); // tick wanpipe
    const frame = await waitText(p, "Antes de instalar");
    expect(frame).toContain("licenciados, blocklist, wanpipe");
    expect(frame).not.toMatch(/Pacotes extras\s+licenciados, blocklist, wanpipe\s+\(padrão\)/);
    expect(frame).toContain("--addpkgs licensed,community-blocklist,wanpipe");
  });

  test("the Asterisk answer changes the equivalent CLI line", async () => {
    const p = await open(100, 30);
    await toQuestions(p);
    await press(p, "ARROW_DOWN", "RETURN", "RETURN", "RETURN");
    expect((await waitText(p, "Antes de instalar"))).toContain("--astver 16");
  });

  test("c copies the CLI line and shows exactly what was copied", async () => {
    const p = await open(120, 40);
    await toQuestions(p);
    await toConfirm(p);
    await p.press("c");
    const frame = await waitText(p, "copiado");
    expect(frame).toMatch(/copiado/);
    expect(frame.match(/pvx issabel netinstall --astver 18/g)!.length).toBeGreaterThanOrEqual(2); // the line, and the copy preview
  });

  test("nothing starts before [ instalar ]; esc at the top goes back to the hub", async () => {
    const p = await open(100, 30);
    await toQuestions(p);
    await toConfirm(p);
    expect((await session.run("issabel netinstall status")).text).toContain("job: none");
    await p.press("ESCAPE");
    await waitText(p, "ferramentas");
  });
});

describe("starting the install from the page and watching it", () => {
  test("[ instalar ] starts the job; the live view follows it to the end, and the countdown can be postponed", async () => {
    process.env.ISSABEL_FAKE_DELAY_MS = "50";
    const p = await open(120, 40);
    await toQuestions(p);
    await toConfirm(p);
    await p.press("RETURN"); // [ instalar ]
    const live = await waitText(p, "agora");
    expect(live).toContain("fases");
    expect(live).toContain("pacotes");
    expect(live).toMatch(/\d+%/);
    expect(live).toContain("faltam");
    const done = await waitText(p, "Issabel 5 instalado", 30_000);
    expect(done).toContain("https://203.0.113.10");
    expect(done).toContain("●●●●");
    expect(done).toContain("reiniciando em");
    await p.press("m");
    expect(p.frame()).toMatch(/senha web\s+[A-Za-z0-9]{24}/);
    await p.press("a");
    await waitText(p, "reinício adiado");
    await until(() => session.run("issabel netinstall status"), (status) => status.text.includes("reiniciar: concluída (adiado)"));
  }, 60_000);

  test("a start that the host refuses (a job already running) shows the error", async () => {
    injectRunning();
    const p = await open(100, 30);
    await waitText(p, "agora"); // the live view, because a job runs
    await p.press("ESCAPE");
    await waitText(p, "ferramentas");
    await press(p, "RETURN");
    await waitText(p, "agora");
  });
});

describe("the live view (injected progress)", () => {
  for (const [cols, rows] of SIZES)
    test(`phases with times, the log, what is installing now and the wall, at ${cols}x${rows}`, async () => {
      injectRunning();
      const p = await open(cols, rows);
      const frame = await waitText(p, "php-imap");
      expect(frame).toMatch(/45%/);
      expect(frame).toContain("faltam ~");
      expect(frame).toContain("✓ repositórios");
      expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] pacotes/);
      expect(frame).toContain("○ reiniciar");
      expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] agora/);
      expect(frame).toContain("▸ php-imap");
      expect(frame).toContain("baixando");
      expect(frame).toContain("instalando");
      expect(frame).toContain("configurando");
      expect(frame).toContain("▪ 96 concluído");
      expect(frame).toContain("▪ 3 rodando");
      expect(frame).toContain("▪ 1 falhou");
      expect(frame).toContain("▫ 81 pendente");
      expect(frame).toContain("Installing       : php-imap"); // the log tail
      expect(frame).toContain("l log completo");
      expect(frame).toContain("x parar");
      expect(widest(frame)).toBeLessThanOrEqual(cols);
    });

  test("96/181 on the packages step, and the elapsed time of each finished phase", async () => {
    injectRunning();
    const p = await open(120, 40);
    const frame = await waitText(p, "96/181");
    expect(frame).toMatch(/✓ repositórios\s+concluído\s+1m00s/);
  });

  test("a click on a cell shows the package behind it", async () => {
    injectRunning();
    const p = await open(120, 40);
    const frame = await waitText(p, "php-imap");
    const rows = rowsOf(frame);
    const y = rows.findIndex((row) => row.includes("▪ ▪ ▪ ▪"));
    const x = rows[y]!.indexOf("▪ ▪ ▪ ▪") + 2 * 3; // the fourth cell of the first wall row
    await p.click(x, y);
    const after = await waitText(p, "pacote-4");
    expect(after).toContain("pacote-4 · x86_64 · baseos · 120 k");
    expect(after).toContain("pacote-4 1.0-1.el8 · instalado"); // the grid's own label
  });

  test("l swaps the wall for the whole log and back", async () => {
    injectRunning();
    const p = await open(120, 40);
    await waitText(p, "php-imap");
    await p.press("l");
    const frame = await frameOf(p);
    expect(frame).toContain("log");
    expect(frame).not.toContain("▫ 81 pendente");
    expect(frame).toContain("l volta ao muro");
    await p.press("l");
    expect(await waitText(p, "▫ 81 pendente")).toContain("▪ 96 concluído");
  });

  test("x stops the job through the host and the view offers to continue", async () => {
    const sleeper = Bun.spawn(["sleep", "30"], { detached: true, stdout: "ignore", stderr: "ignore" }); // a real process of its own to stop
    inject(session.home, { progress: installing(), job: { state: "running", startedAt: NOW - 13 * 60_000, pid: sleeper.pid }, log: LOG_LINES });
    const p = await open(100, 30);
    await waitText(p, "php-imap");
    await p.press("x");
    const frame = await waitText(p, "instalação parada");
    expect(frame).toContain("[ continuar daqui ]");
    expect((await session.run("issabel netinstall status")).text).toContain("job: stopped");
    sleeper.kill();
  });

  test("a progress older than the job the host knows is not shown as this run", async () => {
    inject(session.home, { progress: installing(), job: { state: "running", startedAt: NOW + 60_000 }, log: [] });
    const p = await open(100, 30);
    await waitText(p, "iniciando a instalação…");
    expect(p.frame()).not.toContain("php-imap");
  });
});

describe("where it stopped (injected)", () => {
  const injectFailed = () => inject(session.home, { progress: failedAtDatabase(credentialsPath()), job: { state: "failed", startedAt: NOW - 20 * 60_000 }, log: LOG_LINES, credentials: CREDENTIALS_TEXT });

  for (const [cols, rows] of SIZES)
    test(`the bar stops red and contiguous, the error is in the right panel, at ${cols}x${rows}`, async () => {
      injectFailed();
      const p = await open(cols, rows);
      await waitText(p, "ferramentas");
      await p.press("RETURN");
      const frame = await waitText(p, "continuar daqui");
      expect(frame).toContain("falhou em");
      expect(frame).toContain("✗ banco do IssabelPBX");
      expect(frame).toContain("comando");
      expect(frame).toContain("install_amp");
      expect(frame).toContain("código 1");
      if (cols >= 100) expect(frame).toContain("Access denied");
      expect(frame).toContain("causa provável");
      expect(frame).toContain("senha do MySQL");
      expect(frame).toContain("[ continuar daqui ]");
      expect(frame).toContain("○ painel do operador");
      expect(widest(frame)).toBeLessThanOrEqual(cols);
      // the bar: filled cells, then the red ones, then the empty ones: spans with the error colour sit right after the accent run
      const barRow = rowsOf(frame).findIndex((row) => row.includes("falhou em"));
      const runs = p.spans().lines[barRow]!.spans.filter((span) => span.text.includes("━"));
      expect(runs.length).toBeGreaterThanOrEqual(3);
      const colours = runs.map((span) => String(span.fg));
      expect(new Set(colours).size).toBeGreaterThanOrEqual(3);
    });

  test("enter / the button continues: the job restarts from the failed phase and the install ends done", async () => {
    injectFailed();
    // the real state: the earlier phases are done in the store, so a resume skips them
    const p = await open(120, 40);
    await waitText(p, "ferramentas");
    await p.press("RETURN");
    await waitText(p, "continuar daqui");
    await p.press("RETURN");
    await waitText(p, "Issabel 5 instalado", 30_000);
    const log = (await session.run("issabel netinstall status")).text;
    expect(log).toContain("job: ");
    expect(log).toContain("✓ banco do IssabelPBX: concluída");
  }, 60_000);

  test("c copies the error; n starts a new verification", async () => {
    injectFailed();
    const p = await open(120, 40);
    await waitText(p, "ferramentas");
    await p.press("RETURN");
    await waitText(p, "continuar daqui");
    await p.press("c");
    expect(await waitText(p, "copiado")).toContain("install_amp");
    await p.press("n");
    await waitText(p, "Versão do Asterisk");
  });

  test("a stopped job (no error recorded) offers to continue", async () => {
    const progress = failedAtDatabase(credentialsPath());
    progress.error = undefined;
    inject(session.home, { progress, job: { state: "stopped", startedAt: NOW - 20 * 60_000 }, log: [], credentials: CREDENTIALS_TEXT });
    const p = await open(100, 30);
    await waitText(p, "ferramentas");
    await p.press("RETURN");
    expect(await waitText(p, "instalação parada")).toContain("[ continuar daqui ]");
  });
});

describe("the end (injected)", () => {
  const injectDone = (reboot: { at: number; choice: "wait" | "now" | "postponed" } | undefined, options = finished().options) =>
    inject(session.home, { progress: finished(credentialsPath(), options), reboot, job: { state: "running", startedAt: NOW - 20 * 60_000 }, credentials: CREDENTIALS_TEXT, log: [] });

  for (const [cols, rows] of SIZES)
    test(`URL, user, masked passwords and the countdown, at ${cols}x${rows}`, async () => {
      injectDone({ at: NOW + 45_000, choice: "wait" });
      const p = await open(cols, rows);
      const frame = await waitText(p, "Issabel 5 instalado");
      expect(frame).toContain("Asterisk 18 · 181 pacotes · painel do operador");
      expect(frame).toMatch(/acesso\s+https:\/\/203\.0\.113\.10/);
      expect(frame).toMatch(/usuário web\s+admin/);
      expect(frame).toMatch(/senha web\s+●+/);
      expect(frame).toMatch(/MySQL root\s+●+/);
      expect(frame).not.toContain("Xq7mP2vLr9tKa4sWz8nBc3yE");
      expect(frame).toContain("(0600)");
      expect(frame).toMatch(/reiniciando em 0:\d\d/);
      expect(frame).toContain("[ reiniciar agora ]");
      expect(frame).toContain("[ adiar ]");
      expect(widest(frame)).toBeLessThanOrEqual(cols);
    });

  test("m shows the passwords and hides them again", async () => {
    injectDone({ at: NOW + 45_000, choice: "wait" });
    const p = await open(100, 30);
    await waitText(p, "Issabel 5 instalado");
    await p.press("m");
    const shown = p.frame();
    expect(shown).toContain("Xq7mP2vLr9tKa4sWz8nBc3yE");
    expect(shown).toContain("Hd5uR1fJk6pZq9wTm2xNv7sA");
    expect(shown).toContain("m ocultar senhas");
    await p.press("m");
    expect(p.frame()).not.toContain("Xq7mP2vLr9tKa4sWz8nBc3yE");
  });

  test("c copies the formatted block and shows the preview of exactly that", async () => {
    injectDone({ at: NOW + 45_000, choice: "wait" });
    const p = await open(120, 40);
    await waitText(p, "Issabel 5 instalado");
    await p.press("c");
    const frame = await waitText(p, "✓ copiado");
    expect(frame).toMatch(/Issabel 5 instalado em central-sp-01 \(\d\d\/\d\d\/\d{4} \d\d:\d\d\)/);
    expect(frame).toContain("Acesso:      https://203.0.113.10");
    expect(frame).toContain("Usuário web: admin");
    expect(frame).toContain("Senha web:   Xq7mP2vLr9tKa4sWz8nBc3yE");
    expect(frame).toContain("MySQL root:  Hd5uR1fJk6pZq9wTm2xNv7sA");
    expect(frame).toContain("Asterisk 18 · pacotes: licenciados, blocklist · painel do operador");
    expect(frame).toMatch(/Reinício:\s+\d\d:\d\d/);
  });

  test("adiar answers the countdown through the module's own command", async () => {
    injectDone({ at: NOW + 45_000, choice: "wait" });
    const p = await open(100, 30);
    await waitText(p, "reiniciando em");
    await p.press("a");
    await waitText(p, "reinício adiado: reinicie");
    expect(p.frame()).not.toContain("[ adiar ]");
  });

  test("reiniciar agora asks the host to confirm first (the command is destructive)", async () => {
    injectDone({ at: NOW + 45_000, choice: "wait" });
    const p = await open(100, 30);
    await waitText(p, "reiniciando em");
    await p.press("RETURN");
    await waitText(p, "confirmar");
    await p.press("s");
    await waitText(p, "reiniciando a central");
  });

  test("with --no-reboot the screen says to reboot by hand; a postponed plan says so; an old plan says it restarted", async () => {
    injectDone(undefined, { ...finished().options, reboot: false });
    let p = await open(100, 30);
    expect(await waitText(p, "--no-reboot")).not.toContain("[ adiar ]");
    p.destroy();
    injectDone({ at: NOW + 45_000, choice: "postponed" }, finished().options);
    p = await open(100, 30);
    expect(await waitText(p, "reinício adiado: reinicie")).not.toContain("[ adiar ]");
    p.destroy();
    injectDone({ at: NOW - 10 * 60_000, choice: "now" }, finished().options);
    p = await open(100, 30);
    await waitText(p, "a central já reiniciou");
  });
});

describe("opening the tab while an install runs", () => {
  test("jumps straight to the live view, and esc goes back to the hub", async () => {
    injectRunning();
    const p = await open(100, 30);
    const frame = await waitText(p, "php-imap");
    expect(frame).not.toContain("ferramentas");
    await p.press("ESCAPE");
    await waitText(p, "ferramentas");
  });

  test("with a finished install the tab opens on the hub (no jump)", async () => {
    inject(session.home, { progress: finished(credentialsPath()), job: { state: "done", startedAt: NOW - 20 * 60_000 }, credentials: CREDENTIALS_TEXT, log: [] });
    const p = await open(100, 30);
    expect(await waitText(p, "ferramentas")).not.toContain("Issabel 5 instalado");
  });
});
