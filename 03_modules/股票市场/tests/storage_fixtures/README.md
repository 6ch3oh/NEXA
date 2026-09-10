# Local repository corruption fixtures

Static files cover valid empty state, malformed JSON, missing schema, unsupported future schema, truncation, and duplicate JSON keys. Record-level invalid, conflict, Unicode, round-trip, atomic failure, Service integration, and Portfolio integration cases are generated from the strict production serializer in `test_local_repository.py`, then mutated one field at a time so fixtures cannot drift from the supported schema.
