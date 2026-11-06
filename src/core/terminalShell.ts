export const TERMINAL_BASH_RC = String.raw`# CodeForge's small, dependency-free interactive shell helpers.
export PAGER=cat
export GIT_PAGER=cat

_cf_bat_stream() {
  local line number=1
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '\033[90m%4d │\033[0m ' "$number"
    case "$line" in
      \#*|\ *\#*) printf '\033[2;90m%s\033[0m' "$line" ;;
      *'function '*|*'const '*|*'let '*|*'class '*|*'def '*|*'import '*) printf '\033[36m%s\033[0m' "$line" ;;
      *'return '*|*'if '*|*'else'*|*'for '*|*'while '*|*'async '*|*'await '*) printf '\033[34m%s\033[0m' "$line" ;;
      *) printf '%s' "$line" ;;
    esac
    printf '\n'
    number=$((number + 1))
  done
}

bat() {
  if (( $# > 0 )) && [[ "$1" == --help || "$1" == -h ]]; then
    printf 'Usage: bat [FILE ...]\nA lightweight, line-numbered, color-highlighted file viewer. Use - for standard input.\n'
    return 0
  fi
  if (( $# == 0 )); then
    _cf_bat_stream
    return $?
  fi
  local file result=0
  for file in "$@"; do
    if [[ "$file" == - ]]; then
      _cf_bat_stream || result=$?
    elif [[ -r "$file" ]]; then
      _cf_bat_stream < "$file" || result=$?
    else
      printf 'bat: %s: file not found or unreadable\n' "$file" >&2
      result=1
    fi
  done
  return "$result"
}

_cf_delta_stream() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      'diff --git '*|'diff --cc '*|'diff --combined '*|'index '*|'--- '*|'+++ '*) printf '\033[1;36m%s\033[0m\n' "$line" ;;
      '@@'*) printf '\033[1;34m%s\033[0m\n' "$line" ;;
      '+'*) printf '\033[32m%s\033[0m\n' "$line" ;;
      '-'*) printf '\033[31m%s\033[0m\n' "$line" ;;
      '\ No newline at end of file') printf '\033[2;90m%s\033[0m\n' "$line" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done
}

_cf_count_file_lines() {
  local line count=0
  while IFS= read -r line || [[ -n "$line" ]]; do count=$((count + 1)); done < "$1"
  printf '%s' "$count"
}

diff() {
  local external_diff old_file new_file old_count new_count old_start=1 new_start=1 line
  external_diff=$(type -P diff 2>/dev/null || true)
  if [[ -n "$external_diff" ]]; then "$external_diff" "$@"; return $?; fi
  if (( $# == 3 )) && [[ "$1" == -u || "$1" == --unified ]]; then
    old_file=$2
    new_file=$3
  elif (( $# == 2 )); then
    old_file=$1
    new_file=$2
  else
    printf 'Usage: diff -u OLD_FILE NEW_FILE\n' >&2
    return 2
  fi
  if [[ ! -r "$old_file" || ! -r "$new_file" ]]; then
    printf 'diff: both input files must be readable\n' >&2
    return 2
  fi
  if command -v cmp >/dev/null 2>&1 && cmp -s -- "$old_file" "$new_file"; then return 0; fi
  old_count=$(_cf_count_file_lines "$old_file")
  new_count=$(_cf_count_file_lines "$new_file")
  if (( old_count == 0 )); then old_start=0; fi
  if (( new_count == 0 )); then new_start=0; fi
  printf '%s\n' "--- $old_file" "+++ $new_file"
  printf '@@ -%s,%s +%s,%s @@\n' "$old_start" "$old_count" "$new_start" "$new_count"
  while IFS= read -r line || [[ -n "$line" ]]; do printf -- '-%s\n' "$line"; done < "$old_file"
  while IFS= read -r line || [[ -n "$line" ]]; do printf -- '+%s\n' "$line"; done < "$new_file"
  return 1
}

delta() {
  if (( $# > 0 )) && [[ "$1" == --help || "$1" == -h ]]; then
    printf 'Usage: diff -u OLD NEW | delta\nColorizes unified diff headers, hunks, additions, and deletions.\n'
    return 0
  fi
  if (( $# == 0 )); then
    _cf_delta_stream
    return $?
  fi
  local file result=0
  for file in "$@"; do
    if [[ -r "$file" ]]; then
      _cf_delta_stream < "$file" || result=$?
    else
      printf 'delta: %s: file not found or unreadable\n' "$file" >&2
      result=1
    fi
  done
  return "$result"
}

_cf_fzf_handle_interrupt() {
  stty "$oldstty" <&9 2>/dev/null
  interrupted=1
  _cf_fzf_restore_interrupt
}

_cf_fzf_restore_interrupt() {
  trap - INT
  if [[ -n "$old_int_trap" ]]; then eval "$old_int_trap"; fi
}

fzf() {
  local item index=0 start=0 visible=10 key sequence selected='' end i oldstty old_int_trap interrupted=0
  if (( $# == 0 )); then
    while IFS= read -r item || [[ -n "$item" ]]; do set -- "$@" "$item"; done
  fi
  if (( $# == 0 )); then
    printf 'fzf: no choices to select\n' >&2
    return 1
  fi
  if [[ ! -e /dev/tty ]]; then
    printf 'fzf: interactive terminal input is unavailable\n' >&2
    return 1
  fi
  exec 9<>/dev/tty || { printf 'fzf: could not open the terminal\n' >&2; return 1; }
  oldstty=$(stty -g <&9 2>/dev/null) || { exec 9>&-; printf 'fzf: raw terminal input is unavailable\n' >&2; return 1; }
  if ! stty -echo -icanon min 1 time 0 <&9 2>/dev/null; then
    exec 9>&-
    printf 'fzf: could not enable arrow-key input\n' >&2
    return 1
  fi
  old_int_trap=$(trap -p INT)
  trap '_cf_fzf_handle_interrupt' INT
  while :; do
    if (( index < start )); then start=$index; fi
    if (( index >= start + visible )); then start=$((index - visible + 1)); fi
    printf '\033[2J\033[H\033[1;36mSelect an option\033[0m  ↑/↓ move · Enter choose · Esc cancel\n\n' >&9
    end=$((start + visible))
    if (( end > $# )); then end=$#; fi
    i=0
    for item in "$@"; do
      if (( i >= start && i < end )); then
        if (( i == index )); then printf '\033[1;32m❯ %s\033[0m\n' "$item" >&9
        else printf '  %s\n' "$item" >&9; fi
      fi
      i=$((i + 1))
    done
    IFS= read -r -s -N 1 key <&9 || key=''
    if (( interrupted )); then stty "$oldstty" <&9 2>/dev/null; printf '\033[2J\033[H' >&9; exec 9>&-; return 130; fi
    case "$key" in
      $'\x03') stty "$oldstty" <&9 2>/dev/null; _cf_fzf_restore_interrupt; printf '\033[2J\033[H' >&9; exec 9>&-; return 130 ;;
      $'\r'|$'\n')
        i=0
        for item in "$@"; do
          if (( i == index )); then selected=$item; break; fi
          i=$((i + 1))
        done
        break ;;
      $'\x1b')
        sequence=''
        IFS= read -r -s -N 2 -t 0.08 sequence <&9 || true
        case "$sequence" in
          '[A') if (( index > 0 )); then index=$((index - 1)); fi ;;
          '[B') if (( index + 1 < $# )); then index=$((index + 1)); fi ;;
          '[5~') if (( index >= visible )); then index=$((index - visible)); else index=0; fi ;;
          '[6~') if (( index + visible < $# )); then index=$((index + visible)); else index=$(($# - 1)); fi ;;
          *) stty "$oldstty" <&9 2>/dev/null; _cf_fzf_restore_interrupt; printf '\033[2J\033[H' >&9; exec 9>&-; return 130 ;;
        esac ;;
      *) ;;
    esac
  done
  stty "$oldstty" <&9 2>/dev/null
  _cf_fzf_restore_interrupt
  printf '\033[2J\033[H' >&9
  exec 9>&-
  printf '%s\n' "$selected"
}

choose() {
  fzf "$@"
}

cf-help() {
  printf '%s\n' \
    'CodeForge Bash helpers:' \
    '  bat FILE                         line-numbered, lightly highlighted source' \
    '  diff -u OLD NEW | delta          colored unified diff' \
    '  printf "one\ntwo\n" | fzf      arrow-key picker; Enter selects, Esc cancels' \
    '  choose OPTION...                 arrow-key picker for arguments'
}
`;
