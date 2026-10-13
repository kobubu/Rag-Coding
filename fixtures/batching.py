"""Project-owned syntax fixture. Analysis must not execute this module."""


def collect_batches(items: list[str], limit: int) -> list[tuple[str, ...]]:
    # Накопитель: Unicode stays in the original bytes.
    batches: list[tuple[str, ...]] = []
    pending: list[str] = []
    batch_number = 0

    def flush() -> None:
        nonlocal pending, batch_number
        if pending:
            batches.append(tuple(pending))
            pending = []
            batch_number += 1

    for item in items:
        pending.append(item)
        if len(pending) >= limit:
            flush()
    flush()
    return batches
