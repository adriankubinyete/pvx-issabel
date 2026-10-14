import { describe, expect, test } from "bun:test";
import { executeInstall } from "../src/install.ts";
import { STORE_KEY, type NetinstallProgress, type PhaseId } from "../src/state.ts";
import { fakeSystem, failing, lineOf, OPTIONS, PASSWORDS, type FakeSystem } from "./fake.ts";

const fresh = (system: FakeSystem, options = OPTIONS) => executeInstall(system.deps, { mode: "fresh", options, passwords: PASSWORDS });
const progressOf = (system: FakeSystem) => system.store.get<NetinstallProgress>(STORE_KEY.progress)!;
const stateOf = (system: FakeSystem, id: PhaseId) => progressOf(system).phases.find((phase) => phase.id === id)!.state;
const dnfInstalls = (system: FakeSystem) => system.calls.filter((call) => call.cmd === "dnf" && call.args[0] === "install");

describe("a clean install", () => {
  test("runs the phases in order and finishes them all", async () => {
    const system = fakeSystem();
    expect((await fresh(system)).ok).toBe(true);
    const order = ["dnf install -y epel-release", "dnf makecache", "dnf install -y htop tmux", "cp -f", "setenforce 0", "groupadd -f -r asterisk", "dnf install -y issabel-config_helpers", "rpm -q remi-release", "dnf module enable php:remi-7.4 -y", "dnf clean all", "systemctl start mariadb", "rm -f /etc/issabel.conf", "mkdir --parents /var/log/asterisk/cdr-csv", "install_amp --dbuser=root", "rm -rf /var/www/html/modules/control_panel", "timedatectl set-timezone America/Sao_Paulo", "issabel-admin-passwords --cli init"];
    const positions = order.map((prefix) => system.indexOf(prefix));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(progressOf(system).phases.map((phase) => phase.state)).toEqual(["done", "done", "done", "done", "done", "done", "done", "done", "done", "skipped"]);
  });

  test("the Asterisk version and the extras reach the dnf batches", async () => {
    const system = fakeSystem();
    await fresh(system, { ...OPTIONS, astver: "16", addpkgs: ["wanpipe"] });
    const base = dnfInstalls(system).find((call) => call.args.includes("asterisk16-devel"))!;
    expect(base.args).toContain("asterisk16");
    expect(base.args).not.toContain("asterisk18");
    const issabel = dnfInstalls(system).find((call) => call.args.includes("issabel-geoip"))!;
    expect(issabel.args).toContain("wanpipe-utils");
    expect(issabel.args).not.toContain("issabel-license");
  });

  test("--skip-clean skips dnf clean all", async () => {
    const system = fakeSystem();
    await fresh(system, { ...OPTIONS, skipClean: true });
    expect(system.lines()).not.toContain("dnf clean all");
  });

  test("the bundled assets are copied with cp", async () => {
    const system = fakeSystem();
    await fresh(system);
    const repos = system.calls.find((call) => call.cmd === "cp" && call.args.at(-1) === "/etc/yum.repos.d/")!;
    expect(repos.args).toContain("/module/assets/repos/Issabel5.repo");
    expect(system.lines()).toContain("cp -R /module/assets/control_panel /var/www/html/modules/control_panel");
    expect(system.calls.filter((call) => call.cmd === "sqlite3")).toHaveLength(3);
  });

  test("the package progress counts every transaction", async () => {
    const system = fakeSystem();
    await fresh(system);
    const { packages } = progressOf(system);
    expect(packages.done.length).toBeGreaterThan(50);
    expect(packages.total).toBe(packages.done.length);
    expect(packages.failed).toEqual([]);
    expect(packages.running).toEqual([]);
  });

  test("the timezone is set with timedatectl, and falls back to the symlink", async () => {
    const system = fakeSystem({ rules: [failing((call) => call.cmd === "timedatectl")], files: { "/etc/php.ini": ";date.timezone =\n" } });
    expect((await fresh(system, { ...OPTIONS, timezone: "America/Manaus" })).ok).toBe(true);
    expect(system.lines()).toContain("ln -sf /usr/share/zoneinfo/America/Manaus /etc/localtime");
    expect(system.fs.files.get("/etc/php.ini")).toBe("date.timezone = America/Manaus\n");
    expect(system.lines()).toContain("systemctl reload httpd");
  });

  test("SELinux is turned off in its config", async () => {
    const system = fakeSystem({ files: { "/etc/selinux/config": "SELINUX=enforcing\nSELINUXTYPE=targeted\n" } });
    await fresh(system);
    expect(system.fs.files.get("/etc/selinux/config")).toBe("SELINUX=disabled\nSELINUXTYPE=targeted\n");
  });
});

describe("guards: a rerun changes nothing it does not have to", () => {
  test("an existing asterisk user is not created again", async () => {
    const system = fakeSystem({ files: { "/etc/passwd": "root:x:0:0\nasterisk:x:100:100\n" } });
    await fresh(system);
    expect(system.calls.some((call) => call.cmd === "useradd")).toBe(false);
    expect(system.lines()).toContain("groupadd -f -r asterisk");
  });
  test("without the user, useradd runs", async () => {
    const system = fakeSystem();
    await fresh(system);
    expect(system.calls.find((call) => call.cmd === "useradd")?.args).toContain("asterisk");
  });
  test("the ipv6 guard is appended once and sysctl.conf is not rewritten when it is there", async () => {
    const present = fakeSystem({ files: { "/etc/sysctl.conf": "net.ipv6.conf.all.disable_ipv6 = 1\n" } });
    await fresh(present);
    expect(present.fs.writes).not.toContain("/etc/sysctl.conf");
    const missing = fakeSystem({ files: { "/etc/sysctl.conf": "vm.swappiness = 10\n" } });
    await fresh(missing);
    expect(missing.fs.files.get("/etc/sysctl.conf")).toBe("vm.swappiness = 10\nnet.ipv6.conf.all.disable_ipv6 = 1\n");
  });
  test("Remi is installed by URL from the OS major, and skipped when already there", async () => {
    const missing = fakeSystem({ rules: [failing((call) => call.cmd === "rpm")] });
    await fresh(missing);
    expect(missing.lines()).toContain("dnf install -y https://rpms.remirepo.net/enterprise/remi-release-8.rpm");
    const present = fakeSystem();
    await fresh(present);
    expect(present.lines().some((line) => line.includes("remi-release-8.rpm"))).toBe(false);
  });
  test("firewalld is only touched when firewall-cmd exists", async () => {
    const without = fakeSystem({ rules: [failing((call) => call.cmd === "firewall-cmd", { code: 127 })] });
    await fresh(without);
    expect(without.lines()).not.toContain("systemctl disable firewalld");
    const withIt = fakeSystem();
    await fresh(withIt);
    expect(withIt.lines()).toContain("systemctl disable firewalld");
    expect(withIt.lines()).toContain("systemctl stop firewalld");
  });
  test("fop2 is stopped and disabled", async () => {
    const system = fakeSystem();
    await fresh(system);
    expect(system.lines()).toContain("systemctl stop fop2");
    expect(system.lines()).toContain("systemctl disable fop2");
  });
  test("the MySQL root password goes through stdin and a 0600 client file, never argv", async () => {
    const system = fakeSystem();
    await fresh(system);
    const mysqlCalls = system.calls.filter((call) => call.cmd === "mysql");
    expect(mysqlCalls).toHaveLength(2);
    expect(mysqlCalls[0]!.stdin).toContain("SET PASSWORD FOR 'root'@'localhost' = PASSWORD('iSsAbEl.2o17')");
    expect(mysqlCalls[1]!.args[0]).toStartWith("--defaults-extra-file=");
    expect(mysqlCalls[1]!.stdin).toContain("PASSWORD('')");
    expect(mysqlCalls.flatMap((call) => call.args).join(" ")).not.toContain("iSsAbEl");
    expect(system.fs.events).toContain("chmod 600 /state/mysql-root.cnf");
    expect(system.fs.files.has("/state/mysql-root.cnf")).toBe(false);
  });
  test("a rerun of post finds the temporary password already set, and the root password already empty", async () => {
    const rules = [failing((call) => call.cmd === "mysql" && call.stdin?.includes("PASSWORD('iSsAbEl.2o17')") === true && call.args.length === 0)];
    const system = fakeSystem({ rules });
    expect((await fresh(system)).ok).toBe(true);
    const alreadyEmpty = fakeSystem({ rules: [failing((call) => call.cmd === "mysql" && call.args.length > 0 && call.stdin?.includes("PASSWORD('')") === true)] });
    expect((await fresh(alreadyEmpty)).ok).toBe(true);
  });
  test("when neither password works the post phase fails", async () => {
    const system = fakeSystem({ rules: [failing((call) => call.cmd === "mysql")] });
    const outcome = await fresh(system);
    expect(outcome).toMatchObject({ ok: false, failedPhase: "post" });
  });
});

describe("fatal versus warning", () => {
  test("a failing makecache is a warning", async () => {
    const system = fakeSystem({ rules: [failing((call) => lineOf(call) === "dnf makecache")] });
    expect((await fresh(system)).ok).toBe(true);
    expect(system.say.lines.some((line) => line.level === "warning" && line.text.includes("dnf makecache"))).toBe(true);
  });
  test("sqlite failures only warn: the panel files are there", async () => {
    const system = fakeSystem({ rules: [failing((call) => call.cmd === "sqlite3")] });
    expect((await fresh(system)).ok).toBe(true);
    expect(system.say.lines.filter((line) => line.level === "warning").length).toBeGreaterThanOrEqual(3);
  });
  test("a failing install_amp stops the install at the database phase", async () => {
    const system = fakeSystem({ rules: [failing((call) => call.cmd === "install_amp", { code: 1, lines: ["ERROR 1045 (28000): Access denied for user 'root'@'localhost'"] })] });
    const outcome = await fresh(system);
    expect(outcome).toMatchObject({ ok: false, failedPhase: "database" });
    expect(stateOf(system, "database")).toBe("failed");
    expect(stateOf(system, "panel")).toBe("pending");
    expect(system.lines().some((line) => line.startsWith("rm -rf /var/www/html/modules/control_panel"))).toBe(false);
    const { error } = progressOf(system);
    expect(error).toMatchObject({ phase: "database", code: 1 });
    expect(error!.cause).toContain("senha do MySQL");
    expect(error!.output.join("\n")).toContain("Access denied");
    expect(system.say.lines.some((line) => line.level === "error" && line.text.includes("banco do IssabelPBX"))).toBe(true);
  });
  test("issabel-admin-passwords failing is fatal; the fop2 sync failing is a warning", async () => {
    const fatal = fakeSystem({ rules: [failing((call) => call.cmd === "issabel-admin-passwords")] });
    expect(await fresh(fatal)).toMatchObject({ ok: false, failedPhase: "passwords" });
    const soft = fakeSystem({ files: { "/usr/local/fop2/create_fop2_manager_user.pl": "#!/usr/bin/perl" }, rules: [failing((call) => call.cmd === "create_fop2_manager_user.pl")] });
    expect((await fresh(soft)).ok).toBe(true);
    expect(soft.say.lines.some((line) => line.level === "warning" && line.text.includes("fop2"))).toBe(true);
  });
  test("a program that cannot start (127) stops a must-step with its output", async () => {
    const system = fakeSystem({ rules: [failing((call) => call.cmd === "groupadd", { code: 127, stderr: "groupadd: command not found" })] });
    expect(await fresh(system)).toMatchObject({ ok: false, failedPhase: "prepare" });
  });
});

describe("batch then one by one", () => {
  const batchFails = (bad: string[]) =>
    failing((call) => call.cmd === "dnf" && call.args[0] === "install" && call.args.slice(2).some((name) => bad.includes(name)), { code: 1, lines: [`Error: Unable to find a match: ${bad.join(" ")}`] });

  test("a bad name fails the batch, the retry installs the rest one by one and lists the failure", async () => {
    const system = fakeSystem({ rules: [batchFails(["php-mcrypt"])] });
    const outcome = await fresh(system);
    expect(outcome).toMatchObject({ ok: false, failedPhase: "packages" });
    const singles = dnfInstalls(system).filter((call) => call.args.length === 3 && call.args[2] !== "epel-release" && call.args[2] !== "issabel-config_helpers");
    expect(singles.length).toBeGreaterThan(40);
    expect(singles.map((call) => call.args[2])).toContain("php-mcrypt");
    expect(progressOf(system).error!.command).toContain("php-mcrypt");
    expect(progressOf(system).error!.output.join(" ")).toContain("php-mcrypt");
    expect(progressOf(system).packages.failed).toContain("php-mcrypt");
    expect(system.say.lines.some((line) => line.level === "warning" && line.text.includes("pacote a pacote"))).toBe(true);
  });
  test("the Issabel batch is not tried when the base batch left a failure", async () => {
    const system = fakeSystem({ rules: [batchFails(["php-mcrypt"])] });
    await fresh(system);
    expect(dnfInstalls(system).some((call) => call.args.includes("issabel-geoip"))).toBe(false);
  });
  test("a batch that works is not retried", async () => {
    const system = fakeSystem();
    await fresh(system);
    const base = dnfInstalls(system).filter((call) => call.args.includes("httpd"));
    expect(base).toHaveLength(1);
  });
});

describe("resume", () => {
  const failAt = (cmdName: string) => failing((call) => call.cmd === cmdName);

  test("skips the finished phases, redoes the failed one and reads the passwords from the credentials file", async () => {
    const system = fakeSystem({ rules: [failAt("install_amp")] });
    expect(await fresh(system)).toMatchObject({ ok: false, failedPhase: "database" });
    const callsBefore = system.calls.length;
    const saved = progressOf(system);
    const second = fakeSystem({ files: Object.fromEntries(system.fs.files), store: { [STORE_KEY.progress]: saved }, installed: system.installed });
    expect((await executeInstall(second.deps, { mode: "resume" })).ok).toBe(true);
    expect(callsBefore).toBeGreaterThan(second.calls.length);
    for (const early of ["dnf install", "dnf makecache", "setenforce", "systemctl start mariadb", "cp -f"]) expect(second.indexOf(early)).toBe(-1);
    expect(second.indexOf("install_amp")).toBe(0);
    expect(second.say.lines.filter((line) => line.text.includes("já concluída")).length).toBe(5);
    const initCall = second.calls.find((call) => call.cmd === "issabel-admin-passwords")!;
    expect(initCall.args.slice(2)).toEqual([PASSWORDS.sql, PASSWORDS.web]);
    expect(progressOf(second).phases.filter((phase) => phase.state === "done")).toHaveLength(9);
  });

  test("a phase left running by a dead job goes back to pending and runs again", async () => {
    const system = fakeSystem({ rules: [failAt("install_amp")] });
    await fresh(system);
    const saved = progressOf(system);
    saved.phases.find((phase) => phase.id === "database")!.state = "running";
    saved.error = undefined;
    const second = fakeSystem({ files: Object.fromEntries(system.fs.files), store: { [STORE_KEY.progress]: saved }, installed: system.installed });
    await executeInstall(second.deps, { mode: "resume" });
    expect(second.indexOf("install_amp")).toBe(0);
  });

  test("a resumed package phase keeps the packages already done and counts the new ones", async () => {
    const system = fakeSystem({ rules: [failing((call) => call.cmd === "dnf" && call.args.includes("issabel-geoip"))] });
    await fresh(system);
    const done = progressOf(system).packages.done.length;
    expect(done).toBeGreaterThan(40);
    expect(progressOf(system).packages.failed).toContain("issabel-geoip");
    const second = fakeSystem({ files: Object.fromEntries(system.fs.files), store: { [STORE_KEY.progress]: progressOf(system) }, installed: system.installed });
    await executeInstall(second.deps, { mode: "resume" });
    const { packages } = progressOf(second);
        expect(packages.done.length).toBeGreaterThan(done);
    expect(packages.failed).toEqual([]);
    expect(packages.total).toBe(packages.done.length);
  });

  test("with nothing to resume it says so", async () => {
    const outcome = await executeInstall(fakeSystem().deps, { mode: "resume" });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && "error" in outcome && (outcome.error as Error).message).toContain("não há instalação");
  });

  test("without the credentials file it refuses, instead of resetting the passwords", async () => {
    const system = fakeSystem({ rules: [failAt("install_amp")] });
    await fresh(system);
    const second = fakeSystem({ store: { [STORE_KEY.progress]: progressOf(system) } });
    const outcome = await executeInstall(second.deps, { mode: "resume" });
    expect(outcome.ok).toBe(false);
    expect(second.calls).toHaveLength(0);
  });
});

describe("the reboot phase", () => {
  const withReboot = { ...OPTIONS, reboot: true };

  test("waits for the countdown, then reboots", async () => {
    const system = fakeSystem();
    expect((await fresh(system, withReboot)).ok).toBe(true);
    expect(system.lines().at(-1)).toBe("reboot");
    expect(system.clock.now).toBeGreaterThanOrEqual(1_800_000_000_000 + 60_000);
  });
  test("an answer of `now` or `postponed` from the store ends the wait", async () => {
    const now = fakeSystem();
    const sleeping = now.deps.sleep;
    now.deps.sleep = async (ms) => {
      await sleeping(ms);
      const plan = now.store.get<{ at: number; choice: string }>(STORE_KEY.reboot);
      if (plan) now.store.set(STORE_KEY.reboot, { ...plan, choice: "now" });
    };
    await fresh(now, withReboot);
    expect(now.lines().at(-1)).toBe("reboot");
    expect(now.clock.now).toBeLessThan(1_800_000_000_000 + 60_000);

    const postponed = fakeSystem();
    const sleepingToo = postponed.deps.sleep;
    postponed.deps.sleep = async (ms) => {
      await sleepingToo(ms);
      const plan = postponed.store.get<{ at: number; choice: string }>(STORE_KEY.reboot);
      if (plan) postponed.store.set(STORE_KEY.reboot, { ...plan, choice: "postponed" });
    };
    await fresh(postponed, withReboot);
    expect(postponed.lines()).not.toContain("reboot");
    expect(progressOf(postponed).phases.at(-1)).toMatchObject({ state: "done", detail: "adiado" });
  });
});

describe("logs", () => {
  test("every phase logs its start and end at info/success and a failure at error", async () => {
    const system = fakeSystem();
    await fresh(system);
    for (const label of ["repositórios", "preparo do sistema", "PHP 7.4 (Remi)", "pacotes", "pós-instalação", "banco do IssabelPBX", "painel do operador", "fuso horário", "senhas"]) {
      expect(system.say.lines).toContainEqual({ level: "info", text: `fase ${label}: iniciando` });
      expect(system.say.lines).toContainEqual({ level: "success", text: `fase ${label}: concluída` });
    }
    expect(system.say.lines).toContainEqual({ level: "info", text: "fase reiniciar: pulada (--no-reboot)" });
  });
  test("the full dnf output goes to the raw (job log) channel, with the command echoed", async () => {
    const system = fakeSystem();
    await fresh(system);
    const raw = system.say.lines.filter((line) => line.level === "raw").map((line) => line.text);
    expect(raw).toContain("$ dnf install -y epel-release");
    expect(raw.some((line) => line.includes("Transaction Summary"))).toBe(true);
    expect(raw.some((line) => line.startsWith("  Installing       : epel-release"))).toBe(true);
  });
  test("progress lines are not repeated at info level", async () => {
    const system = fakeSystem();
    await fresh(system);
    expect(system.say.lines.filter((line) => line.level === "info" && /Installing|Verifying/.test(line.text))).toEqual([]);
  });
});
