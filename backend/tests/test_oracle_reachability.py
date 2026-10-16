from interdict_oracle.reachability import reachable_from, reachable_targets, witness_paths


def test_follows_edges_in_their_direction_only() -> None:
    edges = [("a", "b"), ("b", "c")]
    assert reachable_from(edges, "a") == {"b", "c"}
    assert reachable_from(edges, "c") == set()


def test_terminates_on_cycles() -> None:
    edges = [("a", "b"), ("b", "a"), ("b", "c")]
    assert reachable_from(edges, "a") == {"b", "c"}


def test_source_is_not_reported_as_reachable_from_itself() -> None:
    assert reachable_from([("a", "a")], "a") == set()


def test_reachable_targets_returns_only_requested_targets() -> None:
    edges = [("internet", "pod-1"), ("pod-1", "db-1"), ("pod-2", "db-2")]
    assert reachable_targets(edges, "internet", ["db-1", "db-2"]) == {"db-1"}


def test_witness_paths_are_shortest_and_deterministic() -> None:
    edges = [
        ("internet", "b"),
        ("internet", "a"),
        ("a", "db-1"),
        ("b", "db-1"),
        ("a", "c"),
        ("c", "db-2"),
    ]
    paths = witness_paths(edges, "internet", ["db-1", "db-2", "db-3"])
    assert paths == {
        "db-1": ("internet", "a", "db-1"),  # ties broken by sorted neighbour ids
        "db-2": ("internet", "a", "c", "db-2"),
    }


def test_witness_paths_survive_cycles_and_skip_the_source() -> None:
    edges = [("s", "a"), ("a", "s"), ("a", "t")]
    assert witness_paths(edges, "s", ["s", "t"]) == {"t": ("s", "a", "t")}


def test_oracle_does_not_import_the_engine() -> None:
    """TC-44 (partial): the oracle package shares no code with the engine."""
    import ast
    from pathlib import Path

    import interdict_oracle

    package_dir = Path(interdict_oracle.__file__).parent
    for source in package_dir.rglob("*.py"):
        tree = ast.parse(source.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            assert not any(n == "interdict" or n.startswith("interdict.") for n in names), source
