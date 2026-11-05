#!/usr/bin/env python3
"""机库预览用素材处理（原图在 art/source/hangar/，不改动）。

1) 俯视运输机：去掉与图片边缘连通的白色背景（洪水填充），不做全局删白，
   机身内部的浅色装甲、白色高光都保留；外缘一圈按与白色的差值算半透明并去白边。
2) 机库背景：只把与图片边缘连通的那一片纯色灰底变透明，让机库浮在星空上；
   机库内部的灰色地板、黑色外墙全部保留。

依赖：Pillow、numpy、scipy。运行：python3 tools/prepare_hangar_art.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'source', 'hangar')
OUT = os.path.join(ROOT, 'src', 'preview', 'assets')


def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert('RGB')).astype(np.float32)


def border_connected(cand):
    lab, _ = ndi.label(cand)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge != 0]
    return np.isin(lab, edge)


def soft_matte(img, fg, bg_color, soft, band=2):
    """fg 内部完全不透明；边界 band 像素内按与背景色的差值给半透明，并去掉背景色污染。"""
    bgm = ~fg
    near = ndi.binary_dilation(bgm, iterations=band) & ndi.binary_dilation(fg, iterations=band)
    diff = np.abs(img - bg_color).max(axis=2)
    a_soft = np.clip(diff / soft, 0.0, 1.0)
    alpha = fg.astype(np.float32)
    alpha = np.where(near & fg, np.maximum(a_soft, 0.4), alpha)
    alpha = np.where(near & bgm, np.where(diff > soft * 0.4, np.minimum(a_soft, 0.5), 0.0), alpha)
    a3 = alpha[..., None]
    col = np.where(a3 > 0.01, (img - (1 - a3) * bg_color) / np.maximum(a3, 0.01), img)
    rgba = np.dstack([np.clip(col, 0, 255), alpha * 255]).round().astype(np.uint8)
    rgba[alpha <= 0] = 0
    return rgba


def trim(rgba, pad=2):
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + 1 + pad)
    return rgba[y0:y1, x0:x1], (int(x0), int(y0))


def shuttle():
    img = load('15-top-down-shuttle-candidate.upload.webp')
    mn = img.min(axis=2)
    ch = img.max(axis=2) - mn
    bg = border_connected((mn >= 236) & (ch <= 14))
    fg = ~bg
    # 去掉与主体不相连的压缩噪点
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= max(40, sizes.max() * 0.002)
    fg = keep[lab]
    rgba = soft_matte(img, fg, np.full_like(img, 255.0), soft=40.0)
    rgba, off = trim(rgba)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'shuttle-topdown.png'), optimize=True)
    return rgba, off


def hangar():
    img = load('14-empty-six-bay-hangar-candidate.upload.webp')
    ref = np.median(np.concatenate([img[:4, :].reshape(-1, 3), img[-4:, :].reshape(-1, 3)]), axis=0)
    diff = np.abs(img - ref).max(axis=2)
    bg = border_connected(diff <= 7)
    # 去掉灰底里与机库主体不相连的小污点
    fg = ~bg
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    fg = lab == (int(np.argmax(sizes)) + 1)
    bg = ~fg
    rgba = soft_matte(img, ~bg, np.broadcast_to(ref, img.shape).astype(np.float32), soft=22.0, band=1)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'hangar-six-bay.png'), optimize=True)
    return rgba, ref


def main():
    os.makedirs(OUT, exist_ok=True)
    sh, off = shuttle()
    hg, ref = hangar()
    a = sh[..., 3] >= 128
    ys, xs = np.nonzero(a)
    meta = {
        'shuttle': {
            'size': [sh.shape[1], sh.shape[0]],
            'cropOffsetInSource': off,
            'opaqueBBox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            'nose': 'up',
        },
        'hangar': {'size': [hg.shape[1], hg.shape[0]], 'removedBackgroundRGB': [int(v) for v in ref]},
    }
    with open(os.path.join(ROOT, 'art', 'hangar-meta.json'), 'w') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == '__main__':
    main()
