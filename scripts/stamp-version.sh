#!/usr/bin/env bash
# Sets every ?v= (in both html files and the imports in the js) to a hash of the CSS and JS,
# so browsers fetch new copies whenever they change, and keep their cached ones when they don't.
# The ?v= bits themselves are left out of the hash, or stamping would change it every time.
#
#   scripts/stamp-version.sh           stamps the files as they are
#   scripts/stamp-version.sh --staged  stamps what's staged for the next commit (the pre-commit hook does this),
#                                      and the same ?v= in the working files, leaving anything else unstaged alone
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

strip='s/\.(js|css)\?v=[0-9a-z]*/.\1/g'
# The top-level JS files. For a commit, only ones that are in it; otherwise new ones too
if [[ "${1:-}" == "--staged" ]]; then
    assets=(style.css $(git ls-files --cached -- '*.js' ':!:*/*'))
else
    assets=(style.css $(git ls-files --cached --others --exclude-standard -- '*.js' ':!:*/*'))
fi
stamped=(index.html info/index.html "${assets[@]:1}")

if [[ "${1:-}" == "--staged" ]]; then
    version=$(for f in "${assets[@]}"; do git show ":$f"; done | sed -E "$strip" | sha1sum | cut -c1-8)
    for f in "${stamped[@]}"; do
        mode=$(git ls-files --stage -- "$f" | cut -d' ' -f1)
        blob=$(git show ":$f" | sed -E "s/\.(js|css)\?v=[0-9a-z]*/.\1?v=${version}/g" | git hash-object -w --stdin)
        git update-index --cacheinfo "$mode,$blob,$f"
        sed -i -E "s/\.(js|css)\?v=[0-9a-z]*/.\1?v=${version}/g" "$f"
    done
else
    version=$(sed -E "$strip" "${assets[@]}" | sha1sum | cut -c1-8)
    sed -i -E "s/\.(js|css)\?v=[0-9a-z]*/.\1?v=${version}/g" "${stamped[@]}"
fi
echo "$version"
