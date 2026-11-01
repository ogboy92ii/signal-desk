"""Download the CI-built signal_desk.wasm and verify it before it is published.

Usage: python scripts/verify_release.py <commit sha> [--repo owner/name]

Every check must pass, or nothing is printed as publishable. The binary is never executed:
it is only read, hashed and scanned. It lands in a new, empty directory of its own.

Checks:
  1. the CI run for this exact commit succeeded (every job, including reproduce and supply-chain);
  2. the download holds exactly signal_desk.wasm and signal_desk.wasm.sha256;
  3. the sha256 of the file equals the recorded one;
  4. a Sigstore-signed SLSA provenance attestation binds this exact file to this repository,
     this workflow and this commit, built on a GitHub-hosted runner;
  5. the file is a WebAssembly module (magic and version);
  6. its size is plausible for this template;
  7. it carries no personal or secret data (scripts/scan_binary.py).
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from scan_binary import scan  # noqa: E402

WORKFLOW = ".github/workflows/ci.yml"
MAX_SIZE = 1_000_000


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def shown(path):
    """The path with the home directory replaced by ~, so the output never shows the user name."""
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path.startswith(home) else path


def fail(step, why):
    print(f"ECHEC {step} : {why}")
    print("=> NE PAS PUBLIER")
    sys.exit(1)


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        print(__doc__)
        sys.exit(2)
    commit = args[0]
    repo = args[args.index("--repo") + 1] if "--repo" in args else "ogboy92ii/signal-desk"
    if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
        fail("0", "il faut le sha complet du commit (40 caractères hexadécimaux)")

    # 1. The CI run for this commit, all jobs green.
    code, out, err = gh("run", "list", "--repo", repo, "--commit", commit, "--workflow", "ci.yml",
                        "--json", "databaseId,status,conclusion,event", "--limit", "5")
    if code != 0:
        fail("1", "gh run list a échoué")
    runs = [r for r in json.loads(out) if r["event"] == "push"]
    if not runs:
        fail("1", "aucun run CI de type push pour ce commit")
    run = runs[0]
    if run["status"] != "completed" or run["conclusion"] != "success":
        fail("1", f"run {run['databaseId']} : {run['status']} / {run['conclusion']}")
    code, out, err = gh("run", "view", str(run["databaseId"]), "--repo", repo, "--json", "jobs")
    jobs = {j["name"]: j["conclusion"] for j in json.loads(out)["jobs"]}
    for needed in ("build", "reproduce", "supply-chain", "end-to-end", "tari-lint"):
        if jobs.get(needed) != "success":
            fail("1", f"job {needed} : {jobs.get(needed)}")
    print(f"OK 1 : run {run['databaseId']}, tous les jobs verts ({', '.join(sorted(jobs))})")

    # 2. Download into a fresh, empty directory.
    dest = tempfile.mkdtemp(prefix="signal_desk_release_")
    code, out, err = gh("run", "download", str(run["databaseId"]), "--repo", repo,
                        "--name", f"signal_desk-{commit}", "--dir", dest)
    if code != 0:
        fail("2", "téléchargement de l'artefact impossible")
    files = sorted(os.listdir(dest))
    if files != ["signal_desk.wasm", "signal_desk.wasm.sha256"]:
        fail("2", f"contenu inattendu : {files}")
    wasm_path = os.path.join(dest, "signal_desk.wasm")
    data = open(wasm_path, "rb").read()
    print(f"OK 2 : artefact téléchargé dans {shown(dest)} (2 fichiers attendus, rien d'autre)")

    # 3. Hash matches the recorded one.
    digest = hashlib.sha256(data).hexdigest()
    recorded = open(os.path.join(dest, "signal_desk.wasm.sha256"), encoding="ascii").read().split()[0]
    if digest != recorded:
        fail("3", "le sha256 du fichier ne correspond pas à celui enregistré par la CI")
    print(f"OK 3 : sha256 {digest}")

    # 4. Signed provenance: this file, this repo, this workflow, this commit, hosted runner.
    code, out, err = gh("attestation", "verify", wasm_path, "--repo", repo,
                        "--signer-workflow", f"{repo}/{WORKFLOW}",
                        "--source-digest", commit,
                        "--deny-self-hosted-runners", "--format", "json")
    if code != 0:
        fail("4", "attestation absente ou invalide")
    print("OK 4 : attestation Sigstore vérifiée (dépôt, workflow, commit, runner GitHub)")

    # 5. WebAssembly magic and version.
    if data[:8] != b"\x00asm\x01\x00\x00\x00":
        fail("5", "ce n'est pas un module WebAssembly version 1")
    print("OK 5 : module WebAssembly v1")

    # 6. Size.
    if not 10_000 < len(data) < MAX_SIZE:
        fail("6", f"taille anormale : {len(data)} octets")
    print(f"OK 6 : {len(data)} octets")

    # 7. No personal or secret data.
    found, scanned = scan(data)
    if any(found.values()):
        fail("7", "données sensibles détectées : " + ", ".join(k for k, v in found.items() if v))
    print(f"OK 7 : {scanned} chaînes analysées, 0 donnée sensible")

    print()
    print("TOUS LES CONTROLES PASSENT. Fichier vérifié :")
    print(f"  {shown(wasm_path)}")
    print(f"  sha256 {digest}")
    print("La publication reste soumise à l'accord explicite de Soufian.")


if __name__ == "__main__":
    main()
