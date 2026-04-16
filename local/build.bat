@echo off
echo ========================================
echo RView - Build Script
echo ========================================

cd /d "%~dp0"

echo.
echo Building RView.exe...
pyinstaller --clean build_exe.spec

echo.
echo Moving to dist folder...
if exist "..\dist\RView.exe" del "..\dist\RView.exe"
if exist "dist\RView.exe" move "dist\RView.exe" "..\dist\"

echo.
echo Cleaning up...
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"

echo.
echo ========================================
echo Build complete!
echo Output: ..\dist\RView.exe
echo ========================================
pause
