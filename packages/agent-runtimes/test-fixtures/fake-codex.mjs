// A fake Codex CLI for the runtime tests: it imitates just what the runtimes depend on, as the
// OpenAI documentation describes it (a real `codex` was never run for these tests).
//
//   node fake-codex.mjs [fake flags] <the real CLI arguments...>
//
// Fake flags: --logged-out, --api-login, --trust-dialog, --login-screen, --never-notify,
// --ignore-first-enter, --fail-turn, --no-complete.
//
// What it does:
//  - `login status` answers like the CLI (exit 0 when logged in).
//  - `exec --json [resume <thread>] -`: reads the prompt from stdin, prints JSONL events
//    (thread.started, turn.started, item.*, turn.completed) and exits.
//  - Interactive mode (a PTY): paints a status line ("esc to interrupt" while busy), reads typed or
//    pasted text, works on the prompt and runs the `notify` program of `-c notify=[...]` at the end.
//  - "Working" on a prompt = running its directive lines (the MCP tools go through the real neurons
//    MCP server named in the `-c mcp_servers.neurons.*` entries):
//      !ask <to> <question>   !send <to> <text>   !reply <text>   !finish <text>   !text <words>
//      !peers   !sleep <ms>   !env <to> [NAME...]   !pids <to>   !args <to>   !shell   !crash
//    `$last` in a directive stands for the text the previous tool call returned.
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
const FAKE_FLAGS = new Set([
  "--logged-out",
  "--api-login",
  "--trust-dialog",
  "--login-screen",
  "--never-notify",
  "--ignore-first-enter",
  "--fail-turn",
  "--no-complete",
]);
const fake = new Set(argv.filter((arg) => FAKE_FLAGS.has(arg)));
const args = argv.filter((arg) => !FAKE_FLAGS.has(arg));

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const ESCAPE = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const PASTE_START = `${ESCAPE}[200~`;
const PASTE_END = `${ESCAPE}[201~`;
const KEY_SEQUENCES = [PASTE_START, PASTE_END];

const emit = (event) => process.stdout.write(JSON.stringify(event) + NEWLINE);
const answerAndExit = (text, code) =>
  process.stdout.write(text + NEWLINE, () => process.exit(code));

// ---- the `-c key=value` entries ---------------------------------------------------------------

const config = new Map();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-c") {
    const entry = args[i + 1] ?? "";
    config.set(entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1));
  }
}

/** The value of a `-c` entry: TOML strings and arrays are JSON; an inline table is read by hand. */
function configValue(key) {
  const raw = config.get(key);
  if (raw === undefined) return undefined;
  if (raw.startsWith("{")) {
    const table = {};
    for (const match of raw.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)) {
      table[JSON.parse(`"${match[1]}"`)] = JSON.parse(`"${match[2]}"`);
    }
    return table;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

if (args[0] === "login" && args[1] === "status") {
  if (fake.has("--logged-out")) answerAndExit("Not logged in", 1);
  else
    answerAndExit(
      fake.has("--api-login") ? "Logged in using an API key - sk-***" : "Logged in using ChatGPT",
      0,
    );
} else {
  await main();
}

async function main() {
  const mcpCommand = configValue("mcp_servers.neurons.command");
  let mcp;
  let mcpTransport;
  async function tools() {
    if (!mcp) {
      const forwarded = Object.fromEntries(
        (configValue("mcp_servers.neurons.env_vars") ?? []).map((name) => [
          name,
          process.env[name] ?? "",
        ]),
      );
      mcpTransport = new StdioClientTransport({
        command: mcpCommand,
        args: configValue("mcp_servers.neurons.args"),
        env: { ...configValue("mcp_servers.neurons.env"), ...forwarded },
      });
      mcp = new Client({ name: "fake-codex", version: "0.0.0" });
      await mcp.connect(mcpTransport);
    }
    return mcp;
  }

  let last = "";
  async function callTool(name, input) {
    const result = await (await tools()).callTool({ name, arguments: input });
    last = result.content.map((part) => part.text).join(NEWLINE);
    return result;
  }

  let itemCounter = 0;
  /** Works on a prompt by running its directive lines. */
  async function work(prompt, onItem) {
    const messageId = /\(id: ([^)]+)\)/.exec(prompt)?.[1] ?? "";
    for (const line of prompt.split(NEWLINE).filter((l) => l.startsWith("!"))) {
      const [command, ...words] = line.slice(1).split(" ");
      const text = (from) => words.slice(from).join(" ").replaceAll("$last", last);
      const id = `item_${++itemCounter}`;
      const mcpCall = async (tool, input) => {
        onItem?.("item.started", {
          id,
          type: "mcp_tool_call",
          server: "neurons",
          tool,
          arguments: input,
          status: "in_progress",
        });
        await callTool(tool, input);
        onItem?.("item.completed", {
          id,
          type: "mcp_tool_call",
          server: "neurons",
          tool,
          arguments: input,
          status: "completed",
        });
      };
      switch (command) {
        case "ask":
          await mcpCall("ask", { to: words[0], question: text(1) });
          break;
        case "text":
          onItem?.("item.completed", { id, type: "agent_message", text: text(0) });
          break;
        case "send":
          await mcpCall("send_message", { to: words[0], text: text(1) });
          break;
        case "reply":
          await mcpCall("reply", { messageId, text: text(0) });
          break;
        case "finish":
          await mcpCall("finish", { result: text(0) });
          break;
        case "peers":
          await mcpCall("list_peers", {});
          break;
        case "shell":
          onItem?.("item.started", {
            id,
            type: "command_execution",
            command: "ls",
            status: "in_progress",
          });
          onItem?.("item.completed", {
            id,
            type: "command_execution",
            command: "ls",
            exit_code: 0,
            status: "completed",
          });
          break;
        case "sleep":
          await new Promise((resolve) => setTimeout(resolve, Number(words[0])));
          break;
        case "env": {
          const report = {
            names: Object.keys(process.env).sort(),
            values: Object.fromEntries(words.slice(1).map((name) => [name, process.env[name]])),
          };
          await mcpCall("send_message", { to: words[0], text: JSON.stringify(report) });
          break;
        }
        case "args":
          await mcpCall("send_message", { to: words[0], text: JSON.stringify(argv) });
          break;
        case "pids": {
          await tools();
          await mcpCall("send_message", {
            to: words[0],
            text: JSON.stringify({ cli: process.pid, mcp: mcpTransport.pid }),
          });
          break;
        }
        case "crash":
          process.exit(3);
      }
    }
  }

  if (args[0] === "exec") await execMode(work);
  else interactiveMode(work);
}

// ---- exec mode ---------------------------------------------------------------------------------

async function execMode(work) {
  let prompt = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) prompt += chunk;

  const resumeAt = args.indexOf("resume");
  const threadId = resumeAt >= 0 ? args[resumeAt + 1] : "thread-fake-1";
  emit({ type: "thread.started", thread_id: threadId });
  emit({ type: "turn.started" });
  emit({ type: "error", message: "Reconnecting... 1/5" });
  await work(prompt, (type, item) => emit({ type, item }));
  if (fake.has("--fail-turn")) {
    emit({ type: "turn.failed", error: { message: "You've hit your usage limit." } });
    process.exit(1);
  }
  if (fake.has("--no-complete")) process.exit(0);
  emit({
    type: "turn.completed",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 40,
      output_tokens: 20,
      reasoning_output_tokens: 5,
    },
  });
  process.exit(0);
}

// ---- interactive mode (PTY) --------------------------------------------------------------------

function interactiveMode(work) {
  let typed = "";
  let busy = false;
  let dialog = fake.has("--login-screen")
    ? "login"
    : fake.has("--trust-dialog")
      ? "trust"
      : undefined;
  let ignoreEnter = fake.has("--ignore-first-enter");
  let paste = false;
  let pasteChars = 0;

  const paint = () => {
    const body =
      dialog === "login"
        ? "Welcome to Codex. Sign in with ChatGPT to continue"
        : dialog === "trust"
          ? "Do you trust the contents of this directory?" +
            NEWLINE +
            "› 1. Yes, continue" +
            NEWLINE +
            "  2. No, quit"
          : `› ${pasteChars > 0 ? `[Pasted Content ${pasteChars} chars]` : typed}`;
    const status = dialog
      ? ""
      : busy
        ? "Working (1s • esc to interrupt)"
        : "  100% context left · ? for shortcuts";
    process.stdout.write(`${ESCAPE}[2J${ESCAPE}[H${body}${NEWLINE}${NEWLINE}${status}`);
  };

  /** What the CLI does at the end of a turn: runs the `notify` program with the JSON payload. */
  const notify = () =>
    new Promise((resolve) => {
      const program = configValue("notify");
      if (!program || fake.has("--never-notify")) return resolve();
      const child = spawn(
        program[0],
        [...program.slice(1), JSON.stringify({ type: "agent-turn-complete" })],
        {
          stdio: "ignore",
        },
      );
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });

  const submit = async () => {
    const prompt = typed;
    typed = "";
    pasteChars = 0;
    busy = true;
    paint();
    try {
      await work(prompt);
    } finally {
      busy = false;
      paint();
      await notify();
    }
  };

  process.stdin.setRawMode?.(true);
  process.stdin.setEncoding("utf8");
  let carry = "";
  process.stdin.on("data", (data) => {
    let chunk = carry + data;
    carry = "";
    while (chunk.length > 0) {
      const marker = KEY_SEQUENCES.find((candidate) => chunk.startsWith(candidate));
      if (marker) {
        chunk = chunk.slice(marker.length);
        paste = marker === PASTE_START;
        if (!paste) pasteChars = typed.length;
        continue;
      }
      if (KEY_SEQUENCES.some((candidate) => candidate.startsWith(chunk))) {
        carry = chunk;
        break;
      }
      const char = chunk[0];
      chunk = chunk.slice(1);
      if (dialog === "trust" && char === "1") {
        dialog = undefined;
      } else if (char === CARRIAGE_RETURN && !paste) {
        if (dialog) continue;
        if (ignoreEnter) {
          ignoreEnter = false;
          continue;
        }
        if (!busy && typed) void submit();
      } else if (char === CTRL_C) {
        process.exit(130);
      } else if (!dialog && !busy) {
        typed += char === CARRIAGE_RETURN ? NEWLINE : char;
      }
    }
    paint();
  });
  paint();
}
