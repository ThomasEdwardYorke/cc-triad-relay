#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

const SHELL_WORD = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;&|]+)`;
const GIT_GLOBAL_OPTION = String.raw`(?:(?:-C|-c|--git-dir|--work-tree|--namespace|--config-env|--exec-path)(?:=${SHELL_WORD}|\s+${SHELL_WORD})|--[A-Za-z0-9-]+(?:=${SHELL_WORD})?|-[A-Za-z]+)`;
const GIT_PREFIX = String.raw`\bgit(?:\.exe)?(?:\s+${GIT_GLOBAL_OPTION})*\s+`;

const DESTRUCTIVE_COMMANDS = [
  {
    label: "destructive git reset",
    pattern: new RegExp(`${GIT_PREFIX}reset\\b[^\\n;&|]*--hard\\b`),
  },
  {
    label: "destructive git restore",
    pattern: new RegExp(`${GIT_PREFIX}restore\\b`),
  },
  {
    label: "destructive git switch",
    pattern: new RegExp(
      `${GIT_PREFIX}switch\\b[^\\n;&|]*(?:--discard-changes|--force|\\s-[A-Za-z]*f[A-Za-z]*(?:\\s|$))`,
    ),
  },
  {
    label: "destructive rm -rf",
    pattern: /\brm\b(?=[^\n;&|]*(?:-[A-Za-z]*[rR]|--recursive))(?=[^\n;&|]*(?:-[A-Za-z]*f|--force))[^\n;&|]*/,
  },
  {
    label: "force push",
    pattern: new RegExp(
      `${GIT_PREFIX}push\\b[^\\n;&|]*(?:--force|\\s-[A-Za-z]*f[A-Za-z]*(?:\\s|$)|\\s\\+\\S+|\\s\\S+:\\+\\S+)`,
    ),
  },
  {
    label: "piped remote shell",
    pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sudo(?:\s+(?:-[A-Za-z]+|--[A-Za-z-]+))*\s+)?(?:(?:\/usr\/bin\/env|env)\s+|\/(?:usr\/)?bin\/)?(?:sh|bash|zsh)\b/,
  },
];

const SECRET_PATTERNS = [
  {
    label: "OpenAI-style secret",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  },
];

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      resolve(input);
    });
  });
}

function parsePayload(raw) {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return null;
  }
}

function stringifyValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeCommandText(text) {
  return text.replace(/\\/g, "/");
}

function canonicalExistingPath(path) {
  try {
    return normalizeCommandText(realpathSync(path));
  } catch {
    return normalizeCommandText(path);
  }
}

function rootPath(cwd = process.cwd()) {
  try {
    return canonicalExistingPath(
      execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    ).replace(/\/+$/, "");
  } catch {
    return canonicalExistingPath(cwd).replace(/\/+$/, "");
  }
}

function toolText(payload) {
  const input = payload.tool_input ?? payload.toolInput ?? {};
  if (input && typeof input === "object" && typeof input.command === "string") {
    return input.command;
  }
  if (input && typeof input === "object" && typeof input.cmd === "string") {
    return input.cmd;
  }
  return stringifyValue(input);
}

function isShellExecution(payload) {
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const toolName = stringifyValue(payload.tool_name ?? payload.toolName ?? "");
  if (toolName.length === 0) {
    return Boolean(
      input &&
        typeof input === "object" &&
        (typeof input.command === "string" || typeof input.cmd === "string"),
    );
  }
  return /^(?:Bash|Shell|(?:functions\.)?(?:exec_command|shell_command))$/i.test(
    toolName,
  );
}

function isGitToken(token) {
  const executable = executableName(token);
  return executable === "git" || executable === "git.exe";
}

function isGhToken(token) {
  const executable = executableName(token);
  return executable === "gh" || executable === "gh.exe";
}

function executableName(token) {
  return normalizeCommandText(token).split("/").pop()?.toLowerCase() ?? "";
}

function promptText(payload) {
  if (typeof payload.prompt === "string") {
    return payload.prompt;
  }
  return stringifyValue(payload.prompt ?? "");
}

function lastAssistantMessage(payload) {
  if (typeof payload.last_assistant_message === "string") {
    return payload.last_assistant_message;
  }

  const transcript = Array.isArray(payload.transcript) ? payload.transcript : [];
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (!entry || typeof entry !== "object" || entry.role !== "assistant") {
      continue;
    }
    return stringifyValue(entry.content);
  }

  return "";
}

function cwdFromPayload(payload) {
  return typeof payload.cwd === "string" && payload.cwd.length > 0
    ? payload.cwd
    : process.cwd();
}

function detectUnsafeToolUse(text, cwd = process.cwd()) {
  const normalizedText = normalizeCommandText(text);
  if (detectDestructiveCheckout(normalizedText, cwd)) {
    return "Blocked destructive checkout of tracked files. Use an explicit, reviewed recovery path instead.";
  }
  if (detectDestructiveGitClean(normalizedText, cwd)) {
    return "Blocked destructive git clean. Use an explicit, reviewed recovery path instead.";
  }
  const destructiveGitLabel = detectDestructiveGitCommand(normalizedText, cwd);
  if (destructiveGitLabel) {
    return `Blocked ${destructiveGitLabel}. Use an explicit, reviewed recovery path instead.`;
  }
  for (const check of DESTRUCTIVE_COMMANDS) {
    if (check.pattern.test(normalizedText)) {
      return `Blocked ${check.label}. Use an explicit, reviewed recovery path instead.`;
    }
  }

  if (isBroadPublicationCommand(normalizedText)) {
    return "Blocked broad publication command. Stage explicit public paths and keep local-only state out of shipped commits and archives.";
  }

  const localOnlyTextInputHit = findLocalOnlyTextInputHitByInvocation(
    normalizedText,
    cwd,
  );
  if (localOnlyTextInputHit) {
    return `Blocked local-only state publication: ${localOnlyTextInputHit.label} must remain outside shipped commit messages and PR bodies.`;
  }

  const localOnlyHit = findLocalOnlyPublicationHitByInvocation(
    normalizedText,
    cwd,
  );
  if (localOnlyHit) {
    return `Blocked local-only state publication: ${localOnlyHit.label} must remain outside shipped commits and PRs.`;
  }

  const indexedLocalOnlyHit = findIndexedLocalOnlyHitByInvocation(
    normalizedText,
    cwd,
  );
  if (indexedLocalOnlyHit) {
    return `Blocked local-only state publication: ${indexedLocalOnlyHit.label} is staged or tracked and must not be committed, pushed, archived, or published in a PR.`;
  }

  return "";
}

function gitEffectiveCwd(text, cwd) {
  let lastCwd = cwd;

  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, cwd)) {
    lastCwd = effectiveCwd;
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (invocation && /^(?:add|archive|commit|push)$/.test(invocation.command)) {
        return invocation.cwd;
      }
    }
  }

  return lastCwd;
}

function shellSegments(text) {
  const segments = [];
  let current = "";
  let quote = "";
  let escaping = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      current += char;
      escaping = true;
      continue;
    }
    if (quote.length > 0) {
      current += char;
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (/[;&|\n]/.test(char)) {
      if (current.trim().length > 0) {
        segments.push(current.trim());
      }
      current = "";
      while (index + 1 < text.length && /[;&|]/.test(text[index + 1])) {
        index += 1;
      }
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) {
    segments.push(current.trim());
  }
  return segments;
}

function* shellSegmentsWithCwd(text, cwd) {
  let effectiveCwd = cwd;
  let subshellCwd = "";

  for (const segment of shellSegments(text)) {
    const words = shellWords(segment);
    if (words.length === 0) {
      continue;
    }

    const opensSubshell = segment.trimStart().startsWith("(");
    const closesSubshell = segment.trimEnd().endsWith(")");
    const activeCwd = subshellCwd || effectiveCwd;

    if (words[0] === "cd") {
      const dir = cdTarget(words);
      if (dir) {
        if (opensSubshell) {
          subshellCwd = resolveShellPath(activeCwd, dir);
        } else {
          effectiveCwd = resolveShellPath(activeCwd, dir);
        }
      }
      if (closesSubshell) {
        subshellCwd = "";
      }
      continue;
    }

    yield { segment, words, cwd: activeCwd };

    if (closesSubshell) {
      subshellCwd = "";
    }
  }
}

function cdTarget(words) {
  if (!words[1] || words[1].startsWith("-")) {
    return "";
  }
  return words[1];
}

function detectDestructiveCheckout(text, cwd) {
  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, cwd)) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (invocation?.command !== "checkout") {
        continue;
      }
      if (isDestructiveCheckoutArgs(invocation.args, invocation.cwd)) {
        return true;
      }
    }
  }
  return false;
}

function detectDestructiveGitClean(text, cwd) {
  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, cwd)) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (invocation?.command !== "clean") {
        continue;
      }
      if (isDestructiveGitCleanArgs(invocation.args)) {
        return true;
      }
    }
  }
  return false;
}

function detectDestructiveGitCommand(text, cwd) {
  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, cwd)) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (!invocation) {
        continue;
      }
      if (
        invocation.command === "reset" &&
        invocation.args.includes("--hard")
      ) {
        return "destructive git reset";
      }
      if (invocation.command === "restore") {
        return "destructive git restore";
      }
      if (
        invocation.command === "switch" &&
        invocation.args.some(isDestructiveSwitchArg)
      ) {
        return "destructive git switch";
      }
      if (
        invocation.command === "push" &&
        invocation.args.some(isForcePushArg)
      ) {
        return "force push";
      }
    }
  }
  return "";
}

function isDestructiveSwitchArg(arg) {
  return (
    arg === "--discard-changes" ||
    arg === "--force" ||
    /^-[A-Za-z]*f[A-Za-z]*$/.test(arg)
  );
}

function isForcePushArg(arg) {
  return (
    arg === "--force" ||
    arg === "--force-with-lease" ||
    arg.startsWith("--force-with-lease=") ||
    /^-[A-Za-z]*f[A-Za-z]*$/.test(arg) ||
    arg.startsWith("+") ||
    /\S:\+\S/.test(arg)
  );
}

function isDestructiveGitCleanArgs(args) {
  let force = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg.startsWith("--")) {
      continue;
    }
    for (const flag of arg.slice(1)) {
      if (flag === "f") {
        force = true;
      }
      if (flag === "n") {
        dryRun = true;
      }
    }
  }

  return force && !dryRun;
}

function parseGitInvocation(words, gitIndex, cwd) {
  let gitCwd = cwd;
  for (let index = gitIndex + 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === "-C") {
      const dir = words[index + 1];
      if (dir) {
        gitCwd = resolveShellPath(gitCwd, dir);
        index += 1;
      }
      continue;
    }
    if (word.startsWith("-C=")) {
      gitCwd = resolveShellPath(gitCwd, word.slice(3));
      continue;
    }
    if (
      ["-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path"].includes(
        word,
      )
    ) {
      index += 1;
      continue;
    }
    if (word.startsWith("--") && word.includes("=")) {
      continue;
    }
    if (word.startsWith("-")) {
      continue;
    }
    return {
      command: word,
      args: words.slice(index + 1),
      cwd: gitCwd,
    };
  }
  return undefined;
}

function resolveShellPath(base, path) {
  return resolve(base, expandKnownPathVariables(path, base));
}

function isDestructiveCheckoutArgs(args, cwd) {
  if (args.some((arg) => /^-[A-Za-z]*f[A-Za-z]*$/.test(arg) || arg === "--force")) {
    return true;
  }
  if (
    args.some((arg) =>
      ["-b", "-B", "--orphan", "--detach"].includes(arg),
    )
  ) {
    return false;
  }

  const pathSeparatorIndex = args.indexOf("--");
  if (pathSeparatorIndex >= 0) {
    return args.slice(pathSeparatorIndex + 1).some((arg) => !arg.startsWith("-"));
  }

  return args
    .filter((arg) => !arg.startsWith("-"))
    .some((arg) => isExistingCheckoutPathspec(arg, cwd));
}

function isExistingCheckoutPathspec(token, cwd) {
  const normalized = normalizeCommandText(token);
  if (
    normalized === "." ||
    normalized === "./" ||
    normalized.startsWith("./") ||
    normalized.startsWith(":/")
  ) {
    return true;
  }

  const pathspec = normalizeGitPathspecToken(normalized);
  const root = rootPath(cwd);
  const candidate = pathspec.rootRelative
    ? resolve(root, pathspec.path)
    : isAbsolute(pathspec.path)
      ? pathspec.path
      : resolve(cwd, pathspec.path);
  return existsSync(candidate) || isTrackedCheckoutPathspec(token, cwd, root);
}

function isTrackedCheckoutPathspec(token, cwd, root) {
  if (gitPathspecExists(cwd, token)) {
    return true;
  }

  const relativePath = relativePathForToken(token, cwd, root);
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    return false;
  }
  return gitPathspecExists(root, relativePath);
}

function gitPathspecExists(root, relativePath) {
  try {
    execFileSync("git", [
      "-C",
      root,
      "ls-files",
      "--error-unmatch",
      "--",
      relativePath,
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function isPathPublishingCommand(text) {
  return (
    new RegExp(`${GIT_PREFIX}(?:add|archive)\\b`).test(text) ||
    /\b(?:tar|zip)\b/.test(text)
  );
}

function findLocalOnlyPublicationHitByInvocation(text, cwd) {
  for (const { segment, words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, cwd)) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (!invocation || !/^(?:add|archive)$/.test(invocation.command)) {
        continue;
      }
      if (invocation.command === "add") {
        const addHit = findGitAddLocalOnlyPublicationHit(
          invocation.args,
          invocation.cwd,
        );
        if (addHit) {
          return addHit;
        }
      }
      const hit = findLocalOnlyPublicationHit(segment, invocation.cwd);
      if (hit) {
        return hit;
      }
    }

    if (/\b(?:tar|zip)\b/.test(segment)) {
      const hit = findLocalOnlyPublicationHit(segment, effectiveCwd);
      if (hit) {
        return hit;
      }
    }
  }

  return undefined;
}

function findGitAddLocalOnlyPublicationHit(args, cwd) {
  if (hasGitAddPathspecFileArg(args)) {
    return {
      label: "pathspec-from-file input",
    };
  }
  if (!args.some(isForceAddArg)) {
    return undefined;
  }
  const root = rootPath(cwd);
  for (const arg of args) {
    const relativePath = relativePathForToken(arg, cwd, root);
    if (isLocalOnlyParentPath(relativePath)) {
      return {
        label: "docs/maintainer/handoff/",
      };
    }
  }
  return undefined;
}

function hasGitAddPathspecFileArg(args) {
  return args.some(
    (token) =>
      token === "--pathspec-from-file" ||
      token.startsWith("--pathspec-from-file=") ||
      token === "--pathspec-file-nul",
  );
}

function isForceAddArg(arg) {
  return arg === "--force" || /^-[A-Za-z]*f[A-Za-z]*$/.test(arg);
}

function isIndexPublishingCommand(text) {
  return (
    new RegExp(`${GIT_PREFIX}(?:commit|push|archive)\\b`).test(text) ||
    shellSegments(text).some((segment) =>
      isGhPrPublicationWords(shellWords(segment)),
    )
  );
}

function findIndexedLocalOnlyHitByInvocation(text, cwd) {
  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, cwd)) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (!invocation || !/^(?:commit|push|archive)$/.test(invocation.command)) {
        continue;
      }
      const hit = findIndexedLocalOnlyHit(invocation.cwd, {
        allowStagedRemovalCleanup: invocation.command === "commit",
        checkHistory: invocation.command === "push",
      });
      if (hit) {
        return hit;
      }
    }

    if (isGhPrPublicationWords(words)) {
      const hit = findIndexedLocalOnlyHit(effectiveCwd, {
        checkHistory: true,
        ignoreUpstream: true,
        publicationBase: ghPrPublicationBase(words, effectiveCwd),
      });
      if (hit) {
        return hit;
      }
    }
  }

  return undefined;
}

function findLocalOnlyTextInputHitByInvocation(text, cwd) {
  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, cwd)) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (!invocation || invocation.command !== "commit") {
        continue;
      }
      const hit = findLocalOnlyOptionFileHit(invocation.args, invocation.cwd, [
        "-F",
        "--file",
        "-t",
        "--template",
      ]);
      if (hit) {
        return hit;
      }
    }

    const ghHit = findGhPrTextInputHit(words, effectiveCwd);
    if (ghHit) {
      return ghHit;
    }
  }

  return undefined;
}

function findGhPrTextInputHit(words, cwd) {
  for (let index = 0; index < words.length; index += 1) {
    if (!isGhToken(words[index])) {
      continue;
    }
    let cursor = index + 1;
    while (cursor < words.length) {
      const word = words[cursor];
      if (["-R", "--repo", "--hostname"].includes(word)) {
        cursor += 2;
        continue;
      }
      if (
        word.startsWith("--repo=") ||
        word.startsWith("--hostname=") ||
        word === "--"
      ) {
        cursor += 1;
        continue;
      }
      if (word.startsWith("-")) {
        cursor += 1;
        continue;
      }
      break;
    }
    if (
      words[cursor] !== "pr" ||
      !/^(?:create|edit)$/.test(words[cursor + 1] ?? "")
    ) {
      continue;
    }

    const options = words[cursor + 1] === "create"
      ? ["-F", "--body-file", "-T", "--template"]
      : ["-F", "--body-file"];
    const hit = findLocalOnlyOptionFileHit(words.slice(cursor + 2), cwd, options);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

function findLocalOnlyOptionFileHit(args, cwd, options) {
  const root = rootPath(cwd);
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    let value = "";
    for (const option of options) {
      if (word === option) {
        value = args[index + 1] ?? "";
        index += 1;
        break;
      }
      if (word.startsWith(`${option}=`)) {
        value = word.slice(option.length + 1);
        break;
      }
      if (
        option.startsWith("-") &&
        !option.startsWith("--") &&
        word.startsWith(option) &&
        word.length > option.length
      ) {
        value = word.slice(option.length).replace(/^=/, "");
        break;
      }
    }
    if (!value || value === "-") {
      continue;
    }
    const label = localOnlyLabelForToken(value, cwd, root);
    if (label) {
      return { label };
    }
  }
  return undefined;
}

function isGhPrPublicationWords(words) {
  for (let index = 0; index < words.length; index += 1) {
    if (!isGhToken(words[index])) {
      continue;
    }
    let cursor = index + 1;
    while (cursor < words.length) {
      const word = words[cursor];
      if (["-R", "--repo", "--hostname"].includes(word)) {
        cursor += 2;
        continue;
      }
      if (
        word.startsWith("--repo=") ||
        word.startsWith("--hostname=") ||
        word === "--"
      ) {
        cursor += 1;
        continue;
      }
      if (word.startsWith("-")) {
        cursor += 1;
        continue;
      }
      break;
    }
    if (
      words[cursor] === "pr" &&
      /^(?:create|edit)$/.test(words[cursor + 1] ?? "")
    ) {
      return true;
    }
  }
  return false;
}

function ghPrPublicationBase(words, cwd) {
  for (let index = 0; index < words.length; index += 1) {
    if (!isGhToken(words[index])) {
      continue;
    }
    let cursor = index + 1;
    while (cursor < words.length) {
      const word = words[cursor];
      if (["-R", "--repo", "--hostname"].includes(word)) {
        cursor += 2;
        continue;
      }
      if (
        word.startsWith("--repo=") ||
        word.startsWith("--hostname=") ||
        word === "--"
      ) {
        cursor += 1;
        continue;
      }
      if (word.startsWith("-")) {
        cursor += 1;
        continue;
      }
      break;
    }
    if (
      words[cursor] === "pr" &&
      /^(?:create|edit)$/.test(words[cursor + 1] ?? "")
    ) {
      const command = words[cursor + 1] ?? "";
      const explicitBase = explicitGhBaseArg(words.slice(cursor + 2));
      if (explicitBase) {
        return explicitBase;
      }
      return command === "create" ? configuredGhMergeBase(cwd) : "";
    }
  }
  return "";
}

function explicitGhBaseArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base" || arg === "-B") {
      const value = args[index + 1] ?? "";
      return value.startsWith("-") ? "" : value;
    }
    if (arg.startsWith("--base=")) {
      return arg.slice("--base=".length);
    }
    if (arg.startsWith("-B=")) {
      return arg.slice("-B=".length);
    }
    if (/^-B\S+/.test(arg)) {
      return arg.slice(2);
    }
  }
  return "";
}

function configuredGhMergeBase(cwd) {
  const root = rootPath(cwd);
  const branch = gitFirstLine(root, ["branch", "--show-current"]);
  if (!branch) {
    return "";
  }
  return gitFirstLine(root, [
    "config",
    "--get",
    `branch.${branch}.gh-merge-base`,
  ]);
}

function isBroadPublicationCommand(text) {
  return (
    hasBroadGitAddInvocation(text) ||
    hasGitAddWholeTreePathspec(text) ||
    new RegExp(
      `${GIT_PREFIX}add(?:\\s+(?:-[A-Za-z]*[Au][A-Za-z]*|--all|--update|--force|-f))*\\s*(?:$|[\\n;&|])`,
    ).test(
      text,
    ) ||
    /\b(?:tar|zip)\b[\s\S]+(?:\s|^)\.(?:\/)?(?:\s|$)/.test(text)
  );
}

function hasBroadGitAddInvocation(text) {
  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, process.cwd())) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (invocation?.command !== "add") {
        continue;
      }
      if (isNonMutatingGitAddArgs(invocation.args)) {
        continue;
      }
      if (!hasExplicitGitAddPath(invocation.args)) {
        return true;
      }
    }
  }
  return false;
}

function hasExplicitGitAddPath(args) {
  let pathspecMode = false;
  for (const arg of args) {
    if (pathspecMode) {
      return true;
    }
    if (arg === "--") {
      pathspecMode = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      return true;
    }
  }
  return false;
}

function isNonMutatingGitAddArgs(args) {
  return args.some((arg) => {
    if (arg === "--help" || arg === "--dry-run") {
      return true;
    }
    if (arg.startsWith("--")) {
      return false;
    }
    return arg.startsWith("-") && /[hn]/.test(arg.slice(1));
  });
}

function hasGitAddWholeTreePathspec(text) {
  for (const { words, cwd: effectiveCwd } of shellSegmentsWithCwd(text, process.cwd())) {
    for (let index = 0; index < words.length; index += 1) {
      if (!isGitToken(words[index])) {
        continue;
      }
      const invocation = parseGitInvocation(words, index, effectiveCwd);
      if (invocation?.command !== "add") {
        continue;
      }
      if (invocation.args.some(isWholeTreePathspec)) {
        return true;
      }
    }
  }
  return false;
}

function isWholeTreePathspec(arg) {
  const normalized = normalizeCommandText(arg);
  return (
    normalized === "." ||
    normalized === "./" ||
    normalized === ":" ||
    normalized === ":/" ||
    normalized === ":/*" ||
    normalized === ":(top)" ||
    normalized === ":(top)/" ||
    normalized === ":(top)/*"
  );
}

function findLocalOnlyPublicationHit(text, cwd) {
  const root = rootPath(cwd);
  if (usesGitAddPathspecFile(text)) {
    return {
      label: "pathspec-from-file input",
    };
  }

  for (const token of shellWords(text)) {
    const label = localOnlyLabelForToken(token, cwd, root);
    if (label) {
      return { label };
    }
  }

  if (isForcedMaintainerParentAdd(text, cwd, root)) {
    return {
      label: "docs/maintainer/handoff/",
    };
  }

  if (isArchiveShellCommand(text) && hasLocalOnlyParentToken(text, cwd, root)) {
    return {
      label: "docs/maintainer/handoff/",
    };
  }

  return undefined;
}

function usesGitAddPathspecFile(text) {
  if (!new RegExp(`${GIT_PREFIX}add\\b`).test(text)) {
    return false;
  }
  return shellWords(text).some(
    (token) =>
      token === "--pathspec-from-file" ||
      token.startsWith("--pathspec-from-file=") ||
      token === "--pathspec-file-nul",
  );
}

function isForcedMaintainerParentAdd(text, cwd, root) {
  if (!new RegExp(`${GIT_PREFIX}add\\b`).test(text)) {
    return false;
  }
  if (!/\s(?:-[A-Za-z]*f[A-Za-z]*|--force)(?:\s|$)/.test(text)) {
    return false;
  }
  return shellWords(text).some((token) => {
    const relativePath = relativePathForToken(token, cwd, root);
    return isLocalOnlyParentPath(relativePath);
  });
}

function isArchiveShellCommand(text) {
  return /\b(?:tar|zip)\b/.test(text);
}

function hasLocalOnlyParentToken(text, cwd, root) {
  return shellWords(text).some((token) => {
    const relativePath = relativePathForToken(token, cwd, root);
    return isLocalOnlyParentPath(relativePath);
  });
}

function isLocalOnlyParentPath(relativePath) {
  return (
    relativePath === "docs" ||
    relativePath === "docs/*" ||
    relativePath === "docs/**" ||
    relativePath === "docs/maintainer" ||
    relativePath === "docs/maintainer/*" ||
    globMayMatchLocalOnlyParent(relativePath) ||
    (/[*?\[]/.test(relativePath) &&
      (relativePath.startsWith("docs/maintainer/handoff") ||
        relativePath.startsWith("docs/maintainer/")))
  );
}

function globMayMatchLocalOnlyParent(relativePath) {
  if (!/[*?\[]/.test(relativePath)) {
    return false;
  }
  const pattern = globPatternToRegExp(relativePath);
  return ["docs", "docs/maintainer", "docs/maintainer/handoff"].some((path) =>
    pattern.test(path),
  );
}

function globPatternToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end > index) {
        source += "[^/]";
        index = end;
        continue;
      }
    }
    source += char.replace(/[\\^$+?.()|{}]/g, "\\$&");
  }
  source += "$";
  return new RegExp(source);
}

function findIndexedLocalOnlyHit(cwd, options = {}) {
  const root = rootPath(cwd);
  const allowStagedRemovalCleanup =
    options.allowStagedRemovalCleanup === true;
  const checkHistory = options.checkHistory === true;
  const stagedRemovalPaths = new Set();
  for (const line of gitOutputLines(root, [
    "diff",
    "--cached",
    "--name-status",
  ])) {
    const entry = parseNameStatusLine(line);
    if (!entry || !(entry.status.startsWith("R") || entry.status.startsWith("C"))) {
      continue;
    }
    for (const path of entry.paths) {
      const label = localOnlyLabelForRelativePath(path);
      if (label) {
        return { label };
      }
    }
  }

  for (const line of gitOutputLines(root, [
    "diff",
    "--cached",
    "--name-status",
  ])) {
    const entry = parseNameStatusLine(line);
    if (!entry) {
      continue;
    }
    if (entry.status.startsWith("D")) {
      for (const path of entry.paths) {
        const label = localOnlyLabelForRelativePath(path);
        if (!allowStagedRemovalCleanup && label) {
          return { label };
        }
        stagedRemovalPaths.add(path);
      }
      continue;
    }
    for (const path of entry.paths) {
      const label = localOnlyLabelForRelativePath(path);
      if (label) {
        return { label };
      }
    }
  }

  for (const path of gitOutputLines(root, ["ls-files"])) {
    if (allowStagedRemovalCleanup && stagedRemovalPaths.has(path)) {
      continue;
    }
    const label = localOnlyLabelForRelativePath(path);
    if (label) {
      return { label };
    }
  }
  if (checkHistory) {
    return findHistoricalLocalOnlyHit(root, options);
  }
  return undefined;
}

function findHistoricalLocalOnlyHit(root, options = {}) {
  const range = publicationHistoryRange(root, options);
  const args = ["log", "--name-status", "--format="];
  if (range) {
    args.push(range);
  }

  for (const line of gitOutputLines(root, args)) {
    const entry = parseNameStatusLine(line);
    if (!entry) {
      continue;
    }
    for (const path of entry.paths) {
      const label = localOnlyLabelForRelativePath(path);
      if (label) {
        return { label };
      }
    }
  }
  return undefined;
}

function publicationHistoryRange(root, options = {}) {
  const explicitBase = remoteRefForPublicationBase(options.publicationBase);
  const explicitMergeBase = explicitBase
    ? mergeBaseForRemoteRef(root, explicitBase)
    : "";
  if (explicitMergeBase) {
    return `${explicitMergeBase}..HEAD`;
  }

  if (options.ignoreUpstream !== true) {
    const upstream = gitFirstLine(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "@{u}",
    ]);
    if (upstream) {
      return `${upstream}..HEAD`;
    }
  }

  const defaultBase = remoteDefaultBranch(root);
  const defaultMergeBase = defaultBase
    ? mergeBaseForRemoteRef(root, defaultBase)
    : "";
  if (defaultMergeBase) {
    return `${defaultMergeBase}..HEAD`;
  }

  const nearestBase = nearestRemoteHistoryBase(root);
  if (nearestBase) {
    return `${nearestBase.mergeBase}..HEAD`;
  }

  return "HEAD";
}

function nearestRemoteHistoryBase(root) {
  const candidates = uniqueStrings(commonRemoteBaseRefs());
  const head = gitFirstLine(root, ["rev-parse", "HEAD"]);
  const ranked = [];
  for (const base of candidates) {
    const mergeBase = mergeBaseForRemoteRef(root, base);
    if (!mergeBase) {
      continue;
    }
    if (
      mergeBase === head &&
      !localBranchMatchesRemoteAtHead(root, base, head)
    ) {
      continue;
    }
    const count = Number.parseInt(
      gitFirstLine(root, ["rev-list", "--count", `${mergeBase}..HEAD`]),
      10,
    );
    ranked.push({
      base,
      mergeBase,
      count: Number.isFinite(count) ? count : Number.MAX_SAFE_INTEGER,
    });
  }
  ranked.sort((left, right) =>
    left.count - right.count ||
    left.base.localeCompare(right.base),
  );
  return ranked[0];
}

function mergeBaseForRemoteRef(root, base) {
  if (!gitFirstLine(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`])) {
    return "";
  }
  return gitFirstLine(root, ["merge-base", "HEAD", base]);
}

function remoteRefForPublicationBase(base) {
  if (typeof base !== "string" || base.length === 0) {
    return "";
  }
  const normalized = normalizeCommandText(base)
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "");
  if (!normalized || normalized.includes(":")) {
    return "";
  }
  return normalized.startsWith("origin/") ? normalized : `origin/${normalized}`;
}

function localBranchMatchesRemoteAtHead(root, remoteRef, head) {
  const branch = remoteRef.startsWith("origin/")
    ? remoteRef.slice("origin/".length)
    : "";
  if (!branch || branch === "HEAD") {
    return false;
  }
  const localCommit = gitFirstLine(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}^{commit}`,
  ]);
  const remoteCommit = gitFirstLine(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${remoteRef}^{commit}`,
  ]);
  return localCommit === head && remoteCommit === head;
}

function commonRemoteBaseRefs() {
  return ["main", "master", "develop", "dev", "trunk"].map(
    (branch) => `origin/${branch}`,
  );
}

function remoteDefaultBranch(root) {
  const symbolicRef = gitFirstLine(root, [
    "symbolic-ref",
    "--quiet",
    "refs/remotes/origin/HEAD",
  ]);
  const remoteHead = symbolicRef ||
    gitFirstLine(root, ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
  return normalizeRemoteHeadRef(remoteHead);
}

function normalizeRemoteHeadRef(ref) {
  if (!ref) {
    return "";
  }
  const normalized = ref
    .trim()
    .replace(/^refs\/remotes\//, "");
  if (!normalized || normalized === "origin/HEAD") {
    return "";
  }
  return normalized.startsWith("origin/") ? normalized : `origin/${normalized}`;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseNameStatusLine(line) {
  const parts = line.split("\t");
  if (parts.length < 2) {
    return undefined;
  }
  const status = parts[0];
  return {
    status,
    paths: status.startsWith("R") || status.startsWith("C")
      ? [parts[1], parts[2] ?? parts[1]]
      : [parts[1]],
  };
}

function gitOutputLines(root, args) {
  try {
    const output = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0 ? output.split(/\r?\n/) : [];
  } catch {
    return [];
  }
}

function gitFirstLine(root, args) {
  return gitOutputLines(root, args)[0] ?? "";
}

function shellWords(text) {
  const words = [];
  let current = "";
  let quote = "";
  let escaping = false;
  for (const char of text) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote.length > 0) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s|[;&|()]/.test(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words;
}

function localOnlyLabelForToken(token, cwd, root) {
  const relativePath = relativePathForToken(token, cwd, root);
  return localOnlyLabelForRelativePath(relativePath);
}

function relativePathForToken(token, cwd, root) {
  if (!token || token === "--" || token.startsWith("-")) {
    return "";
  }
  const pathspec = normalizeGitPathspecToken(token);
  const normalized = expandKnownPathVariables(pathspec.path, cwd);
  if (pathspec.rootRelative) {
    return normalized.replace(/^\/+/, "");
  }
  const absolute = isAbsolute(normalized)
    ? canonicalExistingPath(normalized)
    : resolve(canonicalExistingPath(cwd), normalized);
  return normalizeCommandText(relative(root, absolute));
}

function expandKnownPathVariables(token, cwd) {
  const home = normalizeCommandText(homedir());
  return normalizeCommandText(token)
    .replace(/\$\{PWD\}/g, normalizeCommandText(cwd))
    .replace(/\$PWD\b/g, normalizeCommandText(cwd))
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$HOME\b/g, home)
    .replace(/^~(?=\/|$)/, home);
}

function normalizeGitPathspecToken(token) {
  const normalized = normalizeCommandText(token);
  if (normalized.startsWith(":/")) {
    return {
      path: normalized.slice(2),
      rootRelative: true,
    };
  }

  const magic = normalized.match(/^:\(([^)]*)\)(.*)$/);
  if (!magic) {
    return {
      path: normalized,
      rootRelative: false,
    };
  }

  const magicWords = magic[1].split(",").map((word) => word.trim());
  return {
    path: magic[2],
    rootRelative: magicWords.includes("top"),
  };
}

function localOnlyLabelForRelativePath(path) {
  const normalized = normalizeCommandText(path);
  const comparable = normalized.toLowerCase();
  if (isDotDocsLocalOnlyPath(comparable)) {
    return ".docs/";
  }
  if (
    comparable === "docs/maintainer/handoff" ||
    comparable.startsWith("docs/maintainer/handoff/")
  ) {
    return "docs/maintainer/handoff/";
  }
  return "";
}

function isDotDocsLocalOnlyPath(path) {
  if (path === ".docs" || path.startsWith(".docs/")) {
    return true;
  }
  const rootSegment = path.split("/")[0] ?? "";
  return (
    /^\.(?:docs|doc|do|d)[*?\[]/.test(rootSegment) ||
    rootSegment === ".*" ||
    (rootSegment.startsWith(".") && /[*?\[]/.test(rootSegment))
  );
}

function detectSecret(text) {
  const hit = SECRET_PATTERNS.find((check) => check.pattern.test(text));
  return hit
    ? `Blocked prompt because it appears to contain a secret (${hit.label}). Remove the secret and retry.`
    : "";
}

function preToolDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function permissionDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        message: reason,
      },
    },
  };
}

function promptBlock(reason) {
  return {
    decision: "block",
    reason,
  };
}

function stopReminder(payload) {
  if (payload.stop_hook_active === true) {
    return {};
  }

  const message = lastAssistantMessage(payload);
  if (!looksLikeImplementationWork(payload, message)) {
    return {};
  }

  const missing = [
    { label: "tests", pattern: /\b(?:test|tests|typecheck|build|CI|validation)\b/i },
    { label: "CodeRabbit", pattern: /\b(?:CodeRabbit|codex exec review|review)\b/i },
    { label: "handoff", pattern: /\b(?:handoff|session-handoff|archive)\b/i },
  ].filter((check) => !check.pattern.test(message));

  if (missing.length === 0) {
    return {};
  }

  const reminder =
    "Before finishing, include completion evidence for: " +
    missing.map((check) => check.label).join(", ") +
    ". Report tests, review/CodeRabbit status, and handoff/archive state when applicable.";
  return {
    decision: "block",
    reason: reminder,
  };
}

function looksLikeImplementationWork(payload, message) {
  const workflow = [
    payload.harness_workflow,
    payload.workflow,
    payload.mode,
    payload.intent,
  ]
    .map((value) => stringifyValue(value))
    .join(" ");
  if (/\b(?:implementation|implement|tdd|red|green|feature|bugfix)\b/i.test(workflow)) {
    return true;
  }

  const transcriptText = stringifyValue(payload.transcript);
  const combined = `${message}\n${transcriptText}`;
  return (
    /\b(?:implemented|added|updated|fixed|created|committed|pushed|opened|merged|refactored|removed)\b/i.test(
      combined,
    ) &&
    /\b(?:change|changes|fix|feature|implementation|files?|tests?|typecheck|build|CI|CodeRabbit|handoff|branch|commit|pull request|PR|diff|hook|guard|dispatcher|plugin|workflow)\b/i.test(
      combined,
    )
  );
}

function handle(mode, payload) {
  const effectiveMode = mode || String(payload.hook_event_name ?? "");
  if (effectiveMode === "pre-tool" || effectiveMode === "PreToolUse") {
    const reason = isShellExecution(payload)
      ? detectUnsafeToolUse(toolText(payload), cwdFromPayload(payload))
      : "";
    return reason ? preToolDeny(reason) : {};
  }

  if (effectiveMode === "permission" || effectiveMode === "PermissionRequest") {
    const reason = isShellExecution(payload)
      ? detectUnsafeToolUse(toolText(payload), cwdFromPayload(payload))
      : "";
    return reason ? permissionDeny(reason) : {};
  }

  if (
    effectiveMode === "prompt-submit" ||
    effectiveMode === "UserPromptSubmit"
  ) {
    const reason = detectSecret(promptText(payload));
    return reason ? promptBlock(reason) : {};
  }

  if (effectiveMode === "stop" || effectiveMode === "Stop") {
    return stopReminder(payload);
  }

  return {};
}

function parseFailureResult(mode) {
  const reason = "Blocked malformed hook input. Codex hook payload JSON could not be parsed.";
  if (mode === "pre-tool" || mode === "PreToolUse") {
    return preToolDeny(reason);
  }
  if (mode === "permission" || mode === "PermissionRequest") {
    return permissionDeny(reason);
  }
  if (mode === "prompt-submit" || mode === "UserPromptSubmit") {
    return promptBlock(reason);
  }
  return {};
}

const rawInput = await readStdin();
const payload = parsePayload(rawInput);
const mode = process.argv[2] ?? "";
const result = payload === null ? parseFailureResult(mode) : handle(mode, payload);
process.stdout.write(`${JSON.stringify(result)}\n`);
