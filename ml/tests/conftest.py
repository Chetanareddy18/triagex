import os
import sys
from pathlib import Path

os.environ.setdefault("EMBEDDING_BACKEND", "hashing")
os.environ.setdefault("EMBEDDING_WARMUP", "false")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
