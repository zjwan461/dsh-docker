# -*- coding: utf-8 -*-
"""ComfyUI HTTP 客户端（纯标准库）。让 skill 不依赖任何插件工具。

URL 规则：--base / 环境变量 COMFYUI_BASE 必须是真实 ComfyUI 地址，
由调用方按当前任务核对后传入；本脚本不内置、不替换任何代理地址。

用法:
  python comfy.py --base http://HOST:PORT info [--filter H3]
  python comfy.py --base ... upload --file a.png [--subfolder s]
  python comfy.py --base ... submit --workflow wf.json        # 打印 prompt_id
  python comfy.py --base ... queue
  python comfy.py --base ... status --id PID
  python comfy.py --base ... wait --id PID [--timeout 600]
  python comfy.py --base ... download --id PID [--out DIR]
  python comfy.py --base ... view --filename f.mp4 [--subfolder s] [--type output] --out x.mp4
"""
import argparse, json, os, sys, time, uuid, urllib.request, urllib.error, urllib.parse

def base_url(a):
    b = a.base or os.environ.get("COMFYUI_BASE") or "http://127.0.0.1:8188"
    return b.rstrip("/")

# 本地/局域网 ComfyUI 不能走代理：忽略 HTTP(S)_PROXY 环境变量
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _req(base, method, path, data=None, headers=None, raw=False):
    url = base + path
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with _OPENER.open(req, timeout=120) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise RuntimeError("HTTP %s %s: %s" % (e.code, path, detail[:1500]))
    return body if raw else json.loads(body.decode("utf-8"))

def get(base, path): return _req(base, "GET", path)

def upload(base, file, subfolder="", ftype="input"):
    boundary = uuid.uuid4().hex
    name = os.path.basename(file)
    with open(file, "rb") as f: content = f.read()
    parts = []
    def field(k, v):
        parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (boundary, k, v)).encode())
    field("subfolder", subfolder); field("type", ftype); field("overwrite", "true")
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"image\"; filename=\"%s\"\r\nContent-Type: application/octet-stream\r\n\r\n" % (boundary, name)).encode())
    parts.append(content); parts.append(("\r\n--%s--\r\n" % boundary).encode())
    body = b"".join(parts)
    return _req(base, "POST", "/upload/image", data=body,
                headers={"Content-Type": "multipart/form-data; boundary=%s" % boundary})

def clean(wf):
    """去掉 _comment/_api_config 之类的元数据键，只留真正的节点。"""
    return {k: v for k, v in wf.items()
            if isinstance(v, dict) and "class_type" in v}


def submit(base, wf_path):
    d = json.load(open(wf_path, encoding="utf-8"))
    wf = clean(d.get("prompt", d))
    return _req(base, "POST", "/prompt", data=json.dumps({"prompt": wf, "client_id": uuid.uuid4().hex}).encode(),
                headers={"Content-Type": "application/json"})

def history(base, pid): return get(base, "/history/" + pid)

def wait(base, pid, timeout=600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = history(base, pid)
        if pid in h:
            st = h[pid].get("status", {})
            if h[pid].get("outputs") or st.get("status_str") in ("success", "error"):
                return h[pid]
        time.sleep(4)
    return None

def _files(hist):
    out = []
    for nid, o in (hist.get("outputs") or {}).items():
        for key, items in o.items():
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict) and it.get("filename"):
                        out.append(it)
    return out

def download(base, pid, outdir):
    h = history(base, pid).get(pid, {})
    os.makedirs(outdir, exist_ok=True)
    saved = []
    for it in _files(h):
        q = urllib.parse.urlencode({"filename": it["filename"], "subfolder": it.get("subfolder", ""), "type": it.get("type", "output")})
        data = _req(base, "GET", "/view?" + q, raw=True)
        dst = os.path.join(outdir, it["filename"])
        open(dst, "wb").write(data)
        saved.append(dst)
    return saved

def validate(base, wf_path):
    """只读校验：节点类是否存在、必填输入是否齐全、引用的节点是否存在。不提交任务。"""
    d = json.load(open(wf_path, encoding="utf-8"))
    wf = clean(d.get("prompt", d))
    info = get(base, "/object_info")
    errors = []
    ids = set(wf.keys())
    for nid, node in wf.items():
        if not isinstance(node, dict) or "class_type" not in node:
            errors.append("%s: 缺少 class_type" % nid); continue
        ct = node["class_type"]
        if ct not in info:
            errors.append("%s: 服务器没有节点类 %s" % (nid, ct)); continue
        req = info[ct].get("input", {}).get("required", {}) or {}
        got = node.get("inputs", {}) or {}
        for k in req:
            if k not in got:
                errors.append("%s(%s): 缺必填输入 %s" % (nid, ct, k))
        for k, v in got.items():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                if v[0] not in ids:
                    errors.append("%s(%s): 输入 %s 引用了不存在的节点 %s" % (nid, ct, k, v[0]))
    return errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("info"); p.add_argument("--filter", default="")
    p = sub.add_parser("upload"); p.add_argument("--file", required=True); p.add_argument("--subfolder", default=""); p.add_argument("--type", default="input")
    p = sub.add_parser("submit"); p.add_argument("--workflow", required=True)
    sub.add_parser("queue")
    p = sub.add_parser("status"); p.add_argument("--id", required=True)
    p = sub.add_parser("wait"); p.add_argument("--id", required=True); p.add_argument("--timeout", type=int, default=600)
    p = sub.add_parser("download"); p.add_argument("--id", required=True); p.add_argument("--out", default=".")
    p = sub.add_parser("view"); p.add_argument("--filename", required=True); p.add_argument("--subfolder", default=""); p.add_argument("--type", default="output"); p.add_argument("--out", required=True)
    p = sub.add_parser("validate"); p.add_argument("--workflow", required=True)
    a = ap.parse_args(); b = base_url(a)

    if a.cmd == "validate":
        errs = validate(b, a.workflow)
        print("\n".join(errs) if errs else "OK: %s 可提交" % a.workflow)
        return 0 if not errs else 1

    if a.cmd == "info":
        if a.filter:
            d = get(b, "/object_info/" + urllib.parse.quote(a.filter))
            print(json.dumps(d, ensure_ascii=False)[:4000])
        else:
            d = get(b, "/object_info")
            ns = [k for k in d if not a.filter or a.filter.lower() in k.lower()]
            print("\n".join(ns))
    elif a.cmd == "upload":
        print(json.dumps(upload(b, a.file, a.subfolder, a.type), ensure_ascii=False))
    elif a.cmd == "submit":
        r = submit(b, a.workflow)
        print(json.dumps(r, ensure_ascii=False))
    elif a.cmd == "queue":
        q = get(b, "/queue")
        print("running:", len(q.get("queue_running", [])), "pending:", len(q.get("queue_pending", [])))
    elif a.cmd == "status":
        h = history(b, a.id)
        print(json.dumps(h.get(a.id, {}).get("status", {}), ensure_ascii=False) if a.id in h else "not in history (running/queued)")
    elif a.cmd == "wait":
        h = wait(b, a.id, a.timeout)
        print(json.dumps(h.get("status", {}), ensure_ascii=False) if h else "TIMEOUT")
    elif a.cmd == "download":
        print("\n".join(download(b, a.id, a.out)) or "no outputs")
    elif a.cmd == "view":
        q = urllib.parse.urlencode({"filename": a.filename, "subfolder": a.subfolder, "type": a.type})
        open(a.out, "wb").write(_req(b, "GET", "/view?" + q, raw=True))
        print(a.out)

if __name__ == "__main__":
    main()
