#!/usr/bin/env python3
# /// script
# dependencies = []
# ///
"""Validate the open-jarvis-talk AI tooling layer (.claude/) against the Agent Skills spec
and this repo's conventions.

Usage:
    python3 -I .claude/skills/validate-tooling/scripts/validate.py [REPO_ROOT]

REPO_ROOT defaults to the current directory and must contain .claude/.
Exits 0 when there is no FAIL finding, 1 otherwise, 2 on a usage error.
WARN findings are reported but do not fail the run.
"""
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
UNDERSCORE_NAME_RE = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?(.*)\Z", re.DOTALL)
AGENT_MODELS = {"opus", "sonnet", "haiku", "inherit"}
AGENT_EFFORTS = {"low", "medium", "high", "xhigh", "max"}
MAX_NAME = 64
MAX_DESC = 1024
MAX_COMPAT = 500
MAX_LISTING = 1536
WARN_LINES = 500
CRIT_LINES = 1000
AGENT_WARN_LINES = 99
MEMORY_WARN = 200
MEMORY_CRIT = 400
VAGUE_PHRASES = [
    "handle errors appropriately",
    "follow best practices",
    "best practice for",
    "appropriately handle",
    "handle edge cases appropriately",
    "use best practices for",
    "as needed",
    "if necessary",
]
BUILTIN_AGENT_TYPES = {"general-purpose", "Explore", "Plan", "claude"}
DASH_SECTIONS = ("gotcha", "step", "workflow", "prerequisite", "troubleshoot", "available script")

# User-level skills that exist globally and are never vendored into this repo.
GLOBAL_ONLY = {"handover", "do_not_commit", "do_not_add_comments", "brief", "staff", "reclaim_machine"}

# The repo is public and the plugin ships from the repo root, so nothing personal may land
# in the tooling layer or the lesson pile.
PUBLIC_SCAN_DIRS = (".claude",)
PUBLIC_SKIP_DIRS = {"node_modules", ".git", "__pycache__", "worktrees"}
PUBLIC_SKIP_FILES = {"settings.local.json"}
TEXT_SUFFIXES = {"", ".md", ".py", ".sh", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".json",
                 ".jsonc", ".yaml", ".yml", ".txt", ".html", ".toml"}
LEAK_PATTERNS = [
    ("home path", re.compile(r"/(?:Users|home)/(?![<$])[A-Za-z0-9._-]+/")),
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")),
    ("uuid", re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})")),
    ("Anthropic key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("API key", re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
    ("Slack token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("AWS key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private key", re.compile("-----" + r"BEGIN [A-Z ]*PRIVATE KEY")),
]
EMAIL_ALLOW = ("noreply@anthropic.com", "users.noreply.github.com", "@example.com",
               "@example.org", "@example.net")

findings = []


def fail(path, code, msg):
    findings.append(("FAIL", str(path), code, msg))


def warn(path, code, msg):
    findings.append(("WARN", str(path), code, msg))


def info(path, code, msg):
    findings.append(("INFO", str(path), code, msg))


def read(path):
    return path.read_text(encoding="utf-8", errors="replace")


def parse_frontmatter(text):
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None, text
    return m.group(1), m.group(2)


def simple_yaml(fm_text):
    """Tiny YAML subset parser for flat `key: value` and indented `key:` blocks."""
    out = {}
    cur = None
    for raw in fm_text.splitlines():
        line = raw.rstrip("\r")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        stripped = line.strip()
        if indent == 0 and ":" in stripped:
            k, _, v = stripped.partition(":")
            v = v.strip()
            if v:
                out[k.strip()] = unquote(v)
                cur = None
            else:
                cur = k.strip()
                out[cur] = {}
        elif cur is not None and indent > 0 and ":" in stripped and isinstance(out[cur], dict):
            k, _, v = stripped.partition(":")
            out[cur][k.strip()] = unquote(v.strip())
        elif cur is not None and indent > 0:
            if isinstance(out[cur], dict) and not out[cur]:
                out[cur] = stripped
            elif isinstance(out[cur], str):
                out[cur] = (out[cur] + " " + stripped).strip()
    return out


def unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
        v = v[1:-1]
    return v


def check_common(path, text, kind):
    fm_text, body = parse_frontmatter(text)
    if fm_text is None:
        fail(path, "frontmatter-missing",
             f"{kind} has no leading --- frontmatter block; metadata is invisible to the agent.")
        return None, body
    fm = simple_yaml(fm_text)
    name = fm.get("name")
    desc = fm.get("description")
    if kind == "skill":
        if not name:
            fail(path, "name-missing", "Skill frontmatter has no `name` field (required by spec).")
        elif len(name) > MAX_NAME:
            fail(path, "name-too-long", f"name is {len(name)} chars; max {MAX_NAME}.")
        elif not NAME_RE.match(name) and not UNDERSCORE_NAME_RE.match(name):
            fail(path, "name-format",
                 f"name `{name}` must be lowercase a-z0-9 with single hyphens or underscores; no leading/trailing/double separators.")
        elif name != path.parent.name:
            fail(path, "name-dir-mismatch",
                 f"name `{name}` must match the skill directory name `{path.parent.name}`.")
        elif not NAME_RE.match(name):
            warn(path, "name-underscore",
                 f"name `{name}` uses underscores; the Agent Skills spec prefers hyphens. Accepted when it matches the slash command.")
    if kind == "agent" and not name:
        fail(path, "name-missing", "Agent frontmatter has no `name` field.")
    if desc is None:
        if kind in ("skill", "agent"):
            fail(path, "desc-missing", f"{kind} has no `description`; it cannot be matched for triggering.")
        else:
            warn(path, "desc-missing", f"{kind} has no `description`; the slash menu shows nothing useful.")
    elif not str(desc).strip():
        fail(path, "desc-empty", "description is empty.")
    else:
        dlen = len(str(desc))
        if kind == "skill" and dlen > MAX_DESC:
            fail(path, "desc-too-long", f"description is {dlen} chars; spec max {MAX_DESC}.")
        if dlen < 30:
            warn(path, "desc-thin", "description under 30 chars — too thin to trigger reliably.")
    if kind == "command" and fm.get("argument-hint") is None:
        warn(path, "no-argument-hint", "command has no `argument-hint`; the slash menu cannot show its arguments.")
    compat = fm.get("compatibility")
    if compat is not None and len(str(compat)) > MAX_COMPAT:
        fail(path, "compat-too-long", f"compatibility is {len(str(compat))} chars; max {MAX_COMPAT}.")
    listing = len(str(desc or "")) + len(str(fm.get("when_to_use") or ""))
    if listing > MAX_LISTING:
        warn(path, "listing-budget", f"description+when_to_use is {listing} chars; listing cap {MAX_LISTING}.")
    lines = text.count("\n") + 1
    if lines > CRIT_LINES:
        fail(path, "file-too-long", f"{kind} is {lines} lines; critical threshold {CRIT_LINES}. Split it.")
    elif lines > WARN_LINES:
        warn(path, "file-long", f"{kind} is {lines} lines; keep it under {WARN_LINES} (progressive disclosure).")
    return fm, body


def strip_code(body):
    prose = re.sub(r"```.*?```", "", body, flags=re.DOTALL)
    return re.sub(r"`[^`]*`", "", prose)


def check_refs(path, body, base):
    for ref in re.findall(r"\]\(([^)]+)\)", strip_code(body)):
        if ref.startswith(("http://", "https://", "#", "mailto:")):
            continue
        target = (base / ref.split("#", 1)[0]).resolve()
        if not target.exists():
            warn(path, "broken-ref", f"links `{ref}`, which does not resolve.")


def check_skill(path, text):
    fm, body = check_common(path, text, "skill")
    if fm is None:
        return
    if not body.strip():
        fail(path, "empty-body", "SKILL.md has no instruction body.")
    check_refs(path, body, path.parent)
    dmi = str(fm.get("disable-model-invocation", "")).lower()
    if dmi not in ("true", "1", "yes") and not body.strip().startswith("#"):
        warn(path, "no-h1", "SKILL.md body does not start with a `#` heading.")
    check_vague_phrases(path, body)
    if not any(s in body.lower() for s in DASH_SECTIONS) and len(body.splitlines()) > 40:
        warn(path, "no-gotchas", "No Gotchas/Steps/Troubleshooting section in a sizable skill.")
    for child in sorted(path.parent.glob("**/*")):
        if child.is_file() and child.suffix in (".py", ".sh", ".js", ".ts", ".rb"):
            check_script(path.parent, child)


def check_vague_phrases(path, body):
    """Vague filler outside code and emphasis, so a file discussing the anti-pattern passes."""
    prose = strip_code(body)
    prose = re.sub(r"\*[^*]*\*", "", prose)
    prose = re.sub(r"__[^_]*__", "", prose)
    hits = [p for p in VAGUE_PHRASES if p in prose.lower()]
    if hits:
        warn(path, "vague-phrasing", f"contains vague filler ({', '.join(hits[:3])}); replace with a concrete instruction or cut it.")


def check_script(skill_dir, path):
    try:
        text = read(path)
    except OSError:
        return
    if not text.strip():
        fail(skill_dir, "empty-script", f"bundled script `{path.name}` is empty.")
        return
    documented = any(t in text for t in ("--help", "argparse", "getopt", "Usage:"))
    if not documented and len(text.splitlines()) > 20:
        warn(skill_dir, "script-no-help", f"bundled script `{path.name}` has no --help/usage text.")
    if path.suffix == ".py":
        if re.search(r"(?<![\"'])\binput\s*\(", text) and not only_in_strings(text, "input("):
            fail(skill_dir, "script-interactive",
                 f"bundled script `{path.name}` reads from the terminal; agents run non-interactive shells and will hang.")
        if re.search(r"shell\s*=\s*True", text) and "subprocess" in text and not only_in_strings(text, "shell=True"):
            warn(skill_dir, "script-shell-true",
                 f"bundled script `{path.name}` runs a command with shell enabled; pass an argument list.")
    if path.suffix == ".sh" and not text.startswith("#!"):
        warn(skill_dir, "script-no-shebang", f"bundled script `{path.name}` has no shebang.")


def only_in_strings(text, needle):
    """True if every occurrence of needle sits inside a quoted string literal."""
    found_any = False
    for m in re.finditer(re.escape(needle), text):
        found_any = True
        before = text[:m.start()]
        if before.count("'") % 2 == 0 and before.count('"') % 2 == 0:
            return False
    return found_any


def check_agent(path, text):
    fm, body = check_common(path, text, "agent")
    if fm is None:
        return
    if fm.get("name") and fm["name"] != path.stem:
        fail(path, "name-file-mismatch", f"agent name `{fm['name']}` must match the file name `{path.stem}`.")
    model = fm.get("model")
    effort = fm.get("effort")
    if model is None:
        warn(path, "no-model", "Agent has no `model` pinned; it inherits the session model.")
    elif str(model) not in AGENT_MODELS:
        warn(path, "bad-model", f"model `{model}` not in {sorted(AGENT_MODELS)}.")
    if effort is None:
        warn(path, "no-effort", "Agent has no `effort` pinned; it inherits the session effort.")
    elif str(effort) not in AGENT_EFFORTS:
        warn(path, "bad-effort", f"effort `{effort}` not in {sorted(AGENT_EFFORTS)}.")
    if not body.strip():
        fail(path, "empty-body", "Agent has no instruction body.")
    lines = text.count("\n") + 1
    if lines > AGENT_WARN_LINES:
        warn(path, "agent-long", f"Agent is {lines} lines; keep the body lean.")


def check_command(path, text):
    fm, body = check_common(path, text, "command")
    if fm is None:
        return
    if not body.strip():
        fail(path, "empty-body", "Command has no instruction body.")
    for ref in re.findall(r"\.claude/(?:skills|agents|workflows|commands)/[A-Za-z0-9_./-]+", body):
        ref = ref.rstrip(".")
        if not (path.parents[2] / ref).exists():
            fail(path, "pointer-broken", f"names `{ref}`, which does not exist.")


def js_skip_string(text, i):
    q = text[i]
    i += 1
    while i < len(text) and text[i] != q:
        i += 2 if text[i] == "\\" else 1
    return i + 1


def extract_meta(text):
    """Return the `{...}` source of `export const meta = {...}`, or None."""
    m = re.search(r"^export const meta\s*=\s*\{", text, re.MULTILINE)
    if not m:
        return None, None
    start = m.end() - 1
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c in "'\"`":
            i = js_skip_string(text, i)
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = len(text) if j < 0 else j
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1], m.start()
        i += 1
    return None, m.start()


def check_workflow(path, text):
    meta, pos = extract_meta(text)
    if pos is None:
        fail(path, "meta-missing", "workflow has no `export const meta = {...}`; the Workflow tool rejects it.")
        return
    if meta is None:
        fail(path, "meta-unbalanced", "could not find the end of the `meta` object.")
        return
    leading = re.sub(r"//[^\n]*|/\*.*?\*/", "", text[:pos], flags=re.DOTALL).strip()
    if leading:
        fail(path, "meta-not-first", "`export const meta` must be the first statement of the script.")
    if "`" in meta:
        fail(path, "meta-not-literal", "meta uses a template literal; it must be a pure literal.")
    residue = re.sub(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", "", meta)
    residue = re.sub(r"//[^\n]*", "", residue)
    residue = re.sub(r"\b[A-Za-z_$][\w$]*\s*:", "", residue)
    residue = re.sub(r"\b(?:true|false|null)\b|-?\d+(?:\.\d+)?", "", residue)
    leftover = re.sub(r"[\s{}\[\],]", "", residue)
    if leftover:
        fail(path, "meta-not-literal",
             f"meta contains non-literal tokens (`{leftover[:40]}`); no variables, calls, spreads or interpolation.")
    for key in ("name", "description"):
        if not re.search(r"\b" + key + r"\s*:\s*['\"]", meta):
            fail(path, "meta-field-missing", f"meta has no string `{key}`.")
    body = text[pos + len(meta):]
    code = re.sub(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"", "''", body)
    code = re.sub(r"//[^\n]*", "", code)
    for pat, what in ((r"\bDate\.now\s*\(", "Date.now()"), (r"\bMath\.random\s*\(", "Math.random()"),
                      (r"\bnew Date\s*\(\s*\)", "new Date()")):
        if re.search(pat, code):
            fail(path, "workflow-nondeterministic", f"calls {what}, which throws in a workflow (it would break resume).")
    agents_dir = path.parents[1] / "agents"
    for t in sorted(set(re.findall(r"\bagentType\s*:\s*['\"]([^'\"]+)['\"]", body))):
        if t not in BUILTIN_AGENT_TYPES and not (agents_dir / f"{t}.md").exists():
            fail(path, "agent-type-missing", f"agentType '{t}' is neither built in nor in .claude/agents/.")
    meta_phases = set(re.findall(r"title\s*:\s*['\"]([^'\"]+)['\"]", meta))
    used = set(re.findall(r"\bphase\(\s*['\"]([^'\"]+)['\"]\s*\)", body))
    for t in sorted(used - meta_phases):
        warn(path, "phase-mismatch", f"phase('{t}') has no matching meta.phases title.")
    for t in sorted(meta_phases - used):
        warn(path, "phase-unused", f"meta.phases lists '{t}' but no phase('{t}') call exists.")


def check_inventory(root, items):
    """Every tooling file must be named in .claude/README.md, and every .claude/ path it names must exist."""
    readme = root / ".claude/README.md"
    if not readme.exists():
        fail(readme, "inventory-missing", ".claude/README.md does not exist; the tooling inventory has no home.")
        return
    text = read(readme)
    ticks = set(re.findall(r"`([^`\n]+)`", text))
    for kind, name, path in items:
        variants = {name, "/" + name, name + ".md", name + ".js", f".claude/{kind}/{name}",
                    f".claude/{kind}/{name}/", f".claude/{kind}/{name}.md", f".claude/{kind}/{name}.js",
                    f"{kind}/{name}", f"{kind}/{name}/", f"{kind}/{name}.md", f"{kind}/{name}.js"}
        if not any(t.split(" ")[0] in variants for t in ticks):
            fail(path, "inventory-row-missing",
                 f"`{name}` is not named in .claude/README.md; add its row in the same change.")
    for ref in sorted({r.rstrip(".,") for r in re.findall(r"\.claude/[A-Za-z0-9_./-]+", text)}):
        if "*" in ref or "<" in ref:
            continue
        if not (root / ref).exists():
            warn(readme, "inventory-stale", f"names `{ref}`, which does not exist.")
    check_refs(readme, text, readme.parent)


def check_global_dups(root, items):
    home = Path.home()
    for kind, name, path in items:
        if kind not in ("skills", "commands"):
            continue
        if name in GLOBAL_ONLY:
            fail(path, "dup-global",
                 f"`{name}` is a user-level skill in ~/.claude and is never vendored into this repo.")
            continue
        for g in (home / ".claude/skills" / name / "SKILL.md", home / ".claude/commands" / f"{name}.md"):
            if g.exists():
                warn(path, "dup-global", f"`{name}` also exists in ~/.claude; confirm the repo copy is not a duplicate.")
                break


def check_public(root):
    for d in PUBLIC_SCAN_DIRS:
        base = root / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file() or any(part in PUBLIC_SKIP_DIRS for part in p.relative_to(root).parts):
                continue
            if p.name in PUBLIC_SKIP_FILES or p.suffix.lower() not in TEXT_SUFFIXES:
                continue
            try:
                if p.stat().st_size > 2_000_000:
                    continue
                lines = read(p).splitlines()
            except OSError:
                continue
            for n, line in enumerate(lines, 1):
                for what, rx in LEAK_PATTERNS:
                    for m in rx.finditer(line):
                        hit = m.group(0)
                        if what == "email" and any(a in hit.lower() for a in EMAIL_ALLOW):
                            continue
                        fail(f"{p}:{n}", "public-leak",
                             f"{what} `{hit[:60]}` in a public, shipped file; use `~`, a repo-relative path or a placeholder.")
    local = root / ".claude/settings.local.json"
    gi = root / ".gitignore"
    if local.exists() and not (gi.exists() and "settings.local.json" in read(gi)):
        warn(local, "local-settings-tracked", "settings.local.json is not in .gitignore; it would be published.")


def check_memory_file(path, text):
    if not text.strip():
        warn(path, "memory-empty", "Memory file is empty.")
        return
    lines = text.count("\n") + 1
    if lines > MEMORY_CRIT:
        fail(path, "memory-too-long", f"{path.name} is {lines} lines; critical threshold {MEMORY_CRIT}.")
    elif lines > MEMORY_WARN:
        warn(path, "memory-long", f"{path.name} is {lines} lines; target under {MEMORY_WARN}.")
    if not re.search(r"^#{1,3} ", text, re.MULTILINE):
        warn(path, "memory-no-headers", f"{path.name} has no markdown headers.")
    check_vague_phrases(path, text)


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    root = Path(args[0]).resolve() if args else Path.cwd().resolve()
    claude = root / ".claude"
    if not claude.is_dir():
        print(f"ERROR: {root} has no .claude/ — run from the repo root or pass it.", file=sys.stderr)
        return 2
    items = []
    for p in sorted(claude.glob("skills/*/SKILL.md")):
        items.append(("skills", p.parent.name, p))
        check_skill(p, read(p))
    for d in sorted(claude.glob("skills/*/")):
        if not (d / "SKILL.md").exists():
            fail(d, "skill-md-missing", "skill directory has no SKILL.md.")
    for p in sorted(claude.glob("agents/*.md")):
        items.append(("agents", p.stem, p))
        check_agent(p, read(p))
    for p in sorted(claude.glob("commands/*.md")):
        items.append(("commands", p.stem, p))
        check_command(p, read(p))
    for p in sorted(claude.glob("workflows/*.js")):
        items.append(("workflows", p.stem, p))
        check_workflow(p, read(p))
    check_inventory(root, items)
    check_global_dups(root, items)
    check_public(root)
    for name in ("CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"):
        mp = root / name
        if mp.exists():
            check_memory_file(mp, read(mp))
    by_level = {"FAIL": [], "WARN": [], "INFO": []}
    for level, path, code, msg in findings:
        by_level[level].append((path, code, msg))
    print(f"Repo: {root}")
    print(f"Checked: {len(items)} tooling files")
    print(f"Findings: {len(by_level['FAIL'])} FAIL, {len(by_level['WARN'])} WARN, {len(by_level['INFO'])} INFO\n")
    for level in ("FAIL", "WARN", "INFO"):
        for path, code, msg in by_level[level]:
            print(f"{level} [{code}] {path}\n      {msg}")
        if by_level[level]:
            print()
    return 1 if by_level["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
