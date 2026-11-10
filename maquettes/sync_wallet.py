"""Recopie le wallet de l'accueil (bouton du compte, volet, fenêtre d'achat, toast) sur les autres pages.

Usage : python -I sync_wallet.py   (puis python -I csp.py)

L'accueil (site-signal-desk.html) fait foi. Sur chaque autre page, on remplace :
- la ligne du bouton du compte (class="walletdock") et celle du message « aucun wallet » (id="nowallet") ;
- le bloc qui va de <div class="toast" id="toast" jusqu'à </aside> (volet).
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = ["classement.html", "pronostics.html", "profil.html", "en-direct.html", "marches.html", "ligues.html", "communaute.html"]

home = open(os.path.join(HERE, "site-signal-desk.html"), encoding="utf-8").read()
lines = home.split("\n")
dock = next(l for l in lines if 'class="walletdock"' in l)
nowallet = next(l for l in lines if 'id="nowallet"' in l)
a = home.index('<div class="toast" id="toast"')
b = home.index("</aside>\n", a) + len("</aside>\n")
panel = home[a:b]

for name in PAGES:
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        continue
    s = open(path, encoding="utf-8").read()
    out = []
    for l in s.split("\n"):
        if 'class="walletdock"' in l:
            l = dock
        elif 'id="nowallet"' in l:
            l = nowallet
        out.append(l)
    s = "\n".join(out)
    i = s.index('<div class="toast" id="toast"')
    j = s.index("</aside>\n", i) + len("</aside>\n")
    s = s[:i] + panel + s[j:]
    open(path, "w", encoding="utf-8", newline="").write(s)
    print("synchronisé :", name)
