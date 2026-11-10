"""Écrit la barre de commande (navigation N1, choisie le 02/11) sur toutes les pages.

Usage : python -I sync_nav.py   (puis python -I sync_wallet.py et python -I csp.py)

Remplace le bloc <nav>…</nav> de chaque page. Le bouton du wallet (class="walletdock") et le message
« aucun wallet » (id="nowallet") sont repris tels quels de chaque page, et le sélecteur de langue
(id="langdock") est déplacé dans la barre. Le lien de la page courante est marqué actif.
"""

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = "site-signal-desk.html"
PAGES = [HOME, "classement.html", "pronostics.html", "profil.html", "en-direct.html", "marches.html", "ligues.html", "communaute.html"]

ICON = {
    "search": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    "plus": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    "bell": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
}


def nav_html(page, dock, nowallet, lang):
    home = "" if page == HOME else HOME
    active = {
        HOME: "home", "classement.html": "rank", "pronostics.html": "prono",
        "profil.html": "", "en-direct.html": "live", "marches.html": "comm", "ligues.html": "league", "communaute.html": "comm",
    }[page]
    cats = [
        ("home", home or "#", "Accueil", ""),
        ("live", "en-direct.html", "En direct", '<span class="cmd-live" aria-hidden="true"></span>'),
        ("rank", "classement.html", "Classement", ""),
        ("prono", "pronostics.html", "Pronostics", ""),
        ("league", "ligues.html", "Ligues", ""),
        ("comm", "communaute.html", "Communauté", ""),
    ]
    links = []
    for key, href, label, pre in cats:
        on = ' class="on" aria-current="page"' if key == active else ""
        cnt = f'<span class="cnt" data-cnt="{key}"></span>' if key in ("live", "prono") else ""
        links.append(f'<a href="{href}"{on}>{pre}{label}{cnt}</a>')
    pairs = "".join(f'<a class="cmd-mk {c}" href="marches.html?c={c}">{label}</a>' for c, label in (("crypto", "Crypto"), ("sport", "Sport"), ("pol", "Politique")))
    # Liens d'aide : groupés à droite, plus discrets que les sections du produit.
    more = (f'<span class="cmd-help" role="group" aria-label="Aide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>'
            f'<a href="{home}#comment">Comment ça marche</a><a href="{home}#verifier">Vérifier</a><a href="{home}#faq">FAQ</a></span>')
    return f"""<nav class="sdnav" aria-label="Navigation principale">
  <div class="cmd-row">
  <a class="brand" href="{HOME}"><span class="mk"><svg><use href="#mark"/></svg></span><span class="bt">Signal Desk</span></a>
  <div class="cmd-search" role="search"><label class="cmd-q">{ICON["search"]}<span class="sr">Rechercher</span><input id="cmd-q" type="search" placeholder="Rechercher un caller, une paire, une ligue…" autocomplete="off" spellcheck="false" aria-controls="cmd-res" aria-expanded="false" aria-autocomplete="list"><kbd>Ctrl K</kbd></label><div class="cmd-res" id="cmd-res" role="listbox" aria-label="Résultats" hidden></div></div>
  <div class="cmd-acts">
    <div class="cmd-create"><button type="button" class="cmd-cbtn" id="cmd-cbtn" aria-haspopup="menu" aria-expanded="false" aria-controls="cmd-menu">{ICON["plus"]}<span>Créer</span></button>
      <div class="cmd-menu" id="cmd-menu" role="menu" hidden><a role="menuitem" href="#sceller"><i aria-hidden="true">◆</i><b>Sceller un call</b><small>Votre analyse, scellée avant le marché</small></a><a role="menuitem" href="pronostics.html"><i aria-hidden="true">◎</i><b>Faire un pronostic</b><small>Gratuit, ouvert à l'échéance</small></a><a role="menuitem" href="ligues.html"><i aria-hidden="true">♛</i><b>Créer une ligue</b><small>Entre amis, classement on-chain</small></a></div></div>
    <div class="cmd-notif"><button type="button" class="cmd-bell" id="cmd-bell" aria-haspopup="dialog" aria-expanded="false" aria-controls="cmd-panel" aria-label="Notifications">{ICON["bell"]}<b id="cmd-cnt" hidden></b></button>
      <div class="cmd-panel" id="cmd-panel" role="dialog" aria-label="Notifications" hidden><div class="cmd-ph"><b>Notifications</b><a href="en-direct.html?f=follow">Tout voir</a></div><ol class="cmd-feed" id="cmd-feed"></ol></div></div>
{dock}
{nowallet}
{lang}
  </div>
  </div>
  <div class="cmd-cats">{"".join(links)}{more}</div>
</nav>"""


for name in PAGES:
    path = os.path.join(HERE, name)
    s = open(path, encoding="utf-8").read()
    dock = next(l for l in s.split("\n") if 'class="walletdock"' in l)
    nowallet = next(l for l in s.split("\n") if 'id="nowallet"' in l)
    # Le sélecteur de langue : bloc <div class="langdock" id="langdock"> … </div> (déjà dans la barre ou à part).
    m = re.search(r'[ \t]*<div class="langdock" id="langdock">.*?</ul>\s*</div>\n?', s, flags=re.S)
    if not m:
        raise SystemExit(f"{name} : sélecteur de langue introuvable")
    lang = m.group(0).rstrip("\n")
    s = s[:m.start()] + s[m.end():]
    a, b = s.index("<nav"), s.index("</nav>") + len("</nav>")
    s = s[:a] + nav_html(name, dock, nowallet, lang) + s[b:]
    open(path, "w", encoding="utf-8", newline="").write(s)
    print("barre écrite :", name)
