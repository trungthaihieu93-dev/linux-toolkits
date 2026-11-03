#!/usr/bin/env bash
# install-toolchains.sh - pick and install developer toolchains (Debian/Ubuntu family).
#
# Usage: sudo ./install-toolchains.sh [--all | --only id,id,...] [--user NAME] [-y] [--list] [-h]
#
# User-level tools (nvm, bun, rustup, uv, claude, ...) are installed for the invoking
# sudo user (or --user), not for root. System-wide tools (Go, Flutter, Android SDK,
# Docker, apt packages) go to /usr/local, /opt and the system package manager.
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

IDS=(nvm-bun bun-tools go rust python pyenv java jenv flutter android cpp docker claude)
LABELS=(
  "nvm + bun + Node LTS" "Bun-based CLIs" "Go" "Rust" "Python 3 + uv + pip" "pyenv"
  "JDK 21 + 25" "jenv" "Flutter SDK" "Android SDK" "C/C++" "Docker Engine" "Claude Code CLI"
)
DESCS=(
  "latest nvm & bun, then nvm installs the latest Node LTS"
  "nx turbo expo nest angular opencode codex cline kilocode"
  "latest Go tarball -> /usr/local/go"
  "rustup + stable toolchain, clippy, rustfmt, rust-analyzer"
  "python3, pip, venv, pipx, uv"
  "pyenv + build deps, shell init in ~/.bashrc and ~/.zshrc"
  "OpenJDK 21 and 25 (apt) -> /usr/lib/jvm"
  "jenv Java version manager, registers the installed JDKs"
  "Flutter (stable) -> /opt/flutter + Linux desktop build tools"
  "JDK + cmdline-tools/platform-tools/build-tools -> /opt/android-sdk"
  "gcc, g++, clang, lld, gdb, cmake, ninja, make, ccache, ..."
  "docker-ce, buildx, compose from Docker's official apt repo"
  "native installer, latest release"
)

declare -A SEL
for id in "${IDS[@]}"; do SEL[$id]=0; done

TARGET_USER=${TARGET_USER:-}
ASSUME_YES=0
FLUTTER_DIR=/opt/flutter
ANDROID_HOME_DIR=/opt/android-sdk

# Prelude for every command run as the target user: tool dirs on PATH, nvm loaded.
USER_ENV='export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh";'

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

list_components() {
  local i
  for i in "${!IDS[@]}"; do printf '  %-10s %s\n' "${IDS[i]}" "${DESCS[i]}"; done
}

# ---------------------------------------------------------------- helpers

have_apt() { command -v apt-get >/dev/null 2>&1; }
need_apt() { have_apt || die "this component needs apt (Debian/Ubuntu)"; }

# Bulk install; if that fails, retry package by package so one missing name
# (e.g. a libstdc++-NN-dev that doesn't exist on this release) doesn't sink the rest.
apt_install() {
  apt-get install -y --no-install-recommends "$@" && return 0
  warn "bulk install failed, retrying package by package"
  local p
  for p in "$@"; do
    apt-get install -y --no-install-recommends "$p" || warn "skipped: $p"
  done
  return 0
}

# Run a script (arg 1) as the target user in a login shell with USER_ENV loaded.
user_sh() {
  runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" USER="$TARGET_USER" LOGNAME="$TARGET_USER" \
    bash -lc "cd \"\$HOME\"; $USER_ENV set -e; $1"
}

confirm() {
  [[ $ASSUME_YES == 1 ]] && return 0
  [[ -r /dev/tty ]] || die "confirmation needed but no TTY; re-run with -y"
  local a
  read -r -p "$1 [y/N] " a </dev/tty
  [[ $a == [yY]* ]]
}

# Append a marked block (stdin) to the target user's ~/.bashrc and ~/.zshrc, once.
# Optional 2nd arg: ERE; files that already match it (e.g. an installer's own edit) are skipped.
add_rc_block() {
  local name=$1 skip=${2:-} block f
  block=$(cat)
  for f in "$TARGET_HOME/.bashrc" "$TARGET_HOME/.zshrc"; do
    [[ -f $f ]] || continue
    grep -qF "# >>> $name >>>" "$f" && continue
    [[ -z $skip ]] || ! grep -qE "$skip" "$f" || continue
    printf '\n# >>> %s >>>\n%s\n# <<< %s <<<\n' "$name" "$block" "$name" >> "$f"
  done
}

# Shell snippets in /etc/profile.d, also sourced by interactive bash and zsh
# (neither reads profile.d in a non-login interactive shell on its own).
write_profile() {
  install -d /etc/profile.d
  cat > "/etc/profile.d/devtools-$1.sh"
  chmod 644 "/etc/profile.d/devtools-$1.sh"
  local f
  for f in /etc/bash.bashrc /etc/zsh/zshrc; do
    [[ -f $f ]] || continue
    grep -qF '# devtools-profile-hook' "$f" && continue
    cat >> "$f" <<'EOF'
# devtools-profile-hook
for _f in /etc/profile.d/devtools-*.sh; do [ -r "$_f" ] && . "$_f"; done; unset _f
EOF
  done
}

# ---------------------------------------------------------------- components

install_nvm_bun() {
  log "Installing bun (latest)"
  user_sh 'curl -fsSL https://bun.sh/install | bash'

  log "Installing nvm (latest) and Node LTS"
  user_sh "$(cat <<'EOF'
tag=$(curl -fsSL https://api.github.com/repos/nvm-sh/nvm/releases/latest \
  | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
[ -n "$tag" ] || tag=v0.40.3
echo "nvm $tag"
curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$tag/install.sh" | bash
export NVM_DIR="$HOME/.nvm"
set +e; . "$NVM_DIR/nvm.sh"; set -e
nvm install --lts
nvm alias default 'lts/*'
node --version; bun --version
EOF
)"
  # The installers pick one rc file from $SHELL (or none); make sure bash and zsh both load them.
  add_rc_block nvm 'NVM_DIR' <<'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
EOF
  add_rc_block bun 'BUN_INSTALL|\.bun/bin' <<'EOF'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF
}

install_bun_tools() {
  log "Installing global CLIs with bun"
  user_sh "$(cat <<'EOF'
command -v bun >/dev/null || { echo "bun not found; select nvm-bun first" >&2; exit 1; }
# expo-cli is deprecated; the `expo` package is the current CLI.
pkgs="nx turbo expo @nestjs/cli @angular/cli opencode-ai @openai/codex cline @kilocode/cli"
failed=""
for p in $pkgs; do
  echo "--> bun add -g $p@latest"
  bun add -g "$p@latest" </dev/null || failed="$failed $p"
done
# let packages that download platform binaries in postinstall do so
bun pm -g trust --all </dev/null >/dev/null 2>&1 || true
[ -z "$failed" ] || { echo "FAILED packages:$failed" >&2; exit 1; }
EOF
)"
}

install_go() {
  local arch ver tmp
  case "$(uname -m)" in
    x86_64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
  ver=$(curl -fsSL 'https://go.dev/VERSION?m=text' | sed -n 1p)
  [[ $ver == go* ]] || die "could not determine latest Go version"
  log "Installing $ver ($arch)"
  tmp=$(mktemp -d)
  curl -fsSL "https://go.dev/dl/${ver}.linux-${arch}.tar.gz" -o "$tmp/go.tgz"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "$tmp/go.tgz"
  rm -rf "$tmp"
  write_profile go <<'EOF'
case ":$PATH:" in *:/usr/local/go/bin:*) ;; *) export PATH="$PATH:/usr/local/go/bin:$HOME/go/bin" ;; esac
EOF
  /usr/local/go/bin/go version
}

install_rust() {
  # rustc needs a system linker
  have_apt && apt_install build-essential pkg-config libssl-dev curl ca-certificates \
    || warn "no apt: make sure a C linker (gcc/cc) is installed"
  log "Installing Rust via rustup"
  user_sh "$(cat <<'EOF'
if command -v rustup >/dev/null; then
  rustup self update || true
  rustup update stable
else
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile default
fi
. "$HOME/.cargo/env"
rustup default stable
rustup component add clippy rustfmt rust-analyzer
rustc --version; cargo --version
EOF
)"
}

install_python() {
  need_apt
  log "Installing Python 3 toolchain"
  apt_install python3 python3-pip python3-venv python3-dev python3-setuptools python3-wheel \
    python-is-python3 pipx build-essential libffi-dev libssl-dev
  # Debian/Ubuntu only ship pip3; provide the plain `pip` name too
  if ! command -v pip >/dev/null && command -v pip3 >/dev/null; then
    ln -s "$(command -v pip3)" /usr/local/bin/pip
  fi
  log "Installing uv (latest)"
  user_sh 'curl -LsSf https://astral.sh/uv/install.sh | sh; uv --version'
  python3 --version; pip --version
}

install_pyenv() {
  need_apt
  log "Installing pyenv build dependencies"
  apt_install build-essential curl git libssl-dev zlib1g-dev libbz2-dev libreadline-dev \
    libsqlite3-dev libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev
  log "Installing pyenv"
  user_sh "$(cat <<'EOF'
if [ -d "$HOME/.pyenv" ]; then
  export PATH="$HOME/.pyenv/bin:$PATH"
  pyenv update || git -C "$HOME/.pyenv" pull --ff-only
else
  curl -fsSL https://pyenv.run | bash
fi
"$HOME/.pyenv/bin/pyenv" --version
EOF
)"
  add_rc_block pyenv <<'EOF'
export PYENV_ROOT="$HOME/.pyenv"
[ -d "$PYENV_ROOT/bin" ] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
EOF
}

install_java() {
  need_apt
  log "Installing OpenJDK 21 and 25"
  apt_install openjdk-21-jdk openjdk-25-jdk
  local v found=0
  for v in 21 25; do
    if compgen -G "/usr/lib/jvm/java-$v-openjdk-*" >/dev/null; then
      found=1
    else
      warn "JDK $v not installed (not available from this release's apt repos?)"
    fi
  done
  ((found)) || die "no JDK could be installed"
  ls -d /usr/lib/jvm/java-*-openjdk-* 2>/dev/null
}

install_jenv() {
  log "Installing jenv"
  user_sh "$(cat <<'EOF'
if [ -d "$HOME/.jenv/.git" ]; then
  git -C "$HOME/.jenv" pull --ff-only
else
  git clone https://github.com/jenv/jenv.git "$HOME/.jenv"
fi
export PATH="$HOME/.jenv/bin:$PATH"
eval "$(jenv init -)"
jenv enable-plugin export || true
for d in /usr/lib/jvm/java-21-openjdk-* /usr/lib/jvm/java-25-openjdk-*; do
  [ -d "$d" ] && jenv add "$d"
done
jenv versions
# default to the LTS; switch with `jenv global 25` / `jenv local 25`
jenv global 21 || echo "could not set global 21 (JDK 21 not registered?)"
EOF
)"
  add_rc_block jenv <<'EOF'
export PATH="$HOME/.jenv/bin:$PATH"
eval "$(jenv init -)"
EOF
}

install_flutter() {
  need_apt
  log "Installing Flutter build prerequisites"
  apt_install curl git unzip xz-utils zip ca-certificates libglu1-mesa \
    clang cmake ninja-build pkg-config libgtk-3-dev liblzma-dev libstdc++-12-dev libsecret-1-dev

  # Owned by the target user: Flutter writes its cache inside the SDK directory.
  if [[ -d $FLUTTER_DIR/.git ]]; then
    log "Flutter already present, upgrading"
    user_sh "export PATH=$FLUTTER_DIR/bin:\$PATH; flutter upgrade"
  else
    log "Cloning Flutter (stable) into $FLUTTER_DIR"
    install -d -o "$TARGET_USER" "$FLUTTER_DIR"
    user_sh "git clone -b stable https://github.com/flutter/flutter.git $FLUTTER_DIR"
  fi
  chown -R "$TARGET_USER" "$FLUTTER_DIR"
  write_profile flutter <<EOF
case ":\$PATH:" in *:$FLUTTER_DIR/bin:*) ;; *) export PATH="\$PATH:$FLUTTER_DIR/bin" ;; esac
EOF
  user_sh "export PATH=$FLUTTER_DIR/bin:\$PATH; flutter precache; flutter --version"
  if [[ -x $ANDROID_HOME_DIR/cmdline-tools/latest/bin/sdkmanager ]]; then
    user_sh "export PATH=$FLUTTER_DIR/bin:\$PATH; flutter config --android-sdk $ANDROID_HOME_DIR"
  fi
}

install_android() {
  need_apt
  log "Installing JDK"
  apt_install openjdk-17-jdk-headless unzip curl ca-certificates \
    || apt_install default-jdk-headless unzip curl ca-certificates

  log "Android SDK licenses must be accepted to install build tools (https://developer.android.com/studio/terms)"
  confirm "Accept the Android SDK licenses and continue?" || die "licenses not accepted"

  local zip tmp
  zip=$(curl -fsSL https://developer.android.com/studio | grep -oE 'commandlinetools-linux-[0-9]+_latest\.zip' | sort -u | tail -n1 || true)
  [[ -n $zip ]] || { zip=commandlinetools-linux-11076708_latest.zip; warn "could not detect latest cmdline-tools, using $zip"; }
  log "Downloading $zip"
  tmp=$(mktemp -d)
  curl -fsSL "https://dl.google.com/android/repository/$zip" -o "$tmp/cmdline.zip"
  unzip -q "$tmp/cmdline.zip" -d "$tmp"
  rm -rf "$ANDROID_HOME_DIR/cmdline-tools/latest"
  install -d "$ANDROID_HOME_DIR/cmdline-tools"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME_DIR/cmdline-tools/latest"
  rm -rf "$tmp"
  chown -R "$TARGET_USER" "$ANDROID_HOME_DIR"

  user_sh "$(cat <<EOF
export ANDROID_HOME=$ANDROID_HOME_DIR
sdkm="\$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "\$sdkm" --licenses >/dev/null || true
list=\$("\$sdkm" --list 2>/dev/null)
bt=\$(echo "\$list" | grep -oE 'build-tools;[0-9]+\.[0-9]+\.[0-9]+ ' | sort -uV | tail -n1 | tr -d ' ')
pl=\$(echo "\$list" | grep -oE 'platforms;android-[0-9]+ ' | sort -uV | tail -n1 | tr -d ' ')
[ -n "\$bt" ] && [ -n "\$pl" ] || { echo "could not find latest build-tools/platform" >&2; exit 1; }
echo "Installing platform-tools \$bt \$pl"
yes | "\$sdkm" "platform-tools" "\$bt" "\$pl"
EOF
)"
  write_profile android <<EOF
export ANDROID_HOME=$ANDROID_HOME_DIR
export ANDROID_SDK_ROOT=$ANDROID_HOME_DIR
case ":\$PATH:" in *:\$ANDROID_HOME/platform-tools:*) ;; *) export PATH="\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools" ;; esac
EOF
  if [[ -x $FLUTTER_DIR/bin/flutter ]]; then
    user_sh "export PATH=$FLUTTER_DIR/bin:\$PATH; flutter config --android-sdk $ANDROID_HOME_DIR"
  fi
}

install_cpp() {
  need_apt
  log "Installing C/C++ toolchains"
  apt_install build-essential gcc g++ make clang clangd clang-format clang-tidy lld lldb gdb \
    cmake ninja-build meson pkg-config autoconf automake libtool bison flex ccache valgrind \
    binutils gdb-multiarch
  gcc --version | head -n1
  clang --version | head -n1
}

install_docker() {
  need_apt
  local distro codename
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) distro=$ID; codename=${VERSION_CODENAME:-} ;;
    *)
      if [[ " ${ID_LIKE:-} " == *" ubuntu "* ]]; then
        distro=ubuntu; codename=${UBUNTU_CODENAME:-}
      elif [[ " ${ID_LIKE:-} " == *" debian "* ]]; then
        distro=debian; codename=${DEBIAN_CODENAME:-${VERSION_CODENAME:-}}
      else
        die "unsupported distro for Docker's apt repo: ${ID:-unknown}"
      fi ;;
  esac
  [[ -n $codename ]] || die "could not determine distro codename"

  if dpkg -l docker.io 2>/dev/null | grep -q '^ii'; then
    warn "docker.io is installed; installing docker-ce will replace it"
  fi
  log "Adding Docker apt repo ($distro $codename)"
  apt_install ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$distro/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$distro
Suites: $codename
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if [[ -d /run/systemd/system ]]; then
    systemctl enable --now docker
  else
    warn "systemd not running; start dockerd manually"
  fi
  usermod -aG docker "$TARGET_USER"
  docker --version
}

install_claude() {
  log "Installing Claude Code (native installer, latest)"
  user_sh 'curl -fsSL https://claude.ai/install.sh | bash; claude --version'
}

# ---------------------------------------------------------------- selection UI

menu() {
  [[ -r /dev/tty ]] || die "no TTY for the menu; use --all or --only id,id"
  local c t i id
  while true; do
    printf '\nSelect toolchains to install:\n\n'
    for i in "${!IDS[@]}"; do
      id=${IDS[i]}
      printf '  %2d) [%s] %-22s %s\n' $((i + 1)) "$([[ ${SEL[$id]} == 1 ]] && echo x || echo ' ')" "${LABELS[i]}" "${DESCS[i]}"
    done
    printf '\nToggle numbers (e.g. "1 3 5"), a = all, n = none, Enter = install, q = quit: '
    read -r c </dev/tty || exit 1
    case $c in
      "") break ;;
      q|Q) exit 0 ;;
      a|A) for id in "${IDS[@]}"; do SEL[$id]=1; done ;;
      n|N) for id in "${IDS[@]}"; do SEL[$id]=0; done ;;
      *)
        for t in $c; do
          if [[ $t =~ ^[0-9]+$ ]] && ((t >= 1 && t <= ${#IDS[@]})); then
            id=${IDS[t-1]}; SEL[$id]=$((1 - SEL[$id]))
          else
            warn "ignored: $t"
          fi
        done ;;
    esac
  done
}

# ---------------------------------------------------------------- main

MODE=menu
ONLY=
while (($#)); do
  case $1 in
    --all) MODE=all ;;
    --only) MODE=only; ONLY=${2:-}; shift ;;
    --user) TARGET_USER=${2:-}; shift ;;
    -y|--yes) ASSUME_YES=1 ;;
    --list) list_components; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try -h)" ;;
  esac
  shift
done

[[ $EUID -eq 0 ]] || die "run with sudo: sudo $0"
TARGET_USER=${TARGET_USER:-${SUDO_USER:-}}
[[ -n $TARGET_USER && $TARGET_USER != root ]] || die "no non-root target user; run via sudo from your account or pass --user NAME"
id "$TARGET_USER" >/dev/null 2>&1 || die "user not found: $TARGET_USER"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
command -v runuser >/dev/null || die "runuser (util-linux) is required"

case $MODE in
  all) for id in "${IDS[@]}"; do SEL[$id]=1; done ;;
  only)
    [[ -n $ONLY ]] || die "--only needs a comma-separated list (see --list)"
    IFS=, read -ra picks <<<"$ONLY"
    for id in "${picks[@]}"; do
      [[ -n ${SEL[$id]+x} ]] || die "unknown component: $id (see --list)"
      SEL[$id]=1
    done ;;
  menu) menu ;;
esac

# bun-based CLIs need bun + node
if [[ ${SEL[bun-tools]} == 1 && ${SEL[nvm-bun]} == 0 && ! -x $TARGET_HOME/.bun/bin/bun ]]; then
  log "bun not found for $TARGET_USER; adding nvm-bun"
  SEL[nvm-bun]=1
fi

# jenv has nothing to manage without a JDK
if [[ ${SEL[jenv]} == 1 && ${SEL[java]} == 0 ]] && ! compgen -G '/usr/lib/jvm/java-*-openjdk-*' >/dev/null; then
  log "no JDK found in /usr/lib/jvm; adding java"
  SEL[java]=1
fi

chosen=0
for id in "${IDS[@]}"; do ((chosen += SEL[$id])); done
((chosen > 0)) || { log "nothing selected"; exit 0; }

log "Installing for user: $TARGET_USER"
if have_apt; then
  apt-get update -y || die "apt-get update failed"
  apt_install curl ca-certificates git unzip xz-utils zip
else
  warn "apt not found: components that need it will fail"
  command -v curl >/dev/null || die "curl is required"
fi

OK=(); FAILED=()
for i in "${!IDS[@]}"; do
  id=${IDS[i]}
  [[ ${SEL[$id]} == 1 ]] || continue
  log "[$id] ${LABELS[i]}"
  # Own subshell so a failing component can't take the others down; set -e makes
  # the first failing step abort that component.
  ( set -e; "install_${id//-/_}" )
  if (($? == 0)); then OK+=("$id"); else FAILED+=("$id"); err "component failed: $id"; fi
done

printf '\n'
log "Summary"
((${#OK[@]})) && printf '  ok:     %s\n' "${OK[*]}"
((${#FAILED[@]})) && printf '  failed: %s\n' "${FAILED[*]}"
printf '\nLog out and back in (or open a new shell) so PATH and the docker group take effect.\n'
((${#FAILED[@]} == 0))
