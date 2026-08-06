// Generated client lands inside the `pythonapi` package (not at the repo
// root or app root) so hatchling's `packages = ["pythonapi"]` picks it up
// for the built wheel. Re-run `uv run baml-cli generate` from
// apps/pythonapi/ after editing any .baml file, and commit the output.
generator target {
  output_type "python/pydantic"
  // BAML appends a "baml_client" package dir beneath output_dir, so this
  // resolves to apps/pythonapi/pythonapi/baml_client/ - inside the
  // `pythonapi` package that hatchling picks up for the built wheel.
  output_dir "../pythonapi"

  // Must track the installed baml-py version (see pyproject.toml/uv.lock) -
  // baml-cli generate errors on a mismatch.
  version "0.225.0"

  // core/generation.py imports from baml_client.async_client explicitly,
  // so this only affects what the bare `b` shortcut resolves to.
  default_client_mode async
}
