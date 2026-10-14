import { describe, expect, test } from "bun:test";
import { applyDnfLine, createDnfState, endDnfRun, splitNevra, type DnfState } from "../src/dnf.ts";
import { dnfSuccessLines, dnfTableLines, dnfTransactionLines, SAMPLE_PACKAGES } from "./dnf-sample.ts";

const feed = (state: DnfState, lines: string[]) => lines.forEach((line) => applyDnfLine(state, line));
const names = (refs: { name: string }[]) => refs.map((ref) => ref.name);

describe("splitNevra", () => {
  test("name, version-release and arch", () => {
    expect(splitNevra("php-imap-7.4.33-1.el8.remi.x86_64")).toEqual({ name: "php-imap", version: "7.4.33-1.el8.remi", arch: "x86_64" });
    expect(splitNevra("asterisk18-core-18.20.2-1.el8.x86_64.rpm")).toEqual({ name: "asterisk18-core", version: "18.20.2-1.el8", arch: "x86_64" });
    expect(splitNevra("httpd-filesystem-2.4.37-62.module+el8.noarch").name).toBe("httpd-filesystem");
  });
  test("a plain name stays whole", () => {
    expect(splitNevra("asterisk18")).toEqual({ name: "asterisk18", version: "", arch: undefined });
    expect(splitNevra("php-IDNA_Convert").name).toBe("php-IDNA_Convert");
  });
});

describe("the transaction summary and the table", () => {
  test("Install N Packages gives the total, the table gives name and version", () => {
    const state = createDnfState();
    feed(state, dnfTableLines(SAMPLE_PACKAGES));
    expect(state.packages.total).toBe(4);
    expect(state.known.htop).toMatchObject({ version: "3.2.1-1.el8", repo: "epel", size: "120 k" });
    expect(state.known["some-extremely-long-package-name-that-wraps-around"]).toMatchObject({ version: "1.0.0-1.el8", repo: "appstream" });
  });
  test("module streams and headers are not packages", () => {
    const state = createDnfState();
    feed(state, dnfTableLines(SAMPLE_PACKAGES));
    expect(Object.keys(state.known)).not.toContain("php");
    expect(Object.keys(state.known)).not.toContain("Package");
  });
});

describe("per-package state", () => {
  test("Installing makes it running; the next package makes the previous one done", () => {
    const state = createDnfState();
    feed(state, dnfTableLines(SAMPLE_PACKAGES));
    feed(state, dnfTransactionLines(SAMPLE_PACKAGES).slice(0, 15));
    const { running, done } = state.packages;
    expect(names(running)).toEqual(["tmux"]);
    expect(running[0]).toMatchObject({ stage: "installing", version: "2.7-1.el8" });
    expect(names(done)).toEqual(["libevent"]);
  });
  test("Running scriptlet moves the package to configuring", () => {
    const state = createDnfState();
    feed(state, dnfTableLines(SAMPLE_PACKAGES));
    feed(state, ["  Installing       : tmux-2.7-1.el8.x86_64    2/4", "  Running scriptlet: tmux-2.7-1.el8.x86_64    2/4"]);
    expect(state.packages.running).toEqual([expect.objectContaining({ name: "tmux", stage: "configuring" })]);
  });
  test("Verifying finishes a package", () => {
    const state = createDnfState();
    feed(state, ["  Installing       : tmux-2.7-1.el8.x86_64    1/1", "  Verifying        : tmux-2.7-1.el8.x86_64    1/1"]);
    expect(names(state.packages.done)).toEqual(["tmux"]);
    expect(state.packages.running).toEqual([]);
  });
  test("a whole successful run ends with everything done", () => {
    const state = createDnfState();
    feed(state, dnfSuccessLines(SAMPLE_PACKAGES));
    endDnfRun(state, true);
    expect(state.packages.done).toHaveLength(4);
    expect(state.packages.running).toEqual([]);
    expect(state.packages.total).toBe(4);
  });
  test("a download progress redraw shows the package as downloading but never as done", () => {
    const state = createDnfState();
    feed(state, dnfTableLines(SAMPLE_PACKAGES));
    feed(state, ["(2/4): tmux-2.7-1.el8.x86_64.rpm  45% [=====      ] 1.1 MB/s | 90 kB  00:01 ETA"]);
    expect(state.packages.running).toEqual([expect.objectContaining({ name: "tmux", stage: "downloading" })]);
    expect(state.packages.done).toEqual([]);
    feed(state, ["(2/4): tmux-2.7-1.el8.x86_64.rpm          1.1 MB/s | 120 kB     00:00"]);
    expect(state.packages.running).toEqual([]);
  });
  test("redraws of the same progress do not count as a change", () => {
    const state = createDnfState();
    const line = "(2/4): tmux-2.7-1.el8.x86_64.rpm  45% [=====      ] 1.1 MB/s | 90 kB  00:01 ETA";
    expect(applyDnfLine(state, line)).toBe(true);
    expect(applyDnfLine(state, line)).toBe(false);
  });
  test("downloads still running when the transaction starts are dropped", () => {
    const state = createDnfState();
    feed(state, ["(2/4): tmux-2.7-1.el8.x86_64.rpm  45% [=====      ]", "Running transaction"]);
    expect(state.packages.running).toEqual([]);
  });
});

describe("failures", () => {
  test("Unable to find a match marks the names failed", () => {
    const state = createDnfState();
    feed(state, ["No match for argument: wanpipe", "Error: Unable to find a match: wanpipe-utils wanpipe"]);
    expect(state.packages.failed).toEqual(["wanpipe", "wanpipe-utils"]);
  });
  test("a scriptlet error and the Failed: list", () => {
    const state = createDnfState();
    feed(state, ["Error in POSTIN scriptlet in rpm package issabel-5.0.0-1.el8.noarch", "Failed:", "  asterisk18-18.20.2-1.el8.x86_64  httpd-2.4.37-1.el8.x86_64", "", "Error: Transaction failed"]);
    expect(state.packages.failed).toEqual(["issabel", "asterisk18", "httpd"]);
  });
  test("a failed run drops its total and turns what was running into failures", () => {
    const state = createDnfState();
    feed(state, dnfTableLines(SAMPLE_PACKAGES));
    feed(state, ["  Installing       : tmux-2.7-1.el8.x86_64    2/4"]);
    endDnfRun(state, false);
    expect(state.packages.failed).toEqual(["tmux"]);
    expect(state.packages.total).toBe(1);
  });
  test("a package that later installs well is no longer failed", () => {
    const state = createDnfState();
    feed(state, ["Error: Unable to find a match: tmux"]);
    feed(state, ["  Installing       : tmux-2.7-1.el8.x86_64    1/1", "  Verifying        : tmux-2.7-1.el8.x86_64    1/1"]);
    expect(state.packages.failed).toEqual([]);
  });
});

describe("several runs", () => {
  test("totals add up run after run and a retry does not count twice", () => {
    const state = createDnfState();
    feed(state, dnfSuccessLines(SAMPLE_PACKAGES.slice(0, 2)));
    endDnfRun(state, true);
    feed(state, dnfSuccessLines(SAMPLE_PACKAGES.slice(2)));
    endDnfRun(state, true);
    expect(state.packages.total).toBe(4);
    expect(state.packages.done).toHaveLength(4);
  });
  test("a resumed state counts what was already done", () => {
    const state = createDnfState({ total: 10, done: [{ name: "a", version: "1" }, { name: "b", version: "1" }], running: [], failed: [] });
    feed(state, dnfTableLines(SAMPLE_PACKAGES));
    expect(state.packages.total).toBe(6);
  });
});
