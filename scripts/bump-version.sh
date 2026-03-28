#!/bin/bash
# Usage: ./scripts/bump-version.sh 0.2.1
# Bumps version, commits, tags, and pushes — triggers the release pipeline
set -e

VERSION="$1"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.1"
  exit 1
fi

# Update all three files
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
  sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
else
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
  sed -i "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
fi

echo "Bumped to v$VERSION"

# Commit, tag, push
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"
git push origin main --tags

echo "Done — release pipeline triggered for v$VERSION"
