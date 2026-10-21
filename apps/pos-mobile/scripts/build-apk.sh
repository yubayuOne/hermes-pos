#!/bin/sh
# Builds the release APK on this machine: checks first, then gradle, then copies it to dist/hermes-pos.apk.
# Needs JDK 17+, the Android SDK, and .env.local with EXPO_PUBLIC_SUPABASE_*. Usage: npm run build:apk [-- --skip-checks]
set -eu
cd "$(dirname "$0")/.."

[ -f .env.local ] || [ -f .env ] || { echo "No .env.local: the app would be built without Supabase settings." >&2; exit 1; }
command -v java >/dev/null || { echo "java not found: install a JDK." >&2; exit 1; }
grep -qs '^HERMES_UPLOAD_STORE_FILE' "$HOME/.gradle/gradle.properties" ||
  echo "WARNING: no release key (HERMES_UPLOAD_* in ~/.gradle/gradle.properties). The APK will be signed with the debug key and cannot update the live app." >&2

if [ "${1:-}" != "--skip-checks" ]; then
  npm run -s typecheck
  npm run -s test:js >/dev/null
fi

(cd android && ./gradlew assembleRelease)

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/hermes-pos.apk
ls -lh dist/hermes-pos.apk | awk '{print $5, $9}'
sha256sum dist/hermes-pos.apk
