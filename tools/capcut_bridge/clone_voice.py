from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from vieneu import Vieneu


def main() -> None:
    parser = argparse.ArgumentParser(description="Enroll an authorized reference clip as a local VieNeu voice.")
    parser.add_argument("reference", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", default="Custom local voice")
    parser.add_argument("--gender", default="")
    parser.add_argument("--style", default="doc_truyen", choices=["tu_nhien", "tin_tuc", "doc_truyen"])
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "custom_voices.json")
    args = parser.parse_args()
    if not args.reference.is_file():
        raise SystemExit(f"Reference audio not found: {args.reference}")

    engine = Vieneu(mode="v3turbo", backend="onnx", device="cpu")
    engine.add_voice(
        args.name,
        args.reference,
        description=args.description,
        gender=args.gender,
        style=args.style,
        save=False,
    )
    voice = engine._preset_voices[args.name]
    data = {"meta": {"note": "User-authorized local VieNeu custom voices"}, "presets": {}}
    if args.output.exists():
        data = json.loads(args.output.read_text("utf-8"))
        data.setdefault("presets", {})
    data["presets"][args.name] = {
        "description": args.description,
        "gender": args.gender,
        "style": args.style,
        "speaker_emb": [round(float(value), 6) for value in np.asarray(voice["speaker_emb"]).reshape(-1)],
        "codes": None if voice.get("codes") is None else np.asarray(voice["codes"], dtype=int).tolist(),
    }
    args.output.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"Saved custom voice '{args.name}' to {args.output}")


if __name__ == "__main__":
    main()
