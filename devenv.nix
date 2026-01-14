{ pkgs, lib, config, inputs, ... }:

{
  # https://devenv.sh/basics/
  env = {
    BUN_VERSION = "1.3.3";
  };

  # https://devenv.sh/packages/
  packages = [
    pkgs.bun
  ];

  # https://devenv.sh/processes/
  # Note: Lint removed to avoid loop with bun --filter and process-compose
  processes = {
    build.exec = "bun run build";
  };

  # https://devenv.sh/basics/
  enterShell = ''
    echo "Bun version: $(bun --version)"
    echo "Building packages..."
    bun run build
  '';

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running build verification..."
    bun run build
    echo ""
    echo "Running tests..."
    bun test
  '';

  # See full reference at https://devenv.sh/reference/options/
}
