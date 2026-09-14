#!/usr/bin/env python3
"""Draw the Marigold Valley app icons (a pixel marigold on a sky tile) as PNGs. No dependencies."""
import math
import pathlib
import struct
import zlib

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def tile():
    """16x16 grid of RGB tuples: sky, grass, a marigold on a stem."""
    grid = [[rgb("#7ec8f0") if y < 12 else rgb("#5ba044") for x in range(16)] for y in range(16)]
    for x in range(16):
        grid[12][x] = rgb("#8fd16a")
    for x, y in ((1, 2), (2, 2), (3, 2), (0, 3), (1, 3), (2, 3), (3, 3), (4, 3), (12, 1), (13, 1), (11, 2), (12, 2), (13, 2), (14, 2)):
        grid[y][x] = rgb("#ffffff")
    for y in range(9, 14):  # stem
        grid[y][8] = rgb("#3a7a35")
    for x, y in ((9, 11), (10, 11), (10, 10), (6, 12), (7, 12)):  # leaves
        grid[y][x] = rgb("#3a7a35")
    cx, cy = 7.5, 5.5
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - cx, y - cy)
            if d < 1.3:
                grid[y][x] = rgb("#b8451a")
            elif d < 4.6:
                ruffle = (x * 3 + y * 5) % 4 == 0
                edge = d > 3.8
                grid[y][x] = rgb("#ffcf3f" if ruffle and not edge else "#d9761a" if edge else "#f5a01f")
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
