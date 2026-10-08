"""Download the UCI "Incident management process enriched event log" dataset (id 498).

Source: https://archive.ics.uci.edu/dataset/498/incident+management+process+enriched+event+log
Licence: CC BY 4.0 (Amaral, C., Fantinato, M., & Peres, S. M., 2018).

Usage:
    python ml/scripts/download_data.py            # writes data/raw/incident_event_log.csv
    python ml/scripts/download_data.py --force    # re-download
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

URL = "https://archive.ics.uci.edu/static/public/498/incident+management+process+enriched+event+log.zip"
ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
CSV_NAME = "incident_event_log.csv"


def download(force: bool = False) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    target = RAW_DIR / CSV_NAME
    if target.exists() and not force:
        print(f"[skip] {target} already exists ({target.stat().st_size:,} bytes)")
        return target

    print(f"[get] {URL}")
    with urllib.request.urlopen(URL, timeout=120) as resp:  # noqa: S310 (fixed https URL)
        payload = resp.read()
    print(f"[ok] {len(payload):,} bytes, sha256={hashlib.sha256(payload).hexdigest()[:16]}...")

    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        if CSV_NAME not in zf.namelist():
            sys.exit(f"unexpected archive contents: {zf.namelist()}")
        with zf.open(CSV_NAME) as src, open(target, "wb") as dst:
            dst.write(src.read())

    print(f"[done] {target} ({target.stat().st_size:,} bytes)")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="re-download even if present")
    download(force=parser.parse_args().force)
