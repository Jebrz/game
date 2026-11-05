#!/usr/bin/env python3
"""把 art/source/ 里的原图处理成带真实透明通道的 PNG（src/assets/art/）。

原图不改动。做法：只把「与图片边缘连通」的背景区域判为背景（洪水填充），
不做全局删白/删灰，所以物体内部的白色、奶油色、浅灰都保留。
边缘一圈按与背景色的差值计算半透明，并去掉背景色的污染（消白边）。

依赖：Pillow、numpy、scipy（pip install pillow numpy scipy）
运行：python3 tools/prepare_art.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'source')
OUT = os.path.join(ROOT, 'src', 'assets', 'art')


def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert('RGB')).astype(np.float32)


def border_connected(cand):
    """候选背景中，与图片四边连通的部分。"""
    lab, _ = ndi.label(cand)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge != 0]
    return np.isin(lab, edge)


def keep_main(fg, min_frac=0.002):
    """去掉与主体不相连、面积很小的碎屑（压缩噪点），保留较大的独立部件。"""
    lab, n = ndi.label(fg)
    if n == 0:
        return fg
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= max(30, sizes.max() * min_frac)
    return keep[lab]


def matte(img, bg_mask, bg_color, soft=34.0, band=3):
    """bg_mask: 判定为背景的像素；bg_color: 每像素的背景色估计 (H,W,3)。
    返回 RGBA（uint8）。"""
    fg = ~bg_mask
    # 只在边界附近 band 像素内计算半透明，内部保持完全不透明
    near = ndi.binary_dilation(bg_mask, iterations=band) & ndi.binary_dilation(fg, iterations=band)
    diff = np.abs(img - bg_color).max(axis=2)
    a_soft = np.clip(diff / soft, 0.0, 1.0)
    alpha = np.where(fg, 1.0, 0.0)
    alpha = np.where(near, np.where(fg, np.maximum(a_soft, 0.35), np.minimum(a_soft, 0.6)), alpha)
    alpha = np.where(near & bg_mask & (diff < soft * 0.35), 0.0, alpha)
    # 去污染：C = (P - (1-a)·B) / a
    a3 = alpha[..., None]
    col = np.where(a3 > 0.01, (img - (1 - a3) * bg_color) / np.maximum(a3, 0.01), img)
    col = np.clip(col, 0, 255)
    rgba = np.dstack([col, alpha * 255]).round().astype(np.uint8)
    rgba[alpha <= 0.0] = 0  # 完全透明处颜色清零，避免缩放时渗出白边
    return rgba


def dehalo(rgba, ring=2.5, lift=18):
    """去白边：外缘 ring 像素内，比往里一点的颜色明显更白/更灰的像素，
    改用里侧颜色，并把最外一圈调淡。纸张本身带颜色的边缘不受影响。"""
    a = rgba[..., 3] > 0
    dist = ndi.distance_transform_edt(a)
    inner = dist > ring
    _, (iy, ix) = ndi.distance_transform_edt(~inner, return_indices=True)
    ref = rgba[iy, ix, :3].astype(np.float32)
    col = rgba[..., :3].astype(np.float32)
    whiter = (col.min(axis=2) - ref.min(axis=2) > lift) & a & ~inner
    out = rgba.copy()
    out[whiter, :3] = ref[whiter].round().astype(np.uint8)
    outer = whiter & (dist <= 1.0)
    out[outer, 3] = (out[outer, 3] * 0.55).astype(np.uint8)
    return out


def trim(rgba, pad=2):
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + 1 + pad)
    return rgba[y0:y1, x0:x1], (int(x0), int(y0))


def white_bg(img, thr=236, chroma=14):
    mn = img.min(axis=2)
    ch = img.max(axis=2) - mn
    cand = (mn >= thr) & (ch <= chroma)
    return border_connected(cand)


def checker_bg(img):
    """烘焙在图里的灰白棋盘格：两种浅灰/白、低饱和。背景色按最近的背景像素估计。"""
    mn = img.min(axis=2)
    ch = img.max(axis=2) - mn
    cand = (mn >= 200) & (ch <= 10)
    bg = border_connected(cand)
    # 每个像素的背景色 = 最近的确定背景像素的颜色（棋盘格局部颜色）
    _, (iy, ix) = ndi.distance_transform_edt(~bg, return_indices=True)
    return bg, img[iy, ix]


def process_white(name):
    img = load(name)
    mn = img.min(axis=2)
    ch = img.max(axis=2) - mn
    cand = (mn >= 236) & (ch <= 14)
    bg = border_connected(cand)
    # 被物体围住、但面积不小的纯白缝隙（如底盘下方透出的背景）也算背景；
    # 很小的白点多半是高光，保留。
    holes = cand & ~bg
    lab, n = ndi.label(holes)
    if n:
        sizes = ndi.sum(holes, lab, range(1, n + 1))
        big = np.zeros(n + 1, bool)
        big[1:] = sizes >= 20
        bg |= big[lab]
    fg = keep_main(~bg)
    return matte(img, ~fg, np.full_like(img, 255.0))


def process_miner(name):
    img = load(name)
    bg, bgc = checker_bg(img)
    fg = ~bg
    # 只保留人物主体（最大连通块）；头顶上方的淡色光痕和脚下的地面细线属于背景草图，不要
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    main = lab == (int(np.argmax(sizes)) + 1)
    main = ndi.binary_fill_holes(main)
    # 去掉脚下那条灰色地面细线：靴底以下的行全部视为背景。
    # 靴底 = 最后一行仍有足够多「有颜色」（棕色靴子）像素的行。
    ch = img.max(axis=2) - img.min(axis=2)
    colored = (main & (ch >= 20)).sum(axis=1)
    sole = int(np.nonzero(colored >= 30)[0].max())
    main[sole + 1:] = False
    # 靴底这一行里，靴子左右两侧伸出去的灰线也去掉
    xs = np.nonzero(main[sole - 3] )[0]
    main[sole - 2:sole + 1, :max(0, xs.min() - 2)] = False
    main[sole - 2:sole + 1, xs.max() + 3:] = False
    rgba = matte(img, ~main, bgc, soft=30.0)
    return rgba


def opaque_bbox(rgba, thr=128):
    ys, xs = np.nonzero(rgba[..., 3] >= thr)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}

    # 1) 工程车厢
    car = process_white('01-engineering-car-approved-v1.upload.webp')
    car, off = trim(dehalo(car))
    Image.fromarray(car, 'RGBA').save(os.path.join(OUT, 'engineering-car.png'), optimize=True)
    meta['engineering-car'] = {'size': [car.shape[1], car.shape[0]], 'cropOffset': off}

    # 2) 停靠状态的运输机
    sh = process_white('04-shuttle-docked-candidate.upload.png')
    sh, off = trim(dehalo(sh))
    Image.fromarray(sh, 'RGBA').save(os.path.join(OUT, 'shuttle-docked.png'), optimize=True)
    meta['shuttle-docked'] = {'size': [sh.shape[1], sh.shape[0]], 'cropOffset': off, 'opaqueBBox': opaque_bbox(sh)}

    # 3) 矿工
    mi = process_miner('08-miner-option-b.upload.webp')
    mi, off = trim(dehalo(mi))
    Image.fromarray(mi, 'RGBA').save(os.path.join(OUT, 'miner.png'), optimize=True)
    meta['miner'] = {'size': [mi.shape[1], mi.shape[0]], 'cropOffset': off, 'opaqueBBox': opaque_bbox(mi)}

    json.dump(meta, open(os.path.join(ROOT, 'art', 'prepared-meta.json'), 'w'), indent=2, ensure_ascii=False)
    json.dump(meta, sys.stdout, indent=2, ensure_ascii=False)
    print()


if __name__ == '__main__':
    main()
