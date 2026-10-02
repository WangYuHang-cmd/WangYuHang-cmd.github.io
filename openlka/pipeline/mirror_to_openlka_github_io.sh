#!/usr/bin/env bash
# Mirror the OpenLKA project page (openlka/) into the OpenLKA.github.io repo so that
# https://openlka.github.io/ serves the same page at its root.
#
#   openlka/index.html        -> <dest>/index.html   (links rewritten, see below)
#   openlka/static/           -> <dest>/static/      (rsync --delete)
#   images/th_<family>.jpg    -> <dest>/images/      (dataset-family thumbnails)
#   .nojekyll                                          (serve files as-is)
#
# Rewrites applied to the copied index.html:
#   * root-relative links to the personal site (href="/…", except /images/) -> https://wangyuhang-cmd.github.io/…
#   * canonical / og:url / og:image / twitter:image / JSON-LD url + license -> https://openlka.github.io/…
#   * "Data portal" buttons / footer "Portal" link -> the project page on the personal site
#
# Usage: openlka/pipeline/mirror_to_openlka_github_io.sh [dest]   (default dest: ~/Desktop/OpenLKA.github.io)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"            # personal-site repo root
DEST="${1:-$HOME/Desktop/OpenLKA.github.io}"
PERSONAL="https://wangyuhang-cmd.github.io"
MIRROR="https://openlka.github.io"

[ -f "$SRC/openlka/index.html" ] || { echo "source page not found under $SRC/openlka" >&2; exit 1; }
[ -d "$DEST/.git" ] || { echo "destination $DEST is not a git repo" >&2; exit 1; }

mkdir -p "$DEST/images"
rsync -a --delete "$SRC/openlka/static/" "$DEST/static/"
for f in adasto baton drivedna drivemotion vlalert tridrive; do
  cp -f "$SRC/images/th_$f.jpg" "$DEST/images/th_$f.jpg"
done
touch "$DEST/.nojekyll"

python3 - "$SRC/openlka/index.html" "$DEST/index.html" "$PERSONAL" "$MIRROR" <<'EOF'
import re, sys
src, dst, personal, mirror = sys.argv[1:5]
html = open(src, encoding="utf8").read()

# 1. site navigation / family cards / footer: root-relative -> absolute personal-site URLs (keep /images/, copied locally)
html = re.sub(r'href="/(?!images/)', 'href="' + personal + '/', html)

# 2. this copy is the canonical home of the dataset page
html = html.replace('<link rel="canonical" href="%s/openlka/">' % personal, '<link rel="canonical" href="%s/">' % mirror)
html = html.replace('<meta property="og:url" content="%s/openlka/">' % personal, '<meta property="og:url" content="%s/">' % mirror)
html = html.replace('content="%s/openlka/static/images/olka_og.jpg"' % personal, 'content="%s/static/images/olka_og.jpg"' % mirror)
html = html.replace('"url":"%s/openlka/"' % personal, '"url":"%s/"' % mirror)
html = html.replace('"license":"%s/openlka/#access-terms"' % personal, '"license":"%s/#access-terms"' % mirror)

# 3. the mirror is the dataset's own site: brand reads "OpenLKA" and jumps to the top of this page
html = html.replace('<a class="lk-brand" href="%s/">Yuhang <b>Wang</b></a>' % personal,
                    '<a class="lk-brand" href="#top">Open<b>LKA</b></a>')

# 4. buttons that pointed at the portal now point back at the personal project page
html = html.replace(
    '<a class="btn" href="%s/" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="#i-ext"/></svg>Data portal</a>' % mirror,
    '<a class="btn" href="%s/openlka/" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="#i-ext"/></svg>Project page</a>' % personal)
html = html.replace('<a href="%s/" target="_blank" rel="noopener">Portal</a>' % mirror,
                    '<a href="%s/openlka/" target="_blank" rel="noopener">Project page</a>' % personal)

open(dst, "w", encoding="utf8").write(html)
left = re.findall(r'href="/(?!images/)[^"]*"', html)
print("mirrored index.html (%d bytes); remaining root-relative links: %s" % (len(html), left or "none"))
EOF

echo "static/: $(du -sh "$DEST/static" | cut -f1) · images/: $(ls "$DEST/images" | wc -l) files"
