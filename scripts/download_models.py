"""Download pinned YuE2 repositories with resumable transfers and SHA-256 checks."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STATUS = ROOT / "model-download-status.json"
REPOS = {
    "m-a-p/YuE2-3B": "29b3558dd46954a0cd9021dc76d5c91864a0f1c7",
    "m-a-p/YuE2-Vae": "9a94e1d0ea9f8087e98f77fa88df4a4068104d2a",
    "m-a-p/YuE2-Vae-legacy": "5ddd12f79acb90d24b3a672dcd2ebf88da7c92a9",
    "audio-cpp/Yue2-3B-GGUF": "9c31f1c64f73d36799693aa89295b410c76928c3",
    # audio.cpp-gguf hosts 60+ unrelated model families in one repo; "prefixes" keeps
    # this to just the packages SongYUE2 uses (HTDemucs for the 4-way vocals/drums/
    # bass/other stem split, Mel-Band RoFormer for the cleaner 2-way vocals/instrumental
    # split, AudioSR for the "음원 복원" low-quality audio restoration feature, MuScriptor
    # for "MIDI로 내보내기", Seed-VC and Vevo2 -- two alternative engines -- for the
    # "보컬 음색 변환" singing voice conversion feature), instead of pulling everything
    # in the repo.
    "audio-cpp/audio.cpp-gguf": {
        "revision": "6d5436fc85f7a20c2e9f4e472b7f3a532f686444",
        "prefixes": [
            "HTDemucs-GGUF/htdemucs-q8_0.gguf",
            "Mel-Band-RoFormer-GGUF/mel-band-roformer-f16.gguf",
            "AudioSR-GGUF/audiosr-basic-f32.gguf",
            "MuScriptor-Small-GGUF/muscriptor-small-f32.gguf",
            "SeedVC-MLX-GGUF/seed-vc-mlx-q8_0.gguf",
            "Vevo2-GGUF/vevo2-q8_0.gguf",
        ],
    },
}
LOCK = threading.RLock()
manifest = {}


def persist():
    with LOCK:
        for repo in manifest["repositories"]:
            repo["completedBytes"] = sum(f["completedBytes"] for f in repo["files"])
            states = {f["state"] for f in repo["files"]}
            repo["state"] = "complete" if states == {"complete"} else "error" if "error" in states else "downloading"
        manifest["completedBytes"] = sum(r["completedBytes"] for r in manifest["repositories"])
        states = {r["state"] for r in manifest["repositories"]}
        manifest["state"] = "complete" if states == {"complete"} else "error" if "error" in states else "downloading"
        manifest["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        temporary = STATUS.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, STATUS)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def download(repo, entry):
    target = ROOT / repo["path"] / entry["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    try:
        if target.exists() and target.stat().st_size == entry["size"]:
            actual = digest(target)
            if not entry["sha256"] or actual == entry["sha256"]:
                entry.update(state="complete", completedBytes=entry["size"], sha256=actual)
                persist()
                return
        url = f"https://huggingface.co/{repo['id']}/resolve/{repo['revision']}/{entry['path']}?download=true"
        for attempt in range(8):
            try:
                offset = partial.stat().st_size if partial.exists() else 0
                entry.update(state="downloading", completedBytes=offset)
                persist()
                if offset < entry["size"]:
                    request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-"} if offset else {})
                    with urllib.request.urlopen(request, timeout=90) as response:
                        if offset and response.status != 206:
                            offset = 0
                        with partial.open("ab" if offset else "wb") as stream:
                            previous = time.monotonic()
                            while chunk := response.read(4 * 1024 * 1024):
                                stream.write(chunk)
                                offset += len(chunk)
                                entry["completedBytes"] = offset
                                if time.monotonic() - previous > 2:
                                    persist()
                                    previous = time.monotonic()
                if partial.stat().st_size != entry["size"]:
                    raise ValueError("Downloaded size does not match pinned metadata")
                entry["state"] = "verifying"
                persist()
                actual = digest(partial)
                if entry["sha256"] and actual != entry["sha256"]:
                    partial.rename(partial.with_name(partial.name + f".invalid-{int(time.time())}"))
                    raise ValueError("SHA-256 mismatch; invalid transfer retained for inspection")
                os.replace(partial, target)
                entry.update(state="complete", completedBytes=entry["size"], sha256=actual)
                entry.pop("error", None)
                persist()
                print(f"COMPLETE {repo['id']}/{entry['path']}", flush=True)
                return
            except Exception as error:
                entry["error"] = f"{type(error).__name__}: {str(error).split('?')[0]}"
                persist()
                if attempt == 7:
                    raise
                time.sleep(min(2 ** attempt, 30))
    except Exception as error:
        entry["state"] = "error"
        entry["error"] = f"{type(error).__name__}: {str(error).split('?')[0]}"
        persist()
        print(f"FAILED {repo['id']}/{entry['path']}: {entry['error']}", flush=True)


def main():
    global manifest
    repositories = []
    for repo_id, spec in REPOS.items():
        revision, prefixes = (spec, None) if isinstance(spec, str) else (spec["revision"], spec.get("prefixes"))
        with urllib.request.urlopen(f"https://huggingface.co/api/models/{repo_id}/revision/{revision}?blobs=true", timeout=60) as response:
            metadata = json.load(response)
        files = []
        for item in metadata["siblings"]:
            name = item["rfilename"]
            if name.startswith("assets/") or name.lower().endswith((".wav", ".mp3", ".mp4")) or "0.1.3-py3" in name:
                continue
            if prefixes and not any(name.startswith(prefix) for prefix in prefixes):
                continue
            files.append({"path": name, "size": item["size"], "sha256": item.get("lfs", {}).get("sha256"), "state": "pending", "completedBytes": 0})
        repositories.append({"id": repo_id, "revision": revision, "path": "models/" + repo_id, "state": "pending", "totalBytes": sum(f["size"] for f in files), "completedBytes": 0, "files": files})
    manifest = {"schemaVersion": 1, "updatedAt": "", "state": "downloading", "totalBytes": sum(r["totalBytes"] for r in repositories), "completedBytes": 0, "repositories": repositories}
    persist()
    print(f"TOTAL {manifest['totalBytes']} bytes", flush=True)
    jobs = [(repo, entry) for repo in repositories for entry in repo["files"]]
    jobs.sort(key=lambda job: job[1]["size"])
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda job: download(*job), jobs))
    persist()
    print(f"FINISHED {manifest['state']}", flush=True)
    raise SystemExit(0 if manifest["state"] == "complete" else 1)


if __name__ == "__main__":
    main()
