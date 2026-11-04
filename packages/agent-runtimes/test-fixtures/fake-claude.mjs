// A fake Claude Code CLI for the runtime tests: it imitates just what the runtimes depend on.
//
//   node fake-claude.mjs [fake flags] <the real CLI arguments...>
//
// Fake flags (they stand where the tests cannot use environment variables, since the runtimes
// start the CLI with a minimal environment): --logged-out, --no-effort, --theme-dialog,
// --trust-dialog, --ignore-first-enter, --never-stop.
//
// What it does:
//  - `auth status` / `--help` answer like the real CLI.
//  - Interactive mode (a PTY): paints a footer ("? for shortcuts" when free, "esc to interrupt"
//    when busy), reads typed/pasted text, calls the hooks of --settings (UserPromptSubmit,
//    Stop) and works on the prompt.
//  - `-p` mode with stream-json: one JSON line in, events out, `result` at the end of each turn.
//  - "Working" on a prompt = running its directive lines (the MCP tools go through the real
//    neurons MCP server named in --mcp-config):
//      !ask <to> <question>   !send <to> <text>   !reply <text>   !finish <text>
//      !peers   !sleep <ms>   !env <to> [NAME...]   !pids <to>   !crash
//    `$last` in a directive stands for the text the previous tool call returned.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
const FAKE_FLAGS = new Set([
  "--logged-out",
  "--no-effort",
  "--theme-dialog",
  "--trust-dialog",
  "--ignore-first-enter",
  "--never-stop",
]);
const fake = new Set(argv.filter((arg) => FAKE_FLAGS.has(arg)));
const args = argv.filter((arg) => !FAKE_FLAGS.has(arg));
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const ESCAPE = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const PASTE_START = `${ESCAPE}[200~`;
const PASTE_END = `${ESCAPE}[201~`;
const ARROW_DOWN = `${ESCAPE}[B`;
const KEY_SEQUENCES = [PASTE_START, PASTE_END, ARROW_DOWN];

/** Answers a one-shot command and exits once stdout is flushed (a pipe may still hold the bytes). */
const answerAndExit = (text, code) =>
  process.stdout.write(text + NEWLINE, () => process.exit(code));

if (args[0] === "auth" && args[1] === "status") {
  answerAndExit(
    JSON.stringify({ loggedIn: !fake.has("--logged-out") }),
    fake.has("--logged-out") ? 1 : 0,
  );
} else if (args.includes("--help")) {
  const help = fake.has("--no-effort")
    ? "Usage: claude [options]"
    : `Usage: claude${NEWLINE}  --effort <level>  Effort level`;
  answerAndExit(help, 0);
} else {
  await main();
}

async function main() {
  // ---- MCP + hooks -----------------------------------------------------------------------
  const mcpConfig = JSON.parse(readFileSync(valueOf("--mcp-config"), "utf8")).mcpServers.neurons;
  const settingsFile = valueOf("--settings");
  const hooks = settingsFile ? JSON.parse(readFileSync(settingsFile, "utf8")).hooks : undefined;

  let mcp;
  let mcpTransport;
  async function tools() {
    if (!mcp) {
      mcpTransport = new StdioClientTransport({
        command: mcpConfig.command,
        args: mcpConfig.args,
        env: mcpConfig.env,
      });
      mcp = new Client({ name: "fake-claude", version: "0.0.0" });
      await mcp.connect(mcpTransport);
    }
    return mcp;
  }

  async function callHook(name) {
    const hook = hooks?.[name]?.[0]?.hooks?.[0];
    if (!hook) return;
    await fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...hook.headers },
      body: JSON.stringify({ hook_event_name: name }),
    }).catch(() => undefined);
  }

  let last = "";
  async function callTool(name, input) {
    const result = await (await tools()).callTool({ name, arguments: input });
    last = result.content.map((part) => part.text).join(NEWLINE);
    return result;
  }

  /** Works on a prompt by running its directive lines. */
  async function work(prompt) {
    const messageId = /\(id: ([^)]+)\)/.exec(prompt)?.[1] ?? "";
    for (const line of prompt.split(NEWLINE).filter((l) => l.startsWith("!"))) {
      const [command, ...words] = line.slice(1).split(" ");
      const text = (from) => words.slice(from).join(" ").replaceAll("$last", last);
      switch (command) {
        case "ask":
          await callTool("ask", { to: words[0], question: text(1) });
          break;
        case "send":
          await callTool("send_message", { to: words[0], text: text(1) });
          break;
        case "reply":
          await callTool("reply", { messageId, text: text(0) });
          break;
        case "finish":
          await callTool("finish", { result: text(0) });
          break;
        case "peers":
          await callTool("list_peers", {});
          break;
        case "tools":
          await callTool("list_tools", {});
          break;
        case "tool":
          await callTool("use_tool", JSON.parse(text(0)));
          break;
        case "sleep":
          await new Promise((resolve) => setTimeout(resolve, Number(words[0])));
          break;
        case "env": {
          const report = {
            names: Object.keys(process.env).sort(),
            values: Object.fromEntries(words.slice(1).map((name) => [name, process.env[name]])),
          };
          await callTool("send_message", { to: words[0], text: JSON.stringify(report) });
          break;
        }
        case "pids": {
          await tools();
          await callTool("send_message", {
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

  if (args.includes("-p")) streamJsonMode(work);
  else interactiveMode(work, callHook);
}

// ---- stream-json mode ----------------------------------------------------------------------

function streamJsonMode(work) {
  const emit = (event) => process.stdout.write(JSON.stringify(event) + NEWLINE);
  let started = false;
  // Like the real CLI, `total_cost_usd` is the cost of the whole session so far.
  let sessionCost = 0;
  let queue = Promise.resolve();
  let buffered = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(NEWLINE);
    buffered = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      queue = queue.then(async () => {
        if (!started) {
          started = true;
          emit({
            type: "system",
            subtype: "init",
            model: "fake-model",
            mcp_servers: [{ name: "neurons", status: "connected" }],
          });
        }
        await work(JSON.parse(line).message.content);
        sessionCost += 0.0123;
        emit({
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 12,
          num_turns: 2,
          total_cost_usd: sessionCost,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 40,
          },
        });
      });
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

// ---- interactive mode (PTY) ----------------------------------------------------------------

function interactiveMode(work, callHook) {
  let typed = "";
  let busy = false;
  let dialog = fake.has("--theme-dialog")
    ? "theme"
    : fake.has("--trust-dialog")
      ? "trust"
      : undefined;
  let ignoreEnter = fake.has("--ignore-first-enter");
  let paste = false;
  let pasteLines = 0;

  // Like the real "trust this folder" dialog: it opens on "No, exit".
  let trustChoice = 0;
  const trustOptions = ["No, exit", "Yes, I trust this folder"];
  const trustBody = () =>
    [
      "Accessing workspace:",
      ...trustOptions.map((option, index) => `${index === trustChoice ? "❯" : " "} ${option}`),
    ].join(NEWLINE);

  const paint = () => {
    const body =
      dialog === "theme"
        ? "Choose the text style that looks best with your terminal"
        : dialog === "trust"
          ? trustBody()
          : `> ${pasteLines > 0 ? `[Pasted text #1 +${pasteLines} lines]` : typed}`;
    const footer = dialog ? "Enter to confirm" : busy ? "esc to interrupt" : "? for shortcuts";
    process.stdout.write(`${ESCAPE}[2J${ESCAPE}[H${body}${NEWLINE}${NEWLINE}${footer}`);
  };

  const submit = async () => {
    const prompt = typed;
    typed = "";
    pasteLines = 0;
    busy = true;
    await callHook("UserPromptSubmit");
    paint();
    try {
      await work(prompt);
    } finally {
      busy = false;
      if (!fake.has("--never-stop")) await callHook("Stop");
      paint();
    }
  };

  process.stdin.setRawMode?.(true);
  process.stdin.setEncoding("utf8");
  // Keystrokes can arrive split anywhere, bracketed-paste markers included.
  let carry = "";
  process.stdin.on("data", (data) => {
    let chunk = carry + data;
    carry = "";
    while (chunk.length > 0) {
      const marker = KEY_SEQUENCES.find((candidate) => chunk.startsWith(candidate));
      if (marker) {
        chunk = chunk.slice(marker.length);
        if (marker === ARROW_DOWN) trustChoice = 1;
        else {
          paste = marker === PASTE_START;
          if (!paste) pasteLines = typed.split(NEWLINE).length;
        }
        continue;
      }
      if (KEY_SEQUENCES.some((candidate) => candidate.startsWith(chunk))) {
        carry = chunk;
        break;
      }
      const char = chunk[0];
      chunk = chunk.slice(1);
      if (char === CARRIAGE_RETURN && !paste) {
        if (dialog === "trust" && trustChoice === 0) process.exit(1); // "No, exit"
        if (dialog) {
          dialog = undefined;
          paint();
          continue;
        }
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
