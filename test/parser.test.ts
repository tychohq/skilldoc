import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHelp } from "../src/parser.js";

const gitHelp = readFileSync(new URL("./fixtures/git-help.txt", import.meta.url), "utf8");
const rgHelp = readFileSync(new URL("./fixtures/rg-help.txt", import.meta.url), "utf8");
const ghHelp = readFileSync(new URL("./fixtures/gh-help.txt", import.meta.url), "utf8");
const vercelHelp = readFileSync(new URL("./fixtures/vercel-help.txt", import.meta.url), "utf8");

describe("parseHelp", () => {
  it("extracts usage from git help", () => {
    const parsed = parseHelp(gitHelp);
    expect(parsed.usageLines.length).toBeGreaterThan(0);
  });

  it("extracts commands from git help", () => {
    const parsed = parseHelp(gitHelp);
    const names = parsed.commands.map((command) => command.name);
    expect(names).toContain("clone");
  });

  it("extracts options from rg help", () => {
    const parsed = parseHelp(rgHelp);
    expect(parsed.options.length).toBeGreaterThan(0);
  });
});

describe("parseHelp — all-caps headers (gh style)", () => {
  it("extracts usage from USAGE section", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.usageLines.length).toBeGreaterThan(0);
    expect(parsed.usageLines[0]).toContain("gh");
  });

  it("parses CORE COMMANDS section via fuzzy matching", () => {
    const parsed = parseHelp(ghHelp);
    const names = parsed.commands.map((c) => c.name);
    expect(names.some((n) => n.startsWith("auth"))).toBe(true);
  });

  it("extracts options from FLAGS section", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.options.length).toBeGreaterThan(0);
    const flags = parsed.options.map((o) => o.flags);
    expect(flags.some((f) => f.includes("--help"))).toBe(true);
  });

  it("extracts examples from EXAMPLES section", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.examples.length).toBeGreaterThan(0);
    expect(parsed.examples.some((e) => e.includes("gh"))).toBe(true);
  });

  it("does not produce no-commands warning", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.warnings).not.toContain("No commands detected.");
  });
});

describe("parseHelp — inline all-caps header fixture", () => {
  const input = `
USAGE
  mytool [flags] <arg>

COMMANDS
  run   Execute a task
  list  List available tasks

FLAGS
  --verbose   Enable verbose output
  --dry-run   Print actions without executing
`.trim();

  it("extracts usage from all-caps USAGE section", () => {
    const parsed = parseHelp(input);
    expect(parsed.usageLines.some((l) => l.includes("mytool [flags] <arg>"))).toBe(true);
  });

  it("extracts options from all-caps FLAGS section", () => {
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(2);
    expect(parsed.options[0].flags).toBe("--verbose");
    expect(parsed.options[1].flags).toBe("--dry-run");
  });
});

describe("parseHelp — fuzzy command section matching", () => {
  it("matches a section named 'CORE COMMANDS'", () => {
    const input = `
CORE COMMANDS
  init   Initialize the project
  run    Run the project
`.trim();
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("init");
    expect(names).toContain("run");
  });

  it("matches a section named 'MANAGEMENT COMMANDS'", () => {
    const input = `
MANAGEMENT COMMANDS
  start   Start a service
  stop    Stop a service
`.trim();
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("start");
    expect(names).toContain("stop");
  });

  it("matches a section named 'ADDITIONAL SUBCOMMANDS'", () => {
    const input = `
ADDITIONAL SUBCOMMANDS
  deploy   Deploy the app
  destroy  Tear down resources
`.trim();
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("deploy");
    expect(names).toContain("destroy");
  });

  it("combines commands from multiple command-containing sections", () => {
    const input = `
CORE COMMANDS
  auth   Authenticate
  repo   Manage repositories

ADDITIONAL COMMANDS
  alias  Create shortcuts
  api    Make API requests
`.trim();
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("auth");
    expect(names).toContain("repo");
    expect(names).toContain("alias");
    expect(names).toContain("api");
  });

  it("still matches a plain 'Commands:' header", () => {
    const input = `
Commands:
  build  Build the project
  test   Run tests
`.trim();
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("build");
    expect(names).toContain("test");
  });

  it("does not produce no-commands warning when fuzzy section found", () => {
    const input = `
CORE COMMANDS
  run   Execute
`.trim();
    const parsed = parseHelp(input);
    expect(parsed.warnings).not.toContain("No commands detected.");
  });
});

describe("parseHelp — gh-style trailing colon command names", () => {
  it("strips trailing colon from command name", () => {
    const input = `
COMMANDS
  auth:   Authenticate the tool
  repo:   Manage repositories
`.trim();
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("auth");
    expect(names).toContain("repo");
    expect(names.every((n) => !n.endsWith(":"))).toBe(true);
  });

  it("parses CORE COMMANDS from gh fixture with clean names (no trailing colon)", () => {
    const parsed = parseHelp(ghHelp);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("auth");
    expect(names.every((n) => !n.endsWith(":"))).toBe(true);
  });
});

describe("parseHelp — fuzzy option section matching", () => {
  it("matches a section named 'GLOBAL OPTIONS'", () => {
    const input = `
GLOBAL OPTIONS
  --verbose   Enable verbose output
  --debug     Enable debug mode
`.trim();
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(2);
    expect(parsed.options[0].flags).toBe("--verbose");
    expect(parsed.options[1].flags).toBe("--debug");
  });

  it("matches a section named 'OPTION' (singular)", () => {
    const input = `
OPTION
  --quiet   Suppress output
`.trim();
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(1);
    expect(parsed.options[0].flags).toBe("--quiet");
  });

  it("matches a section named 'FLAG' (singular)", () => {
    const input = `
FLAG
  --force   Force the operation
`.trim();
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(1);
    expect(parsed.options[0].flags).toBe("--force");
  });

  it("matches a section named 'FLAGS' (plural)", () => {
    const input = `
FLAGS
  --help      Show help
  --version   Show version
`.trim();
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(2);
    const flags = parsed.options.map((o) => o.flags);
    expect(flags).toContain("--help");
    expect(flags).toContain("--version");
  });

  it("combines options from multiple option-containing sections", () => {
    const input = `
GLOBAL OPTIONS
  --config   Path to config file

LOCAL OPTIONS
  --output   Output file path
`.trim();
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(2);
    const flags = parsed.options.map((o) => o.flags);
    expect(flags).toContain("--config");
    expect(flags).toContain("--output");
  });

  it("does not produce no-options warning when fuzzy section found", () => {
    const input = `
GLOBAL OPTIONS
  --verbose   Enable verbose output
`.trim();
    const parsed = parseHelp(input);
    expect(parsed.warnings).not.toContain("No options detected.");
  });
});

describe("parseHelp — vercel-style grouped commands with indented headers", () => {
  it("extracts commands from the Basic group", () => {
    const parsed = parseHelp(vercelHelp);
    const names = parsed.commands.map((c) => c.name);
    expect(names.some((n) => n.startsWith("deploy"))).toBe(true);
    expect(names.some((n) => n.startsWith("build"))).toBe(true);
    expect(names.some((n) => n.startsWith("dev"))).toBe(true);
  });

  it("extracts commands from the Advanced group", () => {
    const parsed = parseHelp(vercelHelp);
    const names = parsed.commands.map((c) => c.name);
    expect(names.some((n) => n.startsWith("alias"))).toBe(true);
    expect(names.some((n) => n.startsWith("domains"))).toBe(true);
    expect(names.some((n) => n.startsWith("whoami"))).toBe(true);
  });

  it("does not treat Basic or Advanced as command names", () => {
    const parsed = parseHelp(vercelHelp);
    const names = parsed.commands.map((c) => c.name);
    expect(names).not.toContain("Basic");
    expect(names).not.toContain("Advanced");
  });

  it("extracts options from the Global Options section", () => {
    const parsed = parseHelp(vercelHelp);
    expect(parsed.options.length).toBeGreaterThan(0);
    const flags = parsed.options.map((o) => o.flags);
    expect(flags.some((f) => f.includes("--help"))).toBe(true);
    expect(flags.some((f) => f.includes("--version"))).toBe(true);
  });

  it("does not produce no-commands or no-options warnings", () => {
    const parsed = parseHelp(vercelHelp);
    expect(parsed.warnings).not.toContain("No commands detected.");
    expect(parsed.warnings).not.toContain("No options detected.");
  });
});
