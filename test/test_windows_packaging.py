"""Headless Windows packaging checks; run with python -m unittest discover -s test -p test_windows_packaging.py."""
import ctypes
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == 'win32', 'Windows shell integration')
class WindowsPackagingTests(unittest.TestCase):
    def run_script(self, name, *args, check=True):
        return subprocess.run(
            ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
             '-File', str(ROOT / 'local' / name), *map(str, args)],
            capture_output=True, text=True, check=check,
        )

    def registry_snapshot(self):
        import winreg
        result = []
        for kind in ('Directory', r'Directory\Background'):
            for suffix in ('', r'\command'):
                path = rf'Software\Classes\{kind}\shell\RView{suffix}'
                try:
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
                        values = []
                        for index in range(winreg.QueryInfoKey(key)[1]):
                            values.append(winreg.EnumValue(key, index))
                        result.append((path, sorted(values)))
                except FileNotFoundError:
                    result.append((path, None))
        return result

    def test_dry_runs_leave_registry_and_installation_unchanged(self):
        target = Path(os.environ['LOCALAPPDATA']) / 'Programs/RView/RView.exe'
        before = target.stat() if target.exists() else None
        registry = self.registry_snapshot()
        self.run_script('build.ps1', '-DryRun', '-Python', 'nonexistent-build-python')
        self.run_script('build.ps1', '-DryRun', '-BuildOnly')
        self.run_script('register-context-menu.ps1', '-DryRun')
        self.run_script('unregister-context-menu.ps1', '-DryRun')
        self.assertEqual(registry, self.registry_snapshot())
        self.assertEqual(before, target.stat() if target.exists() else None)

    def test_shell_arguments_round_trip(self):
        # These names are legal on Windows; a literal double quote is not.
        exe = r"C:\日本語 と空白\O'Brien [viewer]\RView.exe"
        commands = self.run_script('register-context-menu.ps1', '-DryRun', '-ExePath', exe).stdout
        parser = ctypes.windll.shell32.CommandLineToArgvW
        parser.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_int)]
        parser.restype = ctypes.POINTER(ctypes.c_wchar_p)
        free = ctypes.windll.kernel32.LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        self.assertEqual(len(commands.splitlines()), 2)
        for line, placeholder in zip(commands.splitlines(), ('%1', '%V')):
            command = line.split(' : ', 1)[1]
            for folder in ('C:\\', r"C:\日本語 と空白\O'Brien [1] & 100%", 'C:\\日本語\\',
                           '\\\\server\\share\\'):
                with self.subTest(folder=folder, placeholder=placeholder):
                    count = ctypes.c_int()
                    pointer = parser(command.replace(placeholder, folder), ctypes.byref(count))
                    try:
                        argv = list(pointer[:count.value])
                    finally:
                        free(pointer)
                    self.assertEqual(argv, [exe, folder + r'\.'])
                    self.assertEqual(os.path.normpath(argv[1]), os.path.normpath(folder))

    def test_failed_build_preserves_existing_executable(self):
        # Only disposable test files within this checkout are used.
        scratch = ROOT / 'local/build/test-scratch'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as temporary:
            directory = Path(temporary)
            target = directory / 'RView.exe'
            target.write_bytes(b'existing installation')
            python = directory / 'failed-python.cmd'
            python.write_text('@exit /b 7\n')
            registry = self.registry_snapshot()
            result = self.run_script('build.ps1', '-Python', python, '-InstallDir', directory, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(target.read_bytes(), b'existing installation')
            self.assertFalse((directory / 'RView.exe.new').exists())
            self.assertEqual(registry, self.registry_snapshot())


if __name__ == '__main__':
    unittest.main()
