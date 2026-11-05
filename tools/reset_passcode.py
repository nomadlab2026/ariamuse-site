"""Reset the admin panel passcode.

This is the ONLY way to recover a forgotten passcode — the admin panels
deliberately ship without a "forgot the passcode" link, so that nobody who
finds the admin URL can take the panel over.

Two ways this can be needed:

  * You are locked out  -> run this script. It writes the new hash straight
    into data/admin.json on GitHub, so it works without the old passcode.
  * You are logged in    -> use Settings -> Change passcode in the panel.

Usage:
  python tools/reset_passcode.py <github-token> <new-passcode>
  python tools/reset_passcode.py --from-file <new-passcode>

The --from-file form reads the token from "Aria Muse Site token and API.txt"
next to this repository, so the secret never appears in your shell history.

The token needs write access to the repository (repo scope). The new
passcode is never stored — only its SHA-256 hash is.
"""
import base64
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
OWNER = "nomadlab2026"
REPO = "ariamuse-site"
PATH = "data/admin.json"
TOKEN_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "Aria Muse Site token and API.txt")


def api(method, path, token, payload=None):
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "aria-passcode-reset")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read().decode("utf-8")
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"message": body[:300]}
    except Exception as e:
        return 0, {"message": str(e)}


def load_token_from_file():
    """Read the PAT from the local token file so it stays out of shell history."""
    if not os.path.isfile(TOKEN_FILE):
        print("Token file not found:", TOKEN_FILE)
        sys.exit(1)
    with open(TOKEN_FILE, "r", encoding="utf-8", errors="ignore") as f:
        m = re.search(r"ghp_[A-Za-z0-9]+", f.read())
    if not m:
        print("No GitHub PAT (ghp_...) found in", TOKEN_FILE)
        sys.exit(1)
    return m.group(0)


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--from-file":
        token = load_token_from_file()
        new_pass = sys.argv[2]
    elif len(sys.argv) >= 3:
        token = sys.argv[1].strip()
        new_pass = sys.argv[2]
    else:
        print("Usage: reset_passcode.py <github-token> <new-passcode>")
        print("       reset_passcode.py --from-file <new-passcode>")
        sys.exit(1)

    if len(new_pass) < 6:
        print("The passcode needs at least 6 characters.")
        sys.exit(1)

    status, body = api("GET", "/user", token)
    if status != 200:
        print("Token rejected:", body.get("message"))
        sys.exit(1)
    print("Token OK (signed in as %s)" % body.get("login"))

    digest = hashlib.sha256(new_pass.encode("utf-8")).hexdigest()
    payload = json.dumps({"passcode": digest}, indent=2) + "\n"
    encoded = base64.b64encode(payload.encode("utf-8")).decode("ascii")

    status, existing = api(
        "GET", "/repos/%s/%s/contents/%s?ref=main" % (OWNER, REPO, PATH), token)
    if status != 200:
        print("Could not read the current file:", existing.get("message"))
        sys.exit(1)

    status, body = api(
        "PUT", "/repos/%s/%s/contents/%s" % (OWNER, REPO, PATH), token,
        {
            "message": "Reset admin passcode",
            "content": encoded,
            "branch": "main",
            "sha": existing.get("sha"),
        })
    if status not in (200, 201):
        print("Failed:", body.get("message"))
        sys.exit(1)

    print("Passcode reset. Commit %s" % body.get("commit", {}).get("sha", "")[:8])
    print("New passcode: %s" % new_pass)
    print("")
    print("It goes live within a minute or two — GitHub Pages rebuilds on push.")
    print("Then open https://nomadlab.one/admin/ and sign in with it.")
    print("")
    print("Note: anyone who is still signed in on another device keeps their")
    print("local session until they log out or the browser cache is cleared.")


if __name__ == "__main__":
    main()
