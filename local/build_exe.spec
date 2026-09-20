# -*- mode: python ; coding: utf-8 -*-
# RView - PyInstaller spec file

import os

block_cipher = None

# Web resources to include
web_dir = os.path.join(os.path.dirname(SPEC), '..', 'web')
datas = [
    (os.path.join(web_dir, 'index.html'), '.'),
    (os.path.join(web_dir, 'style.css'), '.'),
    (os.path.join(web_dir, 'script.js'), '.'),
]

a = Analysis(
    ['rview.py'],
    pathex=[os.path.join(os.path.dirname(SPEC), '..')],
    binaries=[],
    datas=datas,
    hiddenimports=['PIL', 'PIL.Image'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='RView',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
