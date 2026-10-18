"""Independent verification oracle (method O, solution.md §8.5).

This package must not import anything from `interdict` (enforced by TC-44),
so that its answers do not share code with the engine it checks.

The oracle searches the exported ATTACK_STEP edges, so it shares the engine's construction of
those edges (RSK-16, D-13).
"""

__version__ = "0.1.0"
METHOD = "bfs-over-exported-attack-steps"
