#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


DOCS_ROOT = Path("docs")
NEW_YORK_TZ = ZoneInfo("America/New_York")
TIMESTAMP_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_")
TRAILING_DATE_RE = re.compile(
    r"^(?P<stem>.+?)_(?P<date>\d{4}-\d{2}-\d{2})(?:_(?P<time>\d{2}-\d{2}-\d{2}))?$"
)
SKIP_REFERENCE_DIRS = {
    ".git",
    ".npm-cache",
    ".scratch",
    "__pycache__",
    "data",
    "node_modules",
}


@dataclass(frozen=True)
class RenamePlan:
    source: Path
    target: Path


@dataclass(frozen=True)
class ReferenceUpdate:
    path: Path
    content: str
    replacement_count: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Repair docs filenames so subfolder docs use a "
            "YYYY-MM-DD_HH-MM-SS_* prefix based on file creation time."
        )
    )
    parser.add_argument(
        "--docs-root",
        type=Path,
        default=DOCS_ROOT,
        help="Docs root to scan. Defaults to ./docs.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path.cwd(),
        help="Repository root to scan for markdown references. Defaults to the current directory.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Rename files in place. Without this flag the script only prints a preview.",
    )
    return parser.parse_args()


def should_skip(path: Path, docs_root: Path) -> bool:
    relative = path.relative_to(docs_root)
    if len(relative.parts) < 2:
        return True
    if not path.is_file():
        return True
    if path.stem.upper() == "README":
        return True
    if TIMESTAMP_PREFIX_RE.match(path.name):
        return True
    return False


def read_creation_timestamp(path: Path) -> datetime:
    stat_result = path.stat()
    birthtime = getattr(stat_result, "st_birthtime", None)
    if birthtime is None:
        raise RuntimeError(
            f"{path} does not expose st_birthtime on this filesystem; "
            "refusing to guess a creation timestamp."
        )
    return datetime.fromtimestamp(birthtime, tz=NEW_YORK_TZ)


def clean_stem(stem: str) -> str:
    match = TRAILING_DATE_RE.match(stem)
    if not match:
        return stem
    stripped = match.group("stem").rstrip("_")
    return stripped or stem


def build_target(path: Path, docs_root: Path) -> Path:
    created_at = read_creation_timestamp(path)
    timestamp = created_at.strftime("%Y-%m-%d_%H-%M-%S")
    cleaned_stem = clean_stem(path.stem)
    target_name = f"{timestamp}_{cleaned_stem}{path.suffix}"
    return docs_root / path.relative_to(docs_root).parent / target_name


def collect_rename_plans(docs_root: Path) -> tuple[list[RenamePlan], list[str]]:
    plans: list[RenamePlan] = []
    errors: list[str] = []

    for path in sorted(docs_root.rglob("*")):
        if should_skip(path, docs_root):
            continue

        try:
            target = build_target(path, docs_root)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            continue

        if target == path:
            continue
        plans.append(RenamePlan(source=path, target=target))

    occupied_targets = {plan.target: plan.source for plan in plans}
    if len(occupied_targets) != len(plans):
        target_counts: dict[Path, int] = {}
        for plan in plans:
            target_counts[plan.target] = target_counts.get(plan.target, 0) + 1
        for target, count in sorted(target_counts.items()):
            if count > 1:
                errors.append(f"multiple files would rename to {target}")

    for plan in plans:
        if plan.target.exists() and plan.target != plan.source:
            errors.append(f"target already exists: {plan.target}")

    return plans, errors


def make_display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.relative_to(repo_root))
    except ValueError:
        return str(path)


def normalize_repo_relative(path: Path, repo_root: Path) -> Path:
    try:
        return path.resolve().relative_to(repo_root)
    except ValueError as exc:
        raise RuntimeError(f"{path} is not under repo root {repo_root}") from exc


def build_reference_replacements(
    markdown_path: Path,
    rename_plan: RenamePlan,
    repo_root: Path,
) -> list[tuple[str, str]]:
    source_repo_relative = normalize_repo_relative(rename_plan.source, repo_root)
    target_repo_relative = normalize_repo_relative(rename_plan.target, repo_root)

    source_repo_string = source_repo_relative.as_posix()
    target_repo_string = target_repo_relative.as_posix()
    source_stem = rename_plan.source.stem
    target_stem = rename_plan.target.stem
    source_relative = Path(
        os.path.relpath(rename_plan.source, markdown_path.parent)
    ).as_posix()
    target_relative = Path(
        os.path.relpath(rename_plan.target, markdown_path.parent)
    ).as_posix()

    replacements = [
        (source_repo_string, target_repo_string),
        (source_relative, target_relative),
        (f"./{source_relative}", f"./{target_relative}"),
        # Rewrite the markdown link label separately so we do not re-prefix
        # the already-updated filename inside the link destination.
        (f"[{source_stem}](", f"[{target_stem}]("),
    ]
    unique_replacements: list[tuple[str, str]] = []
    seen_sources: set[str] = set()
    for source_value, target_value in sorted(
        replacements,
        key=lambda pair: len(pair[0]),
        reverse=True,
    ):
        if source_value in seen_sources:
            continue
        seen_sources.add(source_value)
        unique_replacements.append((source_value, target_value))
    return unique_replacements


def replace_reference_forms(
    original_text: str,
    markdown_path: Path,
    rename_plan: RenamePlan,
    repo_root: Path,
) -> tuple[str, int]:
    updated_text = original_text
    replacement_count = 0
    for source_value, target_value in build_reference_replacements(
        markdown_path,
        rename_plan,
        repo_root,
    ):
        occurrence_count = updated_text.count(source_value)
        if not occurrence_count:
            continue
        updated_text = updated_text.replace(source_value, target_value)
        replacement_count += occurrence_count

    return updated_text, replacement_count


def iter_markdown_paths(repo_root: Path) -> list[Path]:
    markdown_paths: list[Path] = []
    for path in sorted(repo_root.rglob("*.md")):
        relative = path.relative_to(repo_root)
        if any(part in SKIP_REFERENCE_DIRS for part in relative.parts):
            continue
        markdown_paths.append(path)
    return markdown_paths


def collect_reference_updates(
    plans: list[RenamePlan],
    repo_root: Path,
) -> tuple[list[ReferenceUpdate], list[str]]:
    if not plans:
        return [], []

    updates: list[ReferenceUpdate] = []
    errors: list[str] = []

    for markdown_path in iter_markdown_paths(repo_root):
        try:
            original_content = markdown_path.read_text(encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"failed to read {markdown_path}: {exc}")
            continue

        updated_content = original_content
        replacement_count = 0

        for plan in plans:
            try:
                updated_content, applied_count = replace_reference_forms(
                    updated_content,
                    markdown_path,
                    plan,
                    repo_root,
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"failed to update references in {markdown_path}: {exc}")
                break
            replacement_count += applied_count

        if replacement_count and updated_content != original_content:
            updates.append(
                ReferenceUpdate(
                    path=markdown_path,
                    content=updated_content,
                    replacement_count=replacement_count,
                )
            )

    return updates, errors


def print_preview(
    plans: list[RenamePlan],
    updates: list[ReferenceUpdate],
    repo_root: Path,
) -> None:
    if not plans:
        print("No files need renaming.")
    else:
        print(f"{len(plans)} file(s) would be renamed:")
        for plan in plans:
            source_display = make_display_path(plan.source, repo_root)
            target_display = make_display_path(plan.target, repo_root)
            print(f"{source_display} -> {target_display}")

    if not updates:
        print("No markdown references would be updated.")
        return

    print(f"{len(updates)} markdown file(s) would be updated:")
    for update in updates:
        path_display = make_display_path(update.path, repo_root)
        print(f"{path_display} ({update.replacement_count} replacement(s))")


def apply_reference_updates(updates: list[ReferenceUpdate]) -> None:
    for update in updates:
        update.path.write_text(update.content, encoding="utf-8")
        print(f"updated references in {update.path}")

def execute_renames(plans: list[RenamePlan]) -> None:
    for plan in plans:
        plan.source.rename(plan.target)
        print(f"renamed {plan.source} -> {plan.target}")


def main() -> int:
    args = parse_args()
    docs_root = args.docs_root.resolve()
    repo_root = args.repo_root.resolve()
    if not docs_root.exists():
        print(f"docs root does not exist: {docs_root}", file=sys.stderr)
        return 1
    if not docs_root.is_dir():
        print(f"docs root is not a directory: {docs_root}", file=sys.stderr)
        return 1
    if not repo_root.exists():
        print(f"repo root does not exist: {repo_root}", file=sys.stderr)
        return 1
    if not repo_root.is_dir():
        print(f"repo root is not a directory: {repo_root}", file=sys.stderr)
        return 1

    plans, errors = collect_rename_plans(docs_root)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1

    updates, update_errors = collect_reference_updates(plans, repo_root)
    if update_errors:
        for error in update_errors:
            print(f"error: {error}", file=sys.stderr)
        return 1

    print_preview(plans, updates, repo_root)
    if not args.apply:
        print("Dry run only. Re-run with --apply to rename files and rewrite references.")
        return 0

    apply_reference_updates(updates)
    execute_renames(plans)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
