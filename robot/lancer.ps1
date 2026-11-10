# Lance les robots Signal Desk en processus Windows indépendants (ils survivent à la fermeture du terminal).
# Usage : powershell -NoProfile -File robot\lancer.ps1        (un robot déjà actif n'est pas relancé)
# Journaux : robot\run-<nom>.log (sortie) et robot\run-<nom>.err (erreurs).
# Prérequis : le wallet daemon testnet tourne (jour-j\jourj.sh start, NET=esmeralda BASE=~/.tari/ootle049).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$robots = @(
  # 10/11 (Soufian) : les robots ne servent plus qu'à la démonstration visible. L'ouvreur est inutile (le site lit les
  # copies verrouillées sans transaction) et l'annonceur ne produit que des brouillons : ils ne sont plus lancés.
  # @{ nom = 'ouvreur';   script = 'ouvreur.cjs';   env = @{} },
  # @{ nom = 'annonceur'; script = 'annonceur.cjs'; env = @{} },
  @{ nom = 'ligue';     script = 'ligue.cjs';     env = @{} },
  @{ nom = 'signalbot'; script = 'signalbot.cjs'; env = @{} },
  @{ nom = 'signalbot-range'; script = 'signalbot.cjs'; env = @{ SD_BOT = 'range'; SD_ACCOUNT = 'bot-range'; SD_ACCOUNT_ADDR = 'component_efefeb2a4ce17947e8f600910f0be9917874320ffd834a97b8260282c7b7b905' } },
  @{ nom = 'signalbot-breakout'; script = 'signalbot.cjs'; env = @{ SD_BOT = 'breakout'; SD_ACCOUNT = 'bot-breakout'; SD_ACCOUNT_ADDR = 'component_8e308fb02ce221a5db1d4fbeb355b4ea68ad841c2564a10f8b7d8385d7e5a77b' } },
  @{ nom = 'signalbot-sport'; script = 'signalbot.cjs'; env = @{ SD_BOT = 'sport'; SD_ACCOUNT = 'bot-sport'; SD_ACCOUNT_ADDR = 'component_417c76ef9966dc10f928913eed0174df6a436951b1dba26620143a6171deac9c' } }
)
$actifs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'robot' }
foreach ($r in $robots) {
  # La ligne de commande ne contient pas les variables d'environnement : on marque chaque robot par un argument --tag.
  $deja = $actifs | Where-Object { $_.CommandLine -match "--tag=$($r.nom)(\s|$)" }
  if ($deja) { "$($r.nom) : déjà actif (pid $($deja.ProcessId))"; continue }
  foreach ($k in @('SD_BOT', 'SD_ACCOUNT', 'SD_ACCOUNT_ADDR')) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
  foreach ($k in $r.env.Keys) { Set-Item "env:$k" $r.env[$k] }
  $p = Start-Process -FilePath 'node' -ArgumentList @("`"$dir\$($r.script)`"", "--tag=$($r.nom)") -WorkingDirectory (Split-Path -Parent $dir) `
    -RedirectStandardOutput "$dir\run-$($r.nom).log" -RedirectStandardError "$dir\run-$($r.nom).err" -WindowStyle Hidden -PassThru
  "$($r.nom) : lancé (pid $($p.Id))"
}
foreach ($k in @('SD_BOT', 'SD_ACCOUNT', 'SD_ACCOUNT_ADDR')) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
