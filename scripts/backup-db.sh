#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

db_file="${repo_root}/data/storage/nyc-housing-scout.sqlite"
output_path=""
output_dir="${repo_root}/data/backups"

usage() {
  cat <<'EOF'
Usage:
  npm run backup:db
  npm run backup:db -- --output /absolute/or/relative/path.sqlite
  npm run backup:db -- --dir /absolute/or/relative/output-dir
  npm run backup:db -- --db /absolute/or/relative/source.sqlite

Creates a consistent SQLite snapshot using sqlite3 .backup.
Defaults:
  db:  data/storage/nyc-housing-scout.sqlite
  dir: data/backups/
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      db_file="$2"
      shift 2
      ;;
    --dir)
      output_dir="$2"
      shift 2
      ;;
    --output)
      output_path="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${db_file}" ]]; then
  echo "Source database not found: ${db_file}" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but not installed." >&2
  exit 1
fi

timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"

if [[ -z "${output_path}" ]]; then
  mkdir -p "${output_dir}"
  output_path="${output_dir}/nyc-housing-scout-${timestamp}.sqlite"
else
  mkdir -p "$(dirname "${output_path}")"
fi

sqlite3 "${db_file}" ".timeout 5000" ".backup ${output_path}"

echo "Backup created: ${output_path}"
