@echo off
setlocal

for /f "usebackq tokens=1-3 delims=/ " %%a in (`powershell -command "Get-Date -Format 'MM/dd/yyyy'"`) do (
    set "month=%%a"
    set "day=%%b"
    set "year=%%c"
)

reg add "HKEY_CURRENT_USER\Software\Typora" /v IDate /t REG_SZ /d "%month%/%day%/%year%" /f

del /f /q "C:\Users\Administrator\AppData\Roaming\Typora\profile.data" >nul 2>&1
del /f /q "C:\Users\wenong\AppData\Roaming\Typora\profile.data" >nul 2>&1

start "" "C:\Program Files\Typora\Typora.exe"

endlocal