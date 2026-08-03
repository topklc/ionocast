#!/usr/bin/env python3
"""Hepburn tropo-map comparison / calibration harness.

Scores an ionocast tropo grid (grid.bin or ingest grid.json) against
W. Hepburn's tropospheric ducting forecast maps (dxinfocentre.com) by
decoding the published 4-bit palette PNGs into per-cell HTI ranks and
rank-correlating them with tropo_index on the shared 0.5-deg grid.

Pure stdlib (no Pillow, no numpy): the PNGs are 4-bit indexed,
non-interlaced, which a ~50-line inflate-and-unfilter reader handles.

Subcommands:

  fetch  <hours...> [--regions eam,eur,wam] [--dir DIR]
      Download forecast maps (hour = HHH from Hepburn's 12z base,
      e.g. 024). Files land as DIR/hepburn-<region><HHH>.png.

  score  <grid.{bin,json}> <map.png> [--render out.png]
      Score one grid against one downloaded map. Region is inferred
      from the map filename. Prints Spearman rho, per-rank medians,
      POD/FAR at threshold pairs, worst misses / false-hots; --render
      writes a side-by-side PNG.

  sweep  <grid:hour> [<grid:hour>...] [--regions eam,eur,wam]
      Aggregate K_CLIFF / CLIFF_MIN_DROP / K_NOCT sweep over many
      valid times. Each <grid> must be an ingest grid.json produced
      with TROPO_EMIT_TERMS=1; <hour> is the matching Hepburn HHH
      (maps are read from the current directory). Recomposes
      tropo_index offline for every K/D/N combo - no ingest re-runs.

  suite  [--json]
      Self-contained drift check for scripts/tests.mjs: downloads the
      production grid (data.ionocast.org/tropo/grid.bin), resolves its
      valid time, fetches the matching Hepburn map for each region
      (trying both candidate 12z bases; the better-scoring one wins,
      since a mismatched valid time can only lower rho), and emits
      per-region rho as JSON.

  autotune  <grid.json> [...] --emitted K:D:N [--current K:D:N] [--json]
      Self-driving recalibration verdict for the monthly CI loop.
      Takes TROPO_EMIT_TERMS=1 grids, resolves each grid's valid time
      from its own header, fetches the matching Hepburn maps (base
      disambiguated per frame by best-rho at the current constants),
      sweeps K_CLIFF x CLIFF_MIN_DROP x K_NOCT, and emits a verdict:
      a coefficient change is recommended ONLY when the best combo
      beats the current one by > 0.005 mean Spearman AND wins on
      >= 80 %% of frames; the proposed K moves at most 0.5 per run and
      stays inside [3, 8].  Everything else is "hold" - the result
      still feeds the seasonal evidence ledger either way.

Hepburn's maps are copyrighted (W. R. Hepburn, dxinfocentre.com):
reference / calibration use only - never republish the maps or the
decoded fields.

Calibration provenance: the 2026-08-03 sweep (21 frames, 122k pairs)
that set K_CLIFF=5 is reproducible with the sweep subcommand; see the
K_CLIFF comment in src/tropo/ingest.mjs.
"""
import datetime
import json
import math
import os
import struct
import sys
import tempfile
import urllib.request
import zlib

UA = {"User-Agent": "Mozilla/5.0 (ionocast calibration; non-commercial)"}
MAP_URL = "https://www.dxinfocentre.com/tr_map/fcst/{region}{hour:03d}.png"
PROD_GRID_URL = "https://data.ionocast.org/tropo/grid.bin"

# Emission-time constants for `sweep` recomposition.  MUST match the
# K_CLIFF / CLIFF_MIN_DROP / K_NOCT the grids were generated with
# (see src/tropo/ingest.mjs; override with --emitted K:D:N) - a
# mismatch silently shifts every evaluated K by the difference.
K0, D0, N0 = 5.0, 8.0, 15.0

# ── minimal indexed-PNG reader / RGB writer ─────────────────────────

def read_indexed_png(path):
    """Read a bitdepth<=8, colortype-3, non-interlaced PNG.
    Returns (W, H, palette [(r,g,b), ...], pixels as list of rows of
    palette indices)."""
    raw = open(path, "rb").read()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    pos, W = 8, None
    palette, idat = [], []
    while pos < len(raw):
        (ln,), typ = struct.unpack(">I", raw[pos:pos + 4]), raw[pos + 4:pos + 8]
        data = raw[pos + 8: pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            W, H, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", data)
            if ctype != 3 or interlace != 0:
                raise ValueError(f"{path}: not indexed/non-interlaced")
        elif typ == b"PLTE":
            palette = [tuple(data[i:i + 3]) for i in range(0, len(data), 3)]
        elif typ == b"IDAT":
            idat.append(data)
        elif typ == b"IEND":
            break
    dec = zlib.decompress(b"".join(idat))
    stride = (W * depth + 7) // 8
    rows, prev = [], bytearray(stride)
    p = 0
    for _ in range(H):
        f = dec[p]
        line = bytearray(dec[p + 1: p + 1 + stride])
        p += 1 + stride
        if f == 1:      # Sub
            for i in range(1, stride):
                line[i] = (line[i] + line[i - 1]) & 0xff
        elif f == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xff
        elif f == 3:    # Average
            for i in range(stride):
                a = line[i - 1] if i else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xff
        elif f == 4:    # Paeth
            for i in range(stride):
                a = line[i - 1] if i else 0
                b, c = prev[i], (prev[i - 1] if i else 0)
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xff
        prev = line
        if depth == 8:
            rows.append(list(line[:W]))
        elif depth == 4:
            r = []
            for i in range(W):
                byte = line[i >> 1]
                r.append((byte >> 4) if i % 2 == 0 else (byte & 0xf))
            rows.append(r)
        else:
            raise ValueError(f"{path}: unsupported bit depth {depth}")
    return W, H, palette, rows

def write_rgb_png(path, rgb_rows):
    """Write a list of rows of (r,g,b) tuples as an uncompressed-filter PNG."""
    H, W = len(rgb_rows), len(rgb_rows[0])
    body = bytearray()
    for row in rgb_rows:
        body.append(0)
        for (r, g, b) in row:
            body += bytes((r, g, b))
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(bytes(body)))
    out += chunk(b"IEND", b"")
    open(path, "wb").write(out)

# ── ionocast grid decode (mirrors src/tropo/grid-codec.mjs) ─────────

def decode_grid(path_or_bytes):
    if isinstance(path_or_bytes, str) and path_or_bytes.endswith(".json"):
        return _decode_grid_json(path_or_bytes)
    b = (open(path_or_bytes, "rb").read()
         if isinstance(path_or_bytes, str) else path_or_bytes)
    # Explicit raises (not assert - asserts vanish under `python -O`),
    # and a version gate mirroring grid-codec.mjs so a future v2 layout
    # fails loudly instead of misparsing.
    if b[:8] != b"TROPO\x00\x00\x00":
        raise ValueError("grid.bin: bad magic")
    off = 8
    version, flags = struct.unpack_from("<HH", b, off); off += 4
    if version != 1:
        raise ValueError(f"grid.bin: unsupported version {version}")
    cycle_unix, = struct.unpack_from("<I", b, off); off += 4
    forecast_h, = struct.unpack_from("<H", b, off); off += 2
    off += 4  # gen_unix
    n_levels, = struct.unpack_from("<H", b, off); off += 2 + 2 * n_levels
    rows, cols = struct.unpack_from("<II", b, off); off += 8
    (lat_min, lat_max, lat_step, lon_min, lon_max, lon_step,
     _, _) = struct.unpack_from("<8f", b, off); off += 32
    off += 4  # n_valid
    source_len, = struct.unpack_from("<H", b, off); off += 2
    source = b[off:off + source_len].decode("utf-8"); off += source_len
    if off % 8:
        off += 8 - (off % 8)
    n = rows * cols
    tropo = struct.unpack_from("<%df" % n, b, off)
    return {
        "cycle": datetime.datetime.fromtimestamp(cycle_unix, datetime.timezone.utc),
        "forecast_h": forecast_h, "envelope": bool(flags & 1),
        "rows": rows, "cols": cols, "source": source,
        "lat_min": lat_min, "lat_max": lat_max, "lat_step": lat_step,
        "lon_min": lon_min, "lon_max": lon_max, "lon_step": lon_step,
        "tropo": tropo, "cells": None,
    }

def _decode_grid_json(path):
    d = json.load(open(path, encoding="utf-8"))
    G = d["grid"]
    rows = round((G["lat_max"] - G["lat_min"]) / G["lat_step"]) + 1
    cols = round((G["lon_max"] - G["lon_min"]) / G["lon_step"]) + 1
    tropo = [float("nan")] * (rows * cols)
    for c in d["cells"]:
        if c["tropo_index"] is None:
            continue
        r = round((G["lat_max"] - c["lat"]) / G["lat_step"])
        col = round((c["lon"] - G["lon_min"]) / G["lon_step"]) % cols
        if 0 <= r < rows:
            tropo[r * cols + col] = c["tropo_index"]
    cy = d["cycle"]
    return {
        "cycle": datetime.datetime(int(cy[0:4]), int(cy[4:6]), int(cy[6:8]),
                                   int(cy[8:10]), tzinfo=datetime.timezone.utc),
        "forecast_h": d["forecast_hour"],
        "envelope": bool(d.get("forecast_hour_envelope")),
        "rows": rows, "cols": cols, "source": d.get("source", ""),
        "lat_min": G["lat_min"], "lat_max": G["lat_max"], "lat_step": G["lat_step"],
        "lon_min": G["lon_min"], "lon_max": G["lon_max"], "lon_step": G["lon_step"],
        "tropo": tropo, "cells": d["cells"],
    }

def grid_sample(g, lat, lon):
    r = round((g["lat_max"] - lat) / g["lat_step"])
    c = round((lon - g["lon_min"]) / g["lon_step"]) % g["cols"]
    if r < 0 or r >= g["rows"]:
        return None
    v = g["tropo"][r * g["cols"] + c]
    return None if v != v else v

# ── Hepburn map rank extraction ─────────────────────────────────────

REGIONS = {
    "eam": ([51, 48, 45, 42, 39, 36, 33, 30, 27],
            [-100, -95, -90, -85, -80, -75, -70, -65, -60, -55]),
    "eur": ([54, 51, 48, 45, 42, 39, 36, 33, 30, 27],
            [-10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40]),
    "wam": ([55, 50, 45, 40, 35, 30, 25, 20],
            [-160, -155, -150, -145, -140, -135, -130, -125,
             -120, -115, -110, -105, -100, -95]),
}
# Palette cold->warm.  (20,20,20) is dual-use: below-normal fill in
# dark regions AND contour ink over bright fills (contextual).  Solid
# white = beyond-silver extreme fill; thin white = coastline ink.
DARK = (20, 20, 20)
HIGH_RANKS = {9, 10, 11, 12}
RANKS = {
    (0, 0, 0): 0,
    (130, 0, 220): 1, (51, 119, 255): 2, (2, 208, 161): 3,
    (160, 230, 50): 4, (230, 220, 50): 5, (230, 175, 45): 6,
    (240, 130, 40): 7, (250, 60, 60): 8, (255, 128, 192): 9,
    (255, 180, 220): 10, (204, 134, 204): 11, (192, 192, 192): 12,
}
RANK_COLORS = {r: c for c, r in RANKS.items()}
RANK_COLORS[-1] = (10, 10, 10)
RANK_COLORS[13] = (255, 255, 255)

def extract_ranks(png_path, region):
    """Return {(lat, lon): hti_rank} on the 0.5-deg grid."""
    LAT_TICKS, LON_TICKS = [list(v) for v in REGIONS[region]]
    W, H, palette, px = read_indexed_png(png_path)
    idx_rgb = {i: palette[i] if i < len(palette) else (0, 0, 0)
               for i in range(16)}
    WHITE = next((i for i, c in idx_rgb.items() if c == (255, 255, 255)), None)
    idx_rank = {i: RANKS[c] for i, c in idx_rgb.items() if c in RANKS}

    def white_lines(vertical):
        hits = []
        rng, other = (W, H) if vertical else (H, W)
        for a in range(rng):
            n = sum(1 for b in range(other)
                    if (px[b][a] if vertical else px[a][b]) == WHITE)
            if n > other * 0.7:
                hits.append(a)
        return hits

    vx, hy = white_lines(True), white_lines(False)
    if not vx or not hy:
        raise ValueError(f"{png_path}: plot frame not found")
    x0, x1 = max(v for v in vx if v < W / 2), min(v for v in vx if v > W / 2)
    y0, y1 = max(v for v in hy if v < H / 2), min(v for v in hy if v > H / 2)

    def cluster(vals):
        out, cur = [], []
        for v in vals:
            if cur and v - cur[-1] > 2:
                out.append(sum(cur) / len(cur))
                cur = []
            cur.append(v)
        if cur:
            out.append(sum(cur) / len(cur))
        return out

    ty = cluster([y for y in range(y0, y1 + 1) if px[y][x0 - 2] == WHITE])
    tx = cluster([x for x in range(x0, x1 + 1) if px[y1 + 2][x] == WHITE])
    # More detected ticks than known labels means something white sat in
    # the tick column (layout change, stray blob).  linfit over zipped
    # unequal lists would silently mis-georeference the whole frame, so
    # fail loudly instead.
    if len(ty) > len(LAT_TICKS) or len(tx) > len(LON_TICKS):
        raise ValueError(f"{png_path}: more axis ticks than labels "
                         f"({len(ty)} lat / {len(tx)} lon) - layout change?")
    # Edge ticks can coincide with the frame; missing ones are always
    # at the bottom/right, so align labels from the top/left.
    LAT_TICKS, LON_TICKS = LAT_TICKS[:len(ty)], LON_TICKS[:len(tx)]
    if len(ty) < 3 or len(tx) < 3:
        raise ValueError(f"{png_path}: too few axis ticks")

    def linfit(ps, vs):
        n = len(ps)
        sp, sv = sum(ps), sum(vs)
        spp = sum(p * p for p in ps)
        spv = sum(p * v for p, v in zip(ps, vs))
        a = (n * spv - sp * sv) / (n * spp - sp * sp)
        return a, (sv - a * sp) / n

    lat_a, lat_b = linfit(ty, LAT_TICKS)
    lon_a, lon_b = linfit(tx, LON_TICKS)

    def rank_at(lat, lon):
        xi = round((lon - lon_b) / lon_a)
        yi = round((lat - lat_b) / lat_a)
        if xi < x0 + 3 or xi > x1 - 3 or yi < y0 + 3 or yi > y1 - 3:
            return None
        votes, dark, white = {}, 0, 0
        for dy in range(-2, 3):
            row = px[yi + dy]
            for dx in range(-2, 3):
                i = row[xi + dx]
                if idx_rgb[i] == DARK:
                    dark += 1
                elif i == WHITE:
                    white += 1
                else:
                    r = idx_rank.get(i)
                    if r is not None:
                        votes[r] = votes.get(r, 0) + 1
        if white >= 15:
            return 13
        has_high = any(r in HIGH_RANKS for r in votes)
        if dark >= 13 and not has_high and white < 5:
            return -1
        if not votes:
            return None
        return max(votes, key=votes.get)

    out = {}
    lat = min(LAT_TICKS)
    while lat <= max(LAT_TICKS):
        lon = min(LON_TICKS)
        while lon <= max(LON_TICKS):
            r = rank_at(lat, lon)
            if r is not None:
                out[(lat, lon)] = r
            lon += 0.5
        lat += 0.5
    return out

# ── stats ───────────────────────────────────────────────────────────

def spearman(xs, ys):
    def rank(v):
        s = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(s):
            j = i
            while j + 1 < len(s) and v[s[j + 1]] == v[s[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[s[k]] = avg
            i = j + 1
        return r
    rx, ry = rank(xs), rank(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    dx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    dy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return num / (dx * dy) if dx and dy else float("nan")

def build_pairs(grid, ranks):
    """[(lat, lon, hep_rank, tropo_index), ...] on shared cells."""
    out = []
    for (lat, lon), hr in ranks.items():
        v = grid_sample(grid, lat, lon)
        if v is not None:
            out.append((lat, lon, hr, v))
    return out

def region_from_name(path):
    base = os.path.basename(path)
    for r in REGIONS:
        if r in base:
            return r
    raise ValueError(f"cannot infer region from {path} (want eam/eur/wam)")

def fetch_map(region, hour, dest):
    url = MAP_URL.format(region=region, hour=hour)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    open(dest, "wb").write(data)
    return dest

# ── subcommands ─────────────────────────────────────────────────────

def cmd_fetch(args):
    regions = _opt(args, "--regions", "eam,eur,wam").split(",")
    d = _opt(args, "--dir", ".")
    for h in [int(a) for a in _positionals(args)]:
        for r in regions:
            dest = os.path.join(d, f"hepburn-{r}{h:03d}.png")
            fetch_map(r, h, dest)
            print(f"fetched {dest}")

def cmd_score(args):
    grid_path, map_path = _positionals(args)[:2]
    region = region_from_name(map_path)
    grid = decode_grid(grid_path)
    ranks = extract_ranks(map_path, region)
    pairs = build_pairs(grid, ranks)
    print(f"grid: cycle {grid['cycle']:%Y-%m-%d %Hz} +{grid['forecast_h']}h "
          f"({grid['source']})")
    print(f"region {region}: {len(pairs)} paired cells")
    if not pairs:
        sys.exit("no paired cells - grid and map do not overlap "
                 "(wrong region, empty grid, or valid-time mismatch)")
    rho = spearman([p[2] for p in pairs], [p[3] for p in pairs])
    print(f"Spearman rank correlation: {rho:.3f}\n")

    byrank = {}
    for _, _, h, o in pairs:
        byrank.setdefault(h, []).append(o)
    print(f"{'HTI rank':>8} {'n':>6} {'p10':>7} {'median':>7} {'p90':>7}")
    for h in sorted(byrank):
        v = sorted(byrank[h])
        n = len(v)
        print(f"{h:>8} {n:>6} {v[int(n*.1)]:>7.1f} {v[n//2]:>7.1f} "
              f"{v[min(n-1, int(n*.9))]:>7.1f}")

    for hcut in (3, 5):
        for ocut in (20, 50, 90):
            tp = sum(1 for p in pairs if p[2] >= hcut and p[3] >= ocut)
            fn = sum(1 for p in pairs if p[2] >= hcut and p[3] < ocut)
            fp = sum(1 for p in pairs if p[2] < hcut and p[3] >= ocut)
            pod = tp / (tp + fn) if tp + fn else float("nan")
            far = fp / (tp + fp) if tp + fp else float("nan")
            print(f"Hepburn>={hcut} vs ours>={ocut}:  POD {pod:.2f}  FAR {far:.2f}")

    miss = sorted((p for p in pairs if p[2] >= 5 and p[3] < 50), key=lambda p: -p[2])
    fhot = sorted((p for p in pairs if p[2] <= 1 and p[3] >= 90), key=lambda p: -p[3])
    print(f"\nHepburn>=5 but ours<50: {len(miss)} cells; worst:")
    for lat, lon, h, o in miss[:8]:
        print(f"  {lat:+.1f},{lon:+.1f}  HTI~{h}  ours {o:.0f}")
    print(f"Hepburn<=1 but ours>=90: {len(fhot)} cells; worst:")
    for lat, lon, h, o in fhot[:8]:
        print(f"  {lat:+.1f},{lon:+.1f}  HTI~{h}  ours {o:.0f}")

    render = _opt(args, "--render", None)
    if render:
        _render(pairs, render)
        print(f"render: {render}  left=Hepburn  right=ionocast")

def _render(pairs, out_png, scale=5):
    BANDS = [
        (30, 40, 110), (35, 70, 150), (35, 105, 185), (35, 140, 215),
        (45, 175, 235), (75, 205, 235), (130, 225, 220), (190, 240, 190),
        (250, 250, 150), (250, 220, 100), (250, 180, 60), (245, 135, 40),
        (235, 85, 30), (215, 40, 25), (180, 15, 60),
    ]
    lats = sorted({p[0] for p in pairs})
    lons = sorted({p[1] for p in pairs})
    li = {v: i for i, v in enumerate(lats)}
    lo = {v: i for i, v in enumerate(lons)}
    w, h = len(lons) * scale, len(lats) * scale
    img = [[(45, 45, 45)] * (w * 2 + 12) for _ in range(h)]
    for lat, lon, hr, ours in pairs:
        r0 = (len(lats) - 1 - li[lat]) * scale
        c0 = lo[lon] * scale
        left = RANK_COLORS.get(hr, (10, 10, 10))
        right = BANDS[min(len(BANDS) - 1, int(max(0, ours) / 200 * len(BANDS)))]
        for dy in range(scale):
            for dx in range(scale):
                img[r0 + dy][c0 + dx] = left
                img[r0 + dy][w + 12 + c0 + dx] = right
    write_rgb_png(out_png, img)

def cmd_sweep(args):
    global K0, D0, N0
    emitted = _opt(args, "--emitted", None)
    if emitted:
        K0, D0, N0 = [float(v) for v in emitted.split(":")]
    print(f"recomposing from emission constants K={K0} D={D0} N={N0}")
    regions = _opt(args, "--regions", "eam,eur,wam").split(",")
    samples = []
    for spec in _positionals(args):
        grid_path, hour = spec.rsplit(":", 1)
        g = _decode_grid_json(grid_path)
        cell_at = {(c["lat"], c["lon"]): c for c in g["cells"]
                   if c["tropo_index"] is not None}
        for region in regions:
            png = f"hepburn-{region}{int(hour):03d}.png"
            if not os.path.exists(png):
                print(f"skip missing {png}")
                continue
            ranks = extract_ranks(png, region)
            pairs = []
            for (lat, lon), hr in ranks.items():
                c = cell_at.get((lat, lon))
                if c is None:
                    continue
                tw = c.get("tw", 1.0)
                cd, cs, nr = c.get("cd", 0.0), c.get("cs", 0.0), c.get("nr", 0.0)
                cur = tw * (min(70, K0 * max(0, cd - D0)) * cs + min(40, N0 * nr))
                pairs.append((hr, c["tropo_index"] - cur, tw, cd, cs, nr))
            if pairs:
                samples.append((f"{region}:{grid_path}", pairs))
    print(f"{len(samples)} frame samples, "
          f"{sum(len(p) for _, p in samples)} pairs\n")
    if not samples:
        sys.exit("no samples - grids must be TROPO_EMIT_TERMS=1 grid.json "
                 "and hepburn-<region><HHH>.png maps must be in cwd")

    def mean_rho(K, D, N):
        rhos = []
        for _, pairs in samples:
            idx = [p[1] + p[2] * (min(70, K * max(0, p[3] - D)) * p[4]
                                  + min(40, N * p[5]))
                   for p in pairs]
            rhos.append(spearman([p[0] for p in pairs], idx))
        return sum(rhos) / len(rhos)

    print("K_CLIFF sweep (D=8, N=15):")
    for K in (0, 2, 3, 4, 4.5, 5, 5.5, 6, 7, 8):
        print(f"  K={K:<4} mean rho {mean_rho(K, 8, 15):+.4f}")
    print("\n(K, D) grid at N=15:")
    print("        D=4     D=6     D=8     D=10    D=12")
    for K in (3, 4, 4.5, 5, 6):
        print(f"  K={K:<4}"
              + "  ".join(f"{mean_rho(K, D, 15):+.4f}" for D in (4, 6, 8, 10, 12)))
    print("\nK_NOCT sweep (K=5, D=8):")
    for N in (0, 5, 10, 15, 20, 30):
        print(f"  N={N:<3} mean rho {mean_rho(5, 8, N):+.4f}")

def _recompose_pairs(grid_json_path, hour, region, kdn):
    """Pairs (hep_rank, base, tw, cd, cs, nr) for one frame, where
    `base` = tropo_index minus the tunable-term contribution at the
    constants `kdn` the grid was emitted with."""
    K, D, N = kdn
    g = _decode_grid_json(grid_json_path)
    cell_at = {(c["lat"], c["lon"]): c for c in g["cells"]
               if c["tropo_index"] is not None}
    png = f"hepburn-{region}{hour:03d}.png"
    if not os.path.exists(png):
        fetch_map(region, hour, png)
    ranks = extract_ranks(png, region)
    pairs = []
    for (lat, lon), hr in ranks.items():
        c = cell_at.get((lat, lon))
        if c is None:
            continue
        tw = c.get("tw", 1.0)
        cd, cs, nr = c.get("cd", 0.0), c.get("cs", 0.0), c.get("nr", 0.0)
        cur = tw * (min(70, K * max(0, cd - D)) * cs + min(40, N * nr))
        pairs.append((hr, c["tropo_index"] - cur, tw, cd, cs, nr))
    return pairs

def _rho_at(pairs, K, D, N):
    idx = [p[1] + p[2] * (min(70, K * max(0, p[3] - D)) * p[4]
                          + min(40, N * p[5]))
           for p in pairs]
    return spearman([p[0] for p in pairs], idx)

def cmd_autotune(args):
    emitted = _opt(args, "--emitted", None)
    if not emitted:
        sys.exit("autotune requires --emitted K:D:N (the constants the "
                 "grids were generated with)")
    kdn_emit = tuple(float(v) for v in emitted.split(":"))
    cur = _opt(args, "--current", emitted)
    curK, curD, curN = (float(v) for v in cur.split(":"))
    emit_json = "--json" in args

    # Resolve each grid's valid time and candidate Hepburn hours, then
    # build frame pairs.  Base disambiguation: both candidate 12z bases
    # can serve a file for the computed hour; the one matching our valid
    # time scores higher at the current constants, so best-of wins.
    frames = []   # (label, pairs)
    for gp in _positionals(args):
        g = _decode_grid_json(gp)
        valid = g["cycle"] + datetime.timedelta(hours=g["forecast_h"])
        b = valid.replace(hour=12, minute=0, second=0, microsecond=0)
        if b > valid:
            b -= datetime.timedelta(days=1)
        hours = [round((valid - base).total_seconds() / 3600)
                 for base in (b, b - datetime.timedelta(days=1))]
        hours = [h for h in hours if 6 <= h <= 120]
        for region in REGIONS:
            best = None
            for h in hours:
                try:
                    pairs = _recompose_pairs(gp, h, region, kdn_emit)
                except Exception as e:
                    print(f"  skip {region} h{h:03d}: {e}", file=sys.stderr)
                    continue
                if len(pairs) < 500:
                    continue
                rho = _rho_at(pairs, curK, curD, curN)
                if best is None or rho > best[2]:
                    best = (f"{region}+{h:03d}h", pairs, rho)
            if best:
                frames.append((best[0], best[1]))
    if len(frames) < 6:
        out = {"error": f"only {len(frames)} scoreable frames - not enough "
                        "evidence for a verdict (need >= 6)"}
        print(json.dumps(out) if emit_json else json.dumps(out, indent=2))
        sys.exit(1)

    def mean_rho(K, D, N):
        return sum(_rho_at(p, K, D, N) for _, p in frames) / len(frames)

    cur_mean = mean_rho(curK, curD, curN)
    best = {"K": curK, "D": curD, "N": curN, "meanRho": cur_mean}
    for K in (3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7):
        for D in (6, 8, 10):
            for N in (10, 15, 20):
                m = mean_rho(K, D, N)
                if m > best["meanRho"]:
                    best = {"K": K, "D": D, "N": N, "meanRho": m}

    deltas = [_rho_at(p, best["K"], best["D"], best["N"])
              - _rho_at(p, curK, curD, curN) for _, p in frames]
    wins_frac = sum(1 for d in deltas if d > 0) / len(frames)
    mean_delta = sum(deltas) / len(frames)

    # Guardrails: recommend only clear, consistent improvement; move K
    # at most 0.5 per run and keep it in [3, 8] so one weird synoptic
    # month can never yank the default around.
    recommend = {"change": False, "K": curK, "D": curD, "N": curN}
    if mean_delta > 0.005 and wins_frac >= 0.8:
        stepK = max(curK - 0.5, min(curK + 0.5, best["K"]))
        stepK = max(3.0, min(8.0, stepK))
        recommend = {"change": True, "K": stepK, "D": best["D"], "N": best["N"],
                     "reason": f"best {best['K']}/{best['D']}/{best['N']} beats "
                               f"current by {mean_delta:+.4f} mean rho on "
                               f"{wins_frac:.0%} of {len(frames)} frames"
                               + (f"; K step-limited to {stepK}" if stepK != best["K"] else "")}
    out = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
                       .isoformat(timespec="seconds"),
        "nFrames": len(frames),
        "frames": [{"label": l, "rhoCurrent": round(_rho_at(p, curK, curD, curN), 4)}
                   for l, p in frames],
        "current": {"K": curK, "D": curD, "N": curN, "meanRho": round(cur_mean, 4)},
        "best": {**best, "meanRho": round(best["meanRho"], 4)},
        "meanDelta": round(mean_delta, 4),
        "winsFrac": round(wins_frac, 3),
        "recommend": recommend,
    }
    print(json.dumps(out) if emit_json else json.dumps(out, indent=2))

def cmd_suite(args):
    """Drift check: production grid vs today's Hepburn maps."""
    emit_json = "--json" in args
    result = {"regions": {}, "gridSource": None, "valid": None}
    try:
        req = urllib.request.Request(PROD_GRID_URL, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            grid = decode_grid(r.read())
    except Exception as e:
        _suite_out({"skipped": f"production grid fetch failed: {e}"}, emit_json)
        return
    valid = grid["cycle"] + datetime.timedelta(hours=grid["forecast_h"])
    result["gridSource"] = grid["source"]
    result["valid"] = valid.isoformat()
    if grid["envelope"]:
        result["note"] = "envelope grid: valid uses first lead"

    # Candidate Hepburn bases: the two most recent 12z runs at or
    # before the grid's valid time.  A stale-base map has a different
    # valid time and can only score lower, so best-of wins.
    b = valid.replace(hour=12, minute=0, second=0, microsecond=0)
    if b > valid:
        b -= datetime.timedelta(days=1)
    bases = [b, b - datetime.timedelta(days=1)]

    rhos = []
    with tempfile.TemporaryDirectory() as td:
        for region in REGIONS:
            best = None
            for base in bases:
                hour = round((valid - base).total_seconds() / 3600)
                if not (6 <= hour <= 120):
                    continue
                dest = os.path.join(td, f"hepburn-{region}{hour:03d}.png")
                try:
                    fetch_map(region, hour, dest)
                    ranks = extract_ranks(dest, region)
                except Exception as e:
                    result["regions"].setdefault(region, {})[f"h{hour:03d}"] = \
                        f"error: {e}"
                    continue
                pairs = build_pairs(grid, ranks)
                if len(pairs) < 500:
                    continue
                rho = spearman([p[2] for p in pairs], [p[3] for p in pairs])
                if best is None or rho > best["rho"]:
                    best = {"rho": round(rho, 4), "n": len(pairs), "hour": hour}
            if best:
                result["regions"][region] = best
                rhos.append(best["rho"])
    if not rhos:
        _suite_out({"skipped": "no Hepburn maps could be scored",
                    **result}, emit_json)
        return
    result["meanRho"] = round(sum(rhos) / len(rhos), 4)
    _suite_out(result, emit_json)

def _suite_out(obj, emit_json):
    if emit_json:
        print(json.dumps(obj))
    else:
        print(json.dumps(obj, indent=2))

def _opt(args, name, default):
    for i, a in enumerate(args):
        if a == name and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return default

def _positionals(args):
    """Args that are neither --options nor the value of a space-form
    --option."""
    out, skip = [], False
    for a in args:
        if skip:
            skip = False
        elif a.startswith("--"):
            skip = "=" not in a
        else:
            out.append(a)
    return out

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "fetch":
        cmd_fetch(args)
    elif cmd == "score":
        cmd_score(args)
    elif cmd == "sweep":
        cmd_sweep(args)
    elif cmd == "suite":
        cmd_suite(args)
    elif cmd == "autotune":
        cmd_autotune(args)
    else:
        print(__doc__)
        sys.exit(f"unknown subcommand: {cmd}")

if __name__ == "__main__":
    main()
