{ pkgs, config, inputs, ... }:

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
    # Add libstdc++ for sharp/huggingface-transformers on NixOS
    export LD_LIBRARY_PATH=${pkgs.stdenv.cc.cc.lib}/lib:$LD_LIBRARY_PATH
    echo "LD_LIBRARY_PATH: $LD_LIBRARY_PATH"
    echo "Bun version: $(bun --version)"
  '';

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running tests..."
    bun test
  '';

  # See full reference at https://devenv.sh/reference/options/
}
