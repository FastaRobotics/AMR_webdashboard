"""Dependency-free image synthesis.

The fake backend ships no camera and no video codec, so the simulated
``sensor_msgs/msg/CompressedImage`` payloads are generated here: a tiny PNG
encoder (``zlib`` + ``struct`` from the standard library) plus two deterministic
renderers — a "camera" view and a "depth" view — that animate with the
simulation clock so a tester can tell frames apart and see that the stream is
live.
"""

from __future__ import annotations

import math
import struct
import zlib


def _chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def png_encode(width: int, height: int, rgb: bytes | bytearray) -> bytes:
    """Encode raw RGB24 bytes as an 8-bit truecolour PNG."""

    expected = width * height * 3
    if len(rgb) != expected:
        raise ValueError(f"expected {expected} bytes of RGB data, got {len(rgb)}")

    raw = bytearray()
    stride = width * 3
    for row in range(height):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgb[row * stride : (row + 1) * stride])

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + _chunk(b"IEND", b"")
    )


def _fill_rect(
    buffer: bytearray,
    width: int,
    height: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    colour: tuple[int, int, int],
) -> None:
    pattern = bytes(colour)
    x0, x1 = max(0, x0), min(width, x1)
    y0, y1 = max(0, y0), min(height, y1)
    if x0 >= x1 or y0 >= y1:
        return
    row_pixels = pattern * (x1 - x0)
    for y in range(y0, y1):
        start = (y * width + x0) * 3
        buffer[start : start + len(row_pixels)] = row_pixels


def render_camera_rgb(state, width: int = 320, height: int = 180) -> bytes:
    """A synthetic forward camera view: gradient sky, floor grid, moving boxes."""

    buffer = bytearray(width * height * 3)
    t = state.sim_time
    horizon = int(height * 0.42)

    # Sky above the horizon, floor below, both slowly shifting with time.
    for y in range(height):
        if y < horizon:
            ratio = y / max(horizon, 1)
            colour = (
                int(18 + 30 * ratio),
                int(26 + 60 * ratio),
                int(52 + 90 * ratio),
            )
        else:
            ratio = (y - horizon) / max(height - horizon, 1)
            colour = (
                int(28 + 20 * ratio),
                int(30 + 22 * ratio),
                int(36 + 18 * ratio),
            )
        start = y * width * 3
        buffer[start : start + width * 3] = bytes(colour) * width

    # Floor perspective lines.
    for index in range(1, 9):
        ratio = (index / 9.0) ** 2
        y = int(horizon + (height - horizon) * ratio)
        _fill_rect(buffer, width, height, 0, y, width, y + 1, (52, 66, 82))

    centre = width // 2
    for offset in range(-6, 7):
        x = centre + offset * 12
        if 0 <= x < width:
            _fill_rect(buffer, width, height, x, horizon, x + 1, height, (46, 58, 74))

    # Horizon line.
    _fill_rect(buffer, width, height, 0, horizon, width, horizon + 2, (120, 170, 210))

    # Three "obstacles" drifting across the aisle.
    for index in range(3):
        box_w = 26
        box_h = 34 - index * 6
        x = int(
            width * 0.18
            + index * width * 0.28
            + math.sin(t * 0.8 + index) * 14
        )
        y = height - box_h - 6
        shade = 150 - index * 30
        _fill_rect(
            buffer, width, height, x, y, x + box_w, y + box_h, (shade, shade // 2, 60)
        )
        _fill_rect(
            buffer,
            width,
            height,
            x,
            y,
            x + box_w,
            y + 3,
            (255, 220, 90),
        )

    # Crosshair at the optical centre.
    cx, cy = width // 2, height // 2
    _fill_rect(buffer, width, height, cx - 12, cy, cx + 12, cy + 1, (120, 240, 160))
    _fill_rect(buffer, width, height, cx, cy - 12, cx + 1, cy + 12, (120, 240, 160))

    # A frame counter bar so consecutive frames are visibly different.
    progress = int((t * 20) % width)
    _fill_rect(buffer, width, height, 0, height - 4, 0 + progress, height - 1, (240, 80, 80))
    return bytes(buffer)


def render_depth_rgb(state, width: int = 160, height: int = 90) -> bytes:
    """A synthetic depth image: range rings around the optical centre."""

    buffer = bytearray(width * height * 3)
    cx, cy = width / 2.0, height / 2.0
    max_range = max(cx, cy)
    wobble = math.sin(state.sim_time * 0.7) * 3.0

    for y in range(height):
        start = y * width * 3
        dy = y - cy
        for x in range(width):
            dx = x - cx
            # Clamp: a negative distance would push the shade above 255.
            distance = max(0.0, math.hypot(dx, dy) + wobble)
            value = int(255 * (1.0 - min(distance / max_range, 1.0)))
            index = start + x * 3
            buffer[index] = value
            buffer[index + 1] = value
            buffer[index + 2] = value

    # Range rings every 8 pixels.
    for radius in range(8, int(max_range), 8):
        steps = max(24, radius * 6)
        for step in range(steps):
            angle = 2.0 * math.pi * step / steps
            x = int(cx + math.cos(angle) * radius)
            y = int(cy + math.sin(angle) * radius)
            if 0 <= x < width and 0 <= y < height:
                index = (y * width + x) * 3
                buffer[index] = 40
                buffer[index + 1] = 220
                buffer[index + 2] = 160

    return bytes(buffer)
