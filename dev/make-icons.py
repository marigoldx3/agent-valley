#!/usr/bin/env python3
"""Draw the Hermes Valley app icons (pixel Hermes on a sky tile) as PNGs. No dependencies."""
import pathlib
import struct
import zlib

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"

# Same left-half templates as public/office.js (mirrored to 12 columns).
BODY = ["......", "...ooo", "..osss", ".ossss", ".ossss", ".ossss", ".ossss", "..osss",
        "..otts", ".otttt", "otTttt", "otTttt", "ostttt", ".okkkk"]
HELM = ["w...gg", "ww.ggg", "wwgggg", ".wgggg", ".ohhhh", ".oh..."]
COLORS = {
    "o": "#3b1f0e", "s": "#f7d3ad", "h": "#e0b04a", "t": "#3a6fd8", "T": "#2d56a8",
    "k": "#f2c14e", "g": "#f2c14e", "w": "#ffffff",
}


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def mirror(half):
    return half + half[::-1]


def tile():
    """16x16 grid of RGB tuples."""
    grid = [[rgb("#7ec8f0") if y < 11 else rgb("#5ba044") for x in range(16)] for y in range(16)]
    for x in range(16):
        grid[11][x] = rgb("#8fd16a")
    for x, y in ((3, 3), (4, 3), (5, 3), (2, 4), (3, 4), (4, 4), (5, 4), (6, 4), (11, 2), (12, 2), (10, 3), (11, 3), (12, 3), (13, 3)):
        grid[y][x] = rgb("#ffffff")
    for rows in (BODY, HELM):
        for j, half in enumerate(rows):
            for i, ch in enumerate(mirror(half)):
                if ch in COLORS:
                    grid[j + 2][i + 2] = rgb(COLORS[ch])
    for x, y, c in ((6, 7, "#2a1a10"), (9, 7, "#2a1a10"), (5, 8, "#f3907c"), (10, 8, "#f3907c")):
        grid[y][x] = rgb(c)
    return grid


def write_png(path, size, grid, pad_color="#7ec8f0"):
    scale = size // 16
    offset = (size - scale * 16) // 2
    pad = rgb(pad_color)
    rows = []
    for y in range(size):
        gy = (y - offset) // scale
        row = bytearray(b"\x00")
        for x in range(size):
            gx = (x - offset) // scale
            px = grid[gy][gx] if 0 <= gx < 16 and 0 <= gy < 16 and y >= offset and x >= offset else pad
            row += bytes(px)
        rows.append(bytes(row))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    grid = tile()
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
        write_png(PUBLIC / name, size, grid)
        print("wrote", PUBLIC / name)
