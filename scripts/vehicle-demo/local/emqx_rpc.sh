#!/bin/sh
# Fixed broker-local RPC. Cookie never leaves this process/container.
set -eu
set +x
gate_node=$(tr '\000' '\n' </proc/1/cmdline | awk 'last=="-name" {print; exit} {last=$0}')
gate_cookie=$(tr '\000' '\n' </proc/1/cmdline | awk 'last=="-setcookie" {print; exit} {last=$0}')
case "$gate_node" in emqx@*) ;; *) exit 21 ;; esac
[ -n "$gate_cookie" ] || exit 22
case "${gate_node#*@}" in *.*) gate_name_flag=-name ;; *) gate_name_flag=-sname ;; esac
export ERL_FLAGS='-start_epmd false -epmd_module ekka_epmd -proto_dist ekka'
export EKKA_PROTO_DIST_MOD=inet_tcp
exec /opt/emqx/erts-*/bin/escript /opt/emqx/bin/nodetool \
    "$gate_name_flag" "$gate_node" -setcookie "$gate_cookie" eval "$1"
