import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# station/ and cloud/ are plain script folders (deployed as they are), not packages
for folder in ("station", "cloud"):
    sys.path.insert(0, str(ROOT / folder))
