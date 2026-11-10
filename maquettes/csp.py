"""Recompute the Content-Security-Policy of every page of the site and write it twice.

Usage: python -I csp.py

Every inline <script> (classic, module and importmap) is allowed by the sha256 of its exact content,
so any edit to a script changes the policy: run this after each change. The policy is written as a
<meta> tag in the page (works on any host) and as HTTP headers in vercel.json (adds what a <meta>
cannot do: frame-ancestors, nosniff, HSTS…).
"""

import base64
import hashlib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = [os.path.join(HERE, n) for n in ("site-signal-desk.html", "classement.html", "pronostics.html", "profil.html", "en-direct.html", "marches.html", "ligues.html", "communaute.html") if os.path.exists(os.path.join(HERE, n))]

# One policy for the whole site (vercel.json applies it to every path): the union of all inline scripts.
inline = [c for page in PAGES for c in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", open(page, encoding="utf-8").read(), flags=re.S)]
hashes = sorted({"'sha256-" + base64.b64encode(hashlib.sha256(c.encode("utf-8")).digest()).decode() + "'" for c in inline})

base = [
    "default-src 'none'",
    # 'wasm-unsafe-eval' : compiler le décodeur CBOR de Tari (vendor/ootle-wasm-bor), rien d'autre.
    "script-src 'self' 'wasm-unsafe-eval' " + " ".join(hashes),
    "style-src 'self'",
    "img-src 'self' data: blob: https://cdn.bsky.app",
    "font-src 'self'",
    # Bluesky OAuth parle au serveur de chaque utilisateur (hôte inconnu d'avance).
    "connect-src 'self' https:",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
]
meta_policy = "; ".join(base)
header_policy = "; ".join(base + ["frame-ancestors 'none'", "upgrade-insecure-requests"])

tag = f'<meta http-equiv="Content-Security-Policy" content="{meta_policy}">'
for page in PAGES:
    html = open(page, encoding="utf-8").read()
    if '<meta http-equiv="Content-Security-Policy"' in html:
        html = re.sub(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', lambda _: tag, html)
    else:
        html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + tag + '\n<meta name="referrer" content="strict-origin-when-cross-origin">', 1)
    open(page, "w", encoding="utf-8").write(html)

vercel = {
    "cleanUrls": True,
    # Mise en ligne (10/11) : la racine du site affiche l'accueil (il n'y a pas d'index.html).
    "rewrites": [{"source": "/", "destination": "/site-signal-desk"}],
    "headers": [
        {
            "source": "/(.*)",
            "headers": [
                {"key": "Content-Security-Policy", "value": header_policy},
                {"key": "X-Frame-Options", "value": "DENY"},
                {"key": "X-Content-Type-Options", "value": "nosniff"},
                {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"},
                {"key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), browsing-topics=()"},
                {"key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains"},
                {"key": "Cross-Origin-Opener-Policy", "value": "same-origin"},
                {"key": "Cross-Origin-Resource-Policy", "value": "same-origin"},
            ],
        },
        # Cache CDN : les fichiers statiques sont servis par le réseau de Vercel sans repasser par l'origine
        # (charge de 100 000 visiteurs). Pas de « immutable » : les noms de fichiers ne sont pas versionnés.
        {"source": "/(vendor|fonts|img)/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=604800"}]},
        {"source": r"/(.*)\.(js|css)", "headers": [{"key": "Cache-Control", "value": "public, max-age=300, stale-while-revalidate=86400"}]},
        {"source": "/i18n/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=300, stale-while-revalidate=86400"}]},
    ],
}
open(os.path.join(HERE, "vercel.json"), "w", encoding="utf-8").write(json.dumps(vercel, indent=2) + "\n")
print(f"{len(PAGES)} pages, {len(inline)} scripts inline, {len(hashes)} empreintes ; CSP écrite dans les pages et dans vercel.json")
