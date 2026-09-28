"""Where the update tooling finds client binaries and il2cpp dumps.

Defaults use this checkout's gitignored local-data directory:
  <repo>/local-data/client-binaries-<version>/GameAssembly.dll
  <repo>/local-data/il2cpp-dump/<version>/il2cpp-v7.tsv
Override with THAUMIEL_LOCAL_DATA=<dir containing client-binaries-* and il2cpp-dump/>.
Versions are the client folder suffix, e.g. CNBetaWin3.3.0 (short form 3.3.0 accepted).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL_DATA = os.environ.get('THAUMIEL_LOCAL_DATA') or os.path.normpath(os.path.join(HERE, '..', '..', 'local-data'))


def version(v):
    return v if v.startswith('CNBetaWin') else 'CNBetaWin' + v


def game_assembly(v):
    return os.path.join(LOCAL_DATA, 'client-binaries-' + version(v), 'GameAssembly.dll')


def unity_player(v):
    return os.path.join(LOCAL_DATA, 'client-binaries-' + version(v), 'UnityPlayer.dll')


def dump_dir(v):
    return os.path.join(LOCAL_DATA, 'il2cpp-dump', version(v))
