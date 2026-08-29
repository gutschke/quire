#!/usr/bin/env python3
"""Render NPC character sheets from a campaign's NPC JSON files.

NPCs carry no stats in play, so these are prose sheets: who the person is, how
they sound, what the DM is holding, and what must never be said out loud.

    npc-sheets.py <campaign-dir> -o out.pdf                # every NPC
    npc-sheets.py <campaign-dir> -o out.pdf --only daniel-reyes
    npc-sheets.py <campaign-dir> -o out.pdf --no-dm-notes  # safe to hand over

`dmNotes` is DM-facing and often carries the campaign's biggest spoilers, so it
is rendered in a visually distinct block that cannot be mistaken for the rest of
the sheet, and --no-dm-notes drops it entirely.

{{pc:N}} tokens are left as-is unless --pc-names is given (a JSON file mapping
slot number to a name), which is how a private printable copy gets real names
without those names entering the repository.
"""
import argparse, html, json, pathlib, re, shutil, subprocess, sys, tempfile

FIELD_ORDER = ["role", "description", "background", "career", "family",
               "voice", "signature", "knownTo", "tags"]
LABELS = {
    "role": "Role", "description": "Description", "background": "Background",
    "career": "Career", "family": "Family", "voice": "Voice",
    "signature": "Signature beats", "knownTo": "Known to", "tags": "Tags",
}
# Rendered in the header line rather than as their own sections.
HEADER_FIELDS = ["pronouns", "disposition", "alignment"]
SKIP = {"$schemaVersion", "name", "stats", "harm", "dmNotes"}

CSS = """
:root { --ink:#1a1a1a; --muted:#6b6b6b; --rule:#c9c2ae; --accent:#7a6f52;
        --accent-soft:#f3ecd6; --dm:#8a4b2a; --dm-soft:#fdf1e8; --dm-rule:#d9a882; }
* { box-sizing: border-box; }
body { font-family: Georgia,"Times New Roman",serif; color: var(--ink);
       font-size: 10.5pt; line-height: 1.45; margin: 0; }
main { max-width: 8.5in; margin: 0 auto; padding: 24px; }
.sheet { padding-bottom: 8px; }
.sheet + .sheet { border-top: 2px solid var(--rule); margin-top: 28px; padding-top: 22px; }
h1 { font-family: "Optima","Gill Sans",sans-serif; font-size: 22pt; margin: 0 0 2px; }
.meta { color: var(--muted); font-size: 9.5pt; margin-bottom: 4px; }
.rolebar { border-left: 3px solid var(--accent); background: var(--accent-soft);
           padding: 7px 11px; margin: 12px 0 16px; font-size: 10pt; }
h2 { font-family: "Optima","Gill Sans",sans-serif; font-size: 9.5pt;
     letter-spacing: .1em; text-transform: uppercase; color: var(--accent);
     border-bottom: 1px solid var(--rule); padding-bottom: 2px;
     margin: 16px 0 6px; }
p { margin: 0 0 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip { border: 1px solid var(--rule); border-radius: 10px; padding: 1px 9px;
        font-size: 8.5pt; font-family: "Optima","Gill Sans",sans-serif; }
.dm { border: 1.5px solid var(--dm-rule); background: var(--dm-soft);
      border-radius: 5px; padding: 10px 13px; margin-top: 16px; }
.dm h2 { color: var(--dm); border-bottom-color: var(--dm-rule); margin-top: 0; }
.dm blockquote { border-left: 3px solid var(--dm-rule); margin: 8px 0;
                 padding: 2px 0 2px 11px; color: #6d3c22; }
blockquote { border-left: 3px solid var(--rule); margin: 8px 0;
             padding: 2px 0 2px 11px; color: #4a4a4a; }
strong { font-weight: 700; }
code { font-family: inherit; }
footer { margin-top: 14px; padding-top: 5px; border-top: 1px solid var(--rule);
         color: var(--muted); font-size: 8pt; display: flex;
         justify-content: space-between; }
@page { size: letter; margin: 0.5in; }
@media print {
  main { max-width: none; padding: 0; }
  .sheet { page-break-after: always; border-top: none; margin-top: 0; padding-top: 0; }
  .sheet:last-of-type { page-break-after: auto; }
  h2, .rolebar { page-break-after: avoid; }
  .dm { page-break-inside: auto; }
}
@media (prefers-color-scheme: dark) {
  :root { --ink:#e8e4d9; --muted:#9a948a; --rule:#4a4436; --accent:#c9b98a;
          --accent-soft:#2a2418; --dm:#e0a074; --dm-soft:#2e1f16; --dm-rule:#7a4d2e; }
  body { background: #14120e; }
}
"""


def inline(text):
    """Minimal markdown: **bold**, *italic*, `code`, > quotes, blank-line paras."""
    out = []
    for block in re.split(r"\n\s*\n", text.strip()):
        block = block.strip()
        if not block:
            continue
        quote = all(l.lstrip().startswith(">") for l in block.splitlines())
        if quote:
            block = "\n".join(re.sub(r"^\s*>\s?", "", l) for l in block.splitlines())
        body = html.escape(block).replace("\n", "<br>")
        body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", body, flags=re.S)
        body = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<em>\1</em>", body, flags=re.S)
        body = re.sub(r"`(.+?)`", r"<code>\1</code>", body, flags=re.S)
        out.append(f"<blockquote>{body}</blockquote>" if quote else f"<p>{body}</p>")
    return "\n".join(out)


def render(npc, show_dm, campaign_name):
    name = html.escape(str(npc.get("name", "Unnamed")))
    bits = [html.escape(str(npc[f])) for f in HEADER_FIELDS if npc.get(f)]
    parts = [f'<div class="sheet"><h1>{name}</h1>']
    if bits:
        parts.append(f'<div class="meta">{" &middot; ".join(bits)}</div>')
    if npc.get("role"):
        parts.append(f'<div class="rolebar">{inline(str(npc["role"]))}</div>')

    seen = set(HEADER_FIELDS) | SKIP | {"role"}
    ordered = [f for f in FIELD_ORDER if f in npc and f not in seen]
    extra = [k for k in npc if k not in seen and k not in ordered]
    for field in ordered + sorted(extra):
        value = npc[field]
        if value in (None, "", [], {}):
            continue
        label = html.escape(LABELS.get(field, field[:1].upper() + field[1:]))
        parts.append(f"<h2>{label}</h2>")
        if isinstance(value, list):
            chips = "".join(f'<span class="chip">{html.escape(str(v))}</span>' for v in value)
            parts.append(f'<div class="chips">{chips}</div>')
        elif isinstance(value, dict):
            parts.append(inline("\n\n".join(f"**{k}:** {v}" for k, v in value.items())))
        else:
            parts.append(inline(str(value)))

    if show_dm and npc.get("dmNotes"):
        parts.append('<div class="dm"><h2>DM notes &mdash; not for players</h2>')
        parts.append(inline(str(npc["dmNotes"])))
        parts.append("</div>")

    tail = "DM copy" if show_dm else "player-safe copy"
    parts.append(f'<footer><span>{html.escape(campaign_name)} &middot; NPC sheet '
                 f'&middot; {tail}</span><span>{name}</span></footer></div>')
    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("campaign", help="campaign root (the directory holding campaign.json)")
    ap.add_argument("names", nargs="*",
                    help="NPC file stems; default is all of them. Must come before "
                         "any options, or use --only instead.")
    ap.add_argument("--only", default="",
                    help="comma-separated NPC file stems, usable in any position")
    ap.add_argument("-o", "--out", required=True, help="output .pdf or .html")
    ap.add_argument("--no-dm-notes", action="store_true",
                    help="omit dmNotes — use for anything a player may see")
    ap.add_argument("--pc-names", help="JSON mapping slot number to name, to resolve "
                                       "{{pc:N}} tokens in a private printable copy")
    args = ap.parse_args()

    root = pathlib.Path(args.campaign)
    npc_dir = root / "characters" / "npcs"
    if not npc_dir.is_dir():
        sys.exit(f"no characters/npcs/ under {root}")

    named = list(args.names) + [n.strip() for n in args.only.split(",") if n.strip()]
    stems = named or sorted(p.stem for p in npc_dir.glob("*.json"))
    npcs = []
    for stem in stems:
        path = npc_dir / f"{stem}.json"
        if not path.exists():
            sys.exit(f"no such NPC: {path}")
        npcs.append(json.loads(path.read_text()))

    campaign_name = root.name
    manifest = root / "campaign.json"
    if manifest.exists():
        campaign_name = json.loads(manifest.read_text()).get("name", campaign_name)

    body = "\n".join(render(n, not args.no_dm_notes, campaign_name) for n in npcs)
    doc = (f"<!doctype html><html><head><meta charset='utf-8'>"
           f"<title>{html.escape(campaign_name)} — NPC sheets</title>"
           f"<style>{CSS}</style></head><body><main>{body}</main></body></html>")

    if args.pc_names:
        slots = json.loads(pathlib.Path(args.pc_names).read_text())
        slots = slots.get("slots", slots)
        def sub(m):
            entry = slots.get(m.group(1), {})
            return html.escape(entry["pc"] if isinstance(entry, dict) else str(entry))
        doc = re.sub(r"\{\{pc:([1-9])\}\}", sub, doc)

    out = pathlib.Path(args.out).resolve()
    if out.suffix.lower() == ".html":
        out.write_text(doc)
        print(f"Wrote {out}")
        return

    chrome = next((c for c in ("google-chrome", "chromium", "chromium-browser")
                   if shutil.which(c)), None)
    if not chrome:
        sys.exit("need Chrome/Chromium on PATH to write a PDF (or ask for .html)")
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / "npc-sheets.html"
        src.write_text(doc)
        subprocess.run([chrome, "--headless", "--disable-gpu", "--no-sandbox",
                        f"--print-to-pdf={out}", "--no-pdf-header-footer",
                        f"file://{src}"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Wrote {out} ({len(npcs)} NPC{'s' if len(npcs) != 1 else ''})")


if __name__ == "__main__":
    main()
