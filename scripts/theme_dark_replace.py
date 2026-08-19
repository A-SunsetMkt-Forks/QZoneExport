#!/usr/bin/env python3
"""Batch replace hardcoded colors in viewer .vue files with CSS variables."""
import os
import re

VIEWER_SRC = "viewer/src"
ALREADY_DONE = {"CommentList.vue", "NightOwlPanel.vue", "App.vue", "styles.css", "MapPage.vue"}

REPLACEMENTS = [
    # text colors (safe to replace globally in style blocks)
    ("#333", "var(--text-primary)"),
    ("#666", "var(--text-secondary)"),
    ("#888", "var(--text-secondary)"),
    ("#999", "var(--text-muted)"),
    ("#bbb", "var(--text-subtle)"),
    ("#aaa", "var(--text-subtle)"),
    ("#ccc", "var(--text-subtle)"),
    ("#555", "var(--text-secondary)"),
    ("#777", "var(--text-secondary)"),

    # borders (safe globally)
    ("#ebedf0", "var(--border-card)"),
    ("#eef0f3", "var(--border-card)"),
    ("#efeff5", "var(--border-light)"),
    ("#eee", "var(--border-light)"),
    ("#e0e3e8", "var(--border-hover)"),
    ("#d9d9d9", "var(--border-dashed)"),
    ("#d9dde3", "var(--border-hover)"),
    ("#dcdfe6", "var(--border-separator)"),
    ("#e6e6ec", "var(--border-separator)"),
    ("#f0f0f4", "var(--border-toolbar)"),
    ("#e8e3f5", "var(--border-separator)"),
    ("#efecf7", "var(--border-separator)"),
    ("#e0ebff", "var(--border-light)"),
    ("#e0ecfd", "var(--border-light)"),

    # soft backgrounds
    ("#fafbfc", "var(--bg-toolbar)"),
    ("#fafafc", "var(--bg-toolbar)"),
    ("#f6f8fa", "var(--bg-toolbar)"),
    ("#f3f5f8", "var(--bg-toolbar)"),
    ("#f7f7fa", "var(--bg-toolbar)"),
    ("#faf9fd", "var(--bg-tint-purple)"),
    ("#f6f4fb", "var(--bg-tint-purple)"),
    ("#f4f7f6", "var(--bg-page)"),
    ("#f3f6fb", "var(--bg-toolbar)"),
    ("#f0f2f5", "var(--bg-toolbar)"),

    # tinted backgrounds
    ("#e8f4fc", "var(--bg-tint-blue)"),
    ("#ecf5ff", "var(--bg-tint-blue)"),
    ("#eaf3fe", "var(--bg-tint-blue)"),
    ("#e8f0ff", "var(--bg-tint-blue)"),
    ("#e6f1fb", "var(--bg-tint-blue)"),
    ("#f0faf4", "var(--bg-tint-green)"),
    ("#f1faf4", "var(--bg-tint-green)"),
    ("#eefbf6", "var(--bg-tint-green)"),
    ("#f2f7ed", "var(--bg-tint-green)"),
    ("#f1f6ff", "var(--bg-tint-blue)"),
    ("#fff7e6", "var(--bg-tint-yellow)"),
    ("#fdf6ec", "var(--bg-tint-yellow)"),
    ("#faeeda", "var(--bg-tint-yellow)"),
    ("#fdf6e3", "var(--bg-tint-yellow)"),
    ("#fef0f0", "var(--bg-tint-red)"),
    ("#fdf1ed", "var(--bg-tint-red)"),
    ("#faf7ff", "var(--bg-tint-purple)"),

    # special backgrounds
    ("#f0f0f0", "var(--bg-toolbar)"),
    ("#f0f0f2", "var(--border-separator)"),
    ("#f2f2f5", "var(--border-separator)"),
    ("#e8ecef", "var(--bg-toolbar)"),
    ("#f5f5f5", "var(--bg-toolbar)"),
    ("#e0e0e0", "var(--border-toolbar)"),
    ("#f4f4f6", "var(--bg-toolbar)"),
    ("#ececf1", "var(--border-separator)"),
    ("#fafaf5", "var(--bg-toolbar)"),
    ("#e5e5e0", "var(--border-hover)"),
]

# #fff needs special handling - only in background contexts
WHITE_BG_PATTERNS = [
    (r"background:\s*#fff\b", "background: var(--bg-primary)"),
    (r"background-color:\s*#fff\b", "background-color: var(--bg-primary)"),
    (r"background:\s*#ffffff", "background: var(--bg-primary)"),
]

def process_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    original = content

    for old, new in REPLACEMENTS:
        content = content.replace(old, new)

    for pattern, replacement in WHITE_BG_PATTERNS:
        content = re.sub(pattern, replacement, content)

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return True
    return False

def main():
    changed = 0
    skipped = 0
    for root, dirs, files in os.walk(VIEWER_SRC):
        for f in files:
            if f.endswith(".vue"):
                if f in ALREADY_DONE:
                    skipped += 1
                    continue
                filepath = os.path.join(root, f)
                if process_file(filepath):
                    changed += 1
                    print(f"  ✓ {filepath}")
    print(f"\nChanged: {changed} files, Skipped: {skipped} files")
    print("NOTE: Review #fff background replacements manually for correctness.")

if __name__ == "__main__":
    main()
