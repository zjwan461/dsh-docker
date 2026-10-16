#!/usr/bin/env python3
"""S2「渡江」重做：把船上的兵加回来（用户 2026-10-15 更正）。

问题：`E2v2` 那一步把人和火把旗子一起清掉了，结果「八千兵渡江」拍成了无人空船，
与本镜旁白「一个人带着八千兵渡过了长江」直接矛盾。**清场清过头，是叙事错误。**

本次只修这一处：
  · 保留 `E2v2` 已批准的晨雾冷灰调、构图、地平线、三条船的位置
  · 每船加两三个划桨的黑衣兵，低伏剪影，桨在水里
  · 火把／旗／烟仍然不要（原设计「刻意的安静」保留），但**不再负面掉 people**

派生素材：`E2v2_1.png`（当前成片用的静帧）→ `E2v3_N.png`
"""
import base64
import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from imgmcp import rpc  # noqa: E402

OUT = ROOT / "refs" / "stills"

NEG_BASE = (
    "glossy CG, plastic skin, airbrushed, anime, cartoon, illustration, 3D render, "
    "oversaturated color, HDR, text, watermark, signature, calligraphy, "
    "Chinese characters, seals, border, frame, modern clothing, modern objects, gore, blood"
)
EURO_NEG = (
    ", European architecture, castle, turret, stone keep, green grass, meadow, pine forest, "
    "Norwegian fjord, alpine, wooden fence, cobblestone road, modern"
)
# 注意：这里**不能**再负面掉 people/person —— 那正是上一轮的错误
CREW_NEG = (
    ", torch, fire, flame, smoke, banner, flag, burning, "
    "shirtless, bare skin, bare arms, naked torso, undressed, bright clothing, "
    "colorful clothing, standing man, standing figure, face, portrait, close-up face, "
    "large foreground figures, giant figures, oars raised out of the water, "
    "empty boat, unmanned boat, sail, sailboat, crowd on the near bank"
)

JOBS = {
    "E2v3": {
        "src": "refs/stills/E2v2_1.png",
        "prompt": (
            "Keep this exact river, the same three wooden boats in the same positions, the "
            "same far shoreline, the same pale sun through heavy mist, and the exact same "
            "desaturated lead-grey, low-contrast, heavy-atmosphere look with 35mm film grain. "
            "Now put the crews back into the boats. In each of the boats two or three men, "
            "wearing dark heavy cloaks and dark cloth caps, sit low and hunched on the "
            "benches, shoulders down, heads slightly bowed, their faces completely hidden in "
            "shadow. Their hands are on the oars: each boat's two long oars are in the water "
            "mid-stroke, blades submerged, pulling together, trailing small spreading wakes. "
            "The boats ride noticeably lower and heavier, laden with men. Every rower is a "
            "small dark low silhouette seen at this distance — backs, shoulders and heads "
            "only, no skin, no bare arms, no bright clothing, no face turned to the camera. "
            "No torches, no fire, no smoke, no banners, no flags. Nobody stands up, nobody "
            "shouts. Rigidly keep the framing, the horizon line, the scale and the camera "
            "position of the original image."
        ),
        "negative_prompt": NEG_BASE + EURO_NEG + CREW_NEG,
    },
}


def data_url(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def main():
    names = sys.argv[1:] or list(JOBS)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name in names:
        job = JOBS.get(name)
        if not job:
            print("未知任务:", name)
            continue
        print(f"→ {name}（image_edit ← {job['src']}）...", flush=True)
        args = {
            "image_url": data_url(ROOT / job["src"]),
            "prompt": job["prompt"],
            "negative_prompt": job["negative_prompt"],
        }
        resp = rpc("tools/call", {"name": "bailian_image_edit", "arguments": args}, rid=50)
        if resp.get("result", {}).get("isError"):
            print("  失败:", json.dumps(resp, ensure_ascii=False)[:600])
            manifest.append({"id": name, "error": resp})
            continue
        payload = json.loads(resp["result"]["content"][0]["text"])
        urls = payload.get("results", [])
        saved = []
        for i, u in enumerate(urls, 1):
            dest = OUT / f"{name}_{i}.png"
            try:
                with urllib.request.urlopen(u, timeout=180) as r:
                    dest.write_bytes(r.read())
                saved.append(str(dest.relative_to(ROOT)))
            except Exception as e:
                saved.append(f"ERROR {type(e).__name__}: {e}")
        ok = len([s for s in saved if not s.startswith("ERROR")])
        print(f"  完成：{ok}/{len(urls)} 张落盘")
        for s in saved:
            print("   ", s)
        manifest.append({
            "id": name, "source": job["src"], "tool": "bailian_image_edit",
            "prompt": job["prompt"], "negative_prompt": job["negative_prompt"],
            "request_id": payload.get("request_id"), "saved": saved,
        })

    mf = OUT / f"s2crew_{datetime.now():%Y%m%d_%H%M%S}.json"
    mf.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print("\n清单:", mf.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())