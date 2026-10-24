"""Download/resume the team's exact Gemma Q4 weights and verify the complete SHA-256."""
import argparse
from hashlib import sha256
from pathlib import Path
from urllib.request import Request, urlopen

REPOSITORY = "yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF"
NAME = "gemma4-v2-Q4_K_M.gguf"
SHA256 = "0b9506cab36f7f818e34f9c0f5a3d6568d0b37100f3a3e1092e2eec3c4c96791"
SIZE = 7381381664
WEIGHTS = Path(__file__).resolve().parent.parent / "scr/delo_za_malyn/Models/Llm/weights" / NAME

def verify(path=WEIGHTS, expected_hash=SHA256, expected_size=SIZE):
    if not path.is_file() or path.stat().st_size != expected_size:
        raise ValueError(f"Missing or incomplete Gemma weights: {path}. Run python -m scripts.gemma_weights")
    with path.open("rb") as stream:
        digest = sha256()
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected_hash:
        raise ValueError(f"Gemma SHA-256 mismatch: {path}. The file was not imported.")
    return digest.hexdigest()

def download(path=WEIGHTS):
    if path.exists():
        return verify(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset < SIZE:
        request = Request(f"https://huggingface.co/{REPOSITORY}/resolve/main/{NAME}", headers={"Range": f"bytes={offset}-"} if offset else {})
        with urlopen(request, timeout=90) as response:
            # Some hosts ignore Range. Restart the partial file rather than appending a second copy.
            resume = offset and response.status == 206
            if resume and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                raise ValueError("Unexpected download range; partial weights were preserved.")
            with partial.open("ab" if resume else "wb") as stream:
                for block in iter(lambda: response.read(4 * 1024 * 1024), b""):
                    stream.write(block)
    digest = verify(partial)
    partial.replace(path)
    return digest

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify the local file without downloading anything.")
    args = parser.parse_args()
    print(f"Gemma verified: {verify() if args.check else download()}")

if __name__ == "__main__":
    main()
