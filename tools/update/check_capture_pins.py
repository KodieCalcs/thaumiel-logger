"""Superseded (2026-09-28): the pins now live in tools/update/pins/<client>.json and are emitted into
src/pins.zig / pins.h / dumper-rvas.zon, so there are no literals left in statelog.zig to parse --
this script (hard-coded to 3.3.3) now fails to parse. It forwards to the check that covers every pin:

    py tools/update/rederive.py check <version>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rederive  # noqa: E402

sys.exit(rederive.check(sys.argv[1] if len(sys.argv) > 1 else '3.3.4'))
