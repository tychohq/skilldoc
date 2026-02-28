import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHelp } from "../src/parser.js";

const gitHelp = readFileSync(new URL("./fixtures/git-help.txt", import.meta.url), "utf8");
const rgHelp = readFileSync(new URL("./fixtures/rg-help.txt", import.meta.url), "utf8");
const ghHelp = readFileSync(new URL("./fixtures/gh-help.txt", import.meta.url), "utf8");
const vercelHelp = readFileSync(new URL("./fixtures/vercel-help.txt", import.meta.url), "utf8");
const ffmpegHelp = readFileSync(new URL("./fixtures/ffmpeg-help.txt", import.meta.url), "utf8");
const curlHelp = readFileSync(new URL("./fixtures/curl-help.txt", import.meta.url), "utf8");
const gogHelp = readFileSync(new URL("./fixtures/gog-help.txt", import.meta.url), "utf8");

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

describe("parseHelp — ffmpeg-style lowercase usage line", () => {
  it("extracts usage from inline lowercase 'usage:' line", () => {
    const input = `Universal media converter
usage: ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}...`;
    const parsed = parseHelp(input);
    expect(parsed.usageLines.length).toBeGreaterThan(0);
    expect(parsed.usageLines[0]).toBe(
      "ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}..."
    );
  });

  it("extracts usage from ffmpeg fixture", () => {
    const parsed = parseHelp(ffmpegHelp);
    expect(parsed.usageLines.length).toBeGreaterThan(0);
    expect(parsed.usageLines[0]).toContain("ffmpeg");
  });

  it("does not confuse preamble text before usage: line as usage", () => {
    const input = `Universal media converter
usage: ffmpeg [options]...`;
    const parsed = parseHelp(input);
    expect(parsed.usageLines).not.toContain("Universal media converter");
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

describe("parseHelp — curl flat option list (no section headers)", () => {
  it("parses options from a flat list with no section headers", () => {
    const input = `     --verbose                     Make the operation more talkative
     --output <file>               Write to file instead of stdout`;
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(2);
    const flags = parsed.options.map((o) => o.flags);
    expect(flags).toContain("--verbose");
    expect(flags).toContain("--output <file>");
  });

  it("extracts options from curl fixture", () => {
    const parsed = parseHelp(curlHelp);
    expect(parsed.options.length).toBeGreaterThan(0);
    const flags = parsed.options.map((o) => o.flags);
    expect(flags.some((f) => f.includes("--verbose"))).toBe(true);
    expect(flags.some((f) => f.includes("--output"))).toBe(true);
  });

  it("does not produce no-options warning for curl fixture", () => {
    const parsed = parseHelp(curlHelp);
    expect(parsed.warnings).not.toContain("No options detected.");
  });
});

describe("parseHelp — tab-separated command entries (remindctl style)", () => {
  const input = `remindctl 0.1.1
Manage Apple Reminders from the terminal

Usage:
  remindctl [command] [options]

Commands:
  show\tShow reminders
  list\tList reminder lists or show list contents
  add\tAdd a reminder
  complete\tMark reminders complete
  delete\tDelete reminders

Run 'remindctl <command> --help' for details.`;

  it("extracts commands separated by a single tab", () => {
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("show");
    expect(names).toContain("list");
    expect(names).toContain("add");
    expect(names).toContain("complete");
    expect(names).toContain("delete");
  });

  it("captures summaries for tab-separated commands", () => {
    const parsed = parseHelp(input);
    const show = parsed.commands.find((c) => c.name === "show");
    expect(show?.summary).toBe("Show reminders");
  });

  it("does not produce no-commands warning", () => {
    const parsed = parseHelp(input);
    expect(parsed.warnings).not.toContain("No commands detected.");
  });
});

describe("parseHelp — 2-line command format (gog style)", () => {
  const input = `Usage: mytool <command> [flags]

Commands:
  send [flags]
    Send a message

  drive (drv) <command> [flags]
    Google Drive

  version [flags]
    Print version

Flags:
  --help   Show help
`;

  it("parses commands from 2-line signature+description format", () => {
    const parsed = parseHelp(input);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("send");
    expect(names).toContain("drive");
    expect(names).toContain("version");
  });

  it("uses the description line as the summary", () => {
    const parsed = parseHelp(input);
    const drive = parsed.commands.find((c) => c.name === "drive");
    expect(drive?.summary).toBe("Google Drive");
    const send = parsed.commands.find((c) => c.name === "send");
    expect(send?.summary).toBe("Send a message");
  });

  it("sets hasSubcommands for commands with <command> in signature", () => {
    const parsed = parseHelp(input);
    const drive = parsed.commands.find((c) => c.name === "drive");
    expect(drive?.hasSubcommands).toBe(true);
    const send = parsed.commands.find((c) => c.name === "send");
    expect(send?.hasSubcommands).toBeUndefined();
  });

  it("extracts command name as first word, ignoring aliases and arg specs", () => {
    const parsed = parseHelp(input);
    // "drive (drv) <command> [flags]" → name should be "drive", not "drive (drv) <command> [flags]"
    const names = parsed.commands.map((c) => c.name);
    expect(names.every((n) => !n.includes(" "))).toBe(true);
  });

  it("does not produce no-commands warning", () => {
    const parsed = parseHelp(input);
    expect(parsed.warnings).not.toContain("No commands detected.");
  });
});

describe("parseHelp — gog fixture", () => {
  it("parses top-level commands from gog --help", () => {
    const parsed = parseHelp(gogHelp);
    const names = parsed.commands.map((c) => c.name);
    expect(names).toContain("gmail");
    expect(names).toContain("drive");
    expect(names).toContain("calendar");
  });

  it("marks service commands with subcommands via hasSubcommands", () => {
    const parsed = parseHelp(gogHelp);
    const gmail = parsed.commands.find((c) => c.name === "gmail");
    expect(gmail?.hasSubcommands).toBe(true);
    const drive = parsed.commands.find((c) => c.name === "drive");
    expect(drive?.hasSubcommands).toBe(true);
  });

  it("does not produce no-commands warning", () => {
    const parsed = parseHelp(gogHelp);
    expect(parsed.warnings).not.toContain("No commands detected.");
  });
});
