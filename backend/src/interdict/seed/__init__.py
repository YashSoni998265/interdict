"""Synthetic environment for the Alert Storm (solution.md §4.3, §10.1, D-04, D-18).

Everything this package produces is invented. It writes structure only (who is exposed,
what runs where, who can reach whom, who holds which grant, what is declared) and never
writes verdicts: every outcome is computed later by the engine from this structure.
"""

from interdict.seed.generator import GENERATOR_VERSION, generate
from interdict.seed.model import Edge, Environment, Node

__all__ = ["GENERATOR_VERSION", "Edge", "Environment", "Node", "generate"]
